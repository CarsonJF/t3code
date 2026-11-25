/**
 * Glass rendering over a sampled 3D distance field built from the existing Volume parts.
 * Inflate parts receive a smoothed interior bevel; revolved parts retain their axes and depth.
 * The field is stored as a mirror-symmetric R16F texture and shaded by ray marching.
 */
import { EdgeIndex } from '../../distance.js';
import { edgeBands } from '../../path.js';
import { halfDepth } from '../materials/shape.js';
import { SOCKET_TILE, exposedHeight, socketKey, socketRegion, socketTile } from '../materials/socket.js';
import { fragmentShader, vertexShader } from './shaders.js';
const isCapsule = (shape) => 'radius' in shape;
const MAX_PIXELS = 1024;
const MIN_PIXELS = 32;
/** 3D SDF grid dimensions (Z stores z >= 0 with 1 ghost slice at -stepZ for exact C1 equator symmetry). */
const GRID_HI = { xy: 104, z: 36 };
const GRID_LO = { xy: 48, z: 18 };
const VOL_PAD = 4.5;
const GLASS_REACH = 4;
const SOCKET_RISE = 0.8;
const SAME_VIEW = 0.06;
const KEPT_SHAPES = 32;
const IDLE_MS = 6000;
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
function toHalf(val) {
    f32[0] = val;
    const x = u32[0];
    const sign = (x >> 16) & 0x8000;
    const exp = ((x >> 23) & 0xff) - 127 + 15;
    const mant = (x >> 13) & 0x03ff;
    if (exp <= 0)
        return sign;
    if (exp >= 31)
        return sign | 0x7c00;
    return sign | (exp << 10) | mant;
}
/** Smooth max (for C2-smooth glass fillets and fused multi-part glass joints). */
function smax(a, b, k) {
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.max(a, b) + h * h * k * 0.25;
}
/**
 * Evaluate one VolumePart's exact 3D signed distance (positive inside, negative outside) into `field`.
 * Preserves every part's true 3D geometry (inflate rounded slab, revolve-y lathe, revolve-x lathe)
 * with fire-polished C2 glass fillets so reflections stay silky without altering the bot's silhouette!
 */
