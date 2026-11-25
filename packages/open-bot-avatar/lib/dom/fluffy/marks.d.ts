/**
 * The marks of `thinking` and `blocked` in fluffy: each dot or bar is a small pompom, rendered
 * once per shape, color and size and kept as a sprite, since the three dots and both parts of
 * the exclamation mark only ever move, squash and fade.
 */
import { type FramePath } from '../../render.ts';
/**
 * Paint a mark face-on as a fluffy ball or capsule filling `box`, under the context's transform
 * (which animates it). `scale` is device pixels per viewBox unit. False where fluffy can't be
 * drawn: the caller fills the mark's path instead.
 */
export declare function paintFluffyMark(ctx: CanvasRenderingContext2D, box: FramePath['box'], scale: number, color: string): boolean;
