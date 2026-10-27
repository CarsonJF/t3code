import {
  scopedProjectKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";

import {
  resolveThreadGroupId,
  threadGroupActions,
  useThreadGroupsStore,
} from "../threadGroupsStore";
import { createThreadGroupFromPrompt } from "./ThreadGroupNameDialog";
import type { ThreadActionMenuId, ThreadActionMenuState } from "./threadActionMenu.logic";

interface GroupableThread {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
  readonly projectId: ProjectId;
  readonly createdAt: string;
}

const threadKeyOf = (thread: GroupableThread) =>
  scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));

export function readThreadGroupMenuState(
  thread: GroupableThread,
): NonNullable<ThreadActionMenuState["threadGroups"]> {
  const state = useThreadGroupsStore.getState();
  return {
    groups: state.groups,
    currentGroupId: resolveThreadGroupId(state, {
      threadKey: threadKeyOf(thread),
      projectKey: scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)),
      createdAt: thread.createdAt,
    }),
  };
}

/** Returns whether `action` was a group action, so callers can stop handling it. */
export async function handleThreadGroupMenuAction(
  action: ThreadActionMenuId,
  thread: GroupableThread,
): Promise<boolean> {
  if (action === "group:none") {
    threadGroupActions.setThreadGroup(threadKeyOf(thread), null);
  } else if (action === "group:new") {
    const groupId = await createThreadGroupFromPrompt();
    if (groupId !== null) threadGroupActions.setThreadGroup(threadKeyOf(thread), groupId);
  } else if (action.startsWith("group:set:")) {
    threadGroupActions.setThreadGroup(threadKeyOf(thread), action.slice("group:set:".length));
  } else {
    return false;
  }
  return true;
}
