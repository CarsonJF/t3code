/**
 * Renderers for a validated silhouette + eye placement with implied volume
 * (see volume.ts). One flat body color, two plain dark eyes; no gradients,
 * gloss, rim light or shadows. Output is built only from numbers and the
 * renderer's own markup.
 *
 * - avatarFrame: one frame flattened to plain data (paths, matrices, eyes),
 *   for any vector renderer.
 * - renderAvatarSvg: a standalone still, serialized from avatarFrame. Cross-sections of the stack that
 *   faces the viewer are projected orthographically and painted back to front.
 * - renderAvatarScene + sceneFrame: a CSS 3D scene. Every cross-section is its
 *   own small SVG placed once with a 3D transform; animating, turning and
 *   recoloring only change a few CSS transforms, and the browser's compositor
 *   does projection and occlusion. Each visible slice costs a compositor layer,
 *   so mountAvatar paints live avatars to one canvas by default and only uses
 *   the scene with `renderer: 'scene'`.
 *
 * A state can draw more than the body (see effects.ts): ribbons behind and in front of it, and
 * the marks a thinking or blocked bot turns into. Those stay where they are while the body hops
 * and rolls.
 */
import { mix, oklch, parseHex, toHex, toOklch } from './color.js';
import { bodyScale, markParts, ribbonPieces, ribbonReach, rimOf } from './effects.js';
import { eyePath, plainLook } from './eyes.js';
import { computePose, hashString, noise } from './motion.js';
import { EYE_H, EYE_W, GAZE_X, GAZE_Y, HAPPY_ARC, analyzeBody, eyeCenters, gazeRange, validateAvatar } from './validate.js';
import { buildVolume } from './volume.js';
export const DEFAULT_COLOR = '#ff6a1a';
export const DEFAULT_EYE_COLOR = '#151515';
/** `depth` option value that maps to the natural inferred volume. */
export const DEFAULT_DEPTH = 6;
const MAX_DEPTH = 14;
/**
 * CSS eyes sit this far above the surface so they never touch the body planes. iOS WebKit treats planes
 * closer than about a pixel as one and may draw the body over an eye (0.3 did: a band of the
 * barbell's bar through one eye), so the gap is a few pixels at the stage's size. Turned, an eye
 * drifts lift × sin(angle) from its spot: under half a unit at rest, about one at 45°.
 */
