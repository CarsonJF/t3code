import type { TotOpenBotMaterial } from "@t3tools/contracts";
import type { AvatarDefinition } from "open-bot-avatar";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { OpenBotFace, useOpenBotKit } from "./OpenBotFace";

/**
 * Painted finishes as images, keyed by everything that changes the pixels. A fluffy or glass
 * still costs a WebGL render, so a grid of them would repaint every tile on each change.
 */
const painted = new Map<string, string>();
const PAINTED_LIMIT = 400;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const remember = (key: string, url: string) => {
  if (painted.size >= PAINTED_LIMIT) painted.delete(painted.keys().next().value as string);
  painted.set(key, url);
  for (const listener of listeners) listener();
};

/** One live render at a time, with idle time between them, so the page answers input while tiles fill in. */
type Release = () => void;
const waiting: Array<(release: Release) => void> = [];
let painting = false;
const nextPaint = () => {
  if (painting) return;
  const start = waiting.shift();
  if (start === undefined) return;
  painting = true;
  let released = false;
  start(() => {
    if (released) return;
    released = true;
    painting = false;
    // Each painted finish blocks the main thread for a moment; input and frames go first.
    if (typeof requestIdleCallback === "function") requestIdleCallback(nextPaint, { timeout: 500 });
    else setTimeout(nextPaint, 0);
  });
};
const queuePaint = (start: (release: Release) => void) => {
  waiting.push(start);
  nextPaint();
  return () => {
    const at = waiting.indexOf(start);
    if (at >= 0) waiting.splice(at, 1);
  };
};

/** About two seconds: a renderer that has not painted by then is not going to. */
const MAX_PAINT_FRAMES = 120;

const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/**
 * A figure that is drawn once and then left alone: flat as an SVG image, a painted finish as a
 * captured image. Nothing is drawn until the tile is on screen, and the flat silhouette shows
 * while a finish waits its turn.
 */
export function StillFigure(props: {
  readonly figure: AvatarDefinition;
  readonly color: string;
  readonly finish: TotOpenBotMaterial;
  readonly size: number;
}) {
  const { figure, color, finish, size } = props;
  const kit = useOpenBotKit(true);
  const box = useRef<HTMLSpanElement | null>(null);
  const live = useRef<HTMLSpanElement | null>(null);
  const [seen, setSeen] = useState(false);
  const [turn, setTurn] = useState<string | null>(null);
  const release = useRef<Release | null>(null);
  const ratio = typeof window === "undefined" ? 1 : window.devicePixelRatio;
  const key = `${figure.id}|${figure.body.path}|${JSON.stringify(figure.eyes)}|${color}|${finish}|${size}|${ratio}`;
  const image = useSyncExternalStore(
    subscribe,
    () => painted.get(key),
    () => undefined,
  );
  const wantsPaint = seen && kit !== null && finish !== "flat" && image === undefined;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- waits for the tile to reach the viewport before drawing anything
  useEffect(() => {
    const element = box.current;
    if (element === null || seen) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [seen]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- takes a turn in the shared paint queue for this finish
  useEffect(() => {
    if (!wantsPaint) return;
    const cancel = queuePaint((done) => {
      release.current = done;
      setTurn(key);
    });
    return () => {
      cancel();
      release.current?.();
      release.current = null;
    };
  }, [wantsPaint, key]);

  const painting = wantsPaint && turn === key;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- copies the renderer's canvas into the image cache once it has painted
  useEffect(() => {
    if (!painting) return;
    const host = live.current;
    let frame = 0;
    let frames = 0;
    const capture = () => {
      const canvas = host?.querySelector("canvas");
      frames += 1;
      if (
        (canvas === null || canvas === undefined || canvas.width === 0) &&
        frames < MAX_PAINT_FRAMES
      ) {
        frame = requestAnimationFrame(capture);
        return;
      }
      try {
        // An empty url keeps the flat silhouette: no canvas came, or it cannot be read.
        remember(key, canvas ? canvas.toDataURL("image/png") : "");
      } catch {
        remember(key, "");
      }
      setTurn(null);
      release.current?.();
    };
    frame = requestAnimationFrame(capture);
    return () => cancelAnimationFrame(frame);
  }, [painting, key]);

  const flat = seen && kit !== null ? svgUrl(kit.renderAvatarSvg(figure, { color, size })) : null;
  const shown = finish === "flat" ? flat : image || flat;
  return (
    <span
      ref={box}
      aria-hidden="true"
      data-open-bot-figure={figure.id}
      data-figure-finish={finish === "flat" || image ? finish : "flat"}
      className="relative inline-block shrink-0"
      style={{ width: size, height: size }}
    >
      {shown === null ? null : (
        <img
          alt=""
          src={shown}
          width={size}
          height={size}
          className="size-full"
          draggable={false}
        />
      )}
      {painting && kit !== null ? (
        <span ref={live} className="absolute inset-0 opacity-0">
          <OpenBotFace
            kit={kit}
            figure={figure}
            look={{ figure: figure.id, material: finish }}
            color={color}
            state="idle"
            moving={false}
            size={size}
          />
        </span>
      ) : null}
    </span>
  );
}
