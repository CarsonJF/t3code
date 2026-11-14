import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  resolveTotAnimation,
  totFaceInputFromShell,
  totFaceState,
} from "@t3tools/client-runtime/tots";
import { HOME_TOT_ID, type EnvironmentId, type Tot } from "@t3tools/contracts";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useClientSettings, useEnvironmentSettings } from "../../hooks/useSettings";
import { useThreadShell } from "../../state/entities";
import { useTotHosts, useTots } from "../../state/tots";
import { TotAvatar } from "../tots/TotAvatar";
import { openTotMemory } from "../tots/TotMemoryDialog";
import { openTotEditor, useTotHostEnvironmentId } from "../tots/totEditorStore";
import { useTotActions } from "../tots/useTotActions";
import { Button } from "../ui/button";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const TOTS_DESCRIPTION =
  "Agents you talk to in one thread each. A Tot starts, watches and answers threads in its scope, on every machine it can reach.";

export function TotsSettings() {
  const environmentId = useTotHostEnvironmentId();
  const hosts = useTotHosts();
  const tots = useTots();
  // The default machine, plus every other machine already running Tots.
  const machines = hosts.filter(
    (host) =>
      host.environmentId === environmentId ||
      tots.some((entry) => entry.environmentId === host.environmentId),
  );
  return (
    <SettingsPageContainer>
      <SettingsSection title="Tots">
        {environmentId === null ? (
          <SettingsRow {...searchableSetting("tots")} description="Connect to a T3 server first." />
        ) : (
          <>
            <SettingsRow
              {...searchableSetting("tots")}
              description={TOTS_DESCRIPTION}
              control={
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openTotMemory({ environmentId, tot: null })}
                  >
                    Shared memory
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => openTotEditor({ mode: "create", environmentId })}
                  >
                    New Tot
                  </Button>
                </div>
              }
            />
            {machines.map((host) => (
              <TotsRows
                key={host.environmentId}
                environmentId={host.environmentId}
                machine={machines.length > 1 ? host.label : null}
              />
            ))}
          </>
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}

function TotsRows(props: {
  readonly environmentId: EnvironmentId;
  readonly machine: string | null;
}) {
  const { environmentId } = props;
  const tots = useEnvironmentSettings(environmentId, (settings) => settings.tots);
  const linksOn = useEnvironmentSettings(
    environmentId,
    (settings) => settings.linkedEnvironmentsEnabled,
  );
  return (
    <>
      {props.machine === null ? null : <SettingsRow title={`On ${props.machine}`} />}
      {linksOn ? null : (
        <SettingsRow
          title="Other machines"
          description="Turn on Linked environments in Labs, here and on each machine, so Tots can reach your other machines."
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
  const animate = useClientSettings((settings) => settings.animateTotAvatars);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const ref = tot.threadId === null ? null : scopeThreadRef(environmentId, tot.threadId);
  const shell = useThreadShell(ref);
  const actions = useTotActions(environmentId, tot);

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
            <Button size="sm" disabled={actions.pending} onClick={() => void actions.turnOn()}>
              Turn on
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void actions.openThread(tot.threadId!)}
            >
              Open
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={actions.edit}>
            Edit
          </Button>
          <Button size="sm" variant="outline" onClick={actions.openMemory}>
            Memory
          </Button>
          {actions.hasInstructionsFile ? (
            <Button size="sm" variant="outline" onClick={() => void actions.editInstructions()}>
              Instructions
            </Button>
          ) : null}
          {tot.threadId === null ? null : (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={actions.pending}
                onClick={() => void actions.startFresh()}
              >
                Start fresh
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={actions.pending}
                onClick={() => void actions.turnOff()}
              >
                Turn off
              </Button>
            </>
          )}
          {tot.id === HOME_TOT_ID ? null : (
            <Button
              size="sm"
              variant="destructive-outline"
              disabled={actions.pending}
              onClick={() => void actions.remove()}
            >
              Delete
            </Button>
          )}
        </div>
      }
    />
  );
}
