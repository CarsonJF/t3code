/**
 * The marks of `thinking` and `blocked` in glass: each dot or bar is a glossy glass bead/capsule,
 * rendered once per shape, color and size and kept as a sprite.
 */
import { viewBasis } from '../../render.js';
import { renderGlass } from './renderer.js';
const RADIUS = 12;
const FRONT = viewBasis(0, 0);
const HEADROOM = 1.12;
const models = new Map();
const sprites = new Map();
export function paintGlassMark(ctx, box, scale, color) {
    const aspect = Math.round((1000 * box.h) / box.w) / 1000;
    let model = models.get(aspect);
    if (!model) {
        const halfHeight = RADIUS * aspect;
        model = { radius: RADIUS, bounds: { minX: -RADIUS, maxX: RADIUS, minY: -halfHeight, maxY: halfHeight } };
        models.set(aspect, model);
    }
    const unit = box.w / (2 * RADIUS);
    const density = Math.min(8, Math.max(0.5, 2 ** Math.ceil(Math.log2(HEADROOM * scale * unit))));
    const key = `${aspect}|${color}|${density}`;
    let sprite = sprites.get(key);
    if (!sprite) {
        const image = renderGlass(model, FRONT, { color, ink: color, eyes: [] }, density);
        if (!image)
            return false;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = image.size;
        const copy = canvas.getContext('2d');
        if (!copy)
            return false;
        copy.drawImage(image.canvas, image.x, image.y, image.size, image.size, 0, 0, image.size, image.size);
        sprite = { canvas, radius: image.radius };
        if (sprites.size >= 12)
            sprites.delete(sprites.keys().next().value);
        sprites.set(key, sprite);
    }
    const radius = sprite.radius * unit;
    ctx.drawImage(sprite.canvas, -radius, -radius, 2 * radius, 2 * radius);
    return true;
}