function addGlassPart(field, part, x0, y0, z0, stepXY, stepZ, nxy, nz, firstPart) {
    const plane = nxy * nxy;
    const index = new EdgeIndex(part.polys, part.bounds);
    const bands = edgeBands(part.polys);
    const dist2d = index.distances({ x0, y0, step: stepXY, nx: nxy, ny: nxy });
    const xs = Array.from({ length: nxy }, (_, i) => x0 + i * stepXY);
    const row = new Uint8Array(nxy);
    // Build signed 2D distance (positive inside) once for this part
    const sd2d = new Float32Array(plane);
    for (let j = 0; j < nxy; j++) {
        bands.insideRow(y0 + j * stepXY, xs, row);
        const off = j * nxy;
        for (let i = 0; i < nxy; i++) {
            sd2d[off + i] = row[i] ? dist2d[off + i] : -dist2d[off + i];
        }
    }
    // Bilinear lookup into sd2d for exact 3D solid-of-revolution SDF:
    // revolve-y: d3d(x, y, z) = sd2d(axis + hypot(x - axis, z / zScale), y)
    // revolve-x: d3d(x, y, z) = sd2d(x, axis + hypot(y - axis, z / zScale))
    const sampleSD2D = (px, py) => {
        const fx = (px - x0) / stepXY;
        const fy = (py - y0) / stepXY;
        const ix = Math.max(0, Math.min(nxy - 2, Math.floor(fx)));
        const iy = Math.max(0, Math.min(nxy - 2, Math.floor(fy)));
        const tx = Math.max(0, Math.min(1, fx - ix));
        const ty = Math.max(0, Math.min(1, fy - iy));
        const o = iy * nxy + ix;
        const a = sd2d[o] * (1 - tx) + sd2d[o + 1] * tx;
        const b = sd2d[o + nxy] * (1 - tx) + sd2d[o + nxy + 1] * tx;
        return a * (1 - ty) + b * ty;
    };
    // Smooth union radius where separate parts meet (clean blown-glass fillet, preserves exact shape)
    const joinK = 1.1;
    if (part.kind === 'revolve-y' && part.axis !== undefined) {
        const axis = part.axis;
        const zScale = part.thickness > 0.01 ? part.depth / part.thickness : 1;
        const invZ = zScale > 0.01 ? 1 / zScale : 1;
        for (let j = 0; j < nxy; j++) {
            const y = y0 + j * stepXY;
            const off = j * nxy;
            for (let i = 0; i < nxy; i++) {
                const dx = x0 + i * stepXY - axis;
                for (let k = 0; k < nz; k++) {
                    const z = Math.abs(z0 + k * stepZ) * invZ;
                    const rho = Math.hypot(dx, z);
                    const d = sampleSD2D(axis + rho, y) * Math.min(1, zScale);
                    const at = off + i + k * plane;
                    field[at] = firstPart ? d : smax(field[at], d, joinK);
                }
            }
        }
        return;
    }
    if (part.kind === 'revolve-x' && part.axis !== undefined) {
        const axis = part.axis;
        const zScale = part.thickness > 0.01 ? part.depth / part.thickness : 1;
        const invZ = zScale > 0.01 ? 1 / zScale : 1;
        for (let j = 0; j < nxy; j++) {
            const dy = y0 + j * stepXY - axis;
            const off = j * nxy;
            for (let i = 0; i < nxy; i++) {
                const x = x0 + i * stepXY;
                for (let k = 0; k < nz; k++) {
                    const z = Math.abs(z0 + k * stepZ) * invZ;
                    const rho = Math.hypot(dy, z);
                    const d = sampleSD2D(x, axis + rho) * Math.min(1, zScale);
                    const at = off + i + k * plane;
                    field[at] = firstPart ? d : smax(field[at], d, joinK);
                }
            }
        }
        return;
    }
    // Inflate part: exact VolumePart depth & elliptical edge fillet (rxy, rz).
    // Solve screened Poisson (s - L^2 * Delta(s) = min(sd2d, rCap), s = 0 on exact outline via
    // Shortley-Weller cut-cell fractions) inside the 2D part. This keeps the exact 2D silhouette and
    // true thickness (zero ballooning) while melting away interior medial-axis corner ridges and the
    // bevel-to-flat seam into C-infinity optical-grade blown glass!
    const half = part.depth / 2;
    const rxy = Math.max(1.2, part.rxy);
    const rz = Math.max(1.2, part.rz);
    const scale = Math.min(rxy, rz);
    const flatZ = Math.max(0, half - rz);
    const rCap = rxy * 1.08;
    const smoothL = Math.max(stepXY * 1.4, Math.min(rxy * 0.28, 3.4));
    const cLap = 2 * (smoothL / stepXY) * (smoothL / stepXY);
    const pb = part.bounds;
    const iMin = Math.max(1, Math.floor((pb.minX - x0) / stepXY) - 1);
    const iMax = Math.min(nxy - 2, Math.ceil((pb.maxX - x0) / stepXY) + 1);
    const jMin = Math.max(1, Math.floor((pb.minY - y0) / stepXY) - 1);
    const jMax = Math.min(nxy - 2, Math.ceil((pb.maxY - y0) / stepXY) + 1);
    const sSmooth = new Float32Array(plane);
    for (let j = jMin; j <= jMax; j++) {
        const off = j * nxy;
        for (let i = iMin; i <= iMax; i++) {
            const sd = sd2d[off + i];
            if (sd > 0)
                sSmooth[off + i] = Math.min(sd, rCap);
        }
    }
    // Smooth the interior bevel with 16 Gauss-Seidel SOR passes.
    const omega = 1.25;
    for (let iter = 0; iter < 16; iter++) {
        for (let j = jMin; j <= jMax; j++) {
            const off = j * nxy;
            for (let i = iMin; i <= iMax; i++) {
                const idx = off + i;
                const sd = sd2d[idx];
                if (sd <= 0)
                    continue;
                const sdL = sd2d[idx - 1];
                const sdR = sd2d[idx + 1];
                const sdU = sd2d[idx - nxy];
                const sdD = sd2d[idx + nxy];
                const tL = sdL > 0 ? 1 : Math.max(0.15, sd / (sd - sdL));
                const tR = sdR > 0 ? 1 : Math.max(0.15, sd / (sd - sdR));
                const tU = sdU > 0 ? 1 : Math.max(0.15, sd / (sd - sdU));
                const tD = sdD > 0 ? 1 : Math.max(0.15, sd / (sd - sdD));
                const vL = sdL > 0 ? sSmooth[idx - 1] : 0;
                const vR = sdR > 0 ? sSmooth[idx + 1] : 0;
                const vU = sdU > 0 ? sSmooth[idx - nxy] : 0;
                const vD = sdD > 0 ? sSmooth[idx + nxy] : 0;
                const denom = 1 + cLap * (1 / (tL * tR) + 1 / (tU * tD));
                const numer = Math.min(sd, rCap) +
                    cLap *
                        (vL / (tL * (tL + tR)) +
                            vR / (tR * (tL + tR)) +
                            vU / (tU * (tU + tD)) +
                            vD / (tD * (tU + tD)));
                const next = numer / denom;
                sSmooth[idx] += omega * (next - sSmooth[idx]);
            }
        }
    }
    for (let j = 0; j < nxy; j++) {
        const off = j * nxy;
        for (let i = 0; i < nxy; i++) {
            const sd = sd2d[off + i];
            const sdEff = sd > 0 ? sSmooth[off + i] : sd;
            // Subtle C-infinity convex polish across flat front face (~0.75 units max, preserves exact shape)
            const crown = sd > 0 ? 0.055 * sdEff : 0;
            const side = smax((rxy - sdEff) / rxy, 0, 0.28);
            for (let k = 0; k < nz; k++) {
                const z = Math.abs(z0 + k * stepZ);
                const top = Math.max(0, (z - (flatZ + crown)) / rz);
                const d = (1 - Math.hypot(side, top)) * scale;
                const at = off + i + k * plane;
                field[at] = firstPart ? d : smax(field[at], d, joinK);
            }
        }
    }
}
/** Bake a Volume into a mirror-symmetric 3D R16F signed-distance texture (positive inside). */
function bakeVolume3D(vol, nxy, nz) {
    const b = vol.bounds;
    const maxHalfZ = Math.max(2, ...vol.parts.map((p) => p.depth / 2)) + 1.0;
    const spanX = b.maxX - b.minX + 2 * VOL_PAD;
    const spanY = b.maxY - b.minY + 2 * VOL_PAD;
    const spanXY = Math.max(spanX, spanY);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const x0 = cx - spanXY / 2;
    const y0 = cy - spanXY / 2;
    const stepXY = spanXY / (nxy - 1);
    // Place z = 0 at k = 1, z = -stepZ at k = 0 (mirror of k = 2), so trilinear interpolation across z = 0 is exact!
    const zMax = maxHalfZ + VOL_PAD;
    const stepZ = zMax / (nz - 2);
    const z0 = -stepZ;
    const spanZ = stepZ * (nz - 1);
    const plane = nxy * nxy;
    const field = new Float32Array(plane * nz).fill(-1000);
    vol.parts.forEach((part, idx) => {
        addGlassPart(field, part, x0, y0, z0, stepXY, stepZ, nxy, nz, idx === 0);
    });
    // Three gentle separable 3D Gaussian passes suppress trilinear grid ripples while keeping silhouettes crisp!
    const tmp = new Float32Array(field.length);
    for (let pass = 0; pass < 3; pass++) {
        // X pass
        for (let k = 0; k < nz; k++) {
            const ko = k * plane;
            for (let j = 0; j < nxy; j++) {
                const ro = ko + j * nxy;
                for (let i = 0; i < nxy; i++) {
                    const im = i > 0 ? i - 1 : 0;
                    const ip = i < nxy - 1 ? i + 1 : nxy - 1;
                    tmp[ro + i] = 0.13 * field[ro + im] + 0.74 * field[ro + i] + 0.13 * field[ro + ip];
                }
            }
        }
        // Y pass
        for (let k = 0; k < nz; k++) {
            const ko = k * plane;
            for (let j = 0; j < nxy; j++) {
                const jm = ko + (j > 0 ? j - 1 : 0) * nxy;
                const j0 = ko + j * nxy;
                const jp = ko + (j < nxy - 1 ? j + 1 : nxy - 1) * nxy;
                for (let i = 0; i < nxy; i++) {
                    field[j0 + i] = 0.13 * tmp[jm + i] + 0.74 * tmp[j0 + i] + 0.13 * tmp[jp + i];
                }
            }
        }
        // Z pass (respecting symmetry at k = 1 -> k = 0 mirrors k = 2)
        for (let k = 1; k < nz; k++) {
            const km = (k === 1 ? 2 : k - 1) * plane;
            const k0 = k * plane;
            const kp = (k < nz - 1 ? k + 1 : nz - 1) * plane;
            for (let p = 0; p < plane; p++) {
                tmp[k0 + p] = 0.13 * field[km + p] + 0.74 * field[k0 + p] + 0.13 * field[kp + p];
            }
        }
        for (let p = 0; p < plane; p++)
            tmp[p] = tmp[2 * plane + p];
        field.set(tmp);
    }
    const data = new Uint16Array(field.length);
    for (let i = 0; i < field.length; i++)
        data[i] = toHalf(field[i]);
    return {
        data,
        boxMin: [x0, y0, z0],
        boxSpan: [spanXY, spanXY, spanZ],
        voxelStep: [stepXY, stepZ],
        halfDepth: maxHalfZ,
        bottomY: b.maxY,
    };
}
function link(gl, vertex, fragment) {
    const program = gl.createProgram();
    for (const [kind, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
        const shader = gl.createShader(kind);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
            throw new Error(gl.getShaderInfoLog(shader) ?? 'glass shader compilation failed');
        gl.attachShader(program, shader);
        gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw new Error(gl.getProgramInfoLog(program) ?? 'glass shader linking failed');
    return program;
}
function colorReader() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const known = new Map();
    return (color) => {
        let rgb = known.get(color);
        if (!rgb) {
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = '#000';
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, 1, 1);
            const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
            rgb = [r, g, b];
            if (known.size >= 64)
                known.clear();
            known.set(color, rgb);
        }
        return rgb;
    };
}
function createRenderer(onContextRestored) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = MIN_PIXELS;
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: true });
    if (!gl)
        return null;
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    canvas.addEventListener('webglcontextrestored', onContextRestored);
    const program = link(gl, vertexShader, fragmentShader);
    gl.useProgram(program);
    const uniform = (name) => gl.getUniformLocation(program, name);
    const u = {
        volumeField: uniform('volumeField'),
        eyeField: uniform('eyeField'),
        boxMin: uniform('boxMin'),
        boxSpan: uniform('boxSpan'),
        voxelStep: uniform('voxelStep'),
        pivot: uniform('pivot'),
        radius: uniform('radius'),
        halfDepth: uniform('halfDepth'),
        bottomY: uniform('bottomY'),
        pixelSize: uniform('pixelSize'),
        isCapsule: uniform('isCapsule'),
        capsuleDims: uniform('capsuleDims'),
        view: uniform('view'),
        color: uniform('color'),
        ink: uniform('ink'),
        eyeRegion: uniform('eyeRegion[0]'),
        eyeSize: uniform('eyeSize[0]'),
    };
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.enable(gl.SCISSOR_TEST);
    gl.uniform1i(u.volumeField, 0);
    gl.activeTexture(gl.TEXTURE1);
    const eyeTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, eyeTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, 2 * SOCKET_TILE, SOCKET_TILE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(u.eyeField, 1);
    // Fallback 1x1x1 3D texture for capsule state marks
    const dummyTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, dummyTex);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R16F, 1, 1, 1, 0, gl.RED, gl.HALF_FLOAT, new Uint16Array([0]));
    const shapes = new Map();
    let sweepPending = false;
    const upload = (shape, grid) => {
        const b = shape.bounds;
        const rx = (b.maxX - b.minX) / 2;
        const ry = (b.maxY - b.minY) / 2;
        const cx = b.minX + rx;
        const cy = b.minY + ry;
        if (isCapsule(shape)) {
            const rz = halfDepth(shape);
            const radius = Math.ceil(Math.hypot(rx, ry, rz) + GLASS_REACH);
            return {
                texture: null,
                gridXY: 1,
                boxMin: [0, 0, 0],
                boxSpan: [1, 1, 1],
                voxelStep: [1, 1],
                cx, cy, bottomY: b.maxY, radius,
                halfDepth: rz,
                capsule: true,
                capsuleDims: [shape.radius, Math.max(0, b.maxY - shape.radius)],
                usedAt: 0,
            };
        }
        const baked = bakeVolume3D(shape, grid.xy, grid.z);
        const radius = Math.ceil(Math.hypot(rx, ry, baked.halfDepth) + GLASS_REACH);
        const tex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_3D, tex);
        gl.texImage3D(gl.TEXTURE_3D, 0, gl.R16F, grid.xy, grid.xy, grid.z, 0, gl.RED, gl.HALF_FLOAT, baked.data);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
        return {
            texture: tex,
            gridXY: grid.xy,
            boxMin: baked.boxMin,
            boxSpan: baked.boxSpan,
            voxelStep: baked.voxelStep,
            cx, cy, bottomY: baked.bottomY, radius,
            halfDepth: baked.halfDepth,
            capsule: false,
            capsuleDims: [0, 0],
            usedAt: 0,
        };
    };
    const sweep = () => {
        const now = performance.now();
        for (const [shape, baked] of shapes) {
            if (shapes.size <= KEPT_SHAPES)
                return;
            if (now - baked.usedAt < IDLE_MS)
                continue;
            if (baked.texture)
                gl.deleteTexture(baked.texture);
            shapes.delete(shape);
        }
        if (!sweepPending) {
            sweepPending = true;
            setTimeout(() => { sweepPending = false; sweep(); }, IDLE_MS);
        }
    };
    const shapeOf = (shape, wantHi) => {
        const desired = wantHi ? GRID_HI : GRID_LO;
        let baked = shapes.get(shape);
        if (baked && (!wantHi || baked.gridXY >= GRID_HI.xy || baked.capsule)) {
            shapes.delete(shape);
        }
        else {
            if (baked?.texture)
                gl.deleteTexture(baked.texture);
            baked = upload(shape, desired);
        }
        shapes.set(shape, baked);
        baked.usedAt = performance.now();
        if (shapes.size > KEPT_SHAPES)
            sweep();
        return baked;
    };
    const regions = new Float32Array(8);
    const sizes = new Float32Array(4);
    const scratch = document.createElement('canvas');
    scratch.width = scratch.height = SOCKET_TILE;
    const scratchCtx = scratch.getContext('2d', { willReadFrequently: true });
    const tiles = new Map();
    const tileOf = (mark, key) => {
        let tile = tiles.get(key);
        if (!tile) {
            tile = socketTile(scratchCtx, mark);
            if (tiles.size >= 48)
                tiles.delete(tiles.keys().next().value);
            tiles.set(key, tile);
        }
        return tile;
    };
    const readColor = colorReader();
    const shown = {
        baked: null,
        view: null,
        pixels: 0,
        color: '',
        ink: '',
        regions: new Float32Array(8),
        contours: ['', ''],
    };
    return (shape, view, look, scale) => {
        if (gl.isContextLost())
            return null;
        const baked = shapeOf(shape, scale >= 1.4);
        const { cx, cy, radius } = baked;
        const pixels = Math.min(MAX_PIXELS, Math.max(MIN_PIXELS, Math.ceil(2 * radius * scale)));
        if (canvas.width < pixels)
            canvas.width = canvas.height = pixels;
        const image = { canvas, x: 0, y: canvas.height - pixels, size: pixels, cx, cy, radius };
        const eyeZ = 'eyeZ' in shape ? shape.eyeZ : [];
        regions.fill(0);
        const contours = ['', ''];
        look.eyes.forEach(({ mark, dx, dy }, slot) => {
            const region = socketRegion(mark);
            regions.set([region.cx + dx, region.cy + dy, region.span, (eyeZ[slot] ?? 0) + SOCKET_RISE], 4 * slot);
            sizes.set([region.w, region.h * exposedHeight(region.w, region.h)], 2 * slot);
            contours[slot] = socketKey(mark);
        });
        const turn = shown.view
            ? Math.abs(view.cY - shown.view.cY) + Math.abs(view.sY - shown.view.sY) + Math.abs(view.sP - shown.view.sP) + Math.abs(view.cP - shown.view.cP)
            : Infinity;
        if (shown.baked === baked && shown.pixels === pixels && shown.color === look.color && shown.ink === look.ink &&
            contours.every((k, slot) => k === shown.contours[slot]) && regions.every((v, i) => v === shown.regions[i]) &&
            turn < SAME_VIEW / (radius * scale)) {
            return image;
        }
        shown.baked = baked;
        shown.view = view;
        shown.pixels = pixels;
        shown.color = look.color;
        shown.ink = look.ink;
        shown.regions.set(regions);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, eyeTex);
        look.eyes.forEach(({ mark }, slot) => {
            if (contours[slot] === shown.contours[slot])
                return;
            gl.texSubImage2D(gl.TEXTURE_2D, 0, slot * SOCKET_TILE, 0, SOCKET_TILE, SOCKET_TILE, gl.RED, gl.UNSIGNED_BYTE, tileOf(mark, contours[slot]));
        });
        shown.contours = contours;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_3D, baked.texture ?? dummyTex);
        gl.uniform4fv(u.eyeRegion, regions);
        gl.uniform2fv(u.eyeSize, sizes);
        gl.uniform3fv(u.boxMin, baked.boxMin);
        gl.uniform3fv(u.boxSpan, baked.boxSpan);
        gl.uniform2fv(u.voxelStep, baked.voxelStep);
        gl.uniform3f(u.pivot, cx, cy, 0);
        gl.uniform1f(u.radius, radius);
        gl.uniform1f(u.halfDepth, baked.halfDepth);
        gl.uniform1f(u.bottomY, baked.bottomY);
        gl.uniform1f(u.pixelSize, (2 * radius) / pixels);
        gl.uniform1i(u.isCapsule, baked.capsule ? 1 : 0);
        gl.uniform2fv(u.capsuleDims, baked.capsuleDims);
        const [r, g, b] = readColor(look.color);
        gl.uniform3f(u.color, r / 255, g / 255, b / 255);
        const [inkR, inkG, inkB] = readColor(look.ink);
        gl.uniform3f(u.ink, inkR / 255, inkG / 255, inkB / 255);
        gl.uniformMatrix3fv(u.view, false, [view.cY, view.sY * view.sP, -view.sY * view.cP, 0, view.cP, view.sP, view.sY, -view.cY * view.sP, view.facing]);
        gl.viewport(0, 0, pixels, pixels);
        gl.scissor(0, 0, pixels, pixels);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        return image;
    };
}
let renderer;
export function renderGlass(shape, view, look, scale) {
    if (renderer === undefined) {
        renderer = null;
        try {
            renderer = createRenderer(() => (renderer = undefined));
        }
        catch (error) {
            console.warn('open-bot-avatar: glass is unavailable, drawing flat', error);
        }
    }
    return renderer?.(shape, view, look, scale) ?? null;
}
