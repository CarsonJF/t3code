import { describe, expect, it } from "vite-plus/test";

import { parseDryRunCommand } from "./dryRun.ts";

describe("parseDryRunCommand", () => {
  it("reads the commands the real slash command offers", () => {
    expect(parseDryRunCommand("/tot list")).toEqual({ kind: "list" });
    expect(parseDryRunCommand("/tot new")).toEqual({ kind: "new" });
    expect(parseDryRunCommand("/tot stop")).toEqual({ kind: "stop" });
    expect(parseDryRunCommand("/tot use Squirt")).toEqual({ kind: "use", name: "Squirt" });
  });

  it("keeps a name with spaces", () => {
    expect(parseDryRunCommand("/tot use Big Squirt")).toEqual({
      kind: "use",
      name: "Big Squirt",
    });
  });

  it("falls back to help for a bare or unknown command", () => {
    expect(parseDryRunCommand("/tot")).toBe("help");
    expect(parseDryRunCommand("/tot use")).toBe("help");
    expect(parseDryRunCommand("/tot dance")).toBe("help");
  });

  it("treats anything else as a message", () => {
    expect(parseDryRunCommand("hello there")).toBeNull();
    expect(parseDryRunCommand("/help")).toBeNull();
  });
});
