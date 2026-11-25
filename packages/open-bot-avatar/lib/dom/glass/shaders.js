/**
 * Ray-marched glass over a sampled 3D distance field. Refraction uses IOR 1.50;
 * reflections use Schlick Fresnel and procedural studio lighting, with adjusted
 * Beer-Lambert absorption, alpha compositing and extra edge samples for the final look.
 * The environment is synthetic: this does not sample or refract the DOM behind the canvas.
 */
import { SOCKET_PAD } from '../materials/socket.js';
const float = (n) => (Number.isInteger(n) ? `${n}.` : `${n}`);
export const vertexShader = `#version 300 es
precision highp float;
const vec2 POS[3] = vec2[](vec2(-1., -1.), vec2(3., -1.), vec2(-1., 3.));
out vec2 vNdc;
void main() {
  gl_Position = vec4(POS[gl_VertexID], 0., 1.);
  vNdc = POS[gl_VertexID];
}`;
export const fragmentShader = `#version 300 es
precision highp float;
precision highp int;

in vec2 vNdc;
out vec4 result;

uniform highp sampler3D volumeField; // R16F 3D SDF (positive inside, z >= 0 mirrored)
uniform highp sampler2D eyeField;    // socket.ts signed distance tiles
uniform vec3 boxMin;                 // (x0, y0, z0) in viewBox units
uniform vec3 boxSpan;                // (spanX, spanY, spanZ) in viewBox units
uniform vec2 voxelStep;              // (stepXY, stepZ) for smooth normal gradients
uniform vec3 pivot;                  // (cx, cy, 0) in viewBox units
uniform float radius;                // half-size of orthographic render square, viewBox units
uniform float halfDepth;             // max half depth, viewBox units
uniform float bottomY;               // bottom of avatar bounds, viewBox units
uniform float pixelSize;             // viewBox units per pixel
uniform int isCapsule;               // 1 for state marks (thinking dots / blocked bar)
uniform vec2 capsuleDims;            // (radius, halfStem) for capsule marks
uniform mat3 view;                   // yaw-then-pitch rotation matrix (model -> screen, Y-down)
uniform vec3 color;                  // glass tint color (0..1)
uniform vec3 ink;                    // eye ink color (0..1)
uniform vec4 eyeRegion[2];           // face-plane center, square span, max host depth
uniform vec2 eyeSize[2];

const float FAR = ${float(SOCKET_PAD)};
const float IOR = 1.50;
const float F0  = 0.04;

// Exact 3D Signed Distance (negative inside, positive outside) directly from Volume.parts!
float mapSDF(vec3 p) {
  if (isCapsule == 1) {
    vec3 q = p - pivot;
    q.y -= clamp(q.y, -capsuleDims.y, capsuleDims.y);
    return length(q) - capsuleDims.x;
  }
  vec3 q = vec3(p.x, p.y, abs(p.z));
  vec3 boxMax = boxMin + boxSpan;
  vec3 cl = clamp(q, boxMin, boxMax);
  vec3 outVec = q - cl;
  float outDist = length(outVec);

  // Sample 3D texture at clamped coordinates; map texel centers [0..N-1] accurately
  vec3 texSize = vec3(textureSize(volumeField, 0));
  vec3 norm = (cl - boxMin) / boxSpan;
  vec3 uvw = (norm * (texSize - 1.0) + 0.5) / texSize;
  float sdInsidePos = texture(volumeField, uvw).r;

  if (outDist > 0.0001) {
    return max(-sdInsidePos, 0.0) + outDist;
  }
  return -sdInsidePos;
}

// Exact 6-tap central-difference gradient over the 3D SDF (correctly scaled for anisotropic voxelStep,
// zero mixed-derivative contamination at concave grooves/corners!).
vec3 calcNormalStride(vec3 p, float mult) {
  if (isCapsule == 1) {
    const float e = 0.12;
    return normalize(vec3(
      mapSDF(p + vec3(e, 0., 0.)) - mapSDF(p - vec3(e, 0., 0.)),
      mapSDF(p + vec3(0., e, 0.)) - mapSDF(p - vec3(0., e, 0.)),
      mapSDF(p + vec3(0., 0., e)) - mapSDF(p - vec3(0., 0., e))
    ));
  }
  float hx = voxelStep.x * mult;
  float hz = voxelStep.y * mult;
  vec3 g = vec3(
    (mapSDF(p + vec3(hx, 0., 0.)) - mapSDF(p - vec3(hx, 0., 0.))) / hx,
    (mapSDF(p + vec3(0., hx, 0.)) - mapSDF(p - vec3(0., hx, 0.))) / hx,
    (mapSDF(p + vec3(0., 0., hz)) - mapSDF(p - vec3(0., 0., hz))) / hz
  );
  float len = length(g);
  return len > 1e-5 ? g / len : vec3(0.0, 0.0, 1.0);
}

vec3 calcNormal(vec3 p) {
  return calcNormalStride(p, 0.90);
}

// Eye socket distance field (same coordinates as fluffy/shaders.ts)
float socketDistance(vec3 p, vec3 normal, out vec2 uv, out vec3 local) {
  uv = vec2(0.);
  local = vec3(0.);
  if (normal.z < 0.05 || p.z < 0.0) return FAR;
  for (int i = 0; i < 2; i++) {
    vec4 e = eyeRegion[i];
    vec2 delta = p.xy - e.xy;
    if (e.z > 0. && p.z <= e.w + 2.5 && max(abs(delta.x), abs(delta.y)) < e.z * 0.49) {
      vec2 coords = delta / e.z;
      vec2 sampleUV = (coords + 0.5 + vec2(float(i), 0.)) * vec2(0.5, 1.0);
      float d = (textureLod(eyeField, sampleUV, 0.).r - 0.5) * ${float(2 * SOCKET_PAD)};
      if (d >= 3.6) continue;
      uv = sampleUV;
      local.xy = 2.0 * delta / max(eyeSize[i], vec2(0.01));
      local.z = smoothstep(0.35, 1.5, eyeSize[i].y / max(0.01, eyeSize[i].x));
      return d;
    }
  }
  return FAR;
}

float softbox(vec3 dir, vec3 center, vec2 halfSize, float softness, float tilt) {
  vec3 c = normalize(center);
  float f = dot(dir, c);
  if (f <= 0.05) return 0.0;
  vec3 up = abs(c.y) < 0.92 ? vec3(0., -1., 0.) : vec3(1., 0., 0.);
  vec3 u = normalize(cross(up, c));
  vec3 v = cross(c, u);
  vec2 proj = vec2(dot(dir, u), dot(dir, v)) / max(f, 0.25);
  float ct = cos(tilt), st = sin(tilt);
  proj = mat2(ct, -st, st, ct) * proj;
  vec2 q = abs(proj) - halfSize;
  float dist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  return 1.0 - smoothstep(-softness, softness, dist);
}

float fresnelSchlick(float cosTheta) {
  return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

// --- Smooth Dual-Roughness 3D Studio Environment ---
vec3 sampleOuterStudio(vec3 dirS, vec3 jewelTint) {
  vec3 d = normalize(dirS);

  // Color-accurate quiet dark studio gradient
  float upFade = smoothstep(0.9, -0.9, d.y);
  vec3 baseRoom = mix(vec3(0.020), jewelTint * 0.14, 0.42) * (0.65 + 0.55 * upFade);
  float floorBounce = pow(clamp(d.y, 0.0, 1.0), 2.2);
  vec3 col = baseRoom + jewelTint * (0.42 * floorBounce);

  // Deliberate HDR White Studio Softboxes (exact convex-dome reflection angles, smoothly feathered borders)
  float keyMain      = softbox(d, vec3(-0.60, -0.74, -0.30), vec2(0.70, 0.155), 0.090, -0.52);
  float keyRim       = softbox(d, vec3(-0.24, -0.76, -0.60), vec2(0.70, 0.095), 0.075, -0.22);
  float leftShoulder = softbox(d, vec3(-0.94, -0.06, -0.32), vec2(0.105, 0.28), 0.078,  0.05);
  float leftHip      = softbox(d, vec3(-0.88,  0.42, -0.24), vec2(0.095, 0.18), 0.085, -0.18);
  float rightDome    = softbox(d, vec3( 0.56, -0.70, -0.44), vec2(0.46, 0.085), 0.080,  0.42);
  float rightStrip   = softbox(d, vec3( 0.84, -0.18, -0.50), vec2(0.095, 0.52), 0.080,  0.14);

  // Soft perimeter rim fill so curved bevels & cylindrical walls gleam smoothly at every rotation
  float sideGlow = pow(clamp(1.0 - abs(d.z), 0.0, 1.0), 1.8) * (0.55 + 0.45 * smoothstep(0.6, -0.7, d.y));
  col += vec3(1.0) * (keyMain * 13.0 + keyRim * 8.0 + leftShoulder * 7.0 + leftHip * 4.5 + rightDome * 7.2 + rightStrip * 7.8);
  col += mix(jewelTint, vec3(0.95, 1.0, 1.0), 0.48) * (sideGlow * 1.15);

  return col;
}

vec3 sampleInternalStudio(vec3 posS, vec3 dirS, vec3 jewelTint, float isTIR) {
  vec3 d = normalize(dirS);

  // Silky continuous studio cyclorama (color-accurate, zero hard horizon line)
  float upFade = smoothstep(1.0, -1.0, d.y);
  vec3 col = mix(vec3(0.022), jewelTint * 0.22, 0.55) * (0.65 + 0.50 * upFade);

  // Smoothly feathered caustic tabletop bounce beneath the figurine
  float floorRelY = (bottomY - pivot.y) + 2.8;
  if (d.y > -0.05) {
    float dySafe = max(d.y, 0.08);
    float tFloor = clamp((floorRelY - posS.y) / dySafe, 0.0, 260.0);
    vec3 fp = posS + d * tFloor;
    float r2 = dot(fp.xz, fp.xz) / (radius * radius * 0.60);
    float causticPool = exp(-r2 * 0.85);
    float hotCore     = exp(-r2 * 2.4);
    float floorFade   = smoothstep(-0.05, 0.42, d.y);
    col += jewelTint * (1.05 * causticPool + 0.48 * hotCore) * floorFade;
  }

  // Broad, ultra-soft studio light dome for luminous internal refraction & TIR
  float upperLeft = pow(max(0.0, dot(d, normalize(vec3(-0.55, -0.72, -0.42)))), 3.2);
  float rightRim  = pow(max(0.0, dot(d, normalize(vec3( 0.82, -0.25, -0.52)))), 3.6);
  float leftRim   = pow(max(0.0, dot(d, normalize(vec3(-0.88,  0.12, -0.46)))), 3.4);
  float topGlow   = pow(max(0.0, dot(d, normalize(vec3( 0.05, -0.92, -0.38)))), 3.0);

  float tirBoost = mix(0.92, 1.22, isTIR);
  col += mix(jewelTint, vec3(1.0), 0.52) * (upperLeft * 1.45 + rightRim * 1.15 + leftRim * 1.05 + topGlow * 1.10) * tirBoost;

  return col;
}

// Trace one ray through the exact 3D Volume SDF (front hit -> up to 3 internal bounces + Beer-Lambert!)
vec4 traceRay(vec2 screenXY, mat3 invView, vec3 jewelTint, vec3 absorbSigma) {
  vec3 rdS = vec3(0.0, 0.0, -1.0);
  vec3 roS = vec3(screenXY, radius * 1.25);
  vec3 ro = pivot + invView * roS;
  vec3 rd = invView * rdS;

  vec3 oc = ro - pivot;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - radius * radius;
  float disc = b * b - c;
  if (disc < 0.0) return vec4(0.0);

  float tMin = max(0.0, -b - sqrt(disc));
  float tMax = -b + sqrt(disc);
  float t = tMin;
  float tPrev = tMin;
  bool hit = false;

  for (int i = 0; i < 96; i++) {
    float d = mapSDF(ro + rd * t);
    if (d <= 0.004) {
      if (d <= 0.0) {
        hit = true;
        break;
      }
      // Verify genuine surface crossing (prevents midair false hits grazing flat parallel walls!)
      float tProbe = min(tMax, t + 0.06);
      if (mapSDF(ro + rd * tProbe) <= 0.0) {
        tPrev = t;
        t = tProbe;
        hit = true;
        break;
      }
    }
    tPrev = t;
    t += max(d * 0.78, 0.06);
    if (t > tMax) break;
  }
  if (!hit) return vec4(0.0);

  // 6-step bisection on strictly bracketed mapSDF = 0 crossing for razor-clean hit point & normals
  float lo = tPrev, hi = t;
  for (int i = 0; i < 6; i++) {
    float mid = 0.5 * (lo + hi);
    if (mapSDF(ro + rd * mid) <= 0.0) hi = mid;
    else lo = mid;
  }
  t = hi;

  vec3 p1 = ro + rd * t;
  vec3 n1 = calcNormal(p1);
  vec3 n1S = normalize(view * n1);
  vec3 p1S = view * (p1 - pivot);
  float cos1 = clamp(dot(-rd, n1), 0.0, 1.0);
  float F1 = fresnelSchlick(cos1);

  // --- Opaque Glossy Black Eyes seated cleanly on the front glass surface ---
  float eyeMask = 0.0;
  vec3 eyeColor = vec3(0.0);
  float eyeBezel = 0.0;
  if (isCapsule == 0) {
    vec2 eyeUV;
    vec3 local;
    float dEye = socketDistance(p1, n1, eyeUV, local);
    if (dEye < 1.8) {
      float lip = smoothstep(0.95, 0.04, dEye) * smoothstep(-0.06, 0.18, dEye);
      float lowerRight = smoothstep(-0.25, 0.85, local.y * 0.80 + local.x * 0.45);
      eyeBezel = lip * lowerRight;

      if (dEye < 0.35) {
        vec2 curve = clamp(local.xy * 0.90, vec2(-0.96), vec2(0.96));
        vec3 dome = normalize(vec3(curve, sqrt(max(0.04, 1.0 - dot(curve, curve)))));
        vec3 beadN = normalize(view * dome);
        vec3 beadRefl = reflect(rdS, beadN);
        float beadSpec = softbox(beadRefl, vec3(-0.52, -0.68, 0.52), vec2(0.22, 0.28), 0.10, -0.35);
        eyeColor = ink * 0.12 + vec3(1.0) * (beadSpec * 1.45);
        float aa = max(0.10, pixelSize * 1.2);
        eyeMask = 1.0 - smoothstep(-aa * 0.5, aa * 0.5, dEye);
      }
    }
  }

  // --- 1. External Fresnel Reflection (crisp un-tinted HDR studio softboxes) ---
  vec3 reflDirS = reflect(rdS, n1S);
  vec3 extRefl = sampleOuterStudio(reflDirS, jewelTint);
  vec3 accum = extRefl * F1;

  // --- 2. Physical Internal Glass Path (Snell Refraction + Back-Wall Exit + Continuous Maxwell TIR) ---
  vec3 rayPos = p1 - n1 * 0.05;
  vec3 rayDir = refract(rd, n1, 1.0 / IOR);
  float weight = 1.0 - F1;
  float directTrans = 0.0;
  float tirEnergy = 0.0;

  if (length(rayDir) < 0.001) {
    rayDir = reflect(rd, n1);
    accum += sampleOuterStudio(view * rayDir, jewelTint) * weight;
  } else {
    rayDir = normalize(rayDir);
    vec3 pStart = rayPos + rayDir * 0.05;

    if (mapSDF(pStart) > 0.0) {
      // Sub-pixel razor-thin grazing edge: clean pass-through with no false bounce
      vec3 exitDirS = normalize(view * rayDir);
      vec3 envOut = sampleInternalStudio(p1S, exitDirS, jewelTint, 0.0);
      accum += envOut * weight;
      directTrans = weight * smoothstep(0.10, -0.70, exitDirS.z);
    } else {
      float s = 0.0;
      float sPrev = 0.0;
      float maxDist = max(halfDepth * 4.5, radius * 2.4);
      bool exited = false;

      for (int stepIdx = 0; stepIdx < 96; stepIdx++) {
        vec3 q = pStart + rayDir * s;
        float d = mapSDF(q);
        if (d > 0.0) {
          exited = true;
          break;
        }
        sPrev = s;
        s += max(-d * 0.78, 0.10);
        if (s > maxDist) break;
      }

      if (exited) {
        float lo = sPrev, hi = s;
        for (int bStep = 0; bStep < 5; bStep++) {
          float mid = 0.5 * (lo + hi);
          if (mapSDF(pStart + rayDir * mid) > 0.0) hi = mid;
          else lo = mid;
        }
        s = hi;
      }

      float totalPath = s + 0.06;
      vec3 pExit = pStart + rayDir * s;
      vec3 pExitS = view * (pExit - pivot);

      // Smooth optical thickness compression so thick bodies stay just as crystal-clear as thin ears
      float refScale = max(halfDepth * 2.2, 14.0);
      float opticalDist = totalPath / (refScale + totalPath * 0.30);
      vec3 beer = exp(-absorbSigma * opticalDist);

      if (!exited) {
        vec3 exitDirS = normalize(view * rayDir);
        accum += sampleInternalStudio(pExitS, exitDirS, jewelTint, 0.0) * beer * weight;
        directTrans = weight * smoothstep(0.10, -0.70, exitDirS.z);
      } else {
        vec3 nOut = calcNormalStride(pExit, 1.15);
        vec3 nIn = -nOut;
        vec3 reflDir = normalize(reflect(rayDir, nIn));
        vec3 reflEnv = sampleInternalStudio(pExitS, view * reflDir, jewelTint, 1.0);
        vec3 beerTIR = exp(-absorbSigma * (opticalDist * 1.22));

        vec3 exitDir = refract(rayDir, nIn, IOR);
        if (length(exitDir) < 0.001) {
          // Pure Total Internal Reflection (smoothly joined with F_exit -> 1.0 below!)
          tirEnergy = weight * 0.65;
          accum += reflEnv * beerTIR * weight;
        } else {
          exitDir = normalize(exitDir);
          // Exact Maxwell/Schlick Fresnel for glass->air using transmitted air-side cosine (zero TIR cliff!)
          float cosTrans = clamp(dot(exitDir, nOut), 0.0, 1.0);
          float F_exit = fresnelSchlick(cosTrans);

          vec3 exitDirS = normalize(view * exitDir);
          vec3 envOut = sampleInternalStudio(pExitS, exitDirS, jewelTint, 0.0);
          float exitWeight = weight * (1.0 - F_exit);
          float reflWeight = weight * F_exit;

          accum += envOut * beer * exitWeight + reflEnv * beerTIR * reflWeight;
          directTrans = exitWeight * smoothstep(0.10, -0.70, exitDirS.z);
          tirEnergy = reflWeight * 0.65;
        }
      }
    }
  }

  accum += mix(jewelTint, vec3(1.0), 0.55) * (eyeBezel * 1.05);

  float peak = max(accum.r, max(accum.g, accum.b));
  vec3 col = accum;
  if (peak > 0.0001) {
    float mapped = peak / (1.0 + peak * 0.48);
    col = accum * (mapped / peak);
    float whiteRoll = smoothstep(2.2, 5.2, peak);
    col = mix(col, vec3(mapped), whiteRoll * 0.80);
  }

  float lum = max(col.r, max(col.g, col.b));
  float edgeTransparency = mix(0.36, 0.68, pow(1.0 - cos1, 1.55));
  float alpha = clamp(
    edgeTransparency
    - 0.12 * clamp(directTrans, 0.0, 1.0)
    + 0.52 * smoothstep(0.16, 0.90, lum)
    + 0.16 * clamp(tirEnergy, 0.0, 1.0),
    0.28,
    0.98
  );

  if (eyeMask > 0.001) {
    float ePeak = max(eyeColor.r, max(eyeColor.g, eyeColor.b));
    vec3 eMapped = ePeak > 0.0001 ? eyeColor * ((ePeak / (1.0 + ePeak * 0.4)) / ePeak) : vec3(0.0);
    col = mix(col, eMapped, eyeMask);
    alpha = mix(alpha, 1.0, eyeMask);
  }

  col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
  return vec4(col * alpha, alpha);
}

void main() {
  vec2 screenXY = vec2(vNdc.x, -vNdc.y) * radius;
  mat3 invView = transpose(view);

  float maxC = max(color.r, max(color.g, color.b));
  float minC = min(color.r, min(color.g, color.b));
  float sat = maxC > 0.001 ? (maxC - minC) / maxC : 0.0;
  vec3 pureHue = maxC > 0.05 ? (color / maxC) : vec3(0.88, 0.94, 0.97);
  vec3 jewelTint = mix(vec3(0.88, 0.94, 0.97), pureHue, clamp(sat * 1.08, 0.0, 1.0));
  vec3 transColor = mix(vec3(0.97), jewelTint, clamp(sat * 0.88, 0.0, 1.0));
  vec3 absorbSigma = -log(max(transColor, vec3(0.12))) * 0.62 + vec3(0.08);

  // Quick ray-probe near silhouette to trigger 2x2 rotated-grid supersampling (RGSS) on edges
  vec3 probePos = pivot + invView * vec3(screenXY, 0.0);
  float edgeDist = abs(mapSDF(probePos));

  if (pixelSize < 0.85 && edgeDist < max(3.5, pixelSize * 3.5)) {
    vec2 o1 = vec2( 0.375,  0.125) * pixelSize;
    vec2 o2 = vec2(-0.125,  0.375) * pixelSize;
    vec2 o3 = vec2(-0.375, -0.125) * pixelSize;
    vec2 o4 = vec2( 0.125, -0.375) * pixelSize;
    result = 0.25 * (
      traceRay(screenXY + o1, invView, jewelTint, absorbSigma) +
      traceRay(screenXY + o2, invView, jewelTint, absorbSigma) +
      traceRay(screenXY + o3, invView, jewelTint, absorbSigma) +
      traceRay(screenXY + o4, invView, jewelTint, absorbSigma)
    );
  } else {
    result = traceRay(screenXY, invView, jewelTint, absorbSigma);
  }
}`;
