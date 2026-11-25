/**
 * Deterministic pose model. A pose is a pure function of (seed, time, state,
 * mood, gaze, reducedMotion): no wall clock, no Math.random, so any frame can
 * be reproduced exactly (tests, SSR, scrubbing).
 */
import type { AvatarMood, AvatarMotion, AvatarMotionBlend, AvatarState } from './types.ts';
/**
 * How the eyes are drawn, as numbers that blend: any two looks mix into a shape in between, so
 * the eyes morph from one to the other (see eyes.ts).
 */
export interface EyeLook {
    /** 0 = the plain pill, 1 = the happy arc. */
    arc: number;
    /** 0 = the plain pill, 1 = the flat slit of a waiting bot. Never more than `1 - arc`. */
    slit: number;
}
export interface Pose {
    /** View rotation in radians: yaw turns about the vertical axis, pitch about the horizontal. */
    yaw: number;
    pitch: number;
    /** In-plane rotation, degrees. */
    roll: number;
    /** Vertical offset (negative = up), viewBox units. */
    lift: number;
    /** Squash and stretch about the base of the body. */
    sx: number;
    sy: number;
    /** Eye look direction, -1..1 per axis. */
    gazeX: number;
    gazeY: number;
    /** 0 = open, 1 = fully closed. */
    blink: number;
    /** Extra lid narrowing per eye, 0..1. */
    squintL: number;
    squintR: number;
    eyes: EyeLook;
    /** Presence of the ribbons that circle the body: 0..1 draws them out and back in. */
    ribbons: number;
    /** Which layout the ribbons take: 0 a working turn's one hoop, 1 a celebration's cage of three. */
    cage: number;
    /**
     * How far the body's turn has carried the ribbons round, radians, signed and not wrapped: each
     * ribbon goes its own share of it, so a whole turn more does not put them back where they were.
     */
    sweep: number;
    /** How far the body has given way to a mark, 0..1 each: the exclamation mark and the three dots. */
    bang: number;
    dots: number;
}
/** Every state and mood, in the order hosts list them. */
export declare const STATES: readonly AvatarState[];
export declare const MOODS: readonly AvatarMood[];
export declare function isState(value: unknown): value is AvatarState;
export declare function isMood(value: unknown): value is AvatarMood;
/**
 * The state and mood to show. `motion` is the single option that came before them: `thinking`
 * is a state, `happy` a mood. An explicit `state` or `mood` wins over it.
 */
export declare function resolveLook(given: {
    state?: unknown;
    mood?: unknown;
    motion?: unknown;
}): {
    state: AvatarState;
    mood: AvatarMood;
};
/** Resting view: turned a little and seen a little from above, so the volume reads without dominating. */
export declare const BASE_YAW = -0.3;
export declare const BASE_PITCH = 0.2;
/**
 * Following a look target: the body turns toward it by up to these angles
 * (radians, at full deflection) and the eyes use this share of their small
 * range, so the whole character looks rather than the eyes sliding alone.
 */
export declare const LOOK_YAW = 0.32;
export declare const LOOK_PITCH = 0.18;
export declare const LOOK_EYES = 0.7;
export declare function hashString(s: string): number;
/** Stateless hash noise in [0, 1). */
export declare function noise(seed: number, n: number): number;
/** Blink closure 0..1: one blink per ~4.2 s slot at a seeded offset, sometimes a double blink. */
export declare function blinkAt(seed: number, t: number): number;
/** Idle eye wander: short holds between quick saccades, centered more often than not. */
export declare function wanderAt(seed: number, t: number): [number, number];
export interface PoseInput {
    seed: number;
    time: number;
    state?: AvatarState;
    mood?: AvatarMood;
    /** @deprecated Use `state` and `mood`; they win when given. */
    motion?: AvatarMotion;
    /** Seconds since `state` began: `done` celebrates from then on. Without it the state is at rest. */
    stateAge?: number;
    /** Look target, -1..1 per axis (x right, y down); `weight` 0..1 fades it in over the idle pose (default 1). */
    gaze?: {
        x: number;
        y: number;
        weight?: number;
    };
    reducedMotion: boolean;
    /** Extra view rotation in radians (e.g. from drag-to-turn), added to the resting view. */
    view?: {
        yaw: number;
        pitch: number;
    };
    /** Easing in from what was shown before (see blendPoses). */
    blend?: AvatarMotionBlend;
}
/**
 * Pose part way from `a` to `b`, both taken at the same moment so either side's motion keeps
 * running. Everything is a number, the eyes' look included, so eyes morph from one shape to the
 * next and a body gives way to a mark (and back) part by part.
 */
export declare function blendPoses(a: Pose, b: Pose, t: number): Pose;
export declare function computePose(input: PoseInput): Pose;
/**
 * Done celebrates in cycles, timed as PR #14 measured the Grok Bot demo: the ribbons go round
 * DONE_SWEEPS times while the body turns DONE_SWEEPS / 3 times (see celebration), then they draw
 * back in and the bot rests. DONE_TURN_S covers the turn and the drawing in. A cycle lasts
 * DONE_CYCLE_S or up to a seventh longer, differently for each avatar, so several done bots on a
 * page drift apart instead of turning together.
 */
export declare const DONE_TURN_S = 3.87;
export declare const DONE_CYCLE_S = 6.2;
