/**
 * decor.js — Tinkercad-style 3D primitive shapes for environment building.
 *
 * Where the track model snaps to a fixed grid (one segment per cell), decor
 * lives in continuous world space: free position, free rotation, free scale.
 *
 * Each instance:
 *   { id, type, x, y, z, rx, ry, rz, sx, sy, sz, color, isHole }
 *
 * The geometry for each `type` is cached and reused across instances.
 */

import * as THREE from 'three';

// ── Shared geometry cache ────────────────────────────────────────
const _geomCache = new Map();
function geom(key, factory) {
  let g = _geomCache.get(key);
  if (!g) { g = factory(); _geomCache.set(key, g); }
  return g;
}
function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
function clampInt(v, lo, hi) { v = v|0; return v < lo ? lo : (v > hi ? hi : v); }

// Lightweight rounded-box geometry (chamfered corners) for box bevel param.
function roundedBoxGeometry(w, h, d, r, seg) {
  const shape = new THREE.Shape();
  const x = w / 2, y = h / 2;
  shape.moveTo(-x + r, -y);
  shape.lineTo(x - r, -y);
  shape.quadraticCurveTo(x, -y, x, -y + r);
  shape.lineTo(x, y - r);
  shape.quadraticCurveTo(x, y, x - r, y);
  shape.lineTo(-x + r, y);
  shape.quadraticCurveTo(-x, y, -x, y - r);
  shape.lineTo(-x, -y + r);
  shape.quadraticCurveTo(-x, -y, -x + r, -y);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: d - r * 2,
    bevelEnabled: true,
    bevelSize: r,
    bevelThickness: r,
    bevelSegments: seg,
    curveSegments: Math.max(2, seg),
  });
  g.translate(0, 0, -(d - r * 2) / 2 - r);
  g.rotateX(-Math.PI / 2);
  return g;
}

