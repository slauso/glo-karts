/**
 * road-geometry.js — Polished segment visuals.
 *
 * Each builder returns a THREE.Group whose shape closely traces a smooth
 * road centerline using ExtrudeGeometry along a CatmullRom/arc path.
 * Visuals are decoupled from the cannon-es collision blocks defined in
 * segments.js (which still use axis-aligned boxes).
 */
import * as THREE from 'three';
import { TILE, ROAD_WIDTH, ROAD_THICK, WALL_HEIGHT, WALL_THICK, PLATEAU_HEIGHT, BRIDGE_DECK_HEIGHT, BRIDGE_RAMP_CELLS, SEGMENTS } from './segments.js';

// ── Materials (cached, shared) ────────────────────────────────────
// Textures are generated lazily on first access (IIFE deferred behind a
// getter) to avoid 3 × 256×256 canvas pixel-write loops at module import
// time — those used to fire synchronously while the editor was loading,
// stalling the browser for ~50 ms before any frame was painted.
let _TEX = null;
function getTEX() {
  if (_TEX) return _TEX;
  const make = (size, fn) => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    fn(img.data, size);
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    // Max anisotropy avoids the moiré stripe artifact on the asphalt at
    // grazing camera angles (was producing horizontal scan-line stripes).
    t.anisotropy = 16;
    return t;
  };
  // Asphalt grain — speckle of dark gray on slightly lighter gray
  const asphalt = make(256, (data, size) => {
    for (let i = 0; i < size * size; i++) {
      const v = 36 + Math.floor(Math.random() * 22);
      data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v + 2; data[i * 4 + 3] = 255;
    }
  });
  // Asphalt roughness — same noise used inverted; rougher where darker
  const asphaltRough = make(256, (data, size) => {
    for (let i = 0; i < size * size; i++) {
      const v = 200 + Math.floor(Math.random() * 50);
      data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
    }
  });
  // Concrete (lighter, smoother)
  const concrete = make(256, (data, size) => {
    for (let i = 0; i < size * size; i++) {
      const v = 130 + Math.floor(Math.random() * 26);
      data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v - 4; data[i * 4 + 3] = 255;
    }
  });
  _TEX = { asphalt, asphaltRough, concrete };
  return _TEX;
}

let _MATS = null;
function getMats() {
  if (_MATS) return _MATS;
  const TEX = getTEX();
  _MATS = {
    // Use DoubleSide on the asphalt: the extruded-ribbon top/bottom face
    // winding depends on path tangent direction and is inverted for some
    // segment shapes (straight had top quads CCW-from-below, so backface
    // culling hid the deck top from above). DoubleSide is robust regardless
    // of curve orientation and the perf cost is trivial for road geometry.
    asphalt: new THREE.MeshStandardMaterial({
      color: 0x2a2d33, map: TEX.asphalt, roughnessMap: TEX.asphaltRough,
      roughness: 0.95, metalness: 0.02, side: THREE.DoubleSide,
    }),
    asphaltDark: new THREE.MeshStandardMaterial({
      color: 0x1a1c20, map: TEX.asphalt, roughness: 0.92, metalness: 0.02,
      side: THREE.DoubleSide,
    }),
    concrete: new THREE.MeshStandardMaterial({
      color: 0x8b8e95, map: TEX.concrete, roughness: 0.78, metalness: 0.05,
      side: THREE.DoubleSide,
    }),
    curbRed: new THREE.MeshStandardMaterial({
      color: 0xd0312d, roughness: 0.5, metalness: 0.0, emissive: 0x2a0000, emissiveIntensity: 0.4,
    }),
    curbWhite: new THREE.MeshStandardMaterial({
      color: 0xf2f2f2, roughness: 0.5, metalness: 0.0, emissive: 0x222222, emissiveIntensity: 0.3,
    }),
    paintYellow: new THREE.MeshStandardMaterial({
      color: 0xfbbf24, roughness: 0.45, metalness: 0.0, emissive: 0x3a2a00, emissiveIntensity: 0.6,
    }),
    paintWhite: new THREE.MeshStandardMaterial({
      color: 0xeeeeee, roughness: 0.45, metalness: 0.0, emissive: 0x222222, emissiveIntensity: 0.3,
    }),
    guardrail: new THREE.MeshStandardMaterial({
      color: 0xaab0bb, roughness: 0.55, metalness: 0.45,
    }),
    truss: new THREE.MeshStandardMaterial({
      color: 0x6c727f, roughness: 0.6, metalness: 0.5,
    }),
    finish: new THREE.MeshStandardMaterial({
      color: 0xfbbf24, roughness: 0.5, metalness: 0.2, emissive: 0x664400, emissiveIntensity: 0.7,
    }),
    spawn: new THREE.MeshStandardMaterial({
      color: 0x00e5ff, roughness: 0.3, metalness: 0.1, emissive: 0x006688, emissiveIntensity: 1.0,
    }),
    tunnelRoof: new THREE.MeshStandardMaterial({
      color: 0x21252c, roughness: 0.7, metalness: 0.2, side: THREE.DoubleSide,
    }),
    warning: new THREE.MeshStandardMaterial({
      color: 0xffcc00, roughness: 0.5, metalness: 0.0, emissive: 0x442200, emissiveIntensity: 0.5,
    }),
    wallConcrete: new THREE.MeshStandardMaterial({
      color: 0x9aa0a8, map: TEX.concrete, roughness: 0.85, metalness: 0.04,
    }),
    wallCap: new THREE.MeshStandardMaterial({
      color: 0x40464e, roughness: 0.7, metalness: 0.18,
    }),
    wallReflector: new THREE.MeshStandardMaterial({
      color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 0.85,
      roughness: 0.45, metalness: 0.1,
    }),
  };
  return _MATS;
}
// Backward-compatible alias — functions that reference MATS.xxx get the
// lazily-initialised instance on first call instead of at import time.
const MATS = new Proxy({}, { get: (_t, k) => getMats()[k] });

// ── Road cross-section profile ────────────────────────────────────
function makeDeckProfile(width = ROAD_WIDTH, thickness = ROAD_THICK, chamfer = 0.18) {
  const w = width / 2, t = thickness, c = chamfer;
  const s = new THREE.Shape();
  s.moveTo(-w + c, 0);
  s.lineTo(w - c, 0);
  s.lineTo(w, c);
  s.lineTo(w, t - c);
  s.lineTo(w - c, t);
  s.lineTo(-w + c, t);
  s.lineTo(-w, t - c);
  s.lineTo(-w, c);
  s.closePath();
  return s;
}
const DECK_PROFILE = makeDeckProfile();

// Curb cross-section: low triangular wedge sloping outward from road
function makeCurbProfile(height = 0.18, width = 0.55) {
  const s = new THREE.Shape();
  s.moveTo(-width / 2, 0);
  s.lineTo(width / 2, 0);
  s.lineTo(width / 2, height * 0.35);
  s.lineTo(-width / 2, height);
  s.closePath();
  return s;
}
const CURB_PROFILE = makeCurbProfile();

// ── Generic helpers ───────────────────────────────────────────────
function pathFromPoints(points) {
  const v3s = points.map(p => new THREE.Vector3(p[0], p[1] ?? 0, p[2]));
  return new THREE.CatmullRomCurve3(v3s, false, 'catmullrom', 0.5);
}

// True straight-line path (no CatmullRom extrapolation, no overshoot at
// endpoints). Use this for pieces whose centerline must end EXACTLY at
// the cell boundary (e.g. straight, ramps, jump deck) so adjacent
// segments butt without overlap and curb stripes tile cleanly.
function linePath(p0, p1) {
  const a = new THREE.Vector3(p0[0], p0[1] ?? 0, p0[2]);
  const b = new THREE.Vector3(p1[0], p1[1] ?? 0, p1[2]);
  return new THREE.LineCurve3(a, b);
}

function arcPath3(cx, cz, radius, a0, a1, y = 0, samples = 24) {
  // Analytic arc curve: returns true tangents at every t (especially at the
  // endpoints). CatmullRomCurve3 fitted to arc samples gives slightly skewed
  // endpoint tangents (~5° off), which causes the extruded road's outer
  // edge vertices to drift past the cell boundary by hundreds of mm —
  // visible as a "gap" or overshoot where the corner meets adjacent
  // straights. Sampling the arc analytically eliminates this entirely.
  const sweep = a1 - a0;
  const arcLen = Math.abs(sweep) * radius;
  const curve = {
    isCurve: true,
    getLength: () => arcLen,
    getPointAt: (t) => {
      const a = a0 + sweep * t;
      return new THREE.Vector3(cx + Math.cos(a) * radius, y, cz + Math.sin(a) * radius);
    },
    getTangentAt: (t) => {
      const a = a0 + sweep * t;
      const sign = sweep >= 0 ? 1 : -1;
      // d/da (cos a, sin a) = (-sin a, cos a); tangent direction depends
      // on sweep direction.
      const tx = -Math.sin(a) * sign;
      const tz = Math.cos(a) * sign;
      const v = new THREE.Vector3(tx, 0, tz);
      v.normalize();
      return v;
    },
    getPoints: (n = samples) => {
      const out = [];
      for (let i = 0; i <= n; i++) out.push(curve.getPointAt(i / n));
      return out;
    },
  };
  return curve;
}

function extrudeRoad(path, opts = {}) {
  // Build a flat ribbon along the path in the XZ plane. The deck top sits
  // at y = ROAD_THICK; the underside at y = 0. We build top, bottom, and
  // outer side quads as a single BufferGeometry. Width = ROAD_WIDTH.
  const width = opts.width ?? ROAD_WIDTH;
  const halfW = width / 2;
  const thickness = opts.thickness ?? ROAD_THICK;
  const segments = opts.steps || Math.max(24, Math.ceil(path.getLength() / 0.6));
  const N = segments + 1;
  // Sample centerline points + perpendicular (in XZ plane) per step
  const pts = new Array(N);
  const perps = new Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / segments;
    const p = path.getPointAt(t);
    const tan = path.getTangentAt(t);
    // perpendicular in XZ (rotate tangent 90° around Y)
    const px = -tan.z, pz = tan.x;
    const len = Math.hypot(px, pz) || 1;
    pts[i] = p;
    perps[i] = { x: px / len, z: pz / len };
  }
  // Vertex layout: for each step i we emit 4 verts: TL, TR, BL, BR
  // (top-left, top-right, bottom-left, bottom-right of the cross-section).
  const positions = [];
  const uvs = [];
  const normals = [];
  for (let i = 0; i < N; i++) {
    const p = pts[i];
    const n = perps[i];
    const lx = p.x - n.x * halfW, lz = p.z - n.z * halfW;
    const rx = p.x + n.x * halfW, rz = p.z + n.z * halfW;
    const yTop = (p.y || 0) + thickness;
    const yBot = (p.y || 0);
    // top-left, top-right, bot-left, bot-right
    positions.push(lx, yTop, lz);
    positions.push(rx, yTop, rz);
    positions.push(lx, yBot, lz);
    positions.push(rx, yBot, rz);
    // World XZ UVs for the asphalt — uniform tiling regardless of segment.
    const s = TEX_SCALE;
    uvs.push(lx / s, lz / s);
    uvs.push(rx / s, rz / s);
    uvs.push(lx / s, lz / s);
    uvs.push(rx / s, rz / s);
    normals.push(0, 1, 0);
    normals.push(0, 1, 0);
    normals.push(0, -1, 0);
    normals.push(0, -1, 0);
  }
  const indices = [];
  for (let i = 0; i < segments; i++) {
    const a = i * 4;
    const b = (i + 1) * 4;
    // top face: TL(a), TR(a+1), TL(b), TR(b+1)  → tris (a, b, a+1) (a+1, b, b+1)
    indices.push(a, b, a + 1);
    indices.push(a + 1, b, b + 1);
    // bottom face (reversed winding)
    indices.push(a + 2, a + 3, b + 2);
    indices.push(a + 3, b + 3, b + 2);
    // left side  (TL/BL pair): a, a+2, b, b+2
    indices.push(a, a + 2, b);
    indices.push(a + 2, b + 2, b);
    // right side (TR/BR pair): a+1, b+1, a+3, b+3
    indices.push(a + 1, b + 1, a + 3);
    indices.push(b + 1, b + 3, a + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  // The side-face normals we set as up/down are wrong but this geometry is
  // only used for visuals; lighting on the thin sides is barely noticeable.
  // Recompute cleanly:
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, opts.material || MATS.asphalt);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.drivable = true;
  return mesh;
}

const TEX_SCALE = 4.0;

// Banked variant of extrudeRoad. `bankFn(t)` returns a roll angle (radians)
// at parameter t in [0,1] along the path. `outerSign` is +1 if the outside
// of the bank is on the +perp side of the path tangent, -1 otherwise.
//
// Cross-section (in the perp/y plane, with origin at the inner edge at
// ground level, perp pointing toward the outer side of the bank):
//   A = inner-bottom : (0, 0)
//   B = outer-bottom : (W, 0)                    — kept FLAT on ground
//   C = outer-top    : (W·cos(b), t + W·sin(b))  — lifts with bank
//   D = inner-top    : (0, t)                    — stays at deck height
// The TOP face A→D→C→B (D-C is the drivable deck) tilts up on the outer
// side. The bottom rests on the ground so nothing floats. At b=0 the
// section degenerates to the flat extrudeRoad rectangle (perfect edge-
// to-edge alignment with adjacent straights/corners).
function extrudeRoadBanked(path, bankFn, outerSign, opts = {}) {
  const width = opts.width ?? ROAD_WIDTH;
  const W = width;
  const thickness = opts.thickness ?? ROAD_THICK;
  const segments = opts.steps || Math.max(24, Math.ceil(path.getLength() / 0.6));
  const N = segments + 1;
  const positions = [];
  const uvs = [];
  const indices = [];
  // Vertex ordering per cross-section: 0=A inner-bot, 1=B outer-bot,
  // 2=C outer-top, 3=D inner-top. We extrude these 4 vertices along the path
  // and stitch triangles between consecutive sections.
  for (let i = 0; i < N; i++) {
    const t = i / segments;
    const p = path.getPointAt(t);
    const tan = path.getTangentAt(t);
    // Perpendicular in XZ pointing OUTWARD (toward the lifted edge)
    const ppx = -tan.z * outerSign, ppz = tan.x * outerSign;
    const plen = Math.hypot(ppx, ppz) || 1;
    const ox = ppx / plen, oz = ppz / plen;
    const bank = bankFn(t);
    const cosB = Math.cos(bank);
    const sinB = Math.sin(bank);
    const yBase = p.y || 0;
    // Inner edge (origin of local frame)
    const ix = p.x - ox * (W / 2);
    const iz = p.z - oz * (W / 2);
    // Outer edge — bottom kept on ground; top rotated about inner-top axis.
    const obX = ix + ox * W, obZ = iz + oz * W;        // B outer-bot
    const otX = ix + ox * (W * cosB), otZ = iz + oz * (W * cosB); // C outer-top XZ
    const yA = yBase, yB = yBase, yC = yBase + thickness + W * sinB, yD = yBase + thickness;
    positions.push(ix, yA, iz);  // A inner-bot
    positions.push(obX, yB, obZ); // B outer-bot
    positions.push(otX, yC, otZ); // C outer-top
    positions.push(ix, yD, iz);   // D inner-top
    const sUV = TEX_SCALE;
    uvs.push(ix / sUV, iz / sUV);
    uvs.push(obX / sUV, obZ / sUV);
    uvs.push(otX / sUV, otZ / sUV);
    uvs.push(ix / sUV, iz / sUV);
  }
  for (let i = 0; i < segments; i++) {
    const k = i * 4, j = (i + 1) * 4;
    // Top face (drivable): D→C, between sections k & j
    indices.push(k + 3, j + 3, k + 2);
    indices.push(k + 2, j + 3, j + 2);
    // Bottom face (under): A→B (reversed winding)
    indices.push(k + 0, k + 1, j + 0);
    indices.push(k + 1, j + 1, j + 0);
    // Inner side: A→D
    indices.push(k + 0, j + 0, k + 3);
    indices.push(k + 3, j + 0, j + 3);
    // Outer slope: B→C
    indices.push(k + 1, k + 2, j + 1);
    indices.push(k + 2, j + 2, j + 1);
  }
  // Cap the open ends so daylight isn't visible through the cross-section.
  const lastBase = (N - 1) * 4;
  // Start cap (winding so outward-facing normal points along -tangent):
  indices.push(0, 2, 1);
  indices.push(0, 3, 2);
  // End cap (opposite winding):
  indices.push(lastBase + 0, lastBase + 1, lastBase + 2);
  indices.push(lastBase + 0, lastBase + 2, lastBase + 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, opts.material || MATS.asphalt);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.drivable = true;
  return mesh;
}

// ── Curb constants ──────────────────────────────────────────────
// Stripe length is fixed (1.0m) so the red/white pattern is consistent
// across every segment regardless of length. Stripes TOUCH (no gap) and
// are slightly taller so they read as a barrier wall, while staying low
// enough that karts can see over them and "climb" them in the editor.
const CURB_STRIPE_LEN = 1.0;
const CURB_STRIPE_HEIGHT = 0.45;
const CURB_STRIPE_WIDTH = 0.55;

// Concave-bowl variant of extrudeRoad. Cross-section parameter u ∈ [-1,+1]
// where u=-1 is the inner edge and u=+1 is the outer edge of the bend.
// Top-surface height: y(t,u) = liftAmpFn(t) · shapeFn(u). For a bowl,
// shapeFn(-1)=0 and shapeFn(+1)=1 with positive second derivative
// (concave-up). Bottom of the cross-section sits flat on ground (y=0),
// filling the volume so the bowl appears solid (no floating, no truss).
// `outerSign` is the sign of the outward perpendicular relative to
// (-tan.z, tan.x) — same convention as extrudeRoadBanked.
function extrudeRoadConcave(path, liftAmpFn, shapeFn, outerSign, opts = {}) {
  const width = opts.width ?? ROAD_WIDTH;
  const halfW = width / 2;
  const segments = opts.steps || Math.max(24, Math.ceil(path.getLength() / 0.6));
  const lateralSegs = opts.lateralSegs || 12;     // cross-section subdivisions
  const NL = lateralSegs + 1;                     // verts per cross-section row
  const N = segments + 1;
  // Top-surface vertices laid out as a (segments+1) × (lateralSegs+1) grid.
  const topPos = [];
  const topUV = [];
  for (let i = 0; i < N; i++) {
    const t = i / segments;
    const p = path.getPointAt(t);
    const tan = path.getTangentAt(t);
    // Outward perpendicular in XZ
    const ppx = -tan.z * outerSign, ppz = tan.x * outerSign;
    const plen = Math.hypot(ppx, ppz) || 1;
    const ox = ppx / plen, oz = ppz / plen;
    const liftAmp = liftAmpFn(t);
    for (let j = 0; j < NL; j++) {
      // u maps from -1 (inner edge) to +1 (outer edge).
      const u = (j / lateralSegs) * 2 - 1;
      const y = (p.y || 0) + ROAD_THICK + liftAmp * shapeFn(u);
      const x = p.x + ox * (u * halfW);
      const z = p.z + oz * (u * halfW);
      topPos.push(x, y, z);
      const sUV = TEX_SCALE;
      topUV.push(x / sUV, z / sUV);
    }
  }
  const positions = [...topPos];
  const uvs = [...topUV];
  const indices = [];
  // Top-surface triangles (drivable face). Wind so normal points +Y at flat.
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < lateralSegs; j++) {
      const a = i * NL + j;
      const b = a + 1;
      const c = (i + 1) * NL + j;
      const d = c + 1;
      // Determine winding so top normal points outward+up. The sign depends
      // on outerSign (which flips perp). For outerSign=-1 (mirror=false, L
      // bend) the natural winding is reversed; for outerSign=+1 it's
      // direct. We flip indices accordingly.
      if (outerSign === +1) {
        indices.push(a, c, b);
        indices.push(b, c, d);
      } else {
        indices.push(a, b, c);
        indices.push(b, d, c);
      }
    }
  }
  // Append a bottom polyline (inner-bot to outer-bot, flat at y=0) per
  // section so we can close the inner side, outer side, underside, and
  // end caps cleanly. Two extra verts per section: BL = (inner edge, y=0),
  // BR = (outer edge, y=0).
  const bottomBase = positions.length / 3;
  for (let i = 0; i < N; i++) {
    const t = i / segments;
    const p = path.getPointAt(t);
    const tan = path.getTangentAt(t);
    const ppx = -tan.z * outerSign, ppz = tan.x * outerSign;
    const plen = Math.hypot(ppx, ppz) || 1;
    const ox = ppx / plen, oz = ppz / plen;
    const yBase = p.y || 0;
    const ix = p.x - ox * halfW, iz = p.z - oz * halfW;
    const obx = p.x + ox * halfW, obz = p.z + oz * halfW;
    positions.push(ix, yBase, iz);    // BL = inner-bot
    positions.push(obx, yBase, obz);  // BR = outer-bot
    const sUV = TEX_SCALE;
    uvs.push(ix / sUV, iz / sUV);
    uvs.push(obx / sUV, obz / sUV);
  }
  // Underside (y=0 face). Wind reversed.
  for (let i = 0; i < segments; i++) {
    const k = bottomBase + i * 2;
    const j = bottomBase + (i + 1) * 2;
    if (outerSign === +1) {
      indices.push(k, j, k + 1);
      indices.push(k + 1, j, j + 1);
    } else {
      indices.push(k, k + 1, j);
      indices.push(k + 1, j + 1, j);
    }
  }
  // Inner side wall (between top inner-edge column j=0 and BL).
  for (let i = 0; i < segments; i++) {
    const tA = i * NL + 0;          // top inner this section
    const tB = (i + 1) * NL + 0;    // top inner next section
    const bA = bottomBase + i * 2;       // BL this section
    const bB = bottomBase + (i + 1) * 2; // BL next section
    if (outerSign === +1) {
      indices.push(bA, bB, tA);
      indices.push(tA, bB, tB);
    } else {
      indices.push(bA, tA, bB);
      indices.push(tA, tB, bB);
    }
  }
  // Outer side wall (between top outer-edge column j=lateralSegs and BR).
  for (let i = 0; i < segments; i++) {
    const tA = i * NL + lateralSegs;
    const tB = (i + 1) * NL + lateralSegs;
    const bA = bottomBase + i * 2 + 1;       // BR this section
    const bB = bottomBase + (i + 1) * 2 + 1; // BR next section
    if (outerSign === +1) {
      indices.push(bA, tA, bB);
      indices.push(tA, tB, bB);
    } else {
      indices.push(bA, bB, tA);
      indices.push(tA, bB, tB);
    }
  }
  // End caps (start at i=0 and end at i=N-1). Triangulate each cap as a
  // fan from BL across the top row to BR then back to BL via the underside.
  function emitCap(i, reverse) {
    const baseTop = i * NL;
    const bL = bottomBase + i * 2;
    const bR = bottomBase + i * 2 + 1;
    // Triangles BL → top[j] → top[j+1]
    for (let j = 0; j < lateralSegs; j++) {
      const a = baseTop + j;
      const b = baseTop + j + 1;
      if (reverse) indices.push(bL, b, a); else indices.push(bL, a, b);
    }
    // Triangle BL → top[last] → BR
    const last = baseTop + lateralSegs;
    if (reverse) indices.push(bL, bR, last); else indices.push(bL, last, bR);
  }
  // Start cap faces -tangent direction; end cap faces +tangent.
  emitCap(0, outerSign === +1);
  emitCap(N - 1, outerSign === -1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, opts.material || MATS.asphalt);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.drivable = true;
  return mesh;
}

