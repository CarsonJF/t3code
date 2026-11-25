import {
  DEFAULT_TOUCH_BAR_SETTINGS,
  type TouchBarProviderLimits,
  type TouchBarSettings,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildTouchBarView,
  nextTouchBarProvider,
  orderTouchBarProviders,
  touchBarResetText,
  touchBarTone,
  touchBarWindowLabel,
  type TouchBarViewInput,
} from "./touchBar.ts";

const NOW = Date.parse("2026-11-25T12:00:00Z"); // A Wednesday.
const HOUR = 3_600_000;

const claude: TouchBarProviderLimits = {
  driver: "claudeAgent",
  name: "Claude",
  windows: [
    {
      id: "five_hour",
      kind: "session",
      label: "Session",
      usedPercent: 42,
      resetsAt: NOW + 3 * HOUR,
    },
    {
      id: "seven_day",
      kind: "weekly",
      label: "Weekly",
      usedPercent: 81.4,
      resetsAt: NOW + 5 * 24 * HOUR,
    },
    {
      id: "seven_day_fable",
      kind: "weekly",
      label: "Weekly · Fable",
      usedPercent: 95,
      resetsAt: NOW + 5 * 24 * HOUR,
    },
  ],
};
const cursor: TouchBarProviderLimits = {
  driver: "cursor",
  name: "Cursor",
  windows: [
    { id: "apiPercentUsed", kind: "monthly", label: "API", usedPercent: 10, resetsAt: null },
  ],
};
const opencode: TouchBarProviderLimits = {
  driver: "opencode",
  name: "OpenCode",
  windows: [
    { id: "go_5h", kind: "session", label: "Go", usedPercent: 3, resetsAt: NOW + HOUR / 2 },
  ],
};

const input = (
  settings: Partial<TouchBarSettings> = {},
  overrides: Partial<TouchBarViewInput> = {},
): TouchBarViewInput => ({
  settings: { ...DEFAULT_TOUCH_BAR_SETTINGS, ...settings },
  providers: [claude, cursor, opencode],
  focusedDriver: "claudeAgent",
  lastUsedDriver: null,
  threadStatus: "idle",
  accentColor: "#5b8def",
  locale: "en",
  selectedDriver: null,
  now: NOW,
  timeZone: "UTC",
  ...overrides,
});

describe("buildTouchBarView defaults", () => {
  it("shows the focused provider's windows with used percent, bars and short resets", () => {
    const view = buildTouchBarView(input());
    expect(view.hidden).toBeNull();
    expect(view.current).toEqual({ driver: "claudeAgent", name: "Claude" });
    expect(view.switcher).toBe("scrubber");
    expect(view.tapAction).toBe("openLimits");
    expect(view.autoCycleSeconds).toBe(0);
    expect(view.threadStatus).toBeNull();
    expect(view.newThreadButton).toBe(false);
    expect(
      view.items.map(({ label, percentText, fill, tone, color, reset, barWidth }) => ({
        label,
        percentText,
        fill,
        tone,
        color,
        reset,
        barWidth,
      })),
    ).toEqual([
      {
        label: "Session",
        percentText: "42%",
        fill: 0.42,
        tone: "normal",
        color: "#34c759",
        reset: "3h",
        barWidth: 64,
      },
      {
        label: "Weekly",
        percentText: "81%",
        fill: 0.81,
        tone: "warning",
        color: "#ff9f0a",
        reset: "5d",
        barWidth: 64,
      },
      {
        label: "Weekly · Fable",
        percentText: "95%",
        fill: 0.95,
        tone: "critical",
        color: "#ff453a",
        reset: "5d",
        barWidth: 64,
      },
    ]);
  });
});

