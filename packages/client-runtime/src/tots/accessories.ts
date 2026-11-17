/**
 * Accessory art for the surfaces without the web component: the mobile still
 * face and the Discord PNG. Art exists for the built-ins; a catalog id this
 * build does not know is skipped, and the web component draws it.
 */
import type { TotAccessory, TotShape } from "@t3tools/contracts";

import { totHeadPoints, type HeadPoint } from "./shapes.ts";

/** The accessories the native surfaces have art for. */
export type TotAccessoryShape = "top-hat" | "glasses" | "halo";

/** The three items this build can draw without a catalog read. */
export interface TotAccessoryChoice {
  /** The catalog id, such as `cardinal.top-hat`. */
  readonly id: string;
  readonly label: string;
  readonly defaultColor: string;
}

export const TOT_ACCESSORY_FALLBACK: ReadonlyArray<TotAccessoryChoice> = [
  { id: "cardinal.top-hat", label: "Top hat", defaultColor: "#191b20" },
  { id: "cardinal.glasses", label: "Glasses", defaultColor: "#262b33" },
  { id: "cardinal.halo", label: "Halo", defaultColor: "#f4c84b" },
];

const TOT_ACCESSORY_DEFAULT_COLORS: Record<TotAccessoryShape, string> = {
  "top-hat": "#191b20",
  glasses: "#262b33",
  halo: "#f4c84b",
};

/** The bare kind of a catalog id: `cardinal.top-hat` becomes `top-hat`. */
export const totAccessoryBareId = (id: string): string => {
  const text = id.trim().toLowerCase();
  return text.slice(text.lastIndexOf(".") + 1);
};

/** The built-in art an id maps to, or null for a catalog item this build cannot draw. */
export const totAccessoryShape = (id: string): TotAccessoryShape | null => {
  const bare = totAccessoryBareId(id);
  return bare === "top-hat" || bare === "glasses" || bare === "halo" ? bare : null;
};

/**
 * What the editor offers: the component's registered catalog, or the three
 * built-ins when the registry cannot be read.
 */
export const totAccessoryChoices = (
  catalog: ReadonlyArray<{ id?: unknown; label?: unknown; defaultColor?: unknown }> | undefined,
): ReadonlyArray<TotAccessoryChoice> => {
  const choices = (catalog ?? []).flatMap((entry): TotAccessoryChoice[] => {
    if (typeof entry.id !== "string" || entry.id === "") return [];
    return [
      {
        id: entry.id,
        label: typeof entry.label === "string" && entry.label !== "" ? entry.label : entry.id,
        defaultColor:
          typeof entry.defaultColor === "string" && /^#[0-9a-fA-F]{6}$/u.test(entry.defaultColor)
            ? entry.defaultColor
            : (TOT_ACCESSORY_DEFAULT_COLORS[totAccessoryShape(entry.id) ?? "top-hat"] ?? "#191b20"),
      },
    ];
  });
  return choices.length > 0 ? choices : TOT_ACCESSORY_FALLBACK;
};

export const totAccessoryColor = (
  accessory: TotAccessory,
  choices: ReadonlyArray<TotAccessoryChoice> = TOT_ACCESSORY_FALLBACK,
): string => {
  if (accessory.color !== undefined) return accessory.color;
  const bare = totAccessoryBareId(accessory.kind);
  const exact = choices.find((choice) => choice.id === accessory.kind);
  const byBare = exact ?? choices.find((choice) => totAccessoryBareId(choice.id) === bare);
  return (
    byBare?.defaultColor ??
    TOT_ACCESSORY_DEFAULT_COLORS[totAccessoryShape(accessory.kind) ?? "top-hat"]
  );
};

/**
 * The accessories the loaded component can draw, mapped to its catalog ids.
 * Unknown ids are left to a newer client instead of making setAccessories throw.
 */
export const totWearableAccessories = (
  accessories: ReadonlyArray<TotAccessory> | undefined,
  catalog: ReadonlyArray<{ readonly id: string }>,
): ReadonlyArray<{ readonly kind: string; readonly color?: string }> => {
  const wearable: { kind: string; color?: string }[] = [];
  for (const accessory of accessories ?? []) {
    const exact = catalog.find((entry) => entry.id === accessory.kind);
    const bare = totAccessoryBareId(accessory.kind);
    const byBare =
      exact === undefined ? catalog.filter((entry) => totAccessoryBareId(entry.id) === bare) : [];
    const known = exact ?? (byBare.length === 1 ? byBare[0] : undefined);
    if (known === undefined) continue;
    wearable.push({
      kind: known.id,
      ...(accessory.color === undefined ? {} : { color: accessory.color }),
    });
  }
  return wearable;
};