// Banked-aware curb placement. Curbs follow the same lifted edges as the
// banked extrusion. `sideSign` is the side of the path (+1 or -1).
// `bankFn` returns the roll angle. `outerSign` is which side is outside.
//
// Stripe length is computed from the path length so adjacent stripes touch
// → continuous red/white barrier (no gaps). Outer-side stripes ride the
// tilted top edge of the wedge cross-section (radius shrinks to W·cos(b),
// height rises to (W/2)·sin(b)). Inner-side stripes stay flat.
function curbAlongPathBanked(path, sideSign, bankFn, outerSign, opts = {}) {
  const grp = new THREE.Group();
  const total = path.getLength();
  const count = Math.max(2, Math.round(total / CURB_STRIPE_LEN));
  const stripeLen = total / count;
  const halfW = ROAD_WIDTH / 2;
  const curbHalf = CURB_STRIPE_WIDTH / 2;
  const stone = new THREE.BoxGeometry(CURB_STRIPE_WIDTH, CURB_STRIPE_HEIGHT, stripeLen);
  const isOuter = (sideSign === outerSign);
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const p = path.getPointAt(t);
    const tan = path.getTangentAt(t);
    const yaw = Math.atan2(tan.x, tan.z);
    // Outward-facing perpendicular in XZ (toward the lifted edge)
    const perpLen = Math.hypot(-tan.z, tan.x) || 1;
    const ox = (-tan.z / perpLen) * outerSign;
    const oz = ( tan.x / perpLen) * outerSign;
    const bank = bankFn(t);
    const cosB = Math.cos(bank);
    const sinB = Math.sin(bank);
    // Outer edge top sits at radius halfW·cos(b) and height halfW·sin(b)
    // above the deck. Inner edge stays flat at radius halfW.
    const radial = isOuter ? (halfW * cosB - curbHalf) : -(halfW - curbHalf);
    const lift   = isOuter ? (halfW * sinB) : 0;
    const cx = p.x + ox * radial;
    const cz = p.z + oz * radial;
    const mat = opts.paint
      ? MATS.paintWhite
      : (i % 2 === 0 ? MATS.curbRed : MATS.curbWhite);
    const m = new THREE.Mesh(stone, mat);
    m.position.set(cx, ROAD_THICK + (p.y || 0) + CURB_STRIPE_HEIGHT / 2 + lift, cz);
    m.rotation.y = yaw;
    // Tilt the outer stripe so its long axis lies flush against the
    // tilted deck face. The roll axis is the path tangent (local Z after
    // the yaw rotation), so we rotate about local Z by the bank angle.
    if (isOuter) m.rotation.z = -bank;
    if (opts.paint) m.scale.set(0.4, 0.3, 1.0);
    m.castShadow = true; m.receiveShadow = true;
    grp.add(m);
  }
  return grp;
}

// Place a CONTINUOUS chain of alternating red/white curb stones along one
// side of a path. We first build the OFFSET POLYLINE (the curb's true
// centerline, which on a curve has a different radius/length than the
// road centerline), then chop it into equal-length chord segments. This
// guarantees:
//   • the curb's two ends lie EXACTLY on the offset path endpoints (no
//     overshoot past the road's cell boundary, no gap before it)
//   • inner-arc curbs use their own (shorter) arclen, so we don't
//     stretch a long box across a tight inner radius
//   • outer-arc curbs likewise sample at the correct higher density
function curbAlongPath(path, sideSign, opts = {}) {
  const grp = new THREE.Group();
  const offset = (ROAD_WIDTH / 2) - CURB_STRIPE_WIDTH / 2;
  // Dense sampling of the offset centerline (in the XZ plane).
  const pathLen = path.getLength();
  const dense = Math.max(48, Math.ceil(pathLen / 0.25));
  const offPts = new Array(dense + 1);
  for (let i = 0; i <= dense; i++) {
    const t = i / dense;
    const p = path.getPointAt(t);
    const tan = path.getTangentAt(t);
    const yaw = Math.atan2(tan.x, tan.z);
    const nx = Math.cos(yaw) * sideSign;
    const nz = -Math.sin(yaw) * sideSign;
    offPts[i] = new THREE.Vector3(p.x + nx * offset, p.y || 0, p.z + nz * offset);
  }
  // Per-segment arc lengths along the offset polyline + cumulative length.
  const segLens = new Array(dense);
  let total = 0;
  for (let i = 0; i < dense; i++) {
    const dx = offPts[i + 1].x - offPts[i].x;
    const dz = offPts[i + 1].z - offPts[i].z;
    segLens[i] = Math.hypot(dx, dz);
    total += segLens[i];
  }
  if (total < CURB_STRIPE_LEN * 0.5) return grp;
  const count = Math.max(2, Math.round(total / CURB_STRIPE_LEN));
  const stripeLen = total / count;
  // Helper: sample the offset polyline at arc-length s.
  const sampleAt = (s) => {
    let acc = 0;
    for (let j = 0; j < dense; j++) {
      if (s <= acc + segLens[j]) {
        const t = segLens[j] > 0 ? (s - acc) / segLens[j] : 0;
        const a = offPts[j], b = offPts[j + 1];
        return new THREE.Vector3(
          a.x + (b.x - a.x) * t,
          a.y + (b.y - a.y) * t,
          a.z + (b.z - a.z) * t,
        );
      }
      acc += segLens[j];
    }
    return offPts[dense];
  };
  for (let i = 0; i < count; i++) {
    const pA = sampleAt(i * stripeLen);
    const pB = sampleAt((i + 1) * stripeLen);
    const cx = (pA.x + pB.x) / 2;
    const cy = (pA.y + pB.y) / 2;
    const cz = (pA.z + pB.z) / 2;
    const dx = pB.x - pA.x;
    const dy = pB.y - pA.y;
    const dz = pB.z - pA.z;
    const horizLen = Math.hypot(dx, dz);
    // Full 3D chord length so stones butt continuously up/down hills with
    // no visual gap. Pitch the stone around its local X axis so it lies
    // flush against the road's vertical slope (positive pitch tips the
    // +Z end of the box down to match a descending road, etc.).
    const chordLen = Math.hypot(horizLen, dy);
    if (chordLen < 1e-6) continue;
    const yaw = Math.atan2(dx, dz);
    const pitch = Math.atan2(-dy, horizLen || 1);
    const stone = new THREE.BoxGeometry(CURB_STRIPE_WIDTH, CURB_STRIPE_HEIGHT, chordLen);
    const m = new THREE.Mesh(stone, i % 2 === 0 ? MATS.curbRed : MATS.curbWhite);
    // Lift the stone perpendicular to the deck surface so the bottom face
    // rides ON the curve top (not buried into nor floating above it). The
    // chord midpoint cy already tracks the centerline; add ROAD_THICK to
    // reach the deck top, then halfH·cos(pitch) along the deck's local up
    // (whose world-y component is cos(pitch)).
    const halfH = CURB_STRIPE_HEIGHT / 2;
    const liftY = ROAD_THICK + halfH * Math.cos(pitch);
    m.position.set(cx, cy + liftY, cz);
    m.rotation.set(pitch, yaw, 0, 'YXZ');
    m.castShadow = true; m.receiveShadow = true;
    grp.add(m);
  }
  return grp;
}

// Convenience: add curbs to BOTH sides of a path with the consistent
// continuous stripe pattern. Used by every road builder.
function curbsBothSides(path) {
  const g = new THREE.Group();
  g.add(curbAlongPath(path, +1));
  g.add(curbAlongPath(path, -1));
  return g;
}

// Dashed centerline paint along a path.
function dashedPaintAlongPath(path, mat = MATS.paintYellow, opts = {}) {
  const grp = new THREE.Group();
  const total = path.getLength();
  const dashLen = opts.dashLen || 1.2;
  const gapLen = opts.gapLen || 1.2;
  const cycle = dashLen + gapLen;
  const count = Math.floor(total / cycle);
  const dashGeo = new THREE.BoxGeometry(0.18, 0.04, dashLen);
  for (let i = 0; i < count; i++) {
    const t = ((i + 0.5) * cycle) / total;
    if (t > 1) break;
    const p = path.getPointAt(t);
    const tan = path.getTangentAt(t);
    const yaw = Math.atan2(tan.x, tan.z);
    const m = new THREE.Mesh(dashGeo, mat);
    m.position.set(p.x, ROAD_THICK + 0.025 + (p.y || 0), p.z);
    m.rotation.y = yaw;
    m.castShadow = false; m.receiveShadow = true;
    grp.add(m);
  }
  return grp;
}

// ── Builders ──────────────────────────────────────────────────────
function buildStraight(lengthZ, opts = {}) {
  const grp = new THREE.Group();
  const z0 = -lengthZ / 2;
  const z1 = lengthZ / 2;
  const path = linePath([0, 0, z0], [0, 0, z1]);
  grp.add(extrudeRoad(path));
  if (!opts.noCurbs) {
    grp.add(curbAlongPath(path, +1));
    grp.add(curbAlongPath(path, -1));
  }
  if (!opts.noPaint) grp.add(dashedPaintAlongPath(path));
  return grp;
}

function buildCorner(mirror) {
  const grp = new THREE.Group();
  // Quarter arc inside a single cell
  // L (mirror=false): enter -Z, exit -X; arc center at (-TILE/2, 0, -TILE/2)
  // R (mirror=true) : enter -Z, exit +X; arc center at (+TILE/2, 0, -TILE/2)
  const cx = mirror ? +TILE / 2 : -TILE / 2;
  const cz = -TILE / 2;
  const r = TILE / 2;
  // Angle from center to entry point (0,_,-TILE/2):
  //  L: dir=(+r,0,0) → atan2(0,+r)=0; exit (-TILE/2,0,0) dir=(0,0,+r) → atan2(+r,0)=π/2 → CCW 0→π/2
  //  R: dir=(-r,0,0) → atan2(0,-r)=π;  exit (+TILE/2,0,0) dir=(0,0,+r) → atan2(+r,0)=π/2 → CW π→π/2 (i.e. -π/2 sweep)
  const a0 = mirror ? Math.PI : 0;
  const a1 = Math.PI / 2;
  const path = arcPath3(cx, cz, r, a0, a1, 0, 18);
  grp.add(extrudeRoad(path));
  // Continuous red/white curbs on BOTH sides of the arc so the corner
  // visually butts up against neighbour straights without losing the
  // barrier line at the inside of the bend. Inside curb is rendered at
  // 65% width so the racing line still reads as the apex.
  grp.add(curbAlongPath(path, mirror ? -1 : +1));
  const inner = curbAlongPath(path, mirror ? +1 : -1);
  inner.children.forEach(c => { c.scale.set(0.65, 0.7, 1.0); });
  grp.add(inner);
  // Subtle racing-line dashes through the apex.
  grp.add(dashedPaintAlongPath(path));
  return grp;
}

function buildCurvedPlateau(mirror) {
  // Raised L-bend at plateau height (TILE * 0.6). Same arc as
  // buildCorner, lifted onto piers and railed like the straight
  // plateau visual so the two pieces tile together visually.
  const grp = new THREE.Group();
  const deckH = TILE * 0.6;
  const cx = mirror ? +TILE / 2 : -TILE / 2;
  const cz = -TILE / 2;
  const r = TILE / 2;
  const a0 = mirror ? Math.PI : 0;
  const a1 = Math.PI / 2;
  const path = arcPath3(cx, cz, r, a0, a1, deckH, 18);
  grp.add(extrudeRoad(path, { steps: 18 }));
  grp.add(curbAlongPath(path, mirror ? -1 : +1));
  const inner = curbAlongPath(path, mirror ? +1 : -1);
  inner.children.forEach(c => { c.scale.set(0.65, 0.7, 1.0); });
  grp.add(inner);
  grp.add(dashedPaintAlongPath(path));
  // Side guardrails along inner & outer edges of the curve — the inner
  // side has the smaller radius (r - halfWidth), the outer side larger.
  const halfW = ROAD_WIDTH / 2 - 0.05;
  const yRail = deckH + ROAD_THICK + WALL_HEIGHT * 0.55;
  for (const sign of [-1, +1]) {
    const railR = r + sign * halfW;
    if (railR <= 0.1) continue;
    // Build a CatmullRom curve sampled along the arc — TubeGeometry
    // requires Frenet frames which arcPath3's custom curve doesn't
    // expose, so we resample as a CatmullRomCurve3 instead.
    const samples = 14;
    const pts = [];
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const a = a0 + (a1 - a0) * t;
      pts.push([cx + Math.cos(a) * railR, yRail, cz + Math.sin(a) * railR]);
    }
    const railPath = pathFromPoints(pts);
    const tube = new THREE.TubeGeometry(railPath, samples, 0.08, 6, false);
    grp.add(new THREE.Mesh(tube, MATS.guardrail));
    for (let i = 0; i < 5; i++) {
      const t = (i + 0.5) / 5;
      const p = railPath.getPointAt(t);
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, WALL_HEIGHT, 0.12),
        MATS.guardrail,
      );
      post.position.set(p.x, p.y - WALL_HEIGHT * 0.4, p.z);
      grp.add(post);
    }
  }
  // Slim concrete piers under the deck. Four pillars positioned at the
  // arc's tile-edge seams (two along the entry edge z=-TILE/2 at the
  // road's left/right rail line, two along the exit edge at the road's
  // entry/exit rail line). This puts every pier DIRECTLY under the
  // visible curved deck rather than floating in empty corners outside
  // the arc footprint.
  const halfWidth = ROAD_WIDTH / 2;
  const insetCP = 0.25;
  const exitXCP = mirror ? +TILE / 2 - insetCP : -TILE / 2 + insetCP;
  const pierSpots = [
    [-halfWidth + insetCP, -TILE / 2 + insetCP],
    [+halfWidth - insetCP, -TILE / 2 + insetCP],
    [exitXCP, -halfWidth + insetCP],
    [exitXCP, +halfWidth - insetCP],
  ];
  for (const [px, pz] of pierSpots) {
    const col = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.22, deckH, 12),
      MATS.concrete,
    );
    col.position.set(px, deckH / 2, pz);
    col.castShadow = true; col.receiveShadow = true;
    grp.add(col);
  }
  return grp;
}

function buildBanked(mirror) {
  // 90° banked corner over a 2×2 footprint with a SYMMETRIC concave
  // bowl cross-section. Both inner and outer rims rise to `liftAmp(t)`,
  // and the centerline (u=0) sits flat — karts drift outward as they
  // gain speed and ride the bowl's outer wall through the apex, like a
  // velodrome. Bowl walls double as the segment's barriers, so no
  // separate guardrail is rendered.
  //
  // Cross-section parameter u ∈ [-1, +1]:
  //   u = -1 → inner edge of arc (lifted)
  //   u =  0 → racing-line / centerline (flat)
  //   u = +1 → outer edge of arc (lifted)
  //   y(t,u) = liftAmp(t) · u²       (symmetric quadratic bowl)
  const grp = new THREE.Group();
  // Arc centre at the inside corner of the 2×2 footprint, radius
  // 1.5·TILE so the road centerline meets the S-edge midpoint of cell
  // (1,0) and the W-edge midpoint of cell (0,1).
  const cx = mirror ? +TILE / 2 : -TILE / 2;
  const cz = -TILE / 2;
  const r = 1.5 * TILE;
  const a0 = mirror ? Math.PI : 0;
  const a1 = Math.PI / 2;
  // Longer arc ⇒ more samples so the surface stays smooth.
  const path = arcPath3(cx, cz, r, a0, a1, 0, 36);
  // Outward direction = away from arc center.
  const outerSign = mirror ? +1 : -1;
  // Peak lift at apex: must match `bankedTurnBlocks` in segments.js
  // (collider + visual share the same shape). 0.20·ROAD gives a ~39°
  // outer rim and ~22° mid-bank, comfortable for high-speed lines.
  const LIFT_MAX = ROAD_WIDTH * 0.20;
  const liftAmpFn = (t) => {
    const tt = Math.max(0, Math.min(1, t));
    return Math.sin(tt * Math.PI) * LIFT_MAX;
  };
  // Symmetric concave-up bowl: y(u)/liftAmp = u²
  const bowlShape = (u) => u * u;
  grp.add(extrudeRoadConcave(path, liftAmpFn, bowlShape, outerSign, { steps: 64, lateralSegs: 16 }));
  // Centerline racing-line dashes — the bowl is its own barrier on both
  // sides, so we skip curbs and let the rising rims do the visual work.
  grp.add(dashedPaintAlongPath(path));
  return grp;
}

function buildBump() {
  // Single cell straight with a low rounded hump.
  const grp = new THREE.Group();
  const samples = 20;
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const z = -TILE / 2 + TILE * t;
    const y = Math.sin(t * Math.PI) * 0.45;
    pts.push([0, y, z]);
  }
  const path = pathFromPoints(pts);
  grp.add(extrudeRoad(path, { steps: 30 }));
  grp.add(curbsBothSides(path));
  return grp;
}

function buildHill(lengthZcells = 2) {
  const grp = new THREE.Group();
  const totalZ = TILE * lengthZcells;
  // Halved peak: 50% gentler height angle than the previous TILE*0.55.
  const peak = TILE * 0.275;
  const samples = 32;
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const z = -TILE / 2 + totalZ * t;
    const y = Math.sin(t * Math.PI) * peak;
    pts.push([0, y, z]);
  }
  const path = pathFromPoints(pts);
  grp.add(extrudeRoad(path, { steps: 48 }));
  grp.add(curbsBothSides(path));
  grp.add(dashedPaintAlongPath(path, MATS.paintYellow, { dashLen: 1.0, gapLen: 1.5 }));
  return grp;
}

function buildRamp(yStart, yEnd, lengthZcells = 2) {
  const grp = new THREE.Group();
  const totalZ = TILE * lengthZcells;
  const samples = 18;
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const z = -TILE / 2 + totalZ * t;
    // Smooth-step for nicer curve at top/bottom
    const e = t * t * (3 - 2 * t);
    const y = yStart + (yEnd - yStart) * e;
    pts.push([0, y, z]);
  }
  const path = pathFromPoints(pts);
  grp.add(extrudeRoad(path, { steps: 28 }));
  // Side rails (guardrail) running along the ramp
  for (const side of [-1, +1]) {
    const railPts = [];
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const z = -TILE / 2 + totalZ * t;
      const e = t * t * (3 - 2 * t);
      const y = yStart + (yEnd - yStart) * e;
      railPts.push([side * (ROAD_WIDTH / 2 - 0.1), y + ROAD_THICK + WALL_HEIGHT * 0.55, z]);
    }
    const rPath = pathFromPoints(railPts);
    const tube = new THREE.TubeGeometry(rPath, 24, 0.08, 8, false);
    const m = new THREE.Mesh(tube, MATS.guardrail);
    m.castShadow = true; m.receiveShadow = true;
    grp.add(m);
    // posts
    for (let i = 0; i < 5; i++) {
      const t = (i + 0.5) / 5;
      const p = rPath.getPointAt(t);
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, WALL_HEIGHT, 0.12),
        MATS.guardrail,
      );
      post.position.set(p.x, p.y - WALL_HEIGHT * 0.3, p.z);
      post.castShadow = true; post.receiveShadow = true;
      grp.add(post);
    }
  }
  grp.add(curbsBothSides(path));
  // Slim under-deck concrete piers — one pair per cell-boundary crossing
  // along the ramp, with each pier's height tracking the ramp profile so
  // it visibly meets the deck underside (no floating columns, no missing
  // supports). The very foot is skipped (deck is at y=0 there).
  const cellCount = Math.max(1, Math.round(lengthZcells));
  const halfWramp = ROAD_WIDTH / 2;
  const insetRamp = 0.25;
  for (let i = 1; i < cellCount; i++) {
    const z = -TILE / 2 + i * TILE;
    const tCell = (z + TILE / 2) / totalZ;
    const eCell = tCell * tCell * (3 - 2 * tCell);
    const yDeck = yStart + (yEnd - yStart) * eCell;
    if (yDeck < 0.4) continue;
    for (const sx of [-1, +1]) {
      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.22, yDeck, 12),
        MATS.concrete,
      );
      col.position.set(sx * (halfWramp - insetRamp), yDeck / 2, z);
      col.castShadow = true; col.receiveShadow = true;
      grp.add(col);
    }
  }
  return grp;
}

function buildJumpRamp() {
  // Proper kicker: rising deck with side rails along the launch ramp,
  // chevron warning paint across the lip, and a concrete buttress under
  // the launch face so it doesn't float.
  const grp = new THREE.Group();
  const samples = 18;
  const pts = [];
  const peak = 1.6;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const z = -TILE / 2 + TILE * t;
    // Smooth-ease kicker profile — flat for the first third, rising into
    // a steep launch toward the lip.
    const e = Math.pow(t, 2.2);
    const y = e * peak;
    pts.push([0, y, z]);
  }
  const path = pathFromPoints(pts);
  grp.add(extrudeRoad(path, { steps: 30 }));
  // Side rails along the kicker (matches buildRamp visual language)
  for (const side of [-1, +1]) {
    const railPts = [];
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const z = -TILE / 2 + TILE * t;
      const e = Math.pow(t, 2.2);
      const y = e * peak;
      railPts.push([side * (ROAD_WIDTH / 2 - 0.1), y + ROAD_THICK + WALL_HEIGHT * 0.55, z]);
    }
    const rPath = pathFromPoints(railPts);
    const tube = new THREE.TubeGeometry(rPath, 18, 0.08, 8, false);
    grp.add(new THREE.Mesh(tube, MATS.guardrail));
    for (let i = 0; i < 4; i++) {
      const t = (i + 0.5) / 4;
      const p = rPath.getPointAt(t);
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, WALL_HEIGHT, 0.12),
        MATS.guardrail,
      );
      post.position.set(p.x, p.y - WALL_HEIGHT * 0.3, p.z);
      grp.add(post);
    }
  }
  // Yellow warning stripes across the lip surface (straight, not chevroned
  // — the previous angled-chevron version read as broken paint at glancing
  // camera angles).
  for (let i = -2; i <= 2; i++) {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.06, 0.35),
      MATS.warning,
    );
    stripe.position.set(i * 1.4, ROAD_THICK + peak + 0.05, TILE / 2 - 0.5);
    grp.add(stripe);
  }
  // Concrete buttress underneath the launch face
  const buttress = new THREE.Mesh(
    new THREE.BoxGeometry(ROAD_WIDTH * 0.95, peak * 0.9, 1.6),
    MATS.concrete,
  );
  buttress.position.set(0, peak * 0.45, TILE / 2 - 1.0);
  buttress.castShadow = true; buttress.receiveShadow = true;
  grp.add(buttress);
  return grp;
}

