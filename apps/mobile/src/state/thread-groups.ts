import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  environmentsWithThreadGroup,
  mergeThreadGroups,
  withThreadGroup,
  type ThreadGroupsByEnvironment,
} from "@t3tools/client-runtime/thread-groups";
import {
  AuthSettingsWriteScope,
  type EnvironmentId,
  type ProjectIconColor,
  type ProjectIconOverride,
  type ProjectId,
  type ThreadGroup,
  type ThreadGroupGradient,
  type ThreadGroupOp,
  type ThreadGroupsState,
  type ThreadId,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";

import * as Dialog from "../components/ui/Dialog";
import { environmentCatalog } from "../connection/catalog";
import { projectMonogramColor } from "../lib/projectIcon";
import { uuidv4 } from "../lib/uuid";
import { appAtomRegistry } from "./atom-registry";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "./preferences";
import { serverEnvironment } from "./server";
import { environmentSession, sessionHasScope } from "./session";

export interface ThreadGroupsView {
  readonly byEnvironment: ThreadGroupsByEnvironment;
  readonly groups: ReadonlyArray<ThreadGroup>;
  /** Environments whose session may change settings, which hold the groups. */
  readonly writableEnvironmentIds: ReadonlySet<EnvironmentId>;
}

const threadGroupsViewAtom = Atom.make((get): ThreadGroupsView => {
  const byEnvironment = new Map<EnvironmentId, ThreadGroupsState>();
  const writableEnvironmentIds = new Set<EnvironmentId>();
  for (const environmentId of get(environmentCatalog.catalogValueAtom).entries.keys()) {
    const settings = get(serverEnvironment.settingsValueAtom(environmentId));
    if (settings) byEnvironment.set(environmentId, settings.threadGroups);
    const session = get(environmentSession.sessionStateAtom(environmentId));
    if (sessionHasScope(session, AuthSettingsWriteScope)) writableEnvironmentIds.add(environmentId);
  }
  return { byEnvironment, groups: mergeThreadGroups(byEnvironment), writableEnvironmentIds };
}).pipe(Atom.withLabel("mobile-thread-groups"));

export const useThreadGroupsView = () => useAtomValue(threadGroupsViewAtom);

const readThreadGroupsView = () => appAtomRegistry.get(threadGroupsViewAtom);

export function canEditThreadGroup(view: ThreadGroupsView, groupId: string) {
  const environmentIds = environmentsWithThreadGroup(view.byEnvironment, groupId);
  return (
    environmentIds.length > 0 &&
    environmentIds.every((environmentId) => view.writableEnvironmentIds.has(environmentId))
  );
}

const EMPTY_COLLAPSED: ReadonlyArray<string> = [];

export function useCollapsedThreadGroups() {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const update = useAtomSet(updateMobilePreferencesAtom);
  const collapsed = AsyncResult.isSuccess(preferences)
    ? (preferences.value.collapsedThreadGroups ?? EMPTY_COLLAPSED)
    : EMPTY_COLLAPSED;
  const toggle = (groupId: string) =>
    update({
      transform: (current) => {
        const ids = current.collapsedThreadGroups ?? [];
        return {
          collapsedThreadGroups: ids.includes(groupId)
            ? ids.filter((id) => id !== groupId)
            : [...ids, groupId],
        };
      },
    });
  return { collapsed, toggle };
}

async function sendThreadGroupOps(environmentId: EnvironmentId, threadGroupOps: ThreadGroupOp[]) {
  const result = await runAtomCommand(
    appAtomRegistry,
    serverEnvironment.updateSettings,
    { environmentId, input: { patch: { threadGroupOps } } },
    { label: "Thread group update" },
  );
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
  const error = squashAtomCommandFailure(result);
  Dialog.alert("Could not update group", error instanceof Error ? error.message : String(error));
}

export interface ThreadGroupDetails {
  readonly name: string;
  readonly color: ProjectIconColor | null;
  readonly gradient: ThreadGroupGradient | null;
  readonly icon: ProjectIconOverride | null;
}

export const newThreadGroup = (name: string): ThreadGroup => ({
  id: uuidv4(),
  name,
  color: projectMonogramColor(name),
  icon: null,
});

export const normalizeThreadGroupName = (value: string) => value.trim().slice(0, 200);

export const threadGroupActions = {
  update: (groupId: string, details: Partial<ThreadGroupDetails>) => {
    const { byEnvironment } = readThreadGroupsView();
    for (const environmentId of environmentsWithThreadGroup(byEnvironment, groupId)) {
      void sendThreadGroupOps(environmentId, [{ type: "updateGroup", groupId, ...details }]);
    }
  },
  delete: (groupId: string) => {
    const { byEnvironment } = readThreadGroupsView();
    for (const environmentId of environmentsWithThreadGroup(byEnvironment, groupId)) {
      void sendThreadGroupOps(environmentId, [{ type: "deleteGroup", groupId }]);
    }
  },
  setProjectDefault: (
    projects: ReadonlyArray<{ readonly environmentId: EnvironmentId; readonly id: ProjectId }>,
    group: ThreadGroup | null,
  ) => {
    const { byEnvironment } = readThreadGroupsView();
    const since = new Date().toISOString();
    const projectIdsByEnvironment = new Map<EnvironmentId, ProjectId[]>();
    for (const project of projects) {
      projectIdsByEnvironment.set(project.environmentId, [
        ...(projectIdsByEnvironment.get(project.environmentId) ?? []),
        project.id,
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
};

/** Asks for a name; the group reaches a server only with its first thread or project. */
export function promptNewThreadGroup(onCreate: (group: ThreadGroup) => void) {
  Dialog.prompt({
    title: "New group",
    placeholder: "Group name",
    initialValue: "",
    confirmText: "Create",
    onConfirm: (value) => {
      const name = normalizeThreadGroupName(value);
      if (name.length > 0) onCreate(newThreadGroup(name));
    },
  });
}
