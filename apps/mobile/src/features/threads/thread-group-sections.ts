import {
  splitThreadsByGroup,
  type ThreadGroupsByEnvironment,
} from "@t3tools/client-runtime/thread-groups";
import type { ThreadGroup } from "@t3tools/contracts";

import { scopedThreadKey } from "../../lib/scopedEntities";
import type { ThreadListV2ListItem, ThreadListV2ThreadListItem } from "./threadListV2";

const isShelfHeader = (item: ThreadListV2ListItem) =>
  item.type === "v2-working-shelf" ||
  item.type === "v2-snoozed-shelf" ||
  item.type === "v2-settled-shelf";

/**
 * Moves unpinned active threads into group sections placed before the first shelf, like the
 * desktop sidebar. A collapsed group keeps only the selected thread visible.
 */
export function withThreadGroupSections(input: {
  readonly items: ThreadListV2ListItem[];
  readonly byEnvironment: ThreadGroupsByEnvironment;
  readonly groups: ReadonlyArray<ThreadGroup>;
  readonly collapsedGroupIds: ReadonlyArray<string>;
  readonly selectedThreadKey: string | null;
  readonly includeEmptyGroups: boolean;
  readonly searching: boolean;
}): ThreadListV2ListItem[] {
  if (input.searching || input.groups.length === 0) return input.items;
  const shelfIndex = input.items.findIndex(isShelfHeader);
  const activeEnd = shelfIndex === -1 ? input.items.length : shelfIndex;
  const head = input.items.slice(0, activeEnd);
  const candidates = head.filter(
    (item): item is ThreadListV2ThreadListItem => item.type === "v2-thread" && !item.item.pinned,
  );
  const itemByThread = new Map(candidates.map((item) => [item.item.thread, item]));
  const { groups } = splitThreadsByGroup(
    [...itemByThread.keys()],
    input.byEnvironment,
    input.groups,
  );
  const grouped = new Set<ThreadListV2ListItem>();
  const sections: ThreadListV2ListItem[] = [];
  for (const { group, threads } of groups) {
    if (threads.length === 0 && !input.includeEmptyGroups) continue;
    const expanded = !input.collapsedGroupIds.includes(group.id);
    sections.push({
      type: "v2-thread-group",
      key: `v2-thread-group:${group.id}`,
      group,
      count: threads.length,
      expanded,
    });
    for (const thread of threads) {
      const item = itemByThread.get(thread)!;
      grouped.add(item);
      if (
        expanded ||
        scopedThreadKey(thread.environmentId, thread.id) === input.selectedThreadKey
      ) {
        sections.push(
          item.canMoveUp || item.canMoveDown
            ? { ...item, canMoveUp: false, canMoveDown: false }
            : item,
        );
      }
    }
  }
  if (sections.length === 0) return input.items;
  const result = [
    ...head.filter((item) => !grouped.has(item)),
    ...sections,
    ...input.items.slice(activeEnd),
  ];
  return result.map((entry, index) => {
    if (entry.type !== "v2-thread" && entry.type !== "v2-pending") return entry;
    const next = result[index + 1];
    const showTrailingDivider =
      next?.type === "v2-thread" || (next?.type === "v2-pending" && !next.showPendingDivider);
    return showTrailingDivider === entry.showTrailingDivider
      ? entry
      : { ...entry, showTrailingDivider };
  });
}
