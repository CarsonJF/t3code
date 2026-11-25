/**
 * Distance from points to the nearest edge of a set of polygons.
 *
 * Every answer here is the smallest value of one expression (the squared distance to a segment,
 * `segDist2`) over all edges, then its square root. A minimum does not depend on the order or the
 * number of values it is taken over, as long as the smallest one is among them. So the index may
 * skip any edge it can prove is farther than the nearest, and still return the same bits a pass
 * over every edge would. All the proofs below keep a margin (SLACK) far wider than rounding error
 * and far narrower than anything it could cost.
 */
import type { Bounds, Point } from './path.ts';
import type { EdgeBands } from './path.ts';
export declare function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number;
/** A regular grid of sample points: x0 + i * step, y0 + j * step. */
export interface SampleGrid {
    x0: number;
    y0: number;
    step: number;
    nx: number;
    ny: number;
}
/**
 * Edges bucketed on a coarse grid, for nearest-edge queries that only visit edges that can matter.
 * The grid is dense and CELL units to a bucket: made for outlines in the 0..100 viewBox.
 */
export declare class EdgeIndex {
    /** ax, ay, dx, dy, dx² + dy² per edge: the terms of segDist2 that do not depend on the point. */
    private readonly e;
    private readonly start;
    private readonly items;
    private readonly ox;
    private readonly oy;
    private readonly span;
    private readonly count;
    /** The last survey's vector to the nearest point of all. */
    private bx;
    private by;
    private x0;
    private y0;
    private step;
    private nx;
    constructor(polys: Point[][], b: Bounds);
    /** Makes the shared scratch large enough for a walk over this index's edges. */
    private ready;
    private cx;
    private cy;
    /** Distance to the nearest edge, searching rings of buckets outward until no closer edge can exist. */
    distance(x: number, y: number): number;
    /** Distance to the nearest edge at every sample of a grid, row-major. */
    distances(g: SampleGrid): Float64Array;
    /**
     * The largest distance to the nearest edge over the grid's samples that are inside the fill
     * (`insideRow` of each sample's row), or 0 if none is. Same as the largest inside value of
     * `distances`, but most of the grid is ruled out without being measured.
     */
    widest(g: SampleGrid, rows: EdgeBands): number;
    /** Lists every edge with a point in the square of `reach` around (x, y) at the start of `lists`. */
    private collect;
    /** Squared distance from (x, y) to the nearest of the edges `lists[lo..hi)`. */
    private nearest;
    /** `nearest`, keeping for `narrow` each edge's squared distance and the vector to its nearest point. */
    private survey;
    /**
     * After a survey of `lists[lo..hi)` from a point at distance `d` from the nearest edge: lists,
     * from `hi` on, the edges that can be nearest to some point within `radius` of it. Returns the
     * end of that list.
     *
     * An edge nearest to such a point p is no farther from p than the surveyed point's nearest point
     * n is. With u and w the unit directions from n and from the edge's nearest point to the
     * surveyed point m, and v = p - m, that gives D + w·v ≤ |p - n| ≤ d + u·v + |v|² / 2d. So the
     * edge's distance D from m exceeds d by at most |u - w| r + r² / 2d, and never by more than 2r.
     */
    private narrow;
    /**
     * Measures the samples i0..i1 × j0..j1 into `out`. `lists[lo..hi)` holds every edge that is
     * nearest to some point of the block. The block's middle sample is measured against all of
     * them; that rules most of them out for the rest of the block, and each quarter goes on with
     * the shorter list.
     */
    private fill;
    /**
     * `fill` for `widest`: returns the larger of `best` and the largest distance of an inside sample
     * of the block, skipping blocks that cannot hold one. `whole`: the block is known to be inside.
     */
    private peak;
}
