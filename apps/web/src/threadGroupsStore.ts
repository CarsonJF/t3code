import { useAtomValue } from "@effect/atom-react";
import { parseScopedProjectKey, parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import {
  environmentsWithThreadGroup,
  mergeThreadGroups,
  moveThreadGroup,
  splitThreadsByGroup as splitThreadsByEnvironmentGroup,
  withThreadGroup,
  type ThreadGroupsByEnvironment,
} from "@t3tools/client-runtime/thread-groups";
import {
  AuthSettingsWriteScope,
  ProjectIconColor,
  ProjectIconOverride,
  type EnvironmentId,
  type ProjectId,
  type ScopedProjectRef,
  type ThreadGroup,
  type ThreadGroupGradient,
  type ThreadGroupOp,
  type ThreadGroupsState,
  type ThreadId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/reactivity";
import { create } from "zustand";

import { environmentCatalog } from "./connection/catalog";
import { getLocalStorageItem, setLocalStorageItem } from "./hooks/useLocalStorage";
import { randomUUID } from "./lib/utils";
import { appAtomRegistry } from "./rpc/atomRegistry";
import { serverEnvironment } from "./state/server";
import { readEnvironmentScope } from "./state/session";

export type { ThreadGroup };

export interface ThreadGroupDetails {
  readonly name: string;
  readonly color: ProjectIconColor | null;
  readonly gradient: ThreadGroupGradient | null;
  readonly icon: ProjectIconOverride | null;
}

// Groups used to live only in this browser, keyed by environment-scoped thread and project keys.
const LEGACY_STORAGE_KEY = "t3code:thread-groups:v1";
const LegacyThreadGroupsState = Schema.Struct({
  groups: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      color: Schema.optional(Schema.NullOr(ProjectIconColor)),
      icon: Schema.optional(Schema.NullOr(ProjectIconOverride)),
    }),
  ),
  projectDefaults: Schema.Record(
    Schema.String,
    Schema.Array(Schema.Struct({ groupId: Schema.NullOr(Schema.String), since: Schema.String })),
  ),
  threadOverrides: Schema.Record(Schema.String, Schema.NullOr(Schema.String)),
  collapsed: Schema.Record(Schema.String, Schema.Boolean),
});
export type LegacyThreadGroupsState = typeof LegacyThreadGroupsState.Type;

// Collapsing is a per-device view choice: folding a group on a phone must not fold it on the desktop.
const LOCAL_STORAGE_KEY = "t3code:thread-groups-local:v1";
const LocalThreadGroupsState = Schema.Struct({
  collapsed: Schema.Record(Schema.String, Schema.Boolean),
  migratedEnvironmentIds: Schema.Array(Schema.String),
});
type LocalThreadGroupsState = typeof LocalThreadGroupsState.Type;

function readStored<T, E>(key: string, schema: Schema.Codec<T, E>): T | null {
  try {
    return getLocalStorageItem(key, schema);
  } catch (error) {
    console.error("[THREAD_GROUPS] Could not read stored groups.", error);
    return null;
  }
}

export const readLegacyThreadGroups = () => readStored(LEGACY_STORAGE_KEY, LegacyThreadGroupsState);

export const useLocalThreadGroupsStore = create<LocalThreadGroupsState>(
  () =>
    readStored(LOCAL_STORAGE_KEY, LocalThreadGroupsState) ?? {
      collapsed: readLegacyThreadGroups()?.collapsed ?? {},
      migratedEnvironmentIds: [],
    },
);

useLocalThreadGroupsStore.subscribe((state) => {
  try {
    setLocalStorageItem(LOCAL_STORAGE_KEY, state, LocalThreadGroupsState);
  } catch (error) {
    console.error("[THREAD_GROUPS] Could not persist groups.", error);
  }
});

export interface ThreadGroupsView {
  readonly byEnvironment: ThreadGroupsByEnvironment;
  readonly groups: ReadonlyArray<ThreadGroup>;
}

