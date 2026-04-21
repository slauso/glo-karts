/**
 * asset-loader.js — GLB-based track tile loader for TinkerTracks builder.
 *
 * Loads GLB models exclusively from the SKR (mrdoob/Starter-Kit-Racing) set
 * and creates warped variants via vertex displacement on cloned geometry.
 *
 * Warp approach:
 *   1. Load a base SKR GLB (track-straight, track-corner, etc.)
 *   2. Clone its BufferGeometry
 *   3. Apply a vertex-level transform (stretch, ramp, hill, S-curve, bank)
 *   4. Recompute normals → new piece with same texture/quality
 *
 * Every model is auto-scaled and centered to fill GRID_SIZE × GRID_SIZE cells.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GRID_SIZE } from '../modules/track-placement.js';

const gltfLoader = new GLTFLoader();
const templateCache = new Map();
const metaCache = new Map();
let thumbnailRenderer = null;
let thumbnailQueue = Promise.resolve();

const thumbnailScene = new THREE.Scene();
thumbnailScene.background = new THREE.Color(0x182334);
thumbnailScene.add(new THREE.AmbientLight(0xffffff, 1.1));

const thumbnailLight = new THREE.DirectionalLight(0xffffff, 1.4);
thumbnailLight.position.set(5, 8, 6);
thumbnailScene.add(thumbnailLight);

const thumbnailCamera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);

/* ── Mesh-warp functions ─────────────────────────────────────── *
 * Each function takes a THREE.BufferGeometry and modifies vertex
 * positions in-place. UVs are left unchanged — the colormap palette
 * texture maps to flat color regions, so vertex-only warps look clean.
 */

function warpStretchZ(geo, factor) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setZ(i, pos.getZ(i) * factor);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
}

function warpRamp(geo, maxHeight, direction) {
  const pos = geo.attributes.position;
  geo.computeBoundingBox();
  const minZ = geo.boundingBox.min.z;
  const range = (geo.boundingBox.max.z - minZ) || 1;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getZ(i) - minZ) / range;
    const lift = direction > 0 ? t : (1 - t);
    pos.setY(i, pos.getY(i) + maxHeight * lift);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
}

function warpHill(geo, height) {
  const pos = geo.attributes.position;
  geo.computeBoundingBox();
  const minZ = geo.boundingBox.min.z;
  const range = (geo.boundingBox.max.z - minZ) || 1;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getZ(i) - minZ) / range;
    pos.setY(i, pos.getY(i) + height * Math.sin(Math.PI * t));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
}

function warpSCurve(geo, amplitude) {
  const pos = geo.attributes.position;
  geo.computeBoundingBox();
  const minZ = geo.boundingBox.min.z;
  const range = (geo.boundingBox.max.z - minZ) || 1;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getZ(i) - minZ) / range;
    pos.setX(i, pos.getX(i) + amplitude * Math.sin(2 * Math.PI * t));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
}

function warpBank(geo, height, side) {
  const pos = geo.attributes.position;
  geo.computeBoundingBox();
  const minX = geo.boundingBox.min.x;
  const range = (geo.boundingBox.max.x - minX) || 1;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getX(i) - minX) / range;
    const lift = side > 0 ? t : (1 - t);
    pos.setY(i, pos.getY(i) + height * lift);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
}

function warpElevate(geo, height) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, pos.getY(i) + height);
  }
  pos.needsUpdate = true;
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
}

function warpBridgeRamp(geo, height, direction) {
  const pos = geo.attributes.position;
  geo.computeBoundingBox();
  const minZ = geo.boundingBox.min.z;
  const range = (geo.boundingBox.max.z - minZ) || 1;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getZ(i) - minZ) / range;
    const eased = direction > 0
      ? Math.sin(t * Math.PI * 0.5)
      : 1 - Math.sin((1 - t) * Math.PI * 0.5);
    pos.setY(i, pos.getY(i) + height * eased);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
}

const BRIDGE_HEIGHT = 5.0;
/* ── Pittsburgh-themed bridge definitions ──────────────────────── *
 * span:  grid cells (1–6) loosely proportional to real-life total span
 * colors: { steel, deck, accent, cable } — up to 4 per bridge, IRL-matched
 */
const PGH_ELEV = GRID_SIZE * 0.35;