// ── Shape factories ──────────────────────────────────────────────
// Each factory returns a unit-ish geometry centered at (0, 0.5, 0) so the
// piece sits on the ground when y=0 and scale=1 means "1 world unit tall".
// Most accept an opts bag with TC-style per-shape parameters; when omitted
// the registry default is used and the result is shared via _geomCache.
function _box(opts) {
  const bevel = clamp01(((opts && opts.bevel) || 0) / 50);
  if (bevel <= 0.001) {
    const g = new THREE.BoxGeometry(1, 1, 1);
    g.translate(0, 0.5, 0);
    return g;
  }
  // Beveled box approximated via RoundedBox (manual chamfer using BoxGeometry corners).
  const r = bevel * 0.5;
  const seg = 4;
  const g = roundedBoxGeometry(1, 1, 1, r, seg);
  g.translate(0, 0.5, 0);
  return g;
}
function _cylinder(opts) {
  const sides = clampInt((opts && opts.sides) || 32, 3, 64);
  const g = new THREE.CylinderGeometry(0.5, 0.5, 1, sides);
  g.translate(0, 0.5, 0);
  return g;
}
function _sphere(opts) {
  const seg = clampInt((opts && opts.segments) || 32, 6, 64);
  const g = new THREE.SphereGeometry(0.5, seg, Math.max(6, seg >> 1));
  g.translate(0, 0.5, 0);
  return g;
}
function _hemisphere(opts) {
  const seg = clampInt((opts && opts.segments) || 32, 6, 64);
  const g = new THREE.SphereGeometry(0.5, seg, Math.max(4, seg >> 1), 0, Math.PI * 2, 0, Math.PI / 2);
  // already a hemisphere flat on its base
  return g;
}
function _cone(opts) {
  const sides = clampInt((opts && opts.sides) || 32, 3, 64);
  const g = new THREE.ConeGeometry(0.5, 1, sides);
  g.translate(0, 0.5, 0);
  return g;
}
function _pyramid(opts) {
  const sides = clampInt((opts && opts.sides) || 4, 3, 12);
  const g = new THREE.ConeGeometry(0.5 * Math.SQRT2, 1, sides);
  g.translate(0, 0.5, 0);
  g.rotateY(Math.PI / sides);
  return g;
}
function _torus(opts) {
  const tube = clamp01(((opts && opts.tube) || 24) / 100) * 0.45 + 0.04;
  const radial = clampInt((opts && opts.radial) || 16, 4, 32);
  const tubular = clampInt((opts && opts.tubular) || 48, 6, 96);
  const g = new THREE.TorusGeometry(0.5 - tube, tube, radial, tubular);
  g.rotateX(Math.PI / 2);
  g.translate(0, tube, 0);
  return g;
}
function _polygon(opts) {
  const sides = clampInt((opts && opts.sides) || 6, 3, 24);
  const g = new THREE.CylinderGeometry(0.5, 0.5, 1, sides);
  g.translate(0, 0.5, 0);
  return g;
}
function _ring(opts) {
  const sides = clampInt((opts && opts.sides) || 32, 6, 96);
  const inner = clamp01(((opts && opts.inner) || 50) / 100) * 0.45;
  const g = new THREE.RingGeometry(inner, 0.5, sides);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.005, 0);
  return g;
}
function _paraboloid(opts) {
  const seg = clampInt((opts && opts.segments) || 24, 6, 64);
  const stacks = clampInt((opts && opts.stacks) || 12, 3, 32);
  const g = new THREE.BufferGeometry();
  const pos = [], idx = [];
  for (let j = 0; j <= stacks; j++) {
    const v = j / stacks; // 0 base ring, 1 tip
    const r = 0.5 * Math.sqrt(1 - v);
    const y = v;
    for (let i = 0; i <= seg; i++) {
      const t = (i / seg) * Math.PI * 2;
      pos.push(Math.cos(t) * r, y, Math.sin(t) * r);
    }
  }
  for (let j = 0; j < stacks; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i;
      const b = a + 1;
      const c = a + (seg + 1);
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function _wedge() {
  // Right triangular prism: base 1×1, sloping from y=0 at +Z to y=1 at -Z.
  const positions = new Float32Array([
    // bottom (y=0)
    -0.5, 0, -0.5,   0.5, 0, -0.5,   0.5, 0, 0.5,
    -0.5, 0, -0.5,   0.5, 0, 0.5,   -0.5, 0, 0.5,
    // back (z=-0.5, vertical)
    -0.5, 0, -0.5,  -0.5, 1, -0.5,   0.5, 1, -0.5,
    -0.5, 0, -0.5,   0.5, 1, -0.5,   0.5, 0, -0.5,
    // sloped top
    -0.5, 1, -0.5,  -0.5, 0, 0.5,    0.5, 0, 0.5,
    -0.5, 1, -0.5,   0.5, 0, 0.5,    0.5, 1, -0.5,
    // left (x=-0.5, triangle)
    -0.5, 0, -0.5,  -0.5, 0, 0.5,   -0.5, 1, -0.5,
    // right (x=0.5, triangle)
     0.5, 0, -0.5,   0.5, 1, -0.5,   0.5, 0, 0.5,
  ]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}
function _plane() {
  const g = new THREE.BoxGeometry(1, 0.05, 1);
  g.translate(0, 0.025, 0);
  return g;
}
function _capsule() {
  const g = new THREE.CapsuleGeometry(0.3, 0.4, 8, 16);
  g.translate(0, 0.5, 0);
  return g;
}
function _torusKnot() {
  const g = new THREE.TorusKnotGeometry(0.35, 0.1, 96, 12);
  g.translate(0, 0.5, 0);
  return g;
}

// "Nature" presets are just primitives with built-in non-uniform default scale
// + a themed colour. Their geometry is still the base primitive so the gizmo
// scaling continues to work intuitively.

export const DECOR = {
  // ── Geometric primitives ────────────────────────────────────
  // Geometry primitives are unit-1 (1 mm). The DecorStore.add() applies a
  // 5 m default scale when no per-type defaultScale is provided, so primitives
  // intentionally OMIT defaultScale to inherit that fallback.
  box:        { label: 'Box',        category: 'shape', color: 0xe6453a, centered: true,
                params: { bevel: { label: 'Bevel', min: 0, max: 50, step: 1, default: 0 } },
                build: (p) => (p && p.bevel) ? _box(p) : geom('box', _box) },
  cylinder:   { label: 'Cylinder',   category: 'shape', color: 0xee8b1a,
                params: { sides: { label: 'Sides', min: 3, max: 64, step: 1, default: 32, integer: true } },
                build: (p) => (p && p.sides && p.sides !== 32) ? _cylinder(p) : geom('cyl', _cylinder) },
  sphere:     { label: 'Sphere',     category: 'shape', color: 0x2e9bd6, centered: true,
                params: { segments: { label: 'Segments', min: 6, max: 64, step: 1, default: 32, integer: true } },
                build: (p) => (p && p.segments && p.segments !== 32) ? _sphere(p) : geom('sph', _sphere) },
  hemisphere: { label: 'Hemisphere', category: 'shape', color: 0x9b6dc6,
                params: { segments: { label: 'Segments', min: 6, max: 64, step: 1, default: 32, integer: true } },
                build: (p) => (p && p.segments && p.segments !== 32) ? _hemisphere(p) : geom('hem', _hemisphere) },
  cone:       { label: 'Cone',       category: 'shape', color: 0x9c4ec0,
                params: { sides: { label: 'Sides', min: 3, max: 64, step: 1, default: 32, integer: true } },
                build: (p) => (p && p.sides && p.sides !== 32) ? _cone(p) : geom('con', _cone) },
  pyramid:    { label: 'Pyramid',    category: 'shape', color: 0xead33a,
                params: { sides: { label: 'Sides', min: 3, max: 12, step: 1, default: 4, integer: true } },
                build: (p) => (p && p.sides && p.sides !== 4) ? _pyramid(p) : geom('pyr', _pyramid) },
  wedge:      { label: 'Wedge',      category: 'shape', color: 0x4ab84a, build: () => geom('wed', _wedge) },
  plane:      { label: 'Slab',       category: 'shape', color: 0x4f9fd6, build: () => geom('pln', _plane) },
  capsule:    { label: 'Capsule',    category: 'shape', color: 0x7ec0e0, build: () => geom('cap', _capsule) },
  torus:      { label: 'Torus',      category: 'shape', color: 0xf06ec6,
                params: {
                  tube: { label: 'Tube', min: 4, max: 80, step: 1, default: 24 },
                  radial: { label: 'Smoothness', min: 4, max: 32, step: 1, default: 16, integer: true },
                },
                build: (p) => (p && (p.tube !== undefined || p.radial !== undefined)) ? _torus(p) : geom('tor', _torus) },
  knot:       { label: 'Knot',       category: 'shape', color: 0xff7a3a, build: () => geom('knt', _torusKnot) },
  polygon:    { label: 'Polygon',    category: 'shape', color: 0x5fb56b,
                params: { sides: { label: 'Sides', min: 3, max: 24, step: 1, default: 6, integer: true } },
                build: (p) => _polygon(p || { sides: 6 }) },
  ring:       { label: 'Ring',       category: 'shape', color: 0xd96eb0,
                params: {
                  inner: { label: 'Inner %', min: 5, max: 95, step: 1, default: 50 },
                  sides: { label: 'Sides', min: 6, max: 96, step: 1, default: 32, integer: true },
                },
                build: (p) => _ring(p || {}) },
  paraboloid: { label: 'Paraboloid', category: 'shape', color: 0x4abfb8,
                params: {
                  segments: { label: 'Segments', min: 6, max: 64, step: 1, default: 24, integer: true },
                  stacks: { label: 'Stacks', min: 3, max: 32, step: 1, default: 12, integer: true },
                },
                build: (p) => _paraboloid(p || {}) },

  // ── Nature presets (primitive + themed default colour/scale) ─
  rock:       { label: 'Rock',       category: 'nature', color: 0x808a8f, build: () => geom('sph', _sphere),
                defaultScale: [1.6, 1.0, 1.2], defaultRot: [0.2, 0.4, 0.1] },
  boulder:    { label: 'Boulder',    category: 'nature', color: 0x6e7378, build: () => geom('sph', _sphere),
                defaultScale: [3.0, 2.2, 2.6], defaultRot: [0.1, 0.7, 0.0] },
  tree_pine:  { label: 'Pine',       category: 'nature', color: 0x2f6b3a, build: () => geom('con', _cone),
                defaultScale: [1.4, 4.0, 1.4] },
  tree_round: { label: 'Round Tree', category: 'nature', color: 0x3a8048, build: () => geom('sph', _sphere),
                defaultScale: [1.8, 2.0, 1.8], defaultY: 1.0 },
  bush:       { label: 'Bush',       category: 'nature', color: 0x466b32, build: () => geom('sph', _sphere),
                defaultScale: [1.2, 0.7, 1.2] },
  log:        { label: 'Log',        category: 'nature', color: 0x6b4a2e, build: () => geom('cyl', _cylinder),
                defaultScale: [0.5, 2.5, 0.5], defaultRot: [Math.PI / 2, 0, 0] },

  // ── Urban / track-side props ────────────────────────────────
  cone_orange:{ label: 'Traffic Cone', category: 'urban', color: 0xff6b1f, build: () => geom('con', _cone),
                defaultScale: [0.4, 0.9, 0.4] },
  barrel:     { label: 'Barrel',     category: 'urban', color: 0xc8351c, build: () => geom('cyl', _cylinder),
                defaultScale: [0.6, 1.0, 0.6] },
  crate:      { label: 'Crate',      category: 'urban', color: 0xa8773a, build: () => geom('box', _box),
                defaultScale: [1.0, 1.0, 1.0] },
  wall:       { label: 'Wall',       category: 'urban', color: 0x4a525c, build: () => geom('box', _box),
                defaultScale: [4.0, 1.5, 0.4] },
  pillar:     { label: 'Pillar',     category: 'urban', color: 0xb0b6bf, build: () => geom('cyl', _cylinder),
                defaultScale: [0.7, 4.0, 0.7] },
  banner:     { label: 'Banner',     category: 'urban', color: 0xffd23a, build: () => geom('box', _box),
                defaultScale: [6.0, 0.6, 0.2], defaultY: 4.0 },
  ramp_block: { label: 'Ramp',       category: 'urban', color: 0x6c7a89, build: () => geom('wed', _wedge),
                defaultScale: [3.0, 1.5, 4.0] },
};

export const DECOR_KEYS = Object.keys(DECOR);
export const DECOR_CATEGORY_ORDER = ['shape', 'nature', 'urban'];
export const DECOR_CATEGORY_LABELS = {
  shape: 'Shapes',
  nature: 'Nature',
  urban: 'Props',
};

export function isDecorKey(key) {
  return Object.prototype.hasOwnProperty.call(DECOR, key);
}

// ── Materials ────────────────────────────────────────────────────
const _matCache = new Map();
// Tinkercad parity: a shape can be Solid (opaque), a Hole (cyan-pattern
// preview that subtracts on group), or marked Transparent (visible but
// see-through, opacity ~0.55). Cache key encodes all three so each
// variant gets its own shared material.
export function getDecorMaterial(color, isHole = false, isTransparent = false) {
  const tag = isHole ? 'h' : (isTransparent ? 't' : 's');
  const key = `${tag}:${color}`;
  let m = _matCache.get(key);
  if (!m) {
    const opacity = isHole ? 0.35 : (isTransparent ? 0.55 : 1.0);
    const transparent = isHole || isTransparent;
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.55,
      metalness: 0.02,
      transparent,
      opacity,
      depthWrite: !transparent,
    });
    _matCache.set(key, m);
  }
  return m;
}

// ── DecorStore ──────────────────────────────────────────────────
let _nextId = 1;

export class DecorStore {
  constructor() {
    /** @type {Map<number, object>} */
    this.items = new Map();
  }

  /** Create a new instance. Caller passes a partial; defaults from registry are filled in. */
  add({ type, x = 0, y, z = 0, rx, ry, rz, sx, sy, sz, color, isHole = false, transparent = false, isLocked = false, isHidden = false, groupId = null, params = null } = {}) {
    if (!DECOR[type]) return null;
    const def = DECOR[type];
    const dr = def.defaultRot || [0, 0, 0];
    // Tinkercad parity (kart-scale): every freshly placed primitive starts
    // at 5000×5000×5000 mm (5 m) — immediately visible and grabbable on
    // the road-scale grid. Per-type registry defaultScale is treated as a
    // small unitless ratio in mm where present (nature/urban presets), so
    // we scale those by 1000 to get a comparable starting size.
    const presetDS = def.defaultScale;
    const ds = presetDS
      ? [ presetDS[0] * 1000, presetDS[1] * 1000, presetDS[2] * 1000 ]
      : [ 5000, 5000, 5000 ];
    const _sx = sx ?? ds[0], _sy = sy ?? ds[1], _sz = sz ?? ds[2];
    // Geometry-aware default Y: centered primitives lift so their base sits on the workplane.
    const _y = (y !== undefined) ? y : (def.centered ? _sy / 2 : 0);
    const inst = {
      id: _nextId++,
      type,
      x, y: _y, z,
      rx: rx ?? dr[0], ry: ry ?? dr[1], rz: rz ?? dr[2],
      sx: _sx, sy: _sy, sz: _sz,
      color: color ?? def.color,
      isHole: !!isHole,
      transparent: !!transparent,
      isLocked: !!isLocked,
      isHidden: !!isHidden,
      groupId: groupId ?? null,
      params: defaultParamsFor(type, params),
    };
    this.items.set(inst.id, inst);
    return inst;
  }

  remove(id) { return this.items.delete(id); }
  getById(id) { return this.items.get(id) || null; }
  all() { return Array.from(this.items.values()); }
  clear() { this.items.clear(); }

  toJSON() {
    return Array.from(this.items.values()).map(d => ({
      t: d.type,
      p: [round3(d.x), round3(d.y), round3(d.z)],
      r: [round3(d.rx), round3(d.ry), round3(d.rz)],
      s: [round3(d.sx), round3(d.sy), round3(d.sz)],
      c: d.color,
      h: d.isHole ? 1 : 0,
      tr: d.transparent ? 1 : 0,
      l: d.isLocked ? 1 : 0,
      v: d.isHidden ? 1 : 0,
      g: d.groupId ?? null,
      pa: hasNonDefaultParams(d.type, d.params) ? d.params : undefined,
    }));
  }

  fromJSON(arr) {
    this.clear();
    if (!Array.isArray(arr)) return;
    for (const d of arr) {
      const [x, y, z] = d.p || [0, 0, 0];
      const [rx, ry, rz] = d.r || [0, 0, 0];
      const [sx, sy, sz] = d.s || [1, 1, 1];
      this.add({ type: d.t, x, y, z, rx, ry, rz, sx, sy, sz, color: d.c, isHole: !!d.h, transparent: !!d.tr, isLocked: !!d.l, isHidden: !!d.v, groupId: d.g ?? null, params: d.pa || null });
    }
  }
}

function defaultParamsFor(type, override) {
  const def = DECOR[type];
  if (!def || !def.params) return null;
  const out = {};
  for (const [k, schema] of Object.entries(def.params)) out[k] = schema.default;
  if (override && typeof override === 'object') {
    for (const [k, v] of Object.entries(override)) {
      if (k in out) out[k] = v;
    }
  }
  return out;
}
function hasNonDefaultParams(type, params) {
  const def = DECOR[type];
  if (!def || !def.params || !params) return false;
  for (const [k, schema] of Object.entries(def.params)) {
    if (params[k] !== schema.default) return true;
  }
  return false;
}
export function getParamSchema(type) {
  const def = DECOR[type];
  return (def && def.params) || null;
}

function round3(v) { return Math.round(v * 1000) / 1000; }

// ── Mesh builder ────────────────────────────────────────────────
/** Build a Three.js mesh for a decor instance and tag it for picking. */
export function buildDecorMesh(inst) {
  const def = DECOR[inst.type];
  if (!def) return null;
  const mesh = new THREE.Mesh(def.build(inst.params), getDecorMaterial(inst.color, inst.isHole, !!inst.transparent));
  mesh.position.set(inst.x, inst.y, inst.z);
  mesh.rotation.set(inst.rx, inst.ry, inst.rz);
  mesh.scale.set(inst.sx, inst.sy, inst.sz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.decorId = inst.id;
  mesh.userData.paramsKey = paramsKey(inst.params);
  return mesh;
}

function paramsKey(params) {
  if (!params) return '';
  const keys = Object.keys(params).sort();
  return keys.map(k => k + ':' + params[k]).join('|');
}

function _isCachedGeometry(g) {
  for (const v of _geomCache.values()) if (v === g) return true;
  return false;
}

/** Sync an existing mesh to the latest instance values. */
export function syncDecorMesh(mesh, inst) {
  mesh.position.set(inst.x, inst.y, inst.z);
  mesh.rotation.set(inst.rx, inst.ry, inst.rz);
  mesh.scale.set(inst.sx, inst.sy, inst.sz);
  mesh.material = getDecorMaterial(inst.color, inst.isHole, !!inst.transparent);
  mesh.visible = !inst.isHidden;
  const key = paramsKey(inst.params);
  if (key !== mesh.userData.paramsKey) {
    const def = DECOR[inst.type];
    if (def) {
      const prev = mesh.geometry;
      mesh.geometry = def.build(inst.params);
      mesh.userData.paramsKey = key;
      if (prev && !_isCachedGeometry(prev)) prev.dispose?.();
    }
  }
}
