import { useScopedThemes } from "../../hooks/useScopedThemes";
import { scopedThemeKey } from "../../scopedThemes.logic";
import { useThreadGroupsStore } from "../../threadGroupsStore";
import { ScopedThemeSelect } from "./ScopedThemeSelect";
import { SettingsRow, SettingsSection } from "./settingsLayout";

/** A theme per thread group, for the projects in it that have no theme of their own. */
export function GroupThemesSection() {
  const { scoped, set } = useScopedThemes();
  const { groups, byEnvironment } = useThreadGroupsStore();
  if (groups.length === 0) return null;
  const environments = (groupId: string) =>
    [...byEnvironment].filter(([, state]) => state.groups.some((group) => group.id === groupId));
  return (
    <SettingsSection id="appearance-group-themes" title="Group themes">
      {groups.map((group) => {
        const first = environments(group.id)[0];
        const value =
          first === undefined ? null : (scoped.groups[scopedThemeKey(first[0], group.id)] ?? null);
        return (
          <SettingsRow
            key={group.id}
            title={group.name}
            description="Threads in this group use this theme on this device, unless their project or Tot has its own."
            control={
              <ScopedThemeSelect
                label={`${group.name} theme`}
                value={value}
                inheritLabel="Same as the app"
                onChange={(themeId) => {
                  for (const [environmentId] of environments(group.id)) {
                    set("groups", environmentId, group.id, themeId);
                  }
                }}
              />
            }
          />
        );
      })}
    </SettingsSection>
  );
}
