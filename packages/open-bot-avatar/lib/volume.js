/**
 * Implied volume for a flat silhouette.
 *
 * The definition stays a 2D path. Here every filled subpath becomes a "part"
 * with a front-surface height field h(x, y) (the back mirrors it about z = 0):
 *
 * - inflate: a rounded slab. Height follows an elliptical edge fillet of the
 *   distance to the outline, so sides curve and the face is flat.
 * - revolve-y: a solid of revolution about the part's vertical center line
 *   (mug body, pot, bulb), taken from exact scanline widths.
 * - revolve-x: a solid of revolution about a horizontal axis shared by the
 *   whole body (barbell: bar → cylinder, plates → discs).
 *
 * From the height field the part is cut, once, into two stacks of plain
 * cross-section paths: z-slices (planes facing the viewer, level sets of h)
 * and x-slices (planes facing sideways, column profiles of h). Rendered in a
 * single flat color, the union of a stack is the silhouette of the solid;
 * the renderer shows whichever stack faces the viewer more, so no plane is
 * ever seen edge-on. Everything here is pure and cached by the renderer.
 */
import { RUN, contourOutlines, loopsToPath, runRange, runsOf, simplifiedLoop } from './contour.js';
import { EdgeIndex, segDist2 } from './distance.js';
import { bounds, edgeBands, isInside } from './path.js';
import { EYE_H, EYE_W, GAZE_X, GAZE_Y, analyzeBody, drawnEyesFit, eyeCenters, eyeClearance, gazeRange } from './validate.js';
/** Largest depth an inflated part may take, viewBox units. */
export const MAX_PART_DEPTH = 30;
/** Drawn eyes are up to this much larger than the contract's 4 × 11 pill when the body has room. */
export const EYE_BOOST = 1.45;
/**
 * Gap every drawn eye shape (pill and happy arc) keeps from the outline at rest
 * before the renderer enlarges it, viewBox units. Below this the eyes stay at
 * the definition's own scale.
 */
export const EYE_BOOST_PAD = 3;
/**
 * Design target for generated avatars: the enlarged eyes keep this much
 * clearance at rest, which also leaves full gaze travel with EYE_CLEARANCE.
 * Advisory (validate.sh --strict); v1 imports below it still render.
 */
export const FACE_ROOM_TARGET = 4.5;
const MAX_X_SLICES = 40;
/**
 * Thin regions get refinement slices (see thinBoxes): where no inscribed circle
 * within THIN_REACH units has a radius of THIN or more. A thin, deep protrusion
 * seen at an angle shifts more between neighboring slices than it is wide, so
 * without them it fans out into separate copies.
 */
const THIN = 4;
const THIN_REACH = 5;
/** How far a refinement box reaches past its thin region into the body, units. */
const THIN_MARGIN = 2;
/** Depth spacing of refinement slices, units. */
const FINE_Z = 0.6;
function segDist(px, py, ax, ay, bx, by) {
    return Math.sqrt(segDist2(px, py, ax, ay, bx, by));
}
/** Distance from a point to the nearest edge of the polygons. */
export function edgeDistance(polys, x, y) {
    let best = Infinity;
    for (const poly of polys) {
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const d = segDist(x, y, poly[j][0], poly[j][1], poly[i][0], poly[i][1]);
            if (d < best)
                best = d;
        }
    }
    return best;
}
/** Inward distance to the outline, or 0 outside the fill. */
export function insideDistance(polys, x, y) {
    return isInside(polys, x, y) ? edgeDistance(polys, x, y) : 0;
}
/** Outline erosion of an inflated part at depth z (elliptical fillet). */
export function erosionAt(part, z) {
    const half = part.depth / 2;
    if (part.rz <= 0)
        return 0;
    const u = (Math.abs(z) - (half - part.rz)) / part.rz;
    if (u <= 0)
        return 0;
    return part.rxy * (1 - Math.sqrt(Math.max(0, 1 - Math.min(1, u) ** 2)));
}
/** How far inside the outline an inflated part's surface reaches `level` (inverse of surfaceZ). */
export function insetAt(part, level) {
    const half = part.depth / 2;
    if (part.rxy <= 0 || part.rz <= 0 || level <= half - part.rz)
        return 0;
    if (level >= half)
        return part.rxy;
    const s = (level - (half - part.rz)) / part.rz;
    return part.rxy * (1 - Math.sqrt(Math.max(0, 1 - s * s)));
}
/** Front surface depth of an inflated part at a point `dist` units inside the outline. */
export function surfaceZ(part, dist) {
    const half = part.depth / 2;
    if (part.rxy <= 0 || dist >= part.rxy)
        return half;
    const k = 1 - Math.max(0, dist) / part.rxy;
    return half - part.rz + Math.sqrt(Math.max(0, 1 - k * k)) * part.rz;
}
/**
 * Depth heuristic for inflated parts: as deep as the part is thick, but tall
 * slender parts get up to 2.4x their thickness so they read as discs.
 */