const PGH_BRIDGE_DEFS = {
  // Three Sisters — iconic Aztec Gold self-anchored suspension (~884 ft each)
  'pgh-clemente':      { type: 'suspension',  label: 'Roberto Clemente Br.', span: 2,
    colors: { steel: 0xC39953, deck: 0x505558, accent: 0xE8DCC0, cable: 0x333333 } },
  'pgh-warhol':        { type: 'suspension',  label: 'Andy Warhol Br.',      span: 2,
    colors: { steel: 0xC39953, deck: 0x505558, accent: 0xE8DCC0, cable: 0x333333 } },
  'pgh-carson':        { type: 'suspension',  label: 'Rachel Carson Br.',    span: 2,
    colors: { steel: 0xC39953, deck: 0x505558, accent: 0xE8DCC0, cable: 0x333333 } },
  // Fort Pitt — green bowstring tied-arch (~1,224 ft)
  'pgh-fort-pitt':     { type: 'bowstring',   label: 'Fort Pitt Br.',        span: 3,
    colors: { steel: 0x2D5A27, deck: 0x707070, accent: 0xC0C0C0, cable: 0xE0E0E0 } },
  // Fort Duquesne — rust-orange bowstring (~1,044 ft)
  'pgh-fort-duquesne': { type: 'bowstring',   label: 'Fort Duquesne Br.',    span: 3,
    colors: { steel: 0xB05A30, deck: 0x909090, accent: 0x5C3A1E, cable: 0x6B6B6B } },
  // West End — yellow tied-arch (~837 ft)
  'pgh-west-end':      { type: 'tied-arch',   label: 'West End Br.',         span: 2,
    colors: { steel: 0xC39953, deck: 0x707070, accent: 0xE8DCC8, cable: 0x404040 } },
  // Veterans — grey steel tied-arch (~1,430 ft)
  'pgh-veterans':      { type: 'tied-arch',   label: 'Veterans Br.',         span: 4,
    colors: { steel: 0x808890, deck: 0x606868, accent: 0xB0B8C0, cable: 0x505558 } },
  // 16th Street — cream/tan ornamental tied-arch (~1,478 ft)
  'pgh-16th-st':       { type: 'tied-arch',   label: '16th Street Br.',      span: 4,
    colors: { steel: 0xE8DCC0, deck: 0xA09888, accent: 0x7A8C70, cable: 0x3A3A3A } },
  // South 10th — blue-grey tied-arch (~1,370 ft)
  'pgh-south-10th':    { type: 'tied-arch',   label: 'South 10th St Br.',    span: 3,
    colors: { steel: 0x607080, deck: 0x808890, accent: 0xB0B8C0, cable: 0x354050 } },
  // 31st Street — green tied-arch (~1,651 ft)
  'pgh-31st-st':       { type: 'tied-arch',   label: '31st Street Br.',      span: 4,
    colors: { steel: 0x3A6B35, deck: 0x707070, accent: 0xD4B84A, cable: 0x1E4A1A } },
  // McKees Rocks — green with yellow trim (~1,818 ft)
  'pgh-mckees-rocks':  { type: 'tied-arch',   label: 'McKees Rocks Br.',     span: 5,
    colors: { steel: 0x2D6B2A, deck: 0x707070, accent: 0xD4B84A, cable: 0x1A4A18 } },
  // Smithfield Street — rust-brown lenticular truss (~1,183 ft)
  'pgh-smithfield':    { type: 'lenticular',  label: 'Smithfield St Br.',    span: 3,
    colors: { steel: 0x8B4513, deck: 0x555555, accent: 0xE8DCC0, cable: 0x6B2020 } },
  // Liberty — bright yellow cantilever (~2,601 ft)
  'pgh-liberty':       { type: 'cantilever',  label: 'Liberty Br.',          span: 6,
    colors: { steel: 0xD4AA30, deck: 0x707070, accent: 0xC39953, cable: 0x404040 } },
  // 62nd Street — dark green cantilever (~675 ft)
  'pgh-62nd-st':       { type: 'cantilever',  label: '62nd Street Br.',      span: 1,
    colors: { steel: 0x1E5A1E, deck: 0x606060, accent: 0x2D6B27, cable: 0x2A2A2A } },
  // Birmingham — white/light-grey cable-stayed girder (~1,893 ft)
  'pgh-birmingham':    { type: 'girder',      label: 'Birmingham Br.',       span: 5,
    colors: { steel: 0xE0E0E0, deck: 0x707888, accent: 0x90A8C0, cable: 0x404448 } },
  // 40th Street — silver plate girder (~1,540 ft)
  'pgh-40th-st':       { type: 'girder',      label: '40th Street Br.',      span: 4,
    colors: { steel: 0xA0A8B0, deck: 0x707878, accent: 0xE0E0E0, cable: 0x4A4E50 } },
  // Hot Metal — rust-red Warren truss (~1,510 ft)
  'pgh-hot-metal':     { type: 'truss',       label: 'Hot Metal Br.',        span: 4,
    colors: { steel: 0xA04020, deck: 0x505050, accent: 0xC06030, cable: 0x5A2A10 } },
  // Glenwood — green truss (~1,300 ft)
  'pgh-glenwood':      { type: 'truss',       label: 'Glenwood Br.',         span: 3,
    colors: { steel: 0x3A7035, deck: 0x707070, accent: 0xD8D0C0, cable: 0x1E4A1A } },
  // Highland Park — yellow steel arch (~1,210 ft)
  'pgh-highland-park': { type: 'steel-arch',  label: 'Highland Park Br.',    span: 3,
    colors: { steel: 0xD4AA30, deck: 0x707070, accent: 0xE8DCC0, cable: 0x404040 } },
  // Homestead Grays — blue-grey steel arch (~1,277 ft)
  'pgh-homestead':     { type: 'steel-arch',  label: 'Homestead Grays Br.',  span: 3,
    colors: { steel: 0x607888, deck: 0x707880, accent: 0xA8B0B8, cable: 0x354050 } },
};
/* ── Asset registry ──────────────────────────────────────────── *
 * category:
 *   'road-core'   — auto-tile candidates (straight, corner)
 *   'road-extra'  — manually-placed specialty pieces
 *   'decoration'  — scenery objects
 *
 * base + warp:
 *   If present, the piece is created by loading the `base` key's GLB,
 *   cloning its geometry, then applying the `warp` function to each mesh.
 *   `span` defines multi-cell footprint {x, z} in grid cells (default 1×1).
 */
