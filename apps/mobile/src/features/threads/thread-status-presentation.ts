import { msg } from "gt-react-native";

import type { AppSymbolName } from "../../components/ui/AppSymbol";
import type { ThreadListV2Status } from "./threadListV2";

export interface ThreadStatusPresentation {
  // Null when the icon and timer carry the status on their own.
  readonly label: string | null;
  readonly icon: AppSymbolName;
  readonly className: string;
  readonly iconTintClassName: string;
}

export const THREAD_STATUS_PRESENTATION: Record<
  Exclude<ThreadListV2Status, "ready">,
  ThreadStatusPresentation
> = {
  approval: {
    label: msg("Approval", { $context: "thread status, waiting for approval" }),
    icon: "exclamationmark.shield",
    className: "text-warning-foreground",
    iconTintClassName: "accent-warning-foreground",
  },
  input: {
    label: msg("Input", { $context: "thread status, waiting for user input" }),
    icon: "questionmark.bubble",
    className: "text-adaptive-indigo-600-300",
    iconTintClassName: "accent-adaptive-indigo-600-300",
  },
  request: {
    label: msg("Request", { $context: "thread status, a guest request is waiting" }),
    icon: "person.crop.circle",
    className: "text-adaptive-fuchsia-600-300",
    iconTintClassName: "accent-adaptive-fuchsia-600-300",
  },
  working: {
    label: null,
    icon: "circle.dashed",
    className: "text-adaptive-sky-600-400",
    iconTintClassName: "accent-adaptive-sky-600-400",
  },
  waiting: {
    label: null,
    icon: "circle.dashed.inset.filled",
    className: "text-foreground-muted",
    iconTintClassName: "accent-foreground-muted",
  },
  failed: {
    label: msg("Failed", { $context: "thread status" }),
    icon: "exclamationmark.circle",
    className: "text-danger-foreground",
    iconTintClassName: "accent-danger-foreground",
  },
  limited: {
    label: msg("Limited", { $context: "thread status, usage limit reached" }),
    icon: "exclamationmark.circle",
    className: "text-warning-foreground",
    iconTintClassName: "accent-warning-foreground",
  },
};

export const DONE_STATUS_PRESENTATION: ThreadStatusPresentation = {
  label: msg("Done", { $context: "thread status, turn finished" }),
  icon: "checkmark.circle",
  className: "text-adaptive-emerald-700-300",
  iconTintClassName: "accent-adaptive-emerald-700-300",
};
