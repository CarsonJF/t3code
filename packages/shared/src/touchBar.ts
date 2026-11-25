import type {
  TouchBarBarStyle,
  TouchBarLimitWindow,
  TouchBarProviderLimits,
  TouchBarSettings,
  TouchBarState,
  TouchBarSwitcher,
  TouchBarTapAction,
} from "@t3tools/contracts";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

export type TouchBarTone = "normal" | "warning" | "critical";

export interface TouchBarWindowItem {
  readonly id: string;
  readonly label: string;
  /** The percent the strip shows: used or remaining, per the settings. */
  readonly percent: number;
  readonly percentText: string;
  /** 0 to 1, the share of the bar to fill. */
  readonly fill: number;
  readonly tone: TouchBarTone;
  readonly color: string;
  readonly reset: string | null;
  readonly barStyle: TouchBarBarStyle;
  readonly barWidth: number;
  /** For the segmented style. */
  readonly segments: { readonly total: number; readonly filled: number };
}

export interface TouchBarProviderOption {
  readonly driver: string;
  readonly name: string;
}

export type TouchBarHiddenReason = "disabled" | "noData" | "running" | "belowThreshold";

export interface TouchBarView {
  readonly hidden: TouchBarHiddenReason | null;
  /** Providers the switcher offers, in display order. */
  readonly providers: readonly TouchBarProviderOption[];
  readonly current: TouchBarProviderOption | null;
  readonly showProvider: boolean;
  readonly compact: boolean;
  readonly items: readonly TouchBarWindowItem[];
  /** Null when there is nothing to switch between. */
  readonly switcher: TouchBarSwitcher | null;
  readonly tapAction: TouchBarTapAction;
  /** 0 when off or with one provider. */
  readonly autoCycleSeconds: number;
  readonly threadStatus: { readonly status: "running" | "idle"; readonly label: string } | null;
  readonly newThreadButton: boolean;
}

export interface TouchBarViewInput extends TouchBarState {
  /** A provider picked on the Touch Bar itself; wins until the focused thread changes. */
  readonly selectedDriver: string | null;
  readonly now: number;
  readonly timeZone?: string;
}

const clampPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

/** Providers with something to show, ordered by the settings, then by the Limits page's order. */
export function orderTouchBarProviders(
  providers: readonly TouchBarProviderLimits[],
  settings: Pick<TouchBarSettings, "providers" | "hiddenWindows">,
): readonly TouchBarProviderLimits[] {
  const byDriver = new Map(providers.map((provider) => [provider.driver, provider]));
  const listed = settings.providers.flatMap((entry) => {
    const provider = byDriver.get(entry.driver);
    return provider ? [{ provider, enabled: entry.enabled }] : [];
  });
  const listedDrivers = new Set(settings.providers.map((entry) => entry.driver));
  const rest = providers
    .filter((provider) => !listedDrivers.has(provider.driver))
    .map((provider) => ({ provider, enabled: true }));
  return [...listed, ...rest].flatMap(({ provider, enabled }) => {
    if (!enabled) return [];
    const windows = visibleWindows(provider, settings.hiddenWindows);
    return windows.length === 0 ? [] : [{ ...provider, windows }];
  });
}

function visibleWindows(
  provider: TouchBarProviderLimits,
  hiddenWindows: TouchBarSettings["hiddenWindows"],
): readonly TouchBarLimitWindow[] {
  const hidden = new Set(hiddenWindows[provider.driver] ?? []);
  return provider.windows.filter((window) => !hidden.has(window.id));
}

function resolveCurrent(
  input: TouchBarViewInput,
  drivers: ReadonlySet<string>,
  first: string | undefined,
): string | undefined {
  const { settings } = input;
  const preference =
    settings.defaultProvider === "fixed"
      ? [settings.fixedProvider, input.focusedDriver, input.lastUsedDriver]
      : settings.defaultProvider === "lastUsed"
        ? [input.lastUsedDriver, input.focusedDriver]
        : [input.focusedDriver, input.lastUsedDriver];
  return (
    [input.selectedDriver, ...preference].find(
      (driver): driver is string => driver !== null && drivers.has(driver),
    ) ?? first
  );
}

export function touchBarTone(
  usedPercent: number,
  settings: Pick<TouchBarSettings, "warningAt" | "criticalAt">,
): TouchBarTone {
  const used = clampPercent(usedPercent);
  if (used >= settings.criticalAt) return "critical";
  if (used >= settings.warningAt) return "warning";
  return "normal";
}

const SHORT_KIND_LABELS = {
  session: msg("S", { $context: "one-letter abbreviation of a session usage limit" }),
  weekly: msg("W", { $context: "one-letter abbreviation of a weekly usage limit" }),
  monthly: msg("M", { $context: "one-letter abbreviation of a monthly usage limit" }),
} as const;
const KIND_ICONS = { session: "⏱", weekly: "📅", monthly: "🗓", other: "•" } as const;

/** "Weekly · Fable" names a model-specific allowance; the part after the dot survives shortening. */
function modelSuffix(label: string): string | null {
  const index = label.indexOf(" · ");
  return index === -1 ? null : label.slice(index + 3).trim() || null;
}

