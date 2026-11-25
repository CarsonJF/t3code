import { MAX_MISSED_RUN_GRACE_MINUTES, type ScheduledTask } from "@t3tools/contracts";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

/** A scheduled task's precheck and missed-run grace as their form fields hold them. */
export interface ScheduledTaskGateDraft {
  readonly precheck: string;
  readonly savedPrecheck: string;
  readonly missedRunGraceMinutes: string;
  readonly savedMissedRunGraceMinutes: string;
}

export function scheduledTaskGateDraft(
  task: Pick<ScheduledTask, "precheck" | "missedRunGraceMinutes"> | null,
): ScheduledTaskGateDraft {
  const precheck = task?.precheck ?? "";
  const grace = task?.missedRunGraceMinutes === undefined ? "" : String(task.missedRunGraceMinutes);
  return {
    precheck,
    savedPrecheck: precheck,
    missedRunGraceMinutes: grace,
    savedMissedRunGraceMinutes: grace,
  };
}

export interface ScheduledTaskGateFields {
  precheck?: string | null;
  missedRunGraceMinutes?: number | null;
}

/**
 * The precheck and missed-run grace for a save: an unchanged field is left out so older
 * servers and concurrent edits keep theirs, and a cleared one is sent as null.
 */
export function scheduledTaskGateFields(
  draft: ScheduledTaskGateDraft,
  resolve: MFunctionType = mFallback,
):
  | { readonly ok: true; readonly fields: ScheduledTaskGateFields }
  | { readonly ok: false; readonly title: string; readonly description: string } {
  const fields: ScheduledTaskGateFields = {};
  const precheck = draft.precheck.trim();
  if (precheck !== draft.savedPrecheck.trim()) fields.precheck = precheck === "" ? null : precheck;
  const grace = draft.missedRunGraceMinutes.trim();
  if (grace !== draft.savedMissedRunGraceMinutes.trim()) {
    if (grace === "") fields.missedRunGraceMinutes = null;
    else {
      const minutes = Number(grace);
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_MISSED_RUN_GRACE_MINUTES)
        return {
          ok: false,
          title: resolve(msg("Invalid missed-run grace")),
          description: resolve(
            msg("Enter whole minutes from 0 to {max}, or leave it blank.", {
              max: MAX_MISSED_RUN_GRACE_MINUTES,
            }),
          ),
        };
      fields.missedRunGraceMinutes = minutes;
    }
  }
  return { ok: true, fields };
}

/** The last skipped run, when it came after the last run that started. */
export function visibleLastSkip(
  task: Pick<ScheduledTask, "lastSkip" | "lastRunAt">,
): NonNullable<ScheduledTask["lastSkip"]> | null {
  const skip = task.lastSkip;
  if (skip === undefined) return null;
  if (task.lastRunAt !== null && Date.parse(task.lastRunAt) > Date.parse(skip.at)) return null;
  return skip;
}

export function lastSkipLabel(reason: string, resolve: MFunctionType = mFallback): string {
  if (reason === "precheck") return resolve(msg("Skipped (precheck)"));
  if (reason === "missed") return resolve(msg("Skipped (missed run)"));
  return resolve(msg("Skipped", { $context: "scheduled task run" }));
}
