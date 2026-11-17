import { describe, expect, it } from "vite-plus/test";

import {
  TOT_ACCESSORY_FALLBACK,
  TOT_GLASSES_ART,
  TOT_HALO_ART,
  TOT_TOP_HAT_ART,
  totAccessoryBareId,
  totAccessoryChoices,
  totAccessoryColor,
  totAccessoryFit,
  totAccessoryPoint,
  totAccessoryShape,
  totGlassesPlacement,
  totHaloPlacement,
  totHeadBox,
  totHeadBoxIn,
  totTopHatCrownOutline,
  totTopHatCrownPath,
  totTopHatPlacement,
  totWearableAccessories,
  type TotAccessoryFrame,
} from "./accessories.ts";

const round: TotAccessoryFrame = {
  head: totHeadBox(undefined),
  unit: 1,
  centreX: 120,
  eyeY: 126,
};

describe("totHeadBox", () => {
  it("is BoopFace's own 200 square for a round head", () => {
    expect(totHeadBox(undefined)).toEqual({ x: 20, y: 20, width: 200, height: 200 });
    expect(totHeadBox("round")).toEqual({ x: 20, y: 20, width: 200, height: 200 });
  });

  it("follows a Tot shape's outline", () => {
    const gem = totHeadBox("gem");
    expect(gem.y).toBeCloseTo(20, 3);
    expect(gem.width).toBeGreaterThan(200);
    expect(gem.x + gem.width / 2).toBeCloseTo(120, 3);
    const flower = totHeadBox("flower");
    expect(flower.width).toBeGreaterThan(180);
    expect(flower.height).toBeCloseTo(187.5, 1);
  });

  it("maps into a drawing's own units", () => {
    expect(totHeadBoxIn("round", { x: 50, y: 50 }, 0.44)).toEqual({
      x: 6,
      y: 6,
      width: 88,
      height: 88,
    });
  });
});

describe("accessory placements", () => {
  it("stands the hat's brim on the head top, centred", () => {
    const hat = totTopHatPlacement(round);
    expect(hat.x).toBe(120);
    expect(hat.y).toBeCloseTo(19, 6);
    expect(hat.scale).toBeCloseTo(1, 6);
    // The crown rises 66 art units above the brim.
    const peak = totAccessoryPoint(hat, { x: 0, y: -66 });
    expect(peak.y).toBeCloseTo(19 - 66, 6);
  });

  it("grows the hat with a wider head, up to a point", () => {
    const wide = totTopHatPlacement({ ...round, head: { ...round.head, width: 400 } });
    expect(wide.scale).toBeCloseTo(1.75, 6);
    const tiny = totTopHatPlacement({ ...round, head: { ...round.head, width: 40 } });
    expect(tiny.scale).toBeCloseTo(0.5, 6);
  });

  it("floats the halo above the head top", () => {
    const halo = totHaloPlacement(round);
    expect(halo.x).toBe(120);
    expect(halo.y).toBeCloseTo(20 - 24, 6);
    expect(TOT_HALO_ART.ry + TOT_HALO_ART.glowWidth / 2).toBe(24);
  });

  it("puts the lenses over the eyes and the temples on the head edges", () => {
    const glasses = totGlassesPlacement(round);
    const leftLens = totAccessoryPoint(glasses, {
      x: TOT_GLASSES_ART.lens.left,
      y: TOT_GLASSES_ART.lens.top,
    });
    expect(leftLens).toEqual({ x: 54, y: 94 });
    expect(glasses.leftTempleEnd).toEqual({ x: 34, y: 106 });
    expect(glasses.rightTempleEnd).toEqual({ x: 206, y: 106 });
  });

  it("anchors glasses to a smaller face's own eye line", () => {
    const still = totGlassesPlacement({
      head: { x: 6, y: 10, width: 88, height: 80 },
      unit: 0.44,
      centreX: 50,
      eyeY: 50,
    });
    // The lenses hold the eye centres of the still face, 17.5 either side of 50.
    const left = totAccessoryPoint(still, { x: TOT_GLASSES_ART.lens.left + 32, y: 126 });
    expect(left.x).toBeCloseTo(50 - 34 * 0.44, 6);
    expect(left.y).toBeCloseTo(50, 6);
    expect(still.leftTempleEnd.x).toBeCloseTo(12.16, 2);
    expect(still.rightTempleEnd.x).toBeCloseTo(87.84, 2);
  });
});

