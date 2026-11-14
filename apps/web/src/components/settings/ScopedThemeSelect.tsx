import { BUILT_IN_THEMES } from "@t3tools/shared/themePalettes";

import { useCustomThemes } from "../../hooks/useCustomThemes";
import { useEnvironmentThemeDefinitions } from "../../hooks/useEnvironmentTheme";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

const INHERIT = "inherit";

/** Picks the theme for a Tot, project or thread group, or lets it inherit from further out. */
export function ScopedThemeSelect(props: {
  readonly value: string | null;
  readonly onChange: (themeId: string | null) => void;
  readonly label: string;
  readonly inheritLabel?: string;
}) {
  const custom = useCustomThemes();
  const published = useEnvironmentThemeDefinitions();
  const seen = new Set<string>();
  const themes = [...BUILT_IN_THEMES, ...custom, ...published].filter((theme) => {
    if (seen.has(theme.id)) return false;
    seen.add(theme.id);
    return true;
  });
  const inheritLabel = props.inheritLabel ?? "Inherit";
  const selected = themes.find((theme) => theme.id === props.value);
  return (
    <Select
      value={props.value ?? INHERIT}
      onValueChange={(value) => props.onChange(value === INHERIT ? null : value)}
    >
      <SelectTrigger size="sm" className="w-48" aria-label={props.label}>
        <SelectValue>{selected?.label ?? inheritLabel}</SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        <SelectItem value={INHERIT}>{inheritLabel}</SelectItem>
        {themes.map((theme) => (
          <SelectItem key={theme.id} value={theme.id}>
            {theme.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
