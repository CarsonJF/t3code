import type { ScopedProjectRef } from "@t3tools/contracts";

import { useScopedThemes } from "../../hooks/useScopedThemes";
import { scopedThemeKey } from "../../scopedThemes.logic";
import { ScopedThemeSelect } from "./ScopedThemeSelect";
import { SettingsRow } from "./settingsLayout";

/** The theme this project's threads wear in place of the app's, unless a Tot has its own. */
export function ProjectThemeRow({
  memberProjectRefs,
}: {
  memberProjectRefs: readonly ScopedProjectRef[];
}) {
  const { scoped, set } = useScopedThemes();
  const first = memberProjectRefs[0];
  const value =
    first === undefined
      ? null
      : (scoped.projects[scopedThemeKey(first.environmentId, first.projectId)] ?? null);
  return (
    <SettingsRow
      title="Theme"
      description="Threads in this project use this theme on this device. A thread group's theme applies only to projects without one."
      control={
        <ScopedThemeSelect
          label="Project theme"
          value={value}
          inheritLabel="Same as the app"
          onChange={(themeId) => {
            for (const ref of memberProjectRefs)
              set("projects", ref.environmentId, ref.projectId, themeId);
          }}
        />
      }
    />
  );
}
