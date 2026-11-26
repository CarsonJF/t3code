import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  lookAroundDraft,
  lookAroundSchedule,
  lookAroundSupport,
  lookAroundUpsert,
  type LookAroundDraft,
} from "@t3tools/client-runtime/tots/look-around";
import {
  AuthOrchestrationOperateScope,
  totLookAroundTask,
  type EnvironmentId,
  type ScheduledTask,
  type Tot,
} from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { useState } from "react";

import { useEnvironmentQuery } from "../../state/query";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { readEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { ScheduledRelativeLabel } from "../settings/ScheduledTasksSettings";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";

/** A Tot's opt-in read-only sweep: a scheduled task the server keeps from changing anything. */
export function TotLookAroundSection(props: {
  readonly environmentId: EnvironmentId;
  readonly tot: Tot;
}) {
  const gt = useGT();
  const tasksQuery = useEnvironmentQuery(
    serverEnvironment.scheduledTasksLive({ environmentId: props.environmentId, input: {} }),
  );
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(props.environmentId)) ??
    EMPTY_SERVER_PROVIDERS;
  const canOperate = useAtomValue(
    serverEnvironment.upsertScheduledTask.permissionAtom(props.environmentId),
  );
  const task =
    tasksQuery.data === null ? undefined : totLookAroundTask(tasksQuery.data.tasks, props.tot.id);
  const support = lookAroundSupport(props.tot, providers);
  const ready = props.tot.projectId !== null && props.tot.modelSelection !== null;
  return (
    <section className="flex flex-col gap-2.5">
      <div className="min-w-0">
        <h3 className="font-medium text-foreground text-sm">
          <T>Look around</T>
        </h3>
        <p className="text-muted-foreground text-xs">
          {gt(
            "A read-only sweep on a schedule. It can read files, run read-only commands and use T3 Code's read tools; the server refuses every change. It stays quiet when everything is fine and tells {name} when something needs attention.",
            { name: props.tot.name },
          )}
        </p>
      </div>
      {tasksQuery.data === null ? (
        <p className="text-muted-foreground text-xs" role="status">
          <T>Loading…</T>
        </p>
      ) : !ready ? (
        <p className="text-muted-foreground text-xs">
          {gt("Turn {name} on once to set up its sweep.", { name: props.tot.name })}
        </p>
      ) : (
        <LookAroundForm
          key={`${task?.id ?? "new"}:${task?.updatedAt ?? ""}`}
          environmentId={props.environmentId}
          tot={props.tot}
          task={task}
          support={support}
          canOperate={canOperate}
        />
      )}
      {support === "unsupported" ? (
        <p className="text-warning-foreground text-xs">
          {gt(
            "{name}'s provider cannot keep a sweep read-only, so it cannot be turned on. Pick a Codex or Claude model for this Tot.",
            { name: props.tot.name },
          )}
        </p>
      ) : null}
      {task === undefined ? null : <LookAroundLastSweep task={task} />}
    </section>
  );
}

