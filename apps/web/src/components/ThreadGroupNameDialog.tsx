import { useEffect, useState } from "react";
import { create } from "zustand";

import { PROJECT_ICON_COLORS } from "../projectIconOptions";
import { newThreadGroup, type ThreadGroup, type ThreadGroupDetails } from "../threadGroupsStore";
import { cn } from "~/lib/utils";
import { ProjectIconPickerDialog } from "./settings/ProjectIconPickerDialog";
import { ThreadGroupIcon, threadGroupColorClassName } from "./ThreadGroupIcon";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";

type Request = {
  readonly title: string;
  readonly submitLabel: string;
  readonly initial: ThreadGroupDetails;
  readonly resolve: (details: ThreadGroupDetails | null) => void;
};
const useRequest = create<{ request: Request | null }>(() => ({ request: null }));

export function requestThreadGroupDetails(
  options: Omit<Request, "resolve">,
): Promise<ThreadGroupDetails | null> {
  useRequest.getState().request?.resolve(null);
  return new Promise((resolve) => useRequest.setState({ request: { ...options, resolve } }));
}

/** The group is saved by the first action that uses it, so cancelling leaves nothing behind. */
export async function createThreadGroupFromPrompt(): Promise<ThreadGroup | null> {
  const details = await requestThreadGroupDetails({
    title: "New group",
    submitLabel: "Create",
    initial: { name: "", color: null, icon: null },
  });
  return details === null ? null : newThreadGroup(details);
}

function finish(details: ThreadGroupDetails | null) {
  const request = useRequest.getState().request;
  useRequest.setState({ request: null });
  request?.resolve(details);
}

export function ThreadGroupNameDialogHost() {
  const request = useRequest((state) => state.request);
  // oxlint-disable-next-line t3code/react-effect-budget -- settles a pending prompt if the host unmounts
  useEffect(() => () => finish(null), []);
  return request ? <ThreadGroupNameDialog request={request} /> : null;
}

function ThreadGroupNameDialog({ request }: { request: Request }) {
  const [name, setName] = useState(request.initial.name);
  const [color, setColor] = useState(request.initial.color);
  const [icon, setIcon] = useState(request.initial.icon);
  const [pickingIcon, setPickingIcon] = useState(false);
  const trimmed = name.trim();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) finish(null);
      }}
    >
      <DialogPopup className="sm:max-w-sm">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (trimmed.length > 0) finish({ name: trimmed, color, icon });
          }}
        >
          <DialogHeader>
            <DialogTitle>{request.title}</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <Input
              nativeInput
              autoFocus
              aria-label="Group name"
              placeholder="Group name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <div>
              <div className="mb-2 text-xs font-medium text-muted-foreground">Color</div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Group color">
                {PROJECT_ICON_COLORS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-label={option.label}
                    aria-pressed={color === option.value}
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full border border-transparent outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      color === option.value && "border-foreground/64",
                    )}
                    onClick={() => setColor(color === option.value ? null : option.value)}
                  >
                    <span className={cn("size-4 rounded-full", option.swatchClassName)} />
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPickingIcon(true)}
              >
                <span className={cn("flex items-center", threadGroupColorClassName({ color }))}>
                  <ThreadGroupIcon group={{ color, icon }} />
                </span>
                {icon ? "Change icon" : "Add icon"}
              </Button>
              {icon ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setIcon(null)}>
                  Remove icon
                </Button>
              ) : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => finish(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={trimmed.length === 0}>
              {request.submitLabel}
            </Button>
          </DialogFooter>
        </form>
        <ProjectIconPickerDialog
          current={icon && color && icon.kind !== "emoji" ? { ...icon, color } : icon}
          projectName={trimmed || "Group"}
          open={pickingIcon}
          onOpenChange={setPickingIcon}
          onSelect={(next) => {
            setIcon(next);
            if (next.kind !== "emoji") setColor(next.color);
          }}
        />
      </DialogPopup>
    </Dialog>
  );
}
