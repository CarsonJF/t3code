import * as Schema from "effect/Schema";

import { type ScheduledTaskId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import type { ScheduledTask, ScheduledTaskUpsertSchedule } from "./scheduledTask.ts";
import type { TotId } from "./tots.ts";

/**
 * A Tot's "Look around" is a read-only scheduled sweep. Its thread id names its task, so the
 * server treats the thread as read-only from the first turn, before the task binds it.
 */
const LOOK_AROUND_THREAD_PREFIX = "look-around:";

export const lookAroundThreadId = (taskId: ScheduledTaskId): ThreadId =>
  ThreadId.make(`${LOOK_AROUND_THREAD_PREFIX}${taskId}`);

export const isLookAroundThread = (threadId: string): boolean =>
  threadId.startsWith(LOOK_AROUND_THREAD_PREFIX);

/** Drivers whose adapters enforce a read-only sandbox with no approval prompts. */
const READ_ONLY_DRIVERS: ReadonlyArray<string> = ["codex", "claudeAgent"];

export const canEnforceReadOnly = (driver: string): boolean => READ_ONLY_DRIVERS.includes(driver);

export const LOOK_AROUND_DEFAULT_SCHEDULE: ScheduledTaskUpsertSchedule = {
  type: "interval",
  everyMs: 4 * 60 * 60 * 1000,
  weekdays: [1, 2, 3, 4, 5],
  activeHours: { from: "08:00", to: "20:00" },
};

export const LOOK_AROUND_DEFAULT_FOCUS =
  "Look over the work you watch for anything that needs attention.";

export const LOOK_AROUND_TITLE = "Look around";

export const LOOK_AROUND_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["ok", "attention"] },
    findings: { type: "array", items: { type: "string" }, maxItems: 10 },
  },
  required: ["status", "findings"],
  additionalProperties: false,
} as const;

export const LookAroundResult = Schema.Struct({
  status: Schema.Literals(["ok", "attention"]),
  findings: Schema.Array(Schema.String),
});
export type LookAroundResult = typeof LookAroundResult.Type;

/** Template settings for a Tot's sweep. Templates create it off. */
export const TotTemplateLookAround = Schema.Struct({
  focus: TrimmedNonEmptyString.check(Schema.isMaxLength(2_000)),
});
export type TotTemplateLookAround = typeof TotTemplateLookAround.Type;

/** A Tot's sweep task, if it has one. */
export const totLookAroundTask = (
  tasks: ReadonlyArray<ScheduledTask>,
  totId: TotId,
): ScheduledTask | undefined =>
  tasks.find((task) => task.readOnly === true && task.createdByTotId === totId);
