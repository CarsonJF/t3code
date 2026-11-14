import { expect, it } from "@effect/vitest";

import {
  formatWatchLine,
  watchTransition,
  type WatchedThreadState,
} from "./totWatchTransitions.ts";

const state = (overrides: Partial<WatchedThreadState>): WatchedThreadState => ({
  status: "idle",
  pending: null,
  runId: "run-1",
  ended: false,
  ...overrides,
});

it("reports a run that completes", () => {
  expect(watchTransition(state({ status: "running" }), state({ status: "completed" }))).toBe(
    "completed",
  );
});

it("reports a question or an approval the thread starts waiting on", () => {
  expect(
    watchTransition(
      state({ status: "running" }),
      state({ status: "waiting", pending: "question" }),
    ),
  ).toBe("question");
  expect(
    watchTransition(
      state({ status: "waiting", pending: "question" }),
      state({ status: "waiting", pending: "approval" }),
    ),
  ).toBe("approval");
});

it("reports nothing when nothing changed", () => {
  expect(watchTransition(state({}), state({}))).toBeNull();
  expect(
    watchTransition(state({ status: "completed" }), state({ status: "completed" })),
  ).toBeNull();
});

it("compares a first sighting with an empty state", () => {
  expect(watchTransition(undefined, state({ status: "failed" }))).toBe("failed");
});

it("reports a new run's outcome even when the status matches the last one", () => {
  expect(
    watchTransition(
      state({ status: "completed", runId: "run-1" }),
      state({ status: "completed", runId: "run-2" }),
    ),
  ).toBe("completed");
});

it("reports a thread that was settled, archived or removed, once", () => {
  expect(watchTransition(state({ status: "running" }), state({ ended: true }))).toBe("ended");
  expect(watchTransition(state({ ended: true }), state({ ended: true }))).toBeNull();
});

it("formats a report line with the thread's ready link", () => {
  expect(formatWatchLine("completed", "[Fix the build](t3-thread://v2/env/t1)", "Asuna")).toBe(
    "- Completed: [Fix the build](t3-thread://v2/env/t1) on Asuna",
  );
  expect(formatWatchLine("approval", "[Deploy](t3-thread://v2/env/t2)", "ProMini")).toBe(
    "- Needs approval: [Deploy](t3-thread://v2/env/t2) on ProMini",
  );
});