export const TRACK_ASSETS = [
  // ── SKR core tiles (10×10, auto-tileable) ──────────────────
  { key: 'skr-straight', file: 'skr/track-straight.glb', label: 'Straight',   category: 'road-core' },
  { key: 'skr-corner',   file: 'skr/track-corner.glb',   label: 'Corner',     category: 'road-core' },

  // ── SKR base tiles (manual placement) ──────────────────────
  { key: 'skr-finish',   file: 'skr/track-finish.glb',   label: 'Finish Line', category: 'road-extra' },
  { key: 'skr-bump',     file: 'skr/track-bump.glb',     label: 'Speed Bump',  category: 'road-extra' },

  // ── Stretched straights (multi-cell) ───────────────────────
  { key: 'straight-2x', label: 'Straight 2×', category: 'road-extra', base: 'skr-straight', span: { x: 1, z: 2 }, warp: (g) => warpStretchZ(g, 2) },
  { key: 'straight-3x', label: 'Straight 3×', category: 'road-extra', base: 'skr-straight', span: { x: 1, z: 3 }, warp: (g) => warpStretchZ(g, 3) },
  { key: 'straight-4x', label: 'Straight 4×', category: 'road-extra', base: 'skr-straight', span: { x: 1, z: 4 }, warp: (g) => warpStretchZ(g, 4) },

  // ── Elevation warps (single-cell, from straight) ───────────
  { key: 'ramp-up',      label: 'Ramp Up',      category: 'road-extra', base: 'skr-straight', warp: (g) => warpRamp(g, 2.5, 1) },
  { key: 'ramp-down',    label: 'Ramp Down',    category: 'road-extra', base: 'skr-straight', warp: (g) => warpRamp(g, 2.5, -1) },
  { key: 'jump-ramp',    label: 'Jump Ramp',    category: 'road-extra', base: 'skr-straight', warp: (g) => warpRamp(g, 4.0, 1) },
  { key: 'landing-ramp', label: 'Landing',       category: 'road-extra', base: 'skr-straight', warp: (g) => warpRamp(g, 4.0, -1) },
  { key: 'hill',         label: 'Hill',          category: 'road-extra', base: 'skr-straight', warp: (g) => warpHill(g, 2.5) },
  { key: 'dip',          label: 'Dip',           category: 'road-extra', base: 'skr-straight', warp: (g) => warpHill(g, -1.5) },

  // ── Lateral warps (single-cell, from straight) ─────────────
  { key: 's-curve',      label: 'S-Curve',       category: 'road-extra', base: 'skr-straight', warp: (g) => warpSCurve(g, 1.5) },
  { key: 'bank-left',    label: 'Bank Left',     category: 'road-extra', base: 'skr-straight', warp: (g) => warpBank(g, 1.5, -1) },
  { key: 'bank-right',   label: 'Bank Right',    category: 'road-extra', base: 'skr-straight', warp: (g) => warpBank(g, 1.5, 1) },

  // ── Multi-cell curve warps ─────────────────────────────────
  { key: 'gentle-s', label: 'Gentle S-Curve', category: 'road-extra', base: 'skr-straight', span: { x: 1, z: 3 },
    warp: (g) => { warpStretchZ(g, 3); warpSCurve(g, 2.5); } },

  // ── Bridge on/off ramps (2-cell span for gradual approach) ──
  { key: 'bridge-ramp-up',   label: 'Bridge On-Ramp',  category: 'road-extra', base: 'skr-straight', span: { x: 1, z: 2 },
    warp: (g) => { warpStretchZ(g, 2); warpBridgeRamp(g, BRIDGE_HEIGHT, 1); } },
  { key: 'bridge-ramp-down', label: 'Bridge Off-Ramp', category: 'road-extra', base: 'skr-straight', span: { x: 1, z: 2 },
    warp: (g) => { warpStretchZ(g, 2); warpBridgeRamp(g, BRIDGE_HEIGHT, -1); } },

  // ── Suspended bridge decks (elevated flat) ─────────────────
  { key: 'bridge-1x', label: 'Bridge 1×', category: 'road-extra', base: 'skr-straight',
    warp: (g) => warpElevate(g, BRIDGE_HEIGHT) },
  { key: 'bridge-2x', label: 'Bridge 2×', category: 'road-extra', base: 'skr-straight', span: { x: 1, z: 2 },
    warp: (g) => { warpStretchZ(g, 2); warpElevate(g, BRIDGE_HEIGHT); } },
  { key: 'bridge-3x', label: 'Bridge 3×', category: 'road-extra', base: 'skr-straight', span: { x: 1, z: 3 },
    warp: (g) => { warpStretchZ(g, 3); warpElevate(g, BRIDGE_HEIGHT); } },
  { key: 'bridge-4x', label: 'Bridge 4×', category: 'road-extra', base: 'skr-straight', span: { x: 1, z: 4 },
    warp: (g) => { warpStretchZ(g, 4); warpElevate(g, BRIDGE_HEIGHT); } },

  // ── Junctions (procedural geometry) ─────────────────────────
  { key: 'crossover',  label: 'Crossover',  category: 'road-extra', build: true },
  { key: 't-junction', label: 'T-Junction', category: 'road-extra', build: true },
  // ── Pittsburgh-themed bridge decks (procedural superstructure) ──
  { key: 'pgh-clemente',      label: 'Roberto Clemente Br.',  category: 'pgh-bridge', build: true, span: { x: 1, z: 2 } },
  { key: 'pgh-warhol',        label: 'Andy Warhol Br.',       category: 'pgh-bridge', build: true, span: { x: 1, z: 2 } },
  { key: 'pgh-carson',        label: 'Rachel Carson Br.',     category: 'pgh-bridge', build: true, span: { x: 1, z: 2 } },
  { key: 'pgh-fort-pitt',     label: 'Fort Pitt Br.',         category: 'pgh-bridge', build: true, span: { x: 1, z: 3 } },
  { key: 'pgh-fort-duquesne', label: 'Fort Duquesne Br.',     category: 'pgh-bridge', build: true, span: { x: 1, z: 3 } },
  { key: 'pgh-west-end',      label: 'West End Br.',          category: 'pgh-bridge', build: true, span: { x: 1, z: 2 } },
  { key: 'pgh-veterans',      label: 'Veterans Br.',          category: 'pgh-bridge', build: true, span: { x: 1, z: 4 } },
  { key: 'pgh-16th-st',       label: '16th Street Br.',       category: 'pgh-bridge', build: true, span: { x: 1, z: 4 } },
  { key: 'pgh-south-10th',    label: 'South 10th St Br.',     category: 'pgh-bridge', build: true, span: { x: 1, z: 3 } },
  { key: 'pgh-31st-st',       label: '31st Street Br.',       category: 'pgh-bridge', build: true, span: { x: 1, z: 4 } },
  { key: 'pgh-mckees-rocks',  label: 'McKees Rocks Br.',      category: 'pgh-bridge', build: true, span: { x: 1, z: 5 } },
  { key: 'pgh-smithfield',    label: 'Smithfield St Br.',     category: 'pgh-bridge', build: true, span: { x: 1, z: 3 } },
  { key: 'pgh-liberty',       label: 'Liberty Br.',           category: 'pgh-bridge', build: true, span: { x: 1, z: 6 } },
  { key: 'pgh-62nd-st',       label: '62nd Street Br.',       category: 'pgh-bridge', build: true },
  { key: 'pgh-birmingham',    label: 'Birmingham Br.',        category: 'pgh-bridge', build: true, span: { x: 1, z: 5 } },
  { key: 'pgh-40th-st',       label: '40th Street Br.',       category: 'pgh-bridge', build: true, span: { x: 1, z: 4 } },
  { key: 'pgh-hot-metal',     label: 'Hot Metal Br.',         category: 'pgh-bridge', build: true, span: { x: 1, z: 4 } },
  { key: 'pgh-glenwood',      label: 'Glenwood Br.',          category: 'pgh-bridge', build: true, span: { x: 1, z: 3 } },
  { key: 'pgh-highland-park', label: 'Highland Park Br.',     category: 'pgh-bridge', build: true, span: { x: 1, z: 3 } },
  { key: 'pgh-homestead',     label: 'Homestead Grays Br.',   category: 'pgh-bridge', build: true, span: { x: 1, z: 3 } },
  // ── SKR decorations ─────────────────────────────────────────
  { key: 'skr-deco-empty',   file: 'skr/decoration-empty.glb',   label: 'Grass Patch',  category: 'decoration' },
  { key: 'skr-deco-forest',  file: 'skr/decoration-forest.glb',  label: 'Forest',       category: 'decoration' },
  { key: 'skr-deco-tents',   file: 'skr/decoration-tents.glb',   label: 'Tents',        category: 'decoration' },
  { key: 'skr-track-tents',  file: 'skr/track-tents.glb',        label: 'Track Tents',  category: 'decoration' },
];

