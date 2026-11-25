/** An eye mark on a 2D canvas: its bounds, and its paint. Shared by the flat painter and the fluffy sockets. */
import type { EyeMark, FramePath } from '../render.ts';
export declare function eyeBox(mark: EyeMark): FramePath['box'];
/** Fill or stroke the mark in the context's current styles. */
export declare function paintEye(ctx: CanvasRenderingContext2D, mark: EyeMark): void;
