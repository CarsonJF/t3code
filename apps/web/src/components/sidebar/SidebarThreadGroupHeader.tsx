import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import type { MouseEvent } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { readLocalApi } from "../../localApi";
import { threadGroupActions, type ThreadGroup } from "../../threadGroupsStore";
import { requestThreadGroupName } from "../ThreadGroupNameDialog";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";

async function openThreadGroupMenu(group: ThreadGroup, position: { x: number; y: number }) {
  const api = readLocalApi();
  if (!api) return;
  const clicked = await settlePromise(() =>
    api.contextMenu.show(
      [
        { id: "rename" as const, label: "Rename group", icon: "pencil" },
        { id: "delete" as const, label: "Delete group", icon: "trash", destructive: true },
      ],
      position,
    ),
  );
  if (clicked._tag === "Failure") return;
  if (clicked.value === "rename") {
    const name = await requestThreadGroupName({
      title: "Rename group",
      submitLabel: "Rename",
      initialName: group.name,
    });
    if (name !== null) threadGroupActions.rename(group.id, name);
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
  const redesign = useClientSettings((s) => s.redesignEnabled);
  const collapsedCount = props.expanded ? null : props.count;
  const count = redesign ? props.count : collapsedCount;
  return (
    <li
      data-thread-selection-safe
      data-testid="sidebar-thread-group-header"
      className="relative mx-0.5 h-8 list-none"
      onContextMenu={(event: MouseEvent) => {
        event.preventDefault();
        void openThreadGroupMenu(props.group, { x: event.clientX, y: event.clientY });
      }}
    >
      <CollapsibleSectionHeader
        onClick={() => threadGroupActions.toggleCollapsed(props.group.id)}
        expanded={props.expanded}
        tone="muted"
        accessory={
          redesign && count !== null ? (
            <span className="font-normal tabular-nums">{count}</span>
          ) : null
        }
      >
        {props.group.name}
        {!redesign && collapsedCount !== null ? ` (${collapsedCount})` : null}
      </CollapsibleSectionHeader>
    </li>
  );
}