/* ── Derived lookups ─────────────────────────────────────────── */

const ASSET_BY_KEY = new Map(TRACK_ASSETS.map(a => [a.key, a]));

/** Assets suitable for auto-tiling (road painting). */
export const ROAD_CORE_ASSETS = TRACK_ASSETS.filter(a => a.category === 'road-core');

/** Assets for manual placement panels. */
export const ROAD_EXTRA_ASSETS = TRACK_ASSETS.filter(a => a.category === 'road-extra');

/** Decoration assets for environment scenery. */
export const DECORATION_ASSETS = TRACK_ASSETS.filter(a => a.category === 'decoration');

function getThumbnailRenderer() {
  if (!thumbnailRenderer) {
    thumbnailRenderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
  }
  return thumbnailRenderer;
}

/* ── GLB loading ─────────────────────────────────────────────── */

function loadGLB(url) {
  return new Promise((resolve, reject) => {
    gltfLoader.load(url, (gltf) => resolve(gltf), undefined, reject);
  });
}

/**
 * Load a base GLB and prepare it as a grid-ready template.
 * Auto-scales to fit GRID_SIZE × GRID_SIZE and centers at origin.
 */
async function loadBaseGLB(fileUrl) {
  const gltf = await loadGLB(fileUrl);
  const root = new THREE.Group();

  while (gltf.scene.children.length > 0) {
    root.add(gltf.scene.children[0]);
  }

  root.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  // ── Auto-scale + center to fit one grid cell ──────────────
  const bbox = new THREE.Box3().setFromObject(root);
  const size = bbox.getSize(new THREE.Vector3());
  const center = bbox.getCenter(new THREE.Vector3());

  const rawXZ = Math.max(size.x, size.z) || 1;
  const scale = GRID_SIZE / rawXZ;

  if (Math.abs(scale - 1) > 0.05) {
    root.scale.setScalar(scale);
    bbox.setFromObject(root);
    bbox.getCenter(center);
  }

  root.position.set(-center.x, -bbox.min.y, -center.z);

  const wrapper = new THREE.Group();
  wrapper.add(root);
  return wrapper;
}

/**
 * Apply a warp function to every mesh geometry in a model.
 * Clones each geometry so the base template is never mutated.
 * For multi-cell pieces (span.z > 1), the model is offset so the anchor
 * cell is at the origin and additional cells extend in local +Z.
 */
