import { EnvironmentId, ThreadId, type ThreadGroupsState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { scopedThreadKey } from "../../lib/scopedEntities";
import { makeThreadShellFixture } from "../../test-fixtures";
import { withThreadGroupSections } from "./thread-group-sections";
import type { ThreadListV2ListItem } from "./threadListV2";

const environmentId = EnvironmentId.make("environment-1");

function threadItem(id: string, options: { pinned?: boolean } = {}): ThreadListV2ListItem {
  const thread = makeThreadShellFixture({ environmentId, id: ThreadId.make(id), title: id });
  return {
    type: "v2-thread",
    key: `v2-thread:${environmentId}:${id}`,
    item: {
      thread,
      variant: "card",
      snoozed: false,
      pinned: options.pinned === true,
      wokeAt: null,
      isLast: false,
    },
    snoozeWakeLabelText: undefined,
    timeLabel: "",
    snoozePresetMinute: undefined,
    showTrailingDivider: false,
    hasQueuedMessages: false,
    canMoveUp: true,
    canMoveDown: true,
  };
}

const settledShelf: ThreadListV2ListItem = {
  type: "v2-settled-shelf",
  key: "v2-settled-shelf",
  count: 1,
  expanded: true,
  disabled: false,
};

const state: ThreadGroupsState = {
  groups: [
    { id: "work", name: "Work" },
    { id: "empty", name: "Empty" },
  ],
  projectDefaults: {},
  threadOverrides: {
    [ThreadId.make("a")]: "work",
    [ThreadId.make("c")]: "work",
    [ThreadId.make("pinned")]: "work",
    [ThreadId.make("settled")]: "work",
  },
};

function build(overrides: Partial<Parameters<typeof withThreadGroupSections>[0]> = {}) {
  const items = [
    threadItem("pinned", { pinned: true }),
    threadItem("a"),
    threadItem("b"),
    threadItem("c"),
    settledShelf,
    threadItem("settled"),
  ];
  return withThreadGroupSections({
    items,
    byEnvironment: new Map([[environmentId, state]]),
    groups: state.groups,
    collapsedGroupIds: [],
    selectedThreadKey: null,
    includeEmptyGroups: false,
    searching: false,
    ...overrides,
  });
}

const keys = (items: ReadonlyArray<ThreadListV2ListItem>) => items.map((item) => item.key);

describe("withThreadGroupSections", () => {
  it("moves unpinned active threads into group sections before the first shelf", () => {
    const items = build();
    expect(keys(items)).toEqual([
      "v2-thread:environment-1:pinned",
      "v2-thread:environment-1:b",
      "v2-thread-group:work",
      "v2-thread:environment-1:a",
      "v2-thread:environment-1:c",
      "v2-settled-shelf",
      "v2-thread:environment-1:settled",
    ]);
    const header = items[2];
    expect(header?.type === "v2-thread-group" && header.count).toBe(2);
  });

  it("disables reordering for grouped threads and recomputes dividers", () => {
    const items = build();
    const byKey = new Map(items.map((item) => [item.key, item]));
    const grouped = byKey.get("v2-thread:environment-1:a");
    const ungrouped = byKey.get("v2-thread:environment-1:b");
    expect(grouped?.type === "v2-thread" && [grouped.canMoveUp, grouped.canMoveDown]).toEqual([
      false,
      false,
    ]);
    expect(ungrouped?.type === "v2-thread" && ungrouped.canMoveUp).toBe(true);
    expect(ungrouped?.type === "v2-thread" && ungrouped.showTrailingDivider).toBe(false);
    expect(grouped?.type === "v2-thread" && grouped.showTrailingDivider).toBe(true);
  });

  it("keeps only the selected thread of a collapsed group", () => {
    const collapsed = build({ collapsedGroupIds: ["work"] });
    expect(keys(collapsed)).toEqual([
      "v2-thread:environment-1:pinned",
      "v2-thread:environment-1:b",
      "v2-thread-group:work",
      "v2-settled-shelf",
      "v2-thread:environment-1:settled",
    ]);
    const selected = build({
      collapsedGroupIds: ["work"],
      selectedThreadKey: scopedThreadKey(environmentId, ThreadId.make("c")),
    });
    expect(keys(selected)).toContain("v2-thread:environment-1:c");
    expect(keys(selected)).not.toContain("v2-thread:environment-1:a");
    const header = selected.find((item) => item.type === "v2-thread-group");
    expect(header?.type === "v2-thread-group" && [header.expanded, header.count]).toEqual([
      false,
      2,
    ]);
  });

  it("shows empty groups only when asked", () => {
    expect(keys(build())).not.toContain("v2-thread-group:empty");
    expect(keys(build({ includeEmptyGroups: true }))).toContain("v2-thread-group:empty");
  });

  it("leaves the list untouched while searching or without groups", () => {
    const items = [threadItem("a")];
    const input = {
      items,
      byEnvironment: new Map([[environmentId, state]]),
      collapsedGroupIds: [],
      selectedThreadKey: null,
      includeEmptyGroups: true,
    };
    expect(withThreadGroupSections({ ...input, groups: state.groups, searching: true })).toBe(
      items,
    );
    expect(withThreadGroupSections({ ...input, groups: [], searching: false })).toBe(items);
  });
});
