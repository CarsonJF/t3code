import { describe, expect, it } from "vite-plus/test";

import { createLogger, createFileLogger, redact } from "./log.ts";

const collect = () => {
  const lines: Array<string> = [];
  return {
    lines,
    logger: createLogger({
      write: (line) => lines.push(line),
      now: () => 1_767_225_600_000,
      secrets: ["mcp-secret-token-value"],
    }),
  };
};

describe("createLogger", () => {
  it("writes one JSON line per event", () => {
    const { lines, logger } = collect();
    logger.info("turn.started", { totId: "squirt", characters: 12 });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toEqual({
      at: "2026-01-01T00:00:00.000Z",
      level: "info",
      event: "turn.started",
      totId: "squirt",
      characters: 12,
    });
  });

  it("keeps a configured secret out of the file", () => {
    const { lines, logger } = collect();
    logger.error("bridge.failed", { reason: "rejected mcp-secret-token-value" });

    expect(lines[0]).not.toContain("mcp-secret-token-value");
    expect(lines[0]).toContain("[redacted]");
  });

  it("redacts a bearer credential", () => {
    expect(redact("Authorization: Bearer abc.def-123", [])).toBe(
      "Authorization: Bearer [redacted]",
    );
  });

  it("leaves ordinary text alone", () => {
    expect(redact("Home is working…", ["mcp-secret-token-value"])).toBe("Home is working…");
  });
});

describe("createFileLogger", () => {
  it("appends through the injected writer", () => {
    const written: Array<{ path: string; line: string }> = [];
    const logger = createFileLogger("bridge.log", [], {
      append: (path, line) => written.push({ path, line }),
    });
    logger.warn("discord.disconnected", { code: 1006 });

    expect(written).toHaveLength(1);
    expect(written[0]?.path).toBe("bridge.log");
    expect(written[0]?.line).toContain("discord.disconnected");
  });

  it("stops writing after the first failure instead of throwing", () => {
    let calls = 0;
    const logger = createFileLogger("bridge.log", [], {
      append: () => {
        calls += 1;
        throw new Error("read-only file system");
      },
    });

    expect(() => logger.info("one")).not.toThrow();
    expect(() => logger.info("two")).not.toThrow();
    expect(calls).toBe(1);
  });
});
