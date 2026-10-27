import { describe, expect, it } from "vite-plus/test";

import {
  createThreadGroup,
  deleteThreadGroup,
  EMPTY_THREAD_GROUPS_STATE,
  readPersistedThreadGroups,
  resolveThreadGroupId,
  setProjectDefaultGroup,
  setThreadGroup,
  threadGroupActions,
  useThreadGroupsStore,
} from "./threadGroupsStore";

const PROJECT = "env-1:project-1";

function thread(threadKey: string, createdAt: string) {
  return { threadKey, projectKey: PROJECT, createdAt };
}

function withGroups(...names: string[]) {
  return names.reduce(
    (state, name) => createThreadGroup(state, { id: name, name }),
    EMPTY_THREAD_GROUPS_STATE,
  );
}

describe("resolveThreadGroupId", () => {
  it("puts threads created after a project default into that group", () => {
    const state = setProjectDefaultGroup(
      withGroups("xn"),
      [PROJECT],
      "xn",
      "2026-10-26T10:00:00.000Z",
    );

    expect(resolveThreadGroupId(state, thread("new", "2026-10-26T11:00:00.000Z"))).toBe("xn");
    expect(resolveThreadGroupId(state, thread("old", "2026-10-26T09:00:00.000Z"))).toBeNull();
  });

  it("changing a project default only affects threads created afterwards", () => {
    const first = setProjectDefaultGroup(
      withGroups("xn", "other"),
      [PROJECT],
      "xn",
      "2026-10-26T10:00:00.000Z",
    );
    const changed = setProjectDefaultGroup(first, [PROJECT], "other", "2026-10-26T12:00:00.000Z");

    expect(resolveThreadGroupId(changed, thread("before", "2026-10-26T11:00:00.000Z"))).toBe("xn");
    expect(resolveThreadGroupId(changed, thread("after", "2026-10-26T13:00:00.000Z"))).toBe(
      "other",
    );
  });

  it("lets a thread override its project default, including opting out of every group", () => {
    const defaulted = setProjectDefaultGroup(
      withGroups("xn", "other"),
      [PROJECT],
      "xn",
      "2026-10-26T10:00:00.000Z",
    );
    const moved = setThreadGroup(defaulted, "a", "other");
    const ungrouped = setThreadGroup(moved, "b", null);

    expect(resolveThreadGroupId(ungrouped, thread("a", "2026-10-26T11:00:00.000Z"))).toBe("other");
    expect(resolveThreadGroupId(ungrouped, thread("b", "2026-10-26T11:00:00.000Z"))).toBeNull();
    expect(resolveThreadGroupId(ungrouped, thread("c", "2026-10-26T11:00:00.000Z"))).toBe("xn");
  });

  it("ungroups every member of a deleted group without restoring older defaults", () => {
    const state = setThreadGroup(
      setProjectDefaultGroup(
        setProjectDefaultGroup(withGroups("xn", "other"), [PROJECT], "xn", "2026-10-26T10:00:00Z"),
        [PROJECT],
        "other",
        "2026-10-26T12:00:00.000Z",
      ),
      "moved",
      "other",
    );
    const deleted = deleteThreadGroup({ ...state, collapsed: { other: true } }, "other");

    expect(deleted.groups.map((group) => group.id)).toEqual(["xn"]);
    expect(deleted.collapsed).toEqual({});
    expect(resolveThreadGroupId(deleted, thread("moved", "2026-10-26T11:00:00.000Z"))).toBeNull();
    expect(resolveThreadGroupId(deleted, thread("later", "2026-10-26T13:00:00.000Z"))).toBeNull();
    expect(resolveThreadGroupId(deleted, thread("earlier", "2026-10-26T11:00:00.000Z"))).toBe("xn");
  });
});

describe("threadGroupActions", () => {
  it("persists groups and collapsed state so they survive a reload", () => {
    useThreadGroupsStore.setState(EMPTY_THREAD_GROUPS_STATE, true);
    const groupId = threadGroupActions.create("xnproductions");
    threadGroupActions.setProjectDefault([PROJECT], groupId);
    threadGroupActions.setThreadGroup("env-1:thread-1", null);
    threadGroupActions.toggleCollapsed(groupId);

    const reloaded = readPersistedThreadGroups();

    expect(reloaded).toEqual(useThreadGroupsStore.getState());
    expect(reloaded.collapsed[groupId]).toBe(true);
    expect(reloaded.groups).toEqual([{ id: groupId, name: "xnproductions" }]);
  });

  it("persists a group's color and icon, and clears them on edit", () => {
    useThreadGroupsStore.setState(EMPTY_THREAD_GROUPS_STATE, true);
    const icon = { kind: "lucide", name: "rocket", color: "violet" } as const;
    const groupId = threadGroupActions.create({ name: "xn", color: "violet", icon });

    expect(readPersistedThreadGroups().groups).toEqual([
      { id: groupId, name: "xn", color: "violet", icon },
    ]);

    threadGroupActions.update(groupId, { name: "XN", color: null, icon: null });

    expect(readPersistedThreadGroups().groups).toEqual([
      { id: groupId, name: "XN", color: null, icon: null },
    ]);
  });
});
