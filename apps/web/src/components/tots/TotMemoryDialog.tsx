import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, Tot, TotMemoryFile } from "@t3tools/contracts";
import { useEffect, useState, useSyncExternalStore } from "react";

import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Textarea } from "../ui/textarea";

/** A Tot's memory, or with `tot: null` the memory every Tot shares. */
interface TotMemoryTarget {
  readonly environmentId: EnvironmentId;
  readonly tot: Tot | null;
}

let current: TotMemoryTarget | null = null;
const listeners = new Set<() => void>();
const set = (next: TotMemoryTarget | null) => {
  current = next;
  for (const listener of listeners) listener();
};

export const openTotMemory = (target: TotMemoryTarget) => set(target);

/** Mounted once, beside the Tot editor. */
export function TotMemoryHost() {
  const target = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => null,
  );
  if (target === null) return null;
  return (
    <TotMemoryDialog
      key={`${target.environmentId}:${target.tot?.id ?? "shared"}`}
      target={target}
    />
  );
}

function TotMemoryDialog(props: { readonly target: TotMemoryTarget }) {
  const { environmentId, tot } = props.target;
  const readMemory = useAtomCommand(serverEnvironment.readTotMemory, { reportFailure: false });
  const writeMemory = useAtomCommand(serverEnvironment.writeTotMemory, { reportFailure: false });
  const [files, setFiles] = useState<ReadonlyArray<TotMemoryFile> | null>(null);
  const [selected, setSelected] = useState("MEMORY.md");
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the memory files from the Tot's host once when the dialog opens
  useEffect(() => {
    let cancelled = false;
    void readMemory({ environmentId, input: { id: tot?.id ?? null } }).then((result) => {
      if (cancelled) return;
      if (result._tag === "Success") setFiles(result.value.files);
      else if (!isAtomCommandInterrupted(result)) {
        setFailure(String(squashAtomCommandFailure(result)));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [environmentId, tot?.id, readMemory]);

  const text = (file: TotMemoryFile) => drafts[file.path] ?? file.content;
  const active = files?.find((file) => file.path === selected) ?? files?.[0] ?? null;
  const dirty = (files ?? []).filter((file) => text(file) !== file.content);

  const save = async () => {
    if (tot === null || dirty.length === 0) return;
    setSaving(true);
    setFailure(null);
    const result = await writeMemory({
      environmentId,
      input: { id: tot.id, files: dirty.map((file) => ({ path: file.path, content: text(file) })) },
    });
    setSaving(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) setFailure(String(squashAtomCommandFailure(result)));
      return;
    }
    setFiles((previous) =>
      previous === null
        ? previous
        : previous.map((file) => ({ path: file.path, content: text(file) })),
    );
    setDrafts({});
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : set(null))}>
      <DialogPopup className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tot === null ? "Shared memory" : `${tot.name}'s memory`}</DialogTitle>
          <DialogDescription>
            {tot === null
              ? "What every Tot knows about you. Tots keep it up to date themselves."
              : "Plain files in the Tot's folder. The Tot reads them when a thread starts and keeps them up to date."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex min-h-64 gap-3">
            {files === null ? (
              <p className="text-muted-foreground text-sm">{failure ?? "Loading…"}</p>
            ) : files.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nothing remembered yet.</p>
            ) : (
              <>
                <div className="flex w-44 shrink-0 flex-col gap-1 overflow-y-auto" role="listbox">
                  {files.map((file) => (
                    <Button
                      key={file.path}
                      variant={file.path === active?.path ? "secondary" : "ghost"}
                      size="sm"
                      role="option"
                      aria-selected={file.path === active?.path}
                      onClick={() => setSelected(file.path)}
                    >
                      <span className="truncate">{file.path}</span>
                    </Button>
                  ))}
                </div>
                {active === null ? null : (
                  <Textarea
                    aria-label={active.path}
                    className="min-h-64 flex-1"
                    value={text(active)}
                    readOnly={tot === null}
                    onChange={(event) =>
                      setDrafts((previous) => ({ ...previous, [active.path]: event.target.value }))
                    }
                  />
                )}
              </>
            )}
          </div>
        </DialogPanel>
        {failure !== null && files !== null ? (
          <p className="px-6 text-destructive-foreground text-xs">{failure}</p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => set(null)}>
            Close
          </Button>
          {tot === null ? null : (
            <Button disabled={saving || dirty.length === 0} onClick={() => void save()}>
              Save
            </Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