export const TOT_TOP_HAT_ART = {
  brim: { rx: 62, ry: 11 },
  crown: {
    base: 1,
    top: -58,
    peak: -66,
    peakX: 0,
    bottomLeft: -34,
    bottomRight: 34,
    topLeft: -29,
    topRight: 29,
  },
  band: { top: -15, bottom: -5, innerLeft: -30, innerRight: 30, outerLeft: -31, outerRight: 31 },
  bandOpacity: 0.13,
  sheen: { cx: -11, cy: -55, rx: 9, ry: 3 },
  sheenOpacity: 0.12,
} as const;

export const TOT_GLASSES_ART = {
  lens: { left: 54, top: 94, width: 64, height: 64, radius: 20 },
  /** The lenses sit 4 apart, joined by the bridge. */
  gap: 4,
  strokeWidth: 6,
  fillOpacity: 0.12,
  bridge: {
    from: { x: 118, y: 116 },
    control: { x: 120, y: 110 },
    to: { x: 122, y: 116 },
    width: 5,
  },
  temples: { left: { x: 52, y: 112 }, right: { x: 188, y: 112 }, endY: 106, width: 5 },
  highlights: [
    { from: { x: 65, y: 107 }, to: { x: 77, y: 101 } },
    { from: { x: 133, y: 107 }, to: { x: 145, y: 101 } },
  ],
  highlightWidth: 3,
  highlightOpacity: 0.34,
} as const;

export const TOT_HALO_ART = {
  rx: 56,
  ry: 14,
  glowWidth: 20,
  glowOpacity: 0.16,
  strokeWidth: 8,
} as const;

const crown = TOT_TOP_HAT_ART.crown;

export const totTopHatCrownPath = (): string =>
  `M ${crown.bottomLeft} ${crown.base} L ${crown.topLeft} ${crown.top} ` +
  `Q ${crown.peakX} ${crown.peak} ${crown.topRight} ${crown.top} L ${crown.bottomRight} ${crown.base} Z`;

/** The crown as a polygon, for surfaces that fill shapes pixel by pixel. */
export const totTopHatCrownOutline = (samples = 8): ReadonlyArray<HeadPoint> => {
  const top: HeadPoint[] = [];
  for (let step = 0; step <= samples; step += 1) {
    const t = step / samples;
    const inverse = 1 - t;
    top.push({
      x: inverse * inverse * crown.topLeft + 2 * inverse * t * crown.peakX + t * t * crown.topRight,
      y: inverse * inverse * crown.top + 2 * inverse * t * crown.peak + t * t * crown.top,
    });
  }
  return [{ x: crown.bottomLeft, y: crown.base }, ...top, { x: crown.bottomRight, y: crown.base }];
};

const band = TOT_TOP_HAT_ART.band;

export const totTopHatBandPath = (): string =>
  `M ${band.innerLeft} ${band.top} L ${band.innerRight} ${band.top} ` +
  `L ${band.outerRight} ${band.bottom} L ${band.outerLeft} ${band.bottom} Z`;

export const totTopHatBandOutline = (): ReadonlyArray<HeadPoint> => [
  { x: band.innerLeft, y: band.top },
  { x: band.innerRight, y: band.top },
  { x: band.outerRight, y: band.bottom },
  { x: band.outerLeft, y: band.bottom },
];

export const totGlassesBridgePath = (): string =>
  `M ${TOT_GLASSES_ART.bridge.from.x} ${TOT_GLASSES_ART.bridge.from.y} ` +
  `Q ${TOT_GLASSES_ART.bridge.control.x} ${TOT_GLASSES_ART.bridge.control.y} ` +
  `${TOT_GLASSES_ART.bridge.to.x} ${TOT_GLASSES_ART.bridge.to.y}`;

