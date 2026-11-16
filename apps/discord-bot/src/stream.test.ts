import { describe, expect, it } from "vite-plus/test";

import { StreamEditor } from "./stream.ts";

const editorAt = (clock: { now: number }): StreamEditor =>
  new StreamEditor({ now: () => clock.now, minIntervalMs: 700 });

describe("StreamEditor", () => {
  it("publishes the first text at once", () => {
    const clock = { now: 1_000 };
    const editor = editorAt(clock);

    expect(editor.next("Hello")).toBe("Hello");
  });

  it("does not repeat the same text", () => {
    const clock = { now: 1_000 };
    const editor = editorAt(clock);
    editor.next("Hello");
    clock.now += 5_000;

    expect(editor.next("Hello")).toBeNull();
  });

  it("coalesces updates inside the interval into one edit", () => {
    const clock = { now: 1_000 };
    const editor = editorAt(clock);
    editor.next("Hello");
    clock.now += 100;

    expect(editor.next("Hello there")).toBeNull();
    clock.now += 100;
    expect(editor.next("Hello there, friend")).toBeNull();
    clock.now += 600;
    expect(editor.next("Hello there, friend")).toBe("Hello there, friend");
  });

  it("skips empty text so the working placeholder stays", () => {
    const clock = { now: 1_000 };
    const editor = editorAt(clock);

    expect(editor.next("   ")).toBeNull();
  });

  it("seeds text already on screen", () => {
    const clock = { now: 1_000 };
    const editor = editorAt(clock);
    editor.seed("Home is working…");

    expect(editor.next("Home is working…")).toBeNull();
    clock.now += 1_000;
    expect(editor.next("Hello")).toBe("Hello");
  });

  it("settles regardless of the interval", () => {
    const clock = { now: 1_000 };
    const editor = editorAt(clock);
    editor.next("Hello");
    clock.now += 10;

    expect(editor.settle("Hello world")).toBe("Hello world");
    expect(editor.next("Hello world")).toBeNull();
  });
});
