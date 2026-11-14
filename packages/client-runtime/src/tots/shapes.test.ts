import { TOT_SHAPES } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { totHeadPoints, totStillHeadPath, type HeadPoint } from "./shapes.ts";

// BoopFace draws the head path at translate(7.2 7.2) scale(.94) in a 240 box.
const onScreen = (point: HeadPoint): HeadPoint => ({
  x: point.x * 0.94 + 7.2,
  y: point.y * 0.94 + 7.2,
});

const inside = (polygon: ReadonlyArray<HeadPoint>, point: HeadPoint) => {
  let crossings = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.y > point.y !== b.y > point.y) {
      const x = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
      if (point.x < x) crossings += 1;
    }
  }
  return crossings % 2 === 1;
};

// Each eye with room to glance sideways, as the working state does.
const eyeEdges = [86, 154].flatMap((cx) =>
  Array.from({ length: 48 }, (_, i) => {
    const angle = (i / 48) * 2 * Math.PI;
    return { x: cx + 33 * Math.cos(angle), y: 126 + 33 * Math.sin(angle) };
  }),
);

describe("totHeadPoints", () => {
  it("leaves the round head to BoopFace", () => {
    expect(totHeadPoints("round")).toBeNull();
    expect(totHeadPoints(undefined)).toBeNull();
  });

  describe.each(TOT_SHAPES.filter((candidate) => candidate !== "round"))("%s", (shape) => {
    const points = totHeadPoints(shape) ?? [];
    const screen = points.map(onScreen);

    it("starts at the top centre, where the antenna stands", () => {
      expect(points[0]!.x).toBeCloseTo(120, 6);
      expect(points[0]!.y).toBeCloseTo(20, 6);
      expect(Math.min(...points.map((point) => point.y))).toBeGreaterThan(19.5);
    });

    it("stays inside the face's frame", () => {
      for (const point of screen) {
        expect(point.x).toBeGreaterThan(4);
        expect(point.x).toBeLessThan(236);
        expect(point.y).toBeGreaterThan(4);
        expect(point.y).toBeLessThan(236);
      }
    });

    it("holds both eyes", () => {
      expect(eyeEdges.filter((edge) => !inside(screen, edge))).toEqual([]);
    });
  });
});

describe("totStillHeadPath", () => {
  it("draws a shape as one closed path in the still face's 100 box", () => {
    const path = totStillHeadPath("flower")!;
    expect(path.startsWith("M50.00 6.00")).toBe(true);
    expect(path.endsWith("Z")).toBe(true);
    expect(totStillHeadPath("round")).toBeNull();
  });
});
