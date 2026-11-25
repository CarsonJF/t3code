import type {
  ProjectId,
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
    case "reorderGroups": {
      const rank = new Map(op.groupIds.map((groupId, index) => [groupId, index]));
      const listed = state.groups.filter((group) => rank.has(group.id));
      listed.sort((left, right) => rank.get(left.id)! - rank.get(right.id)!);
      return {
        ...state,
        groups: [...listed, ...state.groups.filter((group) => !rank.has(group.id))],
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
    case "restoreGroup": {
      if (hasGroup(state, op.group.id)) return state;
      const groups = [...state.groups];
      groups.splice(Math.min(op.index, groups.length), 0, op.group);
      const projectDefaults = { ...state.projectDefaults };
      for (const [projectId, sinces] of Object.entries(op.projectDefaults) as Array<
        [ProjectId, ReadonlyArray<string>]
      >) {
        let entries = projectDefaults[projectId] ?? [];
        for (const since of sinces) {
          const index = entries.findIndex((entry) => entry.since === since);
          if (index === -1) entries = insertBySince(entries, { groupId: op.group.id, since });
          else if (entries[index]!.groupId === null) {
            entries = entries.with(index, { groupId: op.group.id, since });
          }
        }
        projectDefaults[projectId] = entries;
      }
      const threadOverrides = { ...state.threadOverrides };
      for (const threadId of op.threadIds) {
        if ((threadOverrides[threadId] ?? null) === null) threadOverrides[threadId] = op.group.id;
      }
      return { groups, projectDefaults, threadOverrides };
    }
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

export type ThreadGroupRestoreOp = Extract<ThreadGroupOp, { type: "restoreGroup" }>;

/** The op that undoes deleting `groupId` from `state`, taken before the delete; null if absent. */
export function threadGroupRestoreOp(
  state: ThreadGroupsState,
  groupId: string,
): ThreadGroupRestoreOp | null {
  const index = state.groups.findIndex((group) => group.id === groupId);
  if (index === -1) return null;
  const projectDefaults: Record<ProjectId, string[]> = {};
  for (const [projectId, entries] of Object.entries(state.projectDefaults)) {
    const sinces = entries.filter((entry) => entry.groupId === groupId).map((entry) => entry.since);
    if (sinces.length > 0) projectDefaults[projectId as ProjectId] = sinces;
  }
  return {
    type: "restoreGroup",
    group: state.groups[index]!,
    index,
    projectDefaults,
    threadIds: Object.entries(state.threadOverrides)
      .filter(([, override]) => override === groupId)
      .map(([threadId]) => threadId as ThreadGroupRestoreOp["threadIds"][number]),
  };
}
