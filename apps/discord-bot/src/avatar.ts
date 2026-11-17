// @effect-diagnostics nodeBuiltinImport:off - The bridge caches rendered faces on disk with plain Node.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  TOT_GLASSES_ART,
  TOT_HALO_ART,
  TOT_TOP_HAT_ART,
  totAccessoryColor,
  totAccessoryFit,
  totAccessoryPoint,
  totGlassesPlacement,
  totHaloPlacement,
  totTopHatBandOutline,
  totTopHatCrownOutline,
  totTopHatPlacement,
  type TotAccessoryFrame,
  type TotFaceFit,
  type TotHeadBox,
} from "@t3tools/client-runtime/tots/accessories";
import { totHeadPoints, type HeadPoint } from "@t3tools/client-runtime/tots/shapes";
import type { TotAccessory, TotAvatar, TotShape } from "@t3tools/contracts";
import { PNG } from "pngjs";

/** Discord shows a webhook avatar at 128; one PNG covers every size a client draws. */
export const AVATAR_SIZE = 128;

/** The app's idle face in its 100 box, scaled to 128 and moved down to leave room for the antenna. */
const HEAD: RoundedRect = { x: 8, y: 21, width: 112, height: 102, radius: 38 };
/** A shaped head is drawn from the app's own outline, in its 240 box centred on 120,120. */
const HEAD_CENTRE = { x: 64, y: 72 };
const HEAD_SCALE = 51 / 100;
const EYES = [
  { x: 33, y: 57, width: 17, height: 31, radius: 8.5 },
  { x: 78, y: 57, width: 17, height: 31, radius: 8.5 },
];
const EYE_Y = 72.5;
const ANTENNA = { x: 64, y: 11, radius: 6 };

const EYE_COLOR = "#f8fafc";
const WHITE = [255, 255, 255] as const;
/** Bumped when the drawing changes, so every existing webhook re-uploads once. */
const AVATAR_SPEC_VERSION = 2;

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

const accessoryColour = (accessory: TotAccessory): Colour => colourOf(totAccessoryColor(accessory));

/** A signed distance, so an edge lands between two pixels instead of on one. */
const coverageOf = (distance: number): number => Math.min(1, Math.max(0, 0.5 - distance));

const distanceToRoundedRect = (x: number, y: number, rect: RoundedRect): number => {
  const dx = Math.abs(x - (rect.x + rect.width / 2)) - (rect.width / 2 - rect.radius);
  const dy = Math.abs(y - (rect.y + rect.height / 2)) - (rect.height / 2 - rect.radius);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - rect.radius;
};

const distanceToCircle = (x: number, y: number, circle: { x: number; y: number; radius: number }) =>
  Math.hypot(x - circle.x, y - circle.y) - circle.radius;

/** An ellipse's signed distance, scaled by its smaller radius so edges stay smooth. */
const distanceToEllipse = (
  x: number,
  y: number,
  centre: HeadPoint,
  rx: number,
  ry: number,
): number => (Math.hypot((x - centre.x) / rx, (y - centre.y) / ry) - 1) * Math.min(rx, ry);

const distanceToSegment = (x: number, y: number, from: HeadPoint, to: HeadPoint): number => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = dx * dx + dy * dy;
  const along =
    length === 0 ? 0 : Math.min(1, Math.max(0, ((x - from.x) * dx + (y - from.y) * dy) / length));
  return Math.hypot(x - (from.x + along * dx), y - (from.y + along * dy));
};

/** Source-over paint of one colour; `alpha` softens it for translucent accessory parts. */
const paint = (pixel: Rgba, colour: Colour, coverage: number, alpha = 1): void => {
  const amount = coverage * alpha;
  if (amount <= 0) return;
  const resultAlpha = amount + pixel.a * (1 - amount);
  const blend = (source: number, destination: number): number =>
    (source * amount + destination * pixel.a * (1 - amount)) / resultAlpha;
  pixel.r = blend(colour[0], pixel.r);
  pixel.g = blend(colour[1], pixel.g);
  pixel.b = blend(colour[2], pixel.b);
  pixel.a = resultAlpha;
};

