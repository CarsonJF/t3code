import type { AvatarMood, AvatarMotion, AvatarMotionBlend, AvatarState } from './types.ts';
export interface AnimatorInput {
    /** Wall clock, ms (e.g. performance.now()). Easing runs on it even when the animation clock stops. */
    now: number;
    state?: AvatarState;
    mood?: AvatarMood;
    /** @deprecated Use `state` and `mood`; they win when given. */
    motion?: AvatarMotion;
    /** Look target, -1..1 per axis (x right, y down), e.g. from pointerGaze; null eases back to rest. */
    target: {
        x: number;
        y: number;
    } | null;
    /** Keep the current look as it is (e.g. while the user drags the view). */
    hold?: boolean;
    /** Snap instead of easing. */
    reducedMotion: boolean;
}
export interface AnimatorStep {
    gaze?: {
        x: number;
        y: number;
        weight: number;
    };
    motionBlend?: AvatarMotionBlend;
    /** Seconds since the state began (a change of mood alone does not restart it). */
    stateAge: number;
    /** True while the look or a change of state or mood is still easing. */
    moving: boolean;
}
export interface Animator {
    step(input: AnimatorInput): AnimatorStep;
    /** Back to rest with no history, e.g. when the avatar is remounted. */
    reset(): void;
}
export declare function createAnimator(): Animator;
