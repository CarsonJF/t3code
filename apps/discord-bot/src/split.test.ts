import { describe, expect, it } from "vite-plus/test";

import { BRIDGE_MESSAGE_LIMIT, splitMessage, truncateForEdit } from "./split.ts";

const fenceLines = (chunk: string): number => chunk.split("```").length - 1;

describe("splitMessage", () => {
  it("leaves a short message alone", () => {
    expect(splitMessage("Just one line.")).toEqual(["Just one line."]);
  });

  it("drops empty output", () => {
    expect(splitMessage("   \n\n ")).toEqual([]);
  });

  it("splits long prose under the limit without losing a line", () => {
    const lines = Array.from({ length: 120 }, (_, index) => `Line ${index} of the answer.`);
    const chunks = splitMessage(lines.join("\n"));

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(BRIDGE_MESSAGE_LIMIT);
    expect(chunks.join("\n")).toBe(lines.join("\n"));
  });

  it("keeps a fenced block in one message", () => {
    const prose = Array.from({ length: 40 }, (_, index) => `Sentence ${index} before the code.`);
    const code = ["```ts", "const value = 1;", "export default value;", "```"];
    const chunks = splitMessage([...prose, ...code, "And after."].join("\n"));
    const fenced = chunks.filter((chunk) => chunk.includes("const value = 1;"));

    expect(fenced).toHaveLength(1);
    const block = fenced[0] ?? "";
    expect(block.startsWith("```ts")).toBe(true);
    expect(block.endsWith("```")).toBe(true);
    expect(block).toContain("export default value;");
  });

  it("closes and reopens a fence too tall for one message", () => {
    const code = Array.from({ length: 220 }, (_, index) => `const line${index} = ${index};`);
    const text = ["```js", ...code, "```"].join("\n");
    const chunks = splitMessage(text);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(BRIDGE_MESSAGE_LIMIT);
      expect(fenceLines(chunk) % 2).toBe(0);
      expect(chunk.startsWith("```js")).toBe(true);
      expect(chunk.endsWith("```")).toBe(true);
    }
    const recovered = chunks
      .flatMap((chunk) => chunk.split("\n"))
      .filter((line) => !line.startsWith("```"));
    expect(recovered).toEqual(code);
  });

  it("hard splits a single line longer than a message", () => {
    const chunks = splitMessage("x".repeat(BRIDGE_MESSAGE_LIMIT * 2 + 10));

    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(BRIDGE_MESSAGE_LIMIT);
    expect(chunks.join("")).toBe("x".repeat(BRIDGE_MESSAGE_LIMIT * 2 + 10));
  });

  it("does not split a surrogate pair", () => {
    const chunks = splitMessage("🙂".repeat(1_500));

    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(BRIDGE_MESSAGE_LIMIT);
    expect(chunks.join("")).toBe("🙂".repeat(1_500));
  });
});

describe("truncateForEdit", () => {
  it("keeps text that fits", () => {
    expect(truncateForEdit("short")).toBe("short");
  });

  it("shows the newest text when the answer outgrows a message", () => {
    const text = `${"a".repeat(100)}${"b".repeat(BRIDGE_MESSAGE_LIMIT)}`;
    const visible = truncateForEdit(text);

    expect(visible.length).toBeLessThanOrEqual(BRIDGE_MESSAGE_LIMIT);
    expect(visible.startsWith("…")).toBe(true);
    expect(visible.endsWith("b")).toBe(true);
  });
});
