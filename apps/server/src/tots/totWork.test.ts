import { assert, describe, it } from "@effect/vitest";

import {
  attemptStatusOf,
  failedAttemptsOf,
  lookIsForAttempt,
  objectiveStatusOf,
  workListOrder,
} from "./totWork.ts";
import type { WatchedThreadState } from "./totWatchTransitions.ts";

const state = (fields: Partial<WatchedThreadState>): WatchedThreadState => ({
  status: "running",
  pending: null,
  runId: "run-1",
  requestId: null,
  ended: false,
  backgroundTasks: 0,
  restartPending: false,
  ...fields,
});

describe("attemptStatusOf", () => {
  it("maps what the watcher sees to an attempt status", () => {
    assert.strictEqual(attemptStatusOf(state({})), "working");
    assert.strictEqual(attemptStatusOf(state({ waitingOn: "thread_wait" })), "waiting");
    assert.strictEqual(
      attemptStatusOf(state({ status: "waiting", waitingOn: "checks" })),
      "waiting",
    );
    assert.strictEqual(attemptStatusOf(state({ pending: "approval" })), "needs_you");
    assert.strictEqual(attemptStatusOf(state({ status: "completed" })), "done");
    assert.strictEqual(attemptStatusOf(state({ status: "failed" })), "failed");
    assert.strictEqual(attemptStatusOf(state({ status: "stopped" })), "stopped");
    // A restart may still continue it, so it has not stopped.
    assert.strictEqual(
      attemptStatusOf(state({ status: "stopped", restartPending: true })),
      "working",
    );
    assert.strictEqual(attemptStatusOf(state({ ended: true, status: "completed" })), "stopped");
    assert.strictEqual(attemptStatusOf(state({ status: "idle", runId: null })), null);
  });
});

describe("lookIsForAttempt", () => {
  it("ignores an earlier run until the attempt's own run is seen", () => {
    const fresh = { runId: "run-2", lastRunId: null };
    assert.isFalse(lookIsForAttempt(fresh, state({ runId: "run-1" })));
    assert.isTrue(lookIsForAttempt(fresh, state({ runId: "run-2" })));
    assert.isTrue(
      lookIsForAttempt({ runId: "run-2", lastRunId: "run-2" }, state({ runId: "run-3" })),
    );
    assert.isTrue(lookIsForAttempt({ runId: null, lastRunId: null }, state({ runId: "run-1" })));
    assert.isTrue(lookIsForAttempt(fresh, state({ ended: true, runId: null })));
  });
});

describe("objectiveStatusOf", () => {
  const attempt = (
    status: "working" | "waiting" | "needs_you" | "done" | "failed" | "stopped",
    startedAt = "2026-11-25T10:00:00.000Z",
  ) => ({
    status,
    startedAt,
  });
  const facts = (
    attempts: ReadonlyArray<ReturnType<typeof attempt>>,
    extra: { closedAs?: "done" | "cancelled" | null; resetAt?: string | null } = {},
  ) => ({ closedAs: extra.closedAs ?? null, resetAt: extra.resetAt ?? null, attempts });

  it("follows its attempts, open ones first", () => {
    assert.strictEqual(objectiveStatusOf(facts([]), 3), "planned");
    assert.strictEqual(
      objectiveStatusOf(facts([attempt("failed"), attempt("working")]), 3),
      "working",
    );
    assert.strictEqual(
      objectiveStatusOf(facts([attempt("working"), attempt("needs_you")]), 3),
      "needs_you",
    );
    assert.strictEqual(objectiveStatusOf(facts([attempt("waiting")]), 3), "waiting");
    assert.strictEqual(objectiveStatusOf(facts([attempt("failed"), attempt("done")]), 3), "done");
    assert.strictEqual(
      objectiveStatusOf(facts([attempt("done"), attempt("stopped")]), 3),
      "failed",
    );
    assert.strictEqual(
      objectiveStatusOf(facts([attempt("working")], { closedAs: "cancelled" }), 3),
      "cancelled",
    );
  });

  it("needs a person once failed or stopped attempts reach the cap, until a reset", () => {
    const three = [attempt("failed"), attempt("stopped"), attempt("failed")];
    assert.strictEqual(failedAttemptsOf(facts(three)), 3);
    assert.strictEqual(objectiveStatusOf(facts(three), 3), "needs_you");
    assert.strictEqual(objectiveStatusOf(facts(three), 4), "failed");
    assert.strictEqual(objectiveStatusOf(facts(three), 0), "failed");
    const reset = facts([...three, attempt("failed", "2026-11-25T12:00:00.000Z")], {
      resetAt: "2026-11-25T11:00:00.000Z",
    });
    assert.strictEqual(failedAttemptsOf(reset), 1);
    assert.strictEqual(objectiveStatusOf(reset, 3), "failed");
  });
});

describe("workListOrder", () => {
  it("puts what needs the user first, then live work, newest first within a status", () => {
    const ordered = workListOrder([
      { id: "a", status: "done" as const, updatedAt: "2026-11-25T12:00:00.000Z" },
      { id: "b", status: "working" as const, updatedAt: "2026-11-25T10:00:00.000Z" },
      { id: "c", status: "working" as const, updatedAt: "2026-11-25T11:00:00.000Z" },
      { id: "d", status: "needs_you" as const, updatedAt: "2026-11-25T09:00:00.000Z" },
    ]);
    assert.deepStrictEqual(
      ordered.map((objective) => objective.id),
      ["d", "c", "b", "a"],
    );
  });
});
