import { describe, expect, it } from "vite-plus/test";

import { totMemoryTidyMaxBytesFromKb } from "./totMemoryTidySettings.logic";

describe("totMemoryTidyMaxBytesFromKb", () => {
  it("turns whole kilobytes from 1 to 256 into bytes", () => {
    expect(totMemoryTidyMaxBytesFromKb("6")).toBe(6144);
    expect(totMemoryTidyMaxBytesFromKb(" 1 ")).toBe(1024);
    expect(totMemoryTidyMaxBytesFromKb("256")).toBe(262_144);
  });

  it("refuses anything else", () => {
    for (const text of ["", "0", "257", "1.5", "-3", "abc"]) {
      expect(totMemoryTidyMaxBytesFromKb(text)).toBeNull();
    }
  });
});
