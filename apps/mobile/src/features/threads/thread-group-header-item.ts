import type { ThreadGroup } from "@t3tools/contracts";

export type ThreadGroupHeaderStatus =
  | "approval"
  | "input"
  | "request"
  | "failed"
  | "working"
  | "done";

export interface ThreadGroupHeaderStatusCount {
  readonly status: ThreadGroupHeaderStatus;
  readonly count: number;
}

export interface ThreadListV2GroupListItem {
  readonly type: "v2-thread-group";
  readonly key: string;
  readonly group: ThreadGroup;
  readonly count: number;
  readonly expanded: boolean;
  /** Per-status counts while collapsed; empty when open. */
  readonly statuses: ReadonlyArray<ThreadGroupHeaderStatusCount>;
}

function statusesAreEqual(
  previous: ReadonlyArray<ThreadGroupHeaderStatusCount>,
  statuses: ReadonlyArray<ThreadGroupHeaderStatusCount>,
): boolean {
  return (
    previous.length === statuses.length &&
    previous.every((entry, index) => {
      const next = statuses[index];
      return next !== undefined && entry.status === next.status && entry.count === next.count;
    })
  );
}

export function threadGroupListItemsAreEqual(
  previous: ThreadListV2GroupListItem,
  item: ThreadListV2GroupListItem,
): boolean {
  return (
    previous.key === item.key &&
    previous.count === item.count &&
    previous.expanded === item.expanded &&
    statusesAreEqual(previous.statuses, item.statuses) &&
    previous.group.name === item.group.name &&
    previous.group.color === item.group.color &&
    previous.group.gradient?.from === item.group.gradient?.from &&
    previous.group.gradient?.to === item.group.gradient?.to &&
    previous.group.textColor === item.group.textColor &&
    JSON.stringify(previous.group.icon ?? null) === JSON.stringify(item.group.icon ?? null)
  );
}
