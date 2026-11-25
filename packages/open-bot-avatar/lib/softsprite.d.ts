/**
 * The soft material as the source shader paints it: per-pixel subsurface scattering
 * over the body silhouette, ported 1:1 from the soft-shape fragment shader of the
 * Hark design study (WebGL → typed arrays, no DOM).
 *
 * The cross-section ramp in material.ts approximates the same physics per slice;
 * this module reproduces the actual look — a smooth falloff from the lit edge into
 * a deep saturated core, cloud-modulated penetration, dithered 16-tap key light —
 * as one cached sprite per (outline, colour, material). The canvas renderer draws
 * the sprite under the frame's 2D motion and paints the live eyes, ribbons and
 * marks over it, so every state and mood keeps working.
 *
 * Cost is paid once per geometry (signed-distance field + per-direction thickness)
 * and once per colour (the light integral); frames only drawImage.
 */
import type { Rgb } from './color.ts';
import type { SoftMaterial } from './material.ts';
export interface SoftSprite {
    /** Square edge in pixels; the sprite maps the 0 0 100 100 viewBox. */
    size: number;
    /** RGBA, premultiplied-free straight alpha, row-major from the top. */
    data: Uint8ClampedArray<ArrayBuffer>;
}
/** Sprite resolution: the look is low-frequency, 200px upscales cleanly to any avatar size. */
export declare const SPRITE_SIZE = 200;
/**
 * The soft-shape look of one body colour over one outline, as straight-alpha RGBA.
 * `lightAngle` follows the source shader (270 = key from the top in screen space).
 */
export declare function softSprite(d: string, color: Rgb, material?: SoftMaterial, size?: number, lightAngle?: number): SoftSprite;
