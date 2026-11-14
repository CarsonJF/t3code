import {
  type EnvironmentId,
  HOME_TOT_ID,
  type ProjectId,
  type ServerSettings,
  type Tot,
  type TotFaceState,
} from "@t3tools/contracts";

import type { EnvironmentThreadShell } from "../state/models.ts";

export interface TotFaceInput {
  readonly enabled: boolean;
  readonly runStatus: "idle" | "running" | "waiting" | "failed" | "completed";
  readonly pendingRequest: boolean;
  /** A run ended after the user last opened the Tot. */
  readonly completedUnseen: boolean;
}

export const TOT_FACE_STATE_LABELS: Record<TotFaceState, string> = {
  idle: "Idle",
  working: "Working",
  "needs-you": "Needs you",
  success: "Done",
  failure: "Failed",
  sleep: "Off",
};

/** The face a Tot shows: its status light, most urgent first. */
export function totFaceState(input: TotFaceInput): TotFaceState {
  if (!input.enabled) return "sleep";
  if (input.pendingRequest) return "needs-you";
  if (input.runStatus === "running") return "working";
  if (input.runStatus === "failed") return "failure";
  if (input.completedUnseen) return "success";
  return "idle";
}

const runStatusOf = (shell: EnvironmentThreadShell | null): TotFaceInput["runStatus"] => {
  switch (shell?.latestRun?.status) {
    case "preparing":
    case "queued":
    case "starting":
    case "running":
      return "running";
    case "waiting":
      return "waiting";
    case "failed":
      return "failed";
    case "completed":
      return "completed";
    default:
      return "idle";
  }
};

/** The one place web and mobile read a Tot's face from its thread. */
export function totFaceInputFromShell(
  tot: Tot,
  shell: EnvironmentThreadShell | null,
): TotFaceInput {
  const completedAt = shell?.latestRun?.completedAt ?? null;
  const visitedAt = shell?.lastVisitedAt ?? null;
  return {
    enabled: tot.threadId !== null && shell !== null,
    runStatus: runStatusOf(shell),
    pendingRequest: shell !== null && (shell.hasPendingApprovals || shell.hasPendingUserInput),
    completedUnseen:
      completedAt !== null &&
      (visitedAt === null || Date.parse(completedAt) > Date.parse(visitedAt)),
  };
}

export type TotAnimation = "full" | "hover" | "still";

export function resolveTotAnimation(
  surface: "own-view" | "sidebar-row" | "other",
  animateSetting: boolean,
  reducedMotion: boolean,
): TotAnimation {
  if (!animateSetting || reducedMotion) return "still";
  if (surface === "own-view") return "full";
  if (surface === "sidebar-row") return "hover";
  return "still";
}

export interface EnvironmentTot {
  readonly environmentId: EnvironmentId;
  readonly tot: Tot;
}

/**
 * Every Tot across connected environments: Home first, then by name. Each
 * server decodes a default Home, so one never turned on stays out of lists.
 */
export function selectTots(
  settingsByEnvironment: ReadonlyMap<EnvironmentId, ServerSettings>,
): ReadonlyArray<EnvironmentTot> {
  const entries: Array<EnvironmentTot> = [];
  for (const [environmentId, settings] of settingsByEnvironment) {
    for (const tot of settings.tots) {
      if (tot.id === HOME_TOT_ID && tot.threadId === null && tot.projectId === null) continue;
      entries.push({ environmentId, tot });
    }
  }
  return [...entries].sort((left, right) => {
    const leftHome = left.tot.id === HOME_TOT_ID ? 0 : 1;
    const rightHome = right.tot.id === HOME_TOT_ID ? 0 : 1;
    return leftHome - rightHome || left.tot.name.localeCompare(right.tot.name);
  });
}

export const isTotProject = (projectId: ProjectId, tots: ReadonlyArray<Tot>): boolean =>
  tots.some((tot) => tot.projectId === projectId);

/** The projects a user may pick for new work: a Tot's project holds only its own thread. */
export function withoutTotProjects<
  T extends { readonly environmentId: EnvironmentId; readonly id: ProjectId },
>(projects: ReadonlyArray<T>, tots: ReadonlyArray<EnvironmentTot>): ReadonlyArray<T> {
  const owned = new Set(
    tots.flatMap(({ environmentId, tot }) =>
      tot.projectId === null ? [] : [`${environmentId}\u0000${tot.projectId}`],
    ),
  );
  if (owned.size === 0) return projects;
  const kept = projects.filter(
    (project) => !owned.has(`${project.environmentId}\u0000${project.id}`),
  );
  return kept.length === projects.length ? projects : kept;
}