const threadGroupsViewAtom = Atom.make((get): ThreadGroupsView => {
  const byEnvironment = new Map<EnvironmentId, ThreadGroupsState>();
  for (const environmentId of get(environmentCatalog.catalogValueAtom).entries.keys()) {
    const settings = get(serverEnvironment.settingsValueAtom(environmentId));
    if (settings) byEnvironment.set(environmentId, settings.threadGroups);
  }
  return { byEnvironment, groups: mergeThreadGroups(byEnvironment) };
}).pipe(Atom.withLabel("web-thread-groups"));

export const readThreadGroupsView = () => appAtomRegistry.get(threadGroupsViewAtom);

export function useThreadGroupsStore() {
  const view = useAtomValue(threadGroupsViewAtom);
  const collapsed = useLocalThreadGroupsStore((state) => state.collapsed);
  return { ...view, collapsed };
}

export function splitThreadsByGroup<
  T extends {
    readonly environmentId: EnvironmentId;
    readonly id: ThreadId;
    readonly projectId: ProjectId;
    readonly createdAt: string;
  },
>(threads: readonly T[], view: ThreadGroupsView) {
  return splitThreadsByEnvironmentGroup(threads, view.byEnvironment, view.groups);
}

export const canEditThreadGroups = (environmentId: EnvironmentId) =>
  readEnvironmentScope(environmentId, AuthSettingsWriteScope);

const sendThreadGroupOps = (environmentId: EnvironmentId, threadGroupOps: ThreadGroupOp[]) =>
  runAtomCommand(
    appAtomRegistry,
    serverEnvironment.updateSettings,
    { environmentId, input: { patch: { threadGroupOps } } },
    { label: "Thread group update" },
  );

export const newThreadGroup = (details: ThreadGroupDetails): ThreadGroup => ({
  id: randomUUID(),
  ...details,
});

export const threadGroupActions = {
  update: (groupId: string, details: ThreadGroupDetails) => {
    const { byEnvironment } = readThreadGroupsView();
    for (const environmentId of environmentsWithThreadGroup(byEnvironment, groupId)) {
      void sendThreadGroupOps(environmentId, [{ type: "updateGroup", groupId, ...details }]);
    }
  },
  /** Drops the group on one edge of another; every environment gets the same full order. */
  move: (groupId: string, targetId: string, edge: "before" | "after") => {
    const { byEnvironment, groups } = readThreadGroupsView();
    const groupIds = moveThreadGroup(
      groups.map((group) => group.id),
      groupId,
      targetId,
      edge,
    );
    for (const environmentId of byEnvironment.keys()) {
      void sendThreadGroupOps(environmentId, [{ type: "reorderGroups", groupIds }]);
    }
  },
  delete: (groupId: string) => {
    const { byEnvironment } = readThreadGroupsView();
    for (const environmentId of environmentsWithThreadGroup(byEnvironment, groupId)) {
      void sendThreadGroupOps(environmentId, [{ type: "deleteGroup", groupId }]);
    }
  },
  setProjectDefault: (projectRefs: ReadonlyArray<ScopedProjectRef>, group: ThreadGroup | null) => {
    const { byEnvironment } = readThreadGroupsView();
    const since = new Date().toISOString();
    const projectIdsByEnvironment = new Map<EnvironmentId, ProjectId[]>();
    for (const ref of projectRefs) {
      projectIdsByEnvironment.set(ref.environmentId, [
        ...(projectIdsByEnvironment.get(ref.environmentId) ?? []),
        ref.projectId,
      ]);
    }
    for (const [environmentId, projectIds] of projectIdsByEnvironment) {
      void sendThreadGroupOps(
        environmentId,
        withThreadGroup(byEnvironment.get(environmentId), group, {
          type: "setProjectDefault",
          projectIds,
          groupId: group?.id ?? null,
          since,
        }),
      );
    }
  },
  setThreadGroup: (
    thread: { readonly environmentId: EnvironmentId; readonly id: ThreadId },
    group: ThreadGroup | null,
  ) => {
    const state = readThreadGroupsView().byEnvironment.get(thread.environmentId);
    void sendThreadGroupOps(
      thread.environmentId,
      withThreadGroup(state, group, {
        type: "setThreadGroup",
        threadId: thread.id,
        groupId: group?.id ?? null,
      }),
    );
  },
  toggleCollapsed: (groupId: string) =>
    useLocalThreadGroupsStore.setState((state) => ({
      collapsed: { ...state.collapsed, [groupId]: !state.collapsed[groupId] },
    })),
};

