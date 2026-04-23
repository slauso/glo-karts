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

// ── Shape factories ──────────────────────────────────────────────
// Each factory returns a unit-ish geometry centered at (0, 0.5, 0) so the
// piece sits on the ground when y=0 and scale=1 means "1 world unit tall".
function _box() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  return g;
}
function _cylinder() {
  const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
  g.translate(0, 0.5, 0);
  return g;
}
function _sphere() {
  const g = new THREE.SphereGeometry(0.5, 32, 24);
  g.translate(0, 0.5, 0);
  return g;
}
function _hemisphere() {
  const g = new THREE.SphereGeometry(0.5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  // already a hemisphere flat on its base
  return g;
}
function _cone() {
  const g = new THREE.ConeGeometry(0.5, 1, 32);
  g.translate(0, 0.5, 0);
  return g;
}
function _pyramid() {
  const g = new THREE.ConeGeometry(0.5 * Math.SQRT2, 1, 4);
  g.translate(0, 0.5, 0);
  g.rotateY(Math.PI / 4);
  return g;
}
function _torus() {
  const g = new THREE.TorusGeometry(0.4, 0.12, 16, 48);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0.16, 0);
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
  box:        { label: 'Box',        category: 'shape', color: 0xe6453a, build: () => geom('box', _box) },
  cylinder:   { label: 'Cylinder',   category: 'shape', color: 0xee8b1a, build: () => geom('cyl', _cylinder) },
  sphere:     { label: 'Sphere',     category: 'shape', color: 0x2e9bd6, build: () => geom('sph', _sphere) },
  hemisphere: { label: 'Hemisphere', category: 'shape', color: 0x9b6dc6, build: () => geom('hem', _hemisphere) },
  cone:       { label: 'Cone',       category: 'shape', color: 0x9c4ec0, build: () => geom('con', _cone) },
  pyramid:    { label: 'Pyramid',    category: 'shape', color: 0xead33a, build: () => geom('pyr', _pyramid) },
  wedge:      { label: 'Wedge',      category: 'shape', color: 0x4ab84a, build: () => geom('wed', _wedge) },
  plane:      { label: 'Slab',       category: 'shape', color: 0x4f9fd6, build: () => geom('pln', _plane) },
  capsule:    { label: 'Capsule',    category: 'shape', color: 0x7ec0e0, build: () => geom('cap', _capsule) },
  torus:      { label: 'Torus',      category: 'shape', color: 0xf06ec6, build: () => geom('tor', _torus) },
  knot:       { label: 'Knot',       category: 'shape', color: 0xff7a3a, build: () => geom('knt', _torusKnot) },

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
export function getDecorMaterial(color, isHole = false) {
  const key = `${isHole ? 'h' : 's'}:${color}`;
  let m = _matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.55,
      metalness: 0.02,
      transparent: isHole,
      opacity: isHole ? 0.35 : 1.0,
      depthWrite: !isHole,
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
  add({ type, x = 0, y = 0, z = 0, rx, ry, rz, sx, sy, sz, color, isHole = false } = {}) {
    if (!DECOR[type]) return null;
    const def = DECOR[type];
    const dr = def.defaultRot || [0, 0, 0];
    const ds = def.defaultScale || [1, 1, 1];
    const inst = {
      id: _nextId++,
      type,
      x, y: y || def.defaultY || 0, z,
      rx: rx ?? dr[0], ry: ry ?? dr[1], rz: rz ?? dr[2],
      sx: sx ?? ds[0], sy: sy ?? ds[1], sz: sz ?? ds[2],
      color: color ?? def.color,
      isHole: !!isHole,
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
    }));
  }

  fromJSON(arr) {
    this.clear();
    if (!Array.isArray(arr)) return;
    for (const d of arr) {
      const [x, y, z] = d.p || [0, 0, 0];
      const [rx, ry, rz] = d.r || [0, 0, 0];
      const [sx, sy, sz] = d.s || [1, 1, 1];
      this.add({ type: d.t, x, y, z, rx, ry, rz, sx, sy, sz, color: d.c, isHole: !!d.h });
    }
  }
}

function round3(v) { return Math.round(v * 1000) / 1000; }

// ── Mesh builder ────────────────────────────────────────────────
/** Build a Three.js mesh for a decor instance and tag it for picking. */
export function buildDecorMesh(inst) {
  const def = DECOR[inst.type];
  if (!def) return null;
  const mesh = new THREE.Mesh(def.build(), getDecorMaterial(inst.color, inst.isHole));
  mesh.position.set(inst.x, inst.y, inst.z);
  mesh.rotation.set(inst.rx, inst.ry, inst.rz);
  mesh.scale.set(inst.sx, inst.sy, inst.sz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.decorId = inst.id;
  return mesh;
}

/** Sync an existing mesh to the latest instance values. */
export function syncDecorMesh(mesh, inst) {
  mesh.position.set(inst.x, inst.y, inst.z);
  mesh.rotation.set(inst.rx, inst.ry, inst.rz);
  mesh.scale.set(inst.sx, inst.sy, inst.sz);
  mesh.material = getDecorMaterial(inst.color, inst.isHole);
}