function LookAroundForm(props: {
  readonly environmentId: EnvironmentId;
  readonly tot: Tot;
  readonly task: ScheduledTask | undefined;
  readonly support: ReturnType<typeof lookAroundSupport>;
  readonly canOperate: boolean;
}) {
  const gt = useGT();
  const upsert = useAtomCommand(serverEnvironment.upsertScheduledTask, { reportFailure: false });
  const [draft, setDraft] = useState<LookAroundDraft>(() => lookAroundDraft(props.task));
  const [saving, setSaving] = useState(false);
  const disabled = !props.canOperate || saving;
  const parsed = lookAroundSchedule(draft);
  // A sweep that is on can always be turned off; only turning one on needs the provider.
  const blocked = draft.enabled && props.task?.enabled !== true && props.support !== "supported";
  const save = async (next: LookAroundDraft) => {
    const schedule = lookAroundSchedule(next);
    if (!schedule.ok || !readEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope))
      return;
    const input = lookAroundUpsert({
      draft: next,
      schedule: schedule.schedule,
      tot: props.tot,
      task: props.task,
    });
    if (input === null) return;
    setSaving(true);
    const result = await upsert({ environmentId: props.environmentId, input });
    setSaving(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: gt("Could not save Look around"),
          description: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    toastManager.add({ type: "success", title: gt("Look around saved") });
  };
  const toggle = (enabled: boolean) => {
    const next = { ...draft, enabled };
    setDraft(next);
    if (props.task !== undefined || enabled) void save(next);
  };
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm">{draft.enabled ? <T>Sweeping on a schedule</T> : <T>Off</T>}</p>
        <Switch
          checked={draft.enabled}
          disabled={disabled || (!draft.enabled && props.support !== "supported")}
          aria-label={gt("Look around for {name}", { name: props.tot.name })}
          onCheckedChange={toggle}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`look-around-focus-${props.tot.id}`}>
          <T>What to check</T>
        </Label>
        <Textarea
          id={`look-around-focus-${props.tot.id}`}
          value={draft.focus}
          disabled={disabled}
          rows={2}
          placeholder={gt("Check CI on the fork, stale PRs, container health")}
          onChange={(event) => setDraft({ ...draft, focus: event.target.value })}
        />
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`look-around-every-${props.tot.id}`}>
            <T>Every (hours)</T>
          </Label>
          <Input
            id={`look-around-every-${props.tot.id}`}
            className="w-20"
            inputMode="numeric"
            value={draft.everyHours}
            disabled={disabled}
            onChange={(event) => setDraft({ ...draft, everyHours: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`look-around-from-${props.tot.id}`}>
            <T>Between</T>
          </Label>
          <div className="flex items-center gap-1">
            <Input
              id={`look-around-from-${props.tot.id}`}
              className="w-20"
              placeholder="08:00"
              value={draft.from}
              disabled={disabled}
              aria-label={gt("From")}
              onChange={(event) => setDraft({ ...draft, from: event.target.value })}
            />
            <span className="text-muted-foreground text-xs">–</span>
            <Input
              className="w-20"
              placeholder="20:00"
              value={draft.to}
              disabled={disabled}
              aria-label={gt("To")}
              onChange={(event) => setDraft({ ...draft, to: event.target.value })}
            />
          </div>
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <Checkbox
            checked={draft.weekdaysOnly}
            disabled={disabled}
            onCheckedChange={(checked) => setDraft({ ...draft, weekdaysOnly: checked })}
          />
          <T>Weekdays only</T>
        </label>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`look-around-precheck-${props.tot.id}`}>
          <T>Precheck (optional)</T>
        </Label>
        <Input
          id={`look-around-precheck-${props.tot.id}`}
          value={draft.precheck}
          disabled={disabled}
          // oxlint-disable-next-line t3code/no-untranslated-copy -- a shell command
          placeholder="test -f .needs-checking"
          onChange={(event) => setDraft({ ...draft, precheck: event.target.value })}
        />
        <p className="text-muted-foreground text-xs">
          <T>A shell command run first in the Tot's folder; a non-zero exit skips that sweep.</T>
        </p>
      </div>
      {!parsed.ok ? (
        <p className="text-destructive-foreground text-xs">
          {parsed.problem === "hours"
            ? gt("Enter a whole number of hours, at least 1.")
            : gt("Enter both times as HH:MM, or leave both empty for any time.")}
        </p>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        className="self-start"
        disabled={disabled || !parsed.ok || blocked}
        onClick={() => void save(draft)}
      >
        {saving ? gt("Saving…") : gt("Save Look around")}
      </Button>
    </div>
  );
}

function LookAroundLastSweep(props: { readonly task: ScheduledTask }) {
  const gt = useGT();
  const sweep = props.task.lastSweep;
  if (sweep === undefined) {
    return (
      <p className="text-muted-foreground text-xs">
        {props.task.lastRunStatus === "failed" && props.task.lastRunError
          ? gt("Last sweep failed: {error}", { error: props.task.lastRunError })
          : gt("No sweep yet.")}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={sweep.status === "ok" ? "success" : "warning"}>
          {sweep.status === "ok" ? gt("Last sweep: ok") : gt("Last sweep: needs attention")}
        </Badge>
        <span className="text-muted-foreground text-xs">
          <ScheduledRelativeLabel value={sweep.at} />
        </span>
      </div>
      {sweep.findings.length === 0 ? null : (
        <ul className="list-disc pl-5 text-muted-foreground text-xs">
          {sweep.findings.map((finding) => (
            <li key={finding}>{finding}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
