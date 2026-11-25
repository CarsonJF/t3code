/**
 * The outline of one eye for any look. The plain pill, the happy arc and the flat slit of a
 * waiting bot are each walked as a closed outline from the top centre, clockwise, at even steps;
 * mixing them point by point gives every shape in between, so a change of state or mood morphs
 * the eyes instead of swapping them. The slit lies inside the room validation keeps for the arc.
 */
import type { EyeLook } from './motion.ts';
import type { Point } from './path.ts';
/** Where one eye is drawn this frame, in its face plane (viewBox units). */
export interface EyeSpot {
    /** Centre, gaze included. */
    x: number;
    y: number;
    /** Neutral size. */
    w: number;
    h: number;
    /** Height of the pill after blink and squint, and how far that moves it down. */
    open: number;
    shift: number;
}
/** Whether a look is exactly the plain pill or exactly the happy arc: those are drawn as before. */
export declare function plainLook(look: EyeLook): 'pill' | 'arc' | null;
/** The outline of one eye, closed, clockwise from the top: the pill, the arc and the slit mixed by the look. */
export declare function eyeOutline(look: EyeLook, e: EyeSpot): Point[];
/** A smooth closed path through an outline: a quadratic per point, joined at the midpoints. Absolute M, Q and Z only. */
export declare function outlinePath(pts: Point[]): string;
/** The path of one eye for a look that is neither the plain pill nor the plain arc. */
export declare function eyePath(look: EyeLook, e: EyeSpot): string;