function buildBridge() {
  // Elevated 1×2 deck on OPEN piers — must be hollow underneath so other
  // road segments (including plateau roads on the middle tier) can pass
  // beneath it. No spandrel walls, no closed base. Deck is carried by 3
  // pairs of slim concrete columns at the entry, midspan, and exit.
  const grp = new THREE.Group();
  const lengthZ = TILE * 2;
  const deckH = BRIDGE_DECK_HEIGHT;
  const cz = lengthZ / 2 - TILE / 2;
  // Elevated drivable deck + curbs (continuous red/white barrier)
  const path = linePath([0, deckH, -TILE / 2], [0, deckH, lengthZ - TILE / 2]);
  grp.add(extrudeRoad(path, { steps: 24 }));
  grp.add(curbsBothSides(path));
  grp.add(dashedPaintAlongPath(path));
  // Side guardrails (tubes + posts) above the curbs
  for (const side of [-1, +1]) {
    const x = side * (ROAD_WIDTH / 2 - 0.05);
    const yRail = deckH + ROAD_THICK + WALL_HEIGHT * 0.55;
    const rPath = pathFromPoints([
      [x, yRail, -TILE / 2],
      [x, yRail, lengthZ - TILE / 2],
    ]);
    const tube = new THREE.TubeGeometry(rPath, 12, 0.1, 8, false);
    grp.add(new THREE.Mesh(tube, MATS.guardrail));
    for (let i = 0; i < 7; i++) {
      const t = (i + 0.5) / 7;
      const p = rPath.getPointAt(t);
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, WALL_HEIGHT, 0.14),
        MATS.guardrail,
      );
      post.position.set(p.x, p.y - WALL_HEIGHT * 0.4, p.z);
      grp.add(post);
    }
  }
  // Open piers: 3 bents (entry / midspan / exit). Each bent has two slim
  // square columns straddling the road, plus a cross-beam at the top.
  // Columns are pulled INSIDE the road footprint so they do not block
  // adjacent tiles, and they are thin enough that a kart driving on a
  // road segment placed UNDERNEATH passes between them with clearance.
  const pierThk = 0.55;
  const pierColX = ROAD_WIDTH / 2 - pierThk / 2 - 0.05;
  const pierZs = [-TILE / 2 + pierThk / 2, cz, lengthZ - TILE / 2 - pierThk / 2];
  const colHt = deckH; // base at y=0 → top flush with deck underside
  for (const pz of pierZs) {
    for (const sx of [-1, +1]) {
      const col = new THREE.Mesh(
        new THREE.BoxGeometry(pierThk, colHt, pierThk),
        MATS.concrete,
      );
      col.position.set(sx * pierColX, colHt / 2, pz);
      col.castShadow = true; col.receiveShadow = true;
      grp.add(col);
    }
    // Cross-beam (bent cap) connecting the two columns just under deck.
    const beamH = 0.45;
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(ROAD_WIDTH + 0.1, beamH, pierThk),
      MATS.concrete,
    );
    beam.position.set(0, colHt - beamH / 2, pz);
    beam.castShadow = true; beam.receiveShadow = true;
    grp.add(beam);
  }
  // Two slim longitudinal stringers under the deck connecting the bents,
  // hanging just below the deck slab so the underside reads as a built
  // structure but stays open between the columns.
  const stringerH = 0.35;
  for (const sx of [-1, +1]) {
    const stringer = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, stringerH, lengthZ - 0.2),
      MATS.concrete,
    );
    stringer.position.set(sx * (ROAD_WIDTH / 2 - 0.25), deckH - stringerH / 2, cz);
    grp.add(stringer);
  }
  return grp;
}

function buildBridgeRamp(direction) {
  // direction: 'up' => 0 → BRIDGE_DECK_HEIGHT, 'down' => reversed.
  // Spans BRIDGE_RAMP_CELLS cells so the climb stays gradual.
  const deckH = BRIDGE_DECK_HEIGHT;
  const cells = BRIDGE_RAMP_CELLS;
  return direction === 'up' ? buildRamp(0, deckH, cells) : buildRamp(deckH, 0, cells);
}

function buildTunnel() {
  // Drivable straight + concrete side walls + a half-cylinder roof arching
  // over the road. Earlier the cylinder rotation was wrong (combining
  // rot.z=PI/2 then rot.y=PI/2 gave a vertically standing tube), so the
  // tunnel rendered as a black silo. Cylinder default axis is +Y; we want
  // axis along Z and the open half facing DOWN (so the dome is the roof).
  const grp = new THREE.Group();
  const lengthZ = TILE * 2;
  const cz = lengthZ / 2 - TILE / 2;
  const path = linePath([0, 0, -TILE / 2], [0, 0, lengthZ - TILE / 2]);
  grp.add(extrudeRoad(path));
  grp.add(curbsBothSides(path));
  // Side walls (concrete) up to where the dome springs from
  const wallHt = WALL_HEIGHT * 0.9;
  for (const side of [-1, +1]) {
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, wallHt, lengthZ),
      MATS.concrete,
    );
    wall.position.set(side * (ROAD_WIDTH / 2 + 0.2), ROAD_THICK + wallHt / 2, cz);
    wall.castShadow = true; wall.receiveShadow = true;
    grp.add(wall);
  }
  // Half-cylinder roof built directly along Z — earlier we used a Y-axis
  // CylinderGeometry rotated by -PI/2 around X, but the resulting dome
  // rendered as half-missing under some camera/yaw combinations because
  // the open hemisphere ended up facing sideways after the rotation
  // composed with the parent group's yaw. Building the buffer geometry
  // explicitly with the correct axis orientation removes the rotation
  // chain entirely.
  const roofR = ROAD_WIDTH / 2 + 0.45;
  const roofY = ROAD_THICK + wallHt;
  const ARC_SEGS = 28;
  const LEN_SEGS = 4;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let li = 0; li <= LEN_SEGS; li++) {
    const z = -lengthZ / 2 + (li / LEN_SEGS) * lengthZ;
    for (let ai = 0; ai <= ARC_SEGS; ai++) {
      const t = ai / ARC_SEGS;
      const theta = t * Math.PI;            // 0 → π across the dome
      const x = -roofR * Math.cos(theta);   // -roofR → +roofR
      const y = roofR * Math.sin(theta);    // 0 → roofR → 0
      positions.push(x, y, z);
      uvs.push(t, li / LEN_SEGS);
    }
  }
  const stride = ARC_SEGS + 1;
  for (let li = 0; li < LEN_SEGS; li++) {
    for (let ai = 0; ai < ARC_SEGS; ai++) {
      const a = li * stride + ai;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const roofGeo = new THREE.BufferGeometry();
  roofGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  roofGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  roofGeo.setIndex(indices);
  roofGeo.computeVertexNormals();
  const roof = new THREE.Mesh(roofGeo, MATS.tunnelRoof);
  roof.position.set(0, roofY, cz);
  roof.castShadow = true; roof.receiveShadow = true;
  grp.add(roof);
  // Glow strip down the middle of the ceiling apex
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(0.25, 0.08, lengthZ * 0.96),
    new THREE.MeshStandardMaterial({
      color: 0xfff2cc, emissive: 0xffd060, emissiveIntensity: 1.4, roughness: 0.4,
    }),
  );
  strip.position.set(0, roofY + roofR - 0.18, cz);
  grp.add(strip);
  // End rim arches — torus default lies in XY plane, half from 0..PI is
  // the upper hemicircle. Rotate so it stands at the entry/exit faces.
  for (const z of [-TILE / 2 + 0.05, lengthZ - TILE / 2 - 0.05]) {
    const ringGeo = new THREE.TorusGeometry(roofR + 0.05, 0.18, 8, 28, Math.PI);
    const ring = new THREE.Mesh(ringGeo, MATS.truss);
    ring.position.set(0, roofY, z);
    grp.add(ring);
  }
  return grp;
}

function buildTJunction() {
  // T — deck open on -Z, -X, +X. Closed at +Z with a guardrail+chevrons.
  // Adds painted give-way triangles on the two side approaches and a centre
  // road marking so it reads as a real intersection, not a flat slab.
  const grp = new THREE.Group();
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(TILE, ROAD_THICK, TILE),
    MATS.asphalt,
  );
  deck.position.y = ROAD_THICK / 2;
  deck.receiveShadow = true;
  deck.userData.drivable = true;
  grp.add(deck);
  // Centre dashed lane lines on the through axis (-X to +X)
  for (let i = -2; i <= 2; i++) {
    if (Math.abs(i) < 1) continue;
    const dash = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.05, 0.18),
      MATS.paintWhite,
    );
    dash.position.set(i * 1.6, ROAD_THICK + 0.03, 0);
    grp.add(dash);
  }
  // Stop line on the -Z approach
  const stopLine = new THREE.Mesh(
    new THREE.BoxGeometry(TILE * 0.8, 0.05, 0.3),
    MATS.paintWhite,
  );
  stopLine.position.set(0, ROAD_THICK + 0.03, -TILE * 0.18);
  grp.add(stopLine);
  // Chevrons telegraphing the closed +Z edge
  for (let i = -2; i <= 2; i++) {
    const chev = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.06, 0.28),
      MATS.warning,
    );
    chev.position.set(i * 1.5, ROAD_THICK + 0.04, TILE / 2 - 0.7);
    chev.rotation.y = (i < 0 ? -1 : 1) * Math.PI / 14;
    grp.add(chev);
  }
  // Solid back guardrail at +Z
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(TILE, WALL_HEIGHT * 0.8, WALL_THICK),
    MATS.guardrail,
  );
  wall.position.set(0, ROAD_THICK + WALL_HEIGHT * 0.4, TILE / 2 - WALL_THICK / 2);
  wall.castShadow = true; wall.receiveShadow = true;
  grp.add(wall);
  // Reflector posts at the two interior corners (+X/+Z and -X/+Z)
  for (const sx of [-1, +1]) {
    const refl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.12, 0.7, 8),
      MATS.warning,
    );
    refl.position.set(sx * (TILE / 2 - 0.4), ROAD_THICK + 0.35, TILE / 2 - 0.4);
    refl.castShadow = true; refl.receiveShadow = true;
    grp.add(refl);
  }
  return grp;
}

function buildCrossroads() {
  // Four-way intersection — deck with painted crosswalks on each approach,
  // stop lines, dashed lane lines on both axes, and a centre give-way circle.
  const grp = new THREE.Group();
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(TILE, ROAD_THICK, TILE),
    MATS.asphalt,
  );
  deck.position.y = ROAD_THICK / 2;
  deck.receiveShadow = true;
  deck.userData.drivable = true;
  grp.add(deck);
  // Dashed lane lines on both through axes (skipping the centre)
  for (const rot of [0, Math.PI / 2]) {
    const ax = new THREE.Group();
    for (let i = -2; i <= 2; i++) {
      if (Math.abs(i) < 1) continue;
      const dash = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.05, 0.9),
        MATS.paintYellow,
      );
      dash.position.set(0, ROAD_THICK + 0.03, i * 1.5);
      ax.add(dash);
    }
    ax.rotation.y = rot;
    grp.add(ax);
  }
  // Stop lines on each approach
  for (let approach = 0; approach < 4; approach++) {
    const ang = approach * Math.PI / 2;
    const stop = new THREE.Mesh(
      new THREE.BoxGeometry(TILE * 0.7, 0.05, 0.28),
      MATS.paintWhite,
    );
    const r = TILE * 0.22;
    stop.position.set(Math.sin(ang) * r, ROAD_THICK + 0.03, -Math.cos(ang) * r);
    stop.rotation.y = ang;
    grp.add(stop);
  }
  // Centre give-way ring
  const ringGeo = new THREE.RingGeometry(0.85, 1.05, 28);
  const ring = new THREE.Mesh(ringGeo, MATS.paintYellow);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = ROAD_THICK + 0.05;
  grp.add(ring);
  // Centre dot
  const dot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.4, 0.06, 16),
    MATS.paintYellow,
  );
  dot.position.y = ROAD_THICK + 0.04;
  grp.add(dot);
  return grp;
}

function buildPlaza() {
  // 2x2 plaza — darker asphalt deck with a central roundabout island,
  // painted lane stripes on the four cardinal openings, and slim corner
  // bollards. Replaces the earlier concrete-square + asphalt-square +
  // floating-pillar look that read as a billiard table.
  const grp = new THREE.Group();
  const cx = TILE / 2, cz = TILE / 2;
  const W = TILE * 2;
  // Asphalt deck (drivable)
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(W, ROAD_THICK, W),
    MATS.asphalt,
  );
  base.position.set(cx, ROAD_THICK / 2, cz);
  base.receiveShadow = true;
  base.userData.drivable = true;
  grp.add(base);
  // Lane lines along each cardinal opening (white dashes)
  for (const rot of [0, Math.PI / 2]) {
    const stripeGrp = new THREE.Group();
    for (let i = -3; i <= 3; i++) {
      if (Math.abs(i) < 2) continue; // skip near the centre island
      const dash = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.05, 0.9),
        MATS.paintWhite,
      );
      dash.position.set(0, ROAD_THICK + 0.03, i * 1.4);
      stripeGrp.add(dash);
    }
    stripeGrp.rotation.y = rot;
    stripeGrp.position.set(cx, 0, cz);
    grp.add(stripeGrp);
  }
  // Centre roundabout island — raised circular curb with grass
  const islandR = W * 0.18;
  const curb = new THREE.Mesh(
    new THREE.CylinderGeometry(islandR, islandR, 0.35, 28),
    MATS.curbWhite,
  );
  curb.position.set(cx, ROAD_THICK + 0.175, cz);
  curb.castShadow = true; curb.receiveShadow = true;
  grp.add(curb);
  const grass = new THREE.Mesh(
    new THREE.CylinderGeometry(islandR * 0.85, islandR * 0.85, 0.4, 28),
    new THREE.MeshStandardMaterial({ color: 0x4a7a3c, roughness: 0.95, metalness: 0 }),
  );
  grass.position.set(cx, ROAD_THICK + 0.21, cz);
  grp.add(grass);
  // Centre marker pole
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, 1.6, 12),
    MATS.guardrail,
  );
  pole.position.set(cx, ROAD_THICK + 0.4 + 0.8, cz);
  pole.castShadow = true; pole.receiveShadow = true;
  grp.add(pole);
  // Slim bollards at the four corners (NOT in the path of any cardinal exit)
  for (const sx of [-1, +1]) for (const sz of [-1, +1]) {
    const bollard = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.22, 0.9, 10),
      MATS.warning,
    );
    bollard.position.set(
      cx + sx * (W / 2 - 0.6),
      ROAD_THICK + 0.45,
      cz + sz * (W / 2 - 0.6),
    );
    bollard.castShadow = true; bollard.receiveShadow = true;
    grp.add(bollard);
  }
  return grp;
}

// ── Modifier & Hazard visual builders ────────────────────────────────────────
// Each builder returns a textured overlay that sits on top of any road segment.
// Visuals come directly from the game's baked asset textures — minimal geometry.

// Shared texture cache — one entry per distinct source file.
const MOD_TEX = (() => {
  // Public asset filenames were bulk-normalized to lowercase to keep
  // Vite/Vercel case-sensitive serving happy. The hardcoded URLs below
  // preserve the original mixed-case names from the source bundle, so
  // route them through a LoadingManager that lowercases the basename.
  const _texMgr = new THREE.LoadingManager();
  _texMgr.setURLModifier((url) => url.replace(
    /([^/]+)\.(png|jpe?g|tga|bmp|webp)(\?[^/]*)?$/i,
    (_full, name, ext, qs) => `${name.toLowerCase()}.${ext.toLowerCase()}${qs || ''}`,
  ));
  const loader = new THREE.TextureLoader(_texMgr);
  const JUMP = '/kart%20assets/3D%20Kart/Assets/Models/JumpBoardReg/Tex/';
  const GCYC = '/kart%20assets/3D%20Kart/Assets/Models/Other%20Common%20Files/';

  function load(url, repeat = [1, 1], srgb = true) {
    return loader.load(url, tex => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeat[0], repeat[1]);
      tex.anisotropy = 16;
      if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    });
  }
  // Loaded + rotated 90° CCW so right-pointing arrows face +Z (forward along road)
  function loadRot(url, repeat = [1, 1], srgb = true) {
    return loader.load(url, tex => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeat[0], repeat[1]);
      tex.anisotropy = 16;
      if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
      tex.rotation = Math.PI / 2;
      tex.center.set(0.5, 0.5);
    });
  }

  return {
    // Boost Pad — top-down view: wood planks with 2 white chevron arrows baked in
    jumpAlb:    load(JUMP + 'bd_jumpboard_Alb.png',  [1, 1]),
    jumpNrm:    load(JUMP + 'bd_jumpboard_Nrm.png',  [1, 1], false),
    jumpSpm:    load(JUMP + 'bd_jumpboard_Spm.png',  [1, 1], false),
    jumpFrame:  load(JUMP + 'bd_jumpboard2_Alb.png', [1, 1]),
    // Pickup / crate assets
    itemBoxAlb: load('/kart%20assets/3D%20Kart/Assets/Models/Items/Item%20Box/ItemBox_Alb%20.png', [1, 1]),
    itemBoxNrm: load('/kart%20assets/3D%20Kart/Assets/Models/Items/Item%20Box/ItemBox_Nrm%20.png', [1, 1], false),
    itemBoxRef: load('/kart%20assets/3D%20Kart/Assets/Models/Items/Item%20Box/ItemBoxRefraction_Alb%20.png', [1, 1]),
    itemBoxFontAlb: load('/kart%20assets/3D%20Kart/Assets/Models/Items/Item%20Box/ItemBoxFont_Alb%20.png', [1, 1]),
    itemBoxFontNrm: load('/kart%20assets/3D%20Kart/Assets/Models/Items/Item%20Box/ItemBoxFont_Nrm%20.png', [1, 1], false),
    crateAlb:   load('/kart%20assets/3D%20Kart/Assets/Models/Wii%20U%20-%20Mario%20Kart%208%20-%20Toad%20Harbor/Crate/CrashBox_Alb.png', [1, 1]),
    crateNrm:   load('/kart%20assets/3D%20Kart/Assets/Models/Wii%20U%20-%20Mario%20Kart%208%20-%20Toad%20Harbor/Crate/CrashBox_Nrm.png', [1, 1], false),
    crateSpm:   load('/kart%20assets/3D%20Kart/Assets/Models/Wii%20U%20-%20Mario%20Kart%208%20-%20Toad%20Harbor/Crate/CrashBox_Spm.png', [1, 1], false),
    coinAlb:    load('/kart%20assets/3D%20Kart/Assets/Models/Items/Coin/itemcoin_alb.png', [1, 1]),
    coinNrm:    load('/kart%20assets/3D%20Kart/Assets/Models/Items/Coin/itemcoin_nrm.png', [1, 1], false),
    coinSpm:    load('/kart%20assets/3D%20Kart/Assets/Models/Items/Coin/itemcoin_spm.png', [1, 1], false),
    starAlb:    load('/kart%20assets/3D%20Kart/Assets/Models/Items/Starman/ItemStar_Alb.png', [1, 1]),
    starNrm:    load('/kart%20assets/3D%20Kart/Assets/Models/Items/Starman/ItemStar_Nrm.png', [1, 1], false),
    starSpm:    load('/kart%20assets/3D%20Kart/Assets/Models/Items/Starman/ItemStar_Spm.png', [1, 1], false),
    // Hazard surfaces — sourced from Water Park / MooMoo Meadows / Other Common Files
    waterAlb:   load('/kart%20assets/3D%20Kart/Assets/Models/Water%20Park/Track/GWP_CompD_Water_Alb.png', [2, 2]),
    waterNrm:   load('/kart%20assets/3D%20Kart/Assets/Models/Water%20Park/Track/GWP_CompD_Water_Nrm.png', [2, 2], false),
    waterSpm:   load('/kart%20assets/3D%20Kart/Assets/Models/Water%20Park/Track/GWP_CompD_Water_Spm.png', [2, 2], false),
    sandAlb:    load('/kart%20assets/3D%20Kart/Assets/Models/Water%20Park/Track/GWP_Water_Sand01_Alb.png', [2, 2]),
    sandNrm:    load('/kart%20assets/3D%20Kart/Assets/Models/Water%20Park/Track/GWP_Water_Sand01_Nrm.png', [2, 2], false),
    sandSpm:    load('/kart%20assets/3D%20Kart/Assets/Models/Water%20Park/Track/GWP_Water_Sand01_Spm.png', [2, 2], false),
    iceAlb:     load('/kart%20assets/3D%20Kart/Assets/Models/Water%20Park/Fountain/ef_water01_Alb.png', [2, 2]),
    iceNrm:     load('/kart%20assets/3D%20Kart/Assets/Models/Water%20Park/Fountain/ef_water01_Nrm.png', [2, 2], false),
    // Super Boost Pad — yellow metal plate + 3 arrows (rotated to face +Z)
    bankAlb:    loadRot(GCYC + 'gcyc_banknewjump_alb.png', [1, 1]),
    bankNrm:    loadRot(GCYC + 'gcyc_banknewjump_nrm.png', [1, 1], false),
    bankSpm:    loadRot(GCYC + 'gcyc_banknewjump_spm.png', [1, 1], false),
    // Oil Slick — actual sea/fluid surface texture, tinted near-black for oil
    seaAlb:     load(GCYC + 'ef_sea05_alb.png',      [2, 2]),
    seaNrm:     load(GCYC + 'ef_sea05_nrm.png',      [2, 2], false),
    // Slow Strip — red/white warning chevron banner (rotated to face forward)
    warnAlb:    loadRot(GCYC + 'gcyc_arrowbanner_t01_alb.png', [1, 1]),
    warnNrm:    loadRot(GCYC + 'gcyc_arrowbanner_t01_nrm.png', [1, 1], false),
    warnSpm:    loadRot(GCYC + 'gcyc_arrowbanner_t01_spm.png', [1, 1], false),
    // Repair Strip — Yoshi Circuit start-grid checker pattern (real medical/grid look)
    repairAlb:  load(GCYC + 'gcyc_startgridcheck_alb.png', [1, 2]),
    repairNrm:  load(GCYC + 'gcyc_startgridcheck_nrm.png', [1, 2], false),
    repairSpm:  load(GCYC + 'gcyc_startgridcheck_spm.png', [1, 2], false),
    // Shared border/frame textures
    asphaltAlb: load(GCYC + 'gcyc_asphalt_t01_alb.png', [2, 2]),
    asphaltNrm: load(GCYC + 'gcyc_asphalt_t01_nrm.png', [2, 2], false),
    metalAlb:   load(GCYC + 'gcyc_metal_m01_alb.png',   [1, 1]),
    metalNrm:   load(GCYC + 'gcyc_metal_m01_nrm.png',   [1, 1], false),
    // Plaza / junction — proper paving + civic detail
    roadAlb:    load(GCYC + 'gcyc_road_t01_alb.png',     [2, 2]),
    roadNrm:    load(GCYC + 'gcyc_road_t01_nrm.png',     [2, 2], false),
    roadSpm:    load(GCYC + 'gcyc_road_t01_spm.png',     [2, 2], false),
    tileAlb:    load(GCYC + 'gcyc_tile_m01_alb.png',     [3, 3]),
    tileNrm:    load(GCYC + 'gcyc_tile_m01_nrm.png',     [3, 3], false),
    circuitAlb: load(GCYC + 'gcyc_circuitmap_m01_alb.png', [1, 1]),
    circuitNrm: load(GCYC + 'gcyc_circuitmap_m01_nrm.png', [1, 1], false),
    concreteAlb:load(GCYC + 'gcyc_concrete_t01_alb.png', [2, 2]),
    concreteNrm:load(GCYC + 'gcyc_concrete_t01_nrm.png', [2, 2], false),
    curbAlb:    load(GCYC + 'gcyc_curbstone_t01_alb.png',[1, 4]),
    curbNrm:    load(GCYC + 'gcyc_curbstone_t01_nrm.png',[1, 4], false),
    grassAlb:   load(GCYC + 'gcyc_grass_m01_alb.png',    [2, 2]),
    grassNrm:   load(GCYC + 'gcyc_grass_m01_nrm.png',    [2, 2], false),
    metalPlate: load(GCYC + 'gcyc_metal_m02_alb.png',    [1, 1]),
    metalParts: load(GCYC + 'gcyc_metalparts_m01_alb.png',[1, 1]),
    lightEmm:   load(GCYC + 'gcyc_light_t01_emm.png',    [1, 1]),
    signAlb:    load(GCYC + 'gcyc_signboard_m01_alb.png',[1, 1]),
  };
})();

