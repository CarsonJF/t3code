import type { TotFaceState } from "@t3tools/contracts";

export interface TotStatePresentation {
  /** A Tot at a glance: "Needs you" has to read from arm's length. */
  readonly textClassName: string;
  readonly pillClassName: string;
  /** Uses the Tot's own accent for the words, for the state it spends the most time in. */
  readonly accentText: boolean;
  readonly urgent: boolean;
  /** The card's border, so an urgent Tot is not just a coloured word. */
  readonly cardClassName: string;
}

/** One look for a Tot's state across its card and its thread band. */
export const TOT_STATE_PRESENTATION: Record<TotFaceState, TotStatePresentation> = {
  idle: {
    textClassName: "text-foreground-muted",
    pillClassName: "bg-subtle",
    accentText: false,
    urgent: false,
    cardClassName: "border-separator",
  },
  working: {
    textClassName: "",
    pillClassName: "bg-subtle",
    accentText: true,
    urgent: false,
    cardClassName: "border-separator",
  },
  "needs-you": {
    textClassName: "text-warning-foreground",
    pillClassName: "border border-warning-border bg-warning",
    accentText: false,
    urgent: true,
    cardClassName: "border-warning-border",
  },
  success: {
    textClassName: "text-adaptive-emerald-700-300",
    pillClassName: "bg-subtle",
    accentText: false,
    urgent: false,
    cardClassName: "border-separator",
  },
  failure: {
    textClassName: "text-danger-foreground",
    pillClassName: "border border-danger-border bg-danger",
    accentText: false,
    urgent: true,
    cardClassName: "border-danger-border",
  },
  sleep: {
    textClassName: "text-foreground-tertiary",
    pillClassName: "bg-subtle",
    accentText: false,
    urgent: false,
    cardClassName: "border-separator",
  },
};
