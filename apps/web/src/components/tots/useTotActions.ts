import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, Tot } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { useOpenInPreferredEditor } from "../../editorPreferences";
import { useProject } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { toastManager } from "../ui/toast";
import { openTotEditor } from "./totEditorStore";
import { openTotMemory } from "./TotMemoryDialog";
import { useTotModelChoice } from "./useTotModelChoice";

function reportFailure(title: string, error: unknown) {
  toastManager.add({
    type: "error",
    title,
    description: error instanceof Error ? error.message : String(error),
  });
}

/** Everything a user can do to one Tot, shared by the sidebar, Settings and the palette. */
export function useTotActions(environmentId: EnvironmentId, tot: Tot) {
  const navigate = useNavigate();
  const project = useProject(
    tot.projectId === null ? null : scopeProjectRef(environmentId, tot.projectId),
  );
  const model = useTotModelChoice(environmentId, tot.modelSelection);
  const availableEditors = useAtomValue(
    serverEnvironment.configValueAtom(environmentId),
    (config) => config?.availableEditors ?? [],
  );
  const openInEditor = useOpenInPreferredEditor(environmentId, availableEditors);
  const enableTot = useAtomCommand(serverEnvironment.enableTot, { reportFailure: false });
  const disableTot = useAtomCommand(serverEnvironment.disableTot, { reportFailure: false });
  const startFreshTot = useAtomCommand(serverEnvironment.startFreshTot, { reportFailure: false });
  const removeTot = useAtomCommand(serverEnvironment.removeTot, { reportFailure: false });
  const [pending, setPending] = useState(false);

  const openThread = (threadId: NonNullable<Tot["threadId"]>) =>
    navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
    });
  const run = async <A>(
    title: string,
    action: () => Promise<
      { readonly _tag: "Success"; readonly value: A } | { readonly _tag: "Failure" }
    >,
  ) => {
    setPending(true);
    const result = await action();
    setPending(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result as never)) {
        reportFailure(title, squashAtomCommandFailure(result as never));
      }
      return null;
    }
    return result.value;
  };

  return {
    pending,
    hasInstructionsFile: project !== null,
    openThread,
    edit: () => openTotEditor({ mode: "edit", environmentId, tot }),
    openMemory: () => openTotMemory({ environmentId, tot }),
    async turnOn() {
      const started = await run(`Could not turn on ${tot.name}`, () =>
        enableTot({
          environmentId,
          input: {
            id: tot.id,
            ...(model.selection === null ? {} : { modelSelection: model.selection }),
          },
        }),
      );
      if (started !== null) await openThread(started.threadId);
    },
    async startFresh() {
      const fresh = await run(`Could not start ${tot.name} fresh`, () =>
        startFreshTot({ environmentId, input: { id: tot.id } }),
      );
      if (fresh !== null) await openThread(fresh.threadId);
    },
    async turnOff() {
      await run(`Could not turn off ${tot.name}`, () =>
        disableTot({ environmentId, input: { id: tot.id } }),
      );
    },
    async remove() {
      await run(`Could not delete ${tot.name}`, () =>
        removeTot({ environmentId, input: { id: tot.id } }),
      );
    },
    async editInstructions() {
      if (project === null) return;
      const root = project.workspaceRoot.replace(/[/\\]+$/, "");
      const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
      const result = await openInEditor(`${root}${separator}AGENTS.md`);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        reportFailure("Could not open instructions", squashAtomCommandFailure(result));
      }
    },
  };
}
