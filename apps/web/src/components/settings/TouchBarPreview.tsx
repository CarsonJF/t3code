import type { TouchBarView, TouchBarWindowItem } from "@t3tools/shared/touchBar";
import { useGT } from "gt-react";

import { cn } from "../../lib/utils";

// The Touch Bar is a fixed dark OLED strip in every system theme, so the preview keeps its colors.
const STRIP = "#000000";
const KEY = "#3a3a3c";
const KEY_SELECTED = "#636366";
const TRACK = "rgba(255, 255, 255, 0.22)";
const LABEL = "#ebebf5";
const MUTED = "rgba(235, 235, 245, 0.6)";

function PreviewBar({ item }: { readonly item: TouchBarWindowItem }) {
  if (item.barStyle === "text") return null;
  if (item.barStyle === "segmented") {
    return (
      <span aria-hidden className="flex h-2 shrink-0 gap-0.5" style={{ width: item.barWidth }}>
        {Array.from({ length: item.segments.total }, (_, index) => (
          <span
            key={index}
            className="h-full flex-1"
            style={{ backgroundColor: index < item.segments.filled ? item.color : TRACK }}
          />
        ))}
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="relative h-2 shrink-0 overflow-hidden rounded-full"
      style={{ width: item.barWidth, backgroundColor: TRACK }}
    >
      <span
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ width: `${item.fill * 100}%`, backgroundColor: item.color }}
      />
    </span>
  );
}

function PreviewWindow({
  item,
  compact,
  onTap,
}: {
  readonly item: TouchBarWindowItem;
  readonly compact: boolean;
  readonly onTap: (() => void) | null;
}) {
  const text = [compact ? item.label : null, item.percentText, item.reset]
    .filter((part) => part !== null)
    .join(" ");
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {compact ? null : (
        <span style={{ color: item.barStyle === "text" ? item.color : LABEL }}>{item.label}</span>
      )}
      <button
        type="button"
        disabled={onTap === null}
        onClick={onTap ?? undefined}
        className="flex h-6 items-center gap-1.5 rounded-md px-2 tabular-nums disabled:cursor-default"
        style={{ backgroundColor: KEY, color: LABEL }}
      >
        <PreviewBar item={item} />
        <span>{text}</span>
      </button>
    </span>
  );
}

/** A picture of the Touch Bar's app area, drawn from the view the desktop app draws. */
export function TouchBarPreview({
  view,
  onSelectProvider,
  onTapWindow,
}: {
  readonly view: TouchBarView;
  readonly onSelectProvider: (driver: string) => void;
  readonly onTapWindow: () => void;
}) {
  const gt = useGT();
  const hiddenText =
    view.hidden === "disabled"
      ? gt("The Touch Bar strip is off.")
      : view.hidden === "noData"
        ? gt("No provider reports usage limits yet.")
        : view.hidden === "running"
          ? gt("Hidden while the thread is running.")
          : view.hidden === "belowThreshold"
            ? gt("Hidden until a limit passes the threshold.")
            : null;
  return (
    <div
      role="img"
      aria-label={gt("Touch Bar preview")}
      className="flex h-11 w-full items-center gap-2 overflow-x-auto rounded-lg px-3 text-sm leading-none whitespace-nowrap"
      style={{ backgroundColor: STRIP, color: LABEL }}
    >
      {hiddenText !== null ? (
        <span className="mx-auto" style={{ color: MUTED }}>
          {hiddenText}
        </span>
      ) : (
        <>
          {view.showProvider && view.current ? (
            <span className="shrink-0 font-semibold">{view.current.name}</span>
          ) : null}
          {view.items.map((item) => (
            <PreviewWindow
              key={item.id}
              item={item}
              compact={view.compact}
              onTap={view.tapAction === "none" ? null : onTapWindow}
            />
          ))}
          {view.switcher !== null ? <span className="min-w-2 flex-1" /> : null}
          {view.switcher === "segmented" || view.switcher === "both" ? (
            <span className="flex shrink-0 overflow-hidden rounded-md">
              {view.providers.map((provider) => (
                <button
                  key={provider.driver}
                  type="button"
                  aria-pressed={provider.driver === view.current?.driver}
                  onClick={() => onSelectProvider(provider.driver)}
                  className="h-6 px-2"
                  style={{
                    backgroundColor: provider.driver === view.current?.driver ? KEY_SELECTED : KEY,
                  }}
                >
                  {provider.name}
                </button>
              ))}
            </span>
          ) : null}
          {view.switcher === "scrubber" || view.switcher === "both" ? (
            <span className="flex shrink-0 gap-3 px-1" style={{ color: MUTED }}>
              {view.providers.map((provider) => (
                <button
                  key={provider.driver}
                  type="button"
                  onClick={() => onSelectProvider(provider.driver)}
                  className={cn(
                    "h-6",
                    provider.driver === view.current?.driver && "underline underline-offset-4",
                  )}
                  style={provider.driver === view.current?.driver ? { color: LABEL } : undefined}
                >
                  {provider.name}
                </button>
              ))}
            </span>
          ) : null}
          {view.threadStatus ? (
            <span
              className="shrink-0"
              style={{ color: view.threadStatus.status === "running" ? "#34c759" : "#8e8e93" }}
            >
              {view.threadStatus.status === "running" ? "●" : "○"} {view.threadStatus.label}
            </span>
          ) : null}
          {view.newThreadButton ? (
            <span
              aria-hidden
              className="flex h-6 shrink-0 items-center rounded-md px-2.5"
              style={{ backgroundColor: KEY }}
            >
              +
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}
