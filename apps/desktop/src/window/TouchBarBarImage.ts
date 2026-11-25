import * as NodeZlib from "node:zlib";

import type { TouchBarWindowItem } from "@t3tools/shared/touchBar";

/** Touch Bar images are drawn at 2x; the bar is this many points tall. */
export const TOUCH_BAR_IMAGE_SCALE = 2;
const TOUCH_BAR_BAR_HEIGHT = 8;
const TRACK = [255, 255, 255, 56] as const;
const SEGMENT_GAP = 2;

type Rgba = readonly [number, number, number, number];

function parseHex(color: string): Rgba {
  const value = /^#([0-9a-f]{6})$/i.exec(color)?.[1] ?? "ffffff";
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
    255,
  ];
}

/** RGBA pixels for one bar, rounded ends included. Exported for tests. */
export function drawTouchBarBar(
  item: Pick<TouchBarWindowItem, "barStyle" | "barWidth" | "fill" | "color" | "segments">,
): { readonly width: number; readonly height: number; readonly pixels: Uint8Array } {
  const width = item.barWidth * TOUCH_BAR_IMAGE_SCALE;
  const height = TOUCH_BAR_BAR_HEIGHT * TOUCH_BAR_IMAGE_SCALE;
  const pixels = new Uint8Array(width * height * 4);
  const fillColor = parseHex(item.color);
  const radius = height / 2;
  const segmentWidth =
    (width - SEGMENT_GAP * TOUCH_BAR_IMAGE_SCALE * (item.segments.total - 1)) / item.segments.total;

  const paint = (x: number, y: number) => {
    if (item.barStyle === "segmented") {
      const pitch = segmentWidth + SEGMENT_GAP * TOUCH_BAR_IMAGE_SCALE;
      const index = Math.floor(x / pitch);
      if (x - index * pitch >= segmentWidth) return null;
      return index < item.segments.filled ? fillColor : TRACK;
    }
    // Rounded caps: outside the end circles stays transparent.
    const cx = x < radius ? radius : x > width - radius ? width - radius : x + 0.5;
    const dx = x + 0.5 - cx;
    const dy = y + 0.5 - radius;
    if (dx * dx + dy * dy > radius * radius) return null;
    return x + 0.5 <= item.fill * width ? fillColor : TRACK;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = paint(x, y);
      if (color === null) continue;
      pixels.set(color, (y * width + x) * 4);
    }
  }
  return { width, height, pixels };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A PNG, because nativeImage's raw bitmap byte order differs by platform. */
export function encodePng(width: number, height: number, pixels: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    rows[y * (width * 4 + 1)] = 0; // no filter
    rows.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", NodeZlib.deflateSync(rows)),
    chunk("IEND", new Uint8Array()),
  ]);
}

export function touchBarBarPng(
  item: Pick<TouchBarWindowItem, "barStyle" | "barWidth" | "fill" | "color" | "segments">,
): Buffer {
  const { width, height, pixels } = drawTouchBarBar(item);
  return encodePng(width, height, pixels);
}
