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
} from "@t3tools/client-runtime/tots/look-around";
import { totLookAroundTask, type EnvironmentId, type Tot } from "@t3tools/contracts";
import { useGT } from "gt-react-native";
import { useState } from "react";

import { AppText, AppTextInput } from "../../components/ui/AppText";
import { ListSection } from "../../components/ui/ListSection";
import { ListToggleRow } from "../../components/ui/ListToggleRow";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";

/** A Tot's opt-in read-only sweep. The schedule and precheck are edited on desktop or web. */
export function TotLookAroundSection(props: {
  readonly environmentId: EnvironmentId;
  readonly tot: Tot;
}) {
  const gt = useGT();
  const tasks = useEnvironmentQuery(
    serverEnvironment.scheduledTasksLive({ environmentId: props.environmentId, input: {} }),
  );
  const providers = useAtomValue(serverEnvironment.providersValueAtom(props.environmentId)) ?? [];
  const canOperate = useAtomValue(
    serverEnvironment.upsertScheduledTask.permissionAtom(props.environmentId),
  );
  const upsert = useAtomCommand(serverEnvironment.upsertScheduledTask, { reportFailure: false });
  const task = tasks.data === null ? undefined : totLookAroundTask(tasks.data.tasks, props.tot.id);
  const support = lookAroundSupport(props.tot, providers);
  const [focus, setFocus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const ready = tasks.data !== null && props.tot.projectId !== null;
  const save = async (enabled: boolean) => {
    const draft = { ...lookAroundDraft(task), enabled, ...(focus === null ? {} : { focus }) };
    const schedule = lookAroundSchedule(draft);
    if (!schedule.ok) return;
    const input = lookAroundUpsert({ draft, schedule: schedule.schedule, tot: props.tot, task });
    if (input === null) return;
    setSaving(true);
    setFailure(null);
    const result = await upsert({ environmentId: props.environmentId, input });
    setSaving(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      setFailure(error instanceof Error ? error.message : String(error));
    }
  };
  const sweep = task?.lastSweep;
  const status =
    sweep === undefined
      ? gt("No sweep yet.")
      : sweep.status === "ok"
        ? gt("Last sweep: ok, {time}", { time: new Date(sweep.at).toLocaleString() })
        : gt("Last sweep needs attention: {findings}", { findings: sweep.findings.join("; ") });
  return (
    <ListSection
      title={gt("Look around")}
      footer={
        support === "unsupported"
          ? gt("This Tot's provider cannot keep a sweep read-only. Pick a Codex or Claude model.")
          : gt(
              "A read-only sweep on a schedule; the server refuses every change. Quiet when all is fine. Change its schedule and precheck on desktop or web.",
            )
      }
    >
      <ListToggleRow
        label={gt("Look around")}
        description={ready ? status : gt("Turn the Tot on once to set up its sweep.")}
        value={task?.enabled ?? false}
        disabled={
          !ready || !canOperate || saving || (task?.enabled !== true && support !== "supported")
        }
        onValueChange={(enabled) => void save(enabled)}
      />
      <AppTextInput
        className="px-4 py-3 text-base text-foreground"
        value={focus ?? task?.prompt ?? ""}
        placeholder={gt("What to check, such as CI on the fork or container health")}
        editable={ready && canOperate && !saving}
        multiline
        onChangeText={setFocus}
        onEndEditing={() => {
          if (focus !== null && task !== undefined) void save(task.enabled);
        }}
        accessibilityLabel={gt("What to check")}
      />
      {failure === null ? null : (
        <AppText className="px-4 pb-3 text-sm text-destructive">{failure}</AppText>
      )}
    </ListSection>
  );
}
