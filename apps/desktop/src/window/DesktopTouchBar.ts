// @effect-diagnostics globalTimers:off -- The reset countdown and auto-cycle timers drive a native Electron object outside any Effect fiber.
import type { TouchBarState } from "@t3tools/contracts";
import {
  buildTouchBarView,
  nextTouchBarProvider,
  type TouchBarView,
  type TouchBarWindowItem,
} from "@t3tools/shared/touchBar";
import * as Electron from "electron";
import { msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

import { m } from "../i18n/messages.ts";
import { TOUCH_BAR_IMAGE_SCALE, touchBarBarPng } from "./TouchBarBarImage.ts";

export type TouchBarAction = "touchBar.openLimits" | "touchBar.newThread";

const RUNNING_COLOR = "#34c759";
const IDLE_COLOR = "#8e8e93";
// Relative and absolute reset text change at most once a minute.
const TICK_MS = 60_000;

const resolve = ((message: string | null | undefined, options?: Record<string, unknown>) =>
  typeof message !== "string"
    ? message
    : m(
        message,
        Object.fromEntries(
          Object.entries(options ?? {}).flatMap(([key, value]) =>
            key.startsWith("$") ? [] : [[key, String(value)]],
          ),
        ),
      )) as MFunctionType;

/** Holds the renderer's last state and redraws the main window's Touch Bar from it. */
export function createTouchBarController(options: {
  readonly now?: () => number;
  readonly dispatch: (window: Electron.BrowserWindow, action: TouchBarAction) => void;
}) {
  const now = options.now ?? Date.now;
  let window: Electron.BrowserWindow | null = null;
  let state: TouchBarState | null = null;
  let selectedDriver: string | null = null;
  let drawnKey: string | null = null;
  let view: TouchBarView | null = null;
  let tick: ReturnType<typeof setInterval> | null = null;
  let cycle: { readonly seconds: number; readonly timer: ReturnType<typeof setInterval> } | null =
    null;

  const select = (driver: string | null) => {
    if (driver === null) return;
    selectedDriver = driver;
    render();
  };

  const onTap = () => {
    if (!view || !window) return;
    if (view.tapAction === "openLimits") options.dispatch(window, "touchBar.openLimits");
    else if (view.tapAction === "cycle") select(nextTouchBarProvider(view));
  };

  const windowItems = (item: TouchBarWindowItem, compact: boolean) => {
    const { TouchBarButton, TouchBarLabel } = Electron.TouchBar;
    const text = [compact ? item.label : null, item.percentText, item.reset]
      .filter((part) => part !== null)
      .join(" ");
    const accessibilityLabel = [item.label, item.percentText, item.reset]
      .filter((part) => part !== null)
      .join(", ");
    const button = new TouchBarButton({
      label: text,
      accessibilityLabel,
      ...(item.barStyle === "text"
        ? {}
        : {
            icon: Electron.nativeImage.createFromBuffer(touchBarBarPng(item), {
              scaleFactor: TOUCH_BAR_IMAGE_SCALE,
            }),
            iconPosition: "left" as const,
          }),
      ...(view?.tapAction === "none" ? {} : { click: onTap }),
    });
    if (compact) return [button];
    return [
      new TouchBarLabel({
        label: item.label,
        ...(item.barStyle === "text" ? { textColor: item.color } : {}),
      }),
      button,
    ];
  };

  const buildTouchBar = (next: TouchBarView) => {
    const {
      TouchBarButton,
      TouchBarLabel,
      TouchBarScrubber,
      TouchBarSegmentedControl,
      TouchBarSpacer,
    } = Electron.TouchBar;
    const items: Electron.TouchBarConstructorOptions["items"] = [];
    if (next.showProvider && next.current) {
      items.push(new TouchBarLabel({ label: next.current.name }));
      items.push(new TouchBarSpacer({ size: "small" }));
    }
    next.items.forEach((item, index) => {
      if (index > 0 && !next.compact) items.push(new TouchBarSpacer({ size: "small" }));
      items.push(...windowItems(item, next.compact));
    });
    if (next.switcher !== null) {
      items.push(new TouchBarSpacer({ size: "flexible" }));
      const segments = next.providers.map((provider) => ({ label: provider.name }));
      if (next.switcher === "segmented" || next.switcher === "both") {
        items.push(
          new TouchBarSegmentedControl({
            segments,
            mode: "single",
            selectedIndex: next.providers.findIndex(
              (provider) => provider.driver === next.current?.driver,
            ),
            change: (index) => select(next.providers[index]?.driver ?? null),
          }),
        );
      }
      if (next.switcher === "scrubber" || next.switcher === "both") {
        items.push(
          new TouchBarScrubber({
            items: segments,
            selectedStyle: "background",
            mode: "free",
            showArrowButtons: false,
            continuous: false,
            // `select` fires on release; `highlight` would rebuild the bar mid-swipe.
            select: (index) => select(next.providers[index]?.driver ?? null),
          }),
        );
      }
    }
    if (next.threadStatus) {
      items.push(new TouchBarSpacer({ size: "small" }));
      items.push(
        new TouchBarLabel({
          label: `${next.threadStatus.status === "running" ? "●" : "○"} ${next.threadStatus.label}`,
          textColor: next.threadStatus.status === "running" ? RUNNING_COLOR : IDLE_COLOR,
        }),
      );
    }
    if (next.newThreadButton) {
      items.push(new TouchBarSpacer({ size: "small" }));
      items.push(
        new TouchBarButton({
          label: "+",
          accessibilityLabel: m(msg("New thread")),
          click: () => {
            if (window) options.dispatch(window, "touchBar.newThread");
          },
        }),
      );
    }
    return new Electron.TouchBar({ items });
  };

  const syncTimers = () => {
    const live = state !== null && state.settings.enabled;
    if (live && tick === null) tick = setInterval(render, TICK_MS);
    if (!live && tick !== null) {
      clearInterval(tick);
      tick = null;
    }
    const seconds = view?.hidden === null ? (view?.autoCycleSeconds ?? 0) : 0;
    if (cycle?.seconds === seconds) return;
    if (cycle) clearInterval(cycle.timer);
    cycle =
      seconds > 0
        ? {
            seconds,
            timer: setInterval(
              () => select(view ? nextTouchBarProvider(view) : null),
              seconds * 1000,
            ),
          }
        : null;
  };

  function render() {
    if (!state || !window || window.isDestroyed()) return;
    view = buildTouchBarView({ ...state, selectedDriver, now: now() }, resolve);
    // Callbacks close over the view, so an unchanged view keeps its native bar.
    const key = JSON.stringify(view);
    if (key !== drawnKey) {
      drawnKey = key;
      window.setTouchBar(view.hidden === null ? buildTouchBar(view) : null);
    }
    syncTimers();
  }

  return {
    update(target: Electron.BrowserWindow, next: TouchBarState) {
      if (target !== window) {
        window = target;
        drawnKey = null;
      }
      // A new focused thread takes back over from a pick made on the Touch Bar.
      if (state && state.focusedDriver !== next.focusedDriver) selectedDriver = null;
      state = next;
      render();
    },
    /** For tests and diagnostics. */
    get view() {
      return view;
    },
    dispose() {
      if (tick !== null) clearInterval(tick);
      if (cycle) clearInterval(cycle.timer);
      tick = null;
      cycle = null;
      if (window && !window.isDestroyed()) window.setTouchBar(null);
      window = null;
      state = null;
      view = null;
      drawnKey = null;
    },
  };
}
