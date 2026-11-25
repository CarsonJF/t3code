import { useAtomValue } from "@effect/atom-react";
import { providerClients } from "@t3tools/client-runtime/provider-clients";
import {
  DEFAULT_TOUCH_BAR_COLORS,
  DEFAULT_TOUCH_BAR_SETTINGS,
  TOUCH_BAR_AUTO_CYCLE_SECONDS,
  TOUCH_BAR_BAR_WIDTH,
  type TouchBarProviderLimits,
  type TouchBarSettings as TouchBarSettingsValue,
} from "@t3tools/contracts";
import { buildTouchBarView, nextTouchBarProvider } from "@t3tools/shared/touchBar";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { useGT, useLocale, useMessages } from "gt-react";
import { useState, type ReactNode } from "react";

import { isElectron } from "../../env";
import { useClientSettings, updateClientSettings } from "../../hooks/useSettings";
import { isMacPlatform } from "../../lib/utils";
import { environmentPresentations } from "../../state/presentation";
import { collectTouchBarProviders } from "../../touchBar/touchBarState";
import { Button } from "../ui/button";
import { NumberField, NumberFieldGroup, NumberFieldInput } from "../ui/number-field";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { commitNumberFieldOnEnter } from "./commitNumberFieldOnEnter";
import { ProviderAccentColorPicker } from "./ProviderAccentColorPicker";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import { TouchBarPreview } from "./TouchBarPreview";

const NO_GROUPING = { useGrouping: false } as const;
const HOUR = 3_600_000;

/** Shown when no provider reports limits, so the preview still says something. Labels mimic the server's. */
function sampleProviders(now: number): TouchBarProviderLimits[] {
  return [
    {
      driver: "claudeAgent",
      name: "Claude Code",
      windows: [
        {
          id: "five_hour",
          kind: "session",
          // oxlint-disable-next-line t3code/no-untranslated-copy -- stands in for server-authored limit labels, which stay English
          label: "Session",
          usedPercent: 42,
          resetsAt: now + 3 * HOUR,
        },
        {
          id: "seven_day",
          kind: "weekly",
          // oxlint-disable-next-line t3code/no-untranslated-copy -- stands in for server-authored limit labels, which stay English
          label: "Weekly",
          usedPercent: 83,
          resetsAt: now + 100 * HOUR,
        },
        {
          id: "seven_day_fable",
          kind: "weekly",
          // oxlint-disable-next-line t3code/no-untranslated-copy -- stands in for server-authored limit labels, which stay English
          label: "Weekly · Fable",
          usedPercent: 93,
          resetsAt: now + 100 * HOUR,
        },
      ],
    },
    {
      driver: "cursor",
      name: "Cursor",
      windows: [
        { id: "apiPercentUsed", kind: "monthly", label: "API", usedPercent: 12, resetsAt: null },
      ],
    },
  ];
}

/** Where the Touch Bar exists: the desktop app on a Mac. The page still renders elsewhere. */
function isTouchBarSettingsAvailable() {
  return isElectron && isMacPlatform(navigator.platform);
}

