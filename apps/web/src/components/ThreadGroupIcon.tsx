import { FolderCodeIcon } from "lucide-react";
import { createElement, lazy, Suspense } from "react";

import { projectIconColorClassName } from "../projectIconColors";
import type { ThreadGroup } from "../threadGroupsStore";
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

/** The group's icon, or a color dot when it only has a color. */
export function ThreadGroupIcon({ group }: { group: Pick<ThreadGroup, "color" | "icon"> }) {
  const { icon } = group;
  const colorClassName = threadGroupColorClassName(group);
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
  if (icon?.kind === "monogram") {
    return (
      <ProjectMonogram text={icon.text} color={group.color ?? icon.color} className="size-3.5" />
    );
  }
  if (icon?.kind === "lucide") {
    const className = cn("size-3.5", colorClassName ?? projectIconColorClassName(icon.color));
    return (
      <span
        aria-hidden="true"
        className="inline-flex size-3.5 shrink-0 items-center justify-center"
      >
        <Suspense fallback={<FolderCodeIcon className={className} />}>
          <LucideGroupIcon name={icon.name} className={className} />
        </Suspense>
      </span>
    );
  }
  if (colorClassName) {
    return (
      <span
        aria-hidden="true"
        className="inline-flex size-3.5 shrink-0 items-center justify-center"
      >
        <span className="size-2 rounded-full bg-current" />
      </span>
    );
  }
  return null;
}
