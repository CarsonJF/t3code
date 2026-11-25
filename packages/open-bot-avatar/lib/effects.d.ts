import type { Bounds, Point } from './path.ts';
export interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
}
/** One piece of a ribbon: the part of it in front of the body, or the part behind. */
export interface RibbonPiece {
    d: string;
    front: boolean;
    box: Box;
    /**
     * Which ribbon the piece belongs to. In a celebration, 0..8: hoop `ribbon / LANES`, lane
     * `ribbon % LANES` (from the inner ring out). A working turn has one hoop with three to five
     * ribbons, numbered 0..4 from the inner ring out.
     */
    ribbon: number;
    /**
     * The stretch of its ribbon the piece covers, 0 (tail) to 1 (head), and the centre of the
     * ribbon at either end of that stretch, for a gradient along it. A ribbon comes in a few
     * stretches, each a little past the next where they meet so no seam shows.
     */
    along: [number, number];
    from: [number, number];
    to: [number, number];
}
/** Where a body's hoops are centred, and how far the body reaches from there (see rimOf). */
export interface Rim {
    cx: number;
    cy: number;
    at: (angle: number) => number;
    max: number;
}
export declare function rimOf(outlines: Point[][][], cx: number, cy: number): Rim;
export declare const LANES = 3;
export declare const HOOPS = 3;
/**
 * The radius of the farthest ring a ribbon can ride round a body whose outline reaches `rimMax`
 * from its centre at most, the widest a ribbon gets, and how far a ribbon reaches out from its
 * ring (half that). Widths are the same for every avatar; the rings follow its outline.
 */
export declare function ribbonReach(rimMax?: number): {
    radius: number;
    width: number;
    band: number;
};
/**
 * The ribbons at one moment, as filled outlines: round at both ends, a little narrower at the
 * tail than at the head and narrower behind the body, and split where a ribbon passes from
 * behind the body to in front of it. `presence` 0..1 draws them out and back in. `cage` picks
 * the layout: a working turn's 3 to 5 ribbons on one hoop (below 0.5), or a celebration's three
 * on each of three hoops. `sweep` (radians, signed) is how far the body's turn has carried
 * them; between turns they are not drawn. Each ribbon narrows where its hoop curves tighter than
 * half its width, so its outline never folds over itself. `rim` gives the hoops' centre (the
 * middle of the body's mass) and how far the body reaches from it along a direction: a working
 * turn's hoop stands just outside the body along its own direction; a celebration's three share
 * one radius, the largest any of them needs, so the cage stays round. Either way the ribbons pass
 * behind the body only off its outline.
 */
export declare function ribbonPieces(b: Bounds, presence: number, seed: number, _time: number, sweep?: number, cage?: number, rim?: Rim): RibbonPiece[];
/** One part of a mark: a fixed outline about its own centre, and where that centre is this frame. */
export interface MarkPart {
    /** Stable name of the outline, e.g. "dot". */
    shape: string;
    d: string;
    box: Box;
    /** Centre, viewBox units, then a rotation about the mark's centre (radians) and a scale about the part's own. */
    x: number;
    y: number;
    turn: number;
    scale: number;
}
/**
 * The parts of the marks at one moment. `bang` and `dots` 0..1 are how far the body has given
 * way to each (see Pose): a mark grows in as the body goes, from the body's centre.
 * The dots take turns hopping; the exclamation mark jumps and shakes every couple of seconds.
 */
export declare function markParts(b: Bounds, bang: number, dots: number, seed: number, time: number, still: boolean): MarkPart[];
/** How much of its size the body keeps while it gives way to a mark: gone a little past half way. */
export declare function bodyScale(bang: number, dots: number): number;