// ── STK asset texture cache ──────────────────────────────────────────────────
// SuperTuxKart bundle (CC-BY-SA / GPL) lives at /stk%20assets/textures/. Used
// to give modifier pads, hazards, junctions and intersections a distinct
// hand-painted/PBR look that complements the Yoshi-Circuit-derived MOD_TEX
// bank. Files on disk preserve mixed-case names (extracted from the STK
// archive verbatim), so we DO NOT lowercase URLs here — doing so produced
// hundreds of 404s on Vite/Vercel for files like stktex_generic_tilesA.png.
// Failed loads now silently fall back to a 1x1 pixel so they don't spam.
const _STK_FALLBACK = (() => {
  const c = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
  if (!c) return null;
  c.width = c.height = 2; const g = c.getContext('2d');
  g.fillStyle = '#444'; g.fillRect(0,0,2,2);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
})();
const STK_TEX = (() => {
  const loader = new THREE.TextureLoader();
  const STK = '/stk%20assets/textures/';

  function load(url, repeat = [1, 1], srgb = true, rotation = 0) {
    const tex = loader.load(
      url,
      t => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(repeat[0], repeat[1]);
        t.anisotropy = 16;
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        if (rotation) { t.center.set(0.5, 0.5); t.rotation = rotation; }
      },
      undefined,
      // onError: swap in the silent fallback so console stays clean.
      () => { if (_STK_FALLBACK) Object.assign(tex.image = _STK_FALLBACK.image, {}); },
    );
    return tex;
  }
  return {
    // Boost / launch flag textures
    boostOrange: load(STK + 'stkflag_orangeBooster_a.png'),
    boostBlue:   load(STK + 'stkflag_blueBooster_a.png'),
    boostRed:    load(STK + 'stkflag_redBooster_a.png'),
    boosterFx:   load(STK + 'gfx_booster_AlphaTest.png'),
    jumpRamp:    load(STK + 'stkflag_jumpRamp_a.png'),
    // Warning / stop / direction patterns
    warnPattern: load(STK + 'stktex_warning_a.png',         [1, 2]),
    stopPattern: load(STK + 'stktex_stopPattern_a.png',     [1, 2]),
    dirPattern:  load(STK + 'stktex_directionPattern_a.png',[1, 2]),
    // Wood (boost-pad frame)
    woodA:       load(STK + 'stktex_generic_WoodA.png',  [1, 1]),
    woodA_n:     load(STK + 'stktex_generic_WoodA.png',  [1, 1], false), // diffuse-as-normal fallback
    woodPlanks:  load(STK + 'wood_planks1.jpg',       [1, 1]),
    // Hazards — water
    waterOcean:  load(STK + 'oceanicWater.png',       [2, 2]),
    waterOasis:  load(STK + 'oasis-water.png',        [2, 2]),
    waterJungle: load(STK + 'jungleWater.png',        [2, 2]),
    waterNrm:    load(STK + 'waternormals.jpg',       [3, 3], false),
    waterNrm2:   load(STK + 'waternormals2.jpg',      [2, 2], false),
    caustics:    load(STK + 'caustics.png',           [2, 2]),
    // Hazards — ice
    iceA:        load(STK + 'stk_generic_ice_a.png',         [2, 2]),
    iceA_n:      load(STK + 'stk_generic_ice_a_Normal.png',  [2, 2], false),
    iceA_g:      load(STK + 'stk_generic_ice_a_gloss.png',   [2, 2], false),
    iceEdges:    load(STK + 'stktex_iceEdges_a.png'),
    frozenFall:  load(STK + 'stktex_frozenWaterFall_a.png',  [2, 2]),
    // Hazards — lava
    lavaA:       load(STK + 'stktex_generic_lavaA.png',         [2, 2]),
    lavaA_n:     load(STK + 'stktex_generic_lavaA_Normal.png',  [2, 2], false),
    lavaA_g:     load(STK + 'stktex_generic_lava_gloss.png',    [2, 2], false),
    bedRockLava: load(STK + 'stk_generic_bedRockLava_a.png',    [1, 1]),
    fireAnim:    load(STK + 'stktex_animatedFire_a.png'),
    // Hazards — sand
    sandA:       load(STK + 'stk_generic_sand_a.png',     [2, 2]),
    sandB:       load(STK + 'stk_generic_sand_b.png',     [2, 2]),
    sandRoad:    load(STK + 'stk_generic_sandRoad_a.png', [2, 2]),
    sandGrass:   load(STK + 'sandgrass.png',              [2, 2]),
    // Hazards — oil (improvised from black rock + water shimmer)
    blackRock:   load(STK + 'blackrock.jpg',  [1, 1]),
    tarmac:      load(STK + 'tarmac.jpg',     [2, 2]),
    distort:     load(STK + 'gfx_distord_AlphaTested.png', [2, 2]),
    // Junctions / intersections — surfaces
    stkRoad:     load(STK + 'stklama_road_a.png',       [1, 4]),
    stkGravelRd: load(STK + 'stklama_gravelRoad_a.png', [1, 4]),
    stkGravelSd: load(STK + 'stklama_gravelSide_a.png', [1, 4]),
    stkGravelSdN:load(STK + 'stklama_gravelSide_a_nm.jpg',[1, 4], false),
    stkAsphalt:  load(STK + 'racetrack_asphalt.jpg',    [3, 3]),
    stkAsphaltAlt: load(STK + 'tarmac.jpg',             [3, 3]),
    cityAsphalt1:load(STK + 'city_asphalt_1.jpg',       [3, 3]),
    cityAsphalt2:load(STK + 'city_asphalt_2.jpg',       [3, 3]),
    cityChecker: load(STK + 'city_checker.png',         [2, 2]),
    cityConcrete:load(STK + 'city_concrete.png',        [2, 2]),
    cityBricks:  load(STK + 'city_bricks.png',          [2, 2]),
    cityGrass:   load(STK + 'city_grass.png',           [3, 3]),
    cityGround:  load(STK + 'city_ground.jpg',          [3, 3]),
    cityMetal:   load(STK + 'city_metal.png',           [1, 1]),
    grassA:      load(STK + 'stk_generic_grassA.png',   [3, 3]),
    grassB:      load(STK + 'stk_generic_grassB.png',   [3, 3]),
    grassB_n:    load(STK + 'stk_generic_grassB_Normal.png', [3, 3], false),
    grassDark:   load(STK + 'grass_dark.jpg',           [3, 3]),
    concreteA:   load(STK + 'stktex_generic_concreteA.png',[2, 2]),
    concretePlain:load(STK + 'concrete_plain.png',     [2, 2]),
    brickA:      load(STK + 'stk_generic_brickA.png',   [2, 2]),
    brickA_n:    load(STK + 'stk_generic_brickA_Normal.png', [2, 2], false),
    brickRoad:   load(STK + 'stk_generic_brickRoad_a.png', [2, 2]),
    cobble:      load(STK + 'stktex_generic_cobbleStoneA.png', [2, 2]),
    cobble_n:    load(STK + 'stktex_generic_cobbleStoneA_Normal.png', [2, 2], false),
    tilesA:      load(STK + 'stktex_generic_tilesA.png', [2, 2]),
    tilesB:      load(STK + 'stktex_generic_tilesB.png', [2, 2]),
    marbleA:     load(STK + 'stktex_generic_marbleA.png',[2, 2]),
    paving:      load(STK + 'Paving_stones_2.jpg',       [3, 3]),
    metalRusted: load(STK + 'stkt_rustedMetal_a.png',   [1, 1]),
    metalBlue:   load(STK + 'stk_blueMetal_a.png',      [1, 1]),
    metalGold:   load(STK + 'stk_goldMetal_a.png',      [1, 1]),
    metalGrey:   load(STK + 'stk_greyMetal_a.png',      [1, 1]),
    plates:      load(STK + 'metal_plates.png',         [1, 1]),
    rustedMetal: load(STK + 'stk_metalRustedBlue_a.png',[1, 1]),
    // Decorative emissive
    lantern:     load(STK + 'lantern.jpg',              [1, 1]),
    starParticle:load(STK + 'starparticle.png'),
    flagAsianLan:load(STK + 'stkflag_asianPaperLantern_a.png'),
    // Sky / radial — used as soft glow halos under junctions
    sunRay:      load(STK + 'stk_asianSunRay_a.png'),
  };
})();

// Per-instance texture clone — each animated hazard surface MUST own its
// own texture object, otherwise scrolling its `offset` mutates the shared
// MOD_TEX entry and every other mesh that references it inherits the
// crawl. Use this for any material that will be passed to
// `registerSurfaceScroll`. Image data + GPU upload remain shared so the
// memory cost is negligible.
function cloneTex(tex, opts = {}) {
  if (!tex) return null;
  const c = tex.clone();
  c.needsUpdate = true;
  c.wrapS = c.wrapT = THREE.RepeatWrapping;
  if (opts.repeat) c.repeat.set(opts.repeat[0], opts.repeat[1]);
  if (opts.rotation != null) {
    c.center.set(0.5, 0.5);
    c.rotation = opts.rotation;
  }
  if (opts.offset) c.offset.set(opts.offset[0], opts.offset[1]);
  return c;
}

// ── BOOST PAD ────────────────────────────────────────────────────────────────
// STK orange-booster banner texture forms the chevron face; reclaimed-plank
// frame in real STK wood gives the pad a hand-built, racing-paddock feel.
// A subtle emissive overlay makes the booster glow read at any TOD.
function buildBoostPad() {
  const T = TILE, RW = ROAD_WIDTH, RT = ROAD_THICK;
  const grp = new THREE.Group();

  // Booster face — STK orange flag, oriented so chevrons point along +Z.
  const padTex   = cloneTex(STK_TEX.boostOrange, { rotation: Math.PI / 2 });
  const padMat = new THREE.MeshStandardMaterial({
    map: padTex, color: 0xffffff,
    emissiveMap: padTex, emissive: 0xff7a18, emissiveIntensity: 0.55,
    roughness: 0.42, metalness: 0.18,
  });
  const pad = new THREE.Mesh(new THREE.BoxGeometry(RW * 0.90, 0.14, T * 0.86), padMat);
  pad.position.y = RT + 0.07; pad.receiveShadow = true; pad.castShadow = true; grp.add(pad);

  // Additive scrolling glow strip — sells the "live" booster read.
  const glowTex = cloneTex(STK_TEX.boosterFx, { rotation: Math.PI / 2 });
  const glowMat = new THREE.MeshBasicMaterial({
    map: glowTex, color: 0xffd58a,
    transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(RW * 0.86, T * 0.82), glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = RT + 0.155; glow.renderOrder = 3;
  grp.add(glow);
  registerSurfaceScroll(glow, { u: 0, v: -1.4 });

  // Reclaimed-plank frame using STK wood texture.
  const frameMat = new THREE.MeshStandardMaterial({
    map: STK_TEX.woodPlanks, color: 0xb88a4a,
    roughness: 0.84, metalness: 0.02,
  });
  const FH = 0.28, FD = 1.6;
  for (const sz of [-1, +1]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(RW * 0.94, FH, FD), frameMat);
    b.position.set(0, RT + 0.21, sz * T * 0.46); b.castShadow = true; grp.add(b);
  }
  for (const sx of [-1, +1]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(FD, FH, T * 0.86 - FD), frameMat);
    b.position.set(sx * RW * 0.46, RT + 0.21, 0); b.castShadow = true; grp.add(b);
  }
  return grp;
}

// ── SUPER BOOST PAD ──────────────────────────────────────────────────────────
// STK blue-booster banner running the full two-tile span, sandwiched between
// two scrolling additive `gfx_booster` overlays (cyan inferno read), recessed
// in a brushed-rusted-metal frame with twin emissive cyan LED rails.
function buildSuperBoostPad() {
  const T = TILE, RW = ROAD_WIDTH, RT = ROAD_THICK;
  const LZ = T * 2, czOff = T / 2;
  const grp = new THREE.Group();

  // Brushed STK blue-metal base plate (full footprint).
  const baseMat = new THREE.MeshStandardMaterial({
    map: STK_TEX.metalBlue, color: 0x4a525c, roughness: 0.32, metalness: 0.88,
  });
  const base = new THREE.Mesh(new THREE.BoxGeometry(RW * 0.96, 0.10, LZ * 0.96), baseMat);
  base.position.set(0, RT + 0.05, czOff); base.receiveShadow = true; grp.add(base);

  // STK blue-booster decal — repeated along the long axis so chevrons read
  // clearly across the entire two-tile run. Per-instance clone keeps the
  // repeat/rotation independent of every other consumer of STK_TEX.boostBlue.
  const sbAlb = cloneTex(STK_TEX.boostBlue, { rotation: Math.PI / 2, repeat: [1, 2] });
  const padMat = new THREE.MeshStandardMaterial({
    map: sbAlb, color: 0xffffff,
    emissiveMap: sbAlb, emissive: 0x00aaff, emissiveIntensity: 0.85,
    roughness: 0.28, metalness: 0.45,
  });
  const pad = new THREE.Mesh(new THREE.BoxGeometry(RW * 0.86, 0.14, LZ * 0.92), padMat);
  pad.position.set(0, RT + 0.13, czOff); pad.receiveShadow = true; grp.add(pad);

  // Scrolling booster glow — additive overlay rips along +Z at warp speed
  // so the pad reads as actively pumping energy.
  const glowTex = cloneTex(STK_TEX.boosterFx, { rotation: Math.PI / 2, repeat: [1, 2] });
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(RW * 0.84, LZ * 0.92),
    new THREE.MeshBasicMaterial({
      map: glowTex, color: 0x88e6ff,
      transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(0, RT + 0.21, czOff); glow.renderOrder = 3;
  grp.add(glow);
  registerSurfaceScroll(glow, { u: 0, v: -3.0 });

  // Cyan LED rails along both long edges.
  const ledMat = new THREE.MeshStandardMaterial({
    color: 0x00ddff, emissive: 0x00ccff, emissiveIntensity: 2.4, roughness: 0.18,
  });
  for (const sx of [-1, +1]) {
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, LZ * 0.92), ledMat);
    led.position.set(sx * RW * 0.46, RT + 0.18, czOff); grp.add(led);
  }
  return grp;
}

// ── OIL SLICK ────────────────────────────────────────────────────────────────
// Black mirror of the lava pool — same MK64-style boiling/spitting layout
// but rendered in dark tones. Uses STK black-rock surface tinted near-black
// with a distortion overlay for the slick "wet asphalt" sheen, plus the
// STK water normal map for ripple flow. Reads as a tar/oil hazard while
// still telegraphing "wet, animated, dangerous" through the bubble-pop motion.
function buildOilSlick() {
  return _buildBoilingPool({
    surface: { color: 0x080808, emissive: 0x140a04, emissiveIntensity: 0.45,
               roughness: 0.18, metalness: 0.85,
               map: STK_TEX.blackRock, mapRepeat: [1.5, 1.5],
               normalMap: STK_TEX.waterNrm, normalRepeat: [3, 3] },
    crust:   { color: 0x1a1410, emissive: 0x080404, emissiveIntensity: 0.20,
               roughness: 0.55, metalness: 0.40 },
    bubble:  { color: 0x222020, emissive: 0x110800, emissiveIntensity: 0.40 },
    flare:   { color: 0x444038, emissive: 0x221a0a, emissiveIntensity: 0.60 },
    smoke:   { color: 0x222024, opacity: 0.25 },
    bubbleCount: 5,
    flareCount:  2,
    scroll: { u: 0.03, v: -0.02 },
  });
}

// ── SLOW STRIP ───────────────────────────────────────────────────────────────
// STK red/white stop-pattern banner (oriented to face traffic) bordered by
// cobblestone curbs — reads as a paved low-speed control zone you'd see at
// a downtown tram crossing. Faint emissive on the red bands so it stays
// legible under any lighting.
function buildSlowStrip() {
  const T = TILE, RW = ROAD_WIDTH, RT = ROAD_THICK;
  const grp = new THREE.Group();

  const stopTex = cloneTex(STK_TEX.stopPattern, { rotation: Math.PI / 2, repeat: [2, 1] });
  const surfMat = new THREE.MeshStandardMaterial({
    map: stopTex, color: 0xffffff,
    emissiveMap: stopTex, emissive: 0xff2a1a, emissiveIntensity: 0.32,
    roughness: 0.62, metalness: 0.06,
  });
  const pad = new THREE.Mesh(new THREE.BoxGeometry(RW * 0.92, 0.14, T * 0.88), surfMat);
  pad.position.y = RT + 0.07; pad.receiveShadow = true; pad.castShadow = true; grp.add(pad);

  // STK cobblestone curbs flanking the strip — physical "slow zone" rumble.
  const curbMat = new THREE.MeshStandardMaterial({
    map: STK_TEX.cobble, normalMap: STK_TEX.cobble_n,
    color: 0xb8b1a3, roughness: 0.85, metalness: 0.04,
  });
  for (const sx of [-1, +1]) {
    const curb = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.32, T * 0.92), curbMat);
    curb.position.set(sx * RW * 0.46, RT + 0.16, 0); curb.castShadow = true; grp.add(curb);
  }
  // Red reflector posts at the four corners — supplies extra "caution" read.
  const reflMat = new THREE.MeshStandardMaterial({
    color: 0xff2a1a, emissive: 0xff2a1a, emissiveIntensity: 1.4, roughness: 0.18,
  });
  for (const sx of [-1, +1]) for (const sz of [-1, +1]) {
    const refl = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.55, 10), reflMat);
    refl.position.set(sx * RW * 0.46, RT + 0.42, sz * T * 0.42);
    grp.add(refl);
  }
  return grp;
}

// ── REPAIR STRIP ─────────────────────────────────────────────────────────────
// F-Zero / Mute City-style health regeneration pad: dark recessed bay with
// rapidly scrolling neon chevron bars travelling in the direction of traffic
// flow. The bars alternate hot pink + cyan + lime — F-Zero's classic
// "pit zone" palette — so the pad reads as "energy flowing into your kart"
// rather than as a medical icon. A faint static "+" hologram in the centre
// reinforces the recovery semantics without breaking the neon aesthetic.
//
// The scrolling bars are a procedural CanvasTexture wrapped along the
// drive axis. Per-instance via cloneTex so multiple repair pads on the
// same track scroll independently (and never bleed into each other's UV
// offset).
function _buildHealBarTexture() {
  const w = 64, h = 256;          // tall texture; V axis = drive direction
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  // Dark base — almost black with a faint blue tint so emissive bars pop.
  g.fillStyle = '#080a14';
  g.fillRect(0, 0, w, h);
  // Faint vertical pin-stripes for tech detail.
  g.fillStyle = '#101428';
  for (let x = 0; x < w; x += 8) g.fillRect(x, 0, 1, h);
  // Expanded 80s neon-light palette — every hue lifted from real-world
  // sources of the era: Miami Vice signage, arcade bezels, Lisa Frank
  // stationery, synthwave grids. Strict rule: no muddy mid-tones, no
  // greens darker than electric mint, no warm whites. Cycling 6 hues
  // gives the bar field a richer Saturday-night-strip read than 3.
  const HUES = [
    { core: '#ff2bd6', glow: '#ff8ce6' }, // hot pink
    { core: '#1ee9ff', glow: '#9af1ff' }, // electric cyan
    { core: '#b026ff', glow: '#d98cff' }, // magenta-violet
    { core: '#ff6a00', glow: '#ffb877' }, // sunset orange
    { core: '#39ff8c', glow: '#b3ffd1' }, // electric mint
    { core: '#ffe617', glow: '#fff39a' }, // arcade yellow
  ];
  const BAR_H = 36;               // height of each bar in px
  const GAP   = 28;               // dark gap between bars
  const PITCH = BAR_H + GAP;
  for (let y = -PITCH; y < h + PITCH; y += PITCH) {
    const hue = HUES[(((y / PITCH) | 0) + HUES.length * 8) % HUES.length];
    // Glow halo
    const grad = g.createLinearGradient(0, y, 0, y + BAR_H);
    grad.addColorStop(0.0,  '#00000000');
    grad.addColorStop(0.20, hue.glow);
    grad.addColorStop(0.50, hue.core);
    grad.addColorStop(0.80, hue.glow);
    grad.addColorStop(1.0,  '#00000000');
    g.fillStyle = grad;
    g.fillRect(0, y, w, BAR_H);
    // Bright leading edge — a 2px highlight so the bar reads as moving
    // forward even on a still frame.
    g.fillStyle = '#ffffff';
    g.fillRect(0, y + BAR_H * 0.20, w, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  tex.needsUpdate = true;
  return tex;
}
// Cache the canvas — every repair strip clones from this template so they
// all share one rasterisation cost but maintain independent UV offsets.
const _HEAL_BAR_TPL = (typeof document !== 'undefined') ? _buildHealBarTexture() : null;

function buildRepairStrip() {
  const T = TILE, RW = ROAD_WIDTH, RT = ROAD_THICK;
  const grp = new THREE.Group();

  // Recessed dark bay — the bars look brighter against a near-black
  // surface, and the slight inset implies a "pit lane" channel.
  const bayMat = new THREE.MeshStandardMaterial({
    color: 0x05070d, roughness: 0.45, metalness: 0.40,
  });
  const bay = new THREE.Mesh(new THREE.BoxGeometry(RW * 0.94, 0.10, T * 0.90), bayMat);
  bay.position.y = RT + 0.05; bay.receiveShadow = true; grp.add(bay);

  // Scrolling neon bar plate — top-face UV V advances along the local
  // +Z axis, which in editor space is the drive direction. Cloned per
  // instance so the scroll offset is independent.
  const barTex = _HEAL_BAR_TPL ? _HEAL_BAR_TPL.clone() : null;
  if (barTex) {
    barTex.needsUpdate = true;
    barTex.wrapS = barTex.wrapT = THREE.RepeatWrapping;
    // Repeat along V so several bars are visible across the pad's length.
    barTex.repeat.set(1, 1.6);
  }
  const plateMat = new THREE.MeshStandardMaterial({
    map: barTex,
    emissiveMap: barTex,
    color: 0xffffff,
    emissive: 0xffffff, emissiveIntensity: 1.6,
    roughness: 0.30, metalness: 0.20,
  });
  const plate = new THREE.Mesh(new THREE.BoxGeometry(RW * 0.88, 0.06, T * 0.86), plateMat);
  plate.position.y = RT + 0.115;
  grp.add(plate);
  // Aggressive scroll along V — bars rip past at near-warp speed, selling
  // the F-Zero pit-zone 'energy infusion' read. Negative V drives the
  // texture toward +Z (the kart's forward direction).
  registerSurfaceScroll(plate, { u: 0, v: -3.6 });

  // Cheap glow halo — a second, slightly larger plate hovering 2cm above
  // the main scroll, sharing the SAME texture (no extra rasterisation,
  // no postFX), drawn with AdditiveBlending so its bright bars bloom into
  // the surrounding air rather than dimming with distance. The added cost
  // is one extra alpha-blended quad per repair pad — negligible vs a
  // bloom postprocess pass that would hit the whole frame.
  const haloMat = new THREE.MeshBasicMaterial({
    map: barTex,
    color: 0xffffff,
    transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(RW * 0.94, T * 0.92), haloMat);
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = RT + 0.155;
  halo.renderOrder = 3;
  grp.add(halo);

  // Side LED rails — solid emissive cyan strips flanking the bay so the
  // pad's silhouette pops even before the scroll catches the eye.
  const railMat = new THREE.MeshStandardMaterial({
    color: 0x00e6ff, emissive: 0x00ccff, emissiveIntensity: 2.6, roughness: 0.18,
  });
  for (const sx of [-1, +1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.20, T * 0.92), railMat);
    rail.position.set(sx * RW * 0.46, RT + 0.18, 0); grp.add(rail);
  }

  // Brushed metal border frame — pulled outward and raised so it sits
  // clearly *around* the bay, not inside it. STK rusted-metal sells the
  // grimy "pit-lane" feel that complements the neon scroll.
  const frameMat = new THREE.MeshStandardMaterial({
    map: STK_TEX.rustedMetal,
    color: 0x4a525c, roughness: 0.55, metalness: 0.78,
  });
  const FD = 0.6;
  for (const sz of [-1, +1]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(RW * 0.96 + FD * 2, 0.18, FD), frameMat);
    b.position.set(0, RT + 0.16, sz * (T * 0.44 + FD / 2)); b.castShadow = true; grp.add(b);
  }
  for (const sx of [-1, +1]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(FD, 0.18, T * 0.88), frameMat);
    b.position.set(sx * (RW * 0.46 + FD / 2), RT + 0.16, 0); b.castShadow = true; grp.add(b);
  }
  return grp;
}

