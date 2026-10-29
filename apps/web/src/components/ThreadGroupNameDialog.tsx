import type { ProjectColor } from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { create } from "zustand";

import { projectIconColorStyle } from "../projectIconColors";
import { newThreadGroup, type ThreadGroup, type ThreadGroupDetails } from "../threadGroupsStore";
import { cn } from "~/lib/utils";
import { ProjectIconPickerDialog } from "./settings/ProjectIconPickerDialog";
import {
  ThreadGroupIcon,
  threadGroupColorClassName,
  threadGroupGradientStyle,
} from "./ThreadGroupIcon";
import { Button } from "./ui/button";
import { ColorPicker } from "./ColorPicker";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Toggle, ToggleGroup } from "./ui/toggle-group";

const DEFAULT_GRADIENT_END: ProjectColor = "purple";

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
    initial: { name: "", color: null, gradient: null, textColor: null, icon: null },
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
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- settles a pending prompt if the host unmounts
  useEffect(() => () => finish(null), []);
  return request ? <ThreadGroupNameDialog request={request} /> : null;
}

function ThreadGroupNameDialog({ request }: { request: Request }) {
  const [name, setName] = useState(request.initial.name);
  const [color, setColor] = useState(request.initial.color);
  const [gradientTo, setGradientTo] = useState(request.initial.gradient?.to ?? null);
  const [textColor, setTextColor] = useState(request.initial.textColor);
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
            if (trimmed.length > 0) {
              finish({
                name: trimmed,
                color,
                gradient: color && gradientTo ? { from: color, to: gradientTo } : null,
                textColor,
                icon,
              });
            }
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
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-muted-foreground">Color</div>
                <ToggleGroup
                  aria-label="Color style"
                  variant="segmented"
                  value={[gradientTo ? "gradient" : "solid"]}
                  onValueChange={(next) => {
                    if (next[0] === "gradient") {
                      setColor(color ?? "blue");
                      setGradientTo(gradientTo ?? DEFAULT_GRADIENT_END);
                    } else if (next[0] === "solid") {
                      setGradientTo(null);
                    }
                  }}
                >
                  <Toggle value="solid">Solid</Toggle>
                  <Toggle value="gradient">Gradient</Toggle>
                </ToggleGroup>
              </div>
              <ColorPicker
                label={gradientTo ? "Gradient start color" : "Group color"}
                value={color}
                onChange={(next) => setColor(next === color && !gradientTo ? null : next)}
              />
              {gradientTo ? (
                <>
                  <ColorPicker
                    label="Gradient end color"
                    value={gradientTo}
                    onChange={setGradientTo}
                  />
                  <div
                    aria-hidden="true"
                    className="h-2 rounded-full"
                    style={threadGroupGradientStyle({
                      gradient: { from: color ?? "blue", to: gradientTo },
                    })}
                  />
                </>
              ) : null}
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-muted-foreground">Text color</div>
                <Toggle
                  variant="outline"
                  size="xs"
                  aria-label="Automatic text color"
                  pressed={textColor === null}
                  onPressedChange={(pressed) => setTextColor(pressed ? null : "gray")}
                >
                  Automatic
                </Toggle>
              </div>
              {textColor === null ? null : (
                <ColorPicker label="Text color" value={textColor} onChange={setTextColor} />
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPickingIcon(true)}
              >
                <span
                  className={cn("flex items-center", threadGroupColorClassName({ color }))}
                  style={projectIconColorStyle(color)}
                >
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
          current={
            icon && color && (icon.kind === "lucide" || icon.kind === "monogram")
              ? { ...icon, color }
              : icon
          }
          projectName={trimmed || "Group"}
          open={pickingIcon}
          onOpenChange={setPickingIcon}
          onSelect={(next) => {
            setIcon(next);
            if (next.kind === "lucide" || next.kind === "monogram") setColor(next.color);
          }}
        />
      </DialogPopup>
    </Dialog>
  );
}
