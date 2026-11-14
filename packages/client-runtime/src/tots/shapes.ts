import type { TotShape } from "@t3tools/contracts";

/** A point on a BoopFace head, in its 240 box with the head centred on 120,120. */
export interface HeadPoint {
  readonly x: number;
  readonly y: number;
}

const SAMPLES = 180;
const CENTER = 120;
// BoopFace's antenna stands on the head's top point, 100 above the centre.
const TOP_RADIUS = 100;
const SMOOTHING = 3;

/** Relative radius by turn angle, 0 at the top and increasing clockwise. */
type Profile = (turn: number) => number;

const polygon = (corners: number): Profile => {
  const half = Math.PI / corners;
  return (turn) => {
    const fromCorner = (((turn + half) % (2 * half)) + 2 * half) % (2 * half);
    return Math.cos(half) / Math.cos(fromCorner - half);
  };
};

const squircle: Profile = (turn) => {
  const exponent = 5;
  return (
    1 /
    Math.pow(
      Math.pow(Math.abs(Math.cos(turn)), exponent) + Math.pow(Math.abs(Math.sin(turn)), exponent),
      1 / exponent,
    )
  );
};

const gem = polygon(6);

const PROFILES: Record<Exclude<TotShape, "round">, Profile> = {
  squircle,
  blob: (turn) =>
    1 + 0.06 * Math.cos(2 * turn) + 0.05 * Math.sin(3 * turn) + 0.03 * Math.cos(5 * turn + 0.8),
  flower: (turn) => 1 + 0.1 * Math.cos(5 * turn),
  clover: (turn) => 1 + 0.11 * Math.cos(4 * turn),
  burst: (turn) => 1 + 0.08 * Math.cos(8 * turn),
  cloud: (turn) => 1 + 0.08 * Math.abs(Math.cos(3.5 * turn)),
  drop: (turn) =>
    (1 + 0.22 * Math.pow(Math.max(0, Math.cos(turn)), 6)) * (1 - 0.06 * Math.cos(turn)),
  gem: (turn) => 0.75 * gem(turn) + 0.25,
};

/**
 * The head outline for a Tot shape, or null for BoopFace's own round head.
 * Points run clockwise from the top centre; corners are softened so the shapes
 * stay as friendly as the default head.
 */
export function totHeadPoints(shape: TotShape | undefined): ReadonlyArray<HeadPoint> | null {
  if (shape === undefined || shape === "round") return null;
  const profile = PROFILES[shape];
  const raw = Array.from({ length: SAMPLES }, (_, i) => profile((i / SAMPLES) * 2 * Math.PI));
  const smooth = raw.map((_, i) => {
    let total = 0;
    for (let offset = -SMOOTHING; offset <= SMOOTHING; offset++) {
      total += raw[(i + offset + SAMPLES) % SAMPLES]!;
    }
    return total / (2 * SMOOTHING + 1);
  });
  const scale = TOP_RADIUS / smooth[0]!;
  return smooth.map((radius, i) => {
    const angle = -Math.PI / 2 + (i / SAMPLES) * 2 * Math.PI;
    return {
      x: CENTER + radius * scale * Math.cos(angle),
      y: CENTER + radius * scale * Math.sin(angle),
    };
  });
}

interface BoopFaceHead {
  _headShape?: { setAttribute(name: string, value: string): void };
  _baseHeadPoints?: Array<HeadPoint>;
  _baseHeadPathD?: string;
  _headFlattenedR32?: boolean;
  _pointsToPath?: (points: ReadonlyArray<HeadPoint>) => string;
}

const roundHeads = new WeakMap<object, { points: HeadPoint[]; path: string; flat: boolean }>();

/**
 * Gives a `<boop-face>` element a Tot shape. BoopFace 0.8 has no shape API, so
 * this rewrites the head points its own `setHeadRoundness` rewrites; drags,
 * squeezes and skins all follow them. Faces that never had a shape are untouched.
 */
export function applyTotHeadShape(element: object, shape: TotShape | undefined): void {
  const face = element as BoopFaceHead;
  if (!face._headShape || !face._pointsToPath || !face._baseHeadPoints) return;
  const points = totHeadPoints(shape);
  let round = roundHeads.get(element);
  if (points === null && round === undefined) return;
  if (round === undefined) {
    round = {
      points: face._baseHeadPoints.map((point) => ({ ...point })),
      path: face._baseHeadPathD ?? face._pointsToPath(face._baseHeadPoints),
      flat: face._headFlattenedR32 === true,
    };
    roundHeads.set(element, round);
  }
  face._baseHeadPoints = (points ?? round.points).map((point) => ({ ...point }));
  face._baseHeadPathD = points === null ? round.path : face._pointsToPath(face._baseHeadPoints);
  // Marks the head as already flattened so the antenna code leaves the shape alone.
  face._headFlattenedR32 = points === null ? round.flat : true;
  face._headShape.setAttribute("d", face._baseHeadPathD);
}

/** The same outline as an SVG path for a still face drawn in a 100 box. */
export function totStillHeadPath(shape: TotShape | undefined): string | null {
  const points = totHeadPoints(shape);
  if (points === null) return null;
  const toBox = (value: number) => (50 + (value - CENTER) * 0.44).toFixed(2);
  return `${points
    .map((point, i) => `${i === 0 ? "M" : "L"}${toBox(point.x)} ${toBox(point.y)}`)
    .join(" ")} Z`;
}
