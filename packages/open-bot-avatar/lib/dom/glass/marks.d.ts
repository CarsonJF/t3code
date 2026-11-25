/**
 * The marks of `thinking` and `blocked` in glass: each dot or bar is a glossy glass bead/capsule,
 * rendered once per shape, color and size and kept as a sprite.
 */
import { type FramePath } from '../../render.ts';
export declare function paintGlassMark(ctx: CanvasRenderingContext2D, box: FramePath['box'], scale: number, color: string): boolean;
