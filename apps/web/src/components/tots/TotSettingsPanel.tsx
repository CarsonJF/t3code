import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isTotProject,
  resolveTotAnimation,
  totFaceInputFromShell,
  totFaceState,
} from "@t3tools/client-runtime/tots";
import { totSkinSeriesOf, type TotSkinSeries } from "@t3tools/client-runtime/tots/skins";
import {
  AuthOrchestrationOperateScope,
  parseTotThreadId,
  TOT_THEME_MAX_LENGTH,
  TOT_WATCH_REPORTS,
  type EnvironmentId,
  type ScheduledTask,
  type ScopedThreadRef,
  type Tot,
  type TotScope,
  type TotWatch,
  type TotWatchReports,
} from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { TOT_THEME_TOKEN_NAMES } from "@t3tools/shared/totThemeTokens";
import { EyeIcon, Globe2, PlayIcon, Trash2Icon } from "lucide-react";
import { T, useGT } from "gt-react";
import { type ReactNode, useState } from "react";

import { useClientSettings, useEnvironmentSettings } from "../../hooks/useSettings";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { requestConfirmDialog } from "../../confirmDialog";
import { useThreadGroupsStore } from "../../threadGroupsStore";
import { useProjects, useQuietThreadShell, useThreadShell } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { readEnvironmentScope } from "../../state/session";
import { useTots } from "../../state/tots";
import { useAtomCommand } from "../../state/use-atom-command";
import { ScheduledRelativeLabel } from "../settings/ScheduledTasksSettings";
import { scheduleLabel } from "../settings/scheduledTasksSettings.logic";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Separator } from "../ui/separator";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import { TotAvatar } from "./TotAvatar";
import { AvatarLibraryDialog } from "../settings/AvatarLibrarySettings";
import { TotFaceEditor } from "./TotFaceEditor";
import {
  WATCH_REPORTS,
  finishedOneOffTasks,
  scheduledTaskBelongsToTot,
  scheduledTaskScopeLabel,
  totSettingsDraftErrors,
  totSettingsDraftFromTot,
  totSettingsDraftKey,
  totSettingsDraftUpdate,
  TOT_IDLE_COMPACTION,
  type TotIdleCompactionChoice,
  totIdleCompactionChoice,
  totIdleCompactionValue,
  webhookFilterSummary,
  type TotSettingsDraft,
} from "./totSettingsPanel.logic";

const WATCH_REASON_LABELS: Record<TotWatch["reason"], string> = {
  launched: "Launched by this Tot",
  requested: "Asked to watch",
  sent: "A run from another Tot",
};

const LAST_RUN_VARIANT: Record<
  ScheduledTask["lastRunStatus"],
  "outline" | "info" | "success" | "error"
> = {
  never: "outline",
  running: "info",
  succeeded: "success",
  failed: "error",
};

function reportFailure(title: string, error: unknown) {
  toastManager.add({
    type: "error",
    title,
    description: error instanceof Error ? error.message : String(error),
  });
}

/** The Tot of a Tot thread, in the right panel while its thread is open. */
export function TotSettingsPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
}) {
  const totId = parseTotThreadId(props.threadRef.threadId);
  if (totId === null) return null;
  return (
    <TotSettingsPanelHost
      key={`${props.environmentId}:${totId}`}
      environmentId={props.environmentId}
      threadRef={props.threadRef}
      totId={totId}
    />
  );
}

function TotSettingsPanelHost(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly totId: NonNullable<ReturnType<typeof parseTotThreadId>>;
}) {
  const tot = useEnvironmentSettings(props.environmentId, (settings) =>
    settings.tots.find((candidate) => candidate.id === props.totId),
  );
  if (tot === undefined) {
    return (
      <p className="p-4 text-sm text-muted-foreground" role="status">
        This Tot is no longer available.
      </p>
    );
  }
  return (
    <TotSettingsEditor
      key={tot.id}
      environmentId={props.environmentId}
      threadRef={props.threadRef}
      tot={tot}
    />
  );
}

