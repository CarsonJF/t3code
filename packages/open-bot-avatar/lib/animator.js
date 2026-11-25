/**
 * The per-avatar state a live renderer keeps between frames, independent of
 * any platform: the eased look toward a target (follow.ts) and the eased
 * change between states and moods (mood.ts). Feed it once per frame; it
 * returns the `gaze`, `motionBlend` and `stateAge` render options for that
 * frame and whether it is still easing.
 */
import { REST, followGaze, followStep } from './follow.js';
import { DONE_TURN_S, resolveLook } from './motion.js';
import { moodProgress, settleMood } from './mood.js';
export function createAnimator() {
    let follow = REST;
    let last = null;
    // What is on screen, when its change began and when its state began.
    let shown = null;
    return {
        step({ now, target, hold = false, reducedMotion, ...given }) {
            const dt = last === null ? 0 : (now - last) / 1000;
            last = now;
            let moving = false;
            if (!hold)
                ({ state: follow, moving } = followStep(follow, target, dt, reducedMotion));
            // A new state or mood eases in from the pose on screen (a change under way included); reduced motion switches at once.
            const { state, mood } = resolveLook(given);
            if (shown && (state !== shown.state || mood !== shown.mood)) {
                const before = {
                    state: shown.state,
                    mood: shown.mood,
                    age: (now - shown.began) / 1000,
                    blend: shown.blend && { from: shown.blend.from, t: moodProgress(now - shown.since) },
                };
                shown = {
                    state,
                    mood,
                    blend: reducedMotion ? undefined : { from: settleMood(before), t: 0 },
                    since: now,
                    began: state === shown.state ? shown.began : now,
                };
            }
            // An avatar that mounts done starts it at rest, as if it had just finished celebrating; any
            // other state starts afresh (a working bot's first sweep comes a second or two in).
            shown ??= { state, mood, since: now, began: now - (state === 'done' ? DONE_TURN_S * 1000 : 0) };
            const t = reducedMotion ? 1 : moodProgress(now - shown.since);
            let motionBlend;
            if (shown.blend && t < 1)
                motionBlend = { from: shown.blend.from, t };
            else
                shown.blend = undefined;
            return { gaze: followGaze(follow), motionBlend, stateAge: (now - shown.began) / 1000, moving: moving || motionBlend !== undefined };
        },
        reset() {
            follow = REST;
            last = null;
            shown = null;
        },
    };
}
