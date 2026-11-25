import type { Bounds } from '../../path.ts';
import type { Volume } from '../../volume.ts';
/** A state mark: a vertical capsule centered at the origin. */
export interface Capsule {
    bounds: Bounds;
    radius: number;
}
export type MaterialShape = Volume | Capsule;
/** Front-to-back half extent of a body or state mark. */
export declare function halfDepth(shape: MaterialShape): number;
