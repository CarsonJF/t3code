import { parseTotThreadId } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { observeResize } from "~/lib/observeResize";
import type { SessionPhase } from "~/types";

import { buildEffectDocument } from "./totThemeEffect.logic";

export type EffectContext = {
  usedTokens: number | null;
  maxTokens: number | null;
  usedPercentage: number | null;
  working: boolean;
  phase: SessionPhase;
};

type EffectMessage =
  | { type: "pointer"; x: number; y: number; inside: boolean }
  | { type: "pointerdown"; x: number; y: number; button: number; inside: boolean }
  | { type: "pointerup"; x: number; y: number; button: number; inside: boolean }
  | { type: "resize"; width: number; height: number; dpr: number }
  | { type: "motion"; reduced: boolean }
  | { type: "visibility"; hidden: boolean }
  | ({ type: "context" } & EffectContext);

const FRAME_STYLE = {
  position: "absolute",
  inset: 0,
  zIndex: 10,
  width: "100%",
  height: "100%",
  border: 0,
  background: "transparent",
  pointerEvents: "none",
  // A color-scheme mismatch with the page would paint the frame opaque.
  colorScheme: "normal",
} as const;

/** A Tot's theme effect, drawn over the conversation area. See TotThemeEffect.md. */
export function TotThemeEffect(props: {
  threadId: string;
  script: string | undefined;
  contextWindow: {
    usedTokens: number;
    maxTokens?: number | null;
    usedPercentage: number | null;
  } | null;
  working: boolean;
  phase: SessionPhase;
}) {
  if (parseTotThreadId(props.threadId) === null) return null;
  return (
    <ThemeEffect
      frameKey={props.threadId}
      script={props.script}
      context={{
        usedTokens: props.contextWindow?.usedTokens ?? null,
        maxTokens: props.contextWindow?.maxTokens ?? null,
        usedPercentage: props.contextWindow?.usedPercentage ?? null,
        working: props.working,
        phase: props.phase,
      }}
    />
  );
}

/**
 * A theme effect in its sandboxed frame, off when theme effects are off. Keyed by
 * `frameKey` so navigating to another conversation always tears the old document down.
 */
export function ThemeEffect(props: {
  frameKey: string;
  script: string | undefined;
  context: EffectContext;
}) {
  const enabled = useClientSettings((settings) => settings.totThemeEffects);
  if (!enabled || !props.script) return null;
  return <EffectFrame key={props.frameKey} script={props.script} context={props.context} />;
}

function EffectFrame({ script, context }: { script: string; context: EffectContext }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  // Bumped by each load (including a new srcdoc) so the initial state is posted again.
  const [loads, setLoads] = useState(0);
  // Replaced by the effect below, so a context change reaches the frame without restarting it.
  const sendContext = useRef<(next: EffectContext) => void>(() => {});

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- forwards DOM input to the sandboxed iframe
  useEffect(() => {
    const frame = frameRef.current;
    const area = frame?.parentElement;
    const target = frame?.contentWindow;
    if (loads === 0 || !frame || !area || !target) return;
    const pending = new Map<EffectMessage["type"], EffectMessage>();
    let pointer: { clientX: number; clientY: number } | null = null;
    let raf = 0;
    const flush = () => {
      raf = 0;
      if (pointer) {
        const rect = area.getBoundingClientRect();
        const { clientX, clientY } = pointer;
        pending.set("pointer", {
          type: "pointer",
          x: clientX - rect.left,
          y: clientY - rect.top,
          inside: true,
        });
        pointer = null;
      }
      for (const message of pending.values()) target.postMessage(message, "*");
      pending.clear();
    };
    const queue = (message: EffectMessage | null) => {
      if (message) pending.set(message.type, message);
      if (raf === 0) raf = requestAnimationFrame(flush);
    };
    const resize = () =>
      queue({
        type: "resize",
        width: area.clientWidth,
        height: area.clientHeight,
        dpr: window.devicePixelRatio || 1,
      });
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const motion = () => queue({ type: "motion", reduced: motionQuery.matches });
    const visibility = () => queue({ type: "visibility", hidden: document.hidden });
    const move = (event: PointerEvent) => {
      if (document.hidden) return;
      pointer = { clientX: event.clientX, clientY: event.clientY };
      queue(null);
    };
    const leave = () => {
      pointer = null;
      queue({ type: "pointer", x: 0, y: 0, inside: false });
    };
    // Geometry too, since a captured pointer can release outside the area.
    const press = (event: PointerEvent) => {
      const rect = area.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;
      return { x, y, button: event.button, inside: true };
    };
    const down = (event: PointerEvent) => {
      const point = press(event);
      if (point) queue({ type: "pointerdown", ...point });
    };
    const up = (event: PointerEvent) => {
      const point = press(event);
      if (point) queue({ type: "pointerup", ...point });
    };
    let sentContext = "";
    sendContext.current = (next) => {
      const message: EffectMessage = {
        type: "context",
        usedTokens: next.usedTokens,
        maxTokens: next.maxTokens,
        usedPercentage: next.usedPercentage,
        working: next.working,
        phase: next.phase,
      };
      const serialized = JSON.stringify(message);
      if (serialized === sentContext) return;
      sentContext = serialized;
      queue(message);
    };

    // observeResize reports the initial size.
    motion();
    visibility();
    const stopResize = observeResize(area, resize);
    motionQuery.addEventListener("change", motion);
    document.addEventListener("visibilitychange", visibility);
    area.addEventListener("pointermove", move, { passive: true });
    area.addEventListener("pointerleave", leave, { passive: true });
    area.addEventListener("pointerdown", down, { passive: true });
    area.addEventListener("pointerup", up, { passive: true });
    return () => {
      sendContext.current = () => {};
      cancelAnimationFrame(raf);
      stopResize();
      motionQuery.removeEventListener("change", motion);
      document.removeEventListener("visibilitychange", visibility);
      area.removeEventListener("pointermove", move);
      area.removeEventListener("pointerleave", leave);
      area.removeEventListener("pointerdown", down);
      area.removeEventListener("pointerup", up);
    };
  }, [loads]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- forwards the session's context to the sandboxed iframe
  useEffect(() => {
    if (loads > 0) sendContext.current(context);
  }, [context, loads]);

  return (
    <iframe
      ref={frameRef}
      title="Theme effect"
      aria-hidden
      tabIndex={-1}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={buildEffectDocument(script)}
      onLoad={() => setLoads((count) => count + 1)}
      style={FRAME_STYLE}
    />
  );
}