export function partDepth(thickness, b, volume) {
    const long = Math.max(b.maxX - b.minX, b.maxY - b.minY);
    const raw = 0.8 * Math.max(thickness, Math.min(0.4 * long, 2.4 * thickness));
    return Math.min(MAX_PART_DEPTH, Math.max(3, raw)) * volume;
}
/** Sorted crossings of the line (y = s if `rows`, else x = s) with the polygons. */
function crossings(polys, rows, s) {
    const out = [];
    const a = rows ? 1 : 0, b = rows ? 0 : 1;
    for (const poly of polys) {
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const p = poly[j], q = poly[i];
            if ((p[a] <= s && q[a] > s) || (q[a] <= s && p[a] > s))
                out.push(p[b] + ((s - p[a]) * (q[b] - p[b])) / (q[a] - p[a]));
        }
    }
    return out.sort((m, n) => m - n);
}
/**
 * Half-widths about `center` along rows (or columns) if every line crosses the
 * part as one interval centered on it; otherwise null (not a solid of revolution).
 */
function revolveProfile(polys, rows, lo, hi, center) {
    const step = 0.2;
    const n = Math.max(2, Math.ceil((hi - lo) / step) + 1);
    const r = new Float64Array(n);
    let span = 0;
    const mids = [];
    for (let k = 0; k < n; k++) {
        const s = Math.min(hi - 0.01, Math.max(lo + 0.01, lo + k * step));
        const xs = crossings(polys, rows, s);
        if (xs.length === 0)
            continue;
        if (xs.length !== 2)
            return null;
        r[k] = (xs[1] - xs[0]) / 2;
        span = Math.max(span, xs[1] - xs[0]);
        mids.push((xs[0] + xs[1]) / 2);
    }
    const tol = Math.max(0.8, 0.04 * span);
    if (!mids.length || mids.some((m) => Math.abs(m - center) > tol))
        return null;
    return { start: lo, step, r };
}
function radiusAt(p, s) {
    const t = (s - p.start) / p.step;
    if (t < 0 || t > p.r.length - 1)
        return 0;
    const k = Math.min(p.r.length - 2, Math.floor(t));
    return p.r[k] + (p.r[k + 1] - p.r[k]) * (t - k);
}
/** Front surface height at a point inside the part, `sd` from its outline (used by inflated parts only). */
function surfaceHeight(s, x, y, sd) {
    if (s.kind === 'inflate')
        return surfaceZ(s.fillet, sd);
    const p = s.profile;
    return s.kind === 'revolve-x'
        ? s.v * Math.sqrt(Math.max(0, radiusAt(p, x) ** 2 - (y - s.axis) ** 2))
        : s.v * Math.sqrt(Math.max(0, radiusAt(p, y) ** 2 - (x - s.axis) ** 2));
}
/**
 * Horizontal axis of revolution, if the body looks like a turned object seen
 * from the side: at least two parts, wider than tall, mirror-symmetric about
 * y = axis and with every part centered on it.
 */
