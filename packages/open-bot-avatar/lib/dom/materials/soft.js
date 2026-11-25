import { parseHex } from '../../color.js';
import { softSprite } from '../../softsprite.js';
/** Offscreen sprites of soft bodies, one per outline + colour + tuning. */
const sprites = new Map();
const MAX_SPRITES = 96;
function softImage(outline, color, tuning) {
    const rgb = parseHex(color);
    if (!rgb || typeof document === 'undefined' || typeof ImageData === 'undefined')
        return null;
    const key = `${outline}|${color}|${JSON.stringify(tuning)}`;
    let image = sprites.get(key);
    if (!image) {
        const sprite = softSprite(outline, rgb, tuning);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = sprite.size;
        const ctx = canvas.getContext('2d');
        if (!ctx)
            return null;
        ctx.putImageData(new ImageData(sprite.data, sprite.size, sprite.size), 0, 0);
        if (sprites.size >= MAX_SPRITES)
            sprites.clear();
        // The sprite maps the whole 0 0 100 100 viewBox; the live eyes are painted over it.
        image = { canvas, x: 0, y: 0, size: sprite.size, cx: 50, cy: 50, radius: 50, eyes: false };
        sprites.set(key, image);
    }
    return image;
}
/**
 * The soft-shape subsurface finish (upstream PR #32) as a canvas material, tuned by `tuning`
 * (see SoftMaterial and the Hark roster). Needs a hex color and 2D canvas, no WebGL; elsewhere
 * the body draws as the frame's per-slice depth ramp. The body faces front in this finish.
 */
export function softMaterial(tuning = {}) {
    return {
        id: 'soft',
        frame: { soft: tuning },
        render: (_shape, _view, look, _scale, outline) => softImage(outline, look.color, tuning),
    };
}
/** Opt-in soft finish with the default tuning. */
export const soft = softMaterial();
