/**
 * The fluffy renderer: draws a body as a lit coat of fur with the eyes seated in it. Every fluffy
 * avatar on the page shares one WebGL2 context (browsers allow only a handful), which renders one
 * avatar at a time into its own canvas; the 2D painter copies that image into the avatar's canvas
 * (see paint.ts), under the ribbons and marks it draws itself.
 *
 * A frame is three kinds of draw over the same mesh: the solid body, a few shells of pile lifted
 * off it, and the single strands (see shaders.ts). Meshes are built once per shape and kept on
 * the GPU while their avatars keep painting, so a page of avatars only pays for drawing, and a
 * small avatar draws less of each (see fluffyDetail).
 */
import type { SurfaceEye, ViewBasis } from '../../render.ts';
import { type FluffyShape } from './mesh.ts';
/** The colors of a coat and the eyes set into it (none for a state mark). */
export interface FluffyLook {
    /** Body color, any CSS color. */
    color: string;
    /** Eye color, any CSS color. */
    ink: string;
    /** Up to two eyes, left first. */
    eyes: SurfaceEye[];
}
/** A rendered coat. It lasts until the next render: draw or copy it at once. */
export interface FluffyImage {
    /** The renderer's canvas, which may be larger than the image. */
    canvas: HTMLCanvasElement;
    /** The image's square in the canvas, pixels: `size` to the right of and below (x, y). */
    x: number;
    y: number;
    size: number;
    /** The square the image covers, viewBox units: `radius` to each side of (cx, cy). */
    cx: number;
    cy: number;
    radius: number;
}
/**
 * How much of a coat to draw at `scale` pixels per viewBox unit. A small avatar gets fewer shells,
 * the unrefined triangles around its eyes, and a share of its strands (`strandPasses` of the
 * mesh's ROOT_PASSES), each widened by as much as there are fewer, so they cover the same. The
 * image averages out to the same coat at half to two thirds of the cost.
 */
export declare function fluffyDetail(scale: number): {
    shells: number;
    strandPasses: number;
    fineSockets: boolean;
};
/**
 * Render `shape` under `view` at `scale` pixels per viewBox unit. Null where fluffy can't be
 * drawn (no WebGL2, or its context is lost): the caller paints flat instead.
 */
export declare function renderFluffy(shape: FluffyShape, view: ViewBasis, look: FluffyLook, scale: number): FluffyImage | null;