export function revolveAxis(body) {
    const b = body.bounds;
    const outlines = body.subpaths.filter((s) => !s.hole);
    if (outlines.length < 2 || b.maxX - b.minX < 1.1 * (b.maxY - b.minY))
        return null;
    const axis = (b.minY + b.maxY) / 2;
    for (const o of outlines) {
        const ob = bounds(o.polys);
        if (Math.abs((ob.minY + ob.maxY) / 2 - axis) > 1.5)
            return null;
    }
    let filled = 0, off = 0;
    const xs = [];
    for (let x = b.minX + 0.5; x < b.maxX; x += 1)
        xs.push(x);
    const top = new Uint8Array(xs.length), bottom = new Uint8Array(xs.length);
    const index = edgeBands(body.polys);
    for (let y = b.minY + 0.5; y < axis; y += 1) {
        index.insideRow(y, xs, top);
        index.insideRow(2 * axis - y, xs, bottom);
        for (let k = 0; k < xs.length; k++) {
            if (top[k] || bottom[k])
                filled++;
            if (top[k] !== bottom[k])
                off++;
        }
    }
    return filled > 0 && off / filled < 0.02 ? axis : null;
}
/** A part's sample grid with its signed distances, before any height is known. */
function sampleGrid(polys, b, step, index) {
    const pad = 1;
    const x0 = b.minX - pad, y0 = b.minY - pad;
    const nx = Math.ceil((b.maxX - b.minX + 2 * pad) / step) + 1;
    const ny = Math.ceil((b.maxY - b.minY + 2 * pad) / step) + 1;
    const sd = index.distances({ x0, y0, step, nx, ny }), inside = new Uint8Array(nx * ny);
    const xs = Array.from({ length: nx }, (_, i) => x0 + i * step);
    const row = new Uint8Array(nx);
    const rows = edgeBands(polys);
    for (let j = 0; j < ny; j++) {
        rows.insideRow(y0 + j * step, xs, row);
        inside.set(row, j * nx);
        for (let i = 0; i < nx; i++)
            if (!row[i])
                sd[j * nx + i] = -sd[j * nx + i];
    }
    return { x0, y0, step, nx, ny, sd, h: new Float64Array(nx * ny), inside };
}
/** Twice the largest inward distance over the samples of a grid like sampleGrid's, at `step`. */
function gridThickness(polys, b, step, index) {
    const pad = 1;
    const nx = Math.ceil((b.maxX - b.minX + 2 * pad) / step) + 1;
    const ny = Math.ceil((b.maxY - b.minY + 2 * pad) / step) + 1;
    return 2 * index.widest({ x0: b.minX - pad, y0: b.minY - pad, step, nx, ny }, edgeBands(polys));
}
/** Fill in the grid's heights: the surface at every sample inside the outline, 0 outside. */
function sampleHeights(g, surface) {
    for (let j = 0; j < g.ny; j++) {
        const y = g.y0 + j * g.step;
        for (let i = 0; i < g.nx; i++) {
            const k = j * g.nx + i;
            if (g.inside[k])
                g.h[k] = surfaceHeight(surface, g.x0 + i * g.step, y, g.sd[k]);
        }
    }
}
function loopBox(loops) {
    const b = bounds(loops);
    return { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY };
}
/**
 * Cross-sections of an inflated part. Height grows with distance from the outline, so a level is
 * reached at a fixed inset: the field is the signed distance less that inset, which is the
 * distance grid itself contoured at the inset.
 */
function insetCuts(g, fillet) {
    const whole = { values: g.sd, nx: g.nx, ny: g.ny, x0: g.x0, y0: g.y0, step: g.step };
    const range = runRange(g.sd, g.nx, g.ny);
    const flat = new Uint8Array(range.min.length);
    return (level, box) => {
        const drop = insetAt(fillet, level);
        if (!box) {
            // Subtracting keeps order, so a run whose extremes are on one side of the inset is all on it.
            for (let k = 0; k < flat.length; k++)
                flat[k] = range.min[k] - drop >= 0 || range.max[k] - drop < 0 ? 1 : 0;
            return contourOutlines(whole, drop, 0.04, flat);
        }
        // A box is contoured on its own samples plus one ring outside it, where the clip is negative.
        const i0 = Math.max(0, box.i0 - 1), i1 = Math.min(g.nx - 1, box.i1 + 1);
        const j0 = Math.max(0, box.j0 - 1), j1 = Math.min(g.ny - 1, box.j1 + 1);
        const nx = i1 - i0 + 1, ny = j1 - j0 + 1;
        const values = new Float64Array(nx * ny);
        for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) {
                const sd = g.sd[(j + j0) * g.nx + i + i0];
                const v = Math.min(sd - drop, sd);
                values[j * nx + i] = Math.min(v, g.step * Math.min(i + i0 - box.i0, box.i1 - i - i0, j + j0 - box.j0, box.j1 - j - j0));
            }
        }
        return contourOutlines({ values, nx, ny, x0: g.x0 + i0 * g.step, y0: g.y0 + j0 * g.step, step: g.step }, 0, 0.04);
    };
}
/**
 * Cross-sections of a revolved part. With r the radius at a sample and t its offset from the
 * axis, height ≥ level where t² ≤ r² - (level / v)²: that difference over twice the radius is
 * about a distance, and it is the field.
 */
