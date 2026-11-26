import { MIN_SCHEDULED_TASK_INTERVAL_MS, type ScheduledTaskSchedule } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

const MINUTE_MS = 60_000;

export function parseTimeOfDay(value: string): { hour: number; minute: number } | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function nextScheduledRunAt(
  schedule: ScheduledTaskSchedule,
  from: DateTime.DateTime,
): DateTime.DateTime | null {
  if (schedule.type === "webhook") return null;
  if (schedule.type === "once") {
    const runAt = DateTime.make(schedule.runAt);
    return Option.isSome(runAt) &&
      DateTime.toEpochMillis(runAt.value) > DateTime.toEpochMillis(from)
      ? runAt.value
      : null;
  }
  if (schedule.type === "interval") {
    // Intervals advance elapsed time, including across daylight-saving changes.
    return withinIntervalLimits(
      schedule,
      DateTime.addDuration(from, Math.max(schedule.everyMs, MIN_SCHEDULED_TASK_INTERVAL_MS)),
    );
  }

  const time = parseTimeOfDay(schedule.timeOfDay);
  if (time === null) return null;
  const weekdays =
    schedule.weekdays && schedule.weekdays.length > 0 ? new Set(schedule.weekdays) : null;
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = DateTime.setParts(DateTime.add(from, { days: offset }), {
      hour: time.hour,
      minute: time.minute,
      second: 0,
      millisecond: 0,
    });
    if (DateTime.toEpochMillis(candidate) <= DateTime.toEpochMillis(from)) continue;
    if (weekdays !== null && !weekdays.has(DateTime.toParts(candidate).weekDay)) continue;
    return candidate;
  }
  return null;
}

/** The candidate if it falls on an allowed day and hour, else the start of the next allowed window. */
function withinIntervalLimits(
  schedule: Extract<ScheduledTaskSchedule, { type: "interval" }>,
  candidate: DateTime.DateTime,
): DateTime.DateTime | null {
  const weekdays =
    schedule.weekdays && schedule.weekdays.length > 0 ? new Set(schedule.weekdays) : null;
  const from = schedule.activeHours ? parseTimeOfDay(schedule.activeHours.from) : null;
  const to = schedule.activeHours ? parseTimeOfDay(schedule.activeHours.to) : null;
  if (weekdays === null && (from === null || to === null)) return candidate;
  const start = from ?? { hour: 0, minute: 0 };
  const startMinute = start.hour * 60 + start.minute;
  const endMinute = to === null ? 24 * 60 : to.hour * 60 + to.minute;
  const parts = DateTime.toParts(candidate);
  const minute = parts.hour * 60 + parts.minute;
  // An end at or before the start is a window that runs past midnight.
  const inHours =
    from === null || to === null
      ? true
      : startMinute < endMinute
        ? minute >= startMinute && minute < endMinute
        : minute >= startMinute || minute < endMinute;
  if (inHours && (weekdays === null || weekdays.has(parts.weekDay))) return candidate;
  for (let offset = 0; offset <= 7; offset += 1) {
    const windowStart = DateTime.setParts(DateTime.add(candidate, { days: offset }), {
      hour: start.hour,
      minute: start.minute,
      second: 0,
      millisecond: 0,
    });
    if (DateTime.toEpochMillis(windowStart) <= DateTime.toEpochMillis(candidate)) continue;
    if (weekdays !== null && !weekdays.has(DateTime.toParts(windowStart).weekDay)) continue;
    return windowStart;
  }
  return null;
}

function weekdayKey(weekdays: ReadonlyArray<number> | undefined): string {
  const unique = [...new Set(weekdays ?? [])].toSorted((x, y) => x - y);
  if (unique.length === 0 || unique.length === 7) return "daily";
  return unique.join(",");
}

export function isSameSchedule(a: ScheduledTaskSchedule, b: ScheduledTaskSchedule): boolean {
  if (a.type === "interval") {
    return (
      b.type === "interval" &&
      a.everyMs === b.everyMs &&
      weekdayKey(a.weekdays) === weekdayKey(b.weekdays) &&
      a.activeHours?.from === b.activeHours?.from &&
      a.activeHours?.to === b.activeHours?.to
    );
  }
  if (a.type === "webhook") return b.type === "webhook";
  if (a.type === "once") return b.type === "once" && Date.parse(a.runAt) === Date.parse(b.runAt);
  if (b.type !== "fixed_time") return false;
  // Compare parsed times so padded-hour edits do not reschedule pending runs.
  const aTime = parseTimeOfDay(a.timeOfDay);
  const bTime = parseTimeOfDay(b.timeOfDay);
  return (
    aTime !== null &&
    bTime !== null &&
    aTime.hour === bTime.hour &&
    aTime.minute === bTime.minute &&
    weekdayKey(a.weekdays) === weekdayKey(b.weekdays)
  );
}

const MISSED_FIXED_TIME_GRACE_MS = 10 * MINUTE_MS;
/** A due run this late is ordinary poll latency, not downtime, whatever the grace says. */
const MISSED_RUN_TOLERANCE_MS = MINUTE_MS;

/**
 * Whether a due run is too late to start. Without a grace, only fixed-time runs expire, after
 * ten minutes. With one, any time schedule does; the single stored next run is the one catch-up.
 */
export function isPastMissedRunGrace(
  schedule: ScheduledTaskSchedule,
  graceMinutes: number,
  dueAt: DateTime.DateTime,
  now: DateTime.DateTime,
): boolean {
  if (schedule.type === "webhook") return false;
  const late = DateTime.toEpochMillis(now) - DateTime.toEpochMillis(dueAt);
  return late > Math.max(graceMinutes * MINUTE_MS, MISSED_RUN_TOLERANCE_MS);
}

export function isMissedFixedTimeRun(
  schedule: ScheduledTaskSchedule,
  dueAt: DateTime.DateTime,
  now: DateTime.DateTime,
): boolean {
  if (schedule.type !== "fixed_time") return false;
  return DateTime.toEpochMillis(now) - DateTime.toEpochMillis(dueAt) > MISSED_FIXED_TIME_GRACE_MS;
}
