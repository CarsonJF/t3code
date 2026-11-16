import {
  type EnvironmentId,
  type GroupChat,
  HOME_TOT_ID,
  type ProjectId,
  type ServerSettings,
  type ThreadId,
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

/**
 * The Tot whose thread this is: the one it runs while on, or the turned-off Tot that owns the
 * thread's project, which is how its last thread still reads as a Tot's.
 */
export function totOwningThread(
  tots: ReadonlyArray<EnvironmentTot>,
  thread: {
    readonly environmentId: EnvironmentId;
    readonly id: ThreadId;
    readonly projectId?: ProjectId;
  } | null,
): EnvironmentTot | null {
  if (thread === null) return null;
  const running = tots.find(
    (entry) => entry.environmentId === thread.environmentId && entry.tot.threadId === thread.id,
  );
  if (running !== undefined) return running;
  if (thread.projectId === undefined) return null;
  return (
    tots.find(
      (entry) =>
        entry.environmentId === thread.environmentId &&
        entry.tot.threadId === null &&
        entry.tot.projectId !== null &&
        entry.tot.projectId === thread.projectId,
    ) ?? null
  );
}

/** Machines a new Tot can live on: the one already hosting Tots first, then the rest. */
export function totHostOrder(
  connected: ReadonlyArray<EnvironmentId>,
  tots: ReadonlyArray<EnvironmentTot>,
): ReadonlyArray<EnvironmentId> {
  const hosting = tots
    .map((entry) => entry.environmentId)
    .filter((environmentId) => connected.includes(environmentId));
  return [...new Set([...hosting, ...connected])];
}

export const isTotProject = (projectId: ProjectId, tots: ReadonlyArray<Tot>): boolean =>
  tots.some((tot) => tot.projectId === projectId);

export interface EnvironmentGroupChat {
  readonly environmentId: EnvironmentId;
  readonly room: GroupChat;
}

/** Every group chat across connected environments, by name. */
export function selectGroupChats(
  settingsByEnvironment: ReadonlyMap<EnvironmentId, ServerSettings>,
): ReadonlyArray<EnvironmentGroupChat> {
  const entries: Array<EnvironmentGroupChat> = [];
  for (const [environmentId, settings] of settingsByEnvironment) {
    for (const room of settings.groupChats) entries.push({ environmentId, room });
  }
  return entries.sort((left, right) => left.room.name.localeCompare(right.room.name));
}

/**
 * The projects a user may pick for new work: a Tot's project holds only its own thread, and a
 * group chat's holds only its room.
 */
export function withoutTotProjects<
  T extends { readonly environmentId: EnvironmentId; readonly id: ProjectId },
>(
  projects: ReadonlyArray<T>,
  tots: ReadonlyArray<EnvironmentTot>,
  groupChats: ReadonlyArray<EnvironmentGroupChat> = [],
): ReadonlyArray<T> {
  const owned = new Set([
    ...tots.flatMap(({ environmentId, tot }) =>
      tot.projectId === null ? [] : [`${environmentId}\u0000${tot.projectId}`],
    ),
    ...groupChats.flatMap(({ environmentId, room }) =>
      room.projectId === null ? [] : [`${environmentId}\u0000${room.projectId}`],
    ),
  ]);
  if (owned.size === 0) return projects;
  const kept = projects.filter(
    (project) => !owned.has(`${project.environmentId}\u0000${project.id}`),
  );
  return kept.length === projects.length ? projects : kept;
}
