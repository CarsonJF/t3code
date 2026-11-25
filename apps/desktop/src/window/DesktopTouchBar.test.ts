import { DEFAULT_TOUCH_BAR_SETTINGS, type TouchBarState } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const native = vi.hoisted(() => {
  const item = (kind: string) =>
    class {
      readonly kind = kind;
      readonly options: Record<string, unknown>;
      constructor(options: Record<string, unknown>) {
        this.options = options;
      }
    };
  class TouchBar {
    static TouchBarButton = item("button");
    static TouchBarLabel = item("label");
    static TouchBarSpacer = item("spacer");
    static TouchBarScrubber = item("scrubber");
    static TouchBarSegmentedControl = item("segmented");
    readonly options: { items: Array<{ kind: string; options: any }> };
    constructor(options: { items: Array<{ kind: string; options: any }> }) {
      this.options = options;
    }
  }
  return { TouchBar, createFromBuffer: vi.fn(() => ({ image: true })) };
});
vi.mock("electron", () => ({
  TouchBar: native.TouchBar,
  nativeImage: { createFromBuffer: native.createFromBuffer },
}));

import { createTouchBarController } from "./DesktopTouchBar.ts";

const NOW = Date.parse("2026-11-25T12:00:00Z");
const HOUR = 3_600_000;

const state = (overrides: Partial<TouchBarState> = {}): TouchBarState => ({
  settings: DEFAULT_TOUCH_BAR_SETTINGS,
  providers: [
    {
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
          usedPercent: 85,
          resetsAt: NOW + 5 * 24 * HOUR,
        },
      ],
    },
    {
      driver: "cursor",
      name: "Cursor",
      windows: [
        { id: "apiPercentUsed", kind: "monthly", label: "API", usedPercent: 10, resetsAt: null },
      ],
    },
  ],
  focusedDriver: "claudeAgent",
  lastUsedDriver: null,
  threadStatus: "idle",
  accentColor: null,
  locale: "en",
  ...overrides,
});

function fakeWindow() {
  return { isDestroyed: () => false, setTouchBar: vi.fn() };
}
type FakeWindow = ReturnType<typeof fakeWindow>;
const drawn = (window: FakeWindow) =>
  window.setTouchBar.mock.lastCall?.[0] as InstanceType<typeof native.TouchBar> | null;
const kinds = (window: FakeWindow) => drawn(window)?.options.items.map((item) => item.kind);

let now = NOW;
const dispatch = vi.fn();
let controller: ReturnType<typeof createTouchBarController>;

beforeEach(() => {
  vi.useFakeTimers();
  now = NOW;
  dispatch.mockReset();
  controller = createTouchBarController({ now: () => now, dispatch });
});
afterEach(() => {
  controller.dispose();
  vi.useRealTimers();
});

