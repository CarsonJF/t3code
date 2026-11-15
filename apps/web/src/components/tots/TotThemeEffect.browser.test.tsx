import { TotId, totThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

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

// Echoes what the host sends, and reports what the sandbox refuses it.
const FIXTURE = `
  fx.on("resize", (m) => parent.postMessage({ echo: m }, "*"));
  fx.on("pointer", (m) => parent.postMessage({ echo: m }, "*"));
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

const Area = (props: { threadId: string; script?: string }) => (
  <div data-testid="area" style={{ position: "relative", width: 300, height: 200 }}>
    <p>Message</p>
    <TotThemeEffect threadId={props.threadId} script={props.script} />
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