export interface TotHeadBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The head outline in BoopFace's 240 box; its own 200 square when round. */
export function totHeadBox(shape: TotShape | undefined): TotHeadBox {
  const points = totHeadPoints(shape);
  if (points === null) return { x: 20, y: 20, width: 200, height: 200 };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** The same box in a drawing that puts BoopFace's 120,120 at `centre`. */
export function totHeadBoxIn(
  shape: TotShape | undefined,
  centre: HeadPoint,
  unit: number,
): TotHeadBox {
  const box = totHeadBox(shape);
  return {
    x: centre.x + (box.x - 120) * unit,
    y: centre.y + (box.y - 120) * unit,
    width: box.width * unit,
    height: box.height * unit,
  };
}

/** Where a face's head and eyes are in a drawing's own units. */
export interface TotAccessoryFrame {
  readonly head: TotHeadBox;
  /** How many drawing units one BoopFace 240-box unit is. */
  readonly unit: number;
  readonly centreX: number;
  readonly eyeY: number;
}

export interface TotAccessoryPlacement {
  /** Where the art origin lands in the drawing. */
  readonly x: number;
  readonly y: number;
  /** How much to scale the 240-box art. */
  readonly scale: number;
  /** The art point that lands on `x`, `y`; the eye point for glasses. */
  readonly origin: HeadPoint;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The hat and halo follow the head's width, between half and 1.75 times their own size. */
const headScale = (frame: TotAccessoryFrame): number =>
  frame.unit * clamp(frame.head.width / (200 * frame.unit), 0.5, 1.75);

export const totAccessoryPoint = (
  placement: TotAccessoryPlacement,
  point: HeadPoint,
): HeadPoint => ({
  x: placement.x + (point.x - placement.origin.x) * placement.scale,
  y: placement.y + (point.y - placement.origin.y) * placement.scale,
});

/** An SVG transform that maps the 240-box art onto the drawing. */
export const totAccessoryTransform = (placement: TotAccessoryPlacement): string =>
  `translate(${placement.x} ${placement.y}) scale(${placement.scale}) ` +
  `translate(${-placement.origin.x} ${-placement.origin.y})`;

/** The brim's centre stands on the head's top edge. */
export const totTopHatPlacement = (frame: TotAccessoryFrame): TotAccessoryPlacement => {
  const scale = headScale(frame);
  return { x: frame.centreX, y: frame.head.y - scale, scale, origin: { x: 0, y: 0 } };
};

/** The halo floats 24 art units above the head's top edge. */
export const totHaloPlacement = (frame: TotAccessoryFrame): TotAccessoryPlacement => {
  const scale = headScale(frame);
  return { x: frame.centreX, y: frame.head.y - 24 * scale, scale, origin: { x: 0, y: 0 } };
};

export interface TotGlassesPlacement extends TotAccessoryPlacement {
  /** The temples reach for the live head edges, so a shaped head still looks supported. */
  readonly leftTempleEnd: HeadPoint;
  readonly rightTempleEnd: HeadPoint;
}

/** The lenses hold BoopFace's own eye coordinates, planted on this face's eye line. */
export const totGlassesPlacement = (frame: TotAccessoryFrame): TotGlassesPlacement => {
  const { unit } = frame;
  const artX = (x: number) => frame.centreX + (x - 120) * unit;
  const templeY = frame.eyeY + (TOT_GLASSES_ART.temples.endY - 126) * unit;
  return {
    x: frame.centreX,
    y: frame.eyeY,
    scale: unit,
    origin: { x: 120, y: 126 },
    leftTempleEnd: {
      x: clamp(frame.head.x + 14 * unit, artX(4), artX(50)),
      y: templeY,
    },
    rightTempleEnd: {
      x: clamp(frame.head.x + frame.head.width - 14 * unit, artX(190), artX(236)),
      y: templeY,
    },
  };
};

/** How far above the head the worn accessories reach, in art units of the 240 box. */
const totAccessoryReach = (
  frame: TotAccessoryFrame,
  accessories: ReadonlyArray<TotAccessory>,
): number => {
  const scale = headScale(frame);
  let reach = 0;
  for (const accessory of accessories) {
    const shape = totAccessoryShape(accessory.kind);
    if (shape === "top-hat") reach = Math.max(reach, 67 * scale);
    if (shape === "halo") reach = Math.max(reach, 72 * scale);
  }
  return reach;
};

export interface TotFaceFit {
  /** Scale for the whole face drawing, at most 1. */
  readonly scale: number;
  /** Where the drawing's origin lands after scaling, in drawing units. */
  readonly x: number;
  readonly y: number;
}

/**
 * Shrinks a face in its square when a hat or halo would reach past the edge.
 * The component lets accessories overflow; a raster or a native SVG cannot.
 */
export function totAccessoryFit(
  frame: TotAccessoryFrame,
  accessories: ReadonlyArray<TotAccessory> | undefined,
  box: { readonly width: number; readonly height: number },
  margin: number,
): TotFaceFit | null {
  const reach = totAccessoryReach(frame, accessories ?? []);
  if (reach === 0) return null;
  const top = frame.head.y - reach;
  const bottom = frame.head.y + frame.head.height;
  const scale = Math.min(1, (box.height - margin * 2) / (bottom - top));
  if (scale === 1) return null;
  return {
    scale,
    x: (box.width - box.width * scale) / 2,
    // Lines the accessory's own top up with the margin, so nothing is cropped.
    y: margin - top * scale,
  };
}
