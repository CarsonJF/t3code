import {
  EMPTY_THREAD_GROUPS_STATE,
  ProjectId,
  ThreadId,
  type ThreadGroupOp,
  type ThreadGroupsState,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { applyThreadGroupOps } from "./threadGroups.ts";

const PROJECT = ProjectId.make("project-1");
const THREAD = ThreadId.make("thread-1");

const create = (id: string): ThreadGroupOp => ({ type: "createGroup", group: { id, name: id } });
const withGroups = (...ids: string[]) =>
  applyThreadGroupOps(EMPTY_THREAD_GROUPS_STATE, ids.map(create));
const setDefault = (groupId: string | null, since: string): ThreadGroupOp => ({
  type: "setProjectDefault",
  projectIds: [PROJECT],
  groupId,
  since,
});

describe("applyThreadGroupOps", () => {
  it("keeps the first group when two clients create the same id", () => {
    const state = applyThreadGroupOps(withGroups("xn"), [
      { type: "createGroup", group: { id: "xn", name: "renamed" } },
    ]);

    expect(state.groups).toEqual([{ id: "xn", name: "xn" }]);
  });

  it("merges concurrent edits to different fields of a group", () => {
    const state = applyThreadGroupOps(withGroups("xn"), [
      { type: "updateGroup", groupId: "xn", name: "XN" },
      { type: "updateGroup", groupId: "xn", color: "violet" },
    ]);

    expect(state.groups).toEqual([{ id: "xn", name: "XN", color: "violet" }]);
  });

  it("drops assignments to a group another client deleted", () => {
    const state = applyThreadGroupOps(withGroups("xn"), [
      { type: "deleteGroup", groupId: "xn" },
      { type: "setThreadGroup", threadId: THREAD, groupId: "xn" },
      setDefault("xn", "2026-10-26T10:00:00.000Z"),
    ]);

    expect(state).toEqual(EMPTY_THREAD_GROUPS_STATE);
  });

  it("ungroups members of a deleted group without restoring older defaults", () => {
    const state = applyThreadGroupOps(withGroups("xn", "other"), [
      setDefault("xn", "2026-10-26T10:00:00.000Z"),
      setDefault("other", "2026-10-26T12:00:00.000Z"),
      { type: "setThreadGroup", threadId: THREAD, groupId: "other" },
      { type: "deleteGroup", groupId: "other" },
    ]);

    expect(state.projectDefaults[PROJECT]).toEqual([
      { groupId: "xn", since: "2026-10-26T10:00:00.000Z" },
      { groupId: null, since: "2026-10-26T12:00:00.000Z" },
    ]);
    expect(state.threadOverrides).toEqual({ [THREAD]: null });
  });

  it("orders project defaults by when they were set, not when they arrived", () => {
    const state = applyThreadGroupOps(withGroups("xn", "other"), [
      setDefault("other", "2026-10-26T12:00:00.000Z"),
      setDefault("xn", "2026-10-26T10:00:00.000Z"),
      setDefault("other", "2026-10-26T13:00:00.000Z"),
    ]);

    expect(state.projectDefaults[PROJECT]).toEqual([
      { groupId: "xn", since: "2026-10-26T10:00:00.000Z" },
      { groupId: "other", since: "2026-10-26T12:00:00.000Z" },
    ]);
  });

  it("imports legacy groups without overwriting what the server already has", () => {
    const server = applyThreadGroupOps(withGroups("xn"), [
      { type: "updateGroup", groupId: "xn", name: "Server name" },
      { type: "setThreadGroup", threadId: THREAD, groupId: null },
    ]);
    const legacy: ThreadGroupsState = {
      groups: [
        { id: "xn", name: "Old name" },
        { id: "phone", name: "Phone" },
      ],
      projectDefaults: {
        [PROJECT]: [{ groupId: "phone", since: "2026-10-26T10:00:00.000Z" }],
        [ProjectId.make("gone")]: [{ groupId: "missing", since: "2026-10-26T10:00:00.000Z" }],
      },
      threadOverrides: { [THREAD]: "phone", [ThreadId.make("thread-2")]: "phone" },
    };

    const state = applyThreadGroupOps(server, [{ type: "import", state: legacy }]);

    expect(state).toEqual({
      groups: [
        { id: "xn", name: "Server name" },
        { id: "phone", name: "Phone" },
      ],
      projectDefaults: {
        [PROJECT]: [{ groupId: "phone", since: "2026-10-26T10:00:00.000Z" }],
        [ProjectId.make("gone")]: [],
      },
      threadOverrides: { [THREAD]: null, [ThreadId.make("thread-2")]: "phone" },
    });
    expect(applyThreadGroupOps(state, [{ type: "import", state: legacy }])).toEqual(state);
  });
});