function TotSettingsEditor(props: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly tot: Tot;
}) {
  const { environmentId, tot } = props;
  const [libraryOpen, setLibraryOpen] = useState(false);
  const animate = useClientSettings((settings) => settings.animateTotAvatars);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const shell = useThreadShell(props.threadRef);
  const faceState = totFaceState(totFaceInputFromShell(tot, shell));
  const canEdit = useAtomValue(serverEnvironment.updateTot.permissionAtom(environmentId));
  const updateTot = useAtomCommand(serverEnvironment.updateTot, { reportFailure: false });
  const enableTot = useAtomCommand(serverEnvironment.enableTot, { reportFailure: false });
  const disableTot = useAtomCommand(serverEnvironment.disableTot, { reportFailure: false });
  const [draft, setDraft] = useState<TotSettingsDraft>(() => totSettingsDraftFromTot(tot));
  const [savedKey, setSavedKey] = useState(() => totSettingsDraftKey(draft));
  const [skinSeries, setSkinSeries] = useState<TotSkinSeries>(() =>
    totSkinSeriesOf(tot.avatar.skin ?? null),
  );
  const [saving, setSaving] = useState(false);
  const [savingEnabled, setSavingEnabled] = useState(false);
  const errors = totSettingsDraftErrors(draft);
  const dirty = totSettingsDraftKey(draft) !== savedKey;
  const enabled = tot.threadId !== null;

  const save = async () => {
    if (!canEdit || saving || !dirty || Object.keys(errors).length > 0) return;
    const update = totSettingsDraftUpdate(draft);
    setSaving(true);
    const result = await updateTot({
      environmentId,
      input: { id: tot.id, ...update },
    });
    setSaving(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        reportFailure(`Could not save ${tot.name}`, squashAtomCommandFailure(result));
      }
      return;
    }
    setDraft(update);
    setSavedKey(totSettingsDraftKey(update));
    toastManager.add({ type: "success", title: `${update.name} saved` });
  };

  const discard = () => {
    const next = totSettingsDraftFromTot(tot);
    setDraft(next);
    setSavedKey(totSettingsDraftKey(next));
    setSkinSeries(totSkinSeriesOf(next.avatar.skin ?? null));
  };

  const setEnabled = async (next: boolean) => {
    if (!canEdit || savingEnabled) return;
    setSavingEnabled(true);
    const result = next
      ? await enableTot({ environmentId, input: { id: tot.id } })
      : await disableTot({ environmentId, input: { id: tot.id } });
    setSavingEnabled(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      reportFailure(
        next ? `Could not turn on ${tot.name}` : `Could not turn off ${tot.name}`,
        squashAtomCommandFailure(result),
      );
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-5 p-4">
          <div className="flex items-center gap-3">
            <TotAvatar
              avatar={draft.avatar}
              state={faceState}
              animation={resolveTotAnimation("own-view", animate, reducedMotion)}
              size={52}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Label htmlFor="tot-panel-name">Name</Label>
              <Input
                id="tot-panel-name"
                value={draft.name}
                placeholder="Yui"
                disabled={!canEdit}
                aria-invalid={errors.name !== undefined}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
              {errors.name ? (
                <p className="text-destructive-foreground text-xs">{errors.name}</p>
              ) : null}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-sm">Enabled</p>
              <p className="text-xs text-muted-foreground">
                {enabled
                  ? "On. It has its own thread to work in."
                  : "Off. Turning it on starts a thread for it."}
              </p>
            </div>
            <Switch
              checked={enabled}
              disabled={!canEdit || savingEnabled}
              aria-label={enabled ? `Turn off ${tot.name}` : `Turn on ${tot.name}`}
              onCheckedChange={(next) => void setEnabled(next)}
            />
          </div>

          <Separator />

          <PanelSection title="Face" description="The face shown in the sidebar and this thread.">
            <TotFaceEditor
              value={draft.avatar}
              onChange={(avatar) => setDraft({ ...draft, avatar })}
              skinSeries={skinSeries}
              onSkinSeriesChange={setSkinSeries}
              error={errors.color}
              onManageShapes={() => setLibraryOpen(true)}
            >
              {tot.designs !== undefined && tot.designs.length > 0 ? (
                <div
                  className="flex flex-wrap items-center gap-1.5"
                  role="group"
                  aria-label="Faces this Tot designed"
                >
                  {tot.designs.map((design, index) => (
                    <button
                      key={JSON.stringify(design)}
                      type="button"
                      aria-label={`Use saved face ${index + 1}`}
                      className="rounded-md border border-transparent p-0.5 hover:border-ring"
                      onClick={() => {
                        setDraft({ ...draft, avatar: design });
                        setSkinSeries(totSkinSeriesOf(design.skin ?? null));
                      }}
                    >
                      <TotAvatar avatar={design} state="idle" animation="still" size={28} />
                    </button>
                  ))}
                </div>
              ) : null}
            </TotFaceEditor>
            <AvatarLibraryDialog
              environmentId={environmentId}
              open={libraryOpen}
              onOpenChange={setLibraryOpen}
              color={draft.avatar.color}
            />
          </PanelSection>

          <Separator />

          <TotScopeEditor
            environmentId={environmentId}
            scope={draft.scope}
            disabled={!canEdit}
            error={errors.scope}
            onChange={(scope) => setDraft({ ...draft, scope })}
          />

          <Separator />

          <PanelSection
            title="Instructions"
            description="Personality and instructions, saved to AGENTS.md in this Tot's folder."
          >
            <Textarea
              aria-label="Tot instructions"
              className="min-h-36 resize-y"
              value={draft.instructions}
              disabled={!canEdit}
              placeholder="Warm and brief. Owns everything Cardinal Systems."
              onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
            />
          </PanelSection>

          <Separator />

          <PanelSection
            title="Theme"
            description="This Tot's own conversation only; the sidebar and other threads keep the app's theme."
          >
            <label className="flex flex-col gap-1">
              <span className="font-medium text-xs">CSS</span>
              <Textarea
                aria-label="Tot theme CSS"
                className="min-h-28 resize-y"
                value={draft.theme.css}
                disabled={!canEdit}
                placeholder={".messages-timeline-scroll { background: #101820; }"}
                onChange={(event) =>
                  setDraft({ ...draft, theme: { ...draft.theme, css: event.target.value } })
                }
              />
              <span className="text-xs text-muted-foreground">
                Mobile paints {TOT_THEME_TOKEN_NAMES.join(", ")} from <code>:root</code>; other
                rules are web-only.
              </span>
              <span className="self-end text-xs text-muted-foreground">
                {draft.theme.css.length.toLocaleString()} / {TOT_THEME_MAX_LENGTH.toLocaleString()}
              </span>
              {errors.themeCss ? (
                <p className="text-destructive-foreground text-xs">{errors.themeCss}</p>
              ) : null}
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-medium text-xs">Effect</span>
              {/* Opaque text: this editor stores it and shows it; nothing here runs it. */}
              <span className="text-xs text-muted-foreground">
                Stored for the effect layer; not run here.
              </span>
              <Textarea
                aria-label="Tot theme effect"
                className="min-h-20 resize-y"
                value={draft.theme.effect}
                disabled={!canEdit}
                onChange={(event) =>
                  setDraft({ ...draft, theme: { ...draft.theme, effect: event.target.value } })
                }
              />
              <span className="self-end text-xs text-muted-foreground">
                {draft.theme.effect.length.toLocaleString()} /{" "}
                {TOT_THEME_MAX_LENGTH.toLocaleString()}
              </span>
              {errors.themeEffect ? (
                <p className="text-destructive-foreground text-xs">{errors.themeEffect}</p>
              ) : null}
            </label>
          </PanelSection>

          <Separator />

          <TotScheduledTasksSection environmentId={environmentId} tot={tot} />

          <Separator />

          <TotWatchReportsSection
            value={draft.watchReports}
            disabled={!canEdit}
            onChange={(watchReports) => setDraft({ ...draft, watchReports })}
          />

          <Separator />

          <TotIdleCompactionSection
            value={totIdleCompactionChoice(draft.idleCompaction)}
            disabled={!canEdit}
            onChange={(choice) =>
              setDraft({ ...draft, idleCompaction: totIdleCompactionValue(choice) })
            }
          />

          <Separator />

          <TotMemoryTidySection
            environmentId={environmentId}
            tot={tot}
            value={draft.memoryTidy}
            disabled={!canEdit}
            onChange={(memoryTidy) => setDraft({ ...draft, memoryTidy })}
          />

          <Separator />

          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-sm">Auto-settle its thread</p>
              <p className="text-xs text-muted-foreground">
                {draft.autoSettle
                  ? "Its thread settles after inactivity, like other threads."
                  : "Its thread stays open, whatever the auto-settle settings say."}
              </p>
            </div>
            <Switch
              checked={draft.autoSettle}
              disabled={!canEdit}
              aria-label={`Auto-settle ${tot.name}'s thread`}
              onCheckedChange={(autoSettle) => setDraft({ ...draft, autoSettle })}
            />
          </div>

          <Separator />

          <TotWatchesSection environmentId={environmentId} tot={tot} />
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border/60 bg-background p-3">
        {dirty ? (
          <span className="mr-auto text-xs text-muted-foreground">Unsaved changes</span>
        ) : null}
        <Button size="sm" variant="outline" disabled={!dirty || saving} onClick={discard}>
          Discard
        </Button>
        <Button
          size="sm"
          disabled={!canEdit || !dirty || saving || Object.keys(errors).length > 0}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function TotMemoryTidySection(props: {
  readonly environmentId: EnvironmentId;
  readonly tot: Tot;
  readonly value: boolean;
  readonly disabled: boolean;
  readonly onChange: (value: boolean) => void;
}) {
  const gt = useGT();
  const revert = useAtomCommand(serverEnvironment.revertTotMemoryTidy, { reportFailure: false });
  const [reverting, setReverting] = useState(false);
  const revertLast = async () => {
    setReverting(true);
    const result = await revert({
      environmentId: props.environmentId,
      input: { id: props.tot.id },
    });
    setReverting(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        reportFailure(gt("Could not revert the tidy-up"), squashAtomCommandFailure(result));
      }
      return;
    }
    toastManager.add({ type: "success", title: gt("Last memory tidy-up reverted") });
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-sm">
            <T>Nightly memory tidy-up</T>
          </p>
          <p className="text-xs text-muted-foreground">
            {gt(
              "Around 03:30 a cheap model dedupes and condenses its {memory}, keeping lines you deleted out. The previous copy is kept as {backup} and the diff in {diff}.",
              {
                memory: "MEMORY.md",
                backup: "MEMORY.md.pre-tidy",
                diff: "memory/tidy/last.diff",
              },
            )}
          </p>
        </div>
        <Switch
          checked={props.value}
          disabled={props.disabled}
          aria-label={gt("Nightly memory tidy-up for {name}", { name: props.tot.name })}
          onCheckedChange={props.onChange}
        />
      </div>
      <Button
        size="sm"
        variant="outline"
        className="self-start"
        disabled={props.disabled || reverting}
        onClick={() => void revertLast()}
      >
        {reverting ? gt("Reverting…") : gt("Revert last tidy-up")}
      </Button>
    </div>
  );
}

function PanelSection(props: {
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-medium text-foreground text-sm">{props.title}</h3>
          {props.description ? (
            <p className="text-muted-foreground text-xs">{props.description}</p>
          ) : null}
        </div>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}

function TotScopeEditor(props: {
  readonly environmentId: EnvironmentId;
  readonly scope: TotScope;
  readonly disabled: boolean;
  readonly error?: string | undefined;
  readonly onChange: (scope: TotScope) => void;
}) {
  const tots = useTots();
  const projects = useProjects();
  const groups = useThreadGroupsStore().groups;
  const environmentTots = tots
    .filter((entry) => entry.environmentId === props.environmentId)
    .map((entry) => entry.tot);
  const projectChoices = projects.filter(
    (project) =>
      project.environmentId === props.environmentId &&
      project.isScratch !== true &&
      !isTotProject(project.id, environmentTots),
  );
  const groupNames = [...new Set(groups.map((group) => group.name))].sort((left, right) =>
    left.localeCompare(right),
  );
  const selectedProjectIds = new Set(
    props.scope === "all" ? [] : props.scope.projects.map((entry) => entry.projectId),
  );
  const setAll = (checked: boolean) => {
    if (props.disabled) return;
    props.onChange(checked ? "all" : { projects: [], groups: [] });
  };
  const toggleProject = (projectId: (typeof projectChoices)[number]["id"], on: boolean) => {
    if (props.disabled || props.scope === "all") return;
    const current = props.scope.projects;
    const projects = on
      ? [...current, { environmentId: props.environmentId, projectId }]
      : current.filter((entry) => entry.projectId !== projectId);
    props.onChange({ projects, groups: props.scope.groups });
  };
  const toggleGroup = (name: string, on: boolean) => {
    if (props.disabled || props.scope === "all") return;
    props.onChange({
      projects: props.scope.projects,
      groups: on
        ? [...props.scope.groups, name]
        : props.scope.groups.filter((group) => group !== name),
    });
  };
  return (
    <PanelSection title="Scope" description="What this Tot owns and watches.">
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={props.scope === "all"}
          disabled={props.disabled}
          onCheckedChange={(checked) => setAll(checked)}
        />
        Everything, on every machine
      </label>
      {props.scope === "all" ? null : (
        <div className="max-h-64 space-y-3 overflow-y-auto rounded-md border border-border/60 p-2.5">
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              Projects
            </p>
            {projectChoices.length === 0 ? (
              <p className="text-muted-foreground text-xs">No projects on this machine.</p>
            ) : (
              projectChoices.map((project) => (
                <label key={project.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={selectedProjectIds.has(project.id)}
                    disabled={props.disabled}
                    onCheckedChange={(checked) => toggleProject(project.id, checked)}
                  />
                  <span className="truncate">{project.title}</span>
                </label>
              ))
            )}
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              Groups
            </p>
            {groupNames.length === 0 ? (
              <p className="text-muted-foreground text-xs">No thread groups yet.</p>
            ) : (
              groupNames.map((name) => (
                <label key={name} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={props.scope !== "all" && props.scope.groups.includes(name)}
                    disabled={props.disabled}
                    onCheckedChange={(checked) => toggleGroup(name, checked)}
                  />
                  <span className="truncate">{name}</span>
                </label>
              ))
            )}
          </div>
        </div>
      )}
      {props.error ? <p className="text-destructive-foreground text-xs">{props.error}</p> : null}
    </PanelSection>
  );
}

function TotScheduledTasksSection(props: {
  readonly environmentId: EnvironmentId;
  readonly tot: Tot;
}) {
  const tasksQuery = useEnvironmentQuery(
    serverEnvironment.scheduledTasksLive({ environmentId: props.environmentId, input: {} }),
  );
  const projects = useProjects();
  const canOperate = useAtomValue(
    serverEnvironment.setScheduledTaskEnabled.permissionAtom(props.environmentId),
  );
  const remove = useAtomCommand(serverEnvironment.deleteScheduledTask, { reportFailure: false });
  const [clearing, setClearing] = useState(false);
  const timeZone = tasksQuery.data?.timeZone;
  const tasks = (tasksQuery.data?.tasks ?? []).filter((task) =>
    scheduledTaskBelongsToTot(task, props.tot),
  );
  const projectTitles = new Map(
    projects
      .filter((project) => project.environmentId === props.environmentId)
      .map((project) => [project.id, project.title] as const),
  );
  const finished = finishedOneOffTasks(tasks);
  const clearFinished = async () => {
    if (clearing || finished.length === 0 || !canOperate) return;
    if (!readEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope)) return;
    const count = finished.length;
    const message = `Delete ${count} finished one-off ${count === 1 ? "task" : "tasks"}?\nThey already ran and will not run again. This cannot be undone.`;
    const confirmed =
      (await requestConfirmDialog(message, { variant: "destructive" })) ?? window.confirm(message);
    if (!confirmed) return;
    setClearing(true);
    for (const task of finished) {
      const result = await remove({ environmentId: props.environmentId, input: { id: task.id } });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        reportFailure(`Could not delete "${task.title}"`, squashAtomCommandFailure(result));
      }
    }
    setClearing(false);
  };
  return (
    <PanelSection
      title="Scheduled tasks"
      description="Routines this Tot runs on a schedule or from a webhook."
      action={
        finished.length === 0 ? undefined : (
          <Button
            size="xs"
            variant="outline"
            disabled={clearing || !canOperate}
            onClick={() => void clearFinished()}
          >
            {clearing ? "Clearing…" : "Clear finished"}
          </Button>
        )
      }
    >
      {tasksQuery.error !== null ? (
        <p className="text-destructive-foreground text-xs">
          Could not load scheduled tasks: {tasksQuery.error}
        </p>
      ) : tasksQuery.data === null ? (
        <p className="text-muted-foreground text-xs" role="status">
          Loading scheduled tasks…
        </p>
      ) : tasks.length === 0 ? (
        <div className="rounded-md border border-border/60 p-2.5">
          <p className="text-muted-foreground text-xs">
            No scheduled tasks for this Tot. Ask {props.tot.name} to make one.
          </p>
        </div>
      ) : (
        <ul className="flex list-none flex-col gap-2 p-0">
          {tasks.map((task) => (
            <TotScheduledTaskRow
              key={task.id}
              environmentId={props.environmentId}
              task={task}
              scopeLabel={scheduledTaskScopeLabel(
                task,
                props.tot,
                projectTitles.get(task.projectId),
              )}
              timeZone={timeZone}
              canOperate={canOperate}
            />
          ))}
        </ul>
      )}
    </PanelSection>
  );
}

function TotScheduledTaskRow(props: {
  readonly environmentId: EnvironmentId;
  readonly task: ScheduledTask;
  readonly scopeLabel: string;
  readonly timeZone: string | undefined;
  readonly canOperate: boolean;
}) {
  const { task } = props;
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const [busy, setBusy] = useState(false);
  const toggleEnabled = useAtomCommand(serverEnvironment.setScheduledTaskEnabled, {
    reportFailure: false,
  });
  const runNow = useAtomCommand(serverEnvironment.runScheduledTaskNow, { reportFailure: false });
  const remove = useAtomCommand(serverEnvironment.deleteScheduledTask, { reportFailure: false });
  const isWebhook = task.schedule.type === "webhook";
  const act = async (action: "toggle" | "run" | "delete") => {
    if (
      busy ||
      !props.canOperate ||
      !readEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope)
    ) {
      return;
    }
    if (action === "delete") {
      const message = `Delete "${task.title}"?\nThis cannot be undone.`;
      const confirmed =
        (await requestConfirmDialog(message, { variant: "destructive" })) ??
        window.confirm(message);
      if (!confirmed) return;
    }
    setBusy(true);
    const result =
      action === "toggle"
        ? await toggleEnabled({
            environmentId: props.environmentId,
            input: { id: task.id, enabled: !task.enabled },
          })
        : action === "run"
          ? await runNow({ environmentId: props.environmentId, input: { id: task.id } })
          : await remove({ environmentId: props.environmentId, input: { id: task.id } });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      reportFailure("Could not update scheduled task", squashAtomCommandFailure(result));
    }
  };
  return (
    <li className="rounded-lg border border-border/60 bg-card/40 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <p className="min-w-0 truncate font-medium text-sm">{task.title}</p>
            <span className="shrink-0 text-muted-foreground text-xs">{props.scopeLabel}</span>
          </div>
          <p className="mt-0.5 text-muted-foreground text-xs">
            {isWebhook ? (
              <>
                <Badge variant="info" size="sm" className="mr-1 align-middle">
                  Webhook
                </Badge>
                {webhookFilterSummary(task.schedule.filters)}
              </>
            ) : (
              scheduleLabelForPanel(task, timestampFormat, props.timeZone)
            )}
          </p>
          <p className="mt-0.5 text-muted-foreground text-xs">
            {task.blockedByPolicy !== undefined ? (
              task.blockedByPolicy
            ) : !task.enabled ? (
              "Paused"
            ) : isWebhook ? (
              "Listening for requests"
            ) : task.nextRunAt !== null ? (
              <>
                Next run <ScheduledRelativeLabel value={task.nextRunAt} />
              </>
            ) : (
              "Not scheduled"
            )}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant={LAST_RUN_VARIANT[task.lastRunStatus]}>
              {task.lastRunStatus === "never" ? "Never run" : task.lastRunStatus}
            </Badge>
            {task.lastRunAt !== null ? (
              <span className="text-muted-foreground text-xs">
                last run <ScheduledRelativeLabel value={task.lastRunAt} />
              </span>
            ) : null}
            {task.lastRunError ? (
              <span className="line-clamp-2 text-destructive-foreground text-xs">
                {task.lastRunError}
              </span>
            ) : null}
          </div>
        </div>
        <Switch
          checked={task.enabled}
          disabled={busy || !props.canOperate}
          aria-label={task.enabled ? `Pause ${task.title}` : `Resume ${task.title}`}
          onCheckedChange={() => void act("toggle")}
        />
      </div>
      <div className="mt-2 flex items-center justify-end gap-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="xs"
                variant="outline"
                disabled={busy || !props.canOperate || task.lastRunStatus === "running"}
                onClick={() => void act("run")}
              />
            }
          >
            <PlayIcon />
            Run now
          </TooltipTrigger>
          <TooltipPopup>Run this task now</TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost-destructive"
                aria-label={`Delete ${task.title}`}
                disabled={busy || !props.canOperate}
                onClick={() => void act("delete")}
              />
            }
          >
            <Trash2Icon />
          </TooltipTrigger>
          <TooltipPopup>Delete task</TooltipPopup>
        </Tooltip>
      </div>
    </li>
  );
}

