import { describe, expect, it } from "@effect/vitest";

import { openCodeInstructionSeq, openCodeStepTrace } from "./stepTrace.ts";

const tokens = { input: 185_000, output: 420, cache: { read: 184_000, write: 1_000 } };

describe("openCodeStepTrace", () => {
  it("emits the per-step cache accounting fields", () => {
    expect(
      openCodeStepTrace({
        sessionId: "ses_1",
        model: "anthropic/claude-sonnet-5-5",
        tokens,
        eventSeq: 42,
        data: { sessionID: "ses_1" },
      }),
    ).toEqual({
      sessionId: "ses_1",
      model: "anthropic/claude-sonnet-5-5",
      input: 185_000,
      cacheRead: 184_000,
      cacheWrite: 1_000,
      output: 420,
      instructionSeq: undefined,
      eventSeq: 42,
    });
  });
});

describe("openCodeInstructionSeq", () => {
  it("reads the persisted through_seq when an event carries it", () => {
    expect(openCodeInstructionSeq({ instruction_state: { through_seq: 7 } })).toBe(7);
    expect(openCodeInstructionSeq({ instructionState: { throughSeq: 8 } })).toBe(8);
  });

  it("ignores absent or malformed values", () => {
    expect(openCodeInstructionSeq({ sessionID: "ses_1" })).toBeUndefined();
    expect(openCodeInstructionSeq({ instruction_state: { through_seq: "7" } })).toBeUndefined();
    expect(openCodeInstructionSeq(null)).toBeUndefined();
  });
});
