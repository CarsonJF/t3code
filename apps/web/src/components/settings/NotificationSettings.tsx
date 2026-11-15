import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import {
  MAX_NOTIFICATION_VOLUME,
  MIN_NOTIFICATION_VOLUME,
  NotificationSound,
} from "@t3tools/contracts/settings";
import { useState, type CSSProperties } from "react";

import {
  hasDesktopNotifications,
  hasNotificationSound,
  NOTIFICATION_MODE_LABELS,
  previewNotificationSound,
  unlockNotificationAudio,
} from "../../threadNotifications";
import { NOTIFICATION_SOUND_LABELS } from "../../notificationSounds";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

export function NotificationSettings() {
  const mode = useScopedSettings((settings) => settings.notificationMode);
  const sound = useScopedSettings((settings) => settings.notificationSound);
  const volume = useScopedSettings((settings) => settings.notificationVolume);
  const updateSettings = useUpdateScopedSettings();
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  const volumeRatio =
    (volume - MIN_NOTIFICATION_VOLUME) / (MAX_NOTIFICATION_VOLUME - MIN_NOTIFICATION_VOLUME);
  const volumeSliderStyle = {
    "--settings-slider-progress": `${volumeRatio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - volumeRatio}rem`,
  } as CSSProperties;

  return (
    <>
      <SettingsRow
        {...searchableSetting("thread-notifications")}
        description={
          permissionMessage ??
          "System alerts when a thread finishes, fails, or needs input or approval. Applies to this device while T3 Code is open."
        }
        control={
          <Select
            value={mode}
            disabled={requesting}
            onValueChange={async (value) => {
              if (
                value !== "off" &&
                value !== "notifications" &&
                value !== "sound" &&
                value !== "notifications-and-sound"
              )
                return;
              setPermissionMessage(null);
              if (hasNotificationSound(value)) unlockNotificationAudio();
              if (hasDesktopNotifications(value)) {
                if (typeof Notification === "undefined" || !window.isSecureContext) {
                  setPermissionMessage(
                    "Notifications need a supported browser over HTTPS, or the desktop app. Sound only is still available.",
                  );
                  return;
                }
                setRequesting(true);
                const permission = await settlePromise(() => Notification.requestPermission());
                setRequesting(false);
                if (permission._tag === "Failure") {
                  setPermissionMessage(
                    "Notifications are unavailable in this browser. Sound only is still available.",
                  );
                  return;
                }
                if (permission.value !== "granted") {
                  setPermissionMessage(
                    "Allow notifications in your browser or system settings, then choose this option again. Sound only is still available.",
                  );
                  return;
                }
              }
              updateSettings({ notificationMode: value });
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Thread notifications">
              <SelectValue>{NOTIFICATION_MODE_LABELS[mode]}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {Object.entries(NOTIFICATION_MODE_LABELS).map(([value, label]) => (
                <SelectItem key={value} hideIndicator value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        {...searchableSetting("notification-sound")}
        description="The sound played for thread alerts. Preview uses the current volume."
        control={
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <Select
              value={sound}
              onValueChange={(value) => {
                const next = NotificationSound.literals.find((literal) => literal === value);
                if (next) updateSettings({ notificationSound: next });
              }}
            >
              <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Notification sound">
                <SelectValue>{NOTIFICATION_SOUND_LABELS[sound]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {Object.entries(NOTIFICATION_SOUND_LABELS).map(([value, label]) => (
                  <SelectItem key={value} hideIndicator value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            <Button
              size="sm"
              variant="outline"
              disabled={sound === "none" || volume === 0}
              onClick={() => void previewNotificationSound(sound, volume)}
            >
              Preview
            </Button>
          </div>
        }
      />
      <SettingsRow
        {...searchableSetting("notification-volume")}
        description="How loud thread alert sounds are. 0 is silent."
        control={
          <div className="flex w-full items-center gap-3 sm:w-52">
            <output
              className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
              htmlFor="notification-volume"
            >
              {volume}%
            </output>
            <input
              aria-label="Notification volume"
              className="settings-slider min-w-0 flex-1"
              id="notification-volume"
              max={MAX_NOTIFICATION_VOLUME}
              min={MIN_NOTIFICATION_VOLUME}
              onChange={(event) =>
                updateSettings({ notificationVolume: Number(event.currentTarget.value) })
              }
              step={5}
              style={volumeSliderStyle}
              type="range"
              value={volume}
            />
          </div>
        }
      />
    </>
  );
}
