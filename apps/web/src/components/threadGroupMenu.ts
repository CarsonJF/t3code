import { resolveThreadGroupId } from "@t3tools/client-runtime/thread-groups";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";

import {
  canEditThreadGroups,
  readThreadGroupsView,
  threadGroupActions,
} from "../threadGroupsStore";
import { createThreadGroupFromPrompt } from "./ThreadGroupNameDialog";
import type { ThreadActionMenuId, ThreadActionMenuState } from "./threadActionMenu.logic";

interface GroupableThread {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
  readonly projectId: ProjectId;
  readonly createdAt: string;
}

export function readThreadGroupMenuState(
  thread: GroupableThread,
): ThreadActionMenuState["threadGroups"] {
  if (!canEditThreadGroups(thread.environmentId)) return undefined;
  const view = readThreadGroupsView();
  const state = view.byEnvironment.get(thread.environmentId);
  return {
    groups: view.groups,
    currentGroupId: state ? resolveThreadGroupId(state, thread) : null,
  };
}

/** Returns whether `action` was a group action, so callers can stop handling it. */
export async function handleThreadGroupMenuAction(
  action: ThreadActionMenuId,
  thread: GroupableThread,
): Promise<boolean> {
  if (action === "group:none") {
    threadGroupActions.setThreadGroup(thread, null);
  } else if (action === "group:new") {
    const group = await createThreadGroupFromPrompt();
    if (group !== null) threadGroupActions.setThreadGroup(thread, group);
  } else if (action.startsWith("group:set:")) {
    const groupId = action.slice("group:set:".length);
    const group = readThreadGroupsView().groups.find((candidate) => candidate.id === groupId);
    if (group) threadGroupActions.setThreadGroup(thread, group);
  } else {
    return false;
  }
  return true;
}
