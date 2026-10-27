import type { MenuAction } from "@react-native-menu/menu";
import { resolveThreadGroupId } from "@t3tools/client-runtime/thread-groups";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";

import {
  promptNewThreadGroup,
  threadGroupActions,
  useThreadGroupsView,
} from "../../state/thread-groups";
import { THREAD_GROUP_SWATCH_HEX } from "./thread-group-header";

const SET_PREFIX = "thread-group:set:";

/** The thread menu's "Group" submenu; empty without settings access to the thread's environment. */
export function useThreadGroupMenu(thread: {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
  readonly projectId: ProjectId;
  readonly createdAt: string;
}) {
  const view = useThreadGroupsView();
  const state = view.byEnvironment.get(thread.environmentId);
  if (state === undefined || !view.writableEnvironmentIds.has(thread.environmentId)) {
    return { actions: [] as MenuAction[], onAction: (_event: string) => {} };
  }
  const currentGroupId = resolveThreadGroupId(state, thread);
  const actions: MenuAction[] = [
    {
      id: "thread-group",
      title: "Group",
      image: "folder",
      subactions: [
        { id: "thread-group:none", title: "No group", state: currentGroupId ? "off" : "on" },
        ...view.groups.map((group): MenuAction => ({
          id: `${SET_PREFIX}${group.id}`,
          title: group.name,
          ...(group.color
            ? { image: "circle.fill", imageColor: THREAD_GROUP_SWATCH_HEX[group.color] }
            : {}),
          state: group.id === currentGroupId ? "on" : "off",
        })),
        { id: "thread-group:new", title: "New group…", image: "plus" },
      ],
    },
  ];
  const onAction = (event: string) => {
    if (event === "thread-group:none") threadGroupActions.setThreadGroup(thread, null);
    if (event === "thread-group:new") {
      promptNewThreadGroup((group) => threadGroupActions.setThreadGroup(thread, group));
    }
    if (event.startsWith(SET_PREFIX)) {
      const group = view.groups.find(
        (candidate) => candidate.id === event.slice(SET_PREFIX.length),
      );
      if (group) threadGroupActions.setThreadGroup(thread, group);
    }
  };
  return { actions, onAction };
}
