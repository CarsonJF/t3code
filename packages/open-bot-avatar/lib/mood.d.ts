/**
 * Changes of state and mood as pure functions a frame loop steps: the pose
 * eases from what is on screen into the new state and mood (see blendPoses in
 * motion.ts), and a change during a change continues from where it is.
 */
import type { AvatarMood, AvatarMotion, AvatarMotionBlend, AvatarState } from './types.ts';
/** Length of a mood change, ms. */
export declare const MOOD_MS = 420;
/** Eased progress of a mood change from elapsed time (smoothstep, clamped). */
export declare function moodProgress(elapsedMs: number): number;
/** A state and mood on screen, possibly still easing in over what came before. */
export interface MoodState {
    state?: AvatarState;
    mood?: AvatarMood;
    /** @deprecated Use `state` and `mood`. */
    motion?: AvatarMotion;
    /** Seconds the state had been showing when the next change began. */
    age?: number;
    blend?: AvatarMotionBlend;
}
/**
 * What a new mood change eases in from: the mood on screen with any change
 * still under way frozen at its progress, so the pose continues from exactly
 * where it is. Older changes whose share has all but faded (or beyond a few
 * levels) are dropped, so rapid clicking never grows the chain.
 */
export declare function settleMood(state: MoodState, share?: number, depth?: number): MoodState;
