import {
  scopedProjectKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { create } from "zustand";

import { getLocalStorageItem, setLocalStorageItem } from "./hooks/useLocalStorage";
import { randomUUID } from "./lib/utils";

const THREAD_GROUPS_STORAGE_KEY = "t3code:thread-groups:v1";

const ThreadGroup = Schema.Struct({ id: Schema.String, name: Schema.String });
export type ThreadGroup = typeof ThreadGroup.Type;

const ProjectDefaultEntry = Schema.Struct({
  groupId: Schema.NullOr(Schema.String),
  since: Schema.String,
});

export const ThreadGroupsStateSchema = Schema.Struct({
  groups: Schema.Array(ThreadGroup),
  // Append-only per project so a new default never moves threads created before it.
  projectDefaults: Schema.Record(Schema.String, Schema.Array(ProjectDefaultEntry)),
  // `null` pins a thread outside every group, overriding its project default.
  threadOverrides: Schema.Record(Schema.String, Schema.NullOr(Schema.String)),
  collapsed: Schema.Record(Schema.String, Schema.Boolean),
});
export type ThreadGroupsState = typeof ThreadGroupsStateSchema.Type;

export const EMPTY_THREAD_GROUPS_STATE: ThreadGroupsState = {
  groups: [],
  projectDefaults: {},
  threadOverrides: {},
  collapsed: {},
};

function existingGroupId(state: ThreadGroupsState, groupId: string | null | undefined) {
  return groupId != null && state.groups.some((group) => group.id === groupId) ? groupId : null;
}

export function projectDefaultGroupId(state: ThreadGroupsState, projectKey: string): string | null {
  return existingGroupId(state, state.projectDefaults[projectKey]?.at(-1)?.groupId);
}

export function resolveThreadGroupId(
  state: ThreadGroupsState,
  thread: { readonly threadKey: string; readonly projectKey: string; readonly createdAt: string },
): string | null {
  if (Object.hasOwn(state.threadOverrides, thread.threadKey)) {
    return existingGroupId(state, state.threadOverrides[thread.threadKey]);
  }
  const createdAtMs = Date.parse(thread.createdAt);
  const entry = state.projectDefaults[thread.projectKey]?.findLast(
    (candidate) => Date.parse(candidate.since) <= createdAtMs,
  );
  return existingGroupId(state, entry?.groupId);
}

export function splitThreadsByGroup<
  T extends {
    readonly environmentId: EnvironmentId;
    readonly id: ThreadId;
    readonly projectId: ProjectId;
    readonly createdAt: string;
  },
>(threads: readonly T[], state: ThreadGroupsState) {
  const byGroupId = new Map(state.groups.map((group) => [group.id, [] as T[]]));
  const ungrouped: T[] = [];
  for (const thread of threads) {
    const groupId = resolveThreadGroupId(state, {
      threadKey: scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      projectKey: scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)),
      createdAt: thread.createdAt,
    });
    (groupId === null ? ungrouped : byGroupId.get(groupId)!).push(thread);
  }
  return {
    ungrouped,
    groups: state.groups.map((group) => ({ group, threads: byGroupId.get(group.id)! })),
  };
}

export function createThreadGroup(state: ThreadGroupsState, group: ThreadGroup): ThreadGroupsState {
  return { ...state, groups: [...state.groups, group] };
}

function renameThreadGroup(
  state: ThreadGroupsState,
  groupId: string,
  name: string,
): ThreadGroupsState {
  return {
    ...state,
    groups: state.groups.map((group) => (group.id === groupId ? { ...group, name } : group)),
  };
}

export function deleteThreadGroup(state: ThreadGroupsState, groupId: string): ThreadGroupsState {
  const { [groupId]: _removed, ...collapsed } = state.collapsed;
  return {
    groups: state.groups.filter((group) => group.id !== groupId),
    projectDefaults: Object.fromEntries(
      Object.entries(state.projectDefaults).map(([projectKey, entries]) => [
        projectKey,
        entries.map((entry) => (entry.groupId === groupId ? { ...entry, groupId: null } : entry)),
      ]),
    ),
    threadOverrides: Object.fromEntries(
      Object.entries(state.threadOverrides).map(([threadKey, override]) => [
        threadKey,
        override === groupId ? null : override,
      ]),
    ),
    collapsed,
  };
}

export function setProjectDefaultGroup(
  state: ThreadGroupsState,
  projectKeys: ReadonlyArray<string>,
  groupId: string | null,
  since: string,
): ThreadGroupsState {
  const projectDefaults = { ...state.projectDefaults };
  for (const projectKey of projectKeys) {
    if (projectDefaultGroupId(state, projectKey) === groupId) continue;
    projectDefaults[projectKey] = [...(projectDefaults[projectKey] ?? []), { groupId, since }];
  }
  return { ...state, projectDefaults };
}

export function setThreadGroup(
  state: ThreadGroupsState,
  threadKey: string,
  groupId: string | null,
): ThreadGroupsState {
  return { ...state, threadOverrides: { ...state.threadOverrides, [threadKey]: groupId } };
}

export function readPersistedThreadGroups(): ThreadGroupsState {
  try {
    return (
      getLocalStorageItem(THREAD_GROUPS_STORAGE_KEY, ThreadGroupsStateSchema) ??
      EMPTY_THREAD_GROUPS_STATE
    );
  } catch (error) {
    console.error("[THREAD_GROUPS] Could not read stored groups.", error);
    return EMPTY_THREAD_GROUPS_STATE;
  }
}

export const useThreadGroupsStore = create<ThreadGroupsState>(() => readPersistedThreadGroups());

useThreadGroupsStore.subscribe((state) => {
  try {
    setLocalStorageItem(THREAD_GROUPS_STORAGE_KEY, state, ThreadGroupsStateSchema);
  } catch (error) {
    console.error("[THREAD_GROUPS] Could not persist groups.", error);
  }
});

const update = (apply: (state: ThreadGroupsState) => ThreadGroupsState) =>
  useThreadGroupsStore.setState((state) => apply(state), true);

export const threadGroupActions = {
  create: (name: string): string => {
    const id = randomUUID();
    update((state) => createThreadGroup(state, { id, name }));
    return id;
  },
  rename: (groupId: string, name: string) =>
    update((state) => renameThreadGroup(state, groupId, name)),
  delete: (groupId: string) => update((state) => deleteThreadGroup(state, groupId)),
  setProjectDefault: (projectKeys: ReadonlyArray<string>, groupId: string | null) =>
    update((state) =>
      setProjectDefaultGroup(state, projectKeys, groupId, new Date().toISOString()),
    ),
  setThreadGroup: (threadKey: string, groupId: string | null) =>
    update((state) => setThreadGroup(state, threadKey, groupId)),
  toggleCollapsed: (groupId: string) =>
    update((state) => ({
      ...state,
      collapsed: { ...state.collapsed, [groupId]: !state.collapsed[groupId] },
    })),
};
