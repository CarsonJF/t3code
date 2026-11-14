import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_HOME_TOT,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  RunId,
  ThreadId,
  TotId,
  type ServerSettings,
  type Tot,
} from "@t3tools/contracts";

import type { EnvironmentThreadShell } from "../state/models.ts";
import {
  isTotProject,
  resolveTotAnimation,
  selectTots,
  totFaceInputFromShell,
  totFaceState,
} from "./tots.ts";

const input = (overrides: Partial<Parameters<typeof totFaceState>[0]>) => ({
  enabled: true,
  runStatus: "idle" as const,
  pendingRequest: false,
  completedUnseen: false,
  ...overrides,
});

describe("totFaceState", () => {
  it("shows the most urgent state first", () => {
    expect(totFaceState(input({ enabled: false, pendingRequest: true }))).toBe("sleep");
    expect(totFaceState(input({ pendingRequest: true, runStatus: "running" }))).toBe("needs-you");
    expect(totFaceState(input({ runStatus: "running" }))).toBe("working");
    expect(totFaceState(input({ runStatus: "failed", completedUnseen: true }))).toBe("failure");
    expect(totFaceState(input({ runStatus: "completed", completedUnseen: true }))).toBe("success");
    expect(totFaceState(input({ runStatus: "completed" }))).toBe("idle");
    expect(totFaceState(input({}))).toBe("idle");
  });
});

describe("totFaceInputFromShell", () => {
  const tot: Tot = { ...DEFAULT_HOME_TOT, threadId: ThreadId.make("tot:home:n") };
  const shell = (overrides: Partial<EnvironmentThreadShell>) =>
    ({
      latestRun: {
        runId: RunId.make("run-1"),
        status: "completed",
        completedAt: "2026-11-13T10:00:00.000Z",
      },
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      lastVisitedAt: "2026-11-13T09:00:00.000Z",
      ...overrides,
    }) as unknown as EnvironmentThreadShell;

  it("reads a finished run the user has not opened yet as unseen", () => {
    expect(totFaceInputFromShell(tot, shell({}))).toEqual({
      enabled: true,
      runStatus: "completed",
      pendingRequest: false,
      completedUnseen: true,
    });
    expect(
      totFaceInputFromShell(tot, shell({ lastVisitedAt: "2026-11-13T11:00:00.000Z" }))
        .completedUnseen,
    ).toBe(false);
  });

  it("counts an approval or a question as needing the user", () => {
    expect(totFaceInputFromShell(tot, shell({ hasPendingApprovals: true })).pendingRequest).toBe(
      true,
    );
  });

  it("sleeps while the Tot is off", () => {
    expect(totFaceInputFromShell({ ...tot, threadId: null }, null).enabled).toBe(false);
  });
});

describe("resolveTotAnimation", () => {
  it("animates fully in the Tot's own view and on hover in the sidebar", () => {
    expect(resolveTotAnimation("own-view", true, false)).toBe("full");
    expect(resolveTotAnimation("sidebar-row", true, false)).toBe("hover");
    expect(resolveTotAnimation("other", true, false)).toBe("still");
  });

  it("holds still when the user turned animation off or prefers reduced motion", () => {
    expect(resolveTotAnimation("own-view", false, false)).toBe("still");
    expect(resolveTotAnimation("own-view", true, true)).toBe("still");
  });
});

describe("selectTots", () => {
  const asuna = EnvironmentId.make("asuna");
  const promini = EnvironmentId.make("promini");
  const yui: Tot = { ...DEFAULT_HOME_TOT, id: TotId.make("yui"), name: "Yui" };
  const work: Tot = { ...DEFAULT_HOME_TOT, id: TotId.make("work"), name: "Work" };
  const settings = (tots: ReadonlyArray<Tot>): ServerSettings => ({
    ...DEFAULT_SERVER_SETTINGS,
    tots,
  });

  it("puts Home first, then the rest by name, and skips a Home that was never turned on", () => {
    const home = { ...DEFAULT_HOME_TOT, threadId: ThreadId.make("tot:home:n") };
    const selected = selectTots(
      new Map([
        [promini, settings([DEFAULT_HOME_TOT, yui])],
        [asuna, settings([work, home])],
      ]),
    );
    expect(selected.map((entry) => [entry.environmentId, entry.tot.id])).toEqual([
      [asuna, "home"],
      [asuna, "work"],
      [promini, "yui"],
    ]);
  });

  it("knows a Tot's own project, so lists can hide it", () => {
    const tots = [{ ...yui, projectId: ProjectId.make("project:yui") }];
    expect(isTotProject(ProjectId.make("project:yui"), tots)).toBe(true);
    expect(isTotProject(ProjectId.make("project:other"), tots)).toBe(false);
  });
});
