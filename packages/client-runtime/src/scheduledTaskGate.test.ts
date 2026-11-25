import { describe, expect, it } from "@effect/vitest";

import {
  lastSkipLabel,
  scheduledTaskGateDraft,
  scheduledTaskGateFields,
  visibleLastSkip,
} from "./scheduledTaskGate.ts";

describe("scheduledTaskGateFields", () => {
  const saved = scheduledTaskGateDraft({ precheck: "test -f ready", missedRunGraceMinutes: 30 });

  it("sends only what changed, null for a cleared field", () => {
    expect(saved).toMatchObject({ precheck: "test -f ready", missedRunGraceMinutes: "30" });
    expect(scheduledTaskGateFields(saved)).toEqual({ ok: true, fields: {} });
    expect(
      scheduledTaskGateFields({ ...saved, precheck: "  ", missedRunGraceMinutes: "" }),
    ).toEqual({ ok: true, fields: { precheck: null, missedRunGraceMinutes: null } });
    expect(
      scheduledTaskGateFields({
        ...saved,
        precheck: " git diff --quiet ",
        missedRunGraceMinutes: "0",
      }),
    ).toEqual({ ok: true, fields: { precheck: "git diff --quiet", missedRunGraceMinutes: 0 } });
  });

  it("leaves both out for a task that never had them", () => {
    expect(scheduledTaskGateFields(scheduledTaskGateDraft(null))).toEqual({ ok: true, fields: {} });
    expect(scheduledTaskGateFields(scheduledTaskGateDraft({}))).toEqual({ ok: true, fields: {} });
  });

  it("refuses a grace that is not whole minutes in range", () => {
    for (const value of ["1.5", "-1", "999999", "soon"]) {
      expect(scheduledTaskGateFields({ ...saved, missedRunGraceMinutes: value })).toMatchObject({
        ok: false,
        title: "Invalid missed-run grace",
      });
    }
  });
});

describe("visibleLastSkip", () => {
  const skip = { at: "2026-11-25T03:30:00.000Z", reason: "precheck", detail: "exit 1" };

  it("shows a skip only when it is newer than the last run", () => {
    expect(visibleLastSkip({ lastSkip: skip, lastRunAt: null })).toBe(skip);
    expect(visibleLastSkip({ lastSkip: skip, lastRunAt: "2026-11-24T03:30:00.000Z" })).toBe(skip);
    expect(visibleLastSkip({ lastSkip: skip, lastRunAt: "2026-11-25T04:00:00.000Z" })).toBeNull();
    expect(visibleLastSkip({ lastRunAt: null })).toBeNull();
  });

  it("labels each reason, and an unknown one plainly", () => {
    expect(lastSkipLabel("precheck")).toBe("Skipped (precheck)");
    expect(lastSkipLabel("missed")).toBe("Skipped (missed run)");
    expect(lastSkipLabel("later")).toBe("Skipped");
  });
});