// ── ITEM BOX ────────────────────────────────────────────────────────────────
// Mario-Kart classic floating ?-cube. Body uses the diamond `ItemBox_Alb`
// pattern; six face decals stamp a bold orange `G` glyph drawn to a
// procedural canvas (same chunky font feel as the original `?`) so the
// pickup reads instantly from any angle. A soft refraction shell +
// emissive core sell the rotating-glass look.

// Procedural decal texture: transparent background + chunky orange
// glyph with a darker outline + soft inner highlight. Mirrors the
// look of the baked `ItemBoxFont_Alb.png` so the cube reads the same
// from a distance.
let _ITEM_BOX_GLYPH_CACHE = Object.create(null);
function _buildItemBoxGlyphTexture(letter) {
  if (_ITEM_BOX_GLYPH_CACHE[letter]) return _ITEM_BOX_GLYPH_CACHE[letter];
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Heavy condensed sans — matches the MK item-box `?` weight.
  const fam = '"Arial Black", "Helvetica Neue", Impact, sans-serif';
  ctx.font = `900 ${Math.round(S * 0.78)}px ${fam}`;
  const cx = S / 2, cy = S / 2 + S * 0.03;
  // Dark outline pass for readability against the glass cube.
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#04101c';
  ctx.lineWidth = S * 0.10;
  ctx.strokeText(letter, cx, cy);
  // White fill — the per-frame `material.color` + `material.emissive`
  // drive the actual hue so we can cycle through neon blues cheaply.
  ctx.fillStyle = '#ffffff';
  ctx.fillText(letter, cx, cy);
  // Inner highlight for the glossy front face read.
  ctx.fillStyle = 'rgba(220, 240, 255, 0.55)';
  ctx.font = `900 ${Math.round(S * 0.74)}px ${fam}`;
  ctx.fillText(letter, cx, cy - S * 0.04);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  _ITEM_BOX_GLYPH_CACHE[letter] = tex;
  return tex;
}

function buildItemBox() {
  const grp = new THREE.Group();
  pickupPedestal(grp, 0xddeeff, 0x3388ff, 1.55);

  const SIZE = 1.55;
  const cy = ROAD_THICK + 1.20;

  // Wrap the cube + decals + glow shell in a single host so they all
  // rotate together via the central pickup-spin registry.
  const host = new THREE.Group();
  host.position.set(0, cy, 0);
  grp.add(host);

  const bodyMat = new THREE.MeshStandardMaterial({
    map: MOD_TEX.itemBoxAlb, normalMap: MOD_TEX.itemBoxNrm,
    color: 0xffffff, roughness: 0.42, metalness: 0.10,
    emissive: 0x224488, emissiveIntensity: 0.18,
  });
  const cube = new THREE.Mesh(new THREE.BoxGeometry(SIZE, SIZE, SIZE), bodyMat);
  cube.castShadow = true; cube.receiveShadow = true; host.add(cube);

  // Six `G` decals — one per face, slightly proud of the cube surface
  // and depth-offset so they never z-fight with the diamond pattern.
  // Procedural canvas texture so the glyph follows the same bold
  // Mario-Kart-style font without needing a baked PNG. Hue is driven
  // per-frame from `material.color`/`emissive` so the glyph slowly
  // alternates between neon-blue tones with a soft glow pulse.
  const glyphTex = _buildItemBoxGlyphTexture('G');
  const decalMat = new THREE.MeshStandardMaterial({
    map: glyphTex,
    color: 0x66ccff, transparent: true, opacity: 1.0, alphaTest: 0.18,
    roughness: 0.35, metalness: 0.05,
    emissiveMap: glyphTex, emissive: 0x4488ff, emissiveIntensity: 1.4,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
  });
  const D = SIZE * 0.92, OFF = SIZE / 2 + 0.012;
  const faces = [
    { pos: [0, 0,  OFF], rot: [0, 0, 0] },
    { pos: [0, 0, -OFF], rot: [0, Math.PI, 0] },
    { pos: [ OFF, 0, 0], rot: [0, Math.PI / 2, 0] },
    { pos: [-OFF, 0, 0], rot: [0, -Math.PI / 2, 0] },
    { pos: [0,  OFF, 0], rot: [-Math.PI / 2, 0, 0] },
    { pos: [0, -OFF, 0], rot: [Math.PI / 2, 0, 0] },
  ];
  for (const f of faces) {
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(D, D), decalMat);
    decal.position.set(f.pos[0], f.pos[1], f.pos[2]);
    decal.rotation.set(f.rot[0], f.rot[1], f.rot[2]);
    decal.renderOrder = 2;
    host.add(decal);
  }

  // Outer refraction shell — keeps the original "glass cube" silhouette.
  const glowMat = new THREE.MeshStandardMaterial({
    map: MOD_TEX.itemBoxRef, color: 0xdfeaff,
    emissive: 0x66aaff, emissiveIntensity: 0.85,
    roughness: 0.10, metalness: 0.0, transparent: true, opacity: 0.28,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const glow = new THREE.Mesh(new THREE.BoxGeometry(SIZE * 1.10, SIZE * 1.10, SIZE * 1.10), glowMat);
  host.add(glow);

  // Emissive inner core for the rotating "energy" feel — sits at host
  // origin so it stays visually pinned even as the cube tumbles.
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x77bbff, emissiveIntensity: 2.6, roughness: 0.0 }),
  );
  grp.add(core);
  core.position.set(0, cy, 0);

  registerPickupSpin(host);

  // Slow neon-blue hue cycle on the `G` glyph. One Color.setHSL +
  // small intensity lerp per frame on a single shared material —
  // negligible cost regardless of how many item boxes are placed.
  // Hue sweeps cyan → azure → indigo → back; emissive intensity
  // breathes for a soft glow pulse.
  {
    const _tmpFill = new THREE.Color();
    const _tmpEmit = new THREE.Color();
    const PERIOD = 4.5;       // seconds per full sweep
    const HUE_LO = 0.48;      // ~cyan
    const HUE_HI = 0.72;      // ~indigo
    registerSurfaceTick({
      host,
      fn: (_dt, t) => {
        const phase = (Math.sin((t / PERIOD) * Math.PI * 2) + 1) * 0.5;
        const hue = HUE_LO + (HUE_HI - HUE_LO) * phase;
        _tmpFill.setHSL(hue, 0.85, 0.62);
        _tmpEmit.setHSL(hue, 1.00, 0.55);
        decalMat.color.copy(_tmpFill);
        decalMat.emissive.copy(_tmpEmit);
        decalMat.emissiveIntensity = 1.05 + 0.55 * phase;
      },
    });
  }
  return grp;
}

// ── HEAVY CRATE ─────────────────────────────────────────────────────────────
// Wii-U "CrashBox" wood crate. Wood faces use the album texture with a faint
// amber emissive trim so the contents read as "explosive". Iron bands and
// corner bolts use the metal_parts texture for a believable PBR look.
function buildHeavyCrate() {
  const grp = new THREE.Group();
  pickupPedestal(grp, 0xc8b890, 0xff8822, 1.85);
  const cy = ROAD_THICK + 1.16;
  const bodyMat = new THREE.MeshStandardMaterial({
    map: MOD_TEX.crateAlb, normalMap: MOD_TEX.crateNrm, roughnessMap: MOD_TEX.crateSpm,
    color: 0xffffff, roughness: 0.72, metalness: 0.08,
    emissive: 0x3a1b00, emissiveIntensity: 0.10,
  });
  const crate = new THREE.Mesh(new THREE.BoxGeometry(1.82, 1.72, 1.82), bodyMat);
  crate.position.set(0, cy, 0);
  crate.castShadow = true; crate.receiveShadow = true; grp.add(crate);

  const bandMat = new THREE.MeshStandardMaterial({
    map: MOD_TEX.metalParts, color: 0x2a2d34, roughness: 0.42, metalness: 0.88,
  });
  for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const band = new THREE.Mesh(
      sx !== 0
        ? new THREE.BoxGeometry(0.12, 1.58, 1.88)
        : new THREE.BoxGeometry(1.88, 1.58, 0.12),
      bandMat,
    );
    band.position.set(sx * 0.72, cy, sz * 0.72);
    grp.add(band);
  }
  const boltMat = new THREE.MeshStandardMaterial({
    map: MOD_TEX.metalAlb, color: 0x9aa0aa, roughness: 0.30, metalness: 0.95,
  });
  for (const sx of [-1, +1]) for (const sz of [-1, +1]) {
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 0.10, 8), boltMat);
    bolt.position.set(sx * 0.78, cy + 0.86, sz * 0.78); grp.add(bolt);
  }
  // Top "DANGER" striped warning chevrons — small thin mesh pinned to the lid.
  const lidStripeMat = new THREE.MeshBasicMaterial({
    color: 0xffcf2a, transparent: true, opacity: 0.85,
  });
  for (let i = -1; i <= 1; i++) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(1.45, 0.12), lidStripeMat);
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(0, cy + 0.87, i * 0.34);
    grp.add(stripe);
  }
  return grp;
}

// ── HEALTH ORB ──────────────────────────────────────────────────────────────
// Bright green pulsing orb with four medical-cross emblems facing the four
// horizontal directions plus a halo ring on the ground. The whole stack
// pulses + spins so it stays readable from any approach angle.
function buildHealthOrb() {
  const grp = new THREE.Group();
  pickupPedestal(grp, 0xc8ffd6, 0x33dd55, 1.40);
  const cy = ROAD_THICK + 1.20;

  const host = new THREE.Group();
  host.position.set(0, cy, 0);
  grp.add(host);

  const orbMat = new THREE.MeshStandardMaterial({
    color: 0x8effb6, emissive: 0x48ff88, emissiveIntensity: 1.8,
    roughness: 0.12, metalness: 0.0,
    transparent: true, opacity: 0.92,
  });
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.82, 18, 14), orbMat);
  orb.castShadow = true; host.add(orb);

  // Four medical crosses — front / back / left / right — so the pickup
  // identity is unmistakable from any approach.
  const crossMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: 0x66ffaa, emissiveIntensity: 2.4, roughness: 0.18,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const dirs = [
    { rotY: 0,             pos: [0, 0,  0.86] },
    { rotY: Math.PI,       pos: [0, 0, -0.86] },
    { rotY: Math.PI / 2,   pos: [ 0.86, 0, 0] },
    { rotY: -Math.PI / 2,  pos: [-0.86, 0, 0] },
  ];
  for (const d of dirs) {
    const crossGrp = new THREE.Group();
    crossGrp.position.set(d.pos[0], d.pos[1], d.pos[2]);
    crossGrp.rotation.y = d.rotY;
    const arm1 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.95, 0.06), crossMat);
    const arm2 = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.22, 0.06), crossMat);
    crossGrp.add(arm1); crossGrp.add(arm2);
    host.add(crossGrp);
  }

  // Halo ring on the ground — pulses with the orb so designers see the
  // pickup's footprint even when looking down from above.
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.95, 0.05, 8, 28),
    new THREE.MeshStandardMaterial({ color: 0x88ffaa, emissive: 0x44ff88, emissiveIntensity: 1.4, roughness: 0.18 }),
  );
  halo.rotation.x = Math.PI / 2;
  halo.position.set(0, ROAD_THICK + 0.06, 0);
  grp.add(halo);

  registerPickupSpin(host);
  return grp;
}

// ── COIN ────────────────────────────────────────────────────────────────────
// MK-style spinning gold coin. CylinderGeometry materials are indexed
// [side, top, bottom] — we apply the coin album texture to the two caps
// and a polished gold-metal material to the rim so the texture never
// stretches across the side (the long-standing visual bug).
function buildCoinPickup() {
  const grp = new THREE.Group();
  pickupPedestal(grp, 0xfff0c4, 0xffaa22, 1.20);
  const cy = ROAD_THICK + 1.05;

  const faceMat = new THREE.MeshStandardMaterial({
    map: MOD_TEX.coinAlb, normalMap: MOD_TEX.coinNrm, roughnessMap: MOD_TEX.coinSpm,
    color: 0xffffff, roughness: 0.32, metalness: 0.85,
    emissive: 0x4a3300, emissiveIntensity: 0.18,
  });
  // Solid polished gold rim — no texture map. The lateral surface of a
  // CylinderGeometry has a single-strip UV that stretches square textures
  // into ugly bands, which was the source of the coin's old 'mistextured'
  // look. A flat gold-metal material reads cleaner from every angle.
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xffcc40, roughness: 0.22, metalness: 0.95,
    emissive: 0x553300, emissiveIntensity: 0.22,
  });
  // Material order for CylinderGeometry: [0]=lateral, [1]=top, [2]=bottom.
  const coin = new THREE.Mesh(
    new THREE.CylinderGeometry(0.68, 0.68, 0.14, 28),
    [rimMat, faceMat, faceMat],
  );
  coin.position.set(0, cy, 0);
  coin.rotation.x = Math.PI / 2; // stand on edge
  coin.castShadow = true; grp.add(coin);

  // Subtle outer halo ring at the base so the coin reads even when the
  // disc faces the camera edge-on.
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.92, 0.05, 8, 28),
    new THREE.MeshStandardMaterial({ color: 0xffde80, emissive: 0xffc84d, emissiveIntensity: 1.6, roughness: 0.08 }),
  );
  halo.rotation.x = Math.PI / 2;
  halo.position.set(0, ROAD_THICK + 0.06, 0);
  grp.add(halo);

  registerPickupSpin(coin);
  return grp;
}

// Shared pickup pedestal helper — small tile disc with curbstone ring + ground glow.
// Gives every pickup a consistent design-space "footprint" so designers can see
// where a pickup sits even when the floating model is far above the road.
function pickupPedestal(grp, baseColor, glowColor, radius) {
  const RT = ROAD_THICK;
  const tileMat = new THREE.MeshStandardMaterial({
    map: MOD_TEX.tileAlb, normalMap: MOD_TEX.tileNrm,
    color: baseColor, roughness: 0.62, metalness: 0.08,
  });
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 0.08, 28), tileMat,
  );
  disc.position.set(0, RT + 0.04, 0); disc.receiveShadow = true; grp.add(disc);
  const ringMat = new THREE.MeshStandardMaterial({
    map: MOD_TEX.curbAlb, normalMap: MOD_TEX.curbNrm,
    roughness: 0.66, metalness: 0.05,
  });
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.10, 6, 28), ringMat,
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, RT + 0.08, 0); grp.add(ring);
  const haloMat = new THREE.MeshStandardMaterial({
    color: glowColor, emissive: glowColor, emissiveIntensity: 0.85,
    transparent: true, opacity: 0.35, roughness: 0.20, side: THREE.DoubleSide,
  });
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.45, radius * 0.92, 28), haloMat,
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.set(0, RT + 0.09, 0); grp.add(halo);
}

function buildCapEnd() {
  const grp = new THREE.Group();
  // Re-use straight deck for the cell
  grp.add(buildStraight(TILE, { noPaint: true }));
  // Chevron warning wall at +Z edge
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(TILE, WALL_HEIGHT * 1.1, WALL_THICK * 1.4),
    MATS.guardrail,
  );
  wall.position.set(0, ROAD_THICK + WALL_HEIGHT * 0.55, TILE / 2 - WALL_THICK * 0.7);
  wall.castShadow = true; wall.receiveShadow = true;
  grp.add(wall);
  // Yellow/black hazard chevrons on the wall face
  for (let i = -2; i <= 2; i++) {
    const chev = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.5, 0.06),
      i % 2 === 0 ? MATS.warning : new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 }),
    );
    chev.position.set(i * 1.8, ROAD_THICK + WALL_HEIGHT * 0.55, TILE / 2 - WALL_THICK * 1.4 + 0.04);
    grp.add(chev);
  }
  return grp;
}

function buildFinish() {
  const grp = new THREE.Group();
  grp.add(buildStraight(TILE, { noPaint: true }));
  // Checker pattern across the road. Sit slightly above the road surface
  // (no polygonOffset — that was bleeding through the road's underside at
  // grazing angles). Render-order forces the checker to draw last on top.
  const cells = 12;
  const cellW = ROAD_WIDTH / cells;
  const checkerY = ROAD_THICK + 0.06;
  const blackMat = new THREE.MeshStandardMaterial({
    color: 0x0a0a0a,
    roughness: 0.5,
  });
  const whiteMat = new THREE.MeshStandardMaterial({
    color: 0xf2f2f2,
    roughness: 0.55,
  });
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < 2; j++) {
      const isBlack = (i + j) % 2 === 0;
      const tile = new THREE.Mesh(
        new THREE.BoxGeometry(cellW * 0.94, 0.02, cellW * 0.94),
        isBlack ? blackMat : whiteMat,
      );
      tile.position.set(
        -ROAD_WIDTH / 2 + cellW * (i + 0.5),
        checkerY,
        (j - 0.5) * cellW,
      );
      tile.renderOrder = 2;
      grp.add(tile);
    }
  }
  // Side gantry posts — tall enough to clear any kart with comfortable headroom.
  // Banner sits forward of the checker line so the two don't visually collide.
  const POST_H = 6.5;
  const BAR_Y = ROAD_THICK + POST_H - 0.4;
  const BANNER_Z = 1.6;
  for (const sx of [-1, +1]) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, POST_H, 14),
      MATS.finish,
    );
    post.position.set(sx * (TILE / 2 - 0.3), ROAD_THICK + POST_H / 2, BANNER_Z);
    post.castShadow = true;
    grp.add(post);
  }
  // Top crossbar
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(TILE - 0.4, 0.4, 0.4),
    MATS.finish,
  );
  bar.position.set(0, BAR_Y, BANNER_Z);
  bar.castShadow = true;
  grp.add(bar);
  // Banner (hangs from crossbar)
  const bannerH = 1.4;
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(TILE - 0.8, bannerH, 0.06),
    new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0xffaa00, emissiveIntensity: 0.4, roughness: 0.6,
    }),
  );
  banner.position.set(0, BAR_Y - 0.2 - bannerH / 2, BANNER_Z);
  grp.add(banner);
  return grp;
}

function buildSpawn() {
  const grp = new THREE.Group();
  grp.add(buildStraight(TILE, { noPaint: true, noCurbs: true }));
  // Glowing pad
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(2.6, 2.6, 0.08, 32),
    MATS.spawn,
  );
  pad.position.set(0, ROAD_THICK + 0.05, 0);
  grp.add(pad);
  // Ring around pad
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.8, 0.08, 8, 32),
    MATS.spawn,
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, ROAD_THICK + 0.06, 0);
  grp.add(ring);
  // Forward arrow
  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.6, 1.2, 4),
    MATS.spawn,
  );
  arrow.rotation.x = Math.PI / 2;
  arrow.rotation.z = Math.PI / 4;
  arrow.position.set(0, ROAD_THICK + 0.4, 1.4);
  grp.add(arrow);
  return grp;
}

// ── ASSET-BACKED PICKUPS (Phase A) ─────────────────────────────────────────
// Creates a pickup pedestal + a procedural sphere placeholder, and
// asynchronously swaps the placeholder for the real .dae model from
// `frontend/public/kart assets/`. Both the placeholder and the loaded
// model are tagged `__pickupCube` so play-main's consume/respawn show/
// hide logic continues to work seamlessly.
function buildAssetPickup(modelName, opts = {}) {
  const {
    pedestalColor = 0xeef0ff,
    glowColor     = 0x88aaff,
    pedestalRad   = 1.45,
    placeholderColor = 0xffffff,
    floatY = ROAD_THICK + 1.20,
  } = opts;
  const grp = new THREE.Group();
  pickupPedestal(grp, pedestalColor, glowColor, pedestalRad);

  // Procedural placeholder — visible until the .dae streams in.
  const ph = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 16, 12),
    new THREE.MeshStandardMaterial({
      color: placeholderColor, emissive: placeholderColor, emissiveIntensity: 0.45,
      roughness: 0.30, metalness: 0.10,
    }),
  );
  ph.position.set(0, floatY, 0);
  ph.castShadow = true;
  ph.userData.__pickupCube = true;
  ph.userData.__assetPickupPlaceholder = true;
  grp.add(ph);
  registerPickupSpin(ph);

  const swapIn = (inst) => {
    if (!inst) return;
    inst.position.set(0, floatY, 0);
    inst.userData.__pickupCube = true;
    inst.userData.__assetPickupModel = modelName;
    inst.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.userData.__pickupCube = true;
      }
    });
    // Remove placeholder, add real model.
    grp.remove(ph);
    ph.geometry.dispose?.();
    ph.material.dispose?.();
    grp.add(inst);
    registerPickupSpin(inst);
  };

  // Try cached first; otherwise kick off a load and listen. Both paths
  // call instanceItemModel() so SkinnedMesh assets get a properly
  // re-bound skeleton via SkeletonUtils.clone — a plain Object3D.clone
  // would share bones with the cached template and the mesh would
  // render at the template's location (i.e. invisible) instead of here.
  const cached = instanceItemModel(modelName);
  if (cached) {
    swapIn(cached);
  } else {
    loadItemModel(modelName).then(() => {
      // Only swap if the placeholder is still in the group (i.e. the
      // group hasn't been disposed by the editor in the meantime).
      if (ph.parent === grp) swapIn(instanceItemModel(modelName));
    }).catch(() => { /* keep placeholder */ });
  }

  return grp;
}

// Generic reference-prop builders used by Phase E city/intersection items.
// They keep the editor responsive by showing a tiny placeholder immediately,
// then swap in a cached clone once the source model stream completes.
function _fitAndPlaceAsset(obj, targetSize = 2.4, y = ROAD_THICK + 0.05, rotY = 0) {
  if (!obj) return null;
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  if (!isFinite(size.x) || !isFinite(size.y) || !isFinite(size.z)) return obj;
  const widest = Math.max(size.x, size.z, 0.001);
  const scale = targetSize / widest;

  const wrap = new THREE.Group();
  wrap.add(obj);
  obj.position.x -= center.x;
  obj.position.z -= center.z;
  obj.position.y -= box.min.y;
  wrap.scale.setScalar(scale);
  wrap.position.y = y;
  wrap.rotation.y = rotY;
  return wrap;
}

