import { EnvironmentId, ProjectId, ThreadId, type ThreadGroupsState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  environmentsWithThreadGroup,
  mergeThreadGroups,
  moveThreadGroup,
  resolveThreadGroupId,
  splitThreadsByGroup,
  withThreadGroup,
} from "./threadGroups.ts";

const DESKTOP = EnvironmentId.make("desktop");
const LAPTOP = EnvironmentId.make("laptop");
const PROJECT = ProjectId.make("project-1");

const thread = (id: string, createdAt: string, environmentId = DESKTOP) => ({
  environmentId,
  id: ThreadId.make(id),
  projectId: PROJECT,
  createdAt,
});

const state: ThreadGroupsState = {
  groups: [
    { id: "xn", name: "xn" },
    { id: "other", name: "other" },
  ],
  projectDefaults: {
    [PROJECT]: [
      { groupId: "xn", since: "2026-10-26T10:00:00.000Z" },
      { groupId: "other", since: "2026-10-26T12:00:00.000Z" },
    ],
  },
  threadOverrides: {
    [ThreadId.make("moved")]: "other",
    [ThreadId.make("pinned-out")]: null,
    [ThreadId.make("stale")]: "deleted",
  },
};

describe("resolveThreadGroupId", () => {
  it("uses the project default in effect when the thread was created", () => {
    expect(resolveThreadGroupId(state, thread("early", "2026-10-26T09:00:00.000Z"))).toBeNull();
    expect(resolveThreadGroupId(state, thread("mid", "2026-10-26T11:00:00.000Z"))).toBe("xn");
    expect(resolveThreadGroupId(state, thread("late", "2026-10-26T13:00:00.000Z"))).toBe("other");
  });

  it("lets a thread override its project default, including opting out of every group", () => {
    expect(resolveThreadGroupId(state, thread("moved", "2026-10-26T11:00:00.000Z"))).toBe("other");
    expect(
      resolveThreadGroupId(state, thread("pinned-out", "2026-10-26T11:00:00.000Z")),
    ).toBeNull();
    expect(resolveThreadGroupId(state, thread("stale", "2026-10-26T11:00:00.000Z"))).toBeNull();
  });
});

describe("splitThreadsByGroup", () => {
  it("shows one section per group id across environments, resolving each thread in its own", () => {
    const laptop: ThreadGroupsState = {
      groups: [{ id: "xn", name: "xn (laptop copy)" }],
      projectDefaults: {},
      threadOverrides: { [ThreadId.make("remote")]: "xn" },
    };
    const byEnvironment = new Map([
      [DESKTOP, state],
      [LAPTOP, laptop],
    ]);
    const threads = [
      thread("mid", "2026-10-26T11:00:00.000Z"),
      thread("remote", "2026-10-26T09:00:00.000Z", LAPTOP),
      thread("mid", "2026-10-26T11:00:00.000Z", LAPTOP),
      thread("offline", "2026-10-26T11:00:00.000Z", EnvironmentId.make("offline")),
    ];

    const split = splitThreadsByGroup(threads, byEnvironment);

    expect(mergeThreadGroups(byEnvironment).map((group) => group.name)).toEqual(["xn", "other"]);
    expect(split.groups.map(({ group, threads }) => [group.id, threads])).toEqual([
      ["xn", [threads[0], threads[1]]],
      ["other", []],
    ]);
    expect(split.ungrouped).toEqual([threads[2], threads[3]]);
    expect(environmentsWithThreadGroup(byEnvironment, "xn")).toEqual([DESKTOP, LAPTOP]);
  });
});

describe("withThreadGroup", () => {
  it("creates the group first only in environments that do not have it yet", () => {
    const op = { type: "setThreadGroup", threadId: ThreadId.make("a"), groupId: "new" } as const;
    const created = { id: "new", name: "New" };

    expect(withThreadGroup(state, created, op)).toEqual([
      { type: "createGroup", group: created },
      op,
    ]);
    expect(withThreadGroup(state, state.groups[0]!, op)).toEqual([op]);
    expect(withThreadGroup(undefined, null, op)).toEqual([op]);
  });
});

describe("moveThreadGroup", () => {
  it("drops the group on the chosen edge of the target", () => {
    const ids = ["a", "b", "c", "d"];
    expect(moveThreadGroup(ids, "a", "c", "before")).toEqual(["b", "a", "c", "d"]);
    expect(moveThreadGroup(ids, "a", "c", "after")).toEqual(["b", "c", "a", "d"]);
    expect(moveThreadGroup(ids, "d", "a", "before")).toEqual(["d", "a", "b", "c"]);
    expect(moveThreadGroup(ids, "b", "b", "after")).toEqual(ids);
    expect(moveThreadGroup(ids, "x", "a", "after")).toEqual(ids);
  });
});
