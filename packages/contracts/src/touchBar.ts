import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

// A missing or unreadable value (a newer build's option, a hand edit) falls back to its own
// default, so one bad field never resets the rest of the device's client settings.
const lenient = <T>(schema: Schema.Codec<T, T>, fallback: NoInfer<T>) => {
  const recovered = Schema.catchDecoding<Schema.Codec<T, T>>(() => Effect.succeedSome(fallback))(
    schema,
  );
  return Schema.withDecodingDefault<typeof recovered>(Effect.succeed(fallback))(recovered);
};

const Percent = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 }));
const HexColor = Schema.String.check(Schema.isPattern(/^#[0-9a-f]{6}$/i));
const DriverName = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64));

export const TOUCH_BAR_BAR_WIDTH = { min: 24, max: 160, default: 64 } as const;
export const TOUCH_BAR_AUTO_CYCLE_SECONDS = { min: 3, max: 600 } as const;

/** Thresholds match the composer's usage tones. */
export const DEFAULT_TOUCH_BAR_COLORS = {
  normal: "#34c759",
  warning: "#ff9f0a",
  critical: "#ff453a",
} as const;

export const TouchBarProviderEntry = Schema.Struct({
  driver: DriverName,
  enabled: Schema.Boolean,
});
export type TouchBarProviderEntry = typeof TouchBarProviderEntry.Type;

export const TouchBarDefaultProvider = Schema.Literals(["focused", "lastUsed", "fixed"]);
export type TouchBarDefaultProvider = typeof TouchBarDefaultProvider.Type;
export const TouchBarPercentMode = Schema.Literals(["used", "remaining"]);
export type TouchBarPercentMode = typeof TouchBarPercentMode.Type;
export const TouchBarResetFormat = Schema.Literals(["relative", "absolute", "hidden"]);
export type TouchBarResetFormat = typeof TouchBarResetFormat.Type;
export const TouchBarLabelStyle = Schema.Literals(["full", "short", "icon"]);
export type TouchBarLabelStyle = typeof TouchBarLabelStyle.Type;
export const TouchBarBarStyle = Schema.Literals(["filled", "segmented", "text"]);
export type TouchBarBarStyle = typeof TouchBarBarStyle.Type;
export const TouchBarSwitcher = Schema.Literals(["scrubber", "segmented", "both"]);
export type TouchBarSwitcher = typeof TouchBarSwitcher.Type;
export const TouchBarTapAction = Schema.Literals(["openLimits", "cycle", "none"]);
export type TouchBarTapAction = typeof TouchBarTapAction.Type;

const TouchBarColors = Schema.Struct({
  normal: HexColor,
  warning: HexColor,
  critical: HexColor,
});

/** The desktop app's Touch Bar usage strip. Applies only on Macs with a Touch Bar. */
export const TouchBarSettings = Schema.Struct({
  enabled: lenient(Schema.Boolean, true),
  /** Order and visibility; providers missing here show after these, in the Limits page's order. */
  providers: lenient(Schema.Array(TouchBarProviderEntry), []),
  /** Window ids hidden per provider driver. */
  hiddenWindows: lenient(Schema.Record(DriverName, Schema.Array(Schema.String)), {}),
  defaultProvider: lenient(TouchBarDefaultProvider, "focused"),
  fixedProvider: lenient(Schema.NullOr(DriverName), null),
  percentMode: lenient(TouchBarPercentMode, "used"),
  resetFormat: lenient(TouchBarResetFormat, "relative"),
  labelStyle: lenient(TouchBarLabelStyle, "full"),
  showProvider: lenient(Schema.Boolean, true),
  compact: lenient(Schema.Boolean, false),
  barStyle: lenient(TouchBarBarStyle, "filled"),
  barWidth: lenient(
    Schema.Int.check(
      Schema.isBetween({ minimum: TOUCH_BAR_BAR_WIDTH.min, maximum: TOUCH_BAR_BAR_WIDTH.max }),
    ),
    TOUCH_BAR_BAR_WIDTH.default,
  ),
  warningAt: lenient(Percent, 80),
  criticalAt: lenient(Percent, 90),
  matchThemeAccent: lenient(Schema.Boolean, false),
  colors: lenient(TouchBarColors, DEFAULT_TOUCH_BAR_COLORS),
  switcher: lenient(TouchBarSwitcher, "scrubber"),
  tapAction: lenient(TouchBarTapAction, "openLimits"),
  /** 0 is off. */
  autoCycleSeconds: lenient(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: TOUCH_BAR_AUTO_CYCLE_SECONDS.max })),
    0,
  ),
  hideWhileRunning: lenient(Schema.Boolean, false),
  /** Show only once some window is above this used percent; null always shows. */
  showAboveUsedPercent: lenient(Schema.NullOr(Percent), null),
  showThreadStatus: lenient(Schema.Boolean, false),
  showNewThreadButton: lenient(Schema.Boolean, false),
});
export type TouchBarSettings = typeof TouchBarSettings.Type;

export const DEFAULT_TOUCH_BAR_SETTINGS: TouchBarSettings = Schema.decodeSync(TouchBarSettings)({});

export const TouchBarLimitWindow = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  kind: Schema.Literals(["session", "weekly", "monthly", "other"]),
  label: Schema.String.check(Schema.isMaxLength(80)),
  usedPercent: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 100 })),
  /** Epoch milliseconds. */
  resetsAt: Schema.NullOr(Schema.Number.check(Schema.isFinite())),
});
export type TouchBarLimitWindow = typeof TouchBarLimitWindow.Type;

export const TouchBarProviderLimits = Schema.Struct({
  driver: DriverName,
  name: Schema.String.check(Schema.isMaxLength(64)),
  windows: Schema.Array(TouchBarLimitWindow).check(Schema.isMaxLength(24)),
});
export type TouchBarProviderLimits = typeof TouchBarProviderLimits.Type;

export const TouchBarThreadStatus = Schema.Literals(["running", "idle"]);
export type TouchBarThreadStatus = typeof TouchBarThreadStatus.Type;

/** What the renderer tells the desktop main process to draw. The renderer owns every input. */
export const TouchBarState = Schema.Struct({
  settings: TouchBarSettings,
  /** Pooled per driver, in the Limits page's order. */
  providers: Schema.Array(TouchBarProviderLimits).check(Schema.isMaxLength(32)),
  focusedDriver: Schema.NullOr(DriverName),
  lastUsedDriver: Schema.NullOr(DriverName),
  /** The focused thread's state; null with no thread focused. */
  threadStatus: Schema.NullOr(TouchBarThreadStatus),
  accentColor: Schema.NullOr(HexColor),
  locale: Schema.String.check(Schema.isMaxLength(35)),
});
export type TouchBarState = typeof TouchBarState.Type;
