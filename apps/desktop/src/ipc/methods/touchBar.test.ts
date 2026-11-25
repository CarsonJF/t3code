import { DEFAULT_TOUCH_BAR_SETTINGS } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { expect, vi } from "vite-plus/test";

vi.mock("electron", () => {
  class Item {
    readonly options: unknown;
    constructor(options: unknown) {
      this.options = options;
    }
  }
  class TouchBar {
    static TouchBarButton = Item;
    static TouchBarLabel = Item;
    static TouchBarSpacer = Item;
    static TouchBarScrubber = Item;
    static TouchBarSegmentedControl = Item;
    readonly options: unknown;
    constructor(options: unknown) {
      this.options = options;
    }
  }
  return { TouchBar, nativeImage: { createFromBuffer: () => ({}) } };
});

import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import { installTouchBar } from "./touchBar.ts";

const state = {
  settings: DEFAULT_TOUCH_BAR_SETTINGS,
  providers: [
    {
      driver: "claudeAgent",
      name: "Claude",
      windows: [
        { id: "five_hour", kind: "session", label: "Session", usedPercent: 42, resetsAt: null },
      ],
    },
  ],
  focusedDriver: "claudeAgent",
  lastUsedDriver: null,
  threadStatus: null,
  accentColor: null,
  locale: "en",
};

const run = (platform: NodeJS.Platform) =>
  Effect.gen(function* () {
    const handlers = new Map<string, DesktopIpc.DesktopIpcHandleListener>();
    const window = {
      isDestroyed: () => false,
      setTouchBar: vi.fn(),
      webContents: { id: 7, send: vi.fn() },
    };
    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* installTouchBar();
        const handler = handlers.get("desktop:set-touch-bar-state")!;
        yield* Effect.promise(() =>
          expect(handler({ sender: { id: 7 } }, { ...state, locale: 5 })).rejects.toBeDefined(),
        );
        yield* Effect.promise(() => Promise.resolve(handler({ sender: { id: 9 } }, state)));
        expect(window.setTouchBar).not.toHaveBeenCalled();
        yield* Effect.promise(() => Promise.resolve(handler({ sender: { id: 7 } }, state)));
      }),
    ).pipe(
      Effect.provideService(HostProcess.Platform, platform),
      Effect.provide([
        Layer.succeed(ElectronWindow.ElectronWindow, {
          main: Effect.succeedSome(window),
        } as never),
        DesktopIpc.layerTest({
          handle: (channel, handler) => {
            handlers.set(channel, handler);
          },
          removeHandler: (channel) => {
            handlers.delete(channel);
          },
          on: vi.fn(),
          removeAllListeners: vi.fn(),
        }),
      ]),
    );
    return { window, handlers };
  });

it.effect("draws on macOS from the main window's renderer and clears on disposal", () =>
  Effect.gen(function* () {
    const { window, handlers } = yield* run("darwin");
    expect(window.setTouchBar).toHaveBeenCalledTimes(2);
    expect(window.setTouchBar.mock.calls[0]![0]).not.toBeNull();
    expect(window.setTouchBar).toHaveBeenLastCalledWith(null);
    expect(handlers.size).toBe(0);
  }),
);

it.effect("accepts the state and draws nothing on other platforms", () =>
  Effect.gen(function* () {
    const { window } = yield* run("win32");
    expect(window.setTouchBar).not.toHaveBeenCalled();
  }),
);
