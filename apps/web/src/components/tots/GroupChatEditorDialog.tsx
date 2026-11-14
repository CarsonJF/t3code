import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  GROUP_CHAT_DEFAULT_HOP_LIMIT,
  GROUP_CHAT_MAX_HOP_LIMIT,
  GROUP_CHAT_MAX_MEMBERS,
  GROUP_CHAT_MIN_MEMBERS,
  type EnvironmentId,
  type GroupChat,
  type TotId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState, useSyncExternalStore } from "react";

import { serverEnvironment } from "~/state/server";
import { useTotHosts, useTots } from "~/state/tots";
import { useAtomCommand } from "~/state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

export type GroupChatEditorTarget =
  | { readonly mode: "create"; readonly environmentId: EnvironmentId }
  | { readonly mode: "edit"; readonly environmentId: EnvironmentId; readonly room: GroupChat };

// One editor for the whole app: the sidebar, Settings and the command palette open it.
let current: GroupChatEditorTarget | null = null;
const listeners = new Set<() => void>();
const set = (next: GroupChatEditorTarget | null) => {
  current = next;
  for (const listener of listeners) listener();
};

export const openGroupChatEditor = (target: GroupChatEditorTarget) => set(target);

/** Mounted once, beside the Tot editor. */
export function GroupChatEditorHost() {
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
    <GroupChatEditorDialog
      key={
        target.mode === "edit" ? `${target.environmentId}:${target.room.id}` : target.environmentId
      }
      target={target}
    />
  );
}

