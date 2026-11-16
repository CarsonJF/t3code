import { describe, expect, it } from "vite-plus/test";

import { isAllowedAuthor } from "./allowlist.ts";

const allowed = new Set(["111111111111111111"]);

describe("isAllowedAuthor", () => {
  it("admits an allowlisted person", () => {
    expect(isAllowedAuthor({ userId: "111111111111111111", bot: false }, allowed)).toBe(true);
  });

  it("ignores anyone else", () => {
    expect(isAllowedAuthor({ userId: "222222222222222222", bot: false }, allowed)).toBe(false);
  });

  it("ignores bots, even with an allowlisted id", () => {
    expect(isAllowedAuthor({ userId: "111111111111111111", bot: true }, allowed)).toBe(false);
  });

  it("treats a missing or blank id as not allowed", () => {
    expect(isAllowedAuthor({ userId: null, bot: false }, allowed)).toBe(false);
    expect(isAllowedAuthor({ userId: undefined, bot: false }, allowed)).toBe(false);
    expect(isAllowedAuthor({ userId: "   ", bot: false }, allowed)).toBe(false);
  });

  it("admits nobody when the allowlist is empty", () => {
    expect(isAllowedAuthor({ userId: "111111111111111111", bot: false }, new Set())).toBe(false);
  });
});
