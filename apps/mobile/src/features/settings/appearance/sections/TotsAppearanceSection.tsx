import { useAtomSet } from "@effect/atom-react";

import { updateMobilePreferencesAtom } from "../../../../state/preferences";
import { useAnimateTotAvatars } from "../../../../state/tots";
import { SettingsSection } from "../../components/SettingsSection";
import { SettingsSwitchRow } from "../../components/SettingsSwitchRow";

export function TotsAppearanceSection() {
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const animate = useAnimateTotAvatars();
  return (
    <SettingsSection title="Tots">
      <SettingsSwitchRow
        icon="face.smiling"
        label="Animate Tot avatars"
        subtitle="Faces move in the Tots tab. Off keeps them still."
        value={animate}
        onValueChange={(value) => savePreferences({ animateTotAvatars: value })}
      />
    </SettingsSection>
  );
}
