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
import { parseHex } from './color.js';
import { flattenPath, insideRow, parsePath } from './path.js';
import { insideDistance } from './volume.js';
import { DEFAULT_SOFT } from './material.js';
/** Sprite resolution: the look is low-frequency, 200px upscales cleanly to any avatar size. */
export const SPRITE_SIZE = 200;
/** Key-light taps (source shader uses 20; 16 with the same dither is indistinguishable). */
const TAPS = 16;
// --- simplex noise, verbatim port of the source shader's snoise/fbm -------------
const mod289 = (x) => x - Math.floor(x / 289) * 289;
const permute = (x) => mod289((x * 34 + 1) * x);
function snoise(vx, vy) {
    const C0 = 0.211324865405187, C1 = 0.366025403784439, C2 = -0.577350269189626, C3 = 0.024390243902439;
    const s = (vx + vy) * C1;
    let i0 = Math.floor(vx + s), i1 = Math.floor(vy + s);
    const t = (i0 + i1) * C0;
    const x0x = vx - i0 + t, x0y = vy - i1 + t;
    const i1x = x0x > x0y ? 1 : 0, i1y = x0x > x0y ? 0 : 1;
    const x1x = x0x - i1x + C0, x1y = x0y - i1y + C0;
    const x2x = x0x + C2, x2y = x0y + C2;
    i0 = mod289(i0);
    i1 = mod289(i1);
    const p0 = permute(permute(i1) + i0);
    const p1 = permute(permute(i1 + i1y) + i0 + i1x);
    const p2 = permute(permute(i1 + 1) + i0 + 1);
    let m0 = Math.max(0.5 - (x0x * x0x + x0y * x0y), 0);
    let m1 = Math.max(0.5 - (x1x * x1x + x1y * x1y), 0);
    let m2 = Math.max(0.5 - (x2x * x2x + x2y * x2y), 0);
    m0 = m0 * m0 * m0 * m0;
    m1 = m1 * m1 * m1 * m1;
    m2 = m2 * m2 * m2 * m2;
    const x0 = 2 * ((p0 * C3) % 1) - 1, x1 = 2 * ((p1 * C3) % 1) - 1, x2 = 2 * ((p2 * C3) % 1) - 1;
    const h0 = Math.abs(x0) - 0.5, h1 = Math.abs(x1) - 0.5, h2 = Math.abs(x2) - 0.5;
    const ox0 = Math.floor(x0 + 0.5), ox1 = Math.floor(x1 + 0.5), ox2 = Math.floor(x2 + 0.5);
    const a00 = x0 - ox0, a01 = x1 - ox1, a02 = x2 - ox2;
    m0 *= 1.79284291400159 - 0.85373472095314 * (a00 * a00 + h0 * h0);
    m1 *= 1.79284291400159 - 0.85373472095314 * (a01 * a01 + h1 * h1);
    m2 *= 1.79284291400159 - 0.85373472095314 * (a02 * a02 + h2 * h2);
    const g0 = a00 * x0x + h0 * x0y, g1 = a01 * x1x + h1 * x1y, g2 = a02 * x2x + h2 * x2y;
    return 130 * (m0 * g0 + m1 * g1 + m2 * g2);
}
function fbm(px, py) {
    let sum = 0, amp = 0.5, norm = 0;
    for (let i = 0; i < 5; i++) {
        sum += amp * snoise(px, py);
        norm += amp;
        px = px * 2 + 19;
        py = py * 2 + 19;
        amp *= 0.5;
    }
    return sum / norm;
}
const fields = new Map();
function sample(dist, n, x, y) {
    if (x < 0 || y < 0 || x >= n || y >= n)
        return 0;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, n - 1), y1 = Math.min(y0 + 1, n - 1);
    const fx = x - x0, fy = y - y0;
    const a = dist[y0 * n + x0], b = dist[y0 * n + x1], c = dist[y1 * n + x0], e = dist[y1 * n + x1];
    return (a + (b - a) * fx) * (1 - fy) + (c + (e - c) * fx) * fy;
}
function buildField(d, size) {
    const polys = flattenPath(parsePath(d));
    const scale = size / 100;
    // Scanline inside mask (one edge pass per row), then an exact Euclidean
    // distance transform (Felzenszwalb–Huttenlocher, separable parabola envelopes):
    // O(pixels), circular isolines — no chamfer facets on thin parts.
    const dist = new Float32Array(size * size);
    const xs = Array.from({ length: size }, (_, i) => (i + 0.5) / scale);
    const row = new Uint8Array(size);
    const INF = 1e12;
    const f = new Float64Array(size * size);
    for (let y = 0; y < size; y++) {
        insideRow(polys, (y + 0.5) / scale, xs, row);
        for (let x = 0; x < size; x++)
            f[y * size + x] = row[x] ? INF : 0;
    }
    const tmp = new Float64Array(size);
    const v = new Int32Array(size);
    const z = new Float64Array(size + 1);
    const edt1d = (get, set) => {
        for (let i = 0; i < size; i++)
            tmp[i] = get(i);
        let k = 0;
        v[0] = 0;
        z[0] = -INF;
        z[1] = INF;
        for (let q = 1; q < size; q++) {
            let s = ((tmp[q] + q * q) - (tmp[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
            while (s <= z[k]) {
                k--;
                s = ((tmp[q] + q * q) - (tmp[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
            }
            k++;
            v[k] = q;
            z[k] = s;
            z[k + 1] = INF;
        }
        k = 0;
        for (let q = 0; q < size; q++) {
            while (z[k + 1] < q)
                k++;
            const dq = q - v[k];
            set(q, dq * dq + tmp[v[k]]);
        }
    };
    for (let x = 0; x < size; x++)
        edt1d((y) => f[y * size + x], (y, val) => { f[y * size + x] = val; });
    for (let y = 0; y < size; y++)
        edt1d((x) => f[y * size + x], (x, val) => { dist[y * size + x] = Math.sqrt(val); });
    // The mask is sampled at pixel centres, so its boundary stair-steps by half a
    // pixel — visible on thin parts. Refine the near-edge band analytically; the
    // interior keeps the smooth transform.
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = y * size + x;
            if (dist[i] > 0 && dist[i] < 2.5)
                dist[i] = insideDistance(polys, (x + 0.5) / scale, (y + 0.5) / scale) * scale;
        }
    }
    const dirs = [];
    for (let i = 0; i < TAPS; i++) {
        const t = ((i + 0.5) / TAPS) * Math.PI * 2;
        dirs.push([Math.cos(t), Math.sin(t)]);
    }
    const thick = dirs.map(([dx, dy]) => {
        const out = new Float32Array(size * size);
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const i = y * size + x;
                if (dist[i] <= 0)
                    continue;
                let t = 0;
                for (;;) {
                    const px = x + dx * t, py = y + dy * t;
                    if (px < 0 || py < 0 || px >= size || py >= size)
                        break;
                    const r = sample(dist, size, px, py);
                    if (r <= 0)
                        break;
                    t += Math.max(r, 1);
                }
                out[i] = t;
            }
        }
        return out;
    });
    return { size, dist, thick, dirs };
}
// --- the light integral, cached per outline + colour + material -----------------
const sprites = new Map();
const toLinear = (v) => (v / 255) ** 2.2;
const toGamma = (v) => Math.min(1, Math.max(0, v)) ** (1 / 2.2);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
};
/**
 * The soft-shape look of one body colour over one outline, as straight-alpha RGBA.
 * `lightAngle` follows the source shader (270 = key from the top in screen space).
 */
export function softSprite(d, color, material = {}, size = SPRITE_SIZE, lightAngle = 270) {
    const m = { ...DEFAULT_SOFT, ...material };
    const key = `${d}|${color.join(',')}|${m.density}|${m.ambient}|${m.spread}|${m.lift}|${m.liftColor}|${size}|${lightAngle}`;
    const hit = sprites.get(key);
    if (hit)
        return hit;
    const fkey = `${d}|${size}|${lightAngle}`;
    let field = fields.get(fkey);
    if (!field) {
        field = buildField(d, size);
        if (fields.size > 24)
            fields.clear();
        fields.set(fkey, field);
    }
    const n = field.size;
    const lin = color.map(toLinear);
    const absorb = lin.map((v) => Math.max(0, m.density) * (1 - v));
    const scatter = Math.max(0.02, m.spread) * 0.12;
    const ambient = clamp(m.ambient, 0, 1);
    const lift = clamp(m.lift ?? 0, 0, 1);
    const floor = (parseHex(m.liftColor ?? DEFAULT_SOFT.liftColor) ?? [91, 105, 141]).map((v) => v / 255);
    const softness = clamp(m.softness ?? 14, 1, 45);
    const k = clamp(Math.log(0.5) / Math.log(Math.max(Math.cos((softness * Math.PI) / 180), 1e-4)), 1, 400);
    const a = (lightAngle * Math.PI) / 180;
    const lc = [Math.cos(a), Math.sin(a)];
    const weights = field.dirs.map(([dx, dy]) => Math.pow(Math.max(dx * lc[0] + dy * lc[1], 0), k));
    const keyW = weights.reduce((s, w) => s + w, 0) || 1e-4;
    const data = new Uint8ClampedArray(n * n * 4);
    const penetration0 = Math.max(scatter * n, 1);
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const i = y * n + x;
            const depth = field.dist[i];
            if (depth <= 0)
                continue;
            const clouds = fbm((x / n - 0.5) * 2, (y / n - 0.5) * 2);
            const penetration = penetration0 * clamp(1 + 0.15 * clouds, 0.2, 3);
            let keyR = 0, keyG = 0, keyB = 0, ambR = 0, ambG = 0, ambB = 0;
            for (let t = 0; t < TAPS; t++) {
                const travel = field.thick[t][i] / penetration;
                const tr = Math.exp(-absorb[0] * travel), tg = Math.exp(-absorb[1] * travel), tb = Math.exp(-absorb[2] * travel);
                ambR += tr;
                ambG += tg;
                ambB += tb;
                const w = weights[t];
                keyR += tr * w;
                keyG += tg * w;
                keyB += tb * w;
            }
            const alpha = smoothstep(0, 1.5, depth);
            const o = i * 4;
            for (let ch = 0; ch < 3; ch++) {
                const key = ch === 0 ? keyR : ch === 1 ? keyG : keyB;
                const amb = ch === 0 ? ambR : ch === 1 ? ambG : ambB;
                let g = toGamma(lin[ch] * (key / keyW + (ambient * amb) / TAPS));
                g = 1 - (1 - g) * (1 - floor[ch] * lift);
                data[o + ch] = Math.round(clamp(g, 0, 1) * 255);
            }
            data[o + 3] = Math.round(alpha * 255);
        }
    }
    const sprite = { size: n, data };
    if (sprites.size > 96)
        sprites.clear();
    sprites.set(key, sprite);
    return sprite;
}
