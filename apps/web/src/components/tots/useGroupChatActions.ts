import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, GroupChat } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { toastManager } from "../ui/toast";
import { openGroupChatEditor } from "./GroupChatEditorDialog";

/** Everything a user can do to one group chat, shared by the sidebar and Settings. */
export function useGroupChatActions(environmentId: EnvironmentId, room: GroupChat) {
  const navigate = useNavigate();
  const removeRoom = useAtomCommand(serverEnvironment.removeGroupChat, { reportFailure: false });
  const [pending, setPending] = useState(false);
  return {
    pending,
    open: () => {
      if (room.threadId === null) return;
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(environmentId, room.threadId)),
      });
    },
    edit: () => openGroupChatEditor({ mode: "edit", environmentId, room }),
    async remove() {
      setPending(true);
      const result = await removeRoom({ environmentId, input: { id: room.id } });
      setPending(false);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        toastManager.add({
          type: "error",
          title: `Could not delete ${room.name}`,
          description: String(squashAtomCommandFailure(result)),
        });
      }
    },
  };
}
