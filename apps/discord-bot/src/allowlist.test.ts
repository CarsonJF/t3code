import { describe, expect, it } from "vite-plus/test";

import { isAllowedDmAuthor } from "./allowlist.ts";

const allowed = new Set(["111111111111111111"]);

describe("isAllowedDmAuthor", () => {
  it("admits an allowlisted person", () => {
    expect(isAllowedDmAuthor({ userId: "111111111111111111", bot: false }, allowed)).toBe(true);
  });

  it("ignores anyone else", () => {
    expect(isAllowedDmAuthor({ userId: "222222222222222222", bot: false }, allowed)).toBe(false);
  });

  it("ignores bots, even with an allowlisted id", () => {
    expect(isAllowedDmAuthor({ userId: "111111111111111111", bot: true }, allowed)).toBe(false);
  });

  it("treats a missing or blank id as not allowed", () => {
    expect(isAllowedDmAuthor({ userId: null, bot: false }, allowed)).toBe(false);
    expect(isAllowedDmAuthor({ userId: undefined, bot: false }, allowed)).toBe(false);
    expect(isAllowedDmAuthor({ userId: "   ", bot: false }, allowed)).toBe(false);
  });

  it("admits nobody when the allowlist is empty", () => {
    expect(isAllowedDmAuthor({ userId: "111111111111111111", bot: false }, new Set())).toBe(false);
  });
});