function revolveCuts(g, surface) {
    const { nx, ny } = g;
    const { v, axis } = surface, p = surface.profile, alongX = surface.kind === 'revolve-x';
    // The field is (base - (level / v)²) / over: only the middle term changes with the level.
    const base = new Float64Array(nx * ny), over = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++) {
        const y = g.y0 + j * g.step;
        for (let i = 0; i < nx; i++) {
            const x = g.x0 + i * g.step;
            const r = radiusAt(p, alongX ? x : y), t = alongX ? y - axis : x - axis;
            base[j * nx + i] = r * r - t * t;
            over[j * nx + i] = 2 * Math.max(r, 0.5);
        }
    }
    const values = new Float64Array(nx * ny);
    const field = { values, nx, ny, x0: g.x0, y0: g.y0, step: g.step };
    const rise = runRange(base, nx, ny), edge = runRange(g.sd, nx, ny);
    const runs = runsOf(nx);
    const flat = new Uint8Array(rise.min.length);
    return (level) => {
        const drop = (level / Math.max(v, 1e-6)) ** 2;
        for (let k = 0; k < flat.length; k++) {
            // Subtracting keeps order and `over` is positive, so the extremes of a run tell its sign.
            const out = rise.max[k] - drop < 0 || edge.max[k] < 0, within = rise.min[k] - drop >= 0 && edge.min[k] >= 0;
            flat[k] = out || within ? 1 : 0;
            if (flat[k])
                continue;
            // Only runs the contour may cross are read, so only they are filled in.
            const r = k % runs, j = (k - r) / runs;
            for (let q = j * nx + r * RUN, end = j * nx + Math.min(nx - 1, (r + 1) * RUN); q <= end; q++) {
                values[q] = Math.min((base[q] - drop) / over[q], g.sd[q]);
                values[q + nx] = Math.min((base[q + nx] - drop) / over[q + nx], g.sd[q + nx]);
            }
        }
        return contourOutlines(field, 0, 0.04, flat);
    };
}
/**
 * Boxes around the thin parts of a part's outline, grown by THIN_MARGIN and
 * merged where they overlap, in grid samples. Thin means the widest inscribed
 * circle within THIN_REACH has a radius under THIN (a speech bubble's tail, a
 * leaf, a handle ring).
 */
function thinBoxes(g) {
    const { nx, ny } = g;
    const reach = Math.ceil(THIN_REACH / g.step);
    // Whether a sample THIN or more inside the outline lies within `reach` samples (a square
    // window, rows then columns): the largest inward distance there is THIN or more exactly then.
    const wide = new Uint8Array(nx * ny), near = new Uint8Array(nx * ny);
    const count = new Int32Array(Math.max(nx, ny) + 1);
    for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++)
            count[i + 1] = count[i] + (g.sd[j * nx + i] >= THIN ? 1 : 0);
        for (let i = 0; i < nx; i++)
            wide[j * nx + i] = count[Math.min(nx, i + reach + 1)] > count[Math.max(0, i - reach)] ? 1 : 0;
    }
    for (let i = 0; i < nx; i++) {
        for (let j = 0; j < ny; j++)
            count[j + 1] = count[j] + wide[j * nx + i];
        for (let j = 0; j < ny; j++)
            near[j * nx + i] = count[Math.min(ny, j + reach + 1)] > count[Math.max(0, j - reach)] ? 1 : 0;
    }
    const thin = (k) => g.sd[k] > 0 && !near[k];
    const seen = new Uint8Array(nx * ny);
    const grow = Math.ceil(THIN_MARGIN / g.step);
    const boxes = [];
    for (let start = 0; start < nx * ny; start++) {
        if (seen[start] || !thin(start))
            continue;
        const box = { i0: nx, i1: -1, j0: ny, j1: -1, top: 0 };
        let cells = 0;
        const stack = [start];
        seen[start] = 1;
        while (stack.length) {
            const k = stack.pop();
            const i = k % nx, j = (k - i) / nx;
            cells++;
            box.top = Math.max(box.top, g.h[k]);
            box.i0 = Math.min(box.i0, i);
            box.i1 = Math.max(box.i1, i);
            box.j0 = Math.min(box.j0, j);
            box.j1 = Math.max(box.j1, j);
            for (const n of [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, j > 0 ? k - nx : -1, j < ny - 1 ? k + nx : -1]) {
                if (n >= 0 && !seen[n] && thin(n)) {
                    seen[n] = 1;
                    stack.push(n);
                }
            }
        }
        // Specks are not worth a slice.
        if (cells * g.step * g.step < 2)
            continue;
        boxes.push({
            i0: Math.max(0, box.i0 - grow), i1: Math.min(nx - 1, box.i1 + grow),
            j0: Math.max(0, box.j0 - grow), j1: Math.min(ny - 1, box.j1 + grow), top: box.top,
        });
    }
    // Overlapping boxes become one, so no cross-section is drawn twice.
    for (let a = 0; a < boxes.length; a++) {
        for (let b = a + 1; b < boxes.length; b++) {
            const p = boxes[a], q = boxes[b];
            if (p.i0 > q.i1 || q.i0 > p.i1 || p.j0 > q.j1 || q.j0 > p.j1)
                continue;
            boxes[a] = { i0: Math.min(p.i0, q.i0), i1: Math.max(p.i1, q.i1), j0: Math.min(p.j0, q.j0), j1: Math.max(p.j1, q.j1), top: Math.max(p.top, q.top) };
            boxes.splice(b, 1);
            b = a;
        }
    }
    return boxes;
}
/**
 * Side profile for the slab of grid columns c0..c1, drawn as the plane at its
 * column `at`: loops in (u = -z, y), symmetric in u. Each row takes the largest
 * height across the slab, so a stack of these seen side-on adds up to the
 * solid's side silhouette instead of one tooth per column where the outline
 * slopes. Where a row run meets the outline the profile ends at the surface
 * height right there (the wall of an inflated part, the rim of a revolved
 * one), not at the last sample's.
 */