function GroupChatEditorDialog(props: { readonly target: GroupChatEditorTarget }) {
  const { target } = props;
  const editing = target.mode === "edit" ? target.room : null;
  const [chosenHost, setChosenHost] = useState(target.environmentId);
  const environmentId = editing === null ? chosenHost : target.environmentId;
  const hosts = useTotHosts();
  const navigate = useNavigate();
  const members = useTots().filter(
    (entry) => entry.environmentId === environmentId && entry.tot.projectId !== null,
  );
  const createRoom = useAtomCommand(serverEnvironment.createGroupChat, { reportFailure: false });
  const updateRoom = useAtomCommand(serverEnvironment.updateGroupChat, { reportFailure: false });

  const [name, setName] = useState(editing?.name ?? "");
  const [memberIds, setMemberIds] = useState<ReadonlyArray<TotId>>(editing?.memberIds ?? []);
  const [moderatorId, setModeratorId] = useState<TotId | null>(editing?.moderatorId ?? null);
  const [hopLimit, setHopLimit] = useState(editing?.hopLimit ?? GROUP_CHAT_DEFAULT_HOP_LIMIT);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const effectiveModerator =
    moderatorId !== null && memberIds.includes(moderatorId) ? moderatorId : (memberIds[0] ?? null);
  const toggleMember = (id: TotId, on: boolean) =>
    setMemberIds((previous) => (on ? [...previous, id] : previous.filter((entry) => entry !== id)));

  const submit = async () => {
    if (name.trim() === "") return setFailure("Give the group chat a name.");
    if (memberIds.length < GROUP_CHAT_MIN_MEMBERS) {
      return setFailure(`Pick at least ${GROUP_CHAT_MIN_MEMBERS} Tots.`);
    }
    if (effectiveModerator === null) return setFailure("Pick a moderator.");
    const boundedHops = Math.min(Math.max(Math.round(hopLimit), 1), GROUP_CHAT_MAX_HOP_LIMIT);
    setFailure(null);
    setPending(true);
    if (editing !== null) {
      const result = await updateRoom({
        environmentId,
        input: {
          id: editing.id,
          name: name.trim(),
          memberIds,
          moderatorId: effectiveModerator,
          hopLimit: boundedHops,
        },
      });
      setPending(false);
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) setFailure(String(squashAtomCommandFailure(result)));
        return;
      }
      set(null);
      return;
    }
    // The room runs no agent, but every thread names a model; the moderator's is as good as any.
    const modelSelection = members.find((entry) => entry.tot.id === effectiveModerator)?.tot
      .modelSelection;
    if (modelSelection === null || modelSelection === undefined) {
      setPending(false);
      return setFailure("The moderator needs a model. Turn it on once in Tots settings.");
    }
    const result = await createRoom({
      environmentId,
      input: {
        name: name.trim(),
        memberIds,
        moderatorId: effectiveModerator,
        hopLimit: boundedHops,
        modelSelection,
      },
    });
    setPending(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) setFailure(String(squashAtomCommandFailure(result)));
      return;
    }
    set(null);
    if (result.value.threadId !== null) {
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(environmentId, result.value.threadId)),
      });
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : set(null))}>
      <DialogPopup className="sm:max-w-md">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {editing === null ? "New group chat" : `Edit ${editing.name}`}
            </DialogTitle>
            <DialogDescription>
              One shared thread you and your Tots talk in. Name a Tot with @ to ask it; with no
              name, the moderator answers.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="group-chat-name">Name</Label>
                <Input
                  id="group-chat-name"
                  value={name}
                  placeholder="Hello Room"
                  onChange={(event) => setName(event.target.value)}
                />
              </div>

              {editing === null && hosts.length > 1 ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm">Lives on</span>
                  <Select
                    value={environmentId}
                    onValueChange={(value) => {
                      const host = hosts.find((entry) => entry.environmentId === value);
                      if (host === undefined) return;
                      setChosenHost(host.environmentId);
                      setMemberIds([]);
                      setModeratorId(null);
                    }}
                  >
                    <SelectTrigger size="sm" className="w-48" aria-label="Lives on">
                      <SelectValue>
                        {hosts.find((host) => host.environmentId === environmentId)?.label}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end" alignItemWithTrigger={false}>
                      {hosts.map((host) => (
                        <SelectItem key={host.environmentId} value={host.environmentId}>
                          {host.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
              ) : null}

              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1.5 font-medium text-sm">
                  Members ({GROUP_CHAT_MIN_MEMBERS} to {GROUP_CHAT_MAX_MEMBERS}, on the same
                  machine)
                </legend>
                {members.length === 0 ? (
                  <p className="text-muted-foreground text-xs">Turn on a Tot first.</p>
                ) : null}
                {members.map(({ tot }) => (
                  <label key={tot.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={memberIds.includes(tot.id)}
                      disabled={
                        !memberIds.includes(tot.id) && memberIds.length >= GROUP_CHAT_MAX_MEMBERS
                      }
                      onCheckedChange={(checked) => toggleMember(tot.id, checked)}
                    />
                    <span className="truncate">{tot.name}</span>
                  </label>
                ))}
              </fieldset>

              {memberIds.length > 0 ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm">Moderator</span>
                  <Select
                    value={effectiveModerator ?? ""}
                    onValueChange={(value) => setModeratorId(value as TotId)}
                  >
                    <SelectTrigger size="sm" className="w-48" aria-label="Moderator">
                      <SelectValue>
                        {members.find((entry) => entry.tot.id === effectiveModerator)?.tot.name}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end" alignItemWithTrigger={false}>
                      {members
                        .filter((entry) => memberIds.includes(entry.tot.id))
                        .map(({ tot }) => (
                          <SelectItem key={tot.id} value={tot.id}>
                            {tot.name}
                          </SelectItem>
                        ))}
                    </SelectPopup>
                  </Select>
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-col">
                  <Label htmlFor="group-chat-hops">Replies in a row</Label>
                  <span className="text-muted-foreground text-xs">
                    Most Tot-to-Tot replies after one message from you.
                  </span>
                </div>
                <Input
                  id="group-chat-hops"
                  type="number"
                  min={1}
                  max={GROUP_CHAT_MAX_HOP_LIMIT}
                  className="w-20"
                  value={hopLimit}
                  onChange={(event) => setHopLimit(Number(event.target.value))}
                />
              </div>
              {failure ? <p className="text-destructive-foreground text-xs">{failure}</p> : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => set(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {editing === null ? "Create" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