const CSS_EYE_LIFT = 1.5;
const cache = new Map();
const f = (n) => {
    const r = Math.round(n * 100) / 100;
    return (Object.is(r, -0) ? 0 : r).toString();
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function depthOption(options) {
    const d = clamp(Number.isFinite(options.depth) ? options.depth : DEFAULT_DEPTH, 0, MAX_DEPTH);
    return Math.round(d * 2) / 2;
}
const lazy = (make) => {
    let value;
    return () => (value ??= make());
};
/**
 * How far the body reaches from the middle of its box, for a working turn's hoop and for a
 * celebration's cage. The hoops' centre hops and stretches with the body (see ribbonsFollow) but
 * does not lean or sway with it, so each is measured over the leans its state takes, the body
 * stretched about the centre: a working bot leans 2.4° to 6.6° and squashes to 98%; a celebrating
 * one sways ±1.7° and stretches up to 5.5%. The hoops stand just outside that, so the body never
 * moves through a point where a ribbon passes behind it.
 */
export function ribbonRims(polys, b) {
    const [cx, cy] = pivotOf(b);
    const bx = (b.minX + b.maxX) / 2, by = b.maxY;
    /** The body leaned by each of `rolls` (degrees, about its base) and stretched by each of `sys` about the centre. */
    const posed = (rolls, sys) => {
        const out = [];
        for (const roll of rolls) {
            const r = (roll * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r);
            for (const k of sys) {
                out.push(polys.map((poly) => poly.map(([x, y]) => {
                    const lx = bx + c * (x - bx) - sn * (y - by), ly = by + sn * (x - bx) + c * (y - by);
                    return [cx + 1.01 * (lx - cx), cy + k * (ly - cy)];
                })));
            }
        }
        return out;
    };
    return { work: rimOf(posed([2.4, 4.5, 6.6], [0.98, 1]), cx, cy), cage: rimOf(posed([-1.7, 0, 1.7], [0.99, 1.055]), cx, cy) };
}
/**
 * The rim moved to where the hoops' centre is in this pose: it hops and stretches with the body
 * (the root motion's lift and scale about the base) but does not lean or sway with it.
 */
export function ribbonsFollow(rim, pose, b) {
    const bx = (b.minX + b.maxX) / 2, by = b.maxY;
    return { ...rim, cx: bx + pose.sx * (rim.cx - bx), cy: by + pose.sy * (rim.cy - by) + pose.lift };
}
function prepare(definition, depth) {
    const key = JSON.stringify([definition?.id, definition?.name, definition?.body?.path, definition?.eyes, depth]);
    const hit = cache.get(key);
    if (hit)
        return hit;
    const res = validateAvatar(definition);
    if (!res.ok)
        throw new Error(`Invalid avatar definition: ${res.errors.join('; ')}`);
    const def = res.value;
    const body = analyzeBody(def.body.path);
    const vol = buildVolume(def, depth / DEFAULT_DEPTH, body);
    const id = `oba-${hashString(`${def.id}|${def.body.path}|${depth}`).toString(36)}`;
    const ids = new Map();
    for (const part of vol.parts)
        for (const s of [...part.zSlices, ...part.xSlices])
            if (!ids.has(s.d))
                ids.set(s.d, `${id}-${ids.size}`);
    const prepared = {
        def,
        vol,
        range: gazeRange(body.polys, { ...def.eyes, scale: vol.eyeScale }),
        seed: hashString(def.id),
        id,
        ids,
        detail: new Map(),
        rims: lazy(() => ribbonRims(body.polys, vol.bounds)),
    };
    if (cache.size >= 64)
        cache.delete(cache.keys().next().value);
    cache.set(key, prepared);
    return prepared;
}
/** The validated definition and its cached volume, exactly as the renderers use them. Throws if invalid. */
export function preparedVolume(definition, depth) {
    const p = prepare(definition, depthOption({ depth }));
    return { def: p.def, vol: p.vol };
}
function poseOf(p, options) {
    return computePose({
        seed: p.seed,
        time: Number.isFinite(options.time) ? options.time : 0,
        state: options.state,
        mood: options.mood,
        motion: options.motion,
        stateAge: options.stateAge,
        gaze: options.gaze,
        reducedMotion: options.reducedMotion === true,
        view: options.view,
        blend: options.motionBlend,
    });
}
function esc(s) {
    return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
const mul = (m, n) => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const translate = (x, y) => [1, 0, 0, 1, x, y];
const about = (x, y, m) => mul(translate(x, y), mul(m, translate(-x, -y)));
const invert = ([a, b, c, d, e, g]) => {
    const det = a * d - b * c;
    return [d / det, -b / det, -c / det, a / det, (c * g - d * e) / det, (b * e - a * g) / det];
};
const mat = (m) => `matrix(${m.map((v, i) => (i < 4 ? (Math.round(v * 10000) / 10000).toString() : f(v))).join(' ')})`;
export function viewBasis(yaw, pitch) {
    const cY = Math.cos(yaw), cP = Math.cos(pitch);
    return { cY, sY: Math.sin(yaw), cP, sP: Math.sin(pitch), facing: cY * cP };
}
/** Toward-viewer component of a model-space direction under this view (1 = straight at the viewer). */
export function facingOf(v, [x, y, z]) {
    return v.sP * y + v.cP * (-v.sY * x + v.cY * z);
}
/** The signed projected area of a unit of eye plane goes to zero at the limb. */
function eyeVisible(v, plane) {
    return facingOf(v, [-plane.dzdx, -plane.dzdy, 1]) > 1e-6;
}
function eyeMatrix(v, { x, y, z, dzdx, dzdy }, pivot) {
    const m = planeMatrix(v, z - x * dzdx - y * dzdy, pivot);
    m[0] += v.sY * dzdx;
    m[1] -= v.cY * v.sP * dzdx;
    m[2] += v.sY * dzdy;
    m[3] -= v.cY * v.sP * dzdy;
    return m;
}
/** Which slice stack faces the viewer more: front-facing z-planes or side-facing x-planes. */
export function activeStack(v) {
    return Math.abs(v.cY) >= Math.abs(v.sY) ? 'z' : 'x';
}
/**
 * Orthographic projection of the plane at depth z, pivoting on `pivot` at z = 0.
 * Yaw turns about the vertical axis, then pitch tips about the horizontal axis.
 */
export function planeMatrix(v, z, pivot) {
    const [cx, cy] = pivot;
    return [
        v.cY, v.sY * v.sP, 0, v.cP,
        cx - v.cY * cx + v.sY * z,
        cy - v.cP * cy - v.sY * v.sP * cx - v.cY * v.sP * z,
    ];
}
/** Projection of the side plane x = x0, whose local coordinates are (u = -z, y). */
export function sidePlaneMatrix(v, x0, pivot) {
    const [cx, cy] = pivot;
    return [-v.sY, v.cY * v.sP, 0, v.cP, cx + v.cY * (x0 - cx), cy - v.cP * cy + v.sY * v.sP * (x0 - cx)];
}
/** Project a 3D point: screen x, screen y and depth toward the viewer. */
export function projectPoint(v, [x, y, z], pivot) {
    const m = planeMatrix(v, z, pivot);
    const X = x - pivot[0], Y = y - pivot[1];
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5], v.sP * Y + v.cP * (-v.sY * X + v.cY * z)];
}
function rootMatrix(pose, b) {
    const bx = (b.minX + b.maxX) / 2, by = b.maxY;
    const r = (pose.roll * Math.PI) / 180;
    const rot = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
    return mul(translate(0, pose.lift), about(bx, by, mul(rot, [pose.sx, 0, 0, pose.sy, 0, 0])));
}
const pivotOf = (b) => [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
/** The hop and the share of a point's distance from the base that roll and squash can move it. */
const POSE_LIFT = 4;
const POSE_SWAY = 0.2;
/**
 * A square of viewBox units that holds the avatar at every view and pose. Throws if invalid. The
 * canvas renderer uses it only as an upper bound: it sizes each bitmap to what is actually painted.
 */
export function avatarExtent(definition, depth) {
    const p = prepare(definition, depthOption({ depth }));
    const { vol } = p;
    const b = vol.bounds;
    const [cx, cy] = pivotOf(b);
    const radius = Math.hypot(b.maxX - b.minX, b.maxY - b.minY, Math.max(...vol.parts.map((part) => part.depth)) + 2 * CSS_EYE_LIFT) / 2;
    // Ribbons reach their hoop plus their band from the middle of the body's box, and keep the
    // canvas's antialiasing margin (FIT_PAD) inside.
    const { work, cage } = p.rims();
    // The hoops' centre also hops and stretches with the body: as far as the body's own pose moves it.
    const reach = (rim) => {
        const r = ribbonReach(rim.max);
        return Math.hypot(rim.cx - cx, rim.cy - cy) + POSE_LIFT + POSE_SWAY * Math.abs(b.maxY - rim.cy) + r.radius + r.band + 1.2;
    };
    const half = Math.max(radius + POSE_LIFT + POSE_SWAY * (radius + b.maxY - cy), reach(work), reach(cage));
    return { x: cx - half, y: cy - half, size: 2 * half };
}
/**
 * Every cross-section a view draws, with its projection: the stack facing the
 * viewer, minus z-slices hidden behind the core (they add nothing to the
 * silhouette or the paint). Their union is the silhouette on screen.
 */
function drawnSlices(p, v, size, visit) {
    const { vol } = p;
    const stack = activeStack(v);
    const pivot = pivotOf(vol.bounds);
    const drawn = sliceCull(v);
    const kept = sliceDetail(p, stack, size);
    let k = 0;
    vol.parts.forEach((part, i) => {
        (stack === 'z' ? part.zSlices : part.xSlices).forEach((s, j) => {
            if (!kept[k++] || !drawn(s))
                return;
            visit(s, stack === 'z' ? planeMatrix(v, s.at, pivot) : sidePlaneMatrix(v, s.at, pivot), i, j);
        });
    });
}
/** Whether a slice of the active stack shows: z-slices hidden behind the core are skipped. */
function sliceCull(v) {
    // Screen shift per unit of depth, and the smallest on-screen size of an in-plane inset.
    const sweep = Math.hypot(v.sY, v.cY * v.sP);
    const inset = Math.min(Math.abs(v.cY), Math.abs(v.cP));
    return (s) => s.axis !== 'z' || s.inset <= 0 || Math.abs(s.at) * sweep > s.inset * inset;
}
function eyeStates(p, pose) {
    const s = p.vol.eyeScale;
    const w = EYE_W * s, h = EYE_H * s;
    const r = p.range;
    const dx = pose.gazeX * (pose.gazeX >= 0 ? r.right : r.left) * GAZE_X * s;
    const dy = pose.gazeY * (pose.gazeY >= 0 ? r.down : r.up) * GAZE_Y * s;
    const centers = eyeCenters(p.def.eyes);
    const plain = plainLook(pose.eyes);
    return [0, 1].map((i) => {
        const squint = i === 0 ? pose.squintL : pose.squintR;
        const open = Math.max(h * Math.max(0.09, (1 - pose.blink) * (1 - squint * 0.4)), w * 0.55);
        return { x: centers[i][0], y: centers[i][1], w, h, dx, dy, open, shift: (h - open) * 0.18, look: pose.eyes, plain };
    });
}
/** Where an eye is drawn: with its gaze offset, or without it where a transform applies the gaze. */
function eyeSpot(e, gaze) {
    return { x: e.x + (gaze ? e.dx : 0), y: e.y + (gaze ? e.dy : 0), w: e.w, h: e.h, open: e.open, shift: e.shift };
}
function happyArc(e) {
    const ex = e.x + e.dx, ey = e.y + e.dy;
    const hw = e.w * HAPPY_ARC.halfWidth, base = ey + e.h * HAPPY_ARC.base;
    return `M${f(ex - hw)} ${f(base)}Q${f(ex)} ${f(ey - e.h * HAPPY_ARC.peak)} ${f(ex + hw)} ${f(base)}`;
}
function eyeMark(e) {
    if (e.plain === 'arc')
        return { shape: 'arc', d: happyArc(e), strokeWidth: e.w * HAPPY_ARC.stroke };
    if (e.plain === null)
        return { shape: 'path', d: eyePath(e.look, eyeSpot(e, true)) };
    const cx = e.x + e.dx, cy = e.y + e.dy + e.shift;
    return { shape: 'pill', x: cx - e.w / 2, y: cy - e.open / 2, width: e.w, height: e.open, radius: Math.min(e.w, e.open) / 2 };
}
function colors(options) {
    return {
        color: toHex(parseHex(options.color) ?? parseHex(DEFAULT_COLOR)),
        ink: toHex(parseHex(options.eyeColor) ?? parseHex(DEFAULT_EYE_COLOR)),
    };
}
/** Compute one flat frame of a definition. Throws if the definition is invalid. */
export function avatarFrame(definition, options = {}) {
    return flatFrame(definition, options, undefined);
}
/**
 * avatarFrame for a live avatar drawn `options.size` CSS pixels wide: like the scene, it skips
 * cross-sections that would sit less than a pixel apart. Internal to the live renderers, so
 * `size` never changes what avatarFrame returns to custom renderers.
 */
export function liveFrame(definition, options = {}) {
    return flatFrame(definition, options, options.size);
}
/**
 * The ribbons are steps along a ramp of the body's own color, painter's style: each step is
 * RAMP_LIGHT lighter or darker in OKLCH and turns RAMP_HUE degrees with it, toward yellow as it
 * lightens and toward blue as it darkens. Steps run +1, -1, +2, -2 and so on, skipping any that
 * would leave RAMP_RANGE, so a working bot's three are one lighter, one darker and one lighter
 * still on most bodies. A body lighter or darker than the range steps from its edge instead, so
 * a white body's ribbons are all well darker than it, and a black one's well lighter.
 */
const RAMP_LIGHT = 0.09;
const RAMP_HUE = 14;
// Six steps wide: room for five besides the body's own, wherever it starts. Past it shades wash
// out toward white or sink toward black.
const RAMP_RANGE = [0.36, 0.9];
const WARM = 100;
const palettes = new Map();
/**
 * How far a ribbon's colour runs from its tail (its shade) to its head: further from the body's
 * lightness by GRADIENT_LIGHT, turning GRADIENT_HUE degrees with it (warmer as it lightens,
 * cooler as it darkens). GRADIENT_STOPS colours along the way.
 */
const GRADIENT_LIGHT = 0.13;
const GRADIENT_HUE = 25;
const GRADIENT_STOPS = 5;
/** Below this chroma a body counts as white, gray or black, and its ribbons are grays with this much tint. */
const NEUTRAL = 0.04;
const NEUTRAL_TINT = 0.025;
/**
 * Which shades (by their order along the ramp: +1, -1, +2, -2, +3 on most bodies) each band's lanes
 * take, a working bot's band first. A celebration's two bands lean to the lighter shades, so the
 * cage stays bright against a dark page.
 */
const BAND_SHADES = [[0, 1, 2], [2, 0, 3], [1, 2, 0]];
/** Turn hue `h` by up to `by` degrees toward hue `to`, never past it. */
function turnToward(h, to, by) {
    const d = ((to - h + 540) % 360) - 180;
    return (h + Math.sign(d) * Math.min(Math.abs(d), by) + 360) % 360;
}
/**
 * The colors of the ribbons on a body this color, one per band and lane (see BAND_SHADES): five
 * steps along its own ramp (see RAMP_LIGHT), at least as vivid as the body. A white, gray or
 * black body gets grays: lighter or darker than it, with just a hint of a hue its seed picks.
 * A piece behind the body is a shade deeper than one in front of it.
 */
/** The colour `t` (0..1) of the way along a colour run, in sRGB between its stops. */
function runAt(run, t) {
    const x = clamp(t, 0, 1) * (run.length - 1), n = Math.min(Math.floor(x), run.length - 2);
    return toHex(mix(run[n], run[n + 1], x - n));
}
function ribbonPalette(color, seed) {
    const key = `${color}|${seed}`;
    let palette = palettes.get(key);
    if (palette)
        return palette;
    const [light, chroma, hue] = toOklch(parseHex(color) ?? parseHex(DEFAULT_COLOR));
    // A seed's hue skips the yellows (80 to 130), whose darker steps turn olive.
    const neutral = chroma < NEUTRAL;
    const base = neutral ? (130 + noise(seed, 500) * 310) % 360 : hue;
    const c = neutral ? NEUTRAL_TINT : Math.max(chroma, 0.17);
    const from = Math.min(RAMP_RANGE[1], Math.max(RAMP_RANGE[0], light));
    const steps = [];
    for (let k = 1; steps.length < 5 && k < 10; k++) {
        for (const step of [k, -k]) {
            const l = from + step * RAMP_LIGHT;
            if (steps.length < 5 && l >= RAMP_RANGE[0] - 1e-9 && l <= RAMP_RANGE[1] + 1e-9)
                steps.push(step);
        }
    }
    while (steps.length < 5)
        steps.push(steps[steps.length - 1] ?? 1);
    const shades = steps.map((step) => {
        const l = from + step * RAMP_LIGHT;
        const h = turnToward(base, step > 0 ? WARM : WARM + 180, RAMP_HUE * Math.abs(step));
        // Tail to head, away from the body's lightness: lighter and warmer, or darker and cooler.
        const away = step > 0 ? 1 : -1;
        const run = Array.from({ length: GRADIENT_STOPS }, (_, n) => {
            const t = n / (GRADIENT_STOPS - 1);
            const hue = turnToward(h, away > 0 ? WARM : WARM + 180, GRADIENT_HUE * t);
            return oklch(clamp(l + away * GRADIENT_LIGHT * t, 0.26, 0.9), c, hue);
        });
        return { step, run };
    });
    // Each band takes three of the shades, lightest on the inside lane to darkest on the outside.
    palette = BAND_SHADES.flatMap((pick) => pick.map((n) => shades[n]).sort((x, y) => y.step - x.step).map(({ run }) => run));
    if (palettes.size >= 64)
        palettes.clear();
    palettes.set(key, palette);
    return palette;
}
function effectsOf(p, pose, options) {
    const b = p.vol.bounds;
    const time = Number.isFinite(options.time) ? options.time : 0;
    const still = options.reducedMotion === true;
    const [cx, cy] = pivotOf(b);
    return {
        body: bodyScale(pose.bang, pose.dots),
        // No ribbons are out below a presence of 0.01 (see ribbonPieces), so their rims are not measured for it.
        ribbons: still || pose.ribbons <= 0.01 ? [] : ribbonPieces(b, pose.ribbons, p.seed, time, pose.sweep, pose.cage, ribbonsFollow(pose.cage >= 0.5 ? p.rims().cage : p.rims().work, pose, b)).map((r) => {
            const hue = ribbonPalette(options.color, p.seed)[r.ribbon];
            // The piece's stretch of its ribbon's colour run, front and back alike.
            const [s0, s1] = r.along;
            const stops = [s0, (s0 + s1) / 2, s1].map((t) => runAt(hue, t));
            // A gradient needs some length; a piece too short to have one takes its middle colour.
            const long = Math.hypot(r.to[0] - r.from[0], r.to[1] - r.from[1]) > 0.01;
            return {
                d: r.d, box: r.box, front: r.front, fill: stops[1],
                gradient: long ? { x1: r.from[0], y1: r.from[1], x2: r.to[0], y2: r.to[1], stops } : { x1: r.from[0], y1: r.from[1], x2: r.from[0] + 0.01, y2: r.from[1], stops: [stops[1], stops[1], stops[1]] },
            };
        }),
        marks: markParts(b, pose.bang, pose.dots, p.seed, time, still).map((part) => {
            const turn = [Math.cos(part.turn), Math.sin(part.turn), -Math.sin(part.turn), Math.cos(part.turn), 0, 0];
            return {
                id: `${p.id}-${part.shape}`,
                d: part.d,
                box: part.box,
                matrix: mul(about(cx, cy, turn), mul(translate(part.x, part.y), [part.scale, 0, 0, part.scale, 0, 0])),
            };
        }),
    };
}
function flatFrame(definition, options, size) {
    const p = prepare(definition, depthOption(options));
    const { vol } = p;
    const b = vol.bounds;
    const { color, ink } = colors(options);
    const pose = poseOf(p, options);
    const pivot = pivotOf(b);
    const v = viewBasis(pose.yaw, pose.pitch);
    const stack = activeStack(v);
    const eyes = [];
    const fx = effectsOf(p, pose, options);
    const root = rootMatrix(pose, b);
    // The body shrinks toward its center as it gives way to a mark.
    const shrink = (m) => (fx.body < 1 ? mul(about(pivot[0], pivot[1], [fx.body, 0, 0, fx.body, 0, 0]), m) : m);
    // Only the cross-sections this view draws are listed; ids are stable across frames.
    const paths = new Map();
    const items = [];
    if (fx.body > 0) {
        drawnSlices(p, v, size, (s, m, i, j) => {
            let path = paths.get(s.d);
            if (!path) {
                path = { id: p.ids.get(s.d), d: s.d, evenOdd: s.evenOdd, box: { ...s.box } };
                paths.set(s.d, path);
            }
            // Parallel slices have the same order along every viewing ray.
            const depth = stack === 'z' ? v.facing * s.at : -v.sY * v.cP * s.at;
            items.push({ depth, shape: { kind: 'slice', key: `${i}${stack}${j}`, path: path.id, matrix: shrink(m) } });
        });
        // Painted on the surface; each eye goes once the surface under it turns away.
        eyeStates(p, pose).forEach((e, idx) => {
            const plane = vol.eyePlanes[idx];
            eyes.push({ mark: eyeMark({ ...e, dx: 0, dy: 0 }), dx: e.dx, dy: e.dy });
            if (!eyeVisible(v, plane))
                return;
            // A slice through the middle of a mark must paint before the entire mark: sort at the near
            // edge of its footprint on the active stack.
            const halfW = e.w * (e.plain === 'pill' ? 0.5 : HAPPY_ARC.halfWidth + 0.5 * HAPPY_ARC.stroke);
            const xDepth = -v.sY * v.cP;
            const z = plane.z + e.dx * plane.dzdx + e.dy * plane.dzdy;
            const depth = stack === 'z'
                ? v.facing * z + Math.abs(v.facing) * (Math.abs(plane.dzdx) * halfW + (Math.abs(plane.dzdy) * e.h) / 2)
                : xDepth * (e.x + e.dx) + Math.abs(xDepth) * halfW;
            items.push({
                depth: depth + 1e-6,
                shape: { kind: 'eye', key: idx === 0 ? 'eye-0' : 'eye-1', matrix: shrink(eyeMatrix(v, plane, pivot)), mark: eyeMark(e) },
            });
        });
        items.sort((a, c) => a.depth - c.depth);
    }
    // Ribbons and marks stay put while the body moves: their matrices undo the root's motion.
    const fixed = fx.ribbons.length || fx.marks.length ? invert(root) : null;
    const ribbon = (front) => fx.ribbons.flatMap((r, i) => r.front === front ? [{ kind: 'ribbon', key: `ribbon-${i}`, d: r.d, box: r.box, matrix: fixed, front, fill: r.fill, gradient: r.gradient }] : []);
    const marks = fx.marks.map((mark, i) => {
        if (!paths.has(mark.id))
            paths.set(mark.id, { id: mark.id, d: mark.d, evenOdd: false, box: mark.box });
        return { kind: 'slice', key: `mark-${i}`, path: mark.id, matrix: mul(fixed, mark.matrix) };
    });
    return {
        name: p.def.name, color, ink, paths: [...paths.values()], root,
        shapes: [...ribbon(false), ...items.map((it) => it.shape), ...ribbon(true), ...marks],
        surface: { view: v, scale: fx.body, eyes },
    };
}
// ---------------------------------------------------------------------------
// Standalone SVG still
function eyeSvg(mark, ink) {
    if (mark.shape === 'path')
        return `<path d="${mark.d}" fill="${ink}"/>`;
    if (mark.shape === 'arc') {
        return `<path d="${mark.d}" fill="none" stroke="${ink}" stroke-width="${f(mark.strokeWidth)}" stroke-linecap="round"/>`;
    }
    return `<rect x="${f(mark.x)}" y="${f(mark.y)}" width="${f(mark.width)}" height="${f(mark.height)}" rx="${f(mark.radius)}" fill="${ink}"/>`;
}
/**
 * A ribbon piece with its gradient alongside it. The id is taken from the gradient itself, so
 * repeats on a page (the same avatar at the same moment) share one harmlessly.
 */
function ribbonSvg(d, g) {
    const id = `oba-g${hashString(`${f(g.x1)},${f(g.y1)},${f(g.x2)},${f(g.y2)},${g.stops.join()}`).toString(36)}`;
    const stops = g.stops.map((c, i) => `<stop offset="${f(i / (g.stops.length - 1))}" stop-color="${c}"/>`).join('');
    return (`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f(g.x1)}" y1="${f(g.y1)}" x2="${f(g.x2)}" y2="${f(g.y2)}">${stops}</linearGradient>` +
        `<path d="${d}" fill="url(#${id})"/>`);
}
/** Render a definition to a standalone SVG string. Throws if the definition is invalid. */
export function renderAvatarSvg(definition, options = {}) {
    const frame = avatarFrame(definition, options);
    const defsMarkup = frame.paths.map((d) => `<path id="${d.id}" d="${d.d}"${d.evenOdd ? ' fill-rule="evenodd"' : ''}/>`).join('');
    const body = frame.shapes
        .map((s) => s.kind === 'slice' ? `<use href="#${s.path}" transform="${mat(s.matrix)}"/>`
        : s.kind === 'eye' ? `<g transform="${mat(s.matrix)}">${eyeSvg(s.mark, frame.ink)}</g>`
            : `<g transform="${mat(s.matrix)}">${ribbonSvg(s.d, s.gradient)}</g>`)
        .join('');
    const size = Number.isFinite(options.size) && options.size > 0 ? f(clamp(options.size, 8, 4096)) : null;
    const dims = size ? ` width="${size}" height="${size}"` : '';
    const label = esc(frame.name);
    return (`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"${dims} role="img" aria-label="${label}" overflow="visible">` +
        `<title>${label}</title>` +
        `<defs>${defsMarkup}</defs>` +
        `<g transform="${mat(frame.root)}" fill="${frame.color}">` +
        body +
        `</g></svg>`);
}
// ---------------------------------------------------------------------------
// Live CSS 3D scene
/** 1 viewBox unit = 1% of the scene's (square) container width. */
const u = (n) => `${f(n)}cqw`;
const eyePlaneCss = ({ z, dzdx, dzdy }) => `translateZ(${u(z + CSS_EYE_LIFT)}) matrix3d(1,0,${r4(dzdx)},0,0,1,${r4(dzdy)},0,0,0,1,0,0,0,0,1)`;
const FILL = 'position:absolute;left:0;top:0;width:100%;height:100%;';
function sliceMarkup(s) {
    const pad = 0.3;
    const x = s.box.x - pad, y = s.box.y - pad, w = s.box.w + 2 * pad, h = s.box.h + 2 * pad;
    const rule = s.evenOdd ? ' fill-rule="evenodd"' : '';
    const place = s.axis === 'z'
        ? `left:${u(x)};top:${u(y)};transform:translateZ(${u(s.at)})`
        : // The side plane's u = 0 line sits at x = s.at; turning it 90° about that line maps u to -z.
            `left:${u(s.at + x)};top:${u(y)};transform-origin:${u(-x)} 50%;transform:rotateY(90deg)`;
    return (`<svg viewBox="${f(x)} ${f(y)} ${f(w)} ${f(h)}" style="position:absolute;width:${u(w)};height:${u(h)};overflow:visible;${place}" aria-hidden="true">` +
        `<path d="${s.d}"${rule} fill="currentColor"/></svg>`);
}
const overlay = (side) => `<svg data-fx="${side}" viewBox="0 0 100 100" style="${FILL}overflow:visible;pointer-events:none" fill="currentColor" aria-hidden="true"></svg>`;
/**
 * Static markup of the live scene for a definition and depth. Mount it once,
 * then apply `sceneFrame` every frame. Body color comes from CSS `color` on
 * an ancestor, eye ink from `--avatar-ink`.
 */
export function renderAvatarScene(definition, options = {}) {
    const p = prepare(definition, depthOption(options));
    const { vol } = p;
    const b = vol.bounds;
    const [cx, cy] = pivotOf(b);
    const ink = `var(--avatar-ink,${DEFAULT_EYE_COLOR})`;
    const stack = (axis) => `<div data-stack="${axis}" style="${FILL}transform-style:preserve-3d">` +
        vol.parts.map((part) => (axis === 'z' ? part.zSlices : part.xSlices).map(sliceMarkup).join('')).join('') +
        `</div>`;
    const eyes = eyeStates(p, poseOf(p, { reducedMotion: true })).map((e, i) => {
        const box = `left:${u(e.x - e.w / 2)};top:${u(e.y - e.h / 2)};width:${u(e.w)};height:${u(e.h)}`;
        return (`<div data-eye="${i}" style="position:absolute;${box};backface-visibility:hidden;transform:${eyePlaneCss(vol.eyePlanes[i])}">` +
            `<i style="position:absolute;inset:0;border-radius:999px;background:${ink}"></i>` +
            `<svg viewBox="${f(e.x - e.w / 2)} ${f(e.y - e.h / 2)} ${f(e.w)} ${f(e.h)}" style="${FILL}overflow:visible;display:none" aria-hidden="true">` +
            `<path d="${happyArc(e)}" fill="none" stroke="${ink}" stroke-width="${f(e.w * HAPPY_ARC.stroke)}" stroke-linecap="round"/></svg>` +
            // Every look between the pill and the arc: its outline is written each frame it changes.
            `<svg data-morph viewBox="${f(e.x - e.w / 2)} ${f(e.y - e.h / 2)} ${f(e.w)} ${f(e.h)}" style="${FILL}overflow:visible;display:none" aria-hidden="true">` +
            `<path fill="${ink}"/></svg>` +
            `</div>`);
    });
    return (`<div data-avatar-scene="${p.id}" style="position:relative;width:100%;height:100%;container-type:size">` +
        // Ribbons behind the body; they and the marks are written each frame they show.
        overlay('back') +
        // will-change pins the slices' raster scale: without it every hop and squash re-rasterizes each slice.
        `<div data-motion style="${FILL}will-change:transform;transform-origin:${u((b.minX + b.maxX) / 2)} ${u(b.maxY)}">` +
        `<div data-view style="${FILL}transform-style:preserve-3d;transform-origin:${u(cx)} ${u(cy)}">` +
        stack('z') + stack('x') + eyes.join('') +
        `</div></div>` +
        overlay('front') +
        `</div>`);
}
const r4 = (n) => Math.round(n * 10000) / 10000;
/** Closest on-screen spacing, CSS px, between cross-sections a small live avatar keeps. */
const SLICE_GAP_PX = 0.75;
/**
 * Per slice of a stack, in markup order: whether it is kept at this rendered size. Within each part,
 * slices closer than SLICE_GAP_PX to the last kept one are dropped; the outermost always stay, and
 * so does the core, which sliceCull relies on to cover the inset slices it hides.
 */
function sliceDetail(p, stack, size) {
    const px = Number.isFinite(size) && size > 0 ? Math.round(size) : 0;
    const key = `${stack}${px}`;
    let keep = p.detail.get(key);
    if (keep)
        return keep;
    const gap = px ? (SLICE_GAP_PX * 100) / px : 0;
    keep = p.vol.parts.flatMap((part) => {
        const slices = stack === 'z' ? part.zSlices : part.xSlices;
        let last = -Infinity;
        return slices.map((s, j) => {
            const core = s.axis === 'z' && s.at === 0 && s.inset === 0;
            const kept = core || j === 0 || j === slices.length - 1 || s.at - last >= gap;
            if (kept)
                last = s.at;
            return kept;
        });
    });
    if (p.detail.size >= 32)
        p.detail.clear();
    p.detail.set(key, keep);
    return keep;
}
/** Per-frame CSS for a mounted scene. Pure and cheap: no geometry is rebuilt. */
export function sceneFrame(definition, options = {}) {
    const p = prepare(definition, depthOption(options));
    const pose = poseOf(p, options);
    const v = viewBasis(pose.yaw, pose.pitch);
    const states = eyeStates(p, pose);
    const stack = activeStack(v);
    const drawn = sliceCull(v);
    const kept = sliceDetail(p, stack, options.size);
    const fx = effectsOf(p, pose, options);
    const piece = (front) => fx.ribbons.filter((r) => r.front === front).map((r) => ribbonSvg(r.d, r.gradient)).join('');
    let k = 0;
    return {
        scene: p.id,
        motion: `translate(0,${u(pose.lift)}) rotate(${f(pose.roll)}deg) scale(${r4(pose.sx)},${r4(pose.sy)})`,
        view: (fx.body < 1 ? `scale(${r4(fx.body)}) ` : '') + `rotateX(${r4(pose.pitch)}rad) rotateY(${r4(pose.yaw)}rad)`,
        body: fx.body,
        back: piece(false),
        front: piece(true) + fx.marks.map((mark) => `<path d="${mark.d}" transform="${mat(mark.matrix)}"/>`).join(''),
        stack,
        slices: p.vol.parts.flatMap((part) => (stack === 'z' ? part.zSlices : part.xSlices).map((s) => kept[k++] && drawn(s))),
        eyes: states.map((e, i) => ({
            visible: eyeVisible(v, p.vol.eyePlanes[i]),
            happy: e.plain === 'arc',
            transform: `${eyePlaneCss(p.vol.eyePlanes[i])} translate(${u(e.dx)},${u(e.dy)})`,
            pill: `translateY(${u(e.shift)}) scaleY(${r4(e.open / e.h)})`,
            d: e.plain === null ? eyePath(e.look, eyeSpot(e, false)) : '',
        })),
    };
}
