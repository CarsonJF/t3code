import { HAPPY_ARC } from './validate.js';
/** Points per outline. */
const STEPS = 40;
/** The slit: as long as the happy arc is wide, this thick (both as shares of the eye's width), tipped this far. */
const SLIT = { length: 1.9, thick: 0.5, tip: 0.2 };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** `count` points at even steps along a closed polyline, the first one at its first point. */
function resample(pts, count) {
    const n = pts.length;
    const at = [0];
    for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        at.push(at[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const total = at[n];
    const out = [];
    let i = 0;
    for (let k = 0; k < count; k++) {
        const s = (k / count) * total;
        while (i < n - 1 && at[i + 1] < s)
            i++;
        const a = pts[i], b = pts[(i + 1) % n];
        const u = at[i + 1] > at[i] ? (s - at[i]) / (at[i + 1] - at[i]) : 0;
        out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
    }
    return out;
}
/** An arc of a circle as points, from angle `from` to `to` (radians, y down), ends included. */
function sweep(cx, cy, r, from, to, steps) {
    const pts = [];
    for (let i = 0; i <= steps; i++) {
        const a = from + ((to - from) * i) / steps;
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return pts;
}
/** The pill: a stadium `w` wide and `h` tall about (cx, cy), from the top centre, clockwise. */
function pill(cx, cy, w, h) {
    const r = Math.min(w, h) / 2;
    const fx = w / 2 - r, fy = h / 2 - r;
    const q = Math.PI / 2;
    return [
        [cx, cy - h / 2],
        ...sweep(cx + fx, cy - fy, r, -q, 0, 6),
        ...sweep(cx + fx, cy + fy, r, 0, q, 6),
        ...sweep(cx - fx, cy + fy, r, q, 2 * q, 6),
        ...sweep(cx - fx, cy - fy, r, 2 * q, 3 * q, 6),
    ];
}
/** The happy arc as an outline: its stroke's two edges and round ends, from the top centre, clockwise. */
function arc(e) {
    const hw = e.w * HAPPY_ARC.halfWidth, base = e.y + e.h * HAPPY_ARC.base, peak = e.y - e.h * HAPPY_ARC.peak;
    const r = (e.w * HAPPY_ARC.stroke) / 2;
    // The centre line and its upward normal at s (0 = left end, 1 = right end).
    const at = (s) => {
        const m = 1 - s;
        const x = e.x + hw * (2 * s - 1), y = (m * m + s * s) * base + 2 * m * s * peak;
        const tx = 2 * hw, ty = 2 * (2 * s - 1) * (base - peak);
        const len = Math.hypot(tx, ty);
        return { p: [x, y], n: [ty / len, -tx / len] };
    };
    const edge = (from, to, side) => {
        const pts = [];
        for (let i = 0; i <= 8; i++) {
            const { p, n } = at(from + ((to - from) * i) / 8);
            pts.push([p[0] + n[0] * r * side, p[1] + n[1] * r * side]);
        }
        return pts;
    };
    const end = (s) => {
        const { p, n } = at(s);
        const up = Math.atan2(n[1], n[0]);
        // Round the end from the upper edge to the lower one, the long way round its tip.
        return s === 1 ? sweep(p[0], p[1], r, up, up + Math.PI, 8) : sweep(p[0], p[1], r, up + Math.PI, up + 2 * Math.PI, 8);
    };
    return [...edge(0.5, 1, 1), ...end(1), ...edge(1, 0, -1), ...end(0), ...edge(0, 0.5, 1)];
}
/** The slit: a thin capsule lying almost flat, both eyes tipped the same way; a blink thins it. */
function slit(e) {
    const length = e.w * SLIT.length, thick = e.w * SLIT.thick * clamp(e.open / e.h, 0.3, 1);
    const cos = Math.cos(SLIT.tip), sin = Math.sin(SLIT.tip);
    return pill(0, 0, length, thick).map(([x, y]) => [e.x + x * cos - y * sin, e.y + x * sin + y * cos]);
}
/** Whether a look is exactly the plain pill or exactly the happy arc: those are drawn as before. */
export function plainLook(look) {
    if (look.arc >= 1)
        return 'arc';
    return look.arc <= 0 && look.slit <= 0 ? 'pill' : null;
}
/** The outline of one eye, closed, clockwise from the top: the pill, the arc and the slit mixed by the look. */
export function eyeOutline(look, e) {
    const a = clamp(look.arc, 0, 1), s = clamp(look.slit, 0, 1 - a);
    const shapes = [[1 - a - s, pill(e.x, e.y + e.shift, e.w, e.open)], [a, arc(e)], [s, slit(e)]];
    const out = Array.from({ length: STEPS }, () => [0, 0]);
    for (const [weight, shape] of shapes) {
        if (weight <= 0)
            continue;
        resample(shape, STEPS).forEach(([x, y], i) => {
            out[i][0] += x * weight;
            out[i][1] += y * weight;
        });
    }
    return out;
}
const f = (n) => {
    const r = Math.round(n * 100) / 100;
    return (Object.is(r, -0) ? 0 : r).toString();
};
/** A smooth closed path through an outline: a quadratic per point, joined at the midpoints. Absolute M, Q and Z only. */
export function outlinePath(pts) {
    const n = pts.length;
    const mid = (i) => {
        const a = pts[i % n], b = pts[(i + 1) % n];
        return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    };
    const start = mid(n - 1);
    let d = `M${f(start[0])} ${f(start[1])}`;
    for (let i = 0; i < n; i++) {
        const m = mid(i);
        d += `Q${f(pts[i][0])} ${f(pts[i][1])} ${f(m[0])} ${f(m[1])}`;
    }
    return `${d}Z`;
}
/** The path of one eye for a look that is neither the plain pill nor the plain arc. */
export function eyePath(look, e) {
    return outlinePath(eyeOutline(look, e));
}
