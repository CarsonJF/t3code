import type {
  EnvironmentId,
  ProjectColor,
  ProjectIconColor,
  ProjectId,
  ThreadGroup,
  ThreadGroupOp,
  ThreadGroupsState,
  ThreadId,
} from "@t3tools/contracts";

/** Each environment stores the groups its own threads use; clients show their union by id. */
export type ThreadGroupsByEnvironment = ReadonlyMap<EnvironmentId, ThreadGroupsState>;

interface GroupableThread {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
  readonly projectId: ProjectId;
  readonly createdAt: string;
}

function existingGroupId(state: ThreadGroupsState, groupId: string | null | undefined) {
  return groupId != null && state.groups.some((group) => group.id === groupId) ? groupId : null;
}

export function mergeThreadGroups(byEnvironment: ThreadGroupsByEnvironment): ThreadGroup[] {
  const groups = new Map<string, ThreadGroup>();
  for (const state of byEnvironment.values()) {
    for (const group of state.groups) if (!groups.has(group.id)) groups.set(group.id, group);
  }
  return [...groups.values()];
}

export function environmentsWithThreadGroup(
  byEnvironment: ThreadGroupsByEnvironment,
  groupId: string,
): EnvironmentId[] {
  return [...byEnvironment]
    .filter(([, state]) => state.groups.some((group) => group.id === groupId))
    .map(([environmentId]) => environmentId);
}

export function projectDefaultGroupId(
  state: ThreadGroupsState,
  projectId: ProjectId,
): string | null {
  return existingGroupId(state, state.projectDefaults[projectId]?.at(-1)?.groupId);
}

export function resolveThreadGroupId(
  state: ThreadGroupsState,
  thread: Pick<GroupableThread, "id" | "projectId" | "createdAt">,
): string | null {
  if (Object.hasOwn(state.threadOverrides, thread.id)) {
    return existingGroupId(state, state.threadOverrides[thread.id]);
  }
  const createdAtMs = Date.parse(thread.createdAt);
  const entry = state.projectDefaults[thread.projectId]?.findLast(
    (candidate) => Date.parse(candidate.since) <= createdAtMs,
  );
  return existingGroupId(state, entry?.groupId);
}

export function splitThreadsByGroup<T extends GroupableThread>(
  threads: readonly T[],
  byEnvironment: ThreadGroupsByEnvironment,
  groups: ReadonlyArray<ThreadGroup> = mergeThreadGroups(byEnvironment),
) {
  const byGroupId = new Map(groups.map((group) => [group.id, [] as T[]]));
  const ungrouped: T[] = [];
  for (const thread of threads) {
    const state = byEnvironment.get(thread.environmentId);
    const groupId = state ? resolveThreadGroupId(state, thread) : null;
    const target = groupId === null ? undefined : byGroupId.get(groupId);
    (target ?? ungrouped).push(thread);
  }
  return {
    ungrouped,
    groups: groups.map((group) => ({ group, threads: byGroupId.get(group.id)! })),
  };
}

interface ProjectRefLike {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}

/** A project spanning environments is a favorite when any of its checkouts is. */
export function isProjectFavorite(
  byEnvironment: ThreadGroupsByEnvironment,
  projectRefs: ReadonlyArray<ProjectRefLike>,
): boolean {
  return projectRefs.some((ref) =>
    byEnvironment.get(ref.environmentId)?.favoriteProjectIds.includes(ref.projectId),
  );
}

export function projectFavoriteOps(
  projectRefs: ReadonlyArray<ProjectRefLike>,
  favorite: boolean,
): Map<EnvironmentId, ThreadGroupOp[]> {
  const projectIdsByEnvironment = new Map<EnvironmentId, ProjectId[]>();
  for (const ref of projectRefs) {
    projectIdsByEnvironment.set(ref.environmentId, [
      ...(projectIdsByEnvironment.get(ref.environmentId) ?? []),
      ref.projectId,
    ]);
  }
  return new Map(
    [...projectIdsByEnvironment].map(([environmentId, projectIds]) => [
      environmentId,
      [{ type: "setProjectFavorite", projectIds, favorite }],
    ]),
  );
}

export interface ProjectPickerSection<T> {
  readonly key: string;
  readonly label: string;
  readonly group: ThreadGroup | null;
  readonly projects: readonly T[];
}

/**
 * Most recent first, then favorites, then each group in its sidebar order, then the rest.
 * The most recent project also keeps its place below; favorites appear only once.
 */
