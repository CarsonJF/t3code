import { gradientWashStop } from "@t3tools/client-runtime/thread-groups";
import { FolderCodeIcon } from "lucide-react";
import { createElement, lazy, Suspense, type CSSProperties } from "react";

import { projectIconColorClassName, projectIconColorStyle } from "../projectIconColors";
import type { ProjectColor, ThreadGroup } from "@t3tools/contracts";
import { cn } from "~/lib/utils";
import { ProjectMonogram } from "./ProjectMonogram";

const LucideGroupIcon = lazy(() =>
  import("../lib/lucideIconByName").then(({ lucideIconByName }) => ({
    default: function LucideGroupIcon(props: { name: string; className: string }) {
      return createElement(lucideIconByName(props.name) ?? FolderCodeIcon, {
        className: props.className,
      });
    },
  })),
);

export function threadGroupColorClassName(group: Pick<ThreadGroup, "color">): string | null {
  return group.color ? projectIconColorClassName(group.color) : null;
}

/** A left-to-right wash of the gradient's two colors, as a header background. */
export function threadGroupGradientStyle(
  group: Pick<ThreadGroup, "gradient">,
): CSSProperties | undefined {
  const { gradient } = group;
  if (!gradient) return undefined;
  const stop = (color: ProjectColor) => {
    const { hex, alpha } = gradientWashStop(color);
    return `color-mix(in oklch, ${hex} ${Math.round(alpha * 100)}%, transparent)`;
  };
  return {
    backgroundImage: `linear-gradient(90deg in oklch, ${stop(gradient.from)}, ${stop(gradient.to)})`,
  };
}

/** The group's icon, or a color dot when it only has a color. */
export function ThreadGroupIcon({ group }: { group: Pick<ThreadGroup, "color" | "icon"> }) {
  const { icon } = group;
  if (icon?.kind === "emoji") {
    return (
      <span
        aria-hidden="true"
        className="inline-flex size-3.5 shrink-0 items-center justify-center"
      >
        <span className="text-xs leading-none">{icon.emoji}</span>
      </span>
    );
  }
  if (icon?.kind === "image") {
    return <img src={icon.dataUrl} alt="" className="size-3.5 shrink-0 object-contain" />;
  }
  if (icon?.kind === "monogram") {
    return (
      <ProjectMonogram text={icon.text} color={group.color ?? icon.color} className="size-3.5" />
    );
  }
  if (icon?.kind === "lucide") {
    const color = group.color ?? icon.color;
    const className = cn("size-3.5", projectIconColorClassName(color));
    return (
      <span
        aria-hidden="true"
        className="inline-flex size-3.5 shrink-0 items-center justify-center"
        style={projectIconColorStyle(color)}
      >
        <Suspense fallback={<FolderCodeIcon className={className} />}>
          <LucideGroupIcon name={icon.name} className={className} />
        </Suspense>
      </span>
    );
  }
  if (group.color) {
    return (
      <span
        aria-hidden="true"
        className="inline-flex size-3.5 shrink-0 items-center justify-center"
        style={projectIconColorStyle(group.color)}
      >
        <span className="size-2 rounded-full bg-current" />
      </span>
    );
  }
  return null;
}