function columnLoops(g, c0, c1, surface) {
    const loops = [];
    const sd = new Float64Array(g.ny).fill(-Infinity), h = new Float64Array(g.ny);
    for (let j = 0; j < g.ny; j++) {
        for (let c = c0; c <= c1; c++) {
            const k = j * g.nx + c;
            if (g.sd[k] > sd[j])
                sd[j] = g.sd[k];
            if (g.sd[k] > 0 && g.h[k] > h[j])
                h[j] = g.h[k];
        }
    }
    // One run of rows at a time: its right side (u, y in turn) from top to bottom, then the mirror image back up.
    const xy = new Float64Array(4 * (g.ny + 2));
    let j = 0;
    while (j < g.ny) {
        if (sd[j] <= 0) {
            j++;
            continue;
        }
        const j0 = j;
        while (j < g.ny && sd[j] > 0)
            j++;
        const j1 = j - 1;
        let n = 0;
        if (j0 > 0)
            n = rimPoint(g, c0, c1, surface, sd, h, j0, j0 - 1, xy, n);
        else {
            xy[n++] = h[j0];
            xy[n++] = g.y0 + j0 * g.step;
        }
        for (let k = j0; k <= j1; k++) {
            xy[n++] = h[k];
            xy[n++] = g.y0 + k * g.step;
        }
        if (j1 < g.ny - 1)
            n = rimPoint(g, c0, c1, surface, sd, h, j1, j1 + 1, xy, n);
        else {
            xy[n++] = h[j1];
            xy[n++] = g.y0 + j1 * g.step;
        }
        let top = -Infinity;
        for (let k = 0; k < n; k += 2)
            top = Math.max(top, xy[k]);
        if (top < 0.05)
            continue;
        for (let k = n - 2, m = n; k >= 0; k -= 2) {
            xy[m++] = -xy[k];
            xy[m++] = xy[k + 1];
        }
        loops.push(simplifiedLoop(xy, n, 0.04));
    }
    return loops;
}
/**
 * The end of a row run of columnLoops, written to xy[n]: where the outline crosses between the
 * run's last sample `inside` and its neighbor `outside`, and the surface height there, capped by
 * the sample's. Returns the next free slot.
 */