export function touchBarWindowLabel(
  window: Pick<TouchBarLimitWindow, "kind" | "label">,
  style: TouchBarSettings["labelStyle"],
  resolve: MFunctionType = mFallback,
): string {
  if (style === "full") return window.label;
  const suffix = modelSuffix(window.label);
  if (style === "icon") {
    return suffix ? `${KIND_ICONS[window.kind]}${suffix.slice(0, 1)}` : KIND_ICONS[window.kind];
  }
  if (window.kind === "other") return window.label.split(" ")[0] ?? window.label;
  const kind = resolve(SHORT_KIND_LABELS[window.kind]);
  return suffix ? `${kind}·${suffix}` : kind;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function touchBarResetText(
  resetsAt: number | null,
  format: TouchBarSettings["resetFormat"],
  now: number,
  locale: string,
  timeZone?: string,
): string | null {
  if (format === "hidden" || resetsAt === null || resetsAt <= now) return null;
  const left = resetsAt - now;
  if (format === "relative") {
    const [unit, value] =
      left < HOUR
        ? (["minute", Math.max(1, Math.ceil(left / 60_000))] as const)
        : left < 2 * DAY
          ? (["hour", Math.round(left / HOUR)] as const)
          : (["day", Math.round(left / DAY)] as const);
    return safeIntl(locale, (tag) =>
      new Intl.NumberFormat(tag, { style: "unit", unit, unitDisplay: "narrow" }).format(value),
    );
  }
  const at = resetsAt;
  const zone = timeZone === undefined ? {} : { timeZone };
  const parts = (date: number) =>
    new Intl.DateTimeFormat("en-CA", { dateStyle: "short", ...zone }).format(date);
  const onTheHour =
    new Intl.DateTimeFormat("en", { minute: "numeric", ...zone }).format(at) === "0";
  const time = onTheHour
    ? { hour: "numeric" as const }
    : { hour: "numeric" as const, minute: "2-digit" as const };
  const options: Intl.DateTimeFormatOptions =
    parts(at) === parts(now)
      ? time
      : left < 6 * DAY
        ? { weekday: "short", ...time }
        : { month: "short", day: "numeric" };
  return safeIntl(locale, (tag) =>
    new Intl.DateTimeFormat(tag, { ...options, ...zone }).format(at),
  );
}

// A locale tag from another build or a hand edit must not break the strip.
function safeIntl(locale: string, format: (tag: string) => string): string {
  try {
    return format(locale);
  } catch {
    return format("en");
  }
}

function windowItem(
  window: TouchBarLimitWindow,
  input: TouchBarViewInput,
  resolve: MFunctionType,
): TouchBarWindowItem {
  const { settings } = input;
  const used = clampPercent(window.usedPercent);
  const percent = settings.percentMode === "used" ? used : 100 - used;
  const tone = touchBarTone(used, settings);
  const color =
    tone === "normal" && settings.matchThemeAccent && input.accentColor
      ? input.accentColor
      : settings.colors[tone];
  const segmentCount = settings.compact ? 5 : 10;
  return {
    id: window.id,
    label: touchBarWindowLabel(window, settings.labelStyle, resolve),
    percent,
    percentText:
      settings.percentMode === "remaining" && !settings.compact
        ? resolve(msg("{remaining}% left", { remaining: percent }))
        : `${percent}%`,
    fill: percent / 100,
    tone,
    color,
    reset: touchBarResetText(
      window.resetsAt,
      settings.resetFormat,
      input.now,
      input.locale,
      input.timeZone,
    ),
    barStyle: settings.barStyle,
    barWidth: settings.compact ? Math.round(settings.barWidth * 0.75) : settings.barWidth,
    segments: { total: segmentCount, filled: Math.round((percent / 100) * segmentCount) },
  };
}

/** Everything the Touch Bar and its settings preview draw, from the renderer's state. */
export function buildTouchBarView(
  input: TouchBarViewInput,
  resolve: MFunctionType = mFallback,
): TouchBarView {
  const { settings } = input;
  const ordered = orderTouchBarProviders(input.providers, settings);
  const options = ordered.map(({ driver, name }) => ({ driver, name }));
  const currentDriver = resolveCurrent(
    input,
    new Set(options.map((option) => option.driver)),
    options[0]?.driver,
  );
  const currentProvider = ordered.find((provider) => provider.driver === currentDriver);
  const anyAbove =
    settings.showAboveUsedPercent === null ||
    ordered.some((provider) =>
      provider.windows.some((window) => window.usedPercent > (settings.showAboveUsedPercent ?? 0)),
    );
  const hidden: TouchBarHiddenReason | null = !settings.enabled
    ? "disabled"
    : currentProvider === undefined
      ? "noData"
      : settings.hideWhileRunning && input.threadStatus === "running"
        ? "running"
        : !anyAbove
          ? "belowThreshold"
          : null;
  const several = options.length > 1;
  return {
    hidden,
    providers: options,
    current: currentProvider
      ? { driver: currentProvider.driver, name: currentProvider.name }
      : null,
    showProvider: settings.showProvider,
    compact: settings.compact,
    items: currentProvider
      ? currentProvider.windows.map((window) => windowItem(window, input, resolve))
      : [],
    switcher: several ? settings.switcher : null,
    tapAction: settings.tapAction,
    autoCycleSeconds: several ? settings.autoCycleSeconds : 0,
    threadStatus:
      settings.showThreadStatus && input.threadStatus !== null
        ? {
            status: input.threadStatus,
            label:
              input.threadStatus === "running"
                ? resolve(msg("Running", { $context: "a thread's agent is working" }))
                : resolve(msg("Idle", { $context: "a thread's agent is not working" })),
          }
        : null,
    newThreadButton: settings.showNewThreadButton,
  };
}

/** The provider after `driver` in the switcher, wrapping around. */
export function nextTouchBarProvider(view: TouchBarView): string | null {
  if (view.providers.length < 2 || view.current === null) return null;
  const index = view.providers.findIndex((option) => option.driver === view.current?.driver);
  return view.providers[(index + 1) % view.providers.length]!.driver;
}