function buildReferenceDaeProp(modelName, opts = {}) {
  const {
    placeholderColor = 0x4f5762,
    placeholderSize = 0.8,
    targetSize = 2.4,
    y = ROAD_THICK + 0.05,
    rotY = 0,
  } = opts;
  const grp = new THREE.Group();
  const ph = new THREE.Mesh(
    new THREE.BoxGeometry(placeholderSize, placeholderSize, placeholderSize),
    new THREE.MeshStandardMaterial({ color: placeholderColor, roughness: 0.7, metalness: 0.1 }),
  );
  ph.position.y = y + placeholderSize * 0.5;
  ph.castShadow = true;
  grp.add(ph);

  const swapIn = (inst) => {
    const fitted = _fitAndPlaceAsset(inst, targetSize, y, rotY);
    if (!fitted) return;
    grp.remove(ph);
    ph.geometry.dispose?.();
    ph.material.dispose?.();
    grp.add(fitted);
  };

  const cached = instanceItemModel(modelName);
  if (cached) {
    swapIn(cached);
  } else {
    loadItemModel(modelName).then(() => {
      if (ph.parent === grp) swapIn(instanceItemModel(modelName));
    }).catch(() => { /* keep placeholder */ });
  }
  // Mark the vertical offset baked into the builder so model-decor wrappers
  // (free-placement on the workplane) can subtract it and have the asset
  // sit with its base at the wrap origin.
  grp.userData.baseYOffset = y;
  return grp;
}

function buildReferenceFbxProp(path, opts = {}) {
  const {
    placeholderColor = 0x5c6068,
    placeholderSize = 1.2,
    targetSize = 3.2,
    y = ROAD_THICK + 0.05,
    rotY = 0,
  } = opts;
  const grp = new THREE.Group();
  const ph = new THREE.Mesh(
    new THREE.BoxGeometry(placeholderSize, placeholderSize * 0.6, placeholderSize * 1.6),
    new THREE.MeshStandardMaterial({ color: placeholderColor, roughness: 0.7, metalness: 0.2 }),
  );
  ph.position.y = y + placeholderSize * 0.3;
  ph.castShadow = true;
  grp.add(ph);

  const swapIn = (inst) => {
    const fitted = _fitAndPlaceAsset(inst, targetSize, y, rotY);
    if (!fitted) return;
    grp.remove(ph);
    ph.geometry.dispose?.();
    ph.material.dispose?.();
    grp.add(fitted);
  };

  const cached = instanceFBX(path);
  if (cached) {
    swapIn(cached);
  } else {
    loadFBX(path).then(() => {
      if (ph.parent === grp) swapIn(instanceFBX(path));
    }).catch(() => { /* keep placeholder */ });
  }
  grp.userData.baseYOffset = y;
  return grp;
}

function buildStkProp(path, opts = {}) {
  const {
    placeholderColor = 0x6e737c,
    placeholderSize = 1.2,
    targetSize = 3.5,
    y = ROAD_THICK + 0.02,
    rotY = 0,
  } = opts;
  const grp = new THREE.Group();
  const ph = new THREE.Mesh(
    new THREE.BoxGeometry(placeholderSize, placeholderSize * 0.6, placeholderSize),
    new THREE.MeshStandardMaterial({ color: placeholderColor, roughness: 0.72, metalness: 0.08 }),
  );
  ph.position.y = y + placeholderSize * 0.3;
  ph.castShadow = true;
  grp.add(ph);

  const swapIn = (inst) => {
    const fitted = _fitAndPlaceAsset(inst, targetSize, y, rotY);
    if (!fitted) return;
    grp.remove(ph);
    ph.geometry.dispose?.();
    ph.material.dispose?.();
    grp.add(fitted);
  };

  const cached = instanceStkSpm(path);
  if (cached) {
    swapIn(cached);
  } else {
    loadStkSpm(path).then(() => {
      if (ph.parent === grp) swapIn(instanceStkSpm(path));
    }).catch(() => { /* keep placeholder */ });
  }
  grp.userData.baseYOffset = y;
  return grp;
}

// Per-segment pickup builders (Phase A).
function buildPkMushroom()        { return buildAssetPickup('mushroom',        { pedestalColor: 0xffd6d6, glowColor: 0xff7777, placeholderColor: 0xff8888 }); }
function buildPkGoldenMushroom()  { return buildAssetPickup('golden_mushroom', { pedestalColor: 0xfff2c4, glowColor: 0xffc24a, placeholderColor: 0xffd24a }); }
function buildPkStar()            { return buildAssetPickup('star',            { pedestalColor: 0xfff7c4, glowColor: 0xffe04a, placeholderColor: 0xfff066 }); }
function buildPkGreenShell()      { return buildAssetPickup('green_shell',     { pedestalColor: 0xd2ffd6, glowColor: 0x55ff66, placeholderColor: 0x55ff66 }); }
function buildPkRedShell()        { return buildAssetPickup('red_shell',       { pedestalColor: 0xffd2d2, glowColor: 0xff5555, placeholderColor: 0xff5555 }); }
function buildPkBlueShell()       { return buildAssetPickup('blue_shell',      { pedestalColor: 0xd2dbff, glowColor: 0x3a7bff, placeholderColor: 0x3a7bff }); }
function buildPkBanana()          { return buildAssetPickup('banana',          { pedestalColor: 0xfff4c4, glowColor: 0xffe066, placeholderColor: 0xffe066 }); }
function buildPkBulletBill()      { return buildAssetPickup('bullet_bill',     { pedestalColor: 0xc4c8d2, glowColor: 0x222831, placeholderColor: 0x444855 }); }
function buildPkBobomb() {
  // No .dae for Bobomb (only .blend) — render an enriched procedural fallback.
  const grp = new THREE.Group();
  pickupPedestal(grp, 0xc4c4c4, 0x222222, 1.45);
  // Wrap rotating parts in a single host so the slow-spin reads as one
  // rigid object rather than three independently spinning sub-meshes.
  const host = new THREE.Group();
  host.position.set(0, ROAD_THICK + 1.20, 0);
  host.userData.__pickupCube = true;
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.62, 18, 14),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.42, metalness: 0.55 }),
  );
  body.castShadow = true; body.userData.__pickupCube = true; host.add(body);
  const fuse = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 0.42, 8),
    new THREE.MeshStandardMaterial({ color: 0xc8a060, roughness: 0.85 }),
  );
  fuse.position.set(0, 0.65, 0); fuse.userData.__pickupCube = true; host.add(fuse);
  const spark = new THREE.Mesh(
    new THREE.SphereGeometry(0.10, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xffd54a, emissive: 0xffaa22, emissiveIntensity: 2.2 }),
  );
  spark.position.set(0, 0.90, 0); spark.userData.__pickupCube = true; host.add(spark);
  grp.add(host);
  registerPickupSpin(host);
  return grp;
}

// ── v8 / Vigilante procedural pickup builders ─────────────────────
// No source DAEs for these — each gets a low-poly stylized icon
// (≤ 4 meshes / ≤ 200 tris) with the pedestal halo for consistency.
// All rotate as a single host group so the spin reads as one rigid
// object.
function _v8Host(floatY = ROAD_THICK + 1.20) {
  const host = new THREE.Group();
  host.position.set(0, floatY, 0);
  host.userData.__pickupCube = true;
  return host;
}

function buildPkV8Missile() {
  const grp = new THREE.Group();
  pickupPedestal(grp, 0xf2d0b4, 0xc25a14, 1.45);
  const host = _v8Host();
  const matBody = new THREE.MeshStandardMaterial({ color: 0xc25a14, metalness: 0.45, roughness: 0.45 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.10, 12), matBody);
  body.rotation.z = Math.PI / 2;
  body.userData.__pickupCube = true; host.add(body);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.36, 12), new THREE.MeshStandardMaterial({ color: 0xffaa55, emissive: 0xff7a22, emissiveIntensity: 0.6 }));
  tip.rotation.z = -Math.PI / 2; tip.position.x = 0.73; tip.userData.__pickupCube = true; host.add(tip);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.05, 0.30), matBody);
  fin.position.x = -0.42; fin.userData.__pickupCube = true; host.add(fin);
  grp.add(host); registerPickupSpin(host); return grp;
}

function buildPkV8Cannon() {
  const grp = new THREE.Group();
  pickupPedestal(grp, 0xd6dae0, 0x8a8f99, 1.45);
  const host = _v8Host();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.55, 18, 14), new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.7, roughness: 0.32 }));
  ball.userData.__pickupCube = true; host.add(ball);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.08, 6, 24), new THREE.MeshStandardMaterial({ color: 0x8a8f99, metalness: 0.6, roughness: 0.4 }));
  ring.rotation.x = Math.PI / 2; ring.userData.__pickupCube = true; host.add(ring);
  grp.add(host); registerPickupSpin(host); return grp;
}

function buildPkV8Rocket() {
  const grp = new THREE.Group();
  pickupPedestal(grp, 0xffe2c4, 0xff7a00, 1.45);
  const host = _v8Host();
  const matBody = new THREE.MeshStandardMaterial({ color: 0xff7a00, emissive: 0xff5510, emissiveIntensity: 0.35, metalness: 0.35, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.20, 1.0, 14), matBody);
  body.userData.__pickupCube = true; host.add(body);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.20, 0.40, 14), new THREE.MeshStandardMaterial({ color: 0xffe6c4 }));
  tip.position.y = 0.70; tip.userData.__pickupCube = true; host.add(tip);
  for (let i = 0; i < 3; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.32, 0.32), matBody);
    fin.position.y = -0.45;
    fin.rotation.y = (i * Math.PI * 2) / 3;
    fin.position.x = Math.cos(fin.rotation.y) * 0.20;
    fin.position.z = Math.sin(fin.rotation.y) * 0.20;
    fin.userData.__pickupCube = true; host.add(fin);
  }
  grp.add(host); registerPickupSpin(host); return grp;
}

function buildPkV8Mortar() {
  const grp = new THREE.Group();
  pickupPedestal(grp, 0xc4c8d0, 0x4a4a55, 1.45);
  const host = _v8Host();
  const matBody = new THREE.MeshStandardMaterial({ color: 0x3a3d44, metalness: 0.55, roughness: 0.45 });
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.40, 0.85, 14), matBody);
  shell.userData.__pickupCube = true; host.add(shell);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), matBody);
  cap.position.y = 0.42; cap.userData.__pickupCube = true; host.add(cap);
  const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.045, 6, 18), new THREE.MeshStandardMaterial({ color: 0xffcc44, emissive: 0xffaa22, emissiveIntensity: 0.4 }));
  stripe.rotation.x = Math.PI / 2; stripe.userData.__pickupCube = true; host.add(stripe);
  grp.add(host); registerPickupSpin(host); return grp;
}

function buildPkV8Mine() {
  const grp = new THREE.Group();
  pickupPedestal(grp, 0xd0a0a4, 0x55202a, 1.45);
  const host = _v8Host(ROAD_THICK + 0.55);
  const matBody = new THREE.MeshStandardMaterial({ color: 0x55202a, metalness: 0.5, roughness: 0.55 });
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), matBody);
  core.userData.__pickupCube = true; host.add(core);
  // 6 spikes evenly distributed.
  const spikeMat = new THREE.MeshStandardMaterial({ color: 0xb04020, metalness: 0.6, roughness: 0.4 });
  for (let i = 0; i < 6; i++) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.30, 8), spikeMat);
    const a = (i / 6) * Math.PI * 2;
    spike.position.set(Math.cos(a) * 0.45, 0, Math.sin(a) * 0.45);
    spike.rotation.z = -Math.PI / 2;
    spike.rotation.y = -a;
    spike.userData.__pickupCube = true; host.add(spike);
  }
  grp.add(host); registerPickupSpin(host); return grp;
}

function buildPkV8Dynamite() {
  const grp = new THREE.Group();
  pickupPedestal(grp, 0xf0c4b4, 0xb04020, 1.45);
  const host = _v8Host();
  const stickMat = new THREE.MeshStandardMaterial({ color: 0xb04020, roughness: 0.65 });
  for (let i = -1; i <= 1; i++) {
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.85, 10), stickMat);
    stick.position.x = i * 0.20;
    stick.userData.__pickupCube = true; host.add(stick);
  }
  const tape = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.05, 6, 18), new THREE.MeshStandardMaterial({ color: 0x202020 }));
  tape.rotation.y = Math.PI / 2; tape.scale.set(1, 1, 0.4);
  tape.userData.__pickupCube = true; host.add(tape);
  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.32, 6), new THREE.MeshStandardMaterial({ color: 0xc8a060 }));
  fuse.position.set(0, 0.55, 0); fuse.userData.__pickupCube = true; host.add(fuse);
  grp.add(host); registerPickupSpin(host); return grp;
}

function buildPkV8Firethrower() {
  const grp = new THREE.Group();
  pickupPedestal(grp, 0xffd6b4, 0xff4400, 1.45);
  const host = _v8Host();
  const matBody = new THREE.MeshStandardMaterial({ color: 0x404040, metalness: 0.6, roughness: 0.45 });
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.72, 12), matBody);
  tank.userData.__pickupCube = true; host.add(tank);
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.50, 10), matBody);
  nozzle.rotation.z = Math.PI / 2; nozzle.position.x = 0.45; nozzle.userData.__pickupCube = true; host.add(nozzle);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.45, 10), new THREE.MeshStandardMaterial({ color: 0xff6600, emissive: 0xff3300, emissiveIntensity: 1.6, transparent: true, opacity: 0.85 }));
  flame.rotation.z = -Math.PI / 2; flame.position.x = 0.85; flame.userData.__pickupCube = true; host.add(flame);
  grp.add(host); registerPickupSpin(host); return grp;
}

function buildPkV8Shield() {
  const grp = new THREE.Group();
  pickupPedestal(grp, 0xc4e0ff, 0x66ccff, 1.45);
  const host = _v8Host();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.10, 8, 28), new THREE.MeshStandardMaterial({ color: 0x66ccff, emissive: 0x2288cc, emissiveIntensity: 0.7, metalness: 0.4, roughness: 0.3 }));
  ring.userData.__pickupCube = true; host.add(ring);
  const inner = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), new THREE.MeshStandardMaterial({ color: 0x88ddff, transparent: true, opacity: 0.30, emissive: 0x66ccff, emissiveIntensity: 0.5 }));
  inner.userData.__pickupCube = true; host.add(inner);
  grp.add(host); registerPickupSpin(host); return grp;
}

function buildPkV8Repair() {
  const grp = new THREE.Group();
  pickupPedestal(grp, 0xc4ffd2, 0x66ff99, 1.45);
  const host = _v8Host();
  const crossMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x66ff99, emissiveIntensity: 0.5 });
  const horiz = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.22, 0.22), crossMat);
  horiz.userData.__pickupCube = true; host.add(horiz);
  const vert = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.85, 0.22), crossMat);
  vert.userData.__pickupCube = true; host.add(vert);
  grp.add(host); registerPickupSpin(host); return grp;
}

function buildPkV8DoubleDmg() {
  const grp = new THREE.Group();
  pickupPedestal(grp, 0xffcce8, 0xff66cc, 1.45);
  const host = _v8Host();
  const matBody = new THREE.MeshStandardMaterial({ color: 0xff66cc, emissive: 0xcc3399, emissiveIntensity: 0.5, metalness: 0.3, roughness: 0.4 });
  // Two stacked diamond-ish boxes to suggest "x2".
  for (let i = 0; i < 2; i++) {
    const dmd = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), matBody);
    dmd.position.x = (i - 0.5) * 0.55;
    dmd.userData.__pickupCube = true; host.add(dmd);
  }
  grp.add(host); registerPickupSpin(host); return grp;
}

// Jump panel — STK launch-ramp banner painted onto a magenta plate, with
// brushed-metal spring coils at each corner. The banner already encodes the
// "ramp + arrow" iconography baked at studio-quality resolution.
function buildJumpPanel() {
  const grp = new THREE.Group();
  const W = TILE * 0.92, L = TILE * 0.55;
  // STK jumpRamp banner — pre-rotated so its arrow points along +Z (drive
  // direction). Per-instance clone keeps the rotation/repeat independent.
  const rampTex = cloneTex(STK_TEX.jumpRamp, { rotation: Math.PI / 2 });
  const baseMat = new THREE.MeshStandardMaterial({
    map: rampTex, color: 0xffffff,
    emissiveMap: rampTex, emissive: 0xff45c8, emissiveIntensity: 0.65,
    roughness: 0.28, metalness: 0.22,
  });
  const plate = new THREE.Mesh(new THREE.BoxGeometry(W, 0.10, L), baseMat);
  plate.position.set(0, ROAD_THICK + 0.06, 0);
  plate.receiveShadow = true; grp.add(plate);
  // Edge under-glow — magenta plane below the plate, additive, sells the
  // "hover-launch pad" silhouette from low angles.
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 1.05, L * 1.20),
    new THREE.MeshBasicMaterial({
      color: 0xff45c8, transparent: true, opacity: 0.40,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.set(0, ROAD_THICK + 0.03, 0); halo.renderOrder = 2;
  grp.add(halo);
  // Four spring coils at the corners — STK grey-metal sheen.
  const coilMat = new THREE.MeshStandardMaterial({
    map: STK_TEX.metalGrey, color: 0xeaeaea, roughness: 0.30, metalness: 0.88,
  });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.04, 6, 14), coilMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(sx * (W / 2 - 0.30), ROAD_THICK + 0.18 + i * 0.12, sz * (L / 2 - 0.30));
      grp.add(ring);
    }
  }
  return grp;
}

// Ice patch — frosted blue puddle with animated water normals + frost rim.
// Uses the Water Park ice album tinted icy white-blue. The shimmer comes
// from a subtle UV scroll registered with the ground-fx ticker so even
// when the kart isn't on it the surface visibly "lives".
function buildIcePatch() {
  const grp = new THREE.Group();
  // STK ice surface: real ice albedo + matching normal & gloss maps.
  // Cloned per-instance so each patch's UV scroll is independent.
  const iAlb = cloneTex(STK_TEX.iceA,   { repeat: [2, 2] });
  const iNrm = cloneTex(STK_TEX.iceA_n, { repeat: [2, 2] });
  const iGls = cloneTex(STK_TEX.iceA_g, { repeat: [2, 2] });
  const baseMat = new THREE.MeshStandardMaterial({
    map: iAlb, normalMap: iNrm, roughnessMap: iGls,
    color: 0xc8e8ff, emissive: 0x6aa8ff, emissiveIntensity: 0.32,
    roughness: 0.10, metalness: 0.40,
    transparent: true, opacity: 0.94,
  });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(TILE * 0.44, 32), baseMat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = ROAD_THICK + 0.04;
  disc.receiveShadow = true;
  grp.add(disc);
  registerSurfaceScroll(disc, { u: 0.04, v: 0.02 });

  // Crackling shimmer — second ice layer with frozen-waterfall scrolling
  // pattern, additive over the base disc.
  const shimmerTex = cloneTex(STK_TEX.frozenFall, { repeat: [2, 2] });
  const shimmer = new THREE.Mesh(
    new THREE.CircleGeometry(TILE * 0.435, 32),
    new THREE.MeshBasicMaterial({
      map: shimmerTex, color: 0xeaf8ff,
      transparent: true, opacity: 0.40, blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  shimmer.rotation.x = -Math.PI / 2;
  shimmer.position.y = ROAD_THICK + 0.052; shimmer.renderOrder = 3;
  grp.add(shimmer);
  registerSurfaceScroll(shimmer, { u: -0.05, v: 0.03 });

  // Frost rim — STK iceEdges decal wrapped around the perimeter as a ring.
  const rimMat = new THREE.MeshStandardMaterial({
    map: STK_TEX.iceEdges, color: 0xeefaff,
    emissive: 0xb6e6ff, emissiveIntensity: 0.85,
    roughness: 0.10, metalness: 0.0,
    transparent: true, opacity: 0.92, side: THREE.DoubleSide,
    alphaTest: 0.05,
  });
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(TILE * 0.36, TILE * 0.46, 48), rimMat,
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = ROAD_THICK + 0.06;
  grp.add(ring);

  // Subtle "snowflake" decals around the perimeter for readability
  const flakeMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.55,
  });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const r = TILE * 0.34;
    const flake = new THREE.Mesh(new THREE.CircleGeometry(0.10, 6), flakeMat);
    flake.rotation.x = -Math.PI / 2;
    flake.position.set(Math.cos(a) * r, ROAD_THICK + 0.07, Math.sin(a) * r);
    grp.add(flake);
  }
  return grp;
}

// Shared factory for "boiling pool" hazards — bright emissive disc with
// flowing normal map, raised crust ring, intermittently popping bubbles
// (rising emissive spheres) and upward "spitting" flame flares. Used by
// both lava (orange) and oil slick (black) so the two read as
// thematically related but visually distinct hazards.
//
// Every animated component owns CLONED textures + its own per-instance
// tick callbacks so multiple pools can coexist on a track without their
// UV scrolls or bubble cycles interfering with each other.
function _buildBoilingPool(opts) {
  const grp = new THREE.Group();
  const RT = ROAD_THICK;
  const R = TILE * 0.44;

  // 1. Boiling surface disc with flowing normal map.
  // STK texture overrides win when supplied; fall back to MOD_TEX water normals.
  const surfNrm = opts.surface.normalMap
    ? cloneTex(opts.surface.normalMap, { repeat: opts.surface.normalRepeat || [2, 2] })
    : cloneTex(MOD_TEX.waterNrm, { repeat: [2, 2] });
  const surfAlb = opts.surface.map
    ? cloneTex(opts.surface.map, { repeat: opts.surface.mapRepeat || [2, 2] })
    : null;
  const surfRgh = opts.surface.roughnessMap
    ? cloneTex(opts.surface.roughnessMap, { repeat: opts.surface.normalRepeat || [2, 2] })
    : null;
  const surfMat = new THREE.MeshStandardMaterial({
    color: opts.surface.color,
    emissive: opts.surface.emissive,
    emissiveIntensity: opts.surface.emissiveIntensity,
    map: surfAlb,
    emissiveMap: opts.surface.emissiveFromAlbedo ? surfAlb : null,
    normalMap: surfNrm,
    roughnessMap: surfRgh,
    roughness: opts.surface.roughness,
    metalness: opts.surface.metalness,
  });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 36), surfMat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = RT + 0.04;
  grp.add(disc);
  registerSurfaceScroll(disc, opts.scroll);

  // 2. Cooled crust ring around the perimeter.
  const crustMat = new THREE.MeshStandardMaterial({
    color: opts.crust.color,
    emissive: opts.crust.emissive,
    emissiveIntensity: opts.crust.emissiveIntensity,
    roughness: opts.crust.roughness,
    metalness: opts.crust.metalness,
    side: THREE.DoubleSide,
  });
  const crust = new THREE.Mesh(
    new THREE.RingGeometry(R, R * 1.14, 36), crustMat,
  );
  crust.rotation.x = -Math.PI / 2;
  crust.position.y = RT + 0.05;
  grp.add(crust);

  // 3. Bubbles — small emissive spheres that rise from the surface,
  // grow slightly, then pop and re-spawn at a random spot. Phase per
  // bubble keeps them out of sync.
  const bubbleMat = new THREE.MeshStandardMaterial({
    color: opts.bubble.color,
    emissive: opts.bubble.emissive,
    emissiveIntensity: opts.bubble.emissiveIntensity,
    roughness: 0.35, metalness: 0.0,
  });
  const bubbles = [];
  for (let i = 0; i < opts.bubbleCount; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), bubbleMat);
    const a = (i / opts.bubbleCount) * Math.PI * 2;
    const r = R * (0.30 + Math.random() * 0.55);
    b.userData = {
      home: [Math.cos(a) * r, Math.sin(a) * r],
      phase: Math.random() * Math.PI * 2,
      period: 1.2 + Math.random() * 1.4,
    };
    b.position.set(b.userData.home[0], RT + 0.06, b.userData.home[1]);
    grp.add(b);
    bubbles.push(b);
  }
  registerSurfaceTick({
    host: grp,
    fn: (dt, t) => {
      for (const b of bubbles) {
        const u = ((t + b.userData.phase) % b.userData.period) / b.userData.period;
        // Rise + scale up + fade out + recycle position
        const y = RT + 0.06 + u * 0.55;
        const s = 0.6 + u * 0.9;
        b.position.y = y;
        b.scale.setScalar(s);
        if (u > 0.95) {
          // Pop: pick a fresh spot inside the disc
          const a = Math.random() * Math.PI * 2;
          const r = R * (0.20 + Math.random() * 0.65);
          b.userData.home[0] = Math.cos(a) * r;
          b.userData.home[1] = Math.sin(a) * r;
        }
        b.position.x = b.userData.home[0];
        b.position.z = b.userData.home[1];
      }
    },
  });

  // 4. Spitting flares — upward-pointing cones with pulsing emissive,
  // suggesting periodic eruptions. Each flare has its own pulse phase.
  const flareMat = new THREE.MeshStandardMaterial({
    color: opts.flare.color,
    emissive: opts.flare.emissive,
    emissiveIntensity: opts.flare.emissiveIntensity,
    roughness: 0.30, metalness: 0.0,
    transparent: true, opacity: 0.85, depthWrite: false,
  });
  const flares = [];
  for (let i = 0; i < opts.flareCount; i++) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.55, 10), flareMat.clone());
    const a = (i / opts.flareCount) * Math.PI * 2 + 0.5;
    const r = R * 0.25;
    f.position.set(Math.cos(a) * r, RT + 0.30, Math.sin(a) * r);
    f.userData = { phase: Math.random() * Math.PI * 2, period: 1.6 + Math.random() * 0.8 };
    grp.add(f);
    flares.push(f);
  }
  registerSurfaceTick({
    host: grp,
    fn: (dt, t) => {
      for (const f of flares) {
        const u = ((t + f.userData.phase) % f.userData.period) / f.userData.period;
        // Sharp ramp up, slower fall — looks like a brief eruption.
        const k = u < 0.25 ? (u / 0.25) : Math.max(0, 1 - (u - 0.25) / 0.75);
        f.scale.set(1 + k * 0.4, 0.4 + k * 1.6, 1 + k * 0.4);
        f.material.opacity = 0.20 + k * 0.70;
        f.material.emissiveIntensity = opts.flare.emissiveIntensity * (0.4 + k * 1.4);
      }
    },
  });

  // 5. Smoke wisps — three faint upward quads that suggest heat shimmer
  // (or oil vapour). Static; they only need to soften the silhouette.
  const smokeMat = new THREE.MeshBasicMaterial({
    color: opts.smoke.color, transparent: true, opacity: opts.smoke.opacity,
    depthWrite: false,
  });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const r = TILE * 0.20;
    const puff = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.4), smokeMat);
    puff.position.set(Math.cos(a) * r, RT + 0.85, Math.sin(a) * r);
    puff.rotation.y = -a;
    grp.add(puff);
  }
  return grp;
}