describe("createTouchBarController", () => {
  it("draws the provider, each window as a label and bar button, and a scrubber", () => {
    const window = fakeWindow();
    controller.update(window as never, state());
    expect(kinds(window)).toEqual([
      "label",
      "spacer",
      "label",
      "button",
      "spacer",
      "label",
      "button",
      "spacer",
      "scrubber",
    ]);
    const items = drawn(window)!.options.items;
    expect(items[0]!.options.label).toBe("Claude");
    expect(items[2]!.options.label).toBe("Session");
    expect(items[3]!.options).toMatchObject({ label: "42% 3h", iconPosition: "left" });
    expect(items[6]!.options.label).toBe("85% 5d");
    expect(native.createFromBuffer).toHaveBeenCalledWith(expect.any(Buffer), { scaleFactor: 2 });
    expect(items[8]!.options.items).toEqual([{ label: "Claude" }, { label: "Cursor" }]);
  });

  it("switches provider from the scrubber until the focused thread changes", () => {
    const window = fakeWindow();
    controller.update(window as never, state());
    const scrubber = drawn(window)!.options.items.at(-1)!;
    scrubber.options.select(1);
    expect(controller.view?.current?.driver).toBe("cursor");
    controller.update(window as never, state());
    expect(controller.view?.current?.driver).toBe("cursor");
    controller.update(
      window as never,
      state({ focusedDriver: "claudeAgent", lastUsedDriver: "x" }),
    );
    expect(controller.view?.current?.driver).toBe("cursor");
    controller.update(window as never, state({ focusedDriver: null }));
    expect(controller.view?.current?.driver).toBe("claudeAgent");
  });

  it("opens the Limits page or cycles providers on tap", () => {
    const window = fakeWindow();
    controller.update(window as never, state());
    drawn(window)!.options.items[3]!.options.click();
    expect(dispatch).toHaveBeenCalledWith(window, "touchBar.openLimits");

    controller.update(
      window as never,
      state({ settings: { ...DEFAULT_TOUCH_BAR_SETTINGS, tapAction: "cycle" } }),
    );
    drawn(window)!.options.items[3]!.options.click();
    expect(controller.view?.current?.driver).toBe("cursor");

    controller.update(
      window as never,
      state({ settings: { ...DEFAULT_TOUCH_BAR_SETTINGS, tapAction: "none" } }),
    );
    expect(drawn(window)!.options.items[3]!.options.click).toBeUndefined();
  });

  it("uses a segmented control, compact buttons, text-only bars and the extras", () => {
    const window = fakeWindow();
    controller.update(
      window as never,
      state({
        settings: {
          ...DEFAULT_TOUCH_BAR_SETTINGS,
          switcher: "segmented",
          compact: true,
          barStyle: "text",
          showProvider: false,
          showThreadStatus: true,
          showNewThreadButton: true,
        },
        threadStatus: "running",
      }),
    );
    expect(kinds(window)).toEqual([
      "button",
      "button",
      "spacer",
      "segmented",
      "spacer",
      "label",
      "spacer",
      "button",
    ]);
    const items = drawn(window)!.options.items;
    expect(items[0]!.options.label).toBe("Session 42% 3h");
    expect(items[0]!.options.icon).toBeUndefined();
    expect(items[3]!.options).toMatchObject({ selectedIndex: 0 });
    items[3]!.options.change(1);
    expect(controller.view?.current?.driver).toBe("cursor");
    expect(items[5]!.options.label).toBe("● Running");
    items[7]!.options.click();
    expect(dispatch).toHaveBeenCalledWith(window, "touchBar.newThread");
  });

  it("clears the bar while hidden and redraws only when the view changes", () => {
    const window = fakeWindow();
    controller.update(window as never, state());
    controller.update(window as never, state());
    expect(window.setTouchBar).toHaveBeenCalledTimes(1);
    controller.update(
      window as never,
      state({ settings: { ...DEFAULT_TOUCH_BAR_SETTINGS, enabled: false } }),
    );
    expect(window.setTouchBar).toHaveBeenLastCalledWith(null);
  });

  it("refreshes reset countdowns each minute and auto-cycles when asked", () => {
    const window = fakeWindow();
    controller.update(
      window as never,
      state({ settings: { ...DEFAULT_TOUCH_BAR_SETTINGS, autoCycleSeconds: 10 } }),
    );
    expect(controller.view?.current?.driver).toBe("claudeAgent");
    vi.advanceTimersByTime(10_000);
    expect(controller.view?.current?.driver).toBe("cursor");
    vi.advanceTimersByTime(10_000);
    expect(controller.view?.current?.driver).toBe("claudeAgent");

    now = NOW + 2 * HOUR;
    vi.advanceTimersByTime(60_000);
    const button = drawn(window)!.options.items.find((item) => item.kind === "button");
    expect(button?.options.label).toBe("42% 1h");
  });

  it("removes the bar on dispose", () => {
    const window = fakeWindow();
    controller.update(window as never, state());
    controller.dispose();
    expect(window.setTouchBar).toHaveBeenLastCalledWith(null);
  });
});
