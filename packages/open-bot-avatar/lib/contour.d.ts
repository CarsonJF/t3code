/**
 * Iso-contours of a sampled scalar field (marching squares), assembled into
 * closed loops and simplified. Used once per definition to turn a part's
 * depth field into plain cross-section paths, so slices need no SVG masks.
 */
import type { Point } from './path.ts';
export interface Field {
    /** Row-major samples, nx * ny. The outermost ring should be below every level. */
    values: Float64Array;
    nx: number;
    ny: number;
    x0: number;
    y0: number;
    step: number;
}
/** Cells per run of a row that a caller of contourLoops can rule out at once (see `runsOf`). */
export declare const RUN = 8;
/** Runs in a row of cells of a field `nx` samples wide. */
export declare const runsOf: (nx: number) => number;
/**
 * Smallest and largest sample around each run of cells: over both rows of samples the run's cells
 * touch. A run whose values all lie on one side of a level has no crossing at that level.
 */
export declare function runRange(values: Float64Array, nx: number, ny: number): {
    min: Float64Array;
    max: Float64Array;
};
/**
 * Closed loops where the field crosses `level` (inside = value ≥ level). `flat` marks runs of
 * cells (RUN per row, row-major) that are known not to cross it; their samples are not read.
 */
export declare function contourLoops(field: Field, level: number, flat?: Uint8Array): Point[][];
/** The loops of contourLoops, each simplified as by simplifyLoop, without those left with under three points. */
export declare function contourOutlines(field: Field, level: number, tolerance: number, flat?: Uint8Array): Point[][];
/** Ramer-Douglas-Peucker on a closed loop. */
export declare function simplifyLoop(loop: Point[], tolerance: number): Point[];
/** simplifyLoop for a loop given as `n` points in `xy`, x and y in turn. */
export declare function simplifiedLoop(xy: Float64Array, n: number, tolerance: number): Point[];
/**
 * Compact closed path from loops (draw with fill-rule evenodd). Traced loops are polylines, so
 * gentle turns are drawn as quadratics between edge midpoints, which hides their facets at large
 * sizes; real corners stay sharp. Relative commands, smooth t segments and implicit repeats keep
 * the string short.
 */
export declare function loopsToPath(loops: Point[][]): string;
