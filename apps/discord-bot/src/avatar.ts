// @effect-diagnostics nodeBuiltinImport:off - The bridge caches rendered faces on disk with plain Node.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { TotAvatar, TotShape } from "@t3tools/contracts";
import { totHeadPoints } from "@t3tools/client-runtime/tots/shapes";
import { PNG } from "pngjs";

/** Discord shows a webhook avatar at 128; one PNG covers every size a client draws. */
export const AVATAR_SIZE = 128;

/** The app's idle face in its 100 box, scaled to 128 and moved down to leave room for the antenna. */
const HEAD = { x: 8, y: 21, width: 112, height: 102, radius: 38 };
/** A shaped head is drawn from the app's own outline, in its 240 box centred on 120,120. */
const HEAD_CENTRE = { x: 64, y: 72 };
const HEAD_SCALE = 51 / 100;
const EYES = [
  { x: 33, y: 57, width: 17, height: 31, radius: 8.5 },
  { x: 78, y: 57, width: 17, height: 31, radius: 8.5 },
];
const ANTENNA = { x: 64, y: 11, radius: 6 };

const EYE_COLOR = "#f8fafc";

type Colour = readonly [number, number, number];

/** Home's colour, used when a face spec is missing a usable colour. */
const FALLBACK_HEAD_COLOR: Colour = [10, 126, 164];

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface RoundedRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly radius: number;
}

const parseColour = (hex: string): Colour | null => {
  const match = /^#([0-9a-f]{6})$/iu.exec(hex.trim());
  const digits = match?.[1];
  if (digits === undefined) return null;
  return [
    Number.parseInt(digits.slice(0, 2), 16),
    Number.parseInt(digits.slice(2, 4), 16),
    Number.parseInt(digits.slice(4, 6), 16),
  ];
};

const colourOf = (hex: string): Colour => parseColour(hex) ?? FALLBACK_HEAD_COLOR;

/** A signed distance, so an edge lands between two pixels instead of on one. */
const coverageOf = (distance: number): number => Math.min(1, Math.max(0, 0.5 - distance));

const distanceToRoundedRect = (x: number, y: number, rect: RoundedRect): number => {
  const dx = Math.abs(x - (rect.x + rect.width / 2)) - (rect.width / 2 - rect.radius);
  const dy = Math.abs(y - (rect.y + rect.height / 2)) - (rect.height / 2 - rect.radius);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - rect.radius;
};

const distanceToCircle = (x: number, y: number, circle: { x: number; y: number; radius: number }) =>
  Math.hypot(x - circle.x, y - circle.y) - circle.radius;

/** Source-over paint of one opaque colour, so eyes and head keep their own edges. */
const paint = (pixel: Rgba, colour: Colour, coverage: number): void => {
  if (coverage <= 0) return;
  const alpha = coverage + pixel.a * (1 - coverage);
  const blend = (source: number, destination: number): number =>
    (source * coverage + destination * pixel.a * (1 - coverage)) / alpha;
  pixel.r = blend(colour[0], pixel.r);
  pixel.g = blend(colour[1], pixel.g);
  pixel.b = blend(colour[2], pixel.b);
  pixel.a = alpha;
};

/**
 * A Tot's face as a 128x128 PNG: the head in its colour, using the app's own
 * shape outline when the Tot picked one, the two-eye idle face, and the antenna
 * dot when the Tot has one. Skins do not change the outline; they are not drawn.
 */
