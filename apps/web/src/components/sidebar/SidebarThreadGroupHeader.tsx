import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { useState, type DragEvent, type MouseEvent } from "react";

import { readLocalApi } from "../../localApi";
import {
  readThreadGroupsView,
  threadGroupActions,
  type ThreadGroup,
} from "../../threadGroupsStore";
import { cn } from "../../lib/utils";
import {
  ThreadGroupIcon,
  threadGroupColorClassName,
  threadGroupGradientStyle,
} from "../ThreadGroupIcon";
import { requestThreadGroupDetails } from "../ThreadGroupNameDialog";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";

const DRAG_TYPE = "application/x-t3-thread-group";

async function openThreadGroupMenu(group: ThreadGroup, position: { x: number; y: number }) {
  const api = readLocalApi();
  if (!api) return;
  const groupIds = readThreadGroupsView().groups.map((candidate) => candidate.id);
  const index = groupIds.indexOf(group.id);
  const previousId = groupIds[index - 1];
  const nextId = groupIds[index + 1];
  const clicked = await settlePromise(() =>
    api.contextMenu.show(
      [
        { id: "edit" as const, label: "Edit group", icon: "pencil" },
        ...(previousId === undefined
          ? []
          : [{ id: "move-up" as const, label: "Move up", icon: "arrow.up" }]),
        ...(nextId === undefined
          ? []
          : [{ id: "move-down" as const, label: "Move down", icon: "arrow.down" }]),
        { id: "delete" as const, label: "Delete group", icon: "trash", destructive: true },
      ],
      position,
    ),
  );
  if (clicked._tag === "Failure") return;
  if (clicked.value === "edit") {
    const details = await requestThreadGroupDetails({
      title: "Edit group",
      submitLabel: "Save",
      initial: {
        name: group.name,
        color: group.color ?? null,
        gradient: group.gradient ?? null,
        icon: group.icon ?? null,
      },
    });
    if (details !== null) threadGroupActions.update(group.id, details);
  } else if (clicked.value === "move-up" && previousId !== undefined) {
    threadGroupActions.move(group.id, previousId, "before");
  } else if (clicked.value === "move-down" && nextId !== undefined) {
    threadGroupActions.move(group.id, nextId, "after");
  } else if (clicked.value === "delete") {
    const confirmed = await settlePromise(() =>
      api.dialogs.confirm(
        [
          `Delete group "${group.name}"?`,
          "Its threads and projects stay; they become ungrouped.",
        ].join("\n"),
        { variant: "destructive" },
      ),
    );
    if (confirmed._tag === "Failure" || !confirmed.value) return;
    threadGroupActions.delete(group.id);
  }
}

export function SidebarThreadGroupHeader(props: {
  group: ThreadGroup;
  count: number;
  expanded: boolean;
}) {
  const colorClassName = threadGroupColorClassName(props.group);
  const gradientStyle = threadGroupGradientStyle(props.group);
  const [dropEdge, setDropEdge] = useState<"before" | "after" | null>(null);
  const edgeOf = (event: DragEvent<HTMLLIElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  };
  return (
    <li
      data-thread-selection-safe
      data-testid="sidebar-thread-group-header"
      draggable
      className={cn(
        "relative mx-0.5 h-8 list-none",
        colorClassName,
        dropEdge === "before" &&
          "before:absolute before:inset-x-0 before:-top-px before:h-0.5 before:rounded-full before:bg-ring",
        dropEdge === "after" &&
          "after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-ring",
      )}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(DRAG_TYPE, props.group.id);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropEdge(edgeOf(event));
      }}
      onDragLeave={() => setDropEdge(null)}
      onDrop={(event) => {
        setDropEdge(null);
        const draggedId = event.dataTransfer.getData(DRAG_TYPE);
        if (draggedId === "") return;
        event.preventDefault();
        threadGroupActions.move(draggedId, props.group.id, edgeOf(event));
      }}
      onContextMenu={(event: MouseEvent) => {
        event.preventDefault();
        void openThreadGroupMenu(props.group, { x: event.clientX, y: event.clientY });
      }}
    >
      {colorClassName ? (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 rounded-md",
            !gradientStyle && "bg-current/10",
          )}
          style={gradientStyle}
        />
      ) : null}
      <CollapsibleSectionHeader
        onClick={() => threadGroupActions.toggleCollapsed(props.group.id)}
        expanded={props.expanded}
        tone="muted"
        accessory={<span className="font-normal tabular-nums">{props.count}</span>}
      >
        <span className={cn("flex items-center gap-1.5", colorClassName)}>
          <ThreadGroupIcon group={props.group} />
          {props.group.name}
        </span>
      </CollapsibleSectionHeader>
    </li>
  );
}