/** Every legacy group goes to each environment, with only the threads and projects it owns. */
export function legacyThreadGroupsImport(
  legacy: LegacyThreadGroupsState,
  environmentId: EnvironmentId,
): ThreadGroupsState {
  const projectDefaults: Record<string, ThreadGroupsState["projectDefaults"][ProjectId]> = {};
  for (const [key, entries] of Object.entries(legacy.projectDefaults)) {
    const ref = parseScopedProjectKey(key);
    if (ref?.environmentId === environmentId) projectDefaults[ref.projectId] = entries;
  }
  const threadOverrides: Record<string, string | null> = {};
  for (const [key, groupId] of Object.entries(legacy.threadOverrides)) {
    const ref = parseScopedThreadKey(key);
    if (ref?.environmentId === environmentId) threadOverrides[ref.threadId] = groupId;
  }
  return {
    groups: legacy.groups.flatMap((group) => {
      const name = group.name.trim().slice(0, 200);
      return name.length > 0 && group.id.trim().length > 0 ? [{ ...group, name }] : [];
    }),
    projectDefaults,
    threadOverrides,
  };
}

const attemptedMigrationGenerations = new Map<EnvironmentId, number>();

const migrationTargetsAtom = Atom.make((get) =>
  [...get(environmentCatalog.catalogValueAtom).entries.keys()].flatMap((environmentId) => {
    const generation = Option.match(
      AsyncResult.value(get(environmentCatalog.stateAtom(environmentId))),
      {
        onNone: () => null,
        onSome: (connection) => (connection.phase === "connected" ? connection.generation : null),
      },
    );
    return generation === null || get(serverEnvironment.settingsValueAtom(environmentId)) === null
      ? []
      : [{ environmentId, generation }];
  }),
).pipe(Atom.withLabel("web-thread-groups-migration-targets"));

function migrateLegacyThreadGroups(): void {
  const legacy = readLegacyThreadGroups();
  if (!legacy || legacy.groups.length === 0) return;
  for (const { environmentId, generation } of appAtomRegistry.get(migrationTargetsAtom)) {
    const { migratedEnvironmentIds } = useLocalThreadGroupsStore.getState();
    if (migratedEnvironmentIds.includes(environmentId)) continue;
    if (attemptedMigrationGenerations.get(environmentId) === generation) continue;
    if (!canEditThreadGroups(environmentId)) continue;
    attemptedMigrationGenerations.set(environmentId, generation);
    void runAtomCommand(
      appAtomRegistry,
      serverEnvironment.updateSettings,
      {
        environmentId,
        input: {
          patch: {
            threadGroupOps: [
              { type: "import", state: legacyThreadGroupsImport(legacy, environmentId) },
            ],
          },
        },
      },
      { reportFailure: false },
    ).then((result) => {
      // Servers without thread groups drop the op and report none, so retry on the next connection.
      if (result._tag !== "Success" || result.value.threadGroups.groups.length === 0) return;
      useLocalThreadGroupsStore.setState((state) => ({
        migratedEnvironmentIds: [...state.migratedEnvironmentIds, environmentId],
      }));
    });
  }
}

/** Uploads this browser's pre-sync groups to each environment once; the legacy key stays for rollback. */
export function startThreadGroupsMigration(): () => void {
  const unsubscribe = appAtomRegistry.subscribe(migrationTargetsAtom, migrateLegacyThreadGroups);
  migrateLegacyThreadGroups();
  return unsubscribe;
}