// Lava pool — Mario Kart 64-style boiling magma. Now driven by the actual
// SuperTuxKart `stktex_generic_lavaA` PBR set (albedo + normal + gloss) so
// the surface reads as authentic flowing magma rather than a flat orange
// disc. Bubbles + flares retain their per-instance phase animation.
function buildLavaPool() {
  return _buildBoilingPool({
    surface:    { color: 0xff7833, emissive: 0xff7a18, emissiveIntensity: 2.4,
                  roughness: 0.55, metalness: 0.0,
                  map: STK_TEX.lavaA, mapRepeat: [2, 2],
                  emissiveFromAlbedo: true,
                  normalMap: STK_TEX.lavaA_n, normalRepeat: [2, 2],
                  roughnessMap: STK_TEX.lavaA_g },
    crust:      { color: 0x231410, emissive: 0x441100, emissiveIntensity: 0.55,
                  roughness: 0.85, metalness: 0.0 },
    bubble:     { color: 0xffaa22, emissive: 0xff5500, emissiveIntensity: 4.0 },
    flare:      { color: 0xffcc55, emissive: 0xff5500, emissiveIntensity: 4.5 },
    smoke:      { color: 0x886655, opacity: 0.30 },
    bubbleCount: 5,
    flareCount:  3,
    scroll: { u: 0.04, v: -0.03 },
  });
}

// Water pool — flat blue water surface with animated normal scroll, splash
// rim and small water-warning quads at the corners. Uses GWP_CompD_Water_*
// from the Water Park asset bank. Textures are CLONED so this pool's UV
// drift doesn't mutate the shared MOD_TEX entries (which would crawl
// through every other consumer — pickups, track surfaces, etc).
function buildWaterPool() {
  const grp = new THREE.Group();
  // Primary surface — STK oceanicWater colour bed (cinematic deep-blue
  // with embedded foam) modulated by waternormals.jpg for ripple flow.
  // Per-instance clones so this pool's UV drift is independent.
  const wAlb = cloneTex(STK_TEX.waterOcean, { repeat: [2, 2] });
  const wNrm = cloneTex(STK_TEX.waterNrm,   { repeat: [3, 3] });
  const waterMat = new THREE.MeshStandardMaterial({
    map: wAlb, normalMap: wNrm,
    color: 0x6fb8ff, emissive: 0x0e3a66, emissiveIntensity: 0.40,
    roughness: 0.18, metalness: 0.45,
    transparent: true, opacity: 0.92,
  });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(TILE * 0.46, 36), waterMat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = ROAD_THICK + 0.04;
  disc.receiveShadow = true;
  grp.add(disc);
  registerSurfaceScroll(disc, { u: 0.05, v: 0.03 });

  // Caustics layer — STK caustics.png hovering just above, additive,
  // scrolling counter to the base for a real "underwater light" play.
  const causticsTex = cloneTex(STK_TEX.caustics, { repeat: [3, 3] });
  const caustics = new THREE.Mesh(
    new THREE.CircleGeometry(TILE * 0.455, 36),
    new THREE.MeshBasicMaterial({
      map: causticsTex, color: 0xc0eaff,
      transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  caustics.rotation.x = -Math.PI / 2;
  caustics.position.y = ROAD_THICK + 0.052;
  caustics.renderOrder = 3;
  grp.add(caustics);
  registerSurfaceScroll(caustics, { u: -0.04, v: 0.05 });

  // Splash rim — pale-cyan emissive ring
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xc4eaff, emissive: 0x88c8ff, emissiveIntensity: 0.85,
    roughness: 0.12, metalness: 0.0, transparent: true, opacity: 0.80,
    side: THREE.DoubleSide,
  });
  const rim = new THREE.Mesh(
    new THREE.RingGeometry(TILE * 0.44, TILE * 0.50, 32), rimMat,
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = ROAD_THICK + 0.06;
  grp.add(rim);

  // Two thin "spray" quads angled upward to suggest splashes
  const sprayMat = new THREE.MeshBasicMaterial({
    color: 0xddf2ff, transparent: true, opacity: 0.45, depthWrite: false,
  });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const r = TILE * 0.30;
    const spray = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.45), sprayMat);
    spray.position.set(Math.cos(a) * r, ROAD_THICK + 0.30, Math.sin(a) * r);
    spray.rotation.y = -a;
    grp.add(spray);
  }
  return grp;
}

// Sand pit — STK desert-grade sand albedo, with a sand-to-grass blend rim
// (`sandgrass.png`) for the natural soft transition you see at real beach
// edges. Footprint scatter dots on top break up the surface read.
function buildSandPit() {
  const grp = new THREE.Group();
  const sandMat = new THREE.MeshStandardMaterial({
    map: STK_TEX.sandA, color: 0xeacb88,
    roughness: 0.96, metalness: 0.0,
  });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(TILE * 0.46, 32), sandMat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = ROAD_THICK + 0.03;
  disc.receiveShadow = true;
  grp.add(disc);

  // Wet/coarser inner band — sandB at slight rotation to break tile uniformity.
  const wetTex = cloneTex(STK_TEX.sandB, { repeat: [2, 2], rotation: Math.PI / 6 });
  const wetMat = new THREE.MeshStandardMaterial({
    map: wetTex, color: 0xc8a76a, roughness: 0.92, metalness: 0.0,
    transparent: true, opacity: 0.75, depthWrite: false,
  });
  const wet = new THREE.Mesh(new THREE.CircleGeometry(TILE * 0.32, 28), wetMat);
  wet.rotation.x = -Math.PI / 2;
  wet.position.y = ROAD_THICK + 0.038;
  grp.add(wet);

  // STK sand-grass blend rim — natural soft edge instead of a hard ring.
  const rimMat = new THREE.MeshStandardMaterial({
    map: STK_TEX.sandGrass, color: 0xb89968,
    roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide,
    transparent: true, alphaTest: 0.05,
  });
  const rim = new THREE.Mesh(
    new THREE.RingGeometry(TILE * 0.42, TILE * 0.52, 36), rimMat,
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = ROAD_THICK + 0.045;
  grp.add(rim);

  // Scattered "ripples" — tiny darker arcs to break up the surface
  const dotMat = new THREE.MeshBasicMaterial({
    color: 0x735a30, transparent: true, opacity: 0.45,
  });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.35;
    const r = (i % 2 === 0) ? TILE * 0.18 : TILE * 0.30;
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.10 + (i % 3) * 0.04, 8), dotMat);
    dot.rotation.x = -Math.PI / 2;
    dot.position.set(Math.cos(a) * r, ROAD_THICK + 0.05, Math.sin(a) * r);
    grp.add(dot);
  }
  return grp;
}

// ── Registry ──────────────────────────────────────────────────────
// ─── 1×1 Runway tarmac builders ──────────────────────────────────────────────
// Flat tarmac sized to a single grid tile (span {x:1, z:1}), centred at the
// cell origin so it tiles cleanly next to road segments. Lay several end to
// end to compose a longer landing strip; markings are scaled to fit one cell.
const RUNWAY_MAT = new THREE.MeshStandardMaterial({
  color: 0x282828, roughness: 0.92, metalness: 0.02, side: THREE.DoubleSide,
});

function _rwyBase() {
  const T = TILE, RT = ROAD_THICK;
  const W = T, cx = 0, cz = 0;
  const edgeS = cz - W / 2, edgeN = cz + W / 2;
  const edgeW = cx - W / 2, edgeE = cx + W / 2;
  const grp = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.BoxGeometry(W, RT, W), RUNWAY_MAT);
  deck.position.set(cx, RT / 2, cz);
  deck.receiveShadow = true;
  grp.add(deck);
  return { grp, T, RT, W, cx, cz, edgeS, edgeN, edgeW, edgeE };
}

function _rwyCenterlineZ(grp, cx, RT, edgeS, edgeN) {
  // One long centred dash so the marking reads cleanly at one-tile scale.
  const dashLen = TILE * 0.72;
  const geo = new THREE.BoxGeometry(0.45, 0.04, dashLen);
  const d = new THREE.Mesh(geo, MATS.paintWhite);
  d.position.set(cx, RT + 0.025, (edgeS + edgeN) * 0.5);
  grp.add(d);
}

function _rwyCenterlineX(grp, cz, RT, edgeW, edgeE) {
  const dashLen = TILE * 0.72;
  const geo = new THREE.BoxGeometry(dashLen, 0.04, 0.45);
  const d = new THREE.Mesh(geo, MATS.paintWhite);
  d.position.set((edgeW + edgeE) * 0.5, RT + 0.025, cz);
  grp.add(d);
}

function _rwyThresholdBars(grp, cx, RT, edgeS, edgeN, side) {
  // Piano-key threshold scaled to one tile: 4 bars across.
  const nBars = 4, barW = 0.55, gap = 0.50, barL = TILE * 0.20;
  const totalX = nBars * barW + (nBars - 1) * gap;
  const startX = cx - totalX * 0.5 + barW * 0.5;
  const barCenterZ = side === 'south' ? edgeS + barL * 0.5 : edgeN - barL * 0.5;
  const geo = new THREE.BoxGeometry(barW, 0.04, barL);
  for (let i = 0; i < nBars; i++) {
    const b = new THREE.Mesh(geo, MATS.paintWhite);
    b.position.set(startX + i * (barW + gap), RT + 0.025, barCenterZ);
    grp.add(b);
  }
}

function _rwyTdZone(grp, cx, RT, edgeS, edgeN) {
  // Pair of small touchdown-zone stripes flanking the centerline.
  const markW = 0.55, markL = TILE * 0.18, offX = TILE * 0.18;
  const geo = new THREE.BoxGeometry(markW, 0.04, markL);
  for (const [edge, sign] of [[edgeS, +1], [edgeN, -1]]) {
    const mz = edge + sign * (TILE * 0.30);
    for (const sx of [-1, +1]) {
      const m = new THREE.Mesh(geo, MATS.paintWhite);
      m.position.set(cx + sx * offX, RT + 0.025, mz);
      grp.add(m);
    }
  }
}

function _rwyAimingPoint(grp, cx, RT, edgeS, edgeN) {
  // Short aim-point bars near each edge.
  const aimW = 0.32, aimL = TILE * 0.22, offX = TILE * 0.22, dist = TILE * 0.42;
  const geo = new THREE.BoxGeometry(aimW, 0.04, aimL);
  for (const [edge, sign] of [[edgeS, +1], [edgeN, -1]]) {
    const mz = edge + sign * dist;
    for (const sx of [-1, +1]) {
      const m = new THREE.Mesh(geo, MATS.paintWhite);
      m.position.set(cx + sx * offX, RT + 0.025, mz);
      grp.add(m);
    }
  }
}

function buildRunwayBlank()     { return _rwyBase().grp; }

function buildRunwayCenter() {
  const { grp, RT, cx, edgeS, edgeN } = _rwyBase();
  _rwyCenterlineZ(grp, cx, RT, edgeS, edgeN);
  return grp;
}

function buildRunwayThreshold() {
  const { grp, RT, cx, edgeS, edgeN } = _rwyBase();
  _rwyCenterlineZ(grp, cx, RT, edgeS, edgeN);
  _rwyThresholdBars(grp, cx, RT, edgeS, edgeN, 'south');
  _rwyThresholdBars(grp, cx, RT, edgeS, edgeN, 'north');
  return grp;
}

function buildRunwayTouchdown() {
  const { grp, RT, cx, edgeS, edgeN } = _rwyBase();
  _rwyCenterlineZ(grp, cx, RT, edgeS, edgeN);
  _rwyTdZone(grp, cx, RT, edgeS, edgeN);
  return grp;
}

function buildRunwayFull() {
  const { grp, RT, cx, edgeS, edgeN } = _rwyBase();
  _rwyCenterlineZ(grp, cx, RT, edgeS, edgeN);
  _rwyThresholdBars(grp, cx, RT, edgeS, edgeN, 'south');
  _rwyThresholdBars(grp, cx, RT, edgeS, edgeN, 'north');
  _rwyTdZone(grp, cx, RT, edgeS, edgeN);
  _rwyAimingPoint(grp, cx, RT, edgeS, edgeN);
  return grp;
}

function buildRunwayCross() {
  const { grp, RT, cx, cz, edgeS, edgeN, edgeW, edgeE } = _rwyBase();
  _rwyCenterlineZ(grp, cx, RT, edgeS, edgeN);
  _rwyCenterlineX(grp, cz, RT, edgeW, edgeE);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(TILE * 0.12, TILE * 0.14, 48),
    MATS.paintWhite,
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(cx, RT + 0.025, cz);
  grp.add(ring);
  return grp;
}

export const VISUAL_BUILDERS = {
  straight:        () => buildStraight(TILE),
  corner:          () => buildCorner(false),
  cornerR:         () => buildCorner(true),
  banked_turn:     () => buildBanked(false),
  bump_up:         () => buildBump(),
  hill_complete:   () => { const g = buildHill(2); g.position.z = TILE / 2; return g; },
  jump_ramp:       () => buildJumpRamp(),
  ramp_up:         () => { const g = buildRamp(0, TILE * 0.6, 2); g.position.z = TILE / 2; return g; },
  ramp_down:       () => { const g = buildRamp(TILE * 0.6, 0, 2); g.position.z = TILE / 2; return g; },
  plateau:         () => {
    const g = new THREE.Group();
    const deckH = TILE * 0.6;
    // Elevated deck
    const path = linePath([0, deckH, -TILE / 2], [0, deckH, TILE / 2]);
    g.add(extrudeRoad(path, { steps: 12 }));
    g.add(dashedPaintAlongPath(path));
    // Curbs along both edges of the elevated deck
    g.add(curbsBothSides(path));
    // Side guardrails
    for (const side of [-1, +1]) {
      const x = side * (ROAD_WIDTH / 2 - 0.05);
      const yRail = deckH + ROAD_THICK + WALL_HEIGHT * 0.55;
      const rPath = pathFromPoints([
        [x, yRail, -TILE / 2],
        [x, yRail, +TILE / 2],
      ]);
      const tube = new THREE.TubeGeometry(rPath, 8, 0.08, 6, false);
      g.add(new THREE.Mesh(tube, MATS.guardrail));
      for (let i = 0; i < 4; i++) {
        const t = (i + 0.5) / 4;
        const p = rPath.getPointAt(t);
        const post = new THREE.Mesh(
          new THREE.BoxGeometry(0.12, WALL_HEIGHT, 0.12),
          MATS.guardrail,
        );
        post.position.set(p.x, p.y - WALL_HEIGHT * 0.4, p.z);
        g.add(post);
      }
    }
    // Four slim columnar piers — narrow concrete columns at the corners
    // under the deck so a road placed UNDER the plateau on tier 0 has
    // clearance to pass through. No cross-beams (they would block the
    // underdeck lane).
    for (const sx of [-1, +1]) for (const sz of [-1, +1]) {
      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.22, deckH, 12),
        MATS.concrete,
      );
      col.position.set(
        sx * (ROAD_WIDTH / 2 - 0.25),
        deckH / 2,
        sz * (TILE / 2 - 0.25),
      );
      col.castShadow = true; col.receiveShadow = true;
      g.add(col);
    }
    return g;
  },
  curved_plateau:  () => buildCurvedPlateau(false),
  curved_plateauR: () => buildCurvedPlateau(true),
  bridge:          () => { const g = buildBridge(); g.position.z = TILE / 2; return g; },
  bridge_onramp:   () => { const g = buildBridgeRamp('up'); g.position.z = TILE / 2; return g; },
  bridge_offramp:  () => { const g = buildBridgeRamp('down'); g.position.z = TILE / 2; return g; },
  tunnel:          () => { const g = buildTunnel(); g.position.z = TILE / 2; return g; },
  t_junction:      () => buildTJunction(),
  crossroads:      () => buildCrossroads(),
  wide:            () => buildPlaza(),
  city_straight:   () => buildStraight(TILE, { noPaint: true }),
  city_corner:     () => buildCorner(false, { noPaint: true }),
  city_cornerR:    () => buildCorner(true,  { noPaint: true }),
  runway_blank:     () => buildRunwayBlank(),
  runway_center:    () => buildRunwayCenter(),
  runway_threshold: () => buildRunwayThreshold(),
  runway_touchdown: () => buildRunwayTouchdown(),
  runway_full:      () => buildRunwayFull(),
  runway_cross:     () => buildRunwayCross(),
  boost_pad:       () => buildBoostPad(),
  super_boost_pad: () => { const g = buildSuperBoostPad(); g.position.z = TILE / 2; return g; },
  oil_slick:       () => buildOilSlick(),
  slow_strip:      () => buildSlowStrip(),
  repair_strip:    () => buildRepairStrip(),
  item_box:        () => buildItemBox(),
  weapon_crate_heavy: () => buildHeavyCrate(),
  health_orb:      () => buildHealthOrb(),
  coin_pickup:     () => buildCoinPickup(),
  // Phase A — MK item pickups (asset-backed)
  pk_mushroom:        () => buildPkMushroom(),
  pk_golden_mushroom: () => buildPkGoldenMushroom(),
  pk_star:            () => buildPkStar(),
  pk_green_shell:     () => buildPkGreenShell(),
  pk_red_shell:       () => buildPkRedShell(),
  pk_blue_shell:      () => buildPkBlueShell(),
  pk_banana:          () => buildPkBanana(),
  pk_bullet_bill:     () => buildPkBulletBill(),
  pk_bobomb:          () => buildPkBobomb(),
  // Phase E — v8 weapon pickups (procedural low-poly)
  pk_v8_missile:      () => buildPkV8Missile(),
  pk_v8_cannon:       () => buildPkV8Cannon(),
  pk_v8_rocket:       () => buildPkV8Rocket(),
  pk_v8_mortar:       () => buildPkV8Mortar(),
  pk_v8_mine:         () => buildPkV8Mine(),
  pk_v8_dynamite:     () => buildPkV8Dynamite(),
  pk_v8_firethrower:  () => buildPkV8Firethrower(),
  pk_v8_shield:       () => buildPkV8Shield(),
  pk_v8_repair:       () => buildPkV8Repair(),
  pk_v8_double_dmg:   () => buildPkV8DoubleDmg(),
  // Phase A — extra modifiers + hazards
  jump_panel:         () => buildJumpPanel(),
  ice_patch:          () => buildIcePatch(),
  lava_pool:          () => buildLavaPool(),
  water_pool:         () => buildWaterPool(),
  sand_pit:           () => buildSandPit(),
  // Phase E — 3D Kart reference props/scenery (DAE)
  prop_traffic_cone:  () => buildReferenceDaeProp('mk8_pylon', { targetSize: 1.0, y: ROAD_THICK + 0.02 }),
  scenery_city_boat:  () => buildReferenceDaeProp('mk8_cityboat', { targetSize: 12.0, y: ROAD_THICK + 0.02 }),
  // Phase F — SuperTuxKart library props (.spm)
  // Vegetation
  stk_palm_tree:        () => buildStkProp('/stk assets/library/stklib_palmTree_a/stklib_palmTree_a_LOD_a.spm',   { targetSize: 5.0 }),
  stk_low_palm_tree:    () => buildStkProp('/stk assets/library/stklib_lowPalmTree_a/stklib_lowPalmTree_a_main.spm', { targetSize: 3.6 }),
  stk_pine_tree_a:      () => buildStkProp('/stk assets/library/stklib_pinetree_a/stklib_pinetree_a_lod_high.spm', { targetSize: 6.0 }),
  stk_pine_tree_b:      () => buildStkProp('/stk assets/library/stklib_pinetree_b/stklib_pinetree_b_high.spm',   { targetSize: 6.0 }),
  stk_pine_tree_c:      () => buildStkProp('/stk assets/library/stklib_pinetree_c/stklib_pintree_c_high.spm',    { targetSize: 5.5 }),
  stk_autumn_tree:      () => buildStkProp('/stk assets/library/stklib_autumnTree_a/stklib_autumnTree_a_main.spm', { targetSize: 5.5 }),
  stk_autumn_birch:     () => buildStkProp('/stk assets/library/stklib_autumnBirch_a/stklib_autumnBirch_a_high.spm', { targetSize: 6.0 }),
  stk_autumn_willow:    () => buildStkProp('/stk assets/library/stklib_autumnWillow_a/stklib_autumnWillow_a_high.spm', { targetSize: 5.6 }),
  stk_jungle_tree_a:    () => buildStkProp('/stk assets/library/stklib_jungleTree_a/stklib_jungleTree_a.spm',    { targetSize: 6.4 }),
  stk_jungle_tree_b:    () => buildStkProp('/stk assets/library/stklib_jungleTree_b/stklib_jungleTree_b_main.spm', { targetSize: 6.4 }),
  stk_cocoa_tree:       () => buildStkProp('/stk assets/library/stklib_cocoaTree_a/stklib_cocoaTree_a_main.spm', { targetSize: 4.6 }),
  stk_cypress:          () => buildStkProp('/stk assets/library/stklib_cypress_a/stklib_cypress_a_high.spm',     { targetSize: 5.5 }),
  stk_dead_tree:        () => buildStkProp('/stk assets/library/stklib_deadTree_a/stklib_deadTree_a_main.spm',   { targetSize: 5.0 }),
  stk_red_flower_bush:  () => buildStkProp('/stk assets/library/stklib_redFlowerBush_a/stklib_redFlowerBush_a_main.spm', { targetSize: 1.6 }),
  stk_tropical_plant:   () => buildStkProp('/stk assets/library/stklib_tropicalPlant_a/stklib_tropicalPlant_a_main_a.spm', { targetSize: 1.8 }),
  stk_fern:             () => buildStkProp('/stk assets/library/stklib_fern_a/stklib_fern_a_a.spm',              { targetSize: 1.4 }),
  stk_mushroom_a:       () => buildStkProp('/stk assets/library/stklib_mushroom_a/stklib_mushroom_a_main.spm',   { targetSize: 1.4 }),
  stk_mushroom_b:       () => buildStkProp('/stk assets/library/stklib_mushroom_b/stklib_mushroom_b_main.spm',   { targetSize: 1.6 }),
  // Structures
  stk_aztec_fountain:   () => buildStkProp('/stk assets/library/stklib_aztecFountain_a/stklib_aztecFountain_a_main.spm', { targetSize: 4.4 }),
  stk_aztec_house_a:    () => buildStkProp('/stk assets/library/stklib_aztecHouse_a/stklib_aztecHouse_a_main_high.spm', { targetSize: 6.0 }),
  stk_aztec_house_b:    () => buildStkProp('/stk assets/library/stklib_aztecHouse_b/stklib_aztecHouse_b_main.spm', { targetSize: 6.0 }),
  stk_aztec_hut:        () => buildStkProp('/stk assets/library/stklib_aztecHut_a/stklib_aztecHut_a_main.spm',   { targetSize: 5.0 }),
  stk_silvian_house_a:  () => buildStkProp('/stk assets/library/stklib_silvianHouse_a/stklib_silvianHouse_a_high.spm', { targetSize: 6.4 }),
  stk_silvian_house_b:  () => buildStkProp('/stk assets/library/stklib_silvianHouse_b/stklib_silvianHouse_b_main.spm', { targetSize: 6.4 }),
  stk_silvian_tower:    () => buildStkProp('/stk assets/library/stklib_silvianTower_a/stklib_silvianTower_a_main.spm', { targetSize: 7.5 }),
  stk_wood_bridge:      () => buildStkProp('/stk assets/library/stklib_woodLittleBridge_a/stklib_woodLittleBridge_a_main.spm', { targetSize: 4.8 }),
  stk_igloo:            () => buildStkProp('/stk assets/library/stklib_igloo_a/stklib_igloo_a_main.spm',         { targetSize: 4.0 }),
  // Props / decor
  stk_lamp_modern:      () => buildStkProp('/stk assets/library/hd_modernStreetLamp_a/hd_modernStreetLamp_a_main.spm', { targetSize: 3.6 }),
  stk_lamp_oldschool:   () => buildStkProp('/stk assets/library/stklib_oldschoolLamp_a/stklib_oldschoolLamp_a_main.spm', { targetSize: 3.4 }),
  stk_lamp_storm:       () => buildStkProp('/stk assets/library/stklib_stormLantern_a/stklib_stormLantern_a_main.spm', { targetSize: 1.6 }),
  stk_lamp_metal_post:  () => buildStkProp('/stk assets/library/stklib_metalPostLamp_a/stklib_metalPostLamp_a_main.spm', { targetSize: 3.4 }),
  stk_lamp_industrial:  () => buildStkProp('/stk assets/library/stklib_industrialLamp_a/stklib_industrialLamp_a_main.spm', { targetSize: 3.0 }),
  stk_lamp_wood_post:   () => buildStkProp('/stk assets/library/stklib_woodPostLamp_a/stklib_woodPostLamp_a_main.spm', { targetSize: 3.0 }),
  stk_lamp_bug:         () => buildStkProp('/stk assets/library/stklib_bugLamp_a/stklib_bugLamp_a_main.spm',     { targetSize: 1.4 }),
  stk_bench:            () => buildStkProp('/stk assets/library/stklib_bench_a/stklib_bench_a_main.spm',         { targetSize: 1.8 }),
  stk_hay_ball:         () => buildStkProp('/stk assets/library/stklib_hayBall_a/stklib_hayBall_a_main.spm',     { targetSize: 1.5 }),
  stk_tires_barrier:    () => buildStkProp('/stk assets/library/stklib_tiresBarrier_a/stklib_tiresBarrier_a_main.spm', { targetSize: 2.0 }),
  stk_log_barrier:      () => buildStkProp('/stk assets/library/stklib_logBarrier_a/stklib_logBarrier_a_main.spm', { targetSize: 2.4 }),
  stk_inflatable_fence: () => buildStkProp('/stk assets/library/stklib_inflatableFence_a/stklib_inflatableFence_a_main.spm', { targetSize: 3.2 }),
  stk_party_flags:      () => buildStkProp('/stk assets/library/stklib_partyFlags_a/stklib_partyFlags_a_main.spm', { targetSize: 4.0 }),
  stk_prayer_flags:     () => buildStkProp('/stk assets/library/stklib_prayerFlags_a/stklib_prayerFlags_a_main.spm', { targetSize: 3.6 }),
  cap_end:         () => buildCapEnd(),
  finish:          () => buildFinish(),
  spawn:           () => buildSpawn(),
};

