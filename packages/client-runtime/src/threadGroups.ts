import type {
  EnvironmentId,
  ProjectId,
  ThreadGroup,
  ThreadGroupOp,
  ThreadGroupsState,
  ThreadId,
} from "@t3tools/contracts";

/** Each environment stores the groups its own threads use; clients show their union by id. */
export type ThreadGroupsByEnvironment = ReadonlyMap<EnvironmentId, ThreadGroupsState>;

interface GroupableThread {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
  readonly projectId: ProjectId;
  readonly createdAt: string;
}

function existingGroupId(state: ThreadGroupsState, groupId: string | null | undefined) {
  return groupId != null && state.groups.some((group) => group.id === groupId) ? groupId : null;
}

export function mergeThreadGroups(byEnvironment: ThreadGroupsByEnvironment): ThreadGroup[] {
  const groups = new Map<string, ThreadGroup>();
  for (const state of byEnvironment.values()) {
    for (const group of state.groups) if (!groups.has(group.id)) groups.set(group.id, group);
  }
  return [...groups.values()];
}

export function environmentsWithThreadGroup(
  byEnvironment: ThreadGroupsByEnvironment,
  groupId: string,
): EnvironmentId[] {
  return [...byEnvironment]
    .filter(([, state]) => state.groups.some((group) => group.id === groupId))
    .map(([environmentId]) => environmentId);
}

export function projectDefaultGroupId(
  state: ThreadGroupsState,
  projectId: ProjectId,
): string | null {
  return existingGroupId(state, state.projectDefaults[projectId]?.at(-1)?.groupId);
}

export function resolveThreadGroupId(
  state: ThreadGroupsState,
  thread: Pick<GroupableThread, "id" | "projectId" | "createdAt">,
): string | null {
  if (Object.hasOwn(state.threadOverrides, thread.id)) {
    return existingGroupId(state, state.threadOverrides[thread.id]);
  }
  const createdAtMs = Date.parse(thread.createdAt);
  const entry = state.projectDefaults[thread.projectId]?.findLast(
    (candidate) => Date.parse(candidate.since) <= createdAtMs,
  );
  return existingGroupId(state, entry?.groupId);
}

export function splitThreadsByGroup<T extends GroupableThread>(
  threads: readonly T[],
  byEnvironment: ThreadGroupsByEnvironment,
  groups: ReadonlyArray<ThreadGroup> = mergeThreadGroups(byEnvironment),
) {
  const byGroupId = new Map(groups.map((group) => [group.id, [] as T[]]));
  const ungrouped: T[] = [];
  for (const thread of threads) {
    const state = byEnvironment.get(thread.environmentId);
    const groupId = state ? resolveThreadGroupId(state, thread) : null;
    const target = groupId === null ? undefined : byGroupId.get(groupId);
    (target ?? ungrouped).push(thread);
  }
  return {
    ungrouped,
    groups: groups.map((group) => ({ group, threads: byGroupId.get(group.id)! })),
  };
}

/** Prefixes `createGroup` when `group` is new to the environment, so the ops apply atomically. */
export function withThreadGroup(
  state: ThreadGroupsState | undefined,
  group: ThreadGroup | null,
  op: ThreadGroupOp,
): ThreadGroupOp[] {
  return group === null || state?.groups.some((existing) => existing.id === group.id)
    ? [op]
    : [{ type: "createGroup", group }, op];
}
