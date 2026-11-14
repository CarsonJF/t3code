import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "boop-face": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        size?: string;
        color?: string;
        skin?: string;
        motion?: "auto" | "reduce" | "full";
        "auto-sleep"?: string;
        "wake-on"?: "activity" | "interaction" | "manual";
        "press-squeeze"?: string;
        "antenna-drag"?: string;
      };
    }
  }
}
