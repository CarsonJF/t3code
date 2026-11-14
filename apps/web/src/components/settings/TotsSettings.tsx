import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  resolveTotAnimation,
  totFaceInputFromShell,
  totFaceState,
} from "@t3tools/client-runtime/tots";
import { HOME_TOT_ID, type EnvironmentId, type Tot } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { useOpenInPreferredEditor } from "../../editorPreferences";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useClientSettings, useEnvironmentSettings } from "../../hooks/useSettings";
import { useProject, useThreadShell } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { TotAvatar } from "../tots/TotAvatar";
import { openTotEditor, useTotHostEnvironmentId } from "../tots/totEditorStore";
import { useTotModelChoice } from "../tots/useTotModelChoice";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const TOTS_DESCRIPTION =
  "Agents you talk to in one thread each. A Tot starts, watches and answers threads in its scope, on every machine it can reach.";

function reportFailure(title: string, error: unknown) {
  toastManager.add({
    type: "error",
    title,
    description: error instanceof Error ? error.message : String(error),
  });
}

export function TotsSettings() {
  const environmentId = useTotHostEnvironmentId();
  return (
    <SettingsPageContainer>
      <SettingsSection title="Tots">
        {environmentId === null ? (
          <SettingsRow {...searchableSetting("tots")} description="Connect to a T3 server first." />
        ) : (
          <TotsRows environmentId={environmentId} />
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}

function TotsRows(props: { readonly environmentId: EnvironmentId }) {
  const { environmentId } = props;
  const tots = useEnvironmentSettings(environmentId, (settings) => settings.tots);
  const linksOn = useEnvironmentSettings(
    environmentId,
    (settings) => settings.linkedEnvironmentsEnabled,
  );
  return (
    <>
      <SettingsRow
        {...searchableSetting("tots")}
        description={TOTS_DESCRIPTION}
        control={
          <Button size="sm" onClick={() => openTotEditor({ mode: "create", environmentId })}>
            New Tot
          </Button>
        }
      />
      {linksOn ? null : (
        <SettingsRow
          title="Other machines"
          description="Turn on Linked environments in Beta settings, here and on each machine, so Tots can reach your other machines."
        />
      )}
      {tots.map((tot) => (
        <TotRow key={tot.id} environmentId={environmentId} tot={tot} />
      ))}
    </>
  );
}

function TotRow(props: { readonly environmentId: EnvironmentId; readonly tot: Tot }) {
  const { environmentId, tot } = props;
  const navigate = useNavigate();
  const animate = useClientSettings((settings) => settings.animateTotAvatars);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const ref = tot.threadId === null ? null : scopeThreadRef(environmentId, tot.threadId);
  const shell = useThreadShell(ref);
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
  const run = async <A,>(
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
  const turnOn = async () => {
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
  };
  const editInstructions = async () => {
    if (project === null) return;
    const root = project.workspaceRoot.replace(/[\\/]+$/, "");
    const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
    const result = await openInEditor(`${root}${separator}AGENTS.md`);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      reportFailure("Could not open instructions", squashAtomCommandFailure(result));
    }
  };

  return (
    <SettingsRow
      title={
        <span className="flex items-center gap-2">
          <TotAvatar
            avatar={tot.avatar}
            state={totFaceState(totFaceInputFromShell(tot, shell))}
            animation={resolveTotAnimation("other", animate, reducedMotion)}
            size={22}
          />
          {tot.name}
        </span>
      }
      description={tot.threadId === null ? "Off" : tot.scope === "all" ? "Everything" : "Scoped"}
      control={
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {tot.threadId === null ? (
            <Button size="sm" disabled={pending} onClick={() => void turnOn()}>
              Turn on
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => void openThread(tot.threadId!)}>
              Open
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => openTotEditor({ mode: "edit", environmentId, tot })}
          >
            Edit
          </Button>
          {project === null ? null : (
            <Button size="sm" variant="outline" onClick={() => void editInstructions()}>
              Instructions
            </Button>
          )}
          {tot.threadId === null ? null : (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  void run(`Could not start ${tot.name} fresh`, () =>
                    startFreshTot({ environmentId, input: { id: tot.id } }),
                  ).then((fresh) => (fresh === null ? undefined : openThread(fresh.threadId)))
                }
              >
                Start fresh
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  void run(`Could not turn off ${tot.name}`, () =>
                    disableTot({ environmentId, input: { id: tot.id } }),
                  )
                }
              >
                Turn off
              </Button>
            </>
          )}
          {tot.id === HOME_TOT_ID ? null : (
            <Button
              size="sm"
              variant="destructive-outline"
              disabled={pending}
              onClick={() =>
                void run(`Could not delete ${tot.name}`, () =>
                  removeTot({ environmentId, input: { id: tot.id } }),
                )
              }
            >
              Delete
            </Button>
          )}
        </div>
      }
    />
  );
}
