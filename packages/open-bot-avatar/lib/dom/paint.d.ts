import type { AvatarFrame, Matrix } from '../render.ts';
import type { AvatarDefinition, AvatarMaterial } from '../types.ts';
import type { Volume } from '../volume.ts';
/** A square in viewBox units. */
export interface Square {
    x: number;
    y: number;
    size: number;
}
/** An axis-aligned box in viewBox units; empty when x0 > x1. */
export interface Bounds {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}
/** Slack around a frame's bounds when the bitmap is laid out, viewBox units: idle motion and gaze stay inside it. */
export declare const FIT_SLACK = 8;
/** Margin a frame keeps from the bitmap's edge for antialiasing, viewBox units. */
export declare const FIT_PAD = 1;
/**
 * The square to lay the bitmap out over: `prev` while it still holds `b`, else `prev` grown to
 * hold `b` with slack. Never larger than `cap` unless `b` itself leaves `cap`.
 */
export declare function fitSquare(prev: Square | null, b: Bounds, cap: Square): Square;
/** Whether this environment can paint avatars: a 2D canvas and Path2D (jsdom has neither). */
export declare function canvasSupported(): boolean;
/**
 * Each shape's matrix with the frame's root motion applied, and the bounds of everything the frame
 * paints, in viewBox units. Pure.
 */
export declare function framePlacement(frame: AvatarFrame): {
    matrices: Matrix[];
    bounds: Bounds;
};
/** A mounted canvas and the square and size its bitmap was last laid out at. */
export interface CanvasSurface {
    key: string;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D | null;
    /** The avatar's volume, for a fluffy coat: built when first asked for. Null at depth 0, which has no surface to coat. */
    volume: (() => Volume) | null;
    cap: Square;
    fit: Square | null;
    layout: string;
    left: number;
    top: number;
}
export declare function mountCanvas(el: HTMLElement, key: string, definition: AvatarDefinition, depth: number | undefined): CanvasSurface;
/**
 * Paint one frame `size` CSS pixels wide. `fill` and `ink` override the frame's colors with any
 * canvas color. A `fluffy` body falls back to flat where fluffy can't be drawn.
 */
export declare function paintCanvas(surface: CanvasSurface, frame: AvatarFrame, size: number, fill?: string, ink?: string, material?: AvatarMaterial): void;
