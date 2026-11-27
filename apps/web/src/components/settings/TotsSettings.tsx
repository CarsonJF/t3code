import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  resolveTotAnimation,
  totFaceInputFromShell,
  totFaceState,
} from "@t3tools/client-runtime/tots";
import { HOME_TOT_ID, type EnvironmentId, type Tot, type TotId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { ChevronLeftIcon, PlusIcon } from "lucide-react";
import type { EnvironmentGroupChat } from "@t3tools/client-runtime/tots";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useClientSettings, useEnvironmentSettings } from "../../hooks/useSettings";
import { useThreadShell } from "../../state/entities";
import { useGroupChats, useTotHosts, useTots } from "../../state/tots";
import { GroupChatAvatar, useGroupChatMembers } from "../tots/GroupChatAvatar";
import { openGroupChatEditor } from "../tots/GroupChatEditorDialog";
import { TotAvatar } from "../tots/TotAvatar";
import { TotSettingsHost } from "../tots/TotSettingsPanel";
import { useGroupChatActions } from "../tots/useGroupChatActions";
import { openTotMemory } from "../tots/TotMemoryDialog";
import { openTotEditor, useTotHostEnvironmentId } from "../tots/totEditorStore";
import { useTotActions } from "../tots/useTotActions";
import { Button } from "../ui/button";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import { TotMemoryTidySettings } from "./TotMemoryTidySettings";

const TOTS_DESCRIPTION =
  "Agents you talk to in one thread each. A Tot starts, watches and answers threads in its scope, on every machine it can reach.";

export function TotsSettings(props: {
  readonly environmentId?: EnvironmentId;
  readonly tot?: TotId;
}) {
  const hostEnvironmentId = useTotHostEnvironmentId();
  const environmentId = props.environmentId ?? hostEnvironmentId;
  if (props.tot !== undefined && environmentId !== null) {
    return <TotSettingsPage environmentId={environmentId} totId={props.tot} />;
  }
  return <TotsList environmentId={environmentId} />;
}

function TotSettingsPage(props: { readonly environmentId: EnvironmentId; readonly totId: TotId }) {
  const gt = useGT();
  const navigate = useNavigate();
  const tot = useEnvironmentSettings(props.environmentId, (settings) =>
    settings.tots.find((candidate) => candidate.id === props.totId),
  );
  const back = () => void navigate({ to: "/settings/tots", search: {} });
  return (
    <SettingsPageContainer>
      <div className="-mb-4 px-1">
        <Button size="sm" variant="ghost" onClick={back}>
          <ChevronLeftIcon />
          {gt("All Tots")}
        </Button>
      </div>
      {tot === undefined ? (
        <SettingsSection title={gt("Tot not found")}>
          <SettingsRow
            title={gt("This Tot is no longer available.")}
            description={gt("It may have been deleted or moved to another machine.")}
          />
        </SettingsSection>
      ) : (
        <TotSettingsPageSection key={tot.id} environmentId={props.environmentId} tot={tot} />
      )}
    </SettingsPageContainer>
  );
}

function TotSettingsPageSection(props: {
  readonly environmentId: EnvironmentId;
  readonly tot: Tot;
}) {
  const { environmentId, tot } = props;
  const gt = useGT();
  const animate = useClientSettings((settings) => settings.animateTotAvatars);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const shell = useThreadShell(
    tot.threadId === null ? null : scopeThreadRef(environmentId, tot.threadId),
  );
  const actions = useTotActions(environmentId, tot);
  return (
    <SettingsSection
      title={tot.name}
      icon={
        <TotAvatar
          avatar={tot.avatar}
          state={totFaceState(totFaceInputFromShell(tot, shell))}
          animation={resolveTotAnimation("other", animate, reducedMotion)}
          size={22}
        />
      }
      headerAction={
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {tot.threadId === null ? null : (
            <Button
              size="xs"
              variant="outline"
              onClick={() => void actions.openThread(tot.threadId!)}
            >
              {gt("Open thread")}
            </Button>
          )}
          <Button size="xs" variant="outline" onClick={actions.openMemory}>
            {gt("Memory")}
          </Button>
          {actions.hasInstructionsFile ? (
            <Button size="xs" variant="outline" onClick={() => void actions.editInstructions()}>
              {gt("Open AGENTS.md")}
            </Button>
          ) : null}
          {tot.threadId === null ? null : (
            <Button
              size="xs"
              variant="outline"
              disabled={actions.pending}
              onClick={() => void actions.startFresh()}
            >
              {gt("Start fresh")}
            </Button>
          )}
          {tot.id === HOME_TOT_ID ? null : (
            <Button
              size="xs"
              variant="destructive-outline"
              disabled={actions.pending}
              onClick={() => void actions.remove()}
            >
              {gt("Delete")}
            </Button>
          )}
        </div>
      }
    >
      <div className="px-3 py-3 sm:px-4">
        <TotSettingsHost environmentId={environmentId} totId={tot.id} layout="page" />
      </div>
    </SettingsSection>
  );
}

