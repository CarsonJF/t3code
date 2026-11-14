import { resolveThreadGroupId } from "@t3tools/client-runtime/thread-groups";
import {
  parseTotThreadId,
  type EnvironmentId,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import type { CSSProperties } from "react";

import {
  EMPTY_SCOPED_THEMES,
  ScopedThemes,
  resolveScopedThemeId,
  scopedThemeKey,
  withScopedTheme,
  type ScopedThemeKind,
} from "../scopedThemes.logic";
import { getThemeVariables } from "../themePalette";
import { useThreadGroupsStore } from "../threadGroupsStore";
import { useCustomThemes } from "./useCustomThemes";
import { useEnvironmentThemeDefinitions } from "./useEnvironmentTheme";
import { useLocalStorage } from "./useLocalStorage";
import { useTheme } from "./useTheme";

const SCOPED_THEMES_STORAGE_KEY = "t3code:scoped-themes:v1";

/** Themes assigned to Tots, projects and thread groups on this device, and a setter for each. */
export function useScopedThemes() {
  const [scoped, setScoped] = useLocalStorage(
    SCOPED_THEMES_STORAGE_KEY,
    EMPTY_SCOPED_THEMES,
    ScopedThemes,
  );
  return {
    scoped,
    set: (
      kind: ScopedThemeKind,
      environmentId: EnvironmentId,
      id: string,
      themeId: string | null,
    ) =>
      setScoped((previous) =>
        withScopedTheme(previous, kind, scopedThemeKey(environmentId, id), themeId),
      ),
  };
}

/** The variables of the theme a thread should wear instead of the app's, if it has one. */
export function useThreadScopedThemeStyle(
  thread: {
    readonly environmentId: EnvironmentId;
    readonly id: ThreadId;
    readonly projectId: ProjectId;
    readonly createdAt: string;
  } | null,
): CSSProperties | undefined {
  const { scoped } = useScopedThemes();
  const groups = useThreadGroupsStore();
  const { resolvedTheme } = useTheme();
  // Custom and published palettes load after startup; reading them re-renders when they do.
  useCustomThemes();
  useEnvironmentThemeDefinitions();
  if (thread === null) return undefined;
  const totId = parseTotThreadId(thread.id);
  const groupsState = groups.byEnvironment.get(thread.environmentId);
  const groupId = groupsState === undefined ? null : resolveThreadGroupId(groupsState, thread);
  const themeId = resolveScopedThemeId(scoped, {
    tot: totId === null ? null : scopedThemeKey(thread.environmentId, totId),
    project: scopedThemeKey(thread.environmentId, thread.projectId),
    group: groupId === null ? null : scopedThemeKey(thread.environmentId, groupId),
  });
  if (themeId === null) return undefined;
  const variables = getThemeVariables(themeId, resolvedTheme);
  return variables === null ? undefined : (variables as CSSProperties);
}
