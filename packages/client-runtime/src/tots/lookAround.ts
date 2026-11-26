import {
  canEnforceReadOnly,
  LOOK_AROUND_DEFAULT_FOCUS,
  LOOK_AROUND_DEFAULT_SCHEDULE,
  LOOK_AROUND_TITLE,
  type ScheduledTask,
  type ScheduledTaskUpsertInput,
  type ScheduledTaskUpsertSchedule,
  type ServerProvider,
  type Tot,
} from "@t3tools/contracts";

const HOUR_MS = 60 * 60 * 1000;
const WEEKDAYS = [1, 2, 3, 4, 5];
const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** A Tot's Look around settings as their form fields hold them. */
export interface LookAroundDraft {
  readonly enabled: boolean;
  readonly focus: string;
  readonly everyHours: string;
  readonly weekdaysOnly: boolean;
  /** Both empty: any time of day. */
  readonly from: string;
  readonly to: string;
  readonly precheck: string;
}

const DEFAULT_SCHEDULE = LOOK_AROUND_DEFAULT_SCHEDULE as Extract<
  ScheduledTaskUpsertSchedule,
  { type: "interval" }
>;

export function lookAroundDraft(task: ScheduledTask | undefined): LookAroundDraft {
  const schedule = task?.schedule.type === "interval" ? task.schedule : DEFAULT_SCHEDULE;
  return {
    enabled: task?.enabled ?? false,
    focus: task?.prompt ?? LOOK_AROUND_DEFAULT_FOCUS,
    everyHours: String(Math.max(1, Math.round(schedule.everyMs / HOUR_MS))),
    weekdaysOnly: (schedule.weekdays ?? []).length > 0,
    from: schedule.activeHours?.from ?? "",
    to: schedule.activeHours?.to ?? "",
    precheck: task?.precheck ?? "",
  };
}

export type LookAroundDraftProblem = "hours" | "window";

/** The schedule a draft describes, or what is wrong with it. */
export function lookAroundSchedule(
  draft: LookAroundDraft,
):
  | { readonly ok: true; readonly schedule: ScheduledTaskUpsertSchedule }
  | { readonly ok: false; readonly problem: LookAroundDraftProblem } {
  const hours = Number(draft.everyHours);
  if (!Number.isInteger(hours) || hours < 1 || hours > 24 * 7) {
    return { ok: false, problem: "hours" };
  }
  const from = draft.from.trim();
  const to = draft.to.trim();
  const window = from === "" && to === "" ? null : { from, to };
  if (window !== null && (!TIME.test(window.from) || !TIME.test(window.to))) {
    return { ok: false, problem: "window" };
  }
  return {
    ok: true,
    schedule: {
      type: "interval",
      everyMs: hours * HOUR_MS,
      ...(draft.weekdaysOnly ? { weekdays: WEEKDAYS } : {}),
      ...(window === null ? {} : { activeHours: window }),
    },
  };
}

/** The save for a Tot's sweep: in its folder, on its model, read-only. */
export function lookAroundUpsert(input: {
  readonly draft: LookAroundDraft;
  readonly schedule: ScheduledTaskUpsertSchedule;
  readonly tot: Pick<Tot, "id" | "projectId" | "modelSelection">;
  readonly task: ScheduledTask | undefined;
}): ScheduledTaskUpsertInput | null {
  const { tot, draft } = input;
  if (tot.projectId === null || tot.modelSelection === null) return null;
  const precheck = draft.precheck.trim();
  return {
    ...(input.task === undefined ? {} : { id: input.task.id, requireExisting: true }),
    title: input.task?.title ?? LOOK_AROUND_TITLE,
    prompt: draft.focus.trim() || LOOK_AROUND_DEFAULT_FOCUS,
    enabled: draft.enabled,
    schedule: input.schedule,
    projectId: tot.projectId,
    readOnly: true,
    workspaceStrategy: { type: "root" },
    modelSelection: tot.modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    createdByTotId: tot.id,
    precheck: precheck === "" ? null : precheck,
  };
}

/**
 * Whether the provider a Tot's model runs on keeps a sweep read-only. Unknown while the
 * provider list loads, so the switch does not flicker off.
 */
export function lookAroundSupport(
  tot: Pick<Tot, "modelSelection">,
  providers: ReadonlyArray<Pick<ServerProvider, "instanceId" | "driver" | "displayName">>,
): "supported" | "unsupported" | "unknown" {
  if (tot.modelSelection === null) return "unknown";
  const provider = providers.find((entry) => entry.instanceId === tot.modelSelection?.instanceId);
  if (provider === undefined) return "unknown";
  return canEnforceReadOnly(provider.driver) ? "supported" : "unsupported";
}
