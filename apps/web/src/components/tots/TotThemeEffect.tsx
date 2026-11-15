import { parseTotThreadId } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { observeResize } from "~/lib/observeResize";

import { buildEffectDocument } from "./totThemeEffect.logic";

type EffectMessage =
  | { type: "pointer"; x: number; y: number; inside: boolean }
  | { type: "resize"; width: number; height: number; dpr: number }
  | { type: "motion"; reduced: boolean }
  | { type: "visibility"; hidden: boolean };

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
export function TotThemeEffect(props: { threadId: string; script: string | undefined }) {
  const enabled = useClientSettings((settings) => settings.totThemeEffects);
  if (!enabled || !props.script || parseTotThreadId(props.threadId) === null) return null;
  // Keyed by thread so navigating away always tears the old document down.
  return <EffectFrame key={props.threadId} script={props.script} />;
}

function EffectFrame({ script }: { script: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  // Bumped by each load (including a new srcdoc) so the initial state is posted again.
  const [loads, setLoads] = useState(0);

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

    // observeResize reports the initial size.
    motion();
    visibility();
    const stopResize = observeResize(area, resize);
    motionQuery.addEventListener("change", motion);
    document.addEventListener("visibilitychange", visibility);
    area.addEventListener("pointermove", move, { passive: true });
    area.addEventListener("pointerleave", leave, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      stopResize();
      motionQuery.removeEventListener("change", motion);
      document.removeEventListener("visibilitychange", visibility);
      area.removeEventListener("pointermove", move);
      area.removeEventListener("pointerleave", leave);
    };
  }, [loads]);

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