describe("provider ordering and choice", () => {
  it("orders listed providers first, drops disabled ones and keeps the rest in data order", () => {
    const ordered = orderTouchBarProviders([claude, cursor, opencode], {
      providers: [
        { driver: "opencode", enabled: true },
        { driver: "cursor", enabled: false },
        { driver: "codex", enabled: true },
      ],
      hiddenWindows: {},
    });
    expect(ordered.map((provider) => provider.driver)).toEqual(["opencode", "claudeAgent"]);
  });

  it("drops a provider whose windows are all hidden", () => {
    const view = buildTouchBarView(input({ hiddenWindows: { cursor: ["apiPercentUsed"] } }));
    expect(view.providers.map((option) => option.driver)).toEqual(["claudeAgent", "opencode"]);
  });

  it("hides chosen windows, including model-specific ones", () => {
    const view = buildTouchBarView(input({ hiddenWindows: { claudeAgent: ["seven_day_fable"] } }));
    expect(view.items.map((item) => item.id)).toEqual(["five_hour", "seven_day"]);
  });

  it("follows the focused thread, then the last used, then the first with data", () => {
    expect(buildTouchBarView(input({}, { focusedDriver: "cursor" })).current?.driver).toBe(
      "cursor",
    );
    expect(
      buildTouchBarView(input({}, { focusedDriver: null, lastUsedDriver: "opencode" })).current
        ?.driver,
    ).toBe("opencode");
    // A focused provider without limit data falls through.
    expect(
      buildTouchBarView(input({}, { focusedDriver: "codex", lastUsedDriver: null })).current
        ?.driver,
    ).toBe("claudeAgent");
  });

  it("prefers the last used or a fixed provider when set to", () => {
    expect(
      buildTouchBarView(input({ defaultProvider: "lastUsed" }, { lastUsedDriver: "cursor" }))
        .current?.driver,
    ).toBe("cursor");
    expect(
      buildTouchBarView(input({ defaultProvider: "fixed", fixedProvider: "opencode" })).current
        ?.driver,
    ).toBe("opencode");
    expect(
      buildTouchBarView(input({ defaultProvider: "fixed", fixedProvider: null })).current?.driver,
    ).toBe("claudeAgent");
  });

  it("lets a Touch Bar pick win over the default", () => {
    const view = buildTouchBarView(input({}, { selectedDriver: "cursor" }));
    expect(view.current?.driver).toBe("cursor");
    expect(nextTouchBarProvider(view)).toBe("opencode");
    expect(nextTouchBarProvider(buildTouchBarView(input({}, { selectedDriver: "opencode" })))).toBe(
      "claudeAgent",
    );
  });

  it("offers no switcher or auto-cycle with a single provider", () => {
    const view = buildTouchBarView(input({ autoCycleSeconds: 10 }, { providers: [claude] }));
    expect(view.switcher).toBeNull();
    expect(view.autoCycleSeconds).toBe(0);
    expect(nextTouchBarProvider(view)).toBeNull();
    expect(buildTouchBarView(input({ autoCycleSeconds: 10, switcher: "both" }))).toMatchObject({
      autoCycleSeconds: 10,
      switcher: "both",
    });
  });
});

describe("visibility", () => {
  it("names why the strip is hidden", () => {
    expect(buildTouchBarView(input({ enabled: false })).hidden).toBe("disabled");
    expect(buildTouchBarView(input({}, { providers: [] })).hidden).toBe("noData");
    expect(
      buildTouchBarView(input({ hideWhileRunning: true }, { threadStatus: "running" })).hidden,
    ).toBe("running");
    expect(buildTouchBarView(input({ hideWhileRunning: true })).hidden).toBeNull();
    expect(buildTouchBarView(input({ showAboveUsedPercent: 96 })).hidden).toBe("belowThreshold");
    // Any provider's window counts, not only the current one's.
    expect(
      buildTouchBarView(input({ showAboveUsedPercent: 90 }, { focusedDriver: "cursor" })).hidden,
    ).toBeNull();
  });
});

