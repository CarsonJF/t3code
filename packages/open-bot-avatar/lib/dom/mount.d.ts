import type { AvatarDefinition, AvatarMaterial, AvatarMood, AvatarState } from '../types.ts';
export interface AvatarOptions {
    definition: AvatarDefinition;
    /** Body color: #rgb or #rrggbb, or any CSS color (e.g. var(--brand)). */
    color?: string;
    /** Eye color: #rgb or #rrggbb, or any CSS color. Defaults to a near-black ink. */
    eyeColor?: string;
    /**
     * The body's finish: 'flat' (default), or an imported material object.
     * Materials need canvas; the built-in fluffy and glass finishes also need WebGL2.
     * Import from open-bot-avatar/materials/fluffy, /materials/glass or /materials/soft (2D canvas only).
     */
    material?: AvatarMaterial;
    /** Volume amount 0..14 (6 = natural depth, 0 = flat). */
    depth?: number;
    /** What the bot is doing (default `idle`). Changes ease from what is on screen. */
    state?: AvatarState;
    /**
     * How the bot feels (default `neutral`): it shapes the eyes on top of any state. `idle` and
     * `thinking` are still accepted here from before `state` existed and mean those states.
     */
    mood?: AvatarMood | 'idle' | 'thinking';
    /** Eyes look and the body turns toward the mouse, pen or finger anywhere on the page. */
    followPointer?: boolean;
    /** Fixed look direction (-1..1 per axis, x right, y down). Wins over the pointer. */
    lookAt?: {
        x: number;
        y: number;
    } | null;
    /** Keep the current look as it is (e.g. while the user drags the view). */
    holdGaze?: boolean;
    /** Extra view rotation in radians on top of the resting view (e.g. drag-to-turn). */
    view?: {
        yaw: number;
        pitch: number;
    };
    /** true or false to force; 'system' (default) follows prefers-reduced-motion. */
    reducedMotion?: boolean | 'system';
    /** Render one fixed pose and never animate (thumbnails, lists): a static SVG, or for a material one painted canvas. */
    still?: boolean;
    /**
     * How a live avatar draws. 'canvas' (default) paints each frame to one canvas: one compositor layer
     * per avatar. 'scene' is a CSS 3D scene with a compositor layer per visible slice: more CPU and
     * layers, but less video memory for a single avatar several hundred pixels wide.
     */
    renderer?: 'canvas' | 'scene';
    /** Accessible name; defaults to the definition's name. "" marks the avatar decorative. */
    label?: string;
}
export interface MountedAvatar {
    /** Change any options; only what changed is redrawn. */
    update(options: Partial<AvatarOptions>): void;
    destroy(): void;
}
export declare function mountAvatar(host: HTMLElement, initial: AvatarOptions): MountedAvatar;