/** Point-in-polygon, so a shaped head fills exactly the app's outline. */
const insidePolygon = (
  x: number,
  y: number,
  points: ReadonlyArray<{ x: number; y: number }>,
): boolean => {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!;
    const b = points[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};

const SUBPIXELS = [0.125, 0.375, 0.625, 0.875];

/** Coverage of a shaped head by sampling a 4x4 grid inside one pixel. */
const polygonCoverage = (
  x: number,
  y: number,
  points: ReadonlyArray<{ x: number; y: number }>,
): number => {
  let hits = 0;
  for (const oy of SUBPIXELS)
    for (const ox of SUBPIXELS) if (insidePolygon(x + ox - 0.5, y + oy - 0.5, points)) hits += 1;
  return hits / (SUBPIXELS.length * SUBPIXELS.length);
};

const outlineFor = (shape: TotShape | undefined) => {
  const raw = totHeadPoints(shape);
  if (raw === null) return null;
  return raw.map((point) => ({
    x: HEAD_CENTRE.x + (point.x - 120) * HEAD_SCALE,
    y: HEAD_CENTRE.y + (point.y - 120) * HEAD_SCALE,
  }));
};

export const renderTotFace = (avatar: TotAvatar): Buffer => {
  const png = new PNG({ width: AVATAR_SIZE, height: AVATAR_SIZE });
  const head = colourOf(avatar.color);
  const eye = colourOf(EYE_COLOR);
  const outline = outlineFor(avatar.shape);
  for (let y = 0; y < AVATAR_SIZE; y += 1) {
    for (let x = 0; x < AVATAR_SIZE; x += 1) {
      const pixel: Rgba = { r: 0, g: 0, b: 0, a: 0 };
      const centreX = x + 0.5;
      const centreY = y + 0.5;
      paint(
        pixel,
        head,
        outline === null
          ? coverageOf(distanceToRoundedRect(centreX, centreY, HEAD))
          : polygonCoverage(centreX, centreY, outline),
      );
      if (avatar.antenna === true) {
        paint(pixel, head, coverageOf(distanceToCircle(centreX, centreY, ANTENNA)));
      }
      for (const eyeRect of EYES) {
        paint(pixel, eye, coverageOf(distanceToRoundedRect(centreX, centreY, eyeRect)));
      }
      const offset = (y * AVATAR_SIZE + x) * 4;
      png.data[offset] = Math.round(pixel.r);
      png.data[offset + 1] = Math.round(pixel.g);
      png.data[offset + 2] = Math.round(pixel.b);
      png.data[offset + 3] = Math.round(pixel.a * 255);
    }
  }
  return PNG.sync.write(png);
};

/** The whole spec, so a skin or shape change re-uploads even before it changes pixels. */
export const avatarSpecKey = (avatar: TotAvatar): string => {
  const spec = {
    color: avatar.color,
    skin: avatar.skin ?? null,
    shape: avatar.shape ?? null,
    antenna: avatar.antenna ?? false,
  };
  return NodeCrypto.createHash("sha256").update(JSON.stringify(spec)).digest("hex").slice(0, 16);
};

export interface TotFaceImage {
  readonly bytes: Buffer;
  readonly key: string;
  readonly path: string;
}

export interface AvatarStore {
  readonly ensure: (totId: string, avatar: TotAvatar) => TotFaceImage;
}

export interface AvatarStoreOptions {
  /** One directory per environment, so two environments never share a face file. */
  readonly dir: string;
  readonly render?: (avatar: TotAvatar) => Buffer;
}

const FACE_INDEX_FILE = "faces.json";

const readIndex = (path: string): Record<string, string> => {
  try {
    const parsed: unknown = JSON.parse(NodeFS.readFileSync(path, "utf8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
};

/**
 * Renders a face only when its spec changed, and keeps the PNG on disk so a
 * restart re-uploads nothing. A missing file is written again even when the
 * index still names it.
 */
export const createAvatarStore = (options: AvatarStoreOptions): AvatarStore => {
  const render = options.render ?? renderTotFace;
  const indexPath = NodePath.join(options.dir, FACE_INDEX_FILE);
  let index: Record<string, string> | null = null;

  return {
    ensure: (totId, avatar) => {
      index ??= readIndex(indexPath);
      const key = avatarSpecKey(avatar);
      const path = NodePath.join(options.dir, `${totId.replace(/[^a-z0-9-]/giu, "_")}.png`);
      if (index[totId] === key) {
        try {
          return { bytes: NodeFS.readFileSync(path), key, path };
        } catch {
          // The file was deleted under the index; render it again below.
        }
      }
      const bytes = render(avatar);
      NodeFS.mkdirSync(options.dir, { recursive: true });
      NodeFS.writeFileSync(path, bytes);
      index[totId] = key;
      NodeFS.writeFileSync(indexPath, JSON.stringify(index, null, 2));
      return { bytes, key, path };
    },
  };
};
