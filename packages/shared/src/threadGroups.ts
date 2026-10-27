import type {
  ThreadGroupOp,
  ThreadGroupProjectDefault,
  ThreadGroupsState,
} from "@t3tools/contracts";

const hasGroup = (state: ThreadGroupsState, groupId: string | null) =>
  groupId === null || state.groups.some((group) => group.id === groupId);

const insertBySince = (
  entries: ReadonlyArray<ThreadGroupProjectDefault>,
  entry: ThreadGroupProjectDefault,
) => {
  const sinceMs = Date.parse(entry.since);
  const index = entries.findLastIndex((existing) => Date.parse(existing.since) <= sinceMs);
  const next = [...entries];
  next.splice(index + 1, 0, entry);
  return next;
};

function applyThreadGroupOp(state: ThreadGroupsState, op: ThreadGroupOp): ThreadGroupsState {
  switch (op.type) {
    case "createGroup":
      return hasGroup(state, op.group.id)
        ? state
        : { ...state, groups: [...state.groups, op.group] };
    case "updateGroup": {
      const { type: _type, groupId, ...fields } = op;
      return {
        ...state,
        groups: state.groups.map((group) =>
          group.id === groupId ? { ...group, ...fields } : group,
        ),
      };
    }
    case "deleteGroup":
      if (!hasGroup(state, op.groupId)) return state;
      return {
        groups: state.groups.filter((group) => group.id !== op.groupId),
        projectDefaults: Object.fromEntries(
          Object.entries(state.projectDefaults).map(([projectId, entries]) => [
            projectId,
            entries.map((entry) =>
              entry.groupId === op.groupId ? { ...entry, groupId: null } : entry,
            ),
          ]),
        ),
        threadOverrides: Object.fromEntries(
          Object.entries(state.threadOverrides).map(([threadId, groupId]) => [
            threadId,
            groupId === op.groupId ? null : groupId,
          ]),
        ),
      };
    case "setProjectDefault": {
      if (!hasGroup(state, op.groupId)) return state;
      const projectDefaults = { ...state.projectDefaults };
      for (const projectId of op.projectIds) {
        const entries = projectDefaults[projectId] ?? [];
        const sinceMs = Date.parse(op.since);
        const current = entries.findLast((entry) => Date.parse(entry.since) <= sinceMs);
        if ((current?.groupId ?? null) === op.groupId) continue;
        projectDefaults[projectId] = insertBySince(entries, {
          groupId: op.groupId,
          since: op.since,
        });
      }
      return { ...state, projectDefaults };
    }
    case "setThreadGroup":
      return hasGroup(state, op.groupId)
        ? { ...state, threadOverrides: { ...state.threadOverrides, [op.threadId]: op.groupId } }
        : state;
    case "import": {
      const groups = [
        ...state.groups,
        ...op.state.groups.filter((group) => !hasGroup(state, group.id)),
      ];
      const known = (groupId: string | null) =>
        groupId === null || groups.some((group) => group.id === groupId);
      return {
        groups,
        projectDefaults: {
          ...Object.fromEntries(
            Object.entries(op.state.projectDefaults).map(([projectId, entries]) => [
              projectId,
              entries
                .filter((entry) => known(entry.groupId))
                .sort((left, right) => Date.parse(left.since) - Date.parse(right.since)),
            ]),
          ),
          ...state.projectDefaults,
        },
        threadOverrides: {
          ...Object.fromEntries(
            Object.entries(op.state.threadOverrides).filter(([, groupId]) => known(groupId)),
          ),
          ...state.threadOverrides,
        },
      };
    }
  }
}

export const applyThreadGroupOps = (
  state: ThreadGroupsState,
  ops: ReadonlyArray<ThreadGroupOp>,
): ThreadGroupsState => ops.reduce(applyThreadGroupOp, state);
