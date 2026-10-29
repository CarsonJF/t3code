import type { ThreadGroup } from "@t3tools/contracts";

export interface ThreadListV2GroupListItem {
  readonly type: "v2-thread-group";
  readonly key: string;
  readonly group: ThreadGroup;
  readonly count: number;
  readonly expanded: boolean;
}

export function threadGroupListItemsAreEqual(
  previous: ThreadListV2GroupListItem,
  item: ThreadListV2GroupListItem,
): boolean {
  return (
    previous.key === item.key &&
    previous.count === item.count &&
    previous.expanded === item.expanded &&
    previous.group.name === item.group.name &&
    previous.group.color === item.group.color &&
    previous.group.gradient?.from === item.group.gradient?.from &&
    previous.group.gradient?.to === item.group.gradient?.to &&
    previous.group.textColor === item.group.textColor &&
    JSON.stringify(previous.group.icon ?? null) === JSON.stringify(item.group.icon ?? null)
  );
}
