/**
 * Material eyes are beads seated in sockets on the body. A socket follows its eye's
 * contour through every shape the eye takes, so the shader reads the contour as a small
 * distance field: one square tile per eye, re-made only when the contour changes.
 */
import type { EyeMark } from '../../render.ts';
/** Width and height of a tile, pixels. */
export declare const SOCKET_TILE = 96;
/** How far around an eye the coat is pressed down, viewBox units. Also the range of the distance field. */
export declare const SOCKET_PAD = 3.8;
/** The share of a bead's height that shows: an open bead is partly buried, a shallower expression keeps its arc. */
export declare function exposedHeight(w: number, h: number): number;
/** Where a socket sits around its eye: the eye's center and size, and the width of the square its tile covers. */
export interface SocketRegion {
    cx: number;
    cy: number;
    w: number;
    h: number;
    span: number;
}
export declare function socketRegion(mark: EyeMark): SocketRegion;
/**
 * What a tile depends on: the eye's contour, wherever it is. A pill is the same contour at both
 * eyes; other marks are outlines in face coordinates, one per eye.
 */
export declare function socketKey(mark: EyeMark): string;
/**
 * Signed distance to the eye's seated contour, in units of 2 × SOCKET_PAD around 0.5 (inside is
 * below), one byte per pixel. `ctx` is a scratch canvas of SOCKET_TILE pixels.
 */
export declare function socketTile(ctx: CanvasRenderingContext2D, mark: EyeMark): Uint8Array<ArrayBuffer>;
