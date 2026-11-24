import { type Bounds } from '../../path.ts';
import type { Volume } from '../../volume.ts';
export interface FluffyMesh {
    /** Position and outward normal per vertex (6 floats). */
    vertices: Float32Array;
    /** The triangles twice: as the grid gives them, then with those around the eyes refined. */
    indices: Uint32Array;
    /** Where each set sits in `indices`. A small avatar is drawn from the coarse one. */
    coarse: IndexRange;
    fine: IndexRange;
    /**
     * Hair roots, independent of the triangles: position, normal and two random numbers (8 floats).
     * Stored in ROOT_PASSES passes over the surface, so the first few passes are an even share of
     * the coat (see rootsIn).
     */
    roots: Float32Array;
}
export interface IndexRange {
    start: number;
    count: number;
}
/** A state mark: a vertical capsule centered at the origin. Equal width and height give a ball. */
export interface Capsule {
    bounds: Bounds;
    radius: number;
}
export type FluffyShape = Volume | Capsule;
/** Front-to-back half extent of a shape, viewBox units. */
export declare function halfDepth(shape: FluffyShape): number;
/**
 * The roots are stored in this many passes over the surface, each taking every ROOT_PASSES-th
 * root. Each pass runs along the surface, which draws faster than roots in random order.
 */
export declare const ROOT_PASSES = 8;
/** How many of `total` roots the first `passes` passes hold. */
export declare function rootsIn(total: number, passes: number): number;
export declare function buildMesh(shape: FluffyShape): FluffyMesh;
