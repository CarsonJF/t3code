import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import { isPastMissedRunGrace, isSameSchedule, nextScheduledRunAt } from "./Schedule.ts";

describe("scheduled task schedule calculation", () => {
  it("skips to the next matching fixed-time weekday", () => {
    const next = nextScheduledRunAt(
      { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2, 3, 4, 5] },
      DateTime.makeZonedUnsafe(
        {
          year: 2026,
          month: 7,
          day: 3,
          hour: 10,
          minute: 0,
          second: 0,
          millisecond: 0,
        },
        { timeZone: "America/Los_Angeles", adjustForTimeZone: true },
      ),
    );
    const parts = next ? DateTime.toParts(next) : null;
    expect(parts?.weekDay).toBe(1);
    expect(parts?.hour).toBe(9);
    expect(parts?.minute).toBe(0);
  });

  it("keeps an interval inside its weekdays and active hours", () => {
    const weekdayDaytime = {
      type: "interval",
      everyMs: 4 * 60 * 60 * 1000,
      weekdays: [1, 2, 3, 4, 5],
      activeHours: { from: "08:00", to: "20:00" },
    } as const;
    const at = (day: number, hour: number) =>
      DateTime.makeZonedUnsafe(
        { year: 2026, month: 11, day, hour, minute: 0, second: 0, millisecond: 0 },
        { timeZone: "America/New_York", adjustForTimeZone: true },
      );
    const partsOf = (next: DateTime.DateTime | null) => (next ? DateTime.toParts(next) : null);
    // Wednesday 25 Nov 2026, 09:00: the next run is four hours on, at 13:00.
    expect(partsOf(nextScheduledRunAt(weekdayDaytime, at(25, 9)))).toMatchObject({
      day: 25,
      hour: 13,
    });
    // 18:00 plus four hours is past 20:00, so the next run opens Thursday's window.
    expect(partsOf(nextScheduledRunAt(weekdayDaytime, at(25, 18)))).toMatchObject({
      day: 26,
      hour: 8,
    });
    // Friday evening skips the weekend.
    expect(partsOf(nextScheduledRunAt(weekdayDaytime, at(27, 18)))).toMatchObject({
      day: 30,
      weekDay: 1,
      hour: 8,
    });
    expect(
      isSameSchedule(weekdayDaytime, { type: "interval", everyMs: weekdayDaytime.everyMs }),
    ).toBe(false);
  });

  it("compares schedules structurally", () => {
    expect(
      isSameSchedule(
        { type: "once", runAt: "2026-11-01T03:00:00-05:00" },
        { type: "once", runAt: "2026-11-01T08:00:00.000Z" },
      ),
    ).toBe(true);
    expect(
      isSameSchedule({ type: "interval", everyMs: 60_000 }, { type: "interval", everyMs: 60_000 }),
    ).toBe(true);
    expect(
      isSameSchedule({ type: "interval", everyMs: 60_000 }, { type: "interval", everyMs: 30_000 }),
    ).toBe(false);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2] },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2] },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [5, 1] },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 5, 5] },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00" },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6] },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [] },
        { type: "fixed_time", timeOfDay: "09:00" },
      ),
    ).toBe(true);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 2] },
        { type: "fixed_time", timeOfDay: "09:00", weekdays: [1, 3] },
      ),
    ).toBe(false);
    expect(
      isSameSchedule(
        { type: "fixed_time", timeOfDay: "09:00" },
        { type: "fixed_time", timeOfDay: "09:30" },
      ),
    ).toBe(false);
    expect(
      isSameSchedule(
        { type: "interval", everyMs: 60_000 },
        { type: "fixed_time", timeOfDay: "09:00" },
      ),
    ).toBe(false);
  });
});

describe("isPastMissedRunGrace", () => {
  const dueAt = DateTime.makeUnsafe("2026-09-09T12:00:00.000Z");
  const after = (minutes: number) => DateTime.add(dueAt, { minutes });
  const interval = { type: "interval", everyMs: 3_600_000 } as const;

  it("skips a run later than the grace and runs one inside it", () => {
    expect(isPastMissedRunGrace(interval, 30, dueAt, after(31))).toBe(true);
    expect(isPastMissedRunGrace(interval, 30, dueAt, after(29))).toBe(false);
  });

  it("treats a minute of lateness as poll latency even with no grace", () => {
    expect(isPastMissedRunGrace(interval, 0, dueAt, DateTime.add(dueAt, { seconds: 30 }))).toBe(
      false,
    );
    expect(isPastMissedRunGrace(interval, 0, dueAt, after(2))).toBe(true);
  });

  it("never expires a webhook delivery", () => {
    expect(isPastMissedRunGrace({ type: "webhook", signature: null }, 0, dueAt, after(600))).toBe(
      false,
    );
  });
});