function applyWarp(model, warpFn, span) {
  model.traverse((child) => {
    if (!child.isMesh) return;
    child.geometry = child.geometry.clone();
    warpFn(child.geometry);
  });

  // Re-center after warp.
  // Y is left as-is so elevated pieces (bridges) stay at their warped height.
  const bbox = new THREE.Box3().setFromObject(model);
  const center = bbox.getCenter(new THREE.Vector3());
  const innerRoot = model.children[0];
  if (innerRoot) {
    innerRoot.position.x -= center.x;

    const spanZ = span?.z ?? 1;
    if (spanZ > 1) {
      // Anchor-align: position so first cell center is at Z=0,
      // model extends in +Z for additional cells.
      innerRoot.position.z -= (bbox.min.z + GRID_SIZE / 2);
    } else {
      innerRoot.position.z -= center.z;
    }
  }
}

/**
 * Build a procedural junction template (crossover / T-junction).
 * Uses simple geometry matching the SKR visual style.
 */
function buildJunctionTemplate(key) {
  const group = new THREE.Group();
  group.name = key;

  const DECK_H = 0.75;
  const HALF = GRID_SIZE * 0.475;
  const ROAD_W = GRID_SIZE * 0.7;  // road surface width
  const BARRIER_H = 0.5;
  const BARRIER_W = 0.35;

  const roadMat = new THREE.MeshStandardMaterial({ color: 0x536074, roughness: 0.9, metalness: 0.05 });
  const curb1Mat = new THREE.MeshStandardMaterial({ color: 0xcc3333, roughness: 0.7 });
  const curb2Mat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.7 });
  const barrierMat = new THREE.MeshStandardMaterial({ color: 0x444c58, roughness: 0.85 });
  const markMat = new THREE.MeshStandardMaterial({ color: 0xdddd44, roughness: 0.5 });

  // Road platform
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(GRID_SIZE * 0.95, DECK_H, GRID_SIZE * 0.95), roadMat,
  );
  deck.position.y = DECK_H / 2;
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);

  // Center road markings (cross pattern)
  const centerLine1 = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.02, GRID_SIZE * 0.85), markMat,
  );
  centerLine1.position.y = DECK_H + 0.01;
  group.add(centerLine1);

  const centerLine2 = new THREE.Mesh(
    new THREE.BoxGeometry(GRID_SIZE * 0.85, 0.02, 0.2), markMat,
  );
  centerLine2.position.y = DECK_H + 0.01;
  group.add(centerLine2);

  // Red/white curb strips on open port edges
  const openN = true, openE = true, openW = (key === 'crossover');
  const openS = true;

  function addCurbStrip(x, z, sizeX, sizeZ) {
    const g1 = new THREE.Mesh(new THREE.BoxGeometry(sizeX, 0.06, sizeZ), curb1Mat);
    g1.position.set(x, DECK_H + 0.01, z);
    group.add(g1);
  }

  // Barriers on closed edges only
  function addBarrier(x, z, sizeX, sizeZ) {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(sizeX, BARRIER_H, sizeZ), barrierMat,
    );
    bar.position.set(x, DECK_H + BARRIER_H / 2, z);
    bar.castShadow = true;
    group.add(bar);
  }

  if (key === 't-junction') {
    // W side is closed — add barrier
    addBarrier(-HALF, 0, BARRIER_W, GRID_SIZE * 0.95);
  }

  // Curb strips on all open edges
  if (openN) addCurbStrip(0, -HALF + 0.15, GRID_SIZE * 0.3, 0.3);
  if (openS) addCurbStrip(0, HALF - 0.15, GRID_SIZE * 0.3, 0.3);
  if (openE) addCurbStrip(HALF - 0.15, 0, 0.3, GRID_SIZE * 0.3);
  if (openW) addCurbStrip(-HALF + 0.15, 0, 0.3, GRID_SIZE * 0.3);

  return group;
}

/**
 * Load or create a template for the given asset key.
 *
 * - Direct GLB pieces (have `file`): load from /models/<file>
 * - Warped variants (have `base` + `warp`): clone base template, apply warp
 * - Procedural pieces (have `build`): generate geometry
 */
async function loadTemplate(key) {
  const asset = ASSET_BY_KEY.get(key);
  if (!asset) throw new Error(`Unknown asset: ${key}`);

  // ── Procedurally-built piece (junctions, bridges, etc.) ──────
  if (asset.build) {
    const model = asset.category === 'pgh-bridge'
      ? buildPghBridgeTemplate(key)
      : buildJunctionTemplate(key);
    model.name = key;
    return model;
  }

  // ── Warped variant: clone base then deform ──────────────────
  if (asset.base && asset.warp) {
    const baseTemplate = await getTemplate(asset.base);
    const clone = cloneModel(baseTemplate);
    clone.name = key;
    applyWarp(clone, asset.warp, asset.span);
    return clone;
  }

  // ── Direct GLB load ─────────────────────────────────────────
  if (!asset.file) throw new Error(`Asset '${key}' has no file, warp, or build`);

  const url = `/models/${asset.file}`;
  try {
    const template = await loadBaseGLB(url);
    template.name = key;
    return template;
  } catch (err) {
    console.warn(`[asset-loader] GLB load failed for '${key}' (${url}), using fallback`, err);
    return buildFallbackTemplate(key);
  }
}

function buildFallbackTemplate(key) {
  const group = new THREE.Group();
  group.name = key;

  const isCorner = key.includes('corner') || key === 'curve';
  const isWide = key === 'wide' || key === 'skr-deco-empty';
  const color = isCorner ? 0x687488 : isWide ? 0x5e697c : 0x536074;

  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(GRID_SIZE * 0.95, 0.34, GRID_SIZE * 0.95),
    new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0.04 }),
  );
  deck.position.y = 0.17;
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);

  return group;
}