export function buildProjectPickerSections<T>(input: {
  readonly projects: readonly T[];
  readonly mostRecent: T | null;
  readonly projectRefs: (project: T) => ReadonlyArray<ProjectRefLike>;
  readonly byEnvironment: ThreadGroupsByEnvironment;
  readonly groups?: ReadonlyArray<ThreadGroup>;
}): ProjectPickerSection<T>[] {
  const groups = input.groups ?? mergeThreadGroups(input.byEnvironment);
  const favorites: T[] = [];
  const byGroupId = new Map(groups.map((group) => [group.id, [] as T[]]));
  const ungrouped: T[] = [];
  for (const project of input.projects) {
    const refs = input.projectRefs(project);
    if (isProjectFavorite(input.byEnvironment, refs)) {
      favorites.push(project);
      continue;
    }
    const groupId = refs.reduce<string | null>((found, ref) => {
      if (found !== null) return found;
      const state = input.byEnvironment.get(ref.environmentId);
      return state ? projectDefaultGroupId(state, ref.projectId) : null;
    }, null);
    ((groupId === null ? undefined : byGroupId.get(groupId)) ?? ungrouped).push(project);
  }
  const groupSections = groups.flatMap((group): ProjectPickerSection<T>[] => {
    const projects = byGroupId.get(group.id)!;
    return projects.length === 0
      ? []
      : [{ key: `group:${group.id}`, label: group.name, group, projects }];
  });
  return [
    ...(input.mostRecent === null
      ? []
      : [{ key: "recent", label: "Most recent", group: null, projects: [input.mostRecent] }]),
    ...(favorites.length === 0
      ? []
      : [{ key: "favorites", label: "Favorites", group: null, projects: favorites }]),
    ...groupSections,
    ...(ungrouped.length === 0
      ? []
      : [
          {
            key: "other",
            label: groupSections.length > 0 || favorites.length > 0 ? "Other projects" : "Projects",
            group: null,
            projects: ungrouped,
          },
        ]),
  ];
}

/** Prefixes `createGroup` when `group` is new to the environment, so the ops apply atomically. */
export function withThreadGroup(
  state: ThreadGroupsState | undefined,
  group: ThreadGroup | null,
  op: ThreadGroupOp,
): ThreadGroupOp[] {
  return group === null || state?.groups.some((existing) => existing.id === group.id)
    ? [op]
    : [{ type: "createGroup", group }, op];
}

/** Ids after dragging `groupId` onto the `edge` of `targetId`; unchanged when either is unknown. */
export function moveThreadGroup(
  groupIds: ReadonlyArray<string>,
  groupId: string,
  targetId: string,
  edge: "before" | "after",
): string[] {
  if (groupId === targetId || !groupIds.includes(groupId) || !groupIds.includes(targetId)) {
    return [...groupIds];
  }
  const rest = groupIds.filter((id) => id !== groupId);
  rest.splice(rest.indexOf(targetId) + (edge === "after" ? 1 : 0), 0, groupId);
  return rest;
}

/** Tailwind's 500 shades, for gradients and native menus that cannot take class names. */
export const THREAD_GROUP_COLOR_HEX: Record<ProjectIconColor, string> = {
  gray: "#6b7280",
  red: "#ef4444",
  orange: "#f97316",
  amber: "#f59e0b",
  yellow: "#eab308",
  lime: "#84cc16",
  green: "#22c55e",
  emerald: "#10b981",
  teal: "#14b8a6",
  cyan: "#06b6d4",
  sky: "#0ea5e9",
  blue: "#3b82f6",
  indigo: "#6366f1",
  violet: "#8b5cf6",
  purple: "#a855f7",
  fuchsia: "#d946ef",
  pink: "#ec4899",
  rose: "#f43f5e",
};

const GRADIENT_WASH_ALPHA = 0.18;

export const isNamedProjectColor = (color: ProjectColor): color is ProjectIconColor =>
  color in THREAD_GROUP_COLOR_HEX;

/** The color as `#rrggbb` plus its opacity, for anything that cannot take class names. */
export function projectColorStop(color: ProjectColor): {
  readonly hex: string;
  readonly alpha: number;
} {
  if (isNamedProjectColor(color)) {
    return { hex: THREAD_GROUP_COLOR_HEX[color], alpha: 1 };
  }
  return {
    hex: color.slice(0, 7),
    alpha: color.length === 9 ? parseInt(color.slice(7), 16) / 255 : 1,
  };
}

/** One end of a group header's gradient: the color's own opacity, softened into a wash. */
export function gradientWashStop(color: ProjectColor) {
  const { hex, alpha } = projectColorStop(color);
  return { hex, alpha: alpha * GRADIENT_WASH_ALPHA };
}

/** The color as one CSS-ready hex, where a named color is its palette shade. */
export function projectColorHex(color: ProjectColor): string {
  return isNamedProjectColor(color) ? THREAD_GROUP_COLOR_HEX[color] : color;
}