/** Point-in-polygon, so a shaped head fills exactly the app's outline. */
const insidePolygon = (x: number, y: number, points: ReadonlyArray<HeadPoint>): boolean => {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!;
    const b = points[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};

const SUBPIXELS = [0.125, 0.375, 0.625, 0.875];

/** Coverage of a shape by sampling a 4x4 grid inside one pixel. */
const polygonCoverage = (x: number, y: number, points: ReadonlyArray<HeadPoint>): number => {
  let hits = 0;
  for (const oy of SUBPIXELS)
    for (const ox of SUBPIXELS) if (insidePolygon(x + ox - 0.5, y + oy - 0.5, points)) hits += 1;
  return hits / (SUBPIXELS.length * SUBPIXELS.length);
};

const outlineFor = (shape: TotShape | undefined): ReadonlyArray<HeadPoint> | null => {
  const raw = totHeadPoints(shape);
  if (raw === null) return null;
  return raw.map((point) => ({
    x: HEAD_CENTRE.x + (point.x - 120) * HEAD_SCALE,
    y: HEAD_CENTRE.y + (point.y - 120) * HEAD_SCALE,
  }));
};

const boxOf = (points: ReadonlyArray<HeadPoint>): TotHeadBox => {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
};

/** One accessory shape, sampled in the PNG's own coordinates. */
interface AccessoryPaint {
  readonly colour: Colour;
  readonly alpha: number;
  readonly coverage: (x: number, y: number) => number;
}

const quadPoints = (
  from: HeadPoint,
  control: HeadPoint,
  to: HeadPoint,
  samples: number,
): HeadPoint[] =>
  Array.from({ length: samples + 1 }, (_, step) => {
    const t = step / samples;
    const inverse = 1 - t;
    return {
      x: inverse * inverse * from.x + 2 * inverse * t * control.x + t * t * to.x,
      y: inverse * inverse * from.y + 2 * inverse * t * control.y + t * t * to.y,
    };
  });

/** Every accessory BoopFace would draw, anchored to the bridge's own head and eye line. */
const accessoryPaints = (
  accessories: ReadonlyArray<TotAccessory> | undefined,
  frame: TotAccessoryFrame,
  fit: TotFaceFit | null,
): ReadonlyArray<AccessoryPaint> => {
  if (accessories === undefined || accessories.length === 0) return [];
  const fitScale = fit?.scale ?? 1;
  const place = (point: HeadPoint): HeadPoint =>
    fit === null ? point : { x: point.x * fit.scale + fit.x, y: point.y * fit.scale + fit.y };
  const paints: AccessoryPaint[] = [];

  const ellipse = (centre: HeadPoint, rx: number, ry: number, colour: Colour, alpha = 1) => {
    const placed = place(centre);
    paints.push({
      colour,
      alpha,
      coverage: (x, y) => coverageOf(distanceToEllipse(x, y, placed, rx * fitScale, ry * fitScale)),
    });
  };
  const ellipseRing = (
    centre: HeadPoint,
    rx: number,
    ry: number,
    width: number,
    colour: Colour,
    alpha: number,
  ) => {
    const placed = place(centre);
    paints.push({
      colour,
      alpha,
      coverage: (x, y) =>
        coverageOf(
          distanceToEllipse(x, y, placed, (rx + width / 2) * fitScale, (ry + width / 2) * fitScale),
        ) *
        (1 -
          coverageOf(
            distanceToEllipse(
              x,
              y,
              placed,
              (rx - width / 2) * fitScale,
              (ry - width / 2) * fitScale,
            ),
          )),
    });
  };
  const polygon = (points: ReadonlyArray<HeadPoint>, colour: Colour, alpha = 1) => {
    const placed = points.map(place);
    paints.push({ colour, alpha, coverage: (x, y) => polygonCoverage(x, y, placed) });
  };
  const roundedRect = (rect: RoundedRect, colour: Colour, alpha: number, strokeWidth?: number) => {
    const placed = {
      x: rect.x * fitScale + (fit?.x ?? 0),
      y: rect.y * fitScale + (fit?.y ?? 0),
      width: rect.width * fitScale,
      height: rect.height * fitScale,
      radius: rect.radius * fitScale,
    };
    paints.push({
      colour,
      alpha,
      coverage:
        strokeWidth === undefined
          ? (x, y) => coverageOf(distanceToRoundedRect(x, y, placed))
          : (x, y) =>
              coverageOf(
                Math.abs(distanceToRoundedRect(x, y, placed)) - (strokeWidth * fitScale) / 2,
              ),
    });
  };
  const line = (from: HeadPoint, to: HeadPoint, width: number, colour: Colour, alpha = 1) => {
    const start = place(from);
    const end = place(to);
    paints.push({
      colour,
      alpha,
      coverage: (x, y) => coverageOf(distanceToSegment(x, y, start, end) - (width * fitScale) / 2),
    });
  };

  for (const accessory of accessories) {
    const colour = accessoryColour(accessory);
    switch (accessory.kind) {
      case "top-hat": {
        const hat = totTopHatPlacement(frame);
        const art = (x: number, y: number) => totAccessoryPoint(hat, { x, y });
        ellipse(
          art(0, 0),
          TOT_TOP_HAT_ART.brim.rx * hat.scale,
          TOT_TOP_HAT_ART.brim.ry * hat.scale,
          colour,
        );
        polygon(
          totTopHatCrownOutline().map((point) => art(point.x, point.y)),
          colour,
        );
        polygon(
          totTopHatBandOutline().map((point) => art(point.x, point.y)),
          WHITE,
          TOT_TOP_HAT_ART.bandOpacity,
        );
        ellipse(
          art(TOT_TOP_HAT_ART.sheen.cx, TOT_TOP_HAT_ART.sheen.cy),
          TOT_TOP_HAT_ART.sheen.rx * hat.scale,
          TOT_TOP_HAT_ART.sheen.ry * hat.scale,
          WHITE,
          TOT_TOP_HAT_ART.sheenOpacity,
        );
        break;
      }
      case "glasses": {
        const glasses = totGlassesPlacement(frame);
        const art = (x: number, y: number) => totAccessoryPoint(glasses, { x, y });
        const lens = TOT_GLASSES_ART.lens;
        const lensRect = (left: number): RoundedRect => ({
          x: art(left, lens.top).x,
          y: art(left, lens.top).y,
          width: lens.width * glasses.scale,
          height: lens.height * glasses.scale,
          radius: lens.radius * glasses.scale,
        });
        for (const left of [lens.left, lens.left + lens.width + TOT_GLASSES_ART.gap]) {
          roundedRect(lensRect(left), colour, TOT_GLASSES_ART.fillOpacity);
          roundedRect(lensRect(left), colour, 1, TOT_GLASSES_ART.strokeWidth * glasses.scale);
        }
        const bridge = TOT_GLASSES_ART.bridge;
        const bridgePoints = quadPoints(
          art(bridge.from.x, bridge.from.y),
          art(bridge.control.x, bridge.control.y),
          art(bridge.to.x, bridge.to.y),
          8,
        );
        for (let index = 1; index < bridgePoints.length; index += 1) {
          line(
            bridgePoints[index - 1]!,
            bridgePoints[index]!,
            bridge.width * glasses.scale,
            colour,
          );
        }
        line(
          art(TOT_GLASSES_ART.temples.left.x, TOT_GLASSES_ART.temples.left.y),
          glasses.leftTempleEnd,
          TOT_GLASSES_ART.temples.width * glasses.scale,
          colour,
        );
        line(
          art(TOT_GLASSES_ART.temples.right.x, TOT_GLASSES_ART.temples.right.y),
          glasses.rightTempleEnd,
          TOT_GLASSES_ART.temples.width * glasses.scale,
          colour,
        );
        for (const highlight of TOT_GLASSES_ART.highlights) {
          line(
            art(highlight.from.x, highlight.from.y),
            art(highlight.to.x, highlight.to.y),
            TOT_GLASSES_ART.highlightWidth * glasses.scale,
            WHITE,
            TOT_GLASSES_ART.highlightOpacity,
          );
        }
        break;
      }
      case "halo": {
        const halo = totHaloPlacement(frame);
        const centre = { x: halo.x, y: halo.y };
        ellipseRing(
          centre,
          TOT_HALO_ART.rx * halo.scale,
          TOT_HALO_ART.ry * halo.scale,
          TOT_HALO_ART.glowWidth * halo.scale,
          colour,
          TOT_HALO_ART.glowOpacity,
        );
        ellipseRing(
          centre,
          TOT_HALO_ART.rx * halo.scale,
          TOT_HALO_ART.ry * halo.scale,
          TOT_HALO_ART.strokeWidth * halo.scale,
          colour,
          1,
        );
        break;
      }
    }
  }
  return paints;
};

/**
 * A Tot's face as a 128x128 PNG: the head in its colour, using the app's own
 * shape outline when the Tot picked one, the two-eye idle face, the antenna
 * dot when the Tot has one, and its accessories. Skins do not change the
 * outline; they are not drawn.
 */
export const renderTotFace = (avatar: TotAvatar): Buffer => {
  const png = new PNG({ width: AVATAR_SIZE, height: AVATAR_SIZE });
  const head = colourOf(avatar.color);
  const eye = colourOf(EYE_COLOR);
  const outline = outlineFor(avatar.shape);
  const frame: TotAccessoryFrame = {
    head: outline === null ? HEAD : boxOf(outline),
    unit: HEAD_SCALE,
    centreX: HEAD_CENTRE.x,
    eyeY: EYE_Y,
  };
  const fit = totAccessoryFit(
    frame,
    avatar.accessories ?? [],
    {
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
    },
    2,
  );
  const accessories = accessoryPaints(avatar.accessories, frame, fit);
  // The antenna belongs to the face, so it shrinks with it around a hat.
  const antenna =
    fit === null
      ? ANTENNA
      : {
          x: ANTENNA.x * fit.scale + fit.x,
          y: ANTENNA.y * fit.scale + fit.y,
          radius: ANTENNA.radius * fit.scale,
        };
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
      for (const eyeRect of EYES) {
        paint(pixel, eye, coverageOf(distanceToRoundedRect(centreX, centreY, eyeRect)));
      }
      for (const painting of accessories) {
        paint(pixel, painting.colour, painting.coverage(centreX, centreY), painting.alpha);
      }
      // BoopFace adds its antenna above the face, so it stays visible over a hat.
      if (avatar.antenna === true) {
        paint(pixel, head, coverageOf(distanceToCircle(centreX, centreY, antenna)));
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

/** The whole spec, so a skin, shape or accessory change re-uploads even before it changes pixels. */
export const avatarSpecKey = (avatar: TotAvatar): string => {
  const spec = {
    version: AVATAR_SPEC_VERSION,
    color: avatar.color,
    skin: avatar.skin ?? null,
    shape: avatar.shape ?? null,
    antenna: avatar.antenna ?? false,
    accessories: avatar.accessories ?? [],
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