/**
 * Build a procedural Pittsburgh-themed bridge template.
 * Each bridge type gets a unique superstructure above an elevated deck.
 * Deck length and materials are derived from PGH_BRIDGE_DEFS (span + colors).
 */
function buildPghBridgeTemplate(key) {
  const def = PGH_BRIDGE_DEFS[key];
  if (!def) return buildFallbackTemplate(key);

  const group = new THREE.Group();
  group.name = key;

  const spanZ = def.span || 1;
  const LENGTH = GRID_SIZE * spanZ;    // total Z length
  const HALF_L = LENGTH / 2;
  const DECK_W = GRID_SIZE * 0.7;
  const DECK_T = 0.5;
  const RAIL_H = 0.6;
  const RAIL_W = 0.15;

  const c = def.colors;
  const steelMat = new THREE.MeshStandardMaterial({ color: c.steel, roughness: 0.55, metalness: 0.35 });
  const deckMat  = new THREE.MeshStandardMaterial({ color: c.deck,  roughness: 0.9,  metalness: 0.05 });
  const accentMat = new THREE.MeshStandardMaterial({ color: c.accent, roughness: 0.65, metalness: 0.2 });
  const cableMat = new THREE.MeshStandardMaterial({ color: c.cable, roughness: 0.6,  metalness: 0.4 });

  // ─ Elevated road deck (spans full length) ─
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(DECK_W, DECK_T, LENGTH * 0.95),
    deckMat,
  );
  deck.position.y = PGH_ELEV;
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);

  // ─ Center road stripe ─
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.02, LENGTH * 0.85),
    accentMat,
  );
  stripe.position.y = PGH_ELEV + DECK_T / 2 + 0.01;
  group.add(stripe);

  // ─ Side rails (full length) ─
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(RAIL_W, RAIL_H, LENGTH * 0.95),
      steelMat,
    );
    rail.position.set(side * (DECK_W / 2 + RAIL_W / 2), PGH_ELEV + DECK_T / 2 + RAIL_H / 2, 0);
    rail.castShadow = true;
    group.add(rail);
  }

  // ─ Type-specific superstructure ─
  const superTop = PGH_ELEV + DECK_T / 2;

  switch (def.type) {

    case 'suspension': {
      const towerH = 6;
      const towerW = 0.4;
      // Place towers at ~quarter points along the span
      const towerSpacing = LENGTH * 0.35;
      for (const side of [-1, 1]) {
        for (const zPos of [-towerSpacing, towerSpacing]) {
          const tower = new THREE.Mesh(
            new THREE.BoxGeometry(towerW, towerH, towerW),
            steelMat,
          );
          tower.position.set(side * (DECK_W / 2), superTop + towerH / 2, zPos);
          tower.castShadow = true;
          group.add(tower);
        }
        // Main cable
        const cablePts = [];
        const SEGS = Math.max(16, spanZ * 8);
        for (let i = 0; i <= SEGS; i++) {
          const t = i / SEGS;
          const z = (t - 0.5) * LENGTH * 0.9;
          const sag = 1 - 4 * (t - 0.5) * (t - 0.5);
          const y = superTop + towerH - sag * (towerH * 0.6);
          cablePts.push(new THREE.Vector3(side * (DECK_W / 2), y, z));
        }
        const cableCurve = new THREE.CatmullRomCurve3(cablePts);
        const cableGeo = new THREE.TubeGeometry(cableCurve, SEGS + 4, 0.06, 6, false);
        group.add(new THREE.Mesh(cableGeo, cableMat));
        // Suspenders
        for (let i = 1; i < SEGS; i += 2) {
          const pt = cablePts[i];
          const hLen = pt.y - superTop;
          if (hLen < 0.2) continue;
          const hang = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, hLen, 4), cableMat);
          hang.position.set(pt.x, superTop + hLen / 2, pt.z);
          group.add(hang);
        }
      }
      break;
    }

    case 'bowstring': {
      const archH = 4.5;
      for (const side of [-1, 1]) {
        const archPts = [];
        const SEGS = Math.max(20, spanZ * 8);
        for (let i = 0; i <= SEGS; i++) {
          const t = i / SEGS;
          const z = (t - 0.5) * LENGTH * 0.9;
          const y = superTop + archH * 4 * t * (1 - t);
          archPts.push(new THREE.Vector3(side * (DECK_W / 2 + 0.15), y, z));
        }
        const archCurve = new THREE.CatmullRomCurve3(archPts);
        const archGeo = new THREE.TubeGeometry(archCurve, SEGS + 4, 0.18, 6, false);
        group.add(new THREE.Mesh(archGeo, steelMat));
        for (let i = 2; i < SEGS; i += 3) {
          const pt = archPts[i];
          const hLen = pt.y - superTop;
          if (hLen < 0.3) continue;
          const hang = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, hLen, 4), accentMat);
          hang.position.set(pt.x, superTop + hLen / 2, pt.z);
          group.add(hang);
        }
      }
      break;
    }

    case 'tied-arch': {
      const archH = 5;
      for (const side of [-1, 1]) {
        const archPts = [];
        const SEGS = Math.max(20, spanZ * 8);
        for (let i = 0; i <= SEGS; i++) {
          const t = i / SEGS;
          const z = (t - 0.5) * LENGTH * 0.9;
          const y = superTop + archH * Math.sin(t * Math.PI);
          archPts.push(new THREE.Vector3(side * (DECK_W / 2), y, z));
        }
        const archCurve = new THREE.CatmullRomCurve3(archPts);
        const archGeo = new THREE.TubeGeometry(archCurve, SEGS + 4, 0.15, 6, false);
        group.add(new THREE.Mesh(archGeo, steelMat));
        for (let i = 2; i <= SEGS - 2; i += 2) {
          const pt = archPts[i];
          const hLen = pt.y - superTop;
          if (hLen < 0.3) continue;
          const hang = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, hLen, 4), cableMat);
          hang.position.set(pt.x, superTop + hLen / 2, pt.z);
          group.add(hang);
        }
      }
      break;
    }

    case 'lenticular': {
      const lensH = 3;
      for (const side of [-1, 1]) {
        const topPts = [];
        const SEGS = Math.max(16, spanZ * 6);
        for (let i = 0; i <= SEGS; i++) {
          const t = i / SEGS;
          const z = (t - 0.5) * LENGTH * 0.9;
          const y = superTop + RAIL_H + lensH * Math.sin(t * Math.PI);
          topPts.push(new THREE.Vector3(side * (DECK_W / 2 + 0.1), y, z));
        }
        const topCurve = new THREE.CatmullRomCurve3(topPts);
        group.add(new THREE.Mesh(new THREE.TubeGeometry(topCurve, SEGS + 4, 0.12, 6, false), steelMat));
        const botY = superTop + RAIL_H + 0.1;
        const bot = new THREE.Mesh(
          new THREE.CylinderGeometry(0.1, 0.1, LENGTH * 0.88, 6), accentMat,
        );
        bot.rotation.x = Math.PI / 2;
        bot.position.set(side * (DECK_W / 2 + 0.1), botY, 0);
        group.add(bot);
        for (let i = 2; i <= SEGS - 2; i += 2) {
          const pt = topPts[i];
          const vLen = pt.y - botY;
          if (vLen < 0.2) continue;
          const vert = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, vLen, 4), cableMat);
          vert.position.set(pt.x, botY + vLen / 2, pt.z);
          group.add(vert);
        }
      }
      break;
    }

    case 'cantilever': {
      const pierH = 5;
      const armLen = LENGTH * 0.3;
      // Place piers evenly along the span
      const pierCount = Math.max(1, Math.ceil(spanZ / 2));
      const pierStep = LENGTH / (pierCount + 1);
      for (let p = 0; p < pierCount; p++) {
        const pz = -HALF_L + pierStep * (p + 1);
        for (const side of [-1, 1]) {
          const pier = new THREE.Mesh(new THREE.BoxGeometry(0.5, pierH, 0.5), steelMat);
          pier.position.set(side * (DECK_W / 2 + 0.2), superTop + pierH / 2, pz);
          pier.castShadow = true;
          group.add(pier);
          for (const zDir of [-1, 1]) {
            const sLen = Math.sqrt(pierH * pierH + (armLen * 0.4) ** 2);
            const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, sLen, 6), accentMat);
            const angle = Math.atan2(pierH, armLen * 0.4);
            strut.rotation.x = zDir * (Math.PI / 2 - angle);
            strut.position.set(side * (DECK_W / 2 + 0.2), superTop + pierH * 0.5, pz + zDir * armLen * 0.2);
            strut.castShadow = true;
            group.add(strut);
          }
        }
        // Top chord segment at each pier
        const topChord = new THREE.Mesh(new THREE.BoxGeometry(DECK_W + 0.8, 0.3, 0.3), steelMat);
        topChord.position.set(0, superTop + pierH, pz);
        topChord.castShadow = true;
        group.add(topChord);
      }
      // Longitudinal top chord connecting piers
      const longChord = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.2, LENGTH * 0.9), cableMat,
      );
      longChord.position.y = superTop + pierH;
      group.add(longChord);
      break;
    }

    case 'girder': {
      const girderH = 1.8;
      for (const side of [-1, 1]) {
        const girder = new THREE.Mesh(
          new THREE.BoxGeometry(0.2, girderH, LENGTH * 0.92), steelMat,
        );
        girder.position.set(side * (DECK_W / 2 + 0.1), superTop + girderH / 2, 0);
        girder.castShadow = true;
        group.add(girder);
        // Stiffener ribs scaled to span
        const ribStep = LENGTH / (Math.max(4, spanZ * 3));
        for (let r = 0; r < spanZ * 3; r++) {
          const z = -HALF_L * 0.85 + r * ribStep;
          const rib = new THREE.Mesh(new THREE.BoxGeometry(0.08, girderH * 0.9, 0.08), accentMat);
          rib.position.set(side * (DECK_W / 2 + 0.2), superTop + girderH / 2, z);
          group.add(rib);
        }
      }
      break;
    }

    case 'truss': {
      const trussH = 2.5;
      for (const side of [-1, 1]) {
        const topChord = new THREE.Mesh(
          new THREE.BoxGeometry(0.15, 0.15, LENGTH * 0.9), steelMat,
        );
        topChord.position.set(side * (DECK_W / 2 + 0.1), superTop + trussH, 0);
        group.add(topChord);
        const botChord = new THREE.Mesh(
          new THREE.BoxGeometry(0.15, 0.15, LENGTH * 0.9), accentMat,
        );
        botChord.position.set(side * (DECK_W / 2 + 0.1), superTop + 0.15, 0);
        group.add(botChord);
        // Warren diagonals scaled to span
        const panelCount = Math.max(6, spanZ * 4);
        const panelLen = (LENGTH * 0.9) / panelCount;
        const diagLen = Math.sqrt(trussH * trussH + panelLen * panelLen);
        for (let p = 0; p < panelCount; p++) {
          const zBase = -LENGTH * 0.45 + p * panelLen;
          const goUp = (p % 2 === 0);
          const diag = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, diagLen, 4), steelMat);
          const angle = Math.atan2(trussH, panelLen) * (goUp ? 1 : -1);
          diag.rotation.x = Math.PI / 2;
          diag.rotation.z = angle;
          diag.position.set(side * (DECK_W / 2 + 0.1), superTop + trussH / 2, zBase + panelLen / 2);
          group.add(diag);
        }
      }
      break;
    }

    case 'steel-arch': {
      const archDepth = 3.5;
      for (const side of [-1, 1]) {
        const archPts = [];
        const SEGS = Math.max(20, spanZ * 8);
        for (let i = 0; i <= SEGS; i++) {
          const t = i / SEGS;
          const z = (t - 0.5) * LENGTH * 0.9;
          const y = PGH_ELEV - archDepth * Math.sin(t * Math.PI);
          archPts.push(new THREE.Vector3(side * (DECK_W / 2 + 0.15), y, z));
        }
        const archCurve = new THREE.CatmullRomCurve3(archPts);
        group.add(new THREE.Mesh(new THREE.TubeGeometry(archCurve, SEGS + 4, 0.16, 6, false), steelMat));
        for (let i = 2; i <= SEGS - 2; i += 3) {
          const pt = archPts[i];
          const colH = PGH_ELEV - pt.y;
          if (colH < 0.2) continue;
          const col = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, colH, 4), cableMat);
          col.position.set(pt.x, pt.y + colH / 2, pt.z);
          group.add(col);
        }
      }
      break;
    }
  }

  // ─ Anchor-align for multi-cell spans ─
  if (spanZ > 1) {
    // Shift so anchor cell (first cell) center is at Z=0,
    // additional cells extend in +Z
    // Currently geometry is centered at Z=0 across full LENGTH.
    // First cell center should be at Z=0, so shift by +(LENGTH/2 - GRID_SIZE/2)
    const shift = (LENGTH - GRID_SIZE) / 2;
    group.traverse((child) => {
      if (child !== group) child.position.z += shift;
    });
  }

  return group;
}

