import * as NodeZlib from "node:zlib";

import { describe, expect, it } from "vite-plus/test";

import { drawTouchBarBar, encodePng, touchBarBarPng } from "./TouchBarBarImage.ts";

const bar = {
  barStyle: "filled" as const,
  barWidth: 40,
  fill: 0.5,
  color: "#ff0000",
  segments: { total: 10, filled: 5 },
};

const pixelAt = (image: ReturnType<typeof drawTouchBarBar>, x: number, y: number) =>
  Array.from(image.pixels.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));

describe("drawTouchBarBar", () => {
  it("fills the bar in proportion and leaves the rest as track at 2x", () => {
    const image = drawTouchBarBar(bar);
    expect([image.width, image.height]).toEqual([80, 16]);
    const middle = image.height / 2;
    expect(pixelAt(image, 20, middle)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(image, 39, middle)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(image, 41, middle)[3]).toBe(56);
    // Rounded ends leave the corners transparent.
    expect(pixelAt(image, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it("draws nothing filled at 0% and everything at 100%", () => {
    const empty = drawTouchBarBar({ ...bar, fill: 0 });
    const full = drawTouchBarBar({ ...bar, fill: 1 });
    expect(pixelAt(empty, 40, 8)[0]).toBe(255);
    expect(pixelAt(empty, 40, 8)[3]).toBe(56);
    expect(pixelAt(full, 72, 8)).toEqual([255, 0, 0, 255]);
  });

  it("splits a segmented bar into filled and empty blocks with gaps", () => {
    const image = drawTouchBarBar({ ...bar, barStyle: "segmented" });
    // 10 segments over 80px with nine 4px gaps: each segment is 4.4px wide.
    expect(pixelAt(image, 1, 0)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(image, 6, 8)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(image, 79, 8)[3]).toBe(56);
  });
});

describe("encodePng", () => {
  it("writes a PNG whose pixel rows round-trip", () => {
    const pixels = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const png = encodePng(2, 1, pixels);
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(png.subarray(12, 16).toString("ascii")).toBe("IHDR");
    expect(png.readUInt32BE(16)).toBe(2);
    expect(png.readUInt32BE(20)).toBe(1);
    const idatLength = png.readUInt32BE(33);
    expect(png.subarray(37, 41).toString("ascii")).toBe("IDAT");
    const rows = NodeZlib.inflateSync(png.subarray(41, 41 + idatLength));
    expect(Array.from(rows)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(png.subarray(-8, -4).toString("ascii")).toBe("IEND");
  });

  it("encodes a bar", () => {
    expect(touchBarBarPng(bar).length).toBeGreaterThan(50);
  });
});
