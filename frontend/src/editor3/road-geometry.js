/**
 * road-geometry.js — Polished segment visuals.
 *
 * Each builder returns a THREE.Group whose shape closely traces a smooth
 * road centerline using ExtrudeGeometry along a CatmullRom/arc path.
 * Visuals are decoupled from the cannon-es collision blocks defined in
 * segments.js (which still use axis-aligned boxes).
 */
import * as THREE from 'three';
import { TILE, ROAD_WIDTH, ROAD_THICK, WALL_HEIGHT, WALL_THICK } from './segments.js';

// ── Materials (cached, shared) ────────────────────────────────────
const TEX = (() => {
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
  return { asphalt, asphaltRough, concrete };
})();

const MATS = {
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
};

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
    const dz = pB.z - pA.z;
    const chordLen = Math.hypot(dx, dz);
    if (chordLen < 1e-6) continue;
    const yaw = Math.atan2(dx, dz);
    const stone = new THREE.BoxGeometry(CURB_STRIPE_WIDTH, CURB_STRIPE_HEIGHT, chordLen);
    const m = new THREE.Mesh(stone, i % 2 === 0 ? MATS.curbRed : MATS.curbWhite);
    m.position.set(cx, ROAD_THICK + cy + CURB_STRIPE_HEIGHT / 2, cz);
    m.rotation.y = yaw;
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

function buildBanked(mirror) {
  // Single-cell 90° banked corner. Same arc as buildCorner but the deck
  // tilts up on the OUTSIDE edge of the bend so karts can carry more
  // speed through the apex. The bank is baked into the geometry via
  // extrudeRoadBanked using a wedge cross-section: the underside is flat
  // at ground level (no floating, no buttress required) and the top deck
  // tilts about the inner-edge axis. The bank EASES smoothly to zero at
  // both endpoints (bankFn(0)=bankFn(1)=0), so the cross-section
  // degenerates to the same flat ribbon used by `straight` and `corner`
  // — guaranteeing perfect edge-to-edge alignment with adjacent tiles.
  const grp = new THREE.Group();
  const cx = mirror ? +TILE / 2 : -TILE / 2;
  const cz = -TILE / 2;
  const r = TILE / 2;
  const a0 = mirror ? Math.PI : 0;
  const a1 = Math.PI / 2;
  const path = arcPath3(cx, cz, r, a0, a1, 0, 24);
  const BANK_MAX = Math.PI / 9; // ~20° at apex
  // Smooth ease in/out via sin(t·π): zero at t=0 and t=1, peak at t=0.5.
  const bankFn = (t) => {
    const tt = Math.max(0, Math.min(1, t));
    return Math.sin(tt * Math.PI) * BANK_MAX;
  };
  // Outward direction = away from arc center.
  // perp+ = (-tan.z, tan.x); at start of arc this points TOWARD the center
  // (i.e. inward), so outerSign must FLIP perp to point outward.
  // For mirror=false (CCW arc, center at -X, outside is +X): perp+=(-X) →
  //   outerSign=-1 makes outward = +X. ✓
  // For mirror=true (CW arc, center at +X, outside is -X): perp+=(-X) →
  //   outerSign=+1 keeps outward = -X. ✓
  const outerSign = mirror ? +1 : -1;
  grp.add(extrudeRoadBanked(path, bankFn, outerSign, { steps: 48 }));
  // Outer (lifted) curb at full size; inner curb shrunk so the apex still
  // reads as the racing line.
  grp.add(curbAlongPathBanked(path, +outerSign, bankFn, outerSign));
  const inner = curbAlongPathBanked(path, -outerSign, bankFn, outerSign);
  inner.children.forEach(c => { c.scale.set(0.65, 0.7, 1.0); });
  grp.add(inner);
  // Subtle racing-line dashes through the apex.
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
  // Red/white speed-bump warning stripes across the apex
  const stripeCount = 6;
  for (let i = 0; i < stripeCount; i++) {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(ROAD_WIDTH / stripeCount * 0.92, 0.04, 0.6),
      i % 2 === 0 ? MATS.curbRed : MATS.curbWhite,
    );
    stripe.position.set(
      -ROAD_WIDTH / 2 + (i + 0.5) * (ROAD_WIDTH / stripeCount),
      0.45 + ROAD_THICK + 0.03,
      0,
    );
    grp.add(stripe);
  }
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
  // road segments can pass beneath it (multi-level layouts). No spandrel
  // walls, no closed base. Deck is carried by 3 pairs of slim concrete
  // columns at the entry, midspan, and exit. Cross-beams cap each pair so
  // it reads as a structural bent rather than four floating sticks.
  const grp = new THREE.Group();
  const lengthZ = TILE * 2;
  const deckH = TILE * 0.6;
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
  // direction: 'up' => 0 → deckH, 'down' => deckH → 0
  const deckH = TILE * 0.6;
  return direction === 'up' ? buildRamp(0, deckH, 2) : buildRamp(deckH, 0, 2);
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

// ── Registry ──────────────────────────────────────────────────────
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
    // Four columnar piers — round concrete columns at the corners under the
    // deck, with a wide cap so the deck visibly rests on them.
    for (const sx of [-1, +1]) for (const sz of [-1, +1]) {
      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 0.7, deckH, 16),
        MATS.concrete,
      );
      col.position.set(
        sx * (ROAD_WIDTH / 2 - 0.6),
        deckH / 2,
        sz * (TILE / 2 - 0.6),
      );
      col.castShadow = true; col.receiveShadow = true;
      g.add(col);
    }
    // Cross-beams between front and back piers under the deck
    for (const sx of [-1, +1]) {
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.4, TILE - 1.2),
        MATS.concrete,
      );
      beam.position.set(sx * (ROAD_WIDTH / 2 - 0.6), deckH - 0.25, 0);
      beam.castShadow = true; beam.receiveShadow = true;
      g.add(beam);
    }
    return g;
  },
  bridge:          () => { const g = buildBridge(); g.position.z = TILE / 2; return g; },
  bridge_onramp:   () => { const g = buildBridgeRamp('up'); g.position.z = TILE / 2; return g; },
  bridge_offramp:  () => { const g = buildBridgeRamp('down'); g.position.z = TILE / 2; return g; },
  tunnel:          () => { const g = buildTunnel(); g.position.z = TILE / 2; return g; },
  t_junction:      () => buildTJunction(),
  crossroads:      () => buildCrossroads(),
  wide:            () => buildPlaza(),
  cap_end:         () => buildCapEnd(),
  finish:          () => buildFinish(),
  spawn:           () => buildSpawn(),
};