/* ── Template cache & clone ──────────────────────────────────── */

async function getTemplate(key) {
  if (!ASSET_BY_KEY.has(key)) throw new Error(`Unknown asset: ${key}`);

  if (!templateCache.has(key)) {
    const template = await loadTemplate(key);
    templateCache.set(key, template);
    metaCache.set(key, buildMeta(key, template));
  }
  return templateCache.get(key);
}

function cloneModel(template) {
  const clone = template.clone(true);
  clone.traverse((child) => {
    if (!child.isMesh) return;
    child.material = Array.isArray(child.material)
      ? child.material.map((m) => m.clone())
      : child.material.clone();
    child.castShadow = true;
    child.receiveShadow = true;
  });
  return clone;
}

function buildMeta(key, template) {
  const bbox = new THREE.Box3().setFromObject(template);
  const size = bbox.getSize(new THREE.Vector3());
  const center = bbox.getCenter(new THREE.Vector3());
  const asset = ASSET_BY_KEY.get(key);
  const span = asset?.span || { x: 1, z: 1 };
  return {
    size,
    center,
    min: bbox.min.clone(),
    max: bbox.max.clone(),
    scale: 1,
    width: size.x || GRID_SIZE,
    length: size.z || GRID_SIZE,
    span,
  };
}

/* ── Public API ───────────────────────────────────────────────── */