function Choice<Value extends string>(props: {
  readonly label: string;
  readonly value: Value;
  readonly options: ReadonlyArray<readonly [Value, string]>;
  readonly onChange: (value: Value) => void;
  readonly disabled?: boolean;
}) {
  return (
    <Select
      value={props.value}
      disabled={props.disabled}
      onValueChange={(value) => {
        if (value !== null) props.onChange(value as Value);
      }}
    >
      <SelectTrigger aria-label={props.label} className="min-w-40" size="sm">
        <SelectValue>{props.options.find(([value]) => value === props.value)?.[1]}</SelectValue>
      </SelectTrigger>
      <SelectPopup>
        {props.options.map(([value, label]) => (
          <SelectItem key={value} value={value}>
            {label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

function IntegerField(props: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onCommit: (value: number) => void;
  readonly disabled?: boolean;
}) {
  return (
    <div className="w-24">
      <NumberField
        value={props.value}
        min={props.min}
        max={props.max}
        format={NO_GROUPING}
        size="sm"
        disabled={props.disabled}
        onValueCommitted={(value) => {
          if (value === null || !Number.isFinite(value)) return;
          const next = Math.round(Math.min(props.max, Math.max(props.min, value)));
          if (next !== props.value) props.onCommit(next);
        }}
      >
        <NumberFieldGroup>
          <NumberFieldInput aria-label={props.label} onKeyDown={commitNumberFieldOnEnter} />
        </NumberFieldGroup>
      </NumberField>
    </div>
  );
}

function Toggle(props: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean;
}) {
  return (
    <Switch
      checked={props.checked}
      disabled={props.disabled}
      aria-label={props.label}
      onCheckedChange={(checked) => props.onChange(Boolean(checked))}
    />
  );
}

export function TouchBarSettings() {
  const gt = useGT();
  const m = useMessages();
  const locale = useLocale();
  const setting = useSearchableSetting();
  const settings = useClientSettings((value) => value.touchBar);
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  // Advanced only by edits, like the Limits page, so the page never repaints on a timer.
  const [now] = useState(() => Date.now());
  const [selectedDriver, setSelectedDriver] = useState<string | null>(null);
  const live = collectTouchBarProviders(presentations, now);
  const providers = live.length > 0 ? live : sampleProviders(now);
  const available = isTouchBarSettingsAvailable();
  const off = !settings.enabled;

  const save = (patch: Partial<TouchBarSettingsValue>) =>
    void updateClientSettings({ touchBar: { ...settings, ...patch } });

  const view = buildTouchBarView(
    {
      settings,
      providers,
      focusedDriver: null,
      lastUsedDriver: null,
      threadStatus: "running",
      accentColor: null,
      locale,
      selectedDriver,
      now,
    },
    m,
  );

  // Every provider the settings or the data name, in the strip's order, with its on/off state.
  const entries = [
    ...settings.providers,
    ...providers
      .filter((provider) => !settings.providers.some((entry) => entry.driver === provider.driver))
      .map((provider) => ({ driver: provider.driver, enabled: true })),
  ];
  const providerName = (driver: string) =>
    providers.find((provider) => provider.driver === driver)?.name ??
    providerClients.get(driver as never)?.label ??
    driver;
  const moveProvider = (index: number, offset: -1 | 1) => {
    const next = [...entries];
    const [entry] = next.splice(index, 1);
    if (!entry) return;
    next.splice(index + offset, 0, entry);
    save({ providers: next });
  };
  const toggleProvider = (driver: string, enabled: boolean) =>
    save({
      providers: entries.map((entry) => (entry.driver === driver ? { driver, enabled } : entry)),
    });
  const toggleWindow = (driver: string, windowId: string, shown: boolean) => {
    const hidden = new Set(settings.hiddenWindows[driver] ?? []);
    if (shown) hidden.delete(windowId);
    else hidden.add(windowId);
    save({ hiddenWindows: { ...settings.hiddenWindows, [driver]: [...hidden] } });
  };

  const defaultProviderValue =
    settings.defaultProvider === "fixed" && settings.fixedProvider
      ? `fixed:${settings.fixedProvider}`
      : settings.defaultProvider === "fixed"
        ? "focused"
        : settings.defaultProvider;
  const colorRow = (tone: keyof typeof DEFAULT_TOUCH_BAR_COLORS, title: string): ReactNode => (
    <SettingsRow
      title={title}
      resetAction={
        settings.colors[tone] !== DEFAULT_TOUCH_BAR_COLORS[tone] ? (
          <SettingResetButton
            ariaLabel={gt("Reset {color} to default", { color: title })}
            onClick={() =>
              save({ colors: { ...settings.colors, [tone]: DEFAULT_TOUCH_BAR_COLORS[tone] } })
            }
          />
        ) : null
      }
      control={
        <ProviderAccentColorPicker
          layout="inline"
          displayName={title}
          value={settings.colors[tone]}
          onCommit={(color) =>
            save({
              colors: { ...settings.colors, [tone]: color || DEFAULT_TOUCH_BAR_COLORS[tone] },
            })
          }
        />
      }
    />
  );

  return (
    <SettingsPageContainer>
      <SettingsSection id="touch-bar" title={gt("Touch Bar")}>
        <SettingsRow
          {...setting("touch-bar-enabled")}
          devicePreference
          description={gt(
            "Shows the open thread's usage limits on a MacBook Pro Touch Bar while T3 Code is the frontmost app.",
          )}
          status={
            available
              ? undefined
              : gt(
                  "Applies to the desktop app on a Mac with a Touch Bar. Here you can only preview it.",
                )
          }
          resetAction={
            JSON.stringify(settings) !== JSON.stringify(DEFAULT_TOUCH_BAR_SETTINGS) ? (
              <SettingResetButton
                ariaLabel={gt("Reset all Touch Bar settings to default")}
                onClick={() => save(DEFAULT_TOUCH_BAR_SETTINGS)}
              />
            ) : null
          }
          control={
            <Toggle
              label={gt("Show usage limits on the Touch Bar")}
              checked={settings.enabled}
              onChange={(enabled) => save({ enabled })}
            />
          }
        />
        <div className="grid gap-2 px-4 py-3">
          <TouchBarPreview
            view={view}
            onSelectProvider={setSelectedDriver}
            onTapWindow={() => {
              if (view.tapAction === "cycle") setSelectedDriver(nextTouchBarProvider(view));
            }}
          />
          <span className="text-xs text-muted-foreground">
            {live.length > 0
              ? gt("Preview with your current limits, as if a thread were running.")
              : gt("Preview with sample limits until a provider reports some.")}
          </span>
        </div>
        <SettingsRow
          title={gt("Always visible")}
          description={gt(
            "Keep the strip in the Control Strip when another app is in front. macOS offers this only through a private API, so it is not available yet.",
          )}
          control={
            <Toggle label={gt("Always visible")} checked={false} disabled onChange={() => {}} />
          }
        />
      </SettingsSection>

      <SettingsSection id="touch-bar-content" title={gt("Content")}>
        <SettingsRow
          title={gt("Default provider")}
          description={gt(
            "Which provider's limits show first. Swiping on the Touch Bar picks another.",
          )}
          control={
            <Choice
              label={gt("Default provider")}
              disabled={off}
              value={defaultProviderValue}
              options={[
                ["focused", gt("Follow the focused thread")],
                ["lastUsed", gt("Last used")],
                ...entries.map(({ driver }) => [`fixed:${driver}`, providerName(driver)] as const),
              ]}
              onChange={(value) =>
                value.startsWith("fixed:")
                  ? save({ defaultProvider: "fixed", fixedProvider: value.slice("fixed:".length) })
                  : save({ defaultProvider: value as "focused" | "lastUsed" })
              }
            />
          }
        />
        <SettingsRow
          title={gt("Providers and limits")}
          description={gt("Choose the order of providers and which of their limits appear.")}
        >
          <ol className="mt-3 divide-y divide-border/60 rounded-lg border border-border/60">
            {entries.map((entry, index) => {
              const name = providerName(entry.driver);
              const windows = providers.find(
                (provider) => provider.driver === entry.driver,
              )?.windows;
              const hidden = new Set(settings.hiddenWindows[entry.driver] ?? []);
              return (
                <li key={entry.driver} className="grid gap-2 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost-muted"
                      disabled={off || index === 0}
                      aria-label={gt("Move {name} up", { name })}
                      onClick={() => moveProvider(index, -1)}
                    >
                      <ArrowUpIcon />
                    </Button>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost-muted"
                      disabled={off || index === entries.length - 1}
                      aria-label={gt("Move {name} down", { name })}
                      onClick={() => moveProvider(index, 1)}
                    >
                      <ArrowDownIcon />
                    </Button>
                    <Toggle
                      label={gt("Show {name} on the Touch Bar", { name })}
                      checked={entry.enabled}
                      disabled={off}
                      onChange={(enabled) => toggleProvider(entry.driver, enabled)}
                    />
                  </div>
                  {entry.enabled && windows && windows.length > 0 ? (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 ps-3">
                      {windows.map((window) => (
                        <label
                          key={window.id}
                          className="flex items-center gap-2 text-xs text-muted-foreground"
                        >
                          <Toggle
                            label={gt("Show {limit} for {name}", { limit: window.label, name })}
                            checked={!hidden.has(window.id)}
                            disabled={off}
                            onChange={(shown) => toggleWindow(entry.driver, window.id, shown)}
                          />
                          {window.label}
                        </label>
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection id="touch-bar-display" title={gt("Display")}>
        <SettingsRow
          title={gt("Percent shown")}
          control={
            <Choice
              label={gt("Percent shown")}
              disabled={off}
              value={settings.percentMode}
              options={[
                ["used", gt("Used")],
                ["remaining", gt("Remaining")],
              ]}
              onChange={(percentMode) => save({ percentMode })}
            />
          }
        />
        <SettingsRow
          title={gt("Reset time")}
          control={
            <Choice
              label={gt("Reset time")}
              disabled={off}
              value={settings.resetFormat}
              options={[
                ["relative", gt("Relative (3h)")],
                ["absolute", gt("Absolute (Mon 9 PM)")],
                ["hidden", gt("Hidden", { $context: "reset time is not shown" })],
              ]}
              onChange={(resetFormat) => save({ resetFormat })}
            />
          }
        />
        <SettingsRow
          title={gt("Limit labels")}
          control={
            <Choice
              label={gt("Limit labels")}
              disabled={off}
              value={settings.labelStyle}
              options={[
                ["full", gt("Full")],
                ["short", gt("Short")],
                ["icon", gt("Icon only")],
              ]}
              onChange={(labelStyle) => save({ labelStyle })}
            />
          }
        />
        <SettingsRow
          title={gt("Show provider name")}
          control={
            <Toggle
              label={gt("Show provider name")}
              disabled={off}
              checked={settings.showProvider}
              onChange={(showProvider) => save({ showProvider })}
            />
          }
        />
        <SettingsRow
          title={gt("Compact")}
          description={gt("Fold each limit into one key so more fit.")}
          control={
            <Toggle
              label={gt("Compact Touch Bar")}
              disabled={off}
              checked={settings.compact}
              onChange={(compact) => save({ compact })}
            />
          }
        />
        <SettingsRow
          title={gt("Bar style")}
          control={
            <Choice
              label={gt("Bar style")}
              disabled={off}
              value={settings.barStyle}
              options={[
                ["filled", gt("Filled bar")],
                ["segmented", gt("Segmented blocks")],
                ["text", gt("Text only")],
              ]}
              onChange={(barStyle) => save({ barStyle })}
            />
          }
        />
        <SettingsRow
          title={gt("Bar width")}
          description={gt("In points, from {min} to {max}.", {
            min: TOUCH_BAR_BAR_WIDTH.min,
            max: TOUCH_BAR_BAR_WIDTH.max,
          })}
          control={
            <IntegerField
              label={gt("Bar width")}
              disabled={off || settings.barStyle === "text"}
              value={settings.barWidth}
              min={TOUCH_BAR_BAR_WIDTH.min}
              max={TOUCH_BAR_BAR_WIDTH.max}
              onCommit={(barWidth) => save({ barWidth })}
            />
          }
        />
      </SettingsSection>

      <SettingsSection id="touch-bar-colors" title={gt("Colors")}>
        <SettingsRow
          title={gt("Warning at")}
          description={gt("Percent used where a limit turns to the warning color.")}
          control={
            <IntegerField
              label={gt("Warning at percent used")}
              disabled={off}
              value={settings.warningAt}
              min={0}
              max={100}
              onCommit={(warningAt) => save({ warningAt })}
            />
          }
        />
        <SettingsRow
          title={gt("Critical at")}
          description={gt("Percent used where a limit turns to the critical color.")}
          control={
            <IntegerField
              label={gt("Critical at percent used")}
              disabled={off}
              value={settings.criticalAt}
              min={0}
              max={100}
              onCommit={(criticalAt) => save({ criticalAt })}
            />
          }
        />
        <SettingsRow
          title={gt("Match theme accent")}
          description={gt("Use the theme's accent color below the warning threshold.")}
          control={
            <Toggle
              label={gt("Match theme accent")}
              disabled={off}
              checked={settings.matchThemeAccent}
              onChange={(matchThemeAccent) => save({ matchThemeAccent })}
            />
          }
        />
        {colorRow("normal", gt("Normal color"))}
        {colorRow("warning", gt("Warning color"))}
        {colorRow("critical", gt("Critical color"))}
      </SettingsSection>

      <SettingsSection id="touch-bar-behavior" title={gt("Behavior")}>
        <SettingsRow
          title={gt("Switch providers with")}
          control={
            <Choice
              label={gt("Switch providers with")}
              disabled={off}
              value={settings.switcher}
              options={[
                ["scrubber", gt("Swipe (scrubber)")],
                ["segmented", gt("Segmented control")],
                ["both", gt("Both")],
              ]}
              onChange={(switcher) => save({ switcher })}
            />
          }
        />
        <SettingsRow
          title={gt("Tapping a limit")}
          control={
            <Choice
              label={gt("Tapping a limit")}
              disabled={off}
              value={settings.tapAction}
              options={[
                ["openLimits", gt("Opens the Limits page")],
                ["cycle", gt("Shows the next provider")],
                ["none", gt("Does nothing")],
              ]}
              onChange={(tapAction) => save({ tapAction })}
            />
          }
        />
        <SettingsRow
          title={gt("Cycle providers")}
          description={gt("Show the next provider every few seconds.")}
          control={
            <div className="flex items-center gap-3">
              {settings.autoCycleSeconds > 0 ? (
                <IntegerField
                  label={gt("Seconds between providers")}
                  disabled={off}
                  value={settings.autoCycleSeconds}
                  min={TOUCH_BAR_AUTO_CYCLE_SECONDS.min}
                  max={TOUCH_BAR_AUTO_CYCLE_SECONDS.max}
                  onCommit={(autoCycleSeconds) => save({ autoCycleSeconds })}
                />
              ) : null}
              <Toggle
                label={gt("Cycle providers")}
                disabled={off}
                checked={settings.autoCycleSeconds > 0}
                onChange={(on) => save({ autoCycleSeconds: on ? 10 : 0 })}
              />
            </div>
          }
        />
        <SettingsRow
          title={gt("Hide while a thread is running")}
          control={
            <Toggle
              label={gt("Hide while a thread is running")}
              disabled={off}
              checked={settings.hideWhileRunning}
              onChange={(hideWhileRunning) => save({ hideWhileRunning })}
            />
          }
        />
        <SettingsRow
          title={gt("Only when a limit is high")}
          description={gt("Show the strip only once some limit is above this percent used.")}
          control={
            <div className="flex items-center gap-3">
              {settings.showAboveUsedPercent !== null ? (
                <IntegerField
                  label={gt("Show above percent used")}
                  disabled={off}
                  value={settings.showAboveUsedPercent}
                  min={0}
                  max={100}
                  onCommit={(showAboveUsedPercent) => save({ showAboveUsedPercent })}
                />
              ) : null}
              <Toggle
                label={gt("Only when a limit is high")}
                disabled={off}
                checked={settings.showAboveUsedPercent !== null}
                onChange={(on) => save({ showAboveUsedPercent: on ? 75 : null })}
              />
            </div>
          }
        />
      </SettingsSection>

      <SettingsSection id="touch-bar-extras" title={gt("Extras")}>
        <SettingsRow
          title={gt("Thread status")}
          description={gt("Show whether the open thread is running or idle.")}
          control={
            <Toggle
              label={gt("Show thread status")}
              disabled={off}
              checked={settings.showThreadStatus}
              onChange={(showThreadStatus) => save({ showThreadStatus })}
            />
          }
        />
        <SettingsRow
          title={gt("New thread button")}
          control={
            <Toggle
              label={gt("Show a new thread button")}
              disabled={off}
              checked={settings.showNewThreadButton}
              onChange={(showNewThreadButton) => save({ showNewThreadButton })}
            />
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
