import type { SoftMaterial } from '../../material.ts';
import type { CanvasMaterial } from './material.ts';
/**
 * The soft-shape subsurface finish (upstream PR #32) as a canvas material, tuned by `tuning`
 * (see SoftMaterial and the Hark roster). Needs a hex color and 2D canvas, no WebGL; elsewhere
 * the body draws as the frame's per-slice depth ramp. The body faces front in this finish.
 */
export declare function softMaterial(tuning?: SoftMaterial): CanvasMaterial;
/** Opt-in soft finish with the default tuning. */
export declare const soft: CanvasMaterial;