describe("totAccessoryFit", () => {
  const still: TotAccessoryFrame = {
    head: { x: 6, y: 10, width: 88, height: 80 },
    unit: 0.44,
    centreX: 50,
    eyeY: 50,
  };
  const box = { width: 100, height: 100 };

  it("leaves a face alone when nothing stands above its head", () => {
    expect(totAccessoryFit(still, undefined, box, 2)).toBeNull();
    expect(totAccessoryFit(still, [{ kind: "glasses" }], box, 2)).toBeNull();
  });

  it("shrinks a face until a hat fits, then sits it on the margin", () => {
    const fit = totAccessoryFit(still, [{ kind: "top-hat" }], box, 2);
    expect(fit).not.toBeNull();
    const hat = totTopHatPlacement(still);
    const top = totAccessoryPoint(hat, { x: 0, y: -66 }).y;
    const bottom = still.head.y + still.head.height;
    expect(top * fit!.scale + fit!.y).toBeCloseTo(2, 6);
    expect(bottom * fit!.scale + fit!.y).toBeLessThanOrEqual(98);
    expect(fit!.scale).toBeLessThan(1);
    expect(fit!.x).toBeCloseTo((100 - 100 * fit!.scale) / 2, 6);
  });

  it("fits a halo too", () => {
    const fit = totAccessoryFit(still, [{ kind: "halo" }], box, 2);
    const halo = totHaloPlacement(still);
    const top = totAccessoryPoint(halo, { x: 0, y: -48 }).y;
    expect(top * fit!.scale + fit!.y).toBeCloseTo(2, 6);
  });
});

describe("accessory ids", () => {
  it("reads a catalog id and a legacy bare kind as the same item", () => {
    expect(totAccessoryBareId("cardinal.top-hat")).toBe("top-hat");
    expect(totAccessoryBareId("top-hat")).toBe("top-hat");
    expect(totAccessoryShape("cardinal.top-hat")).toBe("top-hat");
    expect(totAccessoryShape("top-hat")).toBe("top-hat");
    expect(totAccessoryShape("cardinal.glasses")).toBe("glasses");
    expect(totAccessoryShape("cardinal.halo")).toBe("halo");
  });

  it("returns null for a catalog item this build has no art for", () => {
    expect(totAccessoryShape("cardinal.storm-cloud")).toBeNull();
    expect(totAccessoryShape("other-pack.crown")).toBeNull();
  });

  it("offers the component registry, falling back to the three built-ins", () => {
    expect(
      totAccessoryChoices([
        { id: "cardinal.jester-hat", label: "Jester hat", defaultColor: "#ff00aa" },
        { id: "cardinal.top-hat", label: "Top hat", defaultColor: "#191b20" },
      ]),
    ).toEqual([
      { id: "cardinal.jester-hat", label: "Jester hat", defaultColor: "#ff00aa" },
      { id: "cardinal.top-hat", label: "Top hat", defaultColor: "#191b20" },
    ]);
    expect(totAccessoryChoices(undefined)).toEqual(TOT_ACCESSORY_FALLBACK);
    expect(totAccessoryChoices([])).toEqual(TOT_ACCESSORY_FALLBACK);
    expect(totAccessoryChoices([{ label: "no id" }])).toEqual(TOT_ACCESSORY_FALLBACK);
  });

  it("maps what the component knows to catalog ids and leaves the rest out", () => {
    expect(
      totWearableAccessories(
        [
          { kind: "top-hat" },
          { kind: "cardinal.glasses", color: "#123456" },
          { kind: "cardinal.storm-cloud" },
          { kind: "cardinal.halo" },
        ],
        TOT_ACCESSORY_FALLBACK,
      ),
    ).toEqual([
      { kind: "cardinal.top-hat" },
      { kind: "cardinal.glasses", color: "#123456" },
      { kind: "cardinal.halo" },
    ]);
  });
});

describe("accessory art", () => {
  it("draws the hat's crown from its own outline", () => {
    expect(totTopHatCrownPath()).toBe(`M -34 1 L -29 -58 Q 0 -66 29 -58 L 34 1 Z`);
    const outline = totTopHatCrownOutline(4);
    expect(outline[0]).toEqual({ x: TOT_TOP_HAT_ART.crown.bottomLeft, y: 1 });
    expect(outline.at(-1)).toEqual({ x: TOT_TOP_HAT_ART.crown.bottomRight, y: 1 });
    expect(Math.min(...outline.map((point) => point.y))).toBeLessThan(-60);
  });

  it("gives an accessory its own color unless the Tot picked one", () => {
    expect(totAccessoryColor({ kind: "cardinal.halo" })).toBe("#f4c84b");
    expect(totAccessoryColor({ kind: "halo" })).toBe("#f4c84b");
    expect(totAccessoryColor({ kind: "cardinal.glasses" })).toBe("#262b33");
    expect(totAccessoryColor({ kind: "top-hat" })).toBe("#191b20");
    expect(totAccessoryColor({ kind: "cardinal.glasses", color: "#123456" })).toBe("#123456");
    expect(
      totAccessoryColor({ kind: "cardinal.jester-hat" }, [
        { id: "cardinal.jester-hat", label: "Jester hat", defaultColor: "#ff00aa" },
      ]),
    ).toBe("#ff00aa");
  });
});