export async function loadModel(key) {
  const template = await getTemplate(key);
  return cloneModel(template);
}

export function getModelMeta(key) {
  if (metaCache.has(key)) return metaCache.get(key);
  const asset = ASSET_BY_KEY.get(key);
  const span = asset?.span || { x: 1, z: 1 };
  return {
    size: new THREE.Vector3(GRID_SIZE * span.x, 1, GRID_SIZE * span.z),
    center: new THREE.Vector3(0, 0.5, 0),
    min: new THREE.Vector3(-GRID_SIZE * span.x / 2, 0, -GRID_SIZE * span.z / 2),
    max: new THREE.Vector3(GRID_SIZE * span.x / 2, 1, GRID_SIZE * span.z / 2),
    scale: 1,
    width: GRID_SIZE * span.x,
    length: GRID_SIZE * span.z,
    span,
  };
}

export async function preloadAll(onProgress) {
  const total = TRACK_ASSETS.length;
  let loaded = 0;
  const promises = TRACK_ASSETS.map(async (asset) => {
    await getTemplate(asset.key);
    loaded += 1;
    onProgress?.(loaded, total);
  });
  await Promise.all(promises);
}

export async function generateThumbnail(key, size = 80) {
  const task = thumbnailQueue.catch(() => {}).then(async () => {
    const model = await loadModel(key);
    const renderer = getThumbnailRenderer();
    renderer.setSize(size, size, false);

    thumbnailScene.add(model);

    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const boxSize = box.getSize(new THREE.Vector3());
    model.position.sub(center);

    const maxDim = Math.max(boxSize.x, boxSize.y, boxSize.z) || 1;
    thumbnailCamera.position.set(maxDim * 0.95, maxDim * 0.75, maxDim * 1.05);
    thumbnailCamera.lookAt(0, 0, 0);
    thumbnailCamera.updateProjectionMatrix();

    renderer.render(thumbnailScene, thumbnailCamera);

    const dataUrl = renderer.domElement.toDataURL();
    thumbnailScene.remove(model);
    return dataUrl;
  });

  thumbnailQueue = task.then(() => undefined, () => undefined);
  return task;
}