function rimPoint(g, c0, c1, surface, sd, h, inside, outside, xy, n) {
    const yIn = g.y0 + inside * g.step;
    const y = yIn + ((g.y0 + outside * g.step - yIn) * sd[inside]) / (sd[inside] - sd[outside]);
    let top = 0;
    for (let c = c0; c <= c1; c++)
        top = Math.max(top, surfaceHeight(surface, g.x0 + c * g.step, y, 0));
    xy[n] = Math.min(h[inside], top);
    xy[n + 1] = y;
    return n + 2;
}
/** Depth levels in (flat, flat + round): even in angle over the rounded part of the profile. */
function levels(flat, round, steps) {
    const out = [];
    for (let k = 1; k < steps; k++)
        out.push(flat + round * Math.sin((k / steps) * (Math.PI / 2)));
    return out;
}
/** Build the implied volume. `volume` scales every depth (0 = flat). Pass `body` to reuse an analysis. */
export function buildVolume(def, volume = 1, body = analyzeBody(def.body.path)) {
    const outlines = body.subpaths.filter((s) => !s.hole);
    const holes = body.subpaths.filter((s) => s.hole);
    const v = Number.isFinite(volume) ? Math.max(0, volume) : 1;
    const xAxis = revolveAxis(body);
    const parts = outlines.map((o) => {
        const cuts = holes.filter((h) => h.probe && isInside(o.polys, h.probe[0], h.probe[1]));
        const polys = [...o.polys, ...cuts.flatMap((h) => h.polys)];
        const b = bounds(o.polys);
        const center = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
        const minDim = Math.min(b.maxX - b.minX, b.maxY - b.minY);
        const step = Math.max(0.25, Math.min(0.45, minDim / 24));
        // Classify: shared horizontal axis, own vertical axis (multi-part bodies only), or inflated.
        let kind = 'inflate';
        let profile = null;
        if (xAxis !== null) {
            profile = revolveProfile(polys, false, b.minX, b.maxX, xAxis);
            if (profile)
                kind = 'revolve-x';
        }
        else if (outlines.length > 1 && cuts.length === 0) {
            profile = revolveProfile(polys, true, b.minY, b.maxY, center[0]);
            if (profile)
                kind = 'revolve-y';
        }
        const index = new EdgeIndex(polys, b);
        let thickness, depth, rxy = 0, rz = 0, axis = 0;
        if (kind === 'inflate' || !profile) {
            thickness = gridThickness(polys, b, Math.max(step, 0.6), index);
            depth = partDepth(thickness, b, v);
            rxy = Math.min(thickness / 2, depth / 2) * 0.9;
            rz = (depth / 2) * 0.85;
        }
        else {
            axis = kind === 'revolve-x' ? xAxis : center[0];
            const radius = Math.max(...profile.r);
            thickness = 2 * radius;
            depth = 2 * radius * v;
        }
        const surface = { kind, fillet: { depth, rxy, rz }, profile, axis, v };
        const filled = edgeBands(polys);
        const height = (x, y) => filled.winding(x, y) !== 0 ? surfaceHeight(surface, x, y, kind === 'inflate' ? index.distance(x, y) : 0) : 0;
        const core = {
            axis: 'z', at: 0, d: o.d + cuts.map((h) => h.d).join(''), loops: polys, evenOdd: false,
            box: { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY }, inset: 0,
        };
        const zSlices = [core];
        const xSlices = [];
        const half = depth / 2;
        if (half > 0.05) {
            const g = sampleGrid(polys, b, step, index);
            sampleHeights(g, surface);
            const steps = kind === 'inflate'
                ? Math.max(4, Math.min(14, Math.round(rz / 0.8)))
                : Math.max(5, Math.min(18, Math.round(half / 1.1)));
            // Inflated parts keep a straight wall up to half - rz; one slice at its end carries it.
            const ls = kind === 'inflate' ? [half - rz, ...levels(half - rz, rz, steps)] : levels(0, half, steps);
            const cut = kind === 'inflate' ? insetCuts(g, surface.fillet) : revolveCuts(g, surface);
            const addLevel = (level, box) => {
                const loops = cut(level, box);
                if (!loops.length)
                    return false;
                // Every third point of the loops, counted across them.
                let inset = Infinity, k = 0;
                for (const loop of loops)
                    for (const p of loop)
                        if (k++ % 3 === 0)
                            inset = Math.min(inset, index.distance(p[0], p[1]));
                const slice = { axis: 'z', d: loopsToPath(loops), loops, evenOdd: true, box: loopBox(loops), inset };
                zSlices.push({ ...slice, at: level }, { ...slice, at: -level });
                return true;
            };
            const used = [0];
            for (const level of ls)
                if (level >= 0.02 && addLevel(level))
                    used.push(level);
            // Thin parts of an inflated outline (deep, narrow fins): more cross-sections between the levels,
            // the straight wall included, each clipped to its box. Revolved parts' slices span their thin side.
            const thin = kind === 'inflate' ? thinBoxes(g) : [];
            for (const box of thin) {
                for (let k = 1; k < used.length && used[k - 1] < box.top; k++) {
                    const a = used[k - 1], gap = used[k] - a, m = Math.ceil(gap / FINE_Z - 1e-9);
                    for (let q = 1; q < m && a + (gap * q) / m < box.top; q++)
                        addLevel(a + (gap * q) / m, box);
                }
            }
            zSlices.sort((m, n) => m.at - n.at);
            const width = b.maxX - b.minX;
            const every = Math.max(1, Math.round(Math.max(1.1, width / MAX_X_SLICES) / g.step));
            // One plane per `every` grid columns, standing for the whole slab around it.
            const before = Math.floor((every - 1) / 2);
            for (let i = 1; i < g.nx - 1; i += every) {
                const loops = columnLoops(g, Math.max(0, i - before), Math.min(g.nx - 1, i - before + every - 1), surface);
                if (loops.length)
                    xSlices.push({ axis: 'x', at: g.x0 + i * g.step, d: loopsToPath(loops), loops, evenOdd: true, box: loopBox(loops), inset: 0 });
            }
        }
        return {
            kind, d: core.d, polys, bounds: b, center, thickness, depth, rxy, rz,
            axis: kind === 'revolve-x' ? xAxis : kind === 'revolve-y' ? center[0] : undefined,
            zSlices, xSlices, height,
        };
    });
    const eyeScale = boostedEyeScale(body, def.eyes);
    // The eyes ride on whichever part is highest under their centers.
    const centers = eyeCenters(def.eyes);
    let eyePart = 0, bestZ = -Infinity;
    parts.forEach((part, i) => {
        const zs = centers.map(([x, y]) => part.height(x, y));
        if (zs.some((z) => z <= 0))
            return;
        const z = Math.min(...zs);
        if (z > bestZ) {
            bestZ = z;
            eyePart = i;
        }
    });
    const host = parts[eyePart];
    // Limit the socket to its host even when a taller part overlaps the face.
    const w = (EYE_W * eyeScale) / 2 + GAZE_X * eyeScale, hh = (EYE_H * eyeScale) / 2 + GAZE_Y * eyeScale;
    const eyeZ = centers.map(([x, y]) => {
        let top = 0;
        for (const fx of [-1, -0.5, 0, 0.5, 1])
            for (const fy of [-1, -0.5, 0, 0.5, 1])
                top = Math.max(top, host ? host.height(x + fx * w, y + fy * hh) : 0);
        return top;
    });
    const eyePlanes = centers.map(([x, y]) => {
        if (!host)
            return { x, y, z: 0, dzdx: 0, dzdy: 0 };
        const e = .75;
        const dzdx = (host.height(x + e, y) - host.height(x - e, y)) / (2 * e);
        const dzdy = (host.height(x, y + e) - host.height(x, y - e)) / (2 * e);
        return { x, y, z: host.height(x, y), dzdx, dzdy };
    });
    return { parts, bounds: body.bounds, eyePart, eyeZ, eyeScale, eyePlanes };
}
/** Largest eye scale up to EYE_BOOST × the definition's whose drawn eyes keep EYE_BOOST_PAD from the outline. */
export function boostedEyeScale(body, eyes) {
    for (const k of [EYE_BOOST, 1.38, 1.3, 1.22, 1.15, 1.08]) {
        if (!drawnEyesFit(body.polys, { ...eyes, scale: eyes.scale * k }, 0, 0, EYE_BOOST_PAD))
            return eyes.scale * k;
    }
    return eyes.scale;
}
/** How much room the face has as the renderer will actually draw it. */
export function faceRoom(def, body = analyzeBody(def.body.path)) {
    const scale = boostedEyeScale(body, def.eyes);
    const eyes = { ...def.eyes, scale };
    const clearance = eyeClearance(body.polys, eyes);
    const gaze = gazeRange(body.polys, eyes);
    const boost = Math.round((scale / def.eyes.scale) * 100) / 100;
    const ok = boost >= EYE_BOOST - 1e-9 && clearance >= FACE_ROOM_TARGET && Math.min(gaze.left, gaze.right, gaze.up, gaze.down) === 1;
    return { boost, clearance, gaze, ok };
}
