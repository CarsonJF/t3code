import { ChevronLeftIcon, ChevronRightIcon, Maximize2Icon } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

/** Pointer inactivity that fades the bar; pointer activity over the preview restores it. */
const STEP_BAR_IDLE_MS = 2_500;

export function MediaStepBar(props: {
  /** The preview surface whose pointer activity keeps the bar visible. */
  readonly surfaceRef: RefObject<HTMLDivElement | null>;
  readonly index: number;
  readonly count: number;
  /** Whether the current viewer has a fullscreen path of its own. */
  readonly fullscreen: boolean;
  /** The viewer's fullscreen surface is open; the bar rests while it covers the preview. */
  readonly fullscreenOpen: boolean;
  readonly onStep: (direction: -1 | 1) => void;
  readonly onFullscreen: () => void;
}) {
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const { surfaceRef } = props;

  // Native listeners on the preview surface keep the visibility state inside this bar; React
  // handlers on the panel would re-render the whole panel for every pointer move.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- shows the bar for pointer activity over the preview and fades it while the pointer rests
  useEffect(() => {
    const surface = surfaceRef.current;
    if (surface === null) return;
    const show = (target: EventTarget | null, fadeWhenIdle: boolean) => {
      setIdle(false);
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
      if (fadeWhenIdle) {
        idleTimer.current = window.setTimeout(() => setIdle(true), STEP_BAR_IDLE_MS);
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      // Resting on the bar keeps it pinned, so a faded bar never swallows a click into the image.
      const bar = barRef.current;
      const pinned = bar !== null && event.target instanceof Node && bar.contains(event.target);
      show(event.target, !pinned);
    };
    const onPointerLeave = () => show(null, true);
    show(null, true);
    surface.addEventListener("pointermove", onPointerMove, { passive: true });
    surface.addEventListener("pointerdown", onPointerMove, { passive: true });
    surface.addEventListener("pointerleave", onPointerLeave, { passive: true });
    return () => {
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
      surface.removeEventListener("pointermove", onPointerMove);
      surface.removeEventListener("pointerdown", onPointerMove);
      surface.removeEventListener("pointerleave", onPointerLeave);
    };
  }, [surfaceRef]);

  const hidden = idle || props.fullscreenOpen;
  return (
    <div
      ref={barRef}
      role="group"
      aria-label="Media preview controls"
      data-media-step-bar=""
      className={cn(
        "absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-full surface-glass border border-border/60 p-0.5 shadow-lg",
        "transition-opacity duration-200 motion-reduce:transition-none",
        hidden
          ? "pointer-events-none opacity-0 focus-within:pointer-events-auto focus-within:opacity-100"
          : "opacity-100",
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Previous media"
        onClick={() => props.onStep(-1)}
      >
        <ChevronLeftIcon />
      </Button>
      <span
        aria-live="polite"
        className="min-w-12 px-1 text-center text-xs tabular-nums text-muted-foreground"
      >
        {props.index + 1}/{props.count}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Next media"
        onClick={() => props.onStep(1)}
      >
        <ChevronRightIcon />
      </Button>
      {props.fullscreen ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Fullscreen image"
          onClick={props.onFullscreen}
        >
          <Maximize2Icon />
        </Button>
      ) : null}
    </div>
  );
}