describe("display settings", () => {
  it("shows remaining percent and fills the bar with what is left", () => {
    const [session] = buildTouchBarView(input({ percentMode: "remaining" })).items;
    expect(session).toMatchObject({
      percent: 58,
      percentText: "58% left",
      fill: 0.58,
      tone: "normal",
    });
    const [compact] = buildTouchBarView(input({ percentMode: "remaining", compact: true })).items;
    expect(compact).toMatchObject({ percentText: "58%", barWidth: 48 });
  });

  it("colors by configurable cutoffs, custom colors and the theme accent", () => {
    const items = buildTouchBarView(
      input({
        warningAt: 40,
        criticalAt: 82,
        matchThemeAccent: true,
        colors: { normal: "#000001", warning: "#000002", critical: "#000003" },
      }),
    ).items;
    expect(items.map((item) => [item.tone, item.color])).toEqual([
      ["warning", "#000002"],
      ["warning", "#000002"],
      ["critical", "#000003"],
    ]);
    const [accented] = buildTouchBarView(input({ matchThemeAccent: true })).items;
    expect(accented?.color).toBe("#5b8def");
    const [noAccent] = buildTouchBarView(
      input({ matchThemeAccent: true }, { accentColor: null }),
    ).items;
    expect(noAccent?.color).toBe("#34c759");
  });

  it("splits segmented bars into blocks", () => {
    const [session, weekly] = buildTouchBarView(input({ barStyle: "segmented" })).items;
    expect(session).toMatchObject({ barStyle: "segmented", segments: { total: 10, filled: 4 } });
    expect(weekly?.segments).toEqual({ total: 10, filled: 8 });
    const [compact] = buildTouchBarView(input({ barStyle: "segmented", compact: true })).items;
    expect(compact?.segments).toEqual({ total: 5, filled: 2 });
  });

  it("passes bar width and style through", () => {
    const [item] = buildTouchBarView(input({ barStyle: "text", barWidth: 120 })).items;
    expect(item).toMatchObject({ barStyle: "text", barWidth: 120 });
  });

  it("adds the thread status and new thread extras when asked", () => {
    const view = buildTouchBarView(
      input({ showThreadStatus: true, showNewThreadButton: true }, { threadStatus: "running" }),
    );
    expect(view.threadStatus).toEqual({ status: "running", label: "Running" });
    expect(view.newThreadButton).toBe(true);
    expect(
      buildTouchBarView(input({ showThreadStatus: true }, { threadStatus: null })).threadStatus,
    ).toBeNull();
  });
});

describe("labels", () => {
  const fable = { kind: "weekly" as const, label: "Weekly · Fable" };
  it("shortens kinds and keeps the model name", () => {
    expect(touchBarWindowLabel(fable, "full")).toBe("Weekly · Fable");
    expect(touchBarWindowLabel(fable, "short")).toBe("W·Fable");
    expect(touchBarWindowLabel({ kind: "session", label: "Session" }, "short")).toBe("S");
    expect(touchBarWindowLabel({ kind: "other", label: "Auto + Composer" }, "short")).toBe("Auto");
  });
  it("uses an icon per kind, with the model's initial", () => {
    expect(touchBarWindowLabel(fable, "icon")).toBe("📅F");
    expect(touchBarWindowLabel({ kind: "session", label: "Session" }, "icon")).toBe("⏱");
  });
});

describe("touchBarTone", () => {
  it("rounds before comparing with the cutoffs", () => {
    const cutoffs = { warningAt: 80, criticalAt: 90 };
    expect(touchBarTone(79.4, cutoffs)).toBe("normal");
    expect(touchBarTone(79.6, cutoffs)).toBe("warning");
    expect(touchBarTone(90, cutoffs)).toBe("critical");
    expect(touchBarTone(150, cutoffs)).toBe("critical");
  });
});

describe("touchBarResetText", () => {
  const reset = (at: number, format: "relative" | "absolute" | "hidden" = "relative") =>
    touchBarResetText(at, format, NOW, "en", "UTC");
  it("counts down in minutes, hours, then days", () => {
    expect(reset(NOW + 20_000)).toBe("1m");
    expect(reset(NOW + 45 * 60_000)).toBe("45m");
    expect(reset(NOW + 3 * HOUR + 10 * 60_000)).toBe("3h");
    expect(reset(NOW + 30 * HOUR)).toBe("30h");
    expect(reset(NOW + 5 * 24 * HOUR)).toBe("5d");
  });
  it("names the time, then the weekday, then the date", () => {
    expect(reset(Date.parse("2026-11-25T21:00:00Z"), "absolute")).toBe("9 PM");
    expect(reset(Date.parse("2026-11-25T21:30:00Z"), "absolute")).toBe("9:30 PM");
    expect(reset(Date.parse("2026-11-30T21:00:00Z"), "absolute")).toBe("Mon 9 PM");
    expect(reset(Date.parse("2026-12-09T09:00:00Z"), "absolute")).toBe("Dec 9");
  });
  it("shows nothing when hidden, unknown or already past", () => {
    expect(reset(NOW + HOUR, "hidden")).toBeNull();
    expect(touchBarResetText(null, "relative", NOW, "en")).toBeNull();
    expect(reset(NOW - 1)).toBeNull();
  });
  it("falls back to English for an unreadable locale", () => {
    expect(touchBarResetText(NOW + 3 * HOUR, "relative", NOW, "not a locale!", "UTC")).toBe("3h");
  });
});
