import { saveMobilePreferences } from "../../../../state/preferences";
import { useAnimateTotAvatars } from "../../../../state/tots";
import { useAtomCommand } from "../../../../state/use-atom-command";
import { SettingsSection } from "../../components/SettingsSection";
import { SettingsSwitchRow } from "../../components/SettingsSwitchRow";

export function TotsAppearanceSection() {
  const savePreferences = useAtomCommand(saveMobilePreferences);
  const animate = useAnimateTotAvatars();
  return (
    <SettingsSection title="Tots">
      <SettingsSwitchRow
        icon="face.smiling"
        label="Animate Tot avatars"
        subtitle="Faces move in the Tots tab. Off keeps them still."
        value={animate}
        onValueChange={(value) => void savePreferences({ animateTotAvatars: value })}
      />
    </SettingsSection>
  );
}