function TotsList(props: { readonly environmentId: EnvironmentId | null }) {
  const searchableSetting = useSearchableSetting();
  const { environmentId } = props;
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
      <SettingsSection
        title="Tots"
        headerAction={
          environmentId === null ? undefined : (
            <div className="flex items-center gap-1.5">
              <Button
                size="xs"
                variant="outline"
                onClick={() => openTotMemory({ environmentId, tot: null })}
              >
                Shared memory
              </Button>
              <Button
                size="xs"
                variant="outline"
                onClick={() => openTotEditor({ mode: "create", environmentId })}
              >
                <PlusIcon />
                New Tot
              </Button>
            </div>
          )
        }
      >
        {environmentId === null ? (
          <SettingsRow {...searchableSetting("tots")} description="Connect to a T3 server first." />
        ) : (
          <>
            <SettingsRow {...searchableSetting("tots")} description={TOTS_DESCRIPTION} />
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
      <TotMemoryTidySettings />
      <GroupChatsSection environmentId={environmentId} />
    </SettingsPageContainer>
  );
}

function GroupChatsSection(props: { readonly environmentId: EnvironmentId | null }) {
  const rooms = useGroupChats();
  const { environmentId } = props;
  if (environmentId === null) return null;
  return (
    <SettingsSection
      title="Group chats"
      headerAction={
        <Button
          size="xs"
          variant="outline"
          onClick={() => openGroupChatEditor({ mode: "create", environmentId })}
        >
          <PlusIcon />
          New group chat
        </Button>
      }
    >
      <SettingsRow
        title="Talk to several Tots at once"
        description="One shared thread you and several Tots talk in. Name a Tot with @ to ask it; with no name, the moderator answers. Tots can answer each other up to a limit you set."
      />
      {rooms.length === 0 ? (
        <SettingsRow title="No group chats yet" description="Start one with New group chat." />
      ) : null}
      {rooms.map((entry) => (
        <GroupChatRow key={`${entry.environmentId}:${entry.room.id}`} entry={entry} />
      ))}
    </SettingsSection>
  );
}

function GroupChatRow(props: { readonly entry: EnvironmentGroupChat }) {
  const { environmentId, room } = props.entry;
  const members = useGroupChatMembers(props.entry);
  const actions = useGroupChatActions(environmentId, room);
  return (
    <SettingsRow
      title={
        <span className="flex items-center gap-2">
          <GroupChatAvatar members={members} size={22} />
          {room.name}
        </span>
      }
      description={members.map((member) => member.tot.name).join(", ")}
      control={
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <Button size="sm" variant="outline" onClick={actions.open}>
            Open
          </Button>
          <Button size="sm" variant="outline" onClick={actions.edit}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="destructive-outline"
            disabled={actions.pending}
            onClick={() => void actions.remove()}
          >
            Delete
          </Button>
        </div>
      }
    />
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
      description={
        tot.threadId === null
          ? "Off"
          : tot.scope === "all"
            ? "On · everything in scope"
            : "On · scoped"
      }
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
            Settings
          </Button>
        </div>
      }
    />
  );
}