// ────────────────────────────────────────────────────────────────
// Walled-variant visuals
//
// Polished tall barrier walls overlay the polished base segment from
// VISUAL_BUILDERS. Collision blocks are still defined in segments.js
// (`buildWalls`) — these meshes are visuals only, but their positions
// stay in lock-step with the collider geometry.
// ────────────────────────────────────────────────────────────────

// Wall profile constants (mirror segments.js — keep in sync).
const W2_FOOT_H = 0.8;
const W2_FOOT_T = 0.7;
const W2_TOP_H  = 2.4;
const W2_TOP_T  = 0.45;
const W2_INSET  = W2_FOOT_T / 2;
const W2_CAP_H  = 0.18;

MATS.wallConcrete = new THREE.MeshStandardMaterial({
  color: 0x9aa0a8, map: TEX.concrete, roughness: 0.85, metalness: 0.04,
});
MATS.wallCap = new THREE.MeshStandardMaterial({
  color: 0x40464e, roughness: 0.7, metalness: 0.18,
});
MATS.wallReflector = new THREE.MeshStandardMaterial({
  color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 0.85,
  roughness: 0.45, metalness: 0.1,
});

/** Build a polished segmented-concrete wall section.
 *  - `length` runs along Z (axis='z') or X (axis='x').
 *  - `baseY` is the world Y the foot BOTTOM rests on (deck top).
 *  - foot block, top block, dark cap rail, vertical joint grooves
 *    every ~3 m, and bright reflector studs along the top. */
function wallStraightVisual(length, axis, baseY) {
  const grp = new THREE.Group();
  const horiz = (depth, l) => axis === 'z' ? [depth, l] : [l, depth];

  // Foot
  {
    const [sx, sz] = horiz(W2_FOOT_T, length);
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(sx, W2_FOOT_H, sz), MATS.wallConcrete,
    );
    m.position.y = baseY + W2_FOOT_H / 2;
    m.castShadow = true; m.receiveShadow = true;
    grp.add(m);
  }
  // Top wall
  {
    const [sx, sz] = horiz(W2_TOP_T, length);
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(sx, W2_TOP_H, sz), MATS.wallConcrete,
    );
    m.position.y = baseY + W2_FOOT_H + W2_TOP_H / 2;
    m.castShadow = true; m.receiveShadow = true;
    grp.add(m);
  }
  // Cap rail (slightly wider, darker)
  {
    const [sx, sz] = horiz(W2_TOP_T * 1.45, length);
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(sx, W2_CAP_H, sz), MATS.wallCap,
    );
    m.position.y = baseY + W2_FOOT_H + W2_TOP_H + W2_CAP_H / 2;
    m.castShadow = true; m.receiveShadow = true;
    grp.add(m);
  }
  // Vertical joint grooves — dark slim slabs every ~3 m mark precast
  // segment seams. Skip endpoints so adjacent tiles read continuously.
  const segCount = Math.max(2, Math.round(length / 3));
  const totalH = W2_FOOT_H + W2_TOP_H;
  for (let i = 1; i < segCount; i++) {
    const along = -length / 2 + (i * length) / segCount;
    const [sx, sz] = horiz(W2_TOP_T * 1.06, 0.07);
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(sx, totalH, sz), MATS.wallCap,
    );
    if (axis === 'z') m.position.set(0, baseY + totalH / 2, along);
    else              m.position.set(along, baseY + totalH / 2, 0);
    grp.add(m);
  }
  // Yellow reflector studs along the cap, between joints.
  const refCount = Math.max(2, Math.round(length / 3));
  for (let i = 0; i < refCount; i++) {
    const t = (i + 0.5) / refCount;
    const along = -length / 2 + t * length;
    const [sx, sz] = horiz(W2_TOP_T * 1.55, 0.22);
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(sx, 0.18, sz), MATS.wallReflector,
    );
    const y = baseY + W2_FOOT_H + W2_TOP_H * 0.78;
    if (axis === 'z') m.position.set(0, y, along);
    else              m.position.set(along, y, 0);
    grp.add(m);
  }
  return grp;
}

/** Tilted wall hugging a ramp deck. Built as a CHAIN of short tilted
 *  boxes that follow the smoothstep deck profile (same approach the
 *  collider uses, just at higher density for a smooth silhouette).
 *
 *  Earlier versions tried ExtrudeGeometry along a CatmullRomCurve3 path
 *  through the deck top — but ExtrudeGeometry uses Frenet frames whose
 *  principal normal flips at the smoothstep inflection point (t=0.5),
 *  rotating the cross-section through ±90° and dropping the wall below
 *  the road surface on one half of the S-curve. Per-segment tilted
 *  boxes keep world-up as world-up at every step, so the foot bottom
 *  always sits exactly on the deck top.
 *
 *  Each segment carries: foot tier, top tier, cap rail. Reflector studs
 *  are sampled along the same curve at the cap-rail height. */
function wallRampVisual(yStart, yEnd, lengthZ, sideX) {
  const grp = new THREE.Group();
  const cx = sideX * (ROAD_WIDTH / 2 + W2_INSET);
  const SEGMENTS_RAMP = 32;       // dense enough that chord kinks are < 2cm
  const profile = (t) => {
    const e = t * t * (3 - 2 * t);
    return yStart + (yEnd - yStart) * e;
  };
  for (let i = 0; i < SEGMENTS_RAMP; i++) {
    const t0 = i / SEGMENTS_RAMP;
    const t1 = (i + 1) / SEGMENTS_RAMP;
    const z0 = -TILE / 2 + lengthZ * t0;
    const z1 = -TILE / 2 + lengthZ * t1;
    const y0 = profile(t0);
    const y1 = profile(t1);
    const dz = z1 - z0;
    const dy = y1 - y0;
    const len = Math.sqrt(dy * dy + dz * dz);
    const angle = Math.atan2(dy, dz);
    // Top of deck at this segment's chord midpoint.
    const yDeckTop = (y0 + y1) * 0.5 + ROAD_THICK;
    const cz = (z0 + z1) * 0.5;
    // Foot tier
    {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(W2_FOOT_T, W2_FOOT_H, len), MATS.wallConcrete,
      );
      m.position.set(cx, yDeckTop + W2_FOOT_H / 2, cz);
      m.rotation.x = -angle;
      m.castShadow = true; m.receiveShadow = true;
      grp.add(m);
    }
    // Top tier
    {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(W2_TOP_T, W2_TOP_H, len), MATS.wallConcrete,
      );
      m.position.set(cx, yDeckTop + W2_FOOT_H + W2_TOP_H / 2, cz);
      m.rotation.x = -angle;
      m.castShadow = true; m.receiveShadow = true;
      grp.add(m);
    }
    // Cap rail
    {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(W2_TOP_T * 1.45, W2_CAP_H, len), MATS.wallCap,
      );
      m.position.set(cx, yDeckTop + W2_FOOT_H + W2_TOP_H + W2_CAP_H / 2, cz);
      m.rotation.x = -angle;
      m.castShadow = true; m.receiveShadow = true;
      grp.add(m);
    }
  }

  // Yellow reflector studs along the cap rail (sparser than the box chain)
  // — sampled along the same smoothstep so they sit on the cap and tilt
  // with the slope at every position.
  const refCount = Math.max(3, Math.round(lengthZ / 3));
  for (let i = 0; i < refCount; i++) {
    const t = (i + 0.5) / refCount;
    const z = -TILE / 2 + lengthZ * t;
    // Local slope from the analytic derivative of smoothstep.
    const dEdt = 6 * t * (1 - t);
    const dy = (yEnd - yStart) * dEdt / lengthZ;       // dY/dZ
    const pitch = Math.atan2(dy, 1);
    const yDeckTop = profile(t) + ROAD_THICK;
    const studYOffset = W2_FOOT_H + W2_TOP_H * 0.78;
    const stud = new THREE.Mesh(
      new THREE.BoxGeometry(W2_TOP_T * 1.55, 0.18, 0.22), MATS.wallReflector,
    );
    stud.position.set(
      cx,
      yDeckTop + studYOffset * Math.cos(pitch),
      z          - studYOffset * Math.sin(pitch),
    );
    stud.rotation.x = -pitch;
    stud.castShadow = false; stud.receiveShadow = true;
    grp.add(stud);
  }

  return grp;
}

/**
 * Curved wall hugging an L-bend's outer cell perimeter. Mirrors the
 * collider geometry built by `tallWallArc` in segments.js so the visible
 * mesh and the kart-collision body line up exactly.
 *
 * Construction: a chain of `segments` short polished wall chords on an
 * arc of radius R = TILE - W2_INSET centred at the bend's INSIDE corner.
 * Each chord is a `wallStraightVisual` placed at the chord midpoint and
 * yawed so its length axis is the arc tangent there. R is chosen so the
 * arc endpoints land exactly at the adjacent straight neighbour's wall
 * positions (±halfEdge along the connector seams) — mating without a
 * step. Chord length = 2R sin(dθ/2) + a tiny W2_TOP_T overshoot which
 * fills the small triangular outer-side gap caused by adjacent chords
 * having different yaws (interior road-side face stays solid).
 */
function wallArcVisual(insideCorner, thetaStart, thetaEnd, baseY, segments = 12) {
  const grp = new THREE.Group();
  // Mirror the collider radius in segments.js tallWallArc — places wall
  // foot inner face flush with the road outer edge so the curb arc and
  // wall meet without a gap.
  const R = TILE / 2 + ROAD_WIDTH / 2 + W2_INSET;
  const dTheta = (thetaEnd - thetaStart) / segments;
  const halfDTheta = Math.abs(dTheta) / 2;
  const rMid = R * Math.cos(halfDTheta);
  const chordLen = 2 * R * Math.sin(halfDTheta) + W2_TOP_T * 0.5;
  for (let i = 0; i < segments; i++) {
    const tMid = thetaStart + dTheta * (i + 0.5);
    const cx = insideCorner[0] + rMid * Math.cos(tMid);
    const cz = insideCorner[1] + rMid * Math.sin(tMid);
    const chord = wallStraightVisual(chordLen, 'z', baseY);
    chord.position.set(cx, 0, cz);
    // Tangent direction at arc angle t (with arc point = centre +
    // R*(cos t, sin t)) is (-sin t, cos t). Three.js rotY(θ) sends local
    // +Z=(0,0,1) to world (sin θ, 0, cos θ). To align +Z with the tangent
    // we need (sin θ, cos θ) = (-sin t, cos t) → θ = -t. The previous
    // formula (t + π/2) rotated chords radially instead of tangentially,
    // making them flare outward like spokes (visible in editor preview).
    chord.rotation.y = -tMid;
    grp.add(chord);
  }
  return grp;
}

/** Concrete corner pillar — closes the visual gap where two perpendicular
 *  walls meet at the outer corner of an L-bend / curved plateau. */
function cornerPillarVisual(x, z, baseY) {
  const grp = new THREE.Group();
  const h = W2_FOOT_H + W2_TOP_H;
  const r = W2_FOOT_T * 0.7;
  const col = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r * 1.05, h, 18), MATS.wallConcrete,
  );
  col.position.set(x, baseY + h / 2, z);
  col.castShadow = true; col.receiveShadow = true;
  grp.add(col);
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 1.25, r * 1.25, W2_CAP_H, 18), MATS.wallCap,
  );
  cap.position.set(x, baseY + h + W2_CAP_H / 2, z);
  grp.add(cap);
  // Reflector ring just under the cap.
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(r * 1.18, 0.06, 6, 18), MATS.wallReflector,
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.set(x, baseY + h - 0.18, z);
  grp.add(ring);
  return grp;
}

/** Append polished tall walls (and corner pillars / peak caps) for a
 *  given base segment to an already-built mesh group. */
function addWallOverlay(group, baseKey) {
  const T = TILE;
  // Walls hug the road outer edge (foot inner face at ±ROAD_WIDTH/2).
  // See segments.js buildWalls for the rationale — keep this in sync.
  const halfEdge = ROAD_WIDTH / 2 + W2_INSET;
  const groundY = ROAD_THICK;

  const placeStraight = (length, axis, baseY, cx, cz) => {
    const m = wallStraightVisual(length, axis, baseY);
    m.position.x += cx; m.position.z += cz;
    group.add(m);
  };

  switch (baseKey) {
    case 'straight':
    case 'finish':
    case 'bump_up':
    case 'cap_end':
      placeStraight(T, 'z', groundY, +halfEdge, 0);
      placeStraight(T, 'z', groundY, -halfEdge, 0);
      break;

    case 'corner':
      // Curved wall along the bend's outer arc, mating with adjacent
      // straight neighbours' walls at the seam endpoints. No corner
      // pillar needed — the arc is continuous from seam to seam.
      group.add(wallArcVisual([-T / 2, -T / 2], 0, Math.PI / 2, groundY));
      break;
    case 'cornerR':
      group.add(wallArcVisual([+T / 2, -T / 2], Math.PI, Math.PI / 2, groundY));
      break;

    case 'plateau': {
      const yTop = PLATEAU_HEIGHT + ROAD_THICK;
      placeStraight(T, 'z', yTop, +halfEdge, 0);
      placeStraight(T, 'z', yTop, -halfEdge, 0);
      break;
    }
    case 'curved_plateau': {
      const yTop = PLATEAU_HEIGHT + ROAD_THICK;
      group.add(wallArcVisual([-T / 2, -T / 2], 0, Math.PI / 2, yTop));
      break;
    }
    case 'curved_plateauR': {
      const yTop = PLATEAU_HEIGHT + ROAD_THICK;
      group.add(wallArcVisual([+T / 2, -T / 2], Math.PI, Math.PI / 2, yTop));
      break;
    }

    case 'ramp_up':
      group.add(wallRampVisual(0, T * 0.6, T * 2, +1));
      group.add(wallRampVisual(0, T * 0.6, T * 2, -1));
      break;
    case 'ramp_down':
      group.add(wallRampVisual(T * 0.6, 0, T * 2, +1));
      group.add(wallRampVisual(T * 0.6, 0, T * 2, -1));
      break;
    case 'jump_ramp':
      group.add(wallRampVisual(0, 1.2, T, +1));
      group.add(wallRampVisual(0, 1.2, T, -1));
      break;
    case 'bridge_onramp':
      group.add(wallRampVisual(0, BRIDGE_DECK_HEIGHT, T * BRIDGE_RAMP_CELLS, +1));
      group.add(wallRampVisual(0, BRIDGE_DECK_HEIGHT, T * BRIDGE_RAMP_CELLS, -1));
      break;
    case 'bridge_offramp':
      group.add(wallRampVisual(BRIDGE_DECK_HEIGHT, 0, T * BRIDGE_RAMP_CELLS, +1));
      group.add(wallRampVisual(BRIDGE_DECK_HEIGHT, 0, T * BRIDGE_RAMP_CELLS, -1));
      break;

    case 'bridge': {
      const yTop = BRIDGE_DECK_HEIGHT + ROAD_THICK;
      const length = T * 2;
      const cz = length / 2 - T / 2;
      placeStraight(length, 'z', yTop, +halfEdge, cz);
      placeStraight(length, 'z', yTop, -halfEdge, cz);
      break;
    }

    case 'hill_complete': {
      // Walls hug the sin-arch profile y = sin(t·π)·peak over the full
      // 2-cell span. peak matches buildHill (visual) and rollingHillBlocks
      // (physics). The previous code used peak = T·0.25 with two separate
      // smoothstep ramps — 10% shorter than the actual road and using the
      // wrong curve, which caused the wall to sink into the road deck at
      // the slope midpoints.
      const peak = T * 0.275;
      const lengthZ = T * 2;
      const SEGS = 32;
      // sin²(t·π): zero slope at endpoints, matches buildHill visual profile.
      const hillProfile = (t) => { const s = Math.sin(t * Math.PI); return s * s * peak; };
      for (const sx of [-1, +1]) {
        const cx = sx * halfEdge;
        for (let i = 0; i < SEGS; i++) {
          const t0 = i / SEGS;
          const t1 = (i + 1) / SEGS;
          const z0 = -T / 2 + lengthZ * t0;
          const z1 = -T / 2 + lengthZ * t1;
          const y0 = hillProfile(t0);
          const y1 = hillProfile(t1);
          const dz = z1 - z0;
          const dy = y1 - y0;
          const len = Math.sqrt(dy * dy + dz * dz);
          const angle = Math.atan2(dy, dz);
          const yDeckTop = (y0 + y1) * 0.5 + ROAD_THICK;
          const cz = (z0 + z1) * 0.5;
          const mFoot = new THREE.Mesh(
            new THREE.BoxGeometry(W2_FOOT_T, W2_FOOT_H, len), MATS.wallConcrete,
          );
          mFoot.position.set(cx, yDeckTop + W2_FOOT_H / 2, cz);
          mFoot.rotation.x = -angle;
          mFoot.castShadow = true; mFoot.receiveShadow = true;
          group.add(mFoot);
          const mTop = new THREE.Mesh(
            new THREE.BoxGeometry(W2_TOP_T, W2_TOP_H, len), MATS.wallConcrete,
          );
          mTop.position.set(cx, yDeckTop + W2_FOOT_H + W2_TOP_H / 2, cz);
          mTop.rotation.x = -angle;
          mTop.castShadow = true; mTop.receiveShadow = true;
          group.add(mTop);
          const mCap = new THREE.Mesh(
            new THREE.BoxGeometry(W2_TOP_T * 1.45, W2_CAP_H, len), MATS.wallCap,
          );
          mCap.position.set(cx, yDeckTop + W2_FOOT_H + W2_TOP_H + W2_CAP_H / 2, cz);
          mCap.rotation.x = -angle;
          mCap.castShadow = true; mCap.receiveShadow = true;
          group.add(mCap);
        }
      }
      break;
    }

    default:
      // tunnel / wide / t_junction / crossroads / spawn — no walled twin.
      break;
  }
}

// Wrap each base VISUAL_BUILDERS entry into a `${key}_walled` builder
// that calls the polished base + adds the tall-wall overlay. SEGMENTS
// from segments.js gates which keys actually have a walled twin.
{
  const baseKeys = Object.keys(VISUAL_BUILDERS);
  for (const baseKey of baseKeys) {
    const walledKey = `${baseKey}_walled`;
    if (!SEGMENTS[walledKey]) continue;
    const baseFn = VISUAL_BUILDERS[baseKey];
    VISUAL_BUILDERS[walledKey] = () => {
      const g = baseFn();
      addWallOverlay(g, baseKey);
      return g;
    };
  }
}