function scheduleLabelForPanel(
  task: ScheduledTask,
  timestampFormat: TimestampFormat,
  timeZone: string | undefined,
) {
  if (task.schedule.type === "webhook") return "Webhook";
  return scheduleLabel(task.schedule, timestampFormat, timeZone, task.nextRunAt);
}

function TotWatchReportsSection(props: {
  readonly value: TotWatchReports;
  readonly disabled: boolean;
  readonly onChange: (value: TotWatchReports) => void;
}) {
  const option = WATCH_REPORTS[props.value];
  return (
    <PanelSection title="Watch reports" description={option.help}>
      <Select
        value={props.value}
        onValueChange={(value) => props.onChange(value as TotWatchReports)}
      >
        <SelectTrigger size="sm" aria-label="Watch reports" disabled={props.disabled}>
          <SelectValue>{option.label}</SelectValue>
        </SelectTrigger>
        <SelectPopup alignItemWithTrigger={false}>
          {TOT_WATCH_REPORTS.map((mode) => (
            <SelectItem key={mode} value={mode}>
              {WATCH_REPORTS[mode].label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </PanelSection>
  );
}

const TOT_IDLE_COMPACTION_CHOICES = ["default", "on", "off"] as const;

function TotIdleCompactionSection(props: {
  readonly value: TotIdleCompactionChoice;
  readonly disabled: boolean;
  readonly onChange: (value: TotIdleCompactionChoice) => void;
}) {
  const option = TOT_IDLE_COMPACTION[props.value];
  return (
    <PanelSection title="Compact when idle" description={option.help}>
      <Select
        value={props.value}
        onValueChange={(value) => props.onChange(value as TotIdleCompactionChoice)}
      >
        <SelectTrigger size="sm" aria-label="Compact when idle" disabled={props.disabled}>
          <SelectValue>{option.label}</SelectValue>
        </SelectTrigger>
        <SelectPopup alignItemWithTrigger={false}>
          {TOT_IDLE_COMPACTION_CHOICES.map((choice) => (
            <SelectItem key={choice} value={choice}>
              {TOT_IDLE_COMPACTION[choice].label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </PanelSection>
  );
}

function TotWatchesSection(props: { readonly environmentId: EnvironmentId; readonly tot: Tot }) {
  return (
    <PanelSection
      title="Watches"
      description="Threads this Tot is told about. Read-only here; it manages these itself."
    >
      <div className="overflow-hidden rounded-md border border-border/60">
        <div className="flex items-center justify-between gap-2 px-2.5 py-2">
          <span className="flex items-center gap-2 text-sm">
            <Globe2 className="size-3.5 text-muted-foreground" />
            Every thread
          </span>
          <Badge variant={props.tot.watchAll ? "success" : "outline"}>
            {props.tot.watchAll ? "Watching" : "Off"}
          </Badge>
        </div>
        {props.tot.watches.length === 0 ? (
          <p className="border-t border-border/60 px-2.5 py-2 text-muted-foreground text-xs">
            No watched threads.
          </p>
        ) : (
          props.tot.watches.map((watch) => (
            <TotWatchRow
              key={`${watch.environmentId}:${watch.threadId}:${watch.reason}:${watch.runId ?? ""}`}
              watch={watch}
            />
          ))
        )}
      </div>
    </PanelSection>
  );
}

function TotWatchRow(props: { readonly watch: TotWatch }) {
  const shell = useQuietThreadShell(
    scopeThreadRef(props.watch.environmentId, props.watch.threadId),
  );
  return (
    <div className="flex items-center gap-2 border-t border-border/60 px-2.5 py-2">
      <EyeIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm">
        {shell?.title.trim() || props.watch.threadId}
      </span>
      <span className="shrink-0 text-muted-foreground text-xs">
        {WATCH_REASON_LABELS[props.watch.reason]}
      </span>
    </div>
  );
}
