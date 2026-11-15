import { TotId, totThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import type { SessionPhase } from "~/types";

import { render } from "../../../test/render";

const settings = vi.hoisted(() => ({ totThemeEffects: true }));
vi.mock(import("../../hooks/useSettings"), async (original) => {
  const actual = await original();
  type Settings = ReturnType<typeof actual.getClientSettings>;
  function useClientSettings<T = Settings>(select?: (value: Settings) => T): T {
    const value = { ...actual.getClientSettings(), ...settings };
    return select ? select(value) : (value as T);
  }
  return { ...actual, useClientSettings };
});

import { TotThemeEffect } from "./TotThemeEffect";

const THREAD = totThreadId(TotId.make("bob"), "one");
const OTHER_THREAD = totThreadId(TotId.make("bob"), "two");

const CONTEXT_WINDOW = { usedTokens: 25_000, maxTokens: 200_000, usedPercentage: 12.5 };

type ContextWindow = {
  usedTokens: number;
  maxTokens: number | null;
  usedPercentage: number | null;
};

// Echoes what the host sends, and reports what the sandbox refuses it.
const FIXTURE = `
  fx.on("resize", (m) => parent.postMessage({ echo: m }, "*"));
  fx.on("pointer", (m) => parent.postMessage({ echo: m }, "*"));
  fx.on("pointerdown", (m) => parent.postMessage({ echo: m }, "*"));
  fx.on("pointerup", (m) => parent.postMessage({ echo: m }, "*"));
  fx.on("context", (m) => parent.postMessage({ echo: m }, "*"));
  let parentDocument = "readable";
  try { parent.document.title; } catch { parentDocument = "blocked"; }
  parent.postMessage({ parentDocument }, "*");
  fetch("data:,x").then(() => parent.postMessage({ fetch: "allowed" }, "*"),
    () => parent.postMessage({ fetch: "blocked" }, "*"));
  parent.postMessage({ type: "ready" }, "*");
  parent.postMessage({ type: "pointer", x: 1, y: 1, inside: true }, "*");
`;

function setup() {
  settings.totThemeEffects = true;
  const received: unknown[] = [];
  const listen = (event: MessageEvent) => {
    const frame = document.querySelector("iframe");
    if (frame && event.source === frame.contentWindow) received.push(event.data);
  };
  window.addEventListener("message", listen);
  return {
    received,
    echoes: (type: string) =>
      received.flatMap((data) => {
        const echo = (data as { echo?: { type: string } }).echo;
        return echo?.type === type ? [echo] : [];
      }),
    [Symbol.dispose]: () => window.removeEventListener("message", listen),
  };
}

const Area = (props: {
  threadId: string;
  script?: string;
  contextWindow?: ContextWindow | null;
  working?: boolean;
  phase?: SessionPhase;
}) => (
  <div data-testid="area" style={{ position: "relative", width: 300, height: 200 }}>
    <p>Message</p>
    <TotThemeEffect
      threadId={props.threadId}
      script={props.script}
      contextWindow={props.contextWindow ?? null}
      working={props.working ?? false}
      phase={props.phase ?? "ready"}
    />
  </div>
);

describe("TotThemeEffect", () => {
  it("sandboxes the effect without the app's origin or network", async () => {
    using messages = setup();
    await using screen = await render(<Area threadId={THREAD} script={FIXTURE} />);
    const frame = screen.container.querySelector("iframe")!;
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("aria-hidden")).toBe("true");
    expect(frame.tabIndex).toBe(-1);
    await vi.waitFor(() => {
      expect(messages.received).toContainEqual({ parentDocument: "blocked" });
      expect(messages.received).toContainEqual({ fetch: "blocked" });
    });
  });

  it("lets pointer input reach the conversation underneath", async () => {
    await using screen = await render(<Area threadId={THREAD} script={FIXTURE} />);
    const frame = screen.container.querySelector("iframe")!;
    expect(getComputedStyle(frame).pointerEvents).toBe("none");
    const text = screen.container.querySelector("p")!.getBoundingClientRect();
    expect(document.elementFromPoint(text.left + 2, text.top + 2)?.tagName).toBe("P");
  });

  it("coalesces pointer moves into one message per frame in iframe-local px", async () => {
    using messages = setup();
    await using screen = await render(<Area threadId={THREAD} script={FIXTURE} />);
    await vi.waitFor(() => expect(messages.echoes("resize")).toHaveLength(1));
    expect(messages.echoes("resize")[0]).toMatchObject({ width: 300, height: 200 });

    const area = screen.container.querySelector<HTMLElement>("[data-testid=area]")!;
    const rect = area.getBoundingClientRect();
    for (const dx of [10, 20, 30]) {
      area.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: rect.left + dx,
          clientY: rect.top + 5,
        }),
      );
    }
    await vi.waitFor(() => expect(messages.echoes("pointer")).toHaveLength(1));
    // The iframe's own spoofed pointer and ready messages changed nothing.
    expect(messages.echoes("pointer")[0]).toEqual({ type: "pointer", x: 30, y: 5, inside: true });
  });

  it("posts a pointerdown in area-local px with its button", async () => {
    using messages = setup();
    await using screen = await render(<Area threadId={THREAD} script={FIXTURE} />);
    await vi.waitFor(() => expect(messages.echoes("resize")).toHaveLength(1));

    const area = screen.container.querySelector<HTMLElement>("[data-testid=area]")!;
    const rect = area.getBoundingClientRect();
    area.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        clientX: rect.left + 40,
        clientY: rect.top + 12,
        button: 2,
      }),
    );
    await vi.waitFor(() => expect(messages.echoes("pointerdown")).toHaveLength(1));
    expect(messages.echoes("pointerdown")[0]).toEqual({
      type: "pointerdown",
      x: 40,
      y: 12,
      button: 2,
      inside: true,
    });
  });

  it("posts a pointerup in the frame it shares with its pointerdown", async () => {
    using messages = setup();
    await using screen = await render(<Area threadId={THREAD} script={FIXTURE} />);
    await vi.waitFor(() => expect(messages.echoes("resize")).toHaveLength(1));

    const area = screen.container.querySelector<HTMLElement>("[data-testid=area]")!;
    const rect = area.getBoundingClientRect();
    area.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        clientX: rect.left + 7,
        clientY: rect.top + 8,
      }),
    );
    area.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        clientX: rect.left + 9,
        clientY: rect.top + 10,
      }),
    );
    await vi.waitFor(() => expect(messages.echoes("pointerup")).toHaveLength(1));
    expect(messages.echoes("pointerdown")[0]).toEqual({
      type: "pointerdown",
      x: 7,
      y: 8,
      button: 0,
      inside: true,
    });
    expect(messages.echoes("pointerup")[0]).toEqual({
      type: "pointerup",
      x: 9,
      y: 10,
      button: 0,
      inside: true,
    });
  });

  it("ignores presses outside the area", async () => {
    using messages = setup();
    await using screen = await render(<Area threadId={THREAD} script={FIXTURE} />);
    await vi.waitFor(() => expect(messages.echoes("resize")).toHaveLength(1));

    const area = screen.container.querySelector<HTMLElement>("[data-testid=area]")!;
    const rect = area.getBoundingClientRect();
    for (const type of ["pointerdown", "pointerup"] as const) {
      screen.container.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          clientX: rect.left + 5,
          clientY: rect.top + 5,
        }),
      );
    }
    // A move flushes this frame, so a press queued from the outside would surface with it.
    area.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: rect.left + 5,
        clientY: rect.top + 5,
      }),
    );
    await vi.waitFor(() => expect(messages.echoes("pointer")).toHaveLength(1));
    expect(messages.echoes("pointerdown")).toHaveLength(0);
    expect(messages.echoes("pointerup")).toHaveLength(0);
  });

  it("posts the session context once the effect loads", async () => {
    using messages = setup();
    await using _screen = await render(
      <Area
        threadId={THREAD}
        script={FIXTURE}
        contextWindow={CONTEXT_WINDOW}
        working={true}
        phase="running"
      />,
    );
    await vi.waitFor(() => expect(messages.echoes("context")).toHaveLength(1));
    expect(messages.echoes("context")[0]).toEqual({
      type: "context",
      usedTokens: 25_000,
      maxTokens: 200_000,
      usedPercentage: 12.5,
      working: true,
      phase: "running",
    });
  });

  it("posts context again only when one of its values changes", async () => {
    using messages = setup();
    await using screen = await render(
      <Area threadId={THREAD} script={FIXTURE} contextWindow={CONTEXT_WINDOW} />,
    );
    await vi.waitFor(() => expect(messages.echoes("context")).toHaveLength(1));

    await screen.rerender(
      <Area
        threadId={THREAD}
        script={FIXTURE}
        contextWindow={{ usedTokens: 150_000, maxTokens: 200_000, usedPercentage: 75 }}
        working={true}
        phase="running"
      />,
    );
    await vi.waitFor(() => expect(messages.echoes("context")).toHaveLength(2));
    expect(messages.echoes("context")[1]).toMatchObject({
      usedTokens: 150_000,
      maxTokens: 200_000,
      usedPercentage: 75,
      working: true,
      phase: "running",
    });
  });

  it("posts no context message when the values do not change", async () => {
    using messages = setup();
    await using screen = await render(
      <Area threadId={THREAD} script={FIXTURE} contextWindow={CONTEXT_WINDOW} />,
    );
    await vi.waitFor(() => expect(messages.echoes("context")).toHaveLength(1));

    await screen.rerender(
      <Area
        threadId={THREAD}
        script={FIXTURE}
        contextWindow={{ ...CONTEXT_WINDOW }}
        working={false}
        phase="ready"
      />,
    );
    // A pointer message flushes the same frame queue, so a stale context message would show up.
    const area = screen.container.querySelector<HTMLElement>("[data-testid=area]")!;
    const rect = area.getBoundingClientRect();
    area.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: rect.left + 5,
        clientY: rect.top + 5,
      }),
    );
    await vi.waitFor(() => expect(messages.echoes("pointer")).toHaveLength(1));
    expect(messages.echoes("context")).toHaveLength(1);
  });

  it("sends numbers and the phase name, never conversation content", async () => {
    using messages = setup();
    await using _screen = await render(
      <Area threadId={THREAD} script={FIXTURE} contextWindow={CONTEXT_WINDOW} />,
    );
    await vi.waitFor(() => expect(messages.echoes("context")).toHaveLength(1));
    const message = messages.echoes("context")[0] as Record<string, unknown>;
    expect(Object.keys(message).sort()).toEqual([
      "maxTokens",
      "phase",
      "type",
      "usedPercentage",
      "usedTokens",
      "working",
    ]);
    expect(
      [message.usedTokens, message.maxTokens, message.usedPercentage].every(
        (value) => typeof value === "number" || value === null,
      ),
    ).toBe(true);
    expect(typeof message.working).toBe("boolean");
    expect(typeof message.phase).toBe("string");
    expect(JSON.stringify(message)).not.toContain("Message");
  });

  it("stops listening once the effect unmounts", async () => {
    using messages = setup();
    await using screen = await render(<Area threadId={THREAD} script={FIXTURE} />);
    await vi.waitFor(() => expect(messages.echoes("resize")).toHaveLength(1));
    await screen.rerender(<Area threadId={THREAD} />);
    expect(screen.container.querySelector("iframe")).toBeNull();

    using frame = vi.spyOn(window, "requestAnimationFrame");
    screen.container
      .querySelector("[data-testid=area]")!
      .dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
    expect(frame).not.toHaveBeenCalled();
  });

  it("replaces the document on thread change and unmounts outside Tot threads", async () => {
    await using screen = await render(<Area threadId={THREAD} script={FIXTURE} />);
    const first = screen.container.querySelector("iframe");
    await screen.rerender(<Area threadId={OTHER_THREAD} script={FIXTURE} />);
    const second = screen.container.querySelector("iframe");
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    await screen.rerender(<Area threadId="thread-1" script={FIXTURE} />);
    expect(screen.container.querySelector("iframe")).toBeNull();
  });

  it("renders nothing when theme effects are turned off", async () => {
    using _messages = setup();
    settings.totThemeEffects = false;
    await using screen = await render(<Area threadId={THREAD} script={FIXTURE} />);
    expect(screen.container.querySelector("iframe")).toBeNull();
  });
});
