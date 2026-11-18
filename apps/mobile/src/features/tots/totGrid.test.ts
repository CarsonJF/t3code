import { describe, expect, it } from "vite-plus/test";

import { TOT_GRID_GAP, totCardWidth, totGridColumns, totGridRows } from "./totGrid";

describe("totGridColumns", () => {
  it("keeps two faces across a phone", () => {
    // A 344dp Fold outer window, less the page's padding.
    expect(totGridColumns(304)).toBe(2);
  });

  it("spends the unfolded Fold's width on a third face", () => {
    // A 673dp Fold inner window, less the page's padding.
    expect(totGridColumns(558)).toBe(3);
  });

  it("gives a tablet four", () => {
    expect(totGridColumns(680)).toBe(4);
    expect(totGridColumns(1200)).toBe(4);
  });

  it("never drops below two, even before the grid has measured itself", () => {
    expect(totGridColumns(0)).toBe(2);
    expect(totGridColumns(120)).toBe(2);
  });
});

describe("totCardWidth", () => {
  it.each([
    [304, 2],
    [558, 3],
    [680, 4],
  ])("fills a %idp row of %i cards without spilling", (available, columns) => {
    const width = totCardWidth(available, columns);
    const used = width * columns + TOT_GRID_GAP * (columns - 1);
    expect(used).toBeLessThanOrEqual(available);
    expect(used).toBeGreaterThan(available - columns);
  });

  it("hands a single column the whole row", () => {
    expect(totCardWidth(304, 1)).toBe(304);
  });
});

describe("totGridRows", () => {
  it("draws the last row short instead of stretching it", () => {
    expect(totGridRows(["a", "b", "c", "d", "e"], 4)).toEqual([["a", "b", "c", "d"], ["e"]]);
    expect(totGridRows(["a", "b", "c"], 2)).toEqual([["a", "b"], ["c"]]);
  });

  it("keeps every card in a full row", () => {
    expect(totGridRows([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});
