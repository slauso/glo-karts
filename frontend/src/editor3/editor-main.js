/**
 * editor-main.js — Track Studio editor app.
 *
 * Three.js scene + orbit camera + grid raycast for placement.
 * No external editor framework; tight scope, predictable behavior.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import {
  SEGMENTS,
  SEGMENT_KEYS,
  TILE as TILE_M,
  getConnectors,
  getWorldConnectors,
  rotateSide,
  rotateCell,
  oppositeSide,
  sideDelta,
} from './segments.js';
import { buildSegmentMesh } from './segment-builder.js';
import { Track, encodeTrack, decodeTrack } from './track-data.js';
import { KARTS, resolveSelectedKartId } from './kart-catalog.js';
import { preloadAllKarts, cloneKart } from './kart-loader.js';
import {
  DECOR, DECOR_KEYS, DECOR_CATEGORY_ORDER, DECOR_CATEGORY_LABELS,
  isDecorKey, DecorStore, buildDecorMesh, syncDecorMesh, getDecorMaterial,
  getParamSchema,
} from './decor.js';
import { onGlbLoaded, instanceGLB } from './glb-cache.js';
import { buildGroupMesh } from './csg.js';
import { WORLD_UNITS_PER_M, m, mm } from './units.js';

// Editor runs in world units where 1 unit = 1 mm. Segments are authored in
// metres, so convert TILE here for placement math (TILE = 12 m → 12000 mm).
const TILE = TILE_M * WORLD_UNITS_PER_M;

const STORAGE_KEY = 'gloKartsStudio.lastTrack';

// ── Scene ─────────────────────────────────────────────────────
const canvas = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
// Cap DPR at 1.5 — hi-DPI displays were eating up to 4× fillrate and
// stuttering the editor whenever the camera moved. Editor visuals don't
// need >1.5× pixel density.
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
// Tinkercad-parity flat lit look — no real-time shadows. Previously a
// 2048² PCFSoft shadow map was regenerated EVERY frame across every decor
// mesh, which was the dominant cause of camera-rotation chop on busy
// scenes. TC has no shadows; we don't either.
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
// Tinkercad parity: scene background tinted to match the workplane plate
// so the workplane reads as visually infinite at any zoom or tilt. The
// plate adds the bright cyan border + grid; outside the plate it falls
// through to this same color, so there is never a white void.
scene.background = new THREE.Color(0xdcecf2);

// Camera near must be SMALL (1 mm) — when the user zooms close to the
// workplane the camera distance from origin can drop well under 50 m, and
// a near plane bigger than that would clip the entire scene and surface as
// a "white void" obscuring the workplane. Earlier z-fighting was actually
// caused by the layered plate/grid Y offsets (already spread); near plane
// was never the cause.
const camera = new THREE.PerspectiveCamera(55, 1, mm(1), m(2000));
// Frame the workplane tight (≈3.5× TILE) so the initial view feels like
// Tinkercad's framed-on-workplane default.
camera.position.set(TILE * 3.5, TILE * 3.5, TILE * 3.5);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = TILE * 0.5;
controls.maxDistance = TILE * 20;
controls.maxPolarAngle = Math.PI * 0.45;
controls.mouseButtons = {
  LEFT: null,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: THREE.MOUSE.ROTATE,
};
controls.touches = {
  ONE: THREE.TOUCH.ROTATE,
  TWO: THREE.TOUCH.DOLLY_PAN,
};

// Lights — flat-lit Tinkercad style; sun is a directional with no shadow
// casting (renderer.shadowMap.enabled is false above) so we keep the
// directional contribution for material highlights without paying the
// per-frame shadow-map cost.
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(m(60), m(120), m(40));
sun.castShadow = false;
scene.add(sun);
scene.add(new THREE.AmbientLight(0xffffff, 0.85));
scene.add(new THREE.HemisphereLight(0xffffff, 0xe6ecf0, 0.35));

// Ground plane (raycast target for placement). Painted to match the
// workplane plate color so beyond the bordered work area there's no
// visible horizon — the cyan reads as infinite.
const groundGeo = new THREE.PlaneGeometry(m(2000), m(2000));
const groundMat = new THREE.MeshBasicMaterial({ color: 0xdcecf2 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = false;
ground.name = 'ground';
scene.add(ground);

// Tinkercad-style bounded workplane plate. Sized large enough that the
// camera can tilt to its max polar angle without ever exposing the white
// ground past the plate edge. The thin accent border still reads at the
// outer perimeter when the user zooms out.
const _plateSize = m(200);
const _plate = new THREE.Mesh(
  new THREE.PlaneGeometry(_plateSize, _plateSize),
  new THREE.MeshBasicMaterial({ color: 0xdcecf2, transparent: true, opacity: 0.95 })
);
_plate.rotation.x = -Math.PI / 2;
// Park plate slightly BELOW the workplane (y=0). Decor and road segments
// rest with their bases at y=0; previously the plate sat at y=mm(5) which
// was *inside* the road slab (deck spans 0..ROAD_THICK*1000 ≈ 500mm),
// causing the cyan workplane to slice horizontally through the tarmac
// side walls and z-fight along the entire visible surface. Moving the
// plate (and grid layers) to y<0 keeps them visible on empty workplane
// tiles but ensures any opaque object sitting on y=0 fully occludes them.
_plate.position.y = mm(-2);
_plate.name = 'workplane-plate';
scene.add(_plate);
const _plateEdge = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.PlaneGeometry(_plateSize, _plateSize)),
  new THREE.LineBasicMaterial({ color: 0x1faaf2, transparent: true, opacity: 0.7 })
);
_plateEdge.rotation.x = -Math.PI / 2;
_plateEdge.position.y = mm(-1);
scene.add(_plateEdge);

// Dual-density base-10 grid in world units (1 unit = 1 mm). Fine lines
// every 1 m, major every 10 m. Bounded to the workplane plate so the area
// outside reads as flat white (Tinkercad). Generous Y separation between
// layers prevents z-fighting/flicker when the camera moves. All grid
// layers live BELOW y=0 so they never clip the bases of placed objects.
const _gridSpan = m(200);
const _gridFineDivs = Math.max(2, Math.round(_gridSpan / m(1)));
const _gridFine = new THREE.GridHelper(_gridSpan, _gridFineDivs, 0x9fc8d8, 0x9fc8d8);
_gridFine.material.opacity = 0.32;
_gridFine.material.transparent = true;
_gridFine.material.depthWrite = false;
_gridFine.position.y = mm(-4);
scene.add(_gridFine);
const grid = new THREE.GridHelper(_gridSpan, Math.max(2, Math.round(_gridFineDivs / 10)), 0x1faaf2, 0x4cb8e8);
grid.material.opacity = 0.6;
grid.material.transparent = true;
grid.material.depthWrite = false;
grid.position.y = mm(-6);
scene.add(grid);

// ── Editor state ──────────────────────────────────────────────
const track = new Track();
const placementGroup = new THREE.Group();
scene.add(placementGroup);

// Decor (Tinkercad-style free 3D objects) lives in a parallel store.
const decor = new DecorStore();
const decorGroup = new THREE.Group();
scene.add(decorGroup);
const decorMeshById = new Map();
// CSG-merged group meshes (one per groupId). Members are hidden while their
// group has an active CSG mesh; the merged mesh is what's drawn + picked.
const csgGroup = new THREE.Group();
scene.add(csgGroup);
const csgMeshByGid = new Map();
const selectedDecorIds = new Set();
let lastSelectedDecorId = null;
let gizmoMode = 'translate';
let gizmoSnap = true;
let snapStep = 1.0;

let activeKey = SEGMENT_KEYS[0];
// Tinkercad-parity behaviour: after placing a shape, tool reverts to the pointer (null activeKey).
function setActiveTool(key) {
  activeKey = key;
  activeRot = 0;
  _userOverrodeRot = false;
  // Sync palette active state.
  try {
    document.querySelectorAll('#palette button').forEach(b => b.classList.toggle('active', key != null && b.dataset.key === key));
  } catch {}
  // Canvas cursor feedback: pointer vs crosshair.
  const c = document.getElementById('canvas');
  if (c) c.style.cursor = (key == null) ? 'default' : 'crosshair';
  updatePreview();
  // Tinkercad parity: as soon as a shape is selected, the ghost should
  // already be tethered to the cursor — don't wait for the next mousemove.
  if (key != null && _lastCursorEvent) {
    try {
      canvas.dispatchEvent(new MouseEvent('mousemove', {
        clientX: _lastCursorEvent.clientX,
        clientY: _lastCursorEvent.clientY,
        bubbles: true,
      }));
    } catch {}
  }
}
// Last pointer position over the document — used to seed the placement ghost
// the instant a palette shape is clicked (without waiting for mousemove).
let _lastCursorEvent = null;
window.addEventListener('mousemove', (e) => { _lastCursorEvent = e; }, true);
let activeRot = 0;       // 0..3
// Auto-orient: when placing a road piece next to existing pieces, the editor
// rotates the new piece so its connectors line up. Set to true the moment the
// user manually rotates with R, so their explicit choice is respected for the
// remainder of this tool session.
let _userOverrodeRot = false;

/**
 * Return the rot (0..3) that maximises connector matches with already-placed
 * neighbours of the cell at (gx, gz). Ties broken in favour of `prefer`.
 * Returns null when the segment has no connector demand at this cell (no
 * neighbour offers a connector that lands here).
 */
function autoOrientRot(key, gx, gz, prefer = 0) {
  if (!key || !SEGMENTS[key]) return null;
  // Build map of demand: world (cellKey, side) → 1 if a neighbouring placement
  // exposes a connector pointing into our footprint across that edge.
  const demand = new Map();
  // Collect all candidate footprint cells across the four rots so we know
  // which neighbours are relevant. For 1×1 segments this is just the anchor.
  const def = SEGMENTS[key];
  const sx = def.span?.x || 1;
  const sz = def.span?.z || 1;
  // Set of all world cells the segment could occupy at any rotation.
  const probe = new Set();
  for (let r = 0; r < 4; r++) {
    for (let fz = 0; fz < sz; fz++) {
      for (let fx = 0; fx < sx; fx++) {
        const [rx, rz] = rotateCell(fx, fz, r);
        probe.add(`${gx + rx},${gz + rz}`);
      }
    }
  }
  // For every existing placement, mark demand at any of its connectors that
  // points into one of our probe cells. Connector tier is preserved so a
  // ground piece doesn't try to "connect" to a bridge deck above it.
  for (const p of track.all()) {
    if (track.isOverlay(p.key)) continue;
    const wcs = getWorldConnectors(p.key, p.gx, p.gz, p.rot);
    for (const c of wcs) {
      const [dx, dz] = sideDelta(c.side);
      const tgtX = c.gx + dx, tgtZ = c.gz + dz;
      if (probe.has(`${tgtX},${tgtZ}`)) {
        const opp = oppositeSide(c.side);
        demand.set(`${tgtX},${tgtZ}|${opp}|t${c.tier|0}`, true);
      }
    }
  }
  if (demand.size === 0) return null;
  // Score each rotation: +2 per matched connector, -1 per "wasted" connector
  // (one that points at a placed piece which doesn't connect back).
  let best = -Infinity;
  let bestRot = prefer;
  const orderedRots = [prefer, (prefer + 1) % 4, (prefer + 2) % 4, (prefer + 3) % 4];
  for (const r of orderedRots) {
    if (!track.isClear(key, gx, gz, r)) continue;
    const myConns = getWorldConnectors(key, gx, gz, r);
    let score = 0;
    for (const mc of myConns) {
      const k = `${mc.gx},${mc.gz}|${mc.side}|t${mc.tier|0}`;
      if (demand.has(k)) {
        score += 2;
      } else {
        // Penalise pointing into a solid neighbour without a matching connector.
        // Tier-aware: only consider neighbours sharing this connector's tier.
        const [dx, dz] = sideDelta(mc.side);
        const neigh = track.getAt(mc.gx + dx, mc.gz + dz, mc.tier|0);
        if (neigh && !track.isOverlay(neigh.key)) score -= 1;
      }
    }
    if (score > best) { best = score; bestRot = r; }
  }
  return best > 0 ? bestRot : null;
}

/** @type {Set<number>} */
const selectedIds = new Set();
/** Last clicked id — anchor for inspector + R/arrow operations. */
let lastSelectedId = null;
const previewGroup = new THREE.Group();
scene.add(previewGroup);
let previewMesh = null;
let previewCell = null;

// Selection highlight boxes (one per selected placement, pooled).
const selectionGroup = new THREE.Group();
scene.add(selectionGroup);
const selectBoxPool = [];
function getSelectBox() {
  for (const b of selectBoxPool) if (!b.visible) return b;
  const b = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(TILE, m(1), TILE)),
    new THREE.LineBasicMaterial({ color: 0xff3aa1, linewidth: 2 }),
  );
  selectBoxPool.push(b);
  selectionGroup.add(b);
  return b;
}
function refreshSelectionBoxes() {
  for (const b of selectBoxPool) b.visible = false;
  for (const id of selectedIds) {
    const p = track.getById(id);
    if (!p) continue;
    const b = getSelectBox();
    b.position.set(p.gx * TILE, m(1), p.gz * TILE);
    b.material.color.setHex(id === lastSelectedId ? 0xff3aa1 : 0x6b7280);
    b.visible = true;
  }
  // Reposition the floating action ring so it tracks the selection.
  if (typeof updateActionRing === 'function') updateActionRing();
}

// Maps placement id → THREE.Group instance for fast lookup
const meshById = new Map();

function rebuildAll() {
  // remove all current visuals
  while (placementGroup.children.length) placementGroup.remove(placementGroup.children[0]);
  meshById.clear();
  for (const p of track.all()) {
    addPlacementMesh(p);
  }
  refreshHud();
}

function addPlacementMesh(p) {
  const mesh = buildSegmentMesh(p.key);
  mesh.position.set(p.gx * TILE, 0, p.gz * TILE);
  mesh.rotation.y = -p.rot * Math.PI / 2;
  mesh.userData.placementId = p.id;
  placementGroup.add(mesh);
  meshById.set(p.id, mesh);
}

function removePlacementMesh(id) {
  const mesh = meshById.get(id);
  if (mesh) {
    placementGroup.remove(mesh);
    meshById.delete(id);
  }
}

function addDecorMesh(d) {
  const mesh = buildDecorMesh(d);
  if (!mesh) return;
  decorGroup.add(mesh);
  decorMeshById.set(d.id, mesh);
}
function removeDecorMesh(id) {
  const mesh = decorMeshById.get(id);
  if (mesh) {
    decorGroup.remove(mesh);
    decorMeshById.delete(id);
  }
}
function rebuildAllDecor() {
  while (decorGroup.children.length) decorGroup.remove(decorGroup.children[0]);
  decorMeshById.clear();
  for (const d of decor.all()) addDecorMesh(d);
  rebuildAllCSG();
}

// ── CSG groups (Tinkercad-style merged solids - holes) ────────
function _disposeCSGMesh(mesh) {
  if (!mesh) return;
  csgGroup.remove(mesh);
  if (mesh.geometry) mesh.geometry.dispose?.();
}
function _membersOfGroup(gid) {
  const out = [];
  for (const d of decor.all()) if (d.groupId === gid) out.push(d);
  return out;
}
function rebuildCSGForGroup(gid) {
  if (!gid) return;
  const prev = csgMeshByGid.get(gid);
  if (prev) { _disposeCSGMesh(prev); csgMeshByGid.delete(gid); }
  const members = _membersOfGroup(gid);
  if (!members.length) {
    for (const m of members) { const mesh = decorMeshById.get(m.id); if (mesh) mesh.visible = !m.isHidden; }
    return;
  }
  // Only build a CSG mesh when the group contains at least one Hole;
  // a pure-solid group renders as the original individual meshes.
  const hasHole = members.some(d => d.isHole);
  if (!hasHole) {
    for (const m of members) { const mesh = decorMeshById.get(m.id); if (mesh) mesh.visible = !m.isHidden; }
    return;
  }
  let merged = null;
  try { merged = buildGroupMesh(members); }
  catch (e) { console.warn('[csg] build failed for group', gid, e); }
  if (!merged) {
    for (const m of members) { const mesh = decorMeshById.get(m.id); if (mesh) mesh.visible = !m.isHidden; }
    return;
  }
  merged.userData.csgGroupId = gid;
  csgGroup.add(merged);
  csgMeshByGid.set(gid, merged);
  // Hide member meshes — the CSG mesh is now the visible representation.
  for (const m of members) {
    const mesh = decorMeshById.get(m.id);
    if (mesh) mesh.visible = false;
  }
}
function rebuildAllCSG() {
  for (const mesh of csgMeshByGid.values()) _disposeCSGMesh(mesh);
  csgMeshByGid.clear();
  const seen = new Set();
  for (const d of decor.all()) {
    if (d.groupId && !seen.has(d.groupId)) { seen.add(d.groupId); rebuildCSGForGroup(d.groupId); }
  }
}
function csgGroupForMember(id) {
  const d = decor.getById(id);
  return d?.groupId || null;
}

// ── Segment thumbnail renderer (offscreen) ────────────────────
// Renders each segment piece into a small data-URL once, cached by key,
// so palette tiles show the actual road geometry instead of a blank swatch.
const THUMB_SIZE = 96;
const thumbCache = new Map();
let _thumbRenderer = null;
let _thumbScene = null;
let _thumbCam = null;
function getThumbRig() {
  if (_thumbRenderer) return { renderer: _thumbRenderer, scene: _thumbScene, camera: _thumbCam };
  const c = document.createElement('canvas');
  c.width = THUMB_SIZE; c.height = THUMB_SIZE;
  _thumbRenderer = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true, preserveDrawingBuffer: true });
  _thumbRenderer.setPixelRatio(1);
  _thumbRenderer.setSize(THUMB_SIZE, THUMB_SIZE, false);
  _thumbRenderer.outputColorSpace = THREE.SRGBColorSpace;
  _thumbRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  _thumbRenderer.toneMappingExposure = 1.4;
  _thumbRenderer.setClearColor(0xeaf6f8, 1);
  _thumbScene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight(0xffffff, 0x404858, 1.4);
  const dir = new THREE.DirectionalLight(0xffffff, 1.6);
  dir.position.set(8, 14, 6);
  const fill = new THREE.DirectionalLight(0xa0b8ff, 0.5);
  fill.position.set(-6, 8, -4);
  _thumbScene.add(hemi, dir, fill);
  _thumbCam = new THREE.PerspectiveCamera(35, 1, 0.1, m(500));
  return { renderer: _thumbRenderer, scene: _thumbScene, camera: _thumbCam };
}
function makeThumb(key) {
  if (thumbCache.has(key)) return thumbCache.get(key);
  let url = '';
  try {
    const { renderer: r, scene: s, camera: c } = getThumbRig();
    let mesh;
    if (isDecorKey(key)) {
      const def = DECOR[key];
      // GLB-backed kit prop: try to render the actual scene; if not loaded
      // yet, return '' so the palette tile re-asks once preload completes.
      if (def.glb) {
        const inst = instanceGLB(def.glb);
        if (!inst) { return ''; }
        const ds = def.defaultScale || [2, 2, 2];
        inst.scale.set(ds[0] * 1000, ds[1] * 1000, ds[2] * 1000);
        mesh = inst;
      } else {
        const dr = def.defaultRot || [0, 0, 0];
        const ds = [1000, 1000, 1000];
        mesh = new THREE.Mesh(def.build(), getDecorMaterial(def.color, false).clone());
        mesh.rotation.set(dr[0], dr[1], dr[2]);
        mesh.scale.set(ds[0], ds[1], ds[2]);
      }
    } else {
      mesh = buildSegmentMesh(key);
    }
    if (!mesh) { thumbCache.set(key, ''); return ''; }
    s.add(mesh);
    // Frame the mesh.
    const box = new THREE.Box3().setFromObject(mesh);
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);
    const radius = Math.max(size.x, size.y, size.z, 1) * 0.62;
    const dist = radius / Math.tan((c.fov * Math.PI / 180) / 2) * 1.15;
    const dirVec = new THREE.Vector3(1, 0.85, 1).normalize();
    c.position.copy(center).addScaledVector(dirVec, dist);
    c.lookAt(center);
    c.updateProjectionMatrix();
    r.render(s, c);
    url = r.domElement.toDataURL('image/png');
    s.remove(mesh);
    if (!isDecorKey(key)) {
      mesh.traverse(o => {
        if (o.geometry) o.geometry.dispose();
      });
    } else if (mesh.material && mesh.material.dispose) {
      mesh.material.dispose();
    }
  } catch (err) {
    console.warn('[studio] thumbnail failed for', key, err);
  }
  thumbCache.set(key, url);
  return url;
}

// ── Palette UI (grouped by category) ──────────────────────────
const paletteEl = document.getElementById('palette');
const paletteSearchEl = document.getElementById('paletteSearch');
let paletteFilter = '';
const CATEGORY_ORDER = ['road', 'junction', 'height', 'special', 'walled', ...DECOR_CATEGORY_ORDER];
const CATEGORY_LABELS = {
  road: 'Road',
  junction: 'Junctions',
  height: 'Vertical',
  special: 'Special',
  walled: 'High Walled Track',
  ...DECOR_CATEGORY_LABELS,
};
function buildPalette() {
  paletteEl.innerHTML = '';
  const filter = paletteFilter.trim().toLowerCase();
  const catFilter = filter.startsWith('__cat:') ? filter.slice(6) : null;
  const textFilter = catFilter ? '' : filter;
  // Group keys by category (preserving insertion order within a group).
  const groups = new Map();
  const addKey = (key, def) => {
    if (catFilter && (def.category || 'special') !== catFilter && !(catFilter === 'road' && ['road','junction','height','special','walled'].includes(def.category))) return;
    if (textFilter && !def.label.toLowerCase().includes(textFilter) && !key.toLowerCase().includes(textFilter)) return;
    const cat = def.category || 'special';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(key);
  };
  for (const key of SEGMENT_KEYS) addKey(key, SEGMENTS[key]);
  for (const key of DECOR_KEYS) addKey(key, DECOR[key]);
  const renderGroup = (cat, keys) => {
    if (!keys?.length) return;
    const header = document.createElement('div');
    header.className = 'palette-group';
    header.textContent = CATEGORY_LABELS[cat] || cat;
    paletteEl.appendChild(header);
    for (const key of keys) {
      const def = SEGMENTS[key] || DECOR[key];
      const btn = document.createElement('button');
      btn.dataset.key = key;
      btn.innerHTML = '<div class="swatch"></div><div class="label">' + def.label + '</div>';
      const swatch = btn.querySelector('.swatch');
      const thumbUrl = makeThumb(key);
      if (swatch && thumbUrl) {
        swatch.style.background = `url("${thumbUrl}") center/contain no-repeat`;
      }
      if (key === activeKey) btn.classList.add('active');
      btn.addEventListener('click', () => {
        // Toggle off if the same tool was clicked again.
        setActiveTool(activeKey === key ? null : key);
      });
      // Tinkercad parity: drag the tile straight onto the workplane to drop
      // a shape at the cursor world point. Wires into the canvas drop event
      // below; the dragged key travels through both `dataTransfer` (for
      // browsers that respect it) and a module-level fallback variable.
      btn.draggable = true;
      btn.addEventListener('dragstart', (ev) => {
        try { ev.dataTransfer?.setData('text/plain', key); } catch {}
        if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'copy';
        _paletteDragKey = key;
      });
      btn.addEventListener('dragend', () => {
        _paletteDragKey = null;
        // Tinkercad parity: if the drag was released off-canvas, cancel
        // the placement tool and clear the ghost.
        setActiveTool(null);
      });
      paletteEl.appendChild(btn);
    }
  };
  for (const cat of CATEGORY_ORDER) renderGroup(cat, groups.get(cat));
  for (const [cat, keys] of groups) {
    if (CATEGORY_ORDER.includes(cat)) continue;
    renderGroup(cat, keys);
  }
  if (paletteEl.children.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'grid-column:1/-1;color:var(--muted);font-size:11px;padding:8px;text-align:center;';
    empty.textContent = 'No matching pieces';
    paletteEl.appendChild(empty);
  }
}
buildPalette();
// Start in pointer mode so nothing is stamped on the first click.
setActiveTool(null);
if (paletteSearchEl) {
  paletteSearchEl.addEventListener('input', () => {
    paletteFilter = paletteSearchEl.value;
    buildPalette();
  });
}

// ── Preview ghost ─────────────────────────────────────────────
function updatePreview() {
  while (previewGroup.children.length) previewGroup.remove(previewGroup.children[0]);
  if (activeKey == null) { previewMesh = null; return; }
  if (isDecorKey(activeKey)) {
    const def = DECOR[activeKey];
    const dr = def.defaultRot || [0, 0, 0];
    // Match the DecorStore.add() default: every fresh placement is 1000 mm.
    const ds = [1000, 1000, 1000];
    const matPreview = new THREE.MeshStandardMaterial({
      color: def.color, roughness: 0.55, metalness: 0.05,
      transparent: true, opacity: 0.45, depthWrite: false,
    });
    previewMesh = new THREE.Mesh(def.build(), matPreview);
    previewMesh.rotation.set(dr[0], dr[1], dr[2]);
    previewMesh.scale.set(ds[0], ds[1], ds[2]);
    previewGroup.add(previewMesh);
    if (previewCell) {
      const y = def.centered ? ds[1] / 2 : 0;
      previewMesh.position.set(previewCell.gx * TILE, y, previewCell.gz * TILE);
    } else {
      previewMesh.visible = false;
    }
    return;
  }
  previewMesh = buildSegmentMesh(activeKey);
  previewMesh.traverse((c) => {
    if (c.isMesh) {
      c.material = c.material.clone();
      c.material.transparent = true;
      c.material.opacity = 0.55;
      c.castShadow = false;
    }
  });
  previewGroup.add(previewMesh);
  if (previewCell) {
    previewMesh.position.set(previewCell.gx * TILE, 0, previewCell.gz * TILE);
  } else {
    previewMesh.visible = false;
  }
  previewMesh.rotation.y = -activeRot * Math.PI / 2;
}

// ── Mouse: hover + click ──────────────────────────────────────
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

// Module-level scratch for palette drag-drop (set by tile dragstart, read by canvas drop).
let _paletteDragKey = null;

// ── Hover outline (Tinkercad-style cyan edge highlight on unselected items) ──
const hoverGroup = new THREE.Group();
scene.add(hoverGroup);
const _hoverOutline = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
  new THREE.LineBasicMaterial({ color: 0x48d3ff, transparent: true, opacity: 0.9, depthTest: false }),
);
_hoverOutline.renderOrder = 999;
_hoverOutline.visible = false;
hoverGroup.add(_hoverOutline);
let _hoverKey = null; // 'decor:<id>' | 'placement:<id>' | null
function setHoverOutline(kind, id) {
  const key = (kind && id != null) ? `${kind}:${id}` : null;
  if (key === _hoverKey) return;
  _hoverKey = key;
  if (!key) { _hoverOutline.visible = false; return; }
  let target = null;
  if (kind === 'decor') target = decorMeshById.get(id);
  else if (kind === 'placement') target = meshById.get(id);
  if (!target) { _hoverOutline.visible = false; return; }
  // Skip outline if this item is already selected (selection box covers it).
  if (kind === 'decor' && selectedDecorIds.has(id)) { _hoverOutline.visible = false; return; }
  if (kind === 'placement' && selectedIds.has(id)) { _hoverOutline.visible = false; return; }
  const box = new THREE.Box3().setFromObject(target);
  if (!isFinite(box.min.x)) { _hoverOutline.visible = false; return; }
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  _hoverOutline.scale.set(Math.max(size.x, 1), Math.max(size.y, 1), Math.max(size.z, 1));
  _hoverOutline.position.copy(center);
  _hoverOutline.visible = true;
}

function pickGroundCell(event) {
  const rect = canvas.getBoundingClientRect();
  ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, activeCamera);
  // Always compute the underlying ground cell first so it can be used as a
  // fallback when an overlay segment (e.g. spawn) wants to be dropped on top
  // of an existing placement.
  const groundHits = raycaster.intersectObject(ground);
  let cell = null;
  let worldPoint = null;
  if (groundHits.length) {
    const point = groundHits[0].point;
    worldPoint = { x: point.x, y: 0, z: point.z };
    cell = { gx: Math.round(point.x / TILE), gz: Math.round(point.z / TILE) };
  }
  // Decor meshes are checked before placement meshes so a decor object
  // sitting on top of a road segment can still be picked. Hidden decor
  // (mesh.visible = false) is naturally excluded by the raycaster.
  // Also raycast CSG group meshes — when a group contains holes, the
  // member meshes are hidden and the merged CSG mesh stands in for them.
  const decorHits = raycaster.intersectObjects(
    decorGroup.children.concat(csgGroup.children), true
  );
  if (decorHits.length) {
    let obj = decorHits[0].object;
    while (obj && obj.userData.decorId == null && obj.userData.csgGroupId == null) obj = obj.parent;
    if (obj && obj.userData.csgGroupId != null) {
      // Resolve to the first member of the CSG group so existing
      // selection / inspector code paths just work.
      const gid = obj.userData.csgGroupId;
      const members = _membersOfGroup(gid);
      const first = members[0];
      if (first) return { kind: 'decor', id: first.id, gx: cell?.gx, gz: cell?.gz, worldPoint, csgGroupId: gid };
    }
    if (obj && obj.userData.decorId != null) {
      return { kind: 'decor', id: obj.userData.decorId, gx: cell?.gx, gz: cell?.gz, worldPoint };
    }
  }
  const placementHits = raycaster.intersectObjects(placementGroup.children, true);
  if (placementHits.length) {
    let obj = placementHits[0].object;
    while (obj && obj.userData.placementId == null) obj = obj.parent;
    if (obj && obj.userData.placementId != null) {
      return { kind: 'placement', id: obj.userData.placementId, gx: cell?.gx, gz: cell?.gz, worldPoint };
    }
  }
  if (!cell) return null;
  return { kind: 'cell', gx: cell.gx, gz: cell.gz, worldPoint };
}

canvas.addEventListener('mousemove', (e) => {
  const hit = pickGroundCell(e);
  // ── Hover outline + cursor feedback (no active placement tool) ──
  if (activeKey == null) {
    if (hit?.kind === 'decor') {
      const inst = decor.getById(hit.id);
      setHoverOutline('decor', hit.id);
      canvas.style.cursor = inst?.isLocked ? 'not-allowed' : 'grab';
    } else if (hit?.kind === 'placement') {
      setHoverOutline('placement', hit.id);
      canvas.style.cursor = 'grab';
    } else {
      setHoverOutline(null);
      canvas.style.cursor = 'default';
    }
  } else {
    setHoverOutline(null);
  }
  if (!hit) {
    previewCell = null;
    if (previewMesh) previewMesh.visible = false;
    return;
  }
  // Decor placement: ghost follows the cursor freely on the workplane,
  // snapping to the grid step (Tinkercad-style tethered preview).
  // If the cursor is over an existing decor mesh, stack on top of it (raise Y
  // to that mesh's bbox max).
  if (isDecorKey(activeKey)) {
    let baseY = 0;
    let wp = hit.worldPoint;
    if (hit.kind === 'decor') {
      const target = decorMeshById.get(hit.id);
      if (target) {
        const box = new THREE.Box3().setFromObject(target);
        if (isFinite(box.max.y)) baseY = box.max.y;
      }
    }
    if (!wp && hit.gx != null) wp = { x: hit.gx * TILE, z: hit.gz * TILE };
    if (!wp) { if (previewMesh) previewMesh.visible = false; return; }
    let { x, z } = wp;
    if (gizmoSnap && snapStep > 0) {
      x = Math.round(x / snapStep) * snapStep;
      z = Math.round(z / snapStep) * snapStep;
    }
    if (!previewMesh) updatePreview();
    if (previewMesh) {
      const def = DECOR[activeKey];
      const y = baseY + (def?.centered ? (previewMesh.scale.y / 2) : 0);
      previewMesh.visible = true;
      previewMesh.position.set(x, y, z);
      previewMesh.userData._stackY = baseY;
    }
    return;
  }
  // Overlay segments (spawn) are allowed to land on top of existing placements,
  // so prefer the underlying cell coords whenever they are available.
  const overlayActive = track.isOverlay(activeKey);
  const showCell = hit.kind === 'cell' || (overlayActive && hit.gx != null);
  if (showCell && activeKey != null) {
    previewCell = { gx: hit.gx, gz: hit.gz };
    if (!previewMesh) updatePreview();
    if (!previewMesh) return;
    previewMesh.visible = true;
    previewMesh.position.set(hit.gx * TILE, 0, hit.gz * TILE);
    // Auto-orient to nearest connecting edges (unless user pressed R to override).
    let useRot = activeRot;
    if (!_userOverrodeRot && !isDecorKey(activeKey) && !track.isOverlay(activeKey)) {
      const auto = autoOrientRot(activeKey, hit.gx, hit.gz, activeRot);
      if (auto != null) useRot = auto;
    }
    activeRot = useRot;
    previewMesh.rotation.y = -useRot * Math.PI / 2;
    // tint based on validity
    const valid = track.isClear(activeKey, hit.gx, hit.gz, useRot);
    previewMesh.traverse((c) => {
      if (c.isMesh) c.material.color.setHex(valid ? 0xffffff : 0xff3344);
    });
  } else {
    previewCell = null;
    if (previewMesh) previewMesh.visible = false;
  }
});

canvas.addEventListener('mouseleave', () => {
  previewCell = null;
  if (previewMesh) previewMesh.visible = false;
  setHoverOutline(null);
  canvas.style.cursor = 'default';
});

// ── Drag-from-palette → drop on workplane (Tinkercad parity) ──
// Show a translucent preview at the drop point while dragging, then place
// the shape (decor or road) when the user releases the mouse over canvas.
canvas.addEventListener('dragover', (e) => {
  if (!_paletteDragKey) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  const hit = pickGroundCell(e);
  if (!hit) return;
  // Reuse the placement preview by temporarily aiming activeKey at the dragged
  // shape; restore on dragend.
  if (activeKey !== _paletteDragKey) {
    activeKey = _paletteDragKey;
    updatePreview();
  }
  if (isDecorKey(_paletteDragKey)) {
    if (previewMesh && hit.worldPoint) {
      previewCell = { gx: hit.gx, gz: hit.gz };
      previewMesh.visible = true;
      previewMesh.position.set(hit.worldPoint.x, 0, hit.worldPoint.z);
    }
  } else if (hit.gx != null) {
    previewCell = { gx: hit.gx, gz: hit.gz };
    if (previewMesh) {
      previewMesh.visible = true;
      previewMesh.position.set(hit.gx * TILE, 0, hit.gz * TILE);
      if (!_userOverrodeRot && !track.isOverlay(_paletteDragKey)) {
        const auto = autoOrientRot(_paletteDragKey, hit.gx, hit.gz, activeRot);
        if (auto != null) activeRot = auto;
      }
      previewMesh.rotation.y = -activeRot * Math.PI / 2;
    }
  }
});
canvas.addEventListener('drop', (e) => {
  const key = _paletteDragKey || e.dataTransfer?.getData('text/plain');
  _paletteDragKey = null;
  if (!key) return;
  e.preventDefault();
  const hit = pickGroundCell(e);
  if (!hit) return;
  if (isDecorKey(key)) {
    const wp = hit.worldPoint || (hit.gx != null ? { x: hit.gx * TILE, y: 0, z: hit.gz * TILE } : null);
    if (!wp) return;
    let { x, z } = wp;
    if (gizmoSnap && snapStep > 0) {
      x = Math.round(x / snapStep) * snapStep;
      z = Math.round(z / snapStep) * snapStep;
    }
    // Stack on top of any decor under the cursor (Tinkercad parity).
    let baseY = 0;
    if (hit.kind === 'decor') {
      const target = decorMeshById.get(hit.id);
      if (target) {
        const box = new THREE.Box3().setFromObject(target);
        if (isFinite(box.max.y)) baseY = box.max.y;
      }
    }
    const inst = decor.add({ type: key, x, y: baseY, z });
    if (inst) {
      addDecorMesh(inst);
      selectDecor(inst.id, 'replace');
      pushUndo();
      refreshHud();
    }
  } else if (hit.gx != null) {
    const placement = track.place(key, hit.gx, hit.gz, activeRot);
    if (placement) {
      addPlacementMesh(placement);
      pushUndo();
      refreshHud();
    } else {
      toast('Cell occupied');
    }
  }
  // Drop always returns to pointer mode, like Tinkercad.
  setActiveTool(null);
});

// ── Mouse: drag-to-move + click-to-select / click-to-place ─────
// Mousedown on a placement begins a potential drag; if the cursor moves
// to a different cell before mouseup, we move the selection. Otherwise
// the mouseup is treated as a normal click (selection or placement).
const DRAG_PIXEL_THRESHOLD = 5;
let mouseDownState = null;
// Tracks the timestamp when the most recent mouseup ended a drag, so we
// can suppress the follow-up `click` event from re-placing/re-selecting.
let _lastDragConsumedAt = 0;
function mouseDownStateConsumedDrag() {
  return performance.now() - _lastDragConsumedAt < 100;
}

// ── Marquee (rubber-band) selection ─────────────────────────────
// Click+drag on empty ground (with no placement tool active) draws a
// rectangle and selects every placement / decor whose centre projects
// inside the rectangle on mouseup. Holding Shift or Ctrl/Meta adds to
// the existing selection instead of replacing it.
const marqueeEl = document.createElement('div');
marqueeEl.id = 'marqueeRect';
Object.assign(marqueeEl.style, {
  position: 'fixed',
  border: '1px solid #4ab8ff',
  background: 'rgba(74, 184, 255, 0.12)',
  pointerEvents: 'none',
  zIndex: '9000',
  display: 'none',
  boxSizing: 'border-box',
});
document.body.appendChild(marqueeEl);
const _marqueeProj = new THREE.Vector3();
function updateMarqueeRect(x0, y0, x1, y1) {
  const left = Math.min(x0, x1);
  const top = Math.min(y0, y1);
  const w = Math.abs(x1 - x0);
  const h = Math.abs(y1 - y0);
  marqueeEl.style.left = left + 'px';
  marqueeEl.style.top = top + 'px';
  marqueeEl.style.width = w + 'px';
  marqueeEl.style.height = h + 'px';
  marqueeEl.style.display = 'block';
}
function hideMarqueeRect() {
  marqueeEl.style.display = 'none';
}
/**
 * Select every placement + decor whose world-space anchor projects into the
 * given client-space rectangle. `additive` keeps the existing selection.
 */
function applyMarqueeSelection(rect, additive) {
  const canvasRect = canvas.getBoundingClientRect();
  if (!additive) {
    selectedIds.clear();
    selectedDecorIds.clear();
    lastSelectedId = null;
    lastSelectedDecorId = null;
  }
  const inside = (cx, cy) =>
    cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom;
  const projectMesh = (mesh) => {
    if (!mesh) return null;
    mesh.getWorldPosition(_marqueeProj);
    _marqueeProj.project(activeCamera);
    // Behind camera → skip.
    if (_marqueeProj.z < -1 || _marqueeProj.z > 1) return null;
    const cx = canvasRect.left + ((_marqueeProj.x + 1) / 2) * canvasRect.width;
    const cy = canvasRect.top + ((1 - _marqueeProj.y) / 2) * canvasRect.height;
    return { cx, cy };
  };
  for (const p of track.all()) {
    const mesh = placementGroup.children.find(m => m.userData?.placementId === p.id);
    const sp = projectMesh(mesh);
    if (sp && inside(sp.cx, sp.cy)) {
      selectedIds.add(p.id);
      lastSelectedId = p.id;
    }
  }
  for (const d of decor.all()) {
    const mesh = decorMeshById.get(d.id);
    const sp = projectMesh(mesh);
    if (sp && inside(sp.cx, sp.cy)) {
      selectedDecorIds.add(d.id);
      lastSelectedDecorId = d.id;
    }
  }
  refreshSelectionBoxes();
  refreshInspector();
}

canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  hideContextMenu();
  const hit = pickGroundCell(e);
  mouseDownState = {
    startX: e.clientX, startY: e.clientY,
    hit, dragging: false, lastCell: null,
    movedSinceStart: false,
    // Snapshot selection at the time of drag-start so we can move it as a group.
    snapshot: null, anchorId: null, anchorStart: null,
  };
  // ── Marquee selection ────────────────────────────────────────
  // No active placement tool + click on empty ground (or no hit) starts a
  // rubber-band rectangle. The actual selection happens on mouseup.
  const _hitEmpty = !hit || hit.kind === 'cell';
  if (activeKey == null && _hitEmpty) {
    mouseDownState.marquee = {
      startX: e.clientX, startY: e.clientY,
      additive: e.shiftKey || e.ctrlKey || e.metaKey,
    };
    return;
  }
  // If clicking on a placement, prepare a potential drag of the whole selection.
  // (Skip when an overlay key is active — the click should drop the overlay
  // on top of whatever's there instead of dragging the underlying piece.
  // Also skip when the topmost hit is an overlay piece but the user is placing
  // a non-overlay segment — in that case the click should drop the road
  // underneath the spawn rather than drag the spawn.)
  const _hitOverlay = hit && hit.kind === 'placement' && track.isOverlay(track.getById(hit.id)?.key);
  const _activeDecor = isDecorKey(activeKey);
  if (hit && hit.kind === 'placement' && !track.isOverlay(activeKey) && !_hitOverlay && !_activeDecor) {
    // If the clicked piece isn't already selected, switch selection to it now
    // so the drag operates on what the user actually clicked.
    if (!selectedIds.has(hit.id) && !e.shiftKey && !(e.ctrlKey || e.metaKey)) {
      selectPlacement(hit.id, 'replace');
    }
    const list = [...selectedIds].map(id => track.getById(id)).filter(Boolean);
    const anchor = track.getById(hit.id) || list[0];
    if (anchor) {
      mouseDownState.snapshot = list.map(p => ({ id: p.id, key: p.key, gx: p.gx, gz: p.gz, rot: p.rot }));
      mouseDownState.anchorId = anchor.id;
      // Use the cell actually under the cursor as the drag anchor — NOT the
      // segment's stored origin cell. For multi-cell pieces (1×2 tunnel,
      // 2×2 plaza, etc.) the user may have clicked any of the occupied
      // cells, and the drag offset must be measured from that exact cell
      // so the piece tracks the cursor 1:1.
      const anchorGx = (typeof hit.gx === 'number') ? hit.gx : anchor.gx;
      const anchorGz = (typeof hit.gz === 'number') ? hit.gz : anchor.gz;
      mouseDownState.anchorStart = { gx: anchorGx, gz: anchorGz };
      mouseDownState.lastCell = { gx: anchorGx, gz: anchorGz };
    }
  }
  // Tinkercad-style on-body drag for decor: clicking the shape itself
  // begins a workplane translation. Don't interfere when a placement tool
  // is active (those clicks should drop a new shape). Locked shapes ignore
  // body-drag.
  if (hit && hit.kind === 'decor' && !_activeDecor && !track.isOverlay(activeKey)) {
    const hitInst = decor.getById(hit.id);
    if (hitInst?.isLocked) {
      // Still allow selection of locked shapes (so the user can unlock them).
      if (!selectedDecorIds.has(hit.id) && !e.shiftKey && !(e.ctrlKey || e.metaKey)) {
        selectDecor(hit.id, 'replace');
      }
    } else {
      if (!selectedDecorIds.has(hit.id) && !e.shiftKey && !(e.ctrlKey || e.metaKey)) {
        selectDecor(hit.id, 'replace');
      }
      const ids = [...selectedDecorIds].filter(id => !decor.getById(id)?.isLocked);
      const startWp = hit.worldPoint;
      if (startWp && ids.length) {
        mouseDownState.decorDrag = {
          ids,
          startWp,
          starts: ids.map(id => {
            const d = decor.getById(id);
            return { id, x: d?.x ?? 0, y: d?.y ?? 0, z: d?.z ?? 0 };
          }),
        };
      }
    }
  }
});

canvas.addEventListener('mousemove', (e) => {
  if (!mouseDownState) return;
  const dx = e.clientX - mouseDownState.startX;
  const dy = e.clientY - mouseDownState.startY;
  // Marquee: stretch the rubber-band rectangle.
  if (mouseDownState.marquee) {
    if (!mouseDownState.dragging && Math.hypot(dx, dy) < DRAG_PIXEL_THRESHOLD) return;
    mouseDownState.dragging = true;
    mouseDownState.movedSinceStart = true;
    updateMarqueeRect(
      mouseDownState.marquee.startX, mouseDownState.marquee.startY,
      e.clientX, e.clientY,
    );
    return;
  }
  // Decor body-drag: move all selected decor instances on the workplane.
  if (mouseDownState.decorDrag) {
    if (!mouseDownState.dragging && Math.hypot(dx, dy) < DRAG_PIXEL_THRESHOLD) return;
    mouseDownState.dragging = true;
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, activeCamera);
    const hits = raycaster.intersectObject(ground);
    if (!hits.length) return;
    const wp = hits[0].point;
    const dd = mouseDownState.decorDrag;
    let dxw = wp.x - dd.startWp.x;
    let dzw = wp.z - dd.startWp.z;
    if (gizmoSnap && snapStep > 0) {
      dxw = Math.round(dxw / snapStep) * snapStep;
      dzw = Math.round(dzw / snapStep) * snapStep;
    }
    for (const s of dd.starts) {
      const inst = decor.getById(s.id);
      const mesh = decorMeshById.get(s.id);
      if (!inst || !mesh) continue;
      inst.x = s.x + dxw;
      inst.z = s.z + dzw;
      mesh.position.x = inst.x;
      mesh.position.z = inst.z;
    }
    mouseDownState.movedSinceStart = true;
    canvas.style.cursor = 'grabbing';
    // Tinkercad-style position tooltip near the cursor.
    const tip = document.getElementById('dragTip');
    if (tip && dd.starts[0]) {
      const anchor = decor.getById(dd.starts[0].id);
      if (anchor) {
        tip.querySelector('[data-x]').textContent = Math.round(anchor.x).toString();
        tip.querySelector('[data-z]').textContent = Math.round(anchor.z).toString();
        tip.style.left = e.clientX + 'px';
        tip.style.top = e.clientY + 'px';
        tip.hidden = false;
      }
    }
    return;
  }
  if (!mouseDownState.snapshot) return;
  if (!mouseDownState.dragging && Math.hypot(dx, dy) < DRAG_PIXEL_THRESHOLD) return;
  mouseDownState.dragging = true;
  // Find the cell currently under the cursor (against the ground only).
  const rect = canvas.getBoundingClientRect();
  ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, activeCamera);
  const hits = raycaster.intersectObject(ground);
  if (!hits.length) return;
  const point = hits[0].point;
  const gx = Math.round(point.x / TILE);
  const gz = Math.round(point.z / TILE);
  if (mouseDownState.lastCell && mouseDownState.lastCell.gx === gx && mouseDownState.lastCell.gz === gz) return;
  // Try to move the whole selection so the anchor lands at (gx, gz).
  const offDx = gx - mouseDownState.anchorStart.gx;
  const offDz = gz - mouseDownState.anchorStart.gz;
  if (tryMoveSelectionTo(mouseDownState.snapshot, offDx, offDz)) {
    mouseDownState.lastCell = { gx, gz };
    mouseDownState.movedSinceStart = true;
    mouseDownState.lastBlockedToastAt = 0;
    // Refresh the snapshot ids after move (they have new ids now).
    mouseDownState.snapshot = [...selectedIds].map(id => track.getById(id)).filter(Boolean)
      .map(p => ({ id: p.id, key: p.key, gx: p.gx, gz: p.gz, rot: p.rot }));
    const anchorNow = mouseDownState.snapshot.find(p => p.id === lastSelectedId) || mouseDownState.snapshot[0];
    if (anchorNow) mouseDownState.anchorId = anchorNow.id;
    // Re-base anchorStart to the cursor's current cell so the next
    // iteration's delta is computed incrementally against the freshly-
    // moved snapshot (otherwise total-delta would overshoot on multi-hop
    // drags). The cursor's "handle" on the piece moves with the piece.
    mouseDownState.anchorStart = { gx, gz };
  } else {
    // Throttle the "blocked" hint so dragging across an occupied region
    // doesn't spam the toast — fire at most once per second per drag.
    const now = performance.now();
    if (!mouseDownState.lastBlockedToastAt || now - mouseDownState.lastBlockedToastAt > 1000) {
      toast('Cell occupied — try a different cell or rotate (R)');
      mouseDownState.lastBlockedToastAt = now;
    }
  }
});

window.addEventListener('mouseup', (e) => {
  if (e.button !== 0 || !mouseDownState) { mouseDownState = null; return; }
  // Marquee: commit the rubber-band selection.
  if (mouseDownState.marquee) {
    const m = mouseDownState.marquee;
    const wasDrag = mouseDownState.dragging;
    mouseDownState = null;
    hideMarqueeRect();
    if (wasDrag) {
      const rect = {
        left: Math.min(m.startX, e.clientX),
        right: Math.max(m.startX, e.clientX),
        top: Math.min(m.startY, e.clientY),
        bottom: Math.max(m.startY, e.clientY),
      };
      applyMarqueeSelection(rect, m.additive);
      _lastDragConsumedAt = performance.now();
    }
    return;
  }
  // Any drag attempt (even one with no successful move) consumes the
  // followup `click` event so it can't trigger the place handler with a
  // stale activeKey, which previously surfaced as a spurious "Cell occupied"
  // toast when dragging a piece into a position blocked by its neighbour.
  if (mouseDownState.dragging) _lastDragConsumedAt = performance.now();
  const wasDragging = mouseDownState.dragging && mouseDownState.movedSinceStart;
  const wasDecorDrag = !!mouseDownState.decorDrag;
  mouseDownState = null;
  const tip = document.getElementById('dragTip');
  if (tip) tip.hidden = true;
  if (canvas.style.cursor === 'grabbing') canvas.style.cursor = 'grab';
  if (wasDragging) {
    _lastDragConsumedAt = performance.now();
    pushUndo();
    if (wasDecorDrag) refreshInspector();
    refreshHud();
  }
});

/**
 * Try to translate every piece in `snap` by (dx, dz) cells. Returns true on
 * success. Atomically rolls back on collision.
 */
function tryMoveSelectionTo(snap, dx, dz) {
  if (dx === 0 && dz === 0) return false;
  // Temporarily remove all then test free.
  for (const p of snap) track.remove(p.id);
  for (const p of snap) {
    if (!track.isClear(p.key, p.gx + dx, p.gz + dz, p.rot)) {
      // Roll back.
      for (const q of snap) track.place(q.key, q.gx, q.gz, q.rot);
      return false;
    }
  }
  const newIds = [];
  for (const p of snap) {
    removePlacementMesh(p.id);
    const np = track.place(p.key, p.gx + dx, p.gz + dz, p.rot);
    if (np) {
      addPlacementMesh(np);
      newIds.push({ oldId: p.id, newId: np.id });
    }
  }
  selectedIds.clear();
  for (const r of newIds) selectedIds.add(r.newId);
  const last = newIds.find(r => r.oldId === lastSelectedId);
  lastSelectedId = last ? last.newId : (newIds[0]?.newId ?? null);
  refreshSelectionBoxes();
  refreshInspector();
  return true;
}

canvas.addEventListener('click', (e) => {
  if (e.button !== 0) return;
  // If a drag just happened, swallow this click — the move was already committed.
  if (mouseDownStateConsumedDrag()) return;
  const hit = pickGroundCell(e);
  if (!hit) return;
  // Decor selection: clicking a decor mesh always selects it.
  if (hit.kind === 'decor') {
    const mode = e.shiftKey ? 'add' : (e.ctrlKey || e.metaKey) ? 'toggle' : 'replace';
    selectDecor(hit.id, mode);
    return;
  }
  // Overlay segments (spawn) place on top of any cell — including ones already
  // occupied by a road piece — so route placement-hits to the placement path
  // when the active key is an overlay and we have cell coordinates.
  // Conversely, when the user is placing a road and the only thing under the
  // cursor is an overlay (e.g. an existing spawn), treat the click as a cell
  // placement so the road can be dropped underneath the spawn.
  const overlayActive = track.isOverlay(activeKey);
  const decorActive = isDecorKey(activeKey);
  const hitOverlay = hit.kind === 'placement' && track.isOverlay(track.getById(hit.id)?.key);
  if (hit.kind === 'placement' && !overlayActive && !hitOverlay && !decorActive) {
    const mode = e.shiftKey ? 'add' : (e.ctrlKey || e.metaKey) ? 'toggle' : 'replace';
    selectPlacement(hit.id, mode);
    return;
  }
  // Decor placement: drop a free-positioned 3D shape at the cursor world point.
  if (decorActive) {
    const wp = hit.worldPoint || (hit.gx != null ? { x: hit.gx * TILE, y: 0, z: hit.gz * TILE } : null);
    if (!wp) return;
    let { x, z } = wp;
    if (gizmoSnap && snapStep > 0) {
      x = Math.round(x / snapStep) * snapStep;
      z = Math.round(z / snapStep) * snapStep;
    }
    // Stack on top of any decor under the cursor (Tinkercad parity).
    let baseY = 0;
    if (hit.kind === 'decor') {
      const target = decorMeshById.get(hit.id);
      if (target) {
        const box = new THREE.Box3().setFromObject(target);
        if (isFinite(box.max.y)) baseY = box.max.y;
      }
    }
    const inst = decor.add({ type: activeKey, x, y: baseY, z });
    if (inst) {
      addDecorMesh(inst);
      selectDecor(inst.id, 'replace');
      pushUndo();
      refreshHud();
      // Tinkercad parity: after dropping a shape, revert to pointer mode.
      setActiveTool(null);
    }
    return;
  }
  if (hit.gx == null || hit.gz == null) return;
  // Click on empty cell with no modifier clears the selection.
  if (!e.shiftKey && !e.ctrlKey && !e.metaKey) clearSelection();
  // Without an active tool there is nothing to place — bail silently so
  // we don't surface a misleading "Cell occupied" message after a clear.
  if (!activeKey || !SEGMENTS[activeKey]) return;
  // Place
  const placement = track.place(activeKey, hit.gx, hit.gz, activeRot);
  if (placement) {
    addPlacementMesh(placement);
    pushUndo();
    refreshHud();
    setActiveTool(null);
  } else {
    toast('Cell occupied');
  }
});

// (Right-click context menu handler is wired further below where
//  showContextMenu / pickGroundCell are both available.)

// ── Selection ──────────────────────────────────────────────────
function selectPlacement(id, mode = 'replace') {
  if (!track.getById(id)) return;
  if (mode === 'add') {
    selectedIds.add(id);
    lastSelectedId = id;
  } else if (mode === 'toggle') {
    if (selectedIds.has(id)) {
      selectedIds.delete(id);
      if (lastSelectedId === id) lastSelectedId = selectedIds.size ? [...selectedIds].pop() : null;
    } else {
      selectedIds.add(id);
      lastSelectedId = id;
    }
  } else {
    selectedIds.clear();
    selectedIds.add(id);
    lastSelectedId = id;
  }
  refreshSelectionBoxes();
  refreshInspector();
}

function clearSelection() {
  selectedIds.clear();
  lastSelectedId = null;
  selectedDecorIds.clear();
  lastSelectedDecorId = null;
  if (transformControls) transformControls.detach();
  const gb = document.getElementById('gizmoBar');
  if (gb) gb.hidden = true;
  refreshSelectionBoxes();
  refreshInspector();
}

function selectAll() {
  selectedIds.clear();
  for (const p of track.all()) selectedIds.add(p.id);
  lastSelectedId = selectedIds.size ? [...selectedIds].pop() : null;
  refreshSelectionBoxes();
  refreshInspector();
}

// --- Decor selection + TransformControls gizmo ---
function selectDecor(id, mode = 'replace') {
  if (!decor.getById(id)) return;
  // Tinkercad parity: clicking any member of a group selects the entire group.
  const cascade = (anchorId) => {
    const inst = decor.getById(anchorId);
    const gid = inst?.groupId;
    if (!gid) return [anchorId];
    const ids = [];
    for (const d of decor.all()) if (d.groupId === gid) ids.push(d.id);
    return ids.length ? ids : [anchorId];
  };
  const ids = cascade(id);
  if (mode === 'add') {
    for (const i of ids) selectedDecorIds.add(i);
    lastSelectedDecorId = id;
  } else if (mode === 'toggle') {
    if (selectedDecorIds.has(id)) {
      for (const i of ids) selectedDecorIds.delete(i);
      if (lastSelectedDecorId === id) lastSelectedDecorId = selectedDecorIds.size ? [...selectedDecorIds].pop() : null;
    } else {
      for (const i of ids) selectedDecorIds.add(i);
      lastSelectedDecorId = id;
    }
  } else {
    selectedDecorIds.clear();
    for (const i of ids) selectedDecorIds.add(i);
    lastSelectedDecorId = id;
  }
  selectedIds.clear();
  lastSelectedId = null;
  refreshSelectionBoxes();
  refreshDecorGizmo();
  refreshInspector();
}

// ── Tinkercad parity helpers: mirror, lock, hide, group, align ──
function _selectionBoxWorld() {
  const box = new THREE.Box3();
  let any = false;
  for (const id of selectedDecorIds) {
    const mesh = decorMeshById.get(id);
    if (!mesh) continue;
    box.expandByObject(mesh);
    any = true;
  }
  return any ? box : null;
}
/** Mirror selected decor across the given world axis ('x' | 'y' | 'z') about the selection center. */
function mirrorSelection(axis) {
  if (selectedDecorIds.size === 0) return;
  const box = _selectionBoxWorld();
  if (!box) return;
  const center = new THREE.Vector3();
  box.getCenter(center);
  for (const id of selectedDecorIds) {
    const d = decor.getById(id);
    const mesh = decorMeshById.get(id);
    if (!d || !mesh) continue;
    if (d.isLocked) continue;
    if (axis === 'x') { d.x = 2 * center.x - d.x; d.sx *= -1; }
    if (axis === 'y') { d.y = Math.max(0, 2 * center.y - d.y); d.sy *= -1; }
    if (axis === 'z') { d.z = 2 * center.z - d.z; d.sz *= -1; }
    syncDecorMesh(mesh, d);
  }
  pushUndo();
  refreshInspector();
}
/** Toggle locked state on selected decor. */
function toggleLockSelection() {
  if (selectedDecorIds.size === 0) return;
  const anyUnlocked = [...selectedDecorIds].some(id => !decor.getById(id)?.isLocked);
  for (const id of selectedDecorIds) {
    const d = decor.getById(id);
    if (d) d.isLocked = anyUnlocked;
  }
  pushUndo();
  refreshInspector();
  toast(anyUnlocked ? 'Locked selection' : 'Unlocked selection');
}
/** Toggle hidden state. Hidden meshes stay in the file but become invisible/unselectable. */
function toggleHideSelection() {
  if (selectedDecorIds.size === 0) return;
  const anyVisible = [...selectedDecorIds].some(id => !decor.getById(id)?.isHidden);
  for (const id of selectedDecorIds) {
    const d = decor.getById(id);
    const mesh = decorMeshById.get(id);
    if (!d) continue;
    d.isHidden = anyVisible;
    if (mesh) mesh.visible = !d.isHidden;
  }
  pushUndo();
  refreshInspector();
}
let _nextGroupId = 1;
function groupSelection() {
  if (selectedDecorIds.size < 2) return;
  // If everything in selection already shares a group, ungroup instead (Tinkercad toggles via Ctrl+G).
  const gids = new Set([...selectedDecorIds].map(id => decor.getById(id)?.groupId).filter(Boolean));
  if (gids.size === 1) { ungroupSelection(); return; }
  const gid = `g${Date.now().toString(36)}-${_nextGroupId++}`;
  for (const id of selectedDecorIds) {
    const d = decor.getById(id);
    if (d) d.groupId = gid;
  }
  rebuildCSGForGroup(gid);
  pushUndo();
  refreshInspector();
  toast('Grouped (' + selectedDecorIds.size + ')');
}
function ungroupSelection() {
  if (selectedDecorIds.size === 0) return;
  const gids = new Set();
  for (const id of selectedDecorIds) {
    const d = decor.getById(id);
    if (d && d.groupId) {
      gids.add(d.groupId);
      d.groupId = null;
    }
  }
  // Remove the merged CSG mesh and re-show member originals.
  for (const gid of gids) {
    const mesh = csgMeshByGid.get(gid);
    if (mesh) { _disposeCSGMesh(mesh); csgMeshByGid.delete(gid); }
  }
  for (const d of decor.all()) {
    const m = decorMeshById.get(d.id);
    if (m) m.visible = !d.isHidden;
  }
  pushUndo();
  refreshInspector();
  toast('Ungrouped');
}
/** Align selection along an axis. mode: 'min' | 'center' | 'max'. */
function alignSelection(axis, mode) {
  if (selectedDecorIds.size < 2) return;
  // Compute per-mesh AABB and pick a target value along the axis.
  const items = [];
  let target = null;
  for (const id of selectedDecorIds) {
    const mesh = decorMeshById.get(id);
    const d = decor.getById(id);
    if (!mesh || !d) continue;
    const box = new THREE.Box3().setFromObject(mesh);
    items.push({ id, d, mesh, box });
    const v = mode === 'min' ? box.min[axis]
            : mode === 'max' ? box.max[axis]
            : (box.min[axis] + box.max[axis]) / 2;
    if (target === null || (mode === 'min' && v < target) || (mode === 'max' && v > target)) target = v;
    if (mode === 'center' && target === null) target = v;
  }
  if (target === null) return;
  for (const it of items) {
    if (it.d.isLocked) continue;
    const v = mode === 'min' ? it.box.min[axis]
            : mode === 'max' ? it.box.max[axis]
            : (it.box.min[axis] + it.box.max[axis]) / 2;
    const delta = target - v;
    const key = axis === 'x' ? 'x' : axis === 'y' ? 'y' : 'z';
    it.d[key] += delta;
    if (axis === 'y') it.d.y = Math.max(0, it.d.y);
    syncDecorMesh(it.mesh, it.d);
  }
  pushUndo();
  refreshInspector();
}
function deleteDecorSelection() {
  if (selectedDecorIds.size === 0) return;
  for (const id of selectedDecorIds) {
    removeDecorMesh(id);
    decor.remove(id);
  }
  selectedDecorIds.clear();
  lastSelectedDecorId = null;
  refreshDecorGizmo();
  pushUndo();
  refreshHud();
  refreshInspector();
}
function duplicateDecorSelection() {
  if (selectedDecorIds.size === 0) return;
  // Tinkercad smart-duplicate: remember the offset between the most recent
  // pre-duplicate anchor and the new anchor; subsequent Ctrl+D applies it.
  // We track via a module-level `_lastDupDelta` updated in objectChange.
  const dx = (_lastDupDelta?.x ?? mm(20));
  const dy = (_lastDupDelta?.y ?? 0);
  const dz = (_lastDupDelta?.z ?? mm(20));
  const newIds = [];
  for (const id of selectedDecorIds) {
    const d = decor.getById(id);
    if (!d) continue;
    const copy = decor.add({
      type: d.type,
      x: d.x + dx, y: d.y + dy, z: d.z + dz,
      rx: d.rx, ry: d.ry, rz: d.rz,
      sx: d.sx, sy: d.sy, sz: d.sz,
      color: d.color, isHole: d.isHole,
    });
    if (copy) { addDecorMesh(copy); newIds.push(copy.id); }
  }
  if (newIds.length) {
    // Snapshot the new anchor position so any subsequent move records the
    // smart-duplicate delta in the gizmo's objectChange listener.
    _dupAnchorBefore = (() => {
      const inst = decor.getById(newIds[0]);
      return inst ? { x: inst.x, y: inst.y, z: inst.z } : null;
    })();
    selectedDecorIds.clear();
    for (const id of newIds) selectedDecorIds.add(id);
    lastSelectedDecorId = newIds[newIds.length - 1];
    refreshDecorGizmo();
    refreshInspector();
    pushUndo();
    refreshHud();
  }
}
// Smart-duplicate state: remembers the last (anchor-before → anchor-after)
// delta so a chain of Ctrl+D, drag, Ctrl+D, drag... keeps the rhythm.
let _lastDupDelta = null;
let _dupAnchorBefore = null;
function _maybeRecordDupDelta() {
  if (!_dupAnchorBefore || lastSelectedDecorId == null) return;
  const inst = decor.getById(lastSelectedDecorId);
  if (!inst) { _dupAnchorBefore = null; return; }
  const dx = inst.x - _dupAnchorBefore.x;
  const dy = inst.y - _dupAnchorBefore.y;
  const dz = inst.z - _dupAnchorBefore.z;
  if (Math.hypot(dx, dy, dz) > 0.5) {
    _lastDupDelta = { x: dx, y: dy, z: dz };
  }
  _dupAnchorBefore = null;
}
let transformControls = null;
let _tcHelper = null;
function ensureTransformControls() {
  if (transformControls) return transformControls;
  transformControls = new TransformControls(activeCamera, renderer.domElement);
  transformControls.setSize(0.85);
  transformControls.addEventListener('dragging-changed', (e) => {
    controls.enabled = !e.value;
    if (!e.value) {
      syncSelectedDecorFromMesh();
      _maybeRecordDupDelta();
      pushUndo();
      refreshInspector();
    }
  });
  transformControls.addEventListener('objectChange', () => {
    syncSelectedDecorFromMesh();
    if (selectedDecorIds.size > 0) showInspectorPopup();
  });
  _tcHelper = transformControls.getHelper ? transformControls.getHelper() : transformControls;
  scene.add(_tcHelper);
  // Tinkercad parity: hide the giant XYZ axis helper. Manipulation happens
  // exclusively through the on-shape HTML overlay (corners, rotation rings,
  // raise cone) and direct body-drag on the workplane.
  _tcHelper.visible = false;
  return transformControls;
}
function syncSelectedDecorFromMesh() {
  if (lastSelectedDecorId == null) return;
  const mesh = decorMeshById.get(lastSelectedDecorId);
  const inst = decor.getById(lastSelectedDecorId);
  if (!mesh || !inst) return;
  inst.x = mesh.position.x; inst.y = mesh.position.y; inst.z = mesh.position.z;
  inst.rx = mesh.rotation.x; inst.ry = mesh.rotation.y; inst.rz = mesh.rotation.z;
  inst.sx = mesh.scale.x; inst.sy = mesh.scale.y; inst.sz = mesh.scale.z;
}
function refreshDecorGizmo() {
  ensureTransformControls();
  const gizmoBar = document.getElementById('gizmoBar');
  // Tinkercad parity: NEVER attach the 3D TransformControls gizmo.
  // All on-shape manipulation (translate, rotate, scale) is provided by the
  // HTML manip overlay (.dm-corner / .dm-ring / .dm-size / raise cone) plus
  // direct body-drag on the workplane. The 3D arrows would compete visually.
  if (transformControls) transformControls.detach();
  if (_tcHelper) _tcHelper.visible = false;
  if (gizmoBar) gizmoBar.hidden = true;
}
function setGizmoMode(mode) {
  if (!['translate', 'rotate', 'scale'].includes(mode)) return;
  gizmoMode = mode;
  if (transformControls) transformControls.setMode(mode);
  document.querySelectorAll('#gizmoBar [data-mode]').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
}
function setGizmoSnap(on) {
  gizmoSnap = !!on;
  if (transformControls) {
    transformControls.translationSnap = gizmoSnap && snapStep > 0 ? snapStep : null;
    transformControls.rotationSnap = gizmoSnap ? Math.PI / 8 : null;
    transformControls.scaleSnap = gizmoSnap ? 0.1 : null;
  }
  document.getElementById('gizmoSnap')?.classList.toggle('active', gizmoSnap);
}
function setSnapStep(v) {
  snapStep = parseFloat(v) || 0;
  if (snapStep === 0) { setGizmoSnap(false); return; }
  if (transformControls) {
    transformControls.translationSnap = gizmoSnap ? snapStep : null;
  }
}

// ── Keyboard ───────────────────────────────────────────────────
/** In-memory clipboard: array of placement specs relative to anchor. */
let clipboard = null;

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const ctrl = e.ctrlKey || e.metaKey;

  // ── Edit shortcuts (ctrl-modified) ──
  if (ctrl && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    selectAll();
    return;
  }
  if (ctrl && e.key.toLowerCase() === 'c') {
    e.preventDefault();
    copySelection();
    return;
  }
  if (ctrl && e.key.toLowerCase() === 'v') {
    e.preventDefault();
    pasteClipboard();
    return;
  }
  if (ctrl && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    duplicateSelection();
    return;
  }
  if (ctrl && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) doRedo(); else doUndo();
    return;
  }
  if (ctrl && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    doRedo();
    return;
  }

  // ── Rotate (R) ──
  if (e.key === 'r' || e.key === 'R') {
    if (selectedDecorIds.size > 0) {
      rotateSelection(e.shiftKey ? -1 : 1);
      return;
    }
    if (selectedIds.size > 0) {
      rotateSelection(e.shiftKey ? -1 : 1);
    } else {
      activeRot = (activeRot + (e.shiftKey ? 3 : 1)) % 4;
      _userOverrodeRot = true;
      if (previewMesh) previewMesh.rotation.y = -activeRot * Math.PI / 2;
    }
    return;
  }
  // Gizmo mode keys (Tinkercad/Blender-style): G translate, T rotate, Y scale.
  if (e.key === 'g' || e.key === 'G') { setGizmoMode('translate'); return; }
  if (e.key === 't' || e.key === 'T') { setGizmoMode('rotate'); return; }
  if (e.key === 'y' || e.key === 'Y') { setGizmoMode('scale'); return; }

  // ── Delete ──
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedDecorIds.size > 0) { deleteDecorSelection(); return; }
    if (selectedIds.size > 0) {
      deleteSelection();
    }
    return;
  }

  // ── Escape ──
  if (e.key === 'Escape') {
    clearSelection();
    return;
  }

  // ── Hole toggle (H) — Tinkercad parity for boolean subtraction prep ──
  if ((e.key === 'h' || e.key === 'H') && !ctrl && !e.shiftKey && selectedDecorIds.size > 0) {
    e.preventDefault();
    for (const id of selectedDecorIds) {
      const d = decor.getById(id);
      if (!d) continue;
      d.isHole = !d.isHole;
      const mesh = decorMeshById.get(id);
      if (mesh) syncDecorMesh(mesh, d);
    }
    pushUndo();
    refreshInspector();
    return;
  }
  // ── Hide toggle (Shift+H) ──
  if ((e.key === 'H') && !ctrl && e.shiftKey && selectedDecorIds.size > 0) {
    e.preventDefault();
    toggleHideSelection();
    return;
  }
  // ── Lock toggle (L) ──
  if ((e.key === 'l' || e.key === 'L') && !ctrl && selectedDecorIds.size > 0) {
    e.preventDefault();
    toggleLockSelection();
    return;
  }
  // ── Mirror (M = X axis, Shift+M = Y, Ctrl+M = Z) ──
  if ((e.key === 'm' || e.key === 'M') && selectedDecorIds.size > 0) {
    e.preventDefault();
    mirrorSelection(ctrl ? 'z' : (e.shiftKey ? 'y' : 'x'));
    return;
  }
  // ── Group / Ungroup (Ctrl+G / Ctrl+Shift+G) ──
  if (ctrl && (e.key === 'g' || e.key === 'G')) {
    e.preventDefault();
    if (e.shiftKey) ungroupSelection(); else groupSelection();
    return;
  }
  // ── Align panel toggle (A) ──
  if ((e.key === 'a' || e.key === 'A') && !ctrl && selectedDecorIds.size > 1) {
    e.preventDefault();
    const ap = document.getElementById('alignPanel');
    if (ap) ap.hidden = !ap.hidden;
    return;
  }

  // ── Arrow-key nudge ──
  // Plain arrows: 1-cell move for road placements.
  // Ctrl+ArrowUp / ArrowDown: lift / lower decor along world-Y by snapStep.
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && ctrl && selectedDecorIds.size > 0) {
    e.preventDefault();
    const step = (gizmoSnap && snapStep > 0) ? snapStep : 1;
    const sign = e.key === 'ArrowUp' ? 1 : -1;
    for (const id of selectedDecorIds) {
      const d = decor.getById(id);
      if (!d) continue;
      d.y = Math.max(0, d.y + sign * step);
      const mesh = decorMeshById.get(id);
      if (mesh) mesh.position.y = d.y;
    }
    pushUndo();
    refreshInspector();
    return;
  }
  const arrow = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
  if (arrow && selectedIds.size > 0) {
    e.preventDefault();
    const [dx, dz] = arrow;
    nudgeSelection(dx, dz);
    return;
  }
});

function copySelection() {
  if (selectedIds.size === 0) {
    toast('Nothing to copy');
    return;
  }
  const list = [...selectedIds].map(id => track.getById(id)).filter(Boolean);
  // Anchor = top-left bounds of selection so paste is positionally meaningful.
  let minX = Infinity, minZ = Infinity;
  for (const p of list) { if (p.gx < minX) minX = p.gx; if (p.gz < minZ) minZ = p.gz; }
  clipboard = list.map(p => ({ key: p.key, dx: p.gx - minX, dz: p.gz - minZ, rot: p.rot }));
  toast(`Copied ${list.length} piece${list.length === 1 ? '' : 's'}`);
}

function pasteClipboard(anchorGx, anchorGz) {
  if (!clipboard || clipboard.length === 0) {
    toast('Clipboard empty');
    return;
  }
  // Default anchor: cursor cell if inside grid, else offset from current bounds.
  let ax, az;
  if (anchorGx != null && anchorGz != null) {
    ax = anchorGx; az = anchorGz;
  } else if (previewCell) {
    ax = previewCell.gx; az = previewCell.gz;
  } else {
    ax = 1; az = 1;
  }
  // Test all-clear before placing any.
  for (const item of clipboard) {
    if (!track.isClear(item.key, ax + item.dx, az + item.dz, item.rot)) {
      toast('Paste blocked (cells occupied)');
      return;
    }
  }
  const newIds = [];
  for (const item of clipboard) {
    const p = track.place(item.key, ax + item.dx, az + item.dz, item.rot);
    if (p) {
      addPlacementMesh(p);
      newIds.push(p.id);
    }
  }
  if (newIds.length) {
    selectedIds.clear();
    for (const id of newIds) selectedIds.add(id);
    lastSelectedId = newIds[newIds.length - 1];
    refreshSelectionBoxes();
    refreshInspector();
    pushUndo();
    refreshHud();
  }
}

function duplicateSelection() {
  if (selectedDecorIds.size > 0) { duplicateDecorSelection(); return; }
  if (selectedIds.size === 0) {
    toast('Nothing to duplicate');
    return;
  }
  copySelection();
  // Paste with a +1/+1 offset so the copy is visible.
  const list = [...selectedIds].map(id => track.getById(id)).filter(Boolean);
  let minX = Infinity, minZ = Infinity;
  for (const p of list) { if (p.gx < minX) minX = p.gx; if (p.gz < minZ) minZ = p.gz; }
  pasteClipboard(minX + 1, minZ + 1);
}

function nudgeSelection(dx, dz) {
  if (selectedIds.size === 0) return;
  const list = [...selectedIds].map(id => track.getById(id)).filter(Boolean);
  // Validate the move as a group: temporarily remove all selected then test.
  const snap = list.map(p => ({ id: p.id, key: p.key, gx: p.gx, gz: p.gz, rot: p.rot }));
  for (const p of snap) track.remove(p.id);
  for (const p of snap) {
    if (!track.isClear(p.key, p.gx + dx, p.gz + dz, p.rot)) {
      // Roll back.
      for (const q of snap) track.place(q.key, q.gx, q.gz, q.rot);
      toast('Nudge blocked');
      return;
    }
  }
  // All clear — re-place at offset.
  const newIds = [];
  for (const p of snap) {
    removePlacementMesh(p.id);
    const np = track.place(p.key, p.gx + dx, p.gz + dz, p.rot);
    if (np) {
      addPlacementMesh(np);
      newIds.push({ oldId: p.id, newId: np.id });
    }
  }
  selectedIds.clear();
  for (const r of newIds) selectedIds.add(r.newId);
  const last = newIds.find(r => r.oldId === lastSelectedId);
  lastSelectedId = last ? last.newId : (newIds[0]?.newId ?? null);
  refreshSelectionBoxes();
  refreshInspector();
  pushUndo();
  refreshHud();
}

/**
 * Rotate every selected piece by `dir` quarter-turns (+1 = CW, -1 = CCW).
 * Each piece rotates in place; blocked pieces are skipped.
 */
function rotateSelection(dir = 1) {
  if (selectedDecorIds.size > 0) {
    for (const id of selectedDecorIds) {
      const inst = decor.getById(id);
      const mesh = decorMeshById.get(id);
      if (!inst || !mesh) continue;
      inst.ry += dir * Math.PI / 2;
      mesh.rotation.y = inst.ry;
    }
    refreshDecorGizmo();
    refreshInspector();
    pushUndo();
    return;
  }
  if (selectedIds.size === 0) return;
  const snap = [...selectedIds].map(id => track.getById(id)).filter(Boolean);
  const rotated = [];
  for (const p of snap) {
    const newRot = (p.rot + dir + 4) % 4;
    if (!track.isClear(p.key, p.gx, p.gz, newRot, p.id)) continue;
    track.remove(p.id);
    const np = track.place(p.key, p.gx, p.gz, newRot);
    if (np) {
      removePlacementMesh(p.id);
      addPlacementMesh(np);
      rotated.push({ oldId: p.id, newId: np.id });
    }
  }
  if (rotated.length === 0) {
    toast('Rotation blocked');
    return;
  }
  selectedIds.clear();
  for (const r of rotated) selectedIds.add(r.newId);
  const last = rotated.find(r => r.oldId === lastSelectedId);
  lastSelectedId = last ? last.newId : (rotated[0]?.newId ?? null);
  refreshSelectionBoxes();
  refreshInspector();
  pushUndo();
}

function deleteSelection() {
  if (selectedIds.size === 0) return;
  for (const id of selectedIds) {
    removePlacementMesh(id);
    track.remove(id);
  }
  clearSelection();
  pushUndo();
  refreshHud();
}

// ── Undo / redo (whole-track snapshots) ───────────────────────
const undoStack = [];
let undoIndex = -1;
function pushUndo() {
  // Truncate forward history when a new edit happens.
  undoStack.length = undoIndex + 1;
  undoStack.push(JSON.stringify(saveJSON()));
  undoIndex = undoStack.length - 1;
  if (undoStack.length > 50) {
    undoStack.shift();
    undoIndex--;
  }
}
function doUndo() {
  if (undoIndex <= 0) return;
  undoIndex--;
  loadFromJSON(JSON.parse(undoStack[undoIndex]), false);
}
function doRedo() {
  if (undoIndex >= undoStack.length - 1) return;
  undoIndex++;
  loadFromJSON(JSON.parse(undoStack[undoIndex]), false);
}

// ── HUD + inspector ───────────────────────────────────────────
function refreshHud() {
  document.getElementById('pieceCount').textContent = track.placements.size;
  document.getElementById('infoPieces').textContent = track.placements.size;
  const b = track.bounds();
  document.getElementById('infoBounds').textContent = b
    ? `${b.maxX - b.minX + 1}×${b.maxZ - b.minZ + 1}` : '—';
  const sp = track.spawn();
  document.getElementById('infoSpawn').textContent = sp ? `(${sp.gx},${sp.gz})` : 'none';
  // Keep kart preview parented to the spawn tile.
  if (typeof positionKartPreview === 'function') positionKartPreview();
  if (typeof refreshPlayButton === 'function') refreshPlayButton();
}
function round2(v) { return Math.round(v * 100) / 100; }
function bindDecorInspector(d) {
  const apply = () => {
    const mesh = decorMeshById.get(d.id);
    if (mesh) syncDecorMesh(mesh, d);
  };
  const num = (id, fn) => {
    const ele = document.getElementById(id);
    if (!ele) return;
    ele.addEventListener('change', () => {
      fn(parseFloat(ele.value) || 0);
      apply();
      pushUndo();
    });
  };
  num('decorX', v => d.x = v);
  num('decorY', v => d.y = v);
  num('decorZ', v => d.z = v);
  num('decorRX', v => d.rx = v * Math.PI / 180);
  num('decorRY', v => d.ry = v * Math.PI / 180);
  num('decorRZ', v => d.rz = v * Math.PI / 180);
  num('decorSX', v => d.sx = Math.max(0.05, v));
  num('decorSY', v => d.sy = Math.max(0.05, v));
  num('decorSZ', v => d.sz = Math.max(0.05, v));
  const colorEl = document.getElementById('decorColor');
  colorEl?.addEventListener('input', () => {
    d.color = parseInt(colorEl.value.replace('#', ''), 16);
    apply();
  });
  colorEl?.addEventListener('change', () => pushUndo());
  const holeEl = document.getElementById('decorHole');
  holeEl?.addEventListener('change', () => {
    d.isHole = holeEl.checked;
    apply();
    pushUndo();
  });
}

// ── Tinkercad-style floating shape inspector ────────────────
// 12-color swatch palette mirroring TC's standard inspector grid (6×2).
const TINKER_PALETTE = [
  0xe6453a, 0xee8b1a, 0xead33a, 0x4ab84a, 0x2e9bd6, 0x9b6dc6,
  0xf06ec6, 0x6e7378, 0xb0b6bf, 0x2a2f36, 0xffffff, 0xc4a06b,
];
function _setRange(idR, idN, val, fmt = (v) => v) {
  const r = document.getElementById(idR);
  const n = document.getElementById(idN);
  if (r) r.value = val;
  if (n) n.value = fmt(val);
}
function _bindPair(idR, idN, fn) {
  const r = document.getElementById(idR);
  const n = document.getElementById(idN);
  const apply = () => fn(parseFloat(n.value) || 0);
  if (r) r.addEventListener('input', () => { n.value = r.value; apply(); applySelectedDecor(); });
  if (r) r.addEventListener('change', () => { pushUndo(); });
  if (n) n.addEventListener('change', () => { if (r) r.value = n.value; apply(); applySelectedDecor(); pushUndo(); });
}
function applySelectedDecor() {
  if (lastSelectedDecorId == null) return;
  const d = decor.getById(lastSelectedDecorId);
  const m = decorMeshById.get(lastSelectedDecorId);
  if (d && m) syncDecorMesh(m, d);
  if (d?.groupId) rebuildCSGForGroup(d.groupId);
}
function buildColorSwatches(activeColor) {
  const c = document.getElementById('ipColors');
  if (!c) return;
  c.innerHTML = '';
  for (const col of TINKER_PALETTE) {
    const s = document.createElement('button');
    s.className = 'swatch-pick';
    s.style.background = '#' + (col & 0xffffff).toString(16).padStart(6, '0');
    if (col === activeColor) s.classList.add('active');
    s.addEventListener('click', () => {
      const d = decor.getById(lastSelectedDecorId);
      if (!d) return;
      d.color = col;
      applySelectedDecor();
      buildColorSwatches(col);
      pushUndo();
    });
    c.appendChild(s);
  }
}
function renderShapeParams(d) {
  const host = document.getElementById('ipParams');
  if (!host) return;
  host.innerHTML = '';
  if (!d) return;
  const schema = getParamSchema(d.type);
  if (!schema) return;
  for (const [key, def] of Object.entries(schema)) {
    const row = document.createElement('div');
    row.className = 'ip-param-row';
    const label = document.createElement('label');
    label.className = 'ip-param-label';
    label.textContent = def.label || key;
    const valEl = document.createElement('span');
    valEl.className = 'ip-param-val';
    const cur = (d.params && key in d.params) ? d.params[key] : def.default;
    valEl.textContent = String(cur);
    label.appendChild(valEl);
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'ip-param-slider';
    slider.min = String(def.min);
    slider.max = String(def.max);
    slider.step = String(def.step ?? 1);
    slider.value = String(cur);
    const apply = (commit) => {
      const inst = decor.getById(lastSelectedDecorId);
      if (!inst) return;
      let v = parseFloat(slider.value);
      if (def.integer) v = Math.round(v);
      if (!inst.params) inst.params = {};
      inst.params[key] = v;
      valEl.textContent = String(v);
      const dirtyGroups = new Set();
      // Apply to all selected of same type for multi-edit parity.
      for (const id of selectedDecorIds) {
        const o = decor.getById(id);
        if (o && o.type === d.type) {
          if (!o.params) o.params = {};
          o.params[key] = v;
          const m = decorMeshById.get(id);
          if (m) syncDecorMesh(m, o);
          if (o.groupId) dirtyGroups.add(o.groupId);
        }
      }
      for (const gid of dirtyGroups) rebuildCSGForGroup(gid);
      if (commit) pushUndo();
    };
    slider.addEventListener('input', () => apply(false));
    slider.addEventListener('change', () => apply(true));
    row.appendChild(label);
    row.appendChild(slider);
    host.appendChild(row);
  }
}
let _ipBound = false;
// ── HSV color picker popover ─────────────────────────────────
const _CP_RECENTS_KEY = 'editor3.cpRecents.v1';
const _recentColors = (() => {
  try {
    const raw = localStorage.getItem(_CP_RECENTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(n => typeof n === 'number').slice(0, 16) : [];
  } catch { return []; }
})();
let _cpHue = 0, _cpSat = 1, _cpVal = 1;
function _hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r, g, b;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  return ((Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255));
}
function _rgbToHsv(c) {
  const r = ((c >> 16) & 0xff) / 255;
  const g = ((c >> 8) & 0xff) / 255;
  const b = (c & 0xff) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d !== 0) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return { h, s: mx === 0 ? 0 : d / mx, v: mx };
}
function _hexFromInt(c) { return '#' + (c & 0xffffff).toString(16).padStart(6, '0'); }
function _renderCpSv() {
  const sv = document.getElementById('ipCpSv');
  if (sv) sv.style.background = _hexFromInt(_hsvToRgb(_cpHue, 1, 1));
  const cur = document.getElementById('ipCpSvCursor');
  if (cur) { cur.style.left = (_cpSat * 100) + '%'; cur.style.top = ((1 - _cpVal) * 100) + '%'; }
  const hueCur = document.getElementById('ipCpHueCursor');
  if (hueCur) hueCur.style.top = (_cpHue * 100) + '%';
}
function _renderCpPreview() {
  const c = _hsvToRgb(_cpHue, _cpSat, _cpVal);
  const hex = _hexFromInt(c);
  const prev = document.getElementById('ipCpPreview');
  if (prev) prev.style.background = hex;
  const hexEl = document.getElementById('ipCpHex');
  if (hexEl && document.activeElement !== hexEl) hexEl.value = hex.toUpperCase();
}
function _applyCpColor(commit) {
  const c = _hsvToRgb(_cpHue, _cpSat, _cpVal);
  const d = decor.getById(lastSelectedDecorId);
  if (!d) return;
  d.color = c;
  applySelectedDecor();
  const hex = _hexFromInt(c);
  for (const id of ['ipCustomSwatch', 'ipMatSolidIcon', 'ipHeaderSolidDot']) {
    const el = document.getElementById(id); if (el) el.style.background = hex;
  }
  buildColorSwatches(c);
  if (commit) {
    _addRecent(c);
    pushUndo();
  }
}
function _addRecent(c) {
  const i = _recentColors.indexOf(c);
  if (i >= 0) _recentColors.splice(i, 1);
  _recentColors.unshift(c);
  if (_recentColors.length > 16) _recentColors.length = 16;
  try { localStorage.setItem(_CP_RECENTS_KEY, JSON.stringify(_recentColors)); } catch {}
  _renderRecents();
}
function _renderRecents() {
  const host = document.getElementById('ipCpRecents');
  if (!host) return;
  host.innerHTML = '';
  for (const c of _recentColors) {
    const b = document.createElement('button');
    b.className = 'ip-cp-recent';
    b.style.background = _hexFromInt(c);
    b.title = _hexFromInt(c).toUpperCase();
    b.addEventListener('click', () => {
      const hsv = _rgbToHsv(c);
      _cpHue = hsv.h; _cpSat = hsv.s; _cpVal = hsv.v;
      _renderCpSv(); _renderCpPreview();
      _applyCpColor(true);
    });
    host.appendChild(b);
  }
}
function toggleColorPopover() {
  const pop = document.getElementById('ipColorPopover');
  if (!pop) return;
  if (!pop.hidden) { pop.hidden = true; return; }
  // Seed popover from current color.
  const d = decor.getById(lastSelectedDecorId);
  if (d) {
    const hsv = _rgbToHsv(d.color);
    _cpHue = hsv.h; _cpSat = hsv.s; _cpVal = hsv.v;
  }
  // Anchor the popover just to the LEFT of the inspector card.
  const ip = document.getElementById('inspectorPopup');
  if (ip) {
    const r = ip.getBoundingClientRect();
    pop.style.position = 'fixed';
    pop.style.left = Math.max(8, Math.floor(r.left - 244)) + 'px';
    pop.style.top = Math.floor(r.top + 184) + 'px';
    pop.style.right = 'auto';
  }
  _renderCpSv();
  _renderCpPreview();
  _renderRecents();
  pop.hidden = false;
}
let _cpBound = false;
function bindColorPopoverOnce() {
  if (_cpBound) return; _cpBound = true;
  const sv = document.getElementById('ipCpSv');
  const hue = document.getElementById('ipCpHue');
  const hex = document.getElementById('ipCpHex');
  if (sv) {
    let dragging = false;
    const onMove = (e) => {
      const r = sv.getBoundingClientRect();
      _cpSat = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      _cpVal = 1 - Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
      _renderCpSv(); _renderCpPreview();
      _applyCpColor(false);
    };
    sv.addEventListener('mousedown', (e) => { dragging = true; onMove(e); });
    window.addEventListener('mousemove', (e) => { if (dragging) onMove(e); });
    window.addEventListener('mouseup', () => { if (dragging) { dragging = false; _applyCpColor(true); } });
  }
  if (hue) {
    let dragging = false;
    const onMove = (e) => {
      const r = hue.getBoundingClientRect();
      _cpHue = Math.max(0, Math.min(0.999, (e.clientY - r.top) / r.height));
      _renderCpSv(); _renderCpPreview();
      _applyCpColor(false);
    };
    hue.addEventListener('mousedown', (e) => { dragging = true; onMove(e); });
    window.addEventListener('mousemove', (e) => { if (dragging) onMove(e); });
    window.addEventListener('mouseup', () => { if (dragging) { dragging = false; _applyCpColor(true); } });
  }
  if (hex) {
    hex.addEventListener('input', () => {
      const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.value.trim());
      if (!m) return;
      const c = parseInt(m[1], 16);
      const hsv = _rgbToHsv(c);
      _cpHue = hsv.h; _cpSat = hsv.s; _cpVal = hsv.v;
      _renderCpSv(); _renderCpPreview();
      _applyCpColor(false);
    });
    hex.addEventListener('change', () => _applyCpColor(true));
  }
}
function bindInspectorPopupOnce() {
  if (_ipBound) return; _ipBound = true;
  // Solid/Hole material picker buttons (both header + body share data-mode).
  const setMode = (mode) => {
    document.querySelectorAll('#inspectorPopup [data-mode]').forEach(t => {
      t.classList.toggle('active', t.dataset.mode === mode);
    });
    const d = decor.getById(lastSelectedDecorId);
    if (!d) return;
    const wantHole = (mode === 'hole');
    if (d.isHole === wantHole) return;
    d.isHole = wantHole;
    applySelectedDecor();
    pushUndo();
  };
  document.querySelectorAll('#inspectorPopup [data-mode]').forEach(b => {
    b.addEventListener('click', () => setMode(b.dataset.mode));
  });
  // Custom color picker — opens TC-style HSV popover.
  const customBtn = document.getElementById('ipColorCustom');
  customBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleColorPopover();
  });
  // Click-outside dismiss for the popover.
  document.addEventListener('mousedown', (e) => {
    const pop = document.getElementById('ipColorPopover');
    if (!pop || pop.hidden) return;
    if (pop.contains(e.target) || customBtn?.contains(e.target)) return;
    pop.hidden = true;
  });
  bindColorPopoverOnce();
  // Transparent toggle.
  document.getElementById('ipTransparent')?.addEventListener('change', (e) => {
    const d = decor.getById(lastSelectedDecorId);
    if (!d) return;
    d.transparent = !!e.target.checked;
    applySelectedDecor();
    pushUndo();
  });
  document.getElementById('ipClose')?.addEventListener('click', () => clearSelection());
  document.getElementById('ipCollapse')?.addEventListener('click', () => {
    const pop = document.getElementById('inspectorPopup');
    if (pop) pop.classList.toggle('collapsed');
  });
}
function showInspectorPopup() {
  const pop = document.getElementById('inspectorPopup');
  if (!pop) return;
  bindInspectorPopupOnce();
  const titleEl = document.getElementById('ipTitle');
  if (selectedDecorIds.size > 1) {
    titleEl.textContent = `Shapes (${selectedDecorIds.size})`;
  } else {
    const d = decor.getById(lastSelectedDecorId);
    if (!d) { pop.hidden = true; return; }
    const def = DECOR[d.type];
    titleEl.textContent = def.label || 'Shape';
    buildColorSwatches(d.color);
    // Sync solid/hole on both header + body buttons.
    const mode = d.isHole ? 'hole' : 'solid';
    document.querySelectorAll('#inspectorPopup [data-mode]').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    // Sync color preview swatches in header / mat row / custom button.
    const hex = '#' + (d.color & 0xffffff).toString(16).padStart(6, '0');
    const setBg = (id) => { const el = document.getElementById(id); if (el) el.style.background = hex; };
    setBg('ipMatSolidIcon');
    setBg('ipHeaderSolidDot');
    setBg('ipCustomSwatch');
    const picker = document.getElementById('ipColorPicker');
    if (picker) picker.value = hex;
    // Transparent checkbox.
    const t = document.getElementById('ipTransparent');
    if (t) t.checked = !!d.transparent;
    // Per-shape params: render schema-driven sliders into #ipParams.
    renderShapeParams(d);
  }
  pop.hidden = false;
  positionInspectorPopup();
}
function hideInspectorPopup() {
  const pop = document.getElementById('inspectorPopup');
  if (pop) pop.hidden = true;
}
function positionInspectorPopup() {
  // No-op: popup is CSS-pinned to the viewport corner.
}
function refreshInspector() {
  const el = document.getElementById('inspector');
  if (selectedDecorIds.size > 0) {
    showInspectorPopup();
    return;
  }
  hideInspectorPopup();
  if (selectedIds.size === 0) {
    el.innerHTML = `<div style="color:var(--muted); font-size:12px;">Nothing selected.<br><span style="font-size:10px;opacity:0.7;">Click a piece · Shift-click to add · Ctrl+A to select all</span></div>`;
    return;
  }
  if (selectedIds.size > 1) {
    el.innerHTML = `
      <div class="row"><span>Selected</span><b>${selectedIds.size} pieces</b></div>
      <div style="margin-top:8px; font-size:11px; color:var(--muted);">R rotate · ←↑→↓ nudge · Del · Ctrl+C/V/D</div>
    `;
    return;
  }
  const p = track.getById(lastSelectedId);
  if (!p) return;
  const def = SEGMENTS[p.key];
  el.innerHTML = `
    <div class="row"><span>Type</span><b>${def.label}</b></div>
    <div class="row"><span>Cell</span><b>${p.gx}, ${p.gz}</b></div>
    <div class="row"><span>Rotation</span><b>${p.rot * 90}°</b></div>
    <div style="margin-top:8px; font-size:11px; color:var(--muted);">R rotate · ←↑→↓ nudge · Del remove · Ctrl+D duplicate</div>
  `;
}
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.remove('show'), 1400);
}

// ── Save / load / share / play ────────────────────────────────
function saveJSON() {
  return { track: track.toJSON(), decor: decor.toJSON() };
}
const trackNameEl = document.getElementById('trackName');
trackNameEl.addEventListener('change', () => { track.name = trackNameEl.value || 'Untitled Track'; });

function loadFromJSON(json, snapshot = true) {
  let trackJson = json;
  let decorJson = null;
  if (json && !Array.isArray(json) && (json.track || json.decor)) {
    trackJson = json.track;
    decorJson = json.decor;
  }
  const t = Track.fromJSON(trackJson);
  track.clear();
  track.name = t.name;
  trackNameEl.value = track.name;
  for (const p of t.all()) {
    track.place(p.key, p.gx, p.gz, p.rot);
  }
  decor.clear();
  if (decorJson) decor.fromJSON(decorJson);
  rebuildAll();
  rebuildAllDecor();
  clearSelection();
  if (snapshot) pushUndo();
}

document.getElementById('saveBtn').addEventListener('click', () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saveJSON()));
  toast('Saved to browser');
});
document.getElementById('loadBtn')?.addEventListener('click', () => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) { toast('No saved track'); return; }
  loadFromJSON(JSON.parse(raw));
  toast('Loaded');
});
document.getElementById('clearBtn')?.addEventListener('click', () => {
  if (!confirm('Clear all pieces?')) return;
  track.clear();
  decor.clear();
  rebuildAll();
  rebuildAllDecor();
  clearSelection();
  pushUndo();
});
document.getElementById('undoBtn')?.addEventListener('click', doUndo);

document.getElementById('shareBtn').addEventListener('click', async () => {
  const code = encodeTrack(track);
  const url = `${window.location.origin}/play.html?track=${code}`;
  try {
    await navigator.clipboard.writeText(url);
    toast('Share link copied to clipboard');
  } catch {
    prompt('Copy this share link:', url);
  }
});

document.getElementById('playBtn').addEventListener('click', () => {
  const issues = validateTrack(track);
  if (issues.length) {
    toast(issues[0]);
    return;
  }
  const code = encodeTrack(track);
  sessionStorage.setItem('gloKartsStudio.playtest', code);
  // Also stash decor so the playtest scene renders the user's design 1:1.
  try {
    sessionStorage.setItem('gloKartsStudio.playtest.decor', JSON.stringify(decor.toJSON()));
  } catch (err) {
    console.warn('[editor3] failed to stash decor for playtest', err);
  }
  window.location.href = `/play.html?track=${code}&from=editor`;
});

/**
 * Track validity check — returns a list of human-readable issues.
 * Empty array = ready to playtest.
 */
function validateTrack(t) {
  const out = [];
  if (t.placements.size < 2) out.push('Add at least 2 pieces before playtesting');
  if (!t.spawn?.()) out.push('Track needs a Spawn piece');
  const hasFinish = Array.from(t.placements.values()).some(
    (p) => SEGMENTS[p.key]?.isFinish,
  );
  if (!hasFinish) out.push('Track needs a Finish piece');
  return out;
}

// Update play-button label to reflect readiness.
function refreshPlayButton() {
  const btn = document.getElementById('playBtn');
  if (!btn) return;
  const issues = validateTrack(track);
  btn.disabled = false; // still allow clicks — we surface the error via toast
  btn.title = issues.length ? issues.join(' · ') : 'Playtest this track';
  btn.style.opacity = issues.length ? '0.65' : '1';
}

// ── Kart picker ───────────────────────────────────────────────
const kartSelectEl = document.getElementById('kartSelect');
let activeKartId = resolveSelectedKartId();
if (kartSelectEl) {
  for (const k of KARTS) {
    const opt = document.createElement('option');
    opt.value = k.id;
    opt.textContent = k.label;
    if (k.id === activeKartId) opt.selected = true;
    kartSelectEl.appendChild(opt);
  }
  kartSelectEl.addEventListener('change', () => {
    activeKartId = kartSelectEl.value;
    try {
      sessionStorage.setItem('studioSelectedKart', activeKartId);
      localStorage.setItem('studioSelectedKart', activeKartId);
    } catch {}
    updateKartPreview(activeKartId);
  });
}

// Preview kart on the spawn piece so users see their choice before playtesting.
let kartPreviewMesh = null;
const kartPreviewAnchor = new THREE.Group();
scene.add(kartPreviewAnchor);
async function updateKartPreview(id) {
  const clone = await cloneKart(id);
  if (kartPreviewMesh) {
    kartPreviewAnchor.remove(kartPreviewMesh);
    kartPreviewMesh.traverse((c) => {
      if (c.geometry && c.geometry.dispose) c.geometry.dispose();
      if (c.material && c.material.dispose) c.material.dispose();
    });
  }
  kartPreviewMesh = clone;
  kartPreviewAnchor.add(clone);
  positionKartPreview();
}
function positionKartPreview() {
  const spawn = track.spawn?.();
  if (!spawn || !kartPreviewMesh) {
    kartPreviewAnchor.visible = false;
    return;
  }
  kartPreviewAnchor.visible = true;
  kartPreviewAnchor.position.set(spawn.gx * TILE, m(0.2), spawn.gz * TILE);
  kartPreviewAnchor.rotation.y = -spawn.rot * Math.PI / 2;
}
// Kick off kart preload so the playtest swap is instant.
preloadAllKarts([activeKartId]);
updateKartPreview(activeKartId);

// (Kenney racing-kit preload removed along with the 'kit' palette
// category. The onGlbLoaded hook below is kept for any future GLB-backed
// decor entries; with no `def.glb` keys present today it is a no-op.)
onGlbLoaded((path) => {
  // Invalidate any palette tile whose def.glb matches this path.
  for (const key of DECOR_KEYS) {
    const def = DECOR[key];
    if (def && def.glb === path) thumbCache.delete(key);
  }
  buildPalette();
  // Replace any placeholder/stale meshes for kit instances that match.
  let needsRebuild = false;
  for (const d of decor.all()) {
    const def = DECOR[d.type];
    if (def && def.glb === path) { needsRebuild = true; break; }
  }
  if (needsRebuild) rebuildAllDecor();
});

// ── Terrain controls ──────────────────────────────────────────
// v2 key: previous v1 stored sky/ground colours that produced a coloured
// horizon band when the camera tilted. TC-parity defaults are flat off-white
// for both sky AND ground so the workplane plate floats on solid white.
const TERRAIN_KEY = 'gloKartsStudio.terrain.v3';
const terrainState = {
  ground: '#dcecf2',
  sky: '#dcecf2',
  grid: true,
  fog: false,
};
function applyTerrain() {
  groundMat.color.set(terrainState.ground);
  scene.background = new THREE.Color(terrainState.sky);
  scene.fog = terrainState.fog ? new THREE.Fog(terrainState.sky, m(120), m(600)) : null;
  grid.visible = terrainState.grid;
  try { localStorage.setItem(TERRAIN_KEY, JSON.stringify(terrainState)); } catch {}
}
try {
  const raw = localStorage.getItem(TERRAIN_KEY);
  if (raw) Object.assign(terrainState, JSON.parse(raw));
} catch {}
const groundColorEl = document.getElementById('groundColor');
const skyColorEl = document.getElementById('skyColor');
const gridToggleEl = document.getElementById('gridToggle');
const fogToggleEl = document.getElementById('fogToggle');
if (groundColorEl) {
  groundColorEl.value = terrainState.ground;
  groundColorEl.addEventListener('input', () => { terrainState.ground = groundColorEl.value; applyTerrain(); });
}
if (skyColorEl) {
  skyColorEl.value = terrainState.sky;
  skyColorEl.addEventListener('input', () => { terrainState.sky = skyColorEl.value; applyTerrain(); });
}
if (gridToggleEl) {
  gridToggleEl.checked = terrainState.grid;
  gridToggleEl.addEventListener('change', () => { terrainState.grid = gridToggleEl.checked; applyTerrain(); });
}
if (fogToggleEl) {
  fogToggleEl.checked = terrainState.fog;
  fogToggleEl.addEventListener('change', () => { terrainState.fog = fogToggleEl.checked; applyTerrain(); });
}
applyTerrain();

// ── View cube + camera ortho toggle ───────────────────────────
let orthoCamera = null;
let usingOrtho = false;
function getOrtho() {
  if (orthoCamera) return orthoCamera;
  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
  const d = TILE * 12;
  orthoCamera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, m(0.1), m(2000));
  orthoCamera.position.copy(camera.position);
  orthoCamera.lookAt(controls.target);
  return orthoCamera;
}
let activeCamera = camera;
function setActiveCamera(next) {
  activeCamera = next;
  controls.object = next;
  if (transformControls) transformControls.camera = next;
  controls.update();
}
function toggleOrtho() {
  usingOrtho = !usingOrtho;
  const orthoBtn = document.getElementById('orthoToggle');
  if (usingOrtho) {
    const oc = getOrtho();
    oc.position.copy(camera.position);
    oc.lookAt(controls.target);
    setActiveCamera(oc);
    if (orthoBtn) { orthoBtn.textContent = 'ORTHO'; orthoBtn.classList.add('active'); }
  } else {
    camera.position.copy(activeCamera.position);
    camera.lookAt(controls.target);
    setActiveCamera(camera);
    if (orthoBtn) { orthoBtn.textContent = 'PERSP'; orthoBtn.classList.remove('active'); }
  }
}
function snapView(view) {
  const dist = activeCamera.position.distanceTo(controls.target) || TILE * 15;
  const target = controls.target.clone();
  let pos;
  switch (view) {
    case 'top':    pos = target.clone().add(new THREE.Vector3(0,  dist, 0.001)); break;
    case 'bottom': pos = target.clone().add(new THREE.Vector3(0, -dist, 0.001)); break;
    case 'front':  pos = target.clone().add(new THREE.Vector3(0,  dist * 0.05,  dist)); break;
    case 'back':   pos = target.clone().add(new THREE.Vector3(0,  dist * 0.05, -dist)); break;
    case 'right':  pos = target.clone().add(new THREE.Vector3( dist, dist * 0.05, 0)); break;
    case 'left':   pos = target.clone().add(new THREE.Vector3(-dist, dist * 0.05, 0)); break;
    case 'side':   pos = target.clone().add(new THREE.Vector3(dist, dist * 0.3, 0)); break;
    case 'iso':
    default:       pos = target.clone().add(new THREE.Vector3(dist * 0.7, dist * 0.7, dist * 0.7)); break;
  }
  activeCamera.position.copy(pos);
  activeCamera.lookAt(target);
  controls.update();
}

// ── Tinkercad-style orbit cube widget ─────────────────────────
// CSS-3D cube top-left mirrors the active camera's orientation. Click a
// face to snap orthographic; drag the cube to orbit the main camera.
const orbitCubeEl = document.getElementById('orbitCube');
const orbitCubeInner = document.getElementById('orbitCubeInner');
if (orbitCubeEl && orbitCubeInner) {
  // Click face -> snap.
  orbitCubeEl.querySelectorAll('.face[data-view]').forEach((f) => {
    f.addEventListener('click', (ev) => {
      // Only treat as click if no drag occurred.
      if (orbitCubeEl._dragMoved) { ev.preventDefault(); return; }
      snapView(f.dataset.view);
    });
  });
  // Drag -> orbit. We rotate the camera around controls.target.
  let dragging = false, lastX = 0, lastY = 0;
  orbitCubeEl.addEventListener('pointerdown', (e) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    orbitCubeEl._dragMoved = false;
    orbitCubeEl.classList.add('dragging');
    orbitCubeEl.setPointerCapture?.(e.pointerId);
  });
  orbitCubeEl.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    if (Math.abs(dx) + Math.abs(dy) > 3) orbitCubeEl._dragMoved = true;
    lastX = e.clientX; lastY = e.clientY;
    // Rotate camera around target. dx -> azimuth, dy -> polar.
    const offset = new THREE.Vector3().subVectors(activeCamera.position, controls.target);
    const sph = new THREE.Spherical().setFromVector3(offset);
    sph.theta -= dx * 0.01;
    sph.phi   = Math.max(0.05, Math.min(Math.PI - 0.05, sph.phi + dy * 0.01));
    offset.setFromSpherical(sph);
    activeCamera.position.copy(controls.target).add(offset);
    activeCamera.lookAt(controls.target);
    controls.update();
  });
  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    orbitCubeEl.classList.remove('dragging');
    try { orbitCubeEl.releasePointerCapture?.(e.pointerId); } catch {}
    // Reset _dragMoved on next tick so the click handler can read it.
    setTimeout(() => { orbitCubeEl._dragMoved = false; }, 0);
  };
  orbitCubeEl.addEventListener('pointerup', endDrag);
  orbitCubeEl.addEventListener('pointercancel', endDrag);
}
// Function used by the render loop to keep the cube oriented like the camera.
function _updateOrbitCube() {
  if (!orbitCubeInner) return;
  // World-from-camera Euler in YXZ. We want the cube to show the face the
  // camera is looking AT, so we apply the inverse rotation.
  const e = new THREE.Euler().setFromQuaternion(activeCamera.quaternion.clone().invert(), 'YXZ');
  const rx = THREE.MathUtils.radToDeg(e.x);
  const ry = THREE.MathUtils.radToDeg(e.y);
  orbitCubeInner.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
}
const viewCubeEl = document.getElementById('viewCube');
if (viewCubeEl) {
  viewCubeEl.querySelectorAll('button[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.view;
      if (v === 'ortho') toggleOrtho();
      else snapView(v);
    });
  });
}

// ── Resize + render loop ──────────────────────────────────────
function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (orthoCamera) {
    const aspect = w / Math.max(1, h);
    const d = TILE * 12;
    orthoCamera.left = -d * aspect;
    orthoCamera.right = d * aspect;
    orthoCamera.top = d;
    orthoCamera.bottom = -d;
    orthoCamera.updateProjectionMatrix();
  }
}
window.addEventListener('resize', resize);
resize();

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, activeCamera);
  _updateOrbitCube();
  // Keep the floating action ring pinned over the selected piece even while
  // the camera moves.
  if (typeof updateActionRing === 'function') updateActionRing();
});

// ── Floating action ring + right-click context menu ───────────
const actionRingEl = document.getElementById('actionRing');
const contextMenuEl = document.getElementById('contextMenu');
const _ringWorld = new THREE.Vector3();
const _ringNdc = new THREE.Vector3();

function updateActionRing() {
  if (!actionRingEl) return;
  if (selectedIds.size === 0 || lastSelectedId == null) {
    actionRingEl.hidden = true;
    return;
  }
  const p = track.getById(lastSelectedId);
  if (!p) { actionRingEl.hidden = true; return; }
  // Project the piece's world position to NDC then to canvas pixels.
  _ringWorld.set(p.gx * TILE, m(6), p.gz * TILE);
  _ringNdc.copy(_ringWorld).project(activeCamera);
  // Skip rendering if the point is behind the camera.
  if (_ringNdc.z > 1) { actionRingEl.hidden = true; return; }
  const rect = canvas.getBoundingClientRect();
  const px = (_ringNdc.x * 0.5 + 0.5) * rect.width;
  const py = (-_ringNdc.y * 0.5 + 0.5) * rect.height;
  // Offset the ring above the piece, then clamp to viewport.
  const offsetY = 48;
  const x = Math.max(80, Math.min(rect.width - 80, px));
  const y = Math.max(40, Math.min(rect.height - 40, py - offsetY));
  actionRingEl.style.left = `${x}px`;
  actionRingEl.style.top = `${y}px`;
  actionRingEl.hidden = false;
}

document.getElementById('ringRotCw')?.addEventListener('click', () => rotateSelection(1));
document.getElementById('ringRotCcw')?.addEventListener('click', () => rotateSelection(-1));
document.getElementById('ringDuplicate')?.addEventListener('click', () => duplicateSelection());
document.getElementById('ringDelete')?.addEventListener('click', () => deleteSelection());

function showContextMenu(clientX, clientY) {
  if (!contextMenuEl) return;
  if (selectedIds.size === 0) return;
  contextMenuEl.hidden = false;
  // Position relative to <main> (the contextMenu is inside <main>).
  const main = canvas.parentElement;
  const rect = main.getBoundingClientRect();
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  // Clamp inside the main area so the menu stays visible.
  const cx = Math.max(8, Math.min(rect.width - 180, localX));
  const cy = Math.max(8, Math.min(rect.height - 180, localY));
  contextMenuEl.style.left = `${cx}px`;
  contextMenuEl.style.top = `${cy}px`;
}
function hideContextMenu() {
  if (contextMenuEl) contextMenuEl.hidden = true;
}

contextMenuEl?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  hideContextMenu();
  if (action === 'rotate-cw') rotateSelection(1);
  else if (action === 'rotate-ccw') rotateSelection(-1);
  else if (action === 'duplicate') duplicateSelection();
  else if (action === 'delete') deleteSelection();
});

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  // OrbitControls already uses right-mouse for rotate; only show the menu
  // if the right-click landed on a placement (so dragging-to-orbit on empty
  // ground keeps working without a menu popping up).
  const hit = pickGroundCell(e);
  if (!hit || hit.kind !== 'placement') {
    hideContextMenu();
    return;
  }
  // Auto-select the right-clicked piece if not already in the selection.
  if (!selectedIds.has(hit.id)) selectPlacement(hit.id, 'replace');
  showContextMenu(e.clientX, e.clientY);
});

window.addEventListener('mousedown', (e) => {
  if (!contextMenuEl || contextMenuEl.hidden) return;
  if (!contextMenuEl.contains(e.target)) hideContextMenu();
}, true);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideContextMenu();
});

// ── Bootstrap: try restoring last track or seed with 1 spawn ─
const raw = localStorage.getItem(STORAGE_KEY);
if (raw) {
  try { loadFromJSON(JSON.parse(raw)); } catch {}
}
if (track.placements.size === 0) {
  // Seed: a small starter loop centered on origin
  track.place('spawn', 0, 0, 0);
  track.place('straight', 0, 1, 0);
  track.place('straight', 0, 2, 0);
  track.place('finish', 0, 3, 0);
  rebuildAll();
}
pushUndo();
refreshHud();
updatePreview();

// Gizmo toolbar wiring
ensureTransformControls();
document.querySelectorAll('#gizmoBar [data-mode]').forEach(btn => {
  btn.addEventListener('click', () => setGizmoMode(btn.dataset.mode));
});
document.getElementById('gizmoSnap')?.addEventListener('click', () => setGizmoSnap(!gizmoSnap));

// Snap-grid size dropdown
document.getElementById('snapGridSize')?.addEventListener('change', (e) => {
  setSnapStep(e.target.value);
});

// Toolbar buttons (Tinkercad transform strip)
document.getElementById('copyToolBtn')?.addEventListener('click', () => copySelection());
document.getElementById('pasteToolBtn')?.addEventListener('click', () => pasteClipboard());
document.getElementById('duplicateToolBtn')?.addEventListener('click', () => duplicateSelection());
document.getElementById('deleteToolBtn')?.addEventListener('click', () => {
  if (selectedDecorIds.size > 0) deleteDecorSelection();
  else if (selectedIds.size > 0) deleteSelection();
});
document.getElementById('redoBtn')?.addEventListener('click', () => doRedo());
document.getElementById('alignBtn')?.addEventListener('click', () => {
  if (selectedDecorIds.size < 2) { toast('Align: select 2+ shapes'); return; }
  // Default: align centers along X (toggle through axes is a future enhancement).
  alignSelection('x', 'center');
});
document.getElementById('groupBtn')?.addEventListener('click', () => groupSelection());
document.getElementById('ungroupBtn')?.addEventListener('click', () => ungroupSelection());
document.getElementById('hideBtn')?.addEventListener('click', () => {
  if (selectedDecorIds.size === 0) { toast('Show/Hide: select shape(s)'); return; }
  toggleHideSelection();
});
document.getElementById('colorBtn')?.addEventListener('click', () => {
  // Tinkercad parity: opens a color/solid-hole popover. For now jump focus to the inspector's color picker.
  const c = document.querySelector('#inspector input[type="color"], .inspector-popup input[type="color"]');
  if (c) { c.click(); c.focus(); }
  else toast('Select a shape to change color');
});
document.getElementById('flipBtn')?.addEventListener('click', () => {
  if (selectedDecorIds.size === 0) { toast('Flip: select shape(s)'); return; }
  // Mirror selection along world-X around its bbox center.
  for (const id of selectedDecorIds) {
    const d = decor.getById(id);
    if (!d || d.isLocked) continue;
    d.s = [-(d.s?.[0] ?? 1), d.s?.[1] ?? 1, d.s?.[2] ?? 1];
    const mesh = decorMeshById.get(id);
    if (mesh) syncDecorMesh(mesh, d);
  }
  pushUndo();
  refreshInspector();
});
document.getElementById('workplaneBtn')?.addEventListener('click', () => {
  toast('Workplane: drag onto a face (W) — placement plane is the workplane plate');
});
document.getElementById('rulerBtn')?.addEventListener('click', () => {
  toast('Ruler: dimensions are shown live in the inspector overlay');
});
document.getElementById('dropToWorkplaneBtn')?.addEventListener('click', () => {
  if (selectedDecorIds.size === 0) { toast('Drop: select shape(s)'); return; }
  // Drop selection so each shape's bbox.min.y == 0.
  for (const id of selectedDecorIds) {
    const mesh = decorMeshById.get(id);
    const d = decor.getById(id);
    if (!mesh || !d || d.isLocked) continue;
    mesh.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(mesh);
    const minY = bb.min.y;
    d.p[1] -= minY;
    syncDecorMesh(mesh, d);
  }
  pushUndo();
  refreshInspector();
});
document.getElementById('overflowBtn')?.addEventListener('click', () => {
  // Tinkercad parity: opens a small overflow menu. We tie this to the existing Save/Load/Clear actions.
  const choice = window.prompt('More tools — type one: clear, save, load, export, import', 'save');
  if (!choice) return;
  switch (choice.trim().toLowerCase()) {
    case 'clear': document.getElementById('clearBtn')?.click(); break;
    case 'save': document.getElementById('saveBtn')?.click(); break;
    case 'load': document.getElementById('loadBtn')?.click(); break;
    case 'export': document.getElementById('exportBtn')?.click(); break;
    case 'import': document.getElementById('importBtn')?.click(); break;
    default: toast('Unknown action: ' + choice);
  }
});
document.getElementById('settingsBtn2')?.addEventListener('click', () => {
  document.getElementById('settingsBtn')?.click();
});

// Viewport stack buttons
document.getElementById('vpHome')?.addEventListener('click', () => snapView('iso'));
document.getElementById('vpFit')?.addEventListener('click', () => {
  const b = track.bounds();
  if (!b) { snapView('iso'); return; }
  const cx = ((b.minX + b.maxX) / 2) * TILE;
  const cz = ((b.minZ + b.maxZ) / 2) * TILE;
  controls.target.set(cx, 0, cz);
  const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 5) * TILE;
  activeCamera.position.set(cx + span, span, cz + span);
  activeCamera.lookAt(controls.target);
  controls.update();
});
document.getElementById('vpZoomIn')?.addEventListener('click', () => {
  controls.dollyIn?.(1.2); controls.update();
  const dir = new THREE.Vector3().subVectors(activeCamera.position, controls.target).multiplyScalar(0.85);
  activeCamera.position.copy(controls.target).add(dir);
});
document.getElementById('vpZoomOut')?.addEventListener('click', () => {
  const dir = new THREE.Vector3().subVectors(activeCamera.position, controls.target).multiplyScalar(1.18);
  activeCamera.position.copy(controls.target).add(dir);
});
document.getElementById('vpIso')?.addEventListener('click', () => snapView('iso'));

// Settings (terrain) toggle
document.getElementById('settingsBtn')?.addEventListener('click', () => {
  const p = document.getElementById('terrainPopup');
  if (p) p.classList.toggle('show');
});

// Top-right tab buttons (Shapes / Workplane / Notes) — basic UX
document.querySelectorAll('.right-header button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.right-header button').forEach(b => b.classList.toggle('active', b === btn));
  });
});

// Category dropdown filters palette
document.getElementById('categorySelect')?.addEventListener('change', (e) => {
  const v = e.target.value;
  paletteFilter = (v === 'all') ? '' : '__cat:' + v;
  buildPalette();
});

// Search button toggles search input visibility
document.getElementById('searchBtn')?.addEventListener('click', () => {
  const el = document.getElementById('paletteSearch');
  if (el) {
    el.classList.toggle('show');
    if (el.classList.contains('show')) el.focus();
  }
});

// Inspector popup is now pinned to the top-right corner of the viewport (CSS),
// so no per-frame repositioning is needed.

// ── On-shape manipulation overlay (Tinkercad-style: bottom-plane scale
//    handles + top height handle + curved-arrow rotation handles outside
//    the bbox + raise cone above). ──
const decorManipEl = document.getElementById('decorManip');
const _dmCorners = decorManipEl ? Array.from(decorManipEl.querySelectorAll('.dm-corner[data-corner]')) : [];
const _dmEdges = decorManipEl ? Array.from(decorManipEl.querySelectorAll('.dm-corner[data-edge]')) : [];
const _dmRots = decorManipEl ? Array.from(decorManipEl.querySelectorAll('.dm-rot')) : [];
const _dmSizes = decorManipEl ? Array.from(decorManipEl.querySelectorAll('.dm-size')) : [];
const _dmTmpV = new THREE.Vector3();
const _dmBox = new THREE.Box3();
const _dmCornerWorld = new THREE.Vector3();
const _dmCornersLocal = [
  [-1,-1,-1],[ 1,-1,-1],[-1, 1,-1],[ 1, 1,-1],
  [-1,-1, 1],[ 1,-1, 1],[-1, 1, 1],[ 1, 1, 1],
];

function _projectToScreen(world, rect) {
  _dmTmpV.copy(world).project(activeCamera);
  return {
    x: (_dmTmpV.x * 0.5 + 0.5) * rect.width,
    y: (-_dmTmpV.y * 0.5 + 0.5) * rect.height,
    z: _dmTmpV.z,
  };
}

function _selectedDecorMesh() {
  if (lastSelectedDecorId == null) return null;
  return decorMeshById.get(lastSelectedDecorId) || null;
}

// Tinkercad-style workplane projection: a thin dashed rectangle drawn on
// the ground beneath the selected shape so its footprint is visible.
let _workplaneShadow = null;
function _ensureWorkplaneShadow() {
  if (_workplaneShadow) return _workplaneShadow;
  const geo = new THREE.BufferGeometry();
  // 5-vertex closed loop (rectangle).
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(15), 3));
  const mat = new THREE.LineDashedMaterial({
    color: 0x1f6f9a, dashSize: 30, gapSize: 18,
    depthTest: false, depthWrite: false, transparent: true, opacity: 0.85,
  });
  const line = new THREE.Line(geo, mat);
  line.renderOrder = 999;
  line.frustumCulled = false;
  scene.add(line);
  _workplaneShadow = line;
  return line;
}
function _updateWorkplaneShadow(min, max, mesh) {
  const line = _ensureWorkplaneShadow();
  const a = new THREE.Vector3(min.x, min.y, min.z);
  const b = new THREE.Vector3(max.x, min.y, min.z);
  const c = new THREE.Vector3(max.x, min.y, max.z);
  const d = new THREE.Vector3(min.x, min.y, max.z);
  // Convert local-space AABB to world space, then snap Y to workplane.
  for (const v of [a, b, c, d]) { mesh.localToWorld(v); v.y = 0.5; }
  const pos = line.geometry.getAttribute('position');
  pos.array.set([
    a.x, a.y, a.z,  b.x, b.y, b.z,  c.x, c.y, c.z,  d.x, d.y, d.z,  a.x, a.y, a.z,
  ]);
  pos.needsUpdate = true;
  line.geometry.computeBoundingSphere();
  line.computeLineDistances();
  line.visible = true;
}

function updateDecorManip() {
  if (!decorManipEl) return;
  const mesh = _selectedDecorMesh();
  if (!mesh || _dmDragging) {
    if (!_dmDragging) decorManipEl.hidden = true;
    if (!_dmDragging && _workplaneShadow) _workplaneShadow.visible = false;
    if (!_dmDragging) return;
  }
  if (!mesh) {
    decorManipEl.hidden = true;
    if (_workplaneShadow) _workplaneShadow.visible = false;
    return;
  }
  decorManipEl.hidden = false;
  // World AABB
  if (mesh.geometry) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  }
  _dmBox.setFromObject(mesh);
  const rect = canvas.getBoundingClientRect();
  // Local AABB corners → world (use bounding box of the geometry then apply mesh matrix).
  const min = mesh.geometry?.boundingBox?.min;
  const max = mesh.geometry?.boundingBox?.max;
  if (!min || !max) { decorManipEl.hidden = true; return; }
  _updateWorkplaneShadow(min, max, mesh);
  const screenCorners = [];
  for (let i = 0; i < 8; i++) {
    const [sx, sy, sz] = _dmCornersLocal[i];
    _dmCornerWorld.set(
      sx > 0 ? max.x : min.x,
      sy > 0 ? max.y : min.y,
      sz > 0 ? max.z : min.z,
    );
    mesh.localToWorld(_dmCornerWorld);
    const p = _projectToScreen(_dmCornerWorld, rect);
    screenCorners.push(p);
    if (_dmCorners[i]) {
      _dmCorners[i].style.left = p.x + 'px';
      _dmCorners[i].style.top = p.y + 'px';
      _dmCorners[i].style.display = (p.z > 1) ? 'none' : '';
    }
  }
  // Center of mesh in screen space (used as the pivot for rotation arc placement).
  const center = new THREE.Vector3();
  _dmBox.getCenter(center);
  const sizeWorld = new THREE.Vector3();
  _dmBox.getSize(sizeWorld);
  const cs = _projectToScreen(center, rect);

  // Bottom mid-edge handles (±X, ±Z) and top-Y height handle.
  // Each lives at the midpoint of the corresponding face on the bottom plane,
  // except +y which is the top-face center.
  const edgePositions = {
    '+x': [ max.x, min.y, (min.z + max.z) / 2 ],
    '-x': [ min.x, min.y, (min.z + max.z) / 2 ],
    '+z': [ (min.x + max.x) / 2, min.y, max.z ],
    '-z': [ (min.x + max.x) / 2, min.y, min.z ],
    '+y': [ (min.x + max.x) / 2, max.y, (min.z + max.z) / 2 ],
  };
  const edgeScreen = {};
  _dmEdges.forEach((el) => {
    const key = el.dataset.edge;
    const w = edgePositions[key];
    if (!w) return;
    _dmCornerWorld.set(w[0], w[1], w[2]);
    mesh.localToWorld(_dmCornerWorld);
    const p = _projectToScreen(_dmCornerWorld, rect);
    edgeScreen[key] = p;
    el.style.left = p.x + 'px';
    el.style.top = p.y + 'px';
    el.style.display = (p.z > 1) ? 'none' : '';
  });

  // Tinkercad-style curved-arrow rotation handles — placed OUTSIDE the bbox
  // in screen space. We anchor each near the appropriate face midpoint and
  // push it outward along the screen-space normal so it sits clear of the
  // shape body.
  // Y (yaw): above the top face midpoint.
  // X (pitch): outside the +Z face midpoint at mid height.
  // Z (roll): outside the +X face midpoint at mid height.
  const rotAnchors = {
    y: [ (min.x + max.x) / 2, max.y, (min.z + max.z) / 2 ],
    x: [ (min.x + max.x) / 2, (min.y + max.y) / 2, max.z ],
    z: [ max.x, (min.y + max.y) / 2, (min.z + max.z) / 2 ],
  };
  const rotOffsets = {
    y: { x: 36, y: -36 },   // upper-right of top face
    x: { x: 0,  y: 44 },    // below the +Z face midpoint
    z: { x: 44, y: 0 },     // right of the +X face midpoint
  };
  _dmRots.forEach((r) => {
    const axis = r.dataset.axis;
    const w = rotAnchors[axis];
    const off = rotOffsets[axis];
    if (!w || !off) return;
    _dmCornerWorld.set(w[0], w[1], w[2]);
    mesh.localToWorld(_dmCornerWorld);
    const p = _projectToScreen(_dmCornerWorld, rect);
    r.style.left = (p.x + off.x) + 'px';
    r.style.top = (p.y + off.y) + 'px';
    r.style.display = (p.z > 1) ? 'none' : 'flex';
    // Live readout in degrees while dragging.
    if (r.classList.contains('dragging')) {
      const inst = decor.getById(lastSelectedDecorId);
      const rad = inst ? (inst[`r${axis}`] || 0) : 0;
      const deg = Math.round(THREE.MathUtils.radToDeg(rad));
      const span = r.querySelector('[data-rot-val]');
      if (span) span.textContent = deg + '°';
    }
  });
  // Numeric size readouts — anchor to the matching bottom-edge handle
  // (or top-Y handle for height) so they sit visually next to what they
  // control, exactly like Tinkercad.
  const labelAnchors = {
    x: edgeScreen['+x'] || edgeScreen['-x'],
    z: edgeScreen['+z'] || edgeScreen['-z'],
    y: edgeScreen['+y'],
  };
  const inst = decor.getById(lastSelectedDecorId);
  for (const lab of _dmSizes) {
    const axis = lab.dataset.axis;
    const p = labelAnchors[axis];
    if (!p) { lab.style.display = 'none'; continue; }
    // Push the label slightly outward so it doesn't sit on top of the handle.
    const dx = (axis === 'y') ? 22 : (axis === 'x') ? 22 : -22;
    const dy = (axis === 'y') ? -18 : 18;
    lab.style.left = (p.x + dx) + 'px';
    lab.style.top = (p.y + dy) + 'px';
    lab.style.display = (p.z > 1) ? 'none' : '';
    if (inst && !lab._editing) {
      const span = lab.querySelector('[data-val]');
      const baseSize = (axis === 'x') ? (max.x - min.x)
                     : (axis === 'y') ? (max.y - min.y)
                     : (max.z - min.z);
      const scl = (axis === 'x') ? inst.sx : (axis === 'y') ? inst.sy : inst.sz;
      const len = baseSize * scl;
      if (span) span.textContent = (Math.round(len * 10) / 10).toFixed(1);
    }
  }
  // Raise handle: float a black cone above the top-center of the mesh AABB.
  const raiseEl = document.getElementById('dmRaise');
  if (raiseEl) {
    const topCenter = new THREE.Vector3((min.x + max.x) / 2, max.y, (min.z + max.z) / 2);
    mesh.localToWorld(topCenter);
    // Lift the cone visually by ~32 px above the top face so it doesn't
    // collide with the H size readout.
    const top = _projectToScreen(topCenter, rect);
    raiseEl.style.left = top.x + 'px';
    raiseEl.style.top = (top.y - 24) + 'px';
    raiseEl.style.display = (top.z > 1) ? 'none' : 'flex';
    // Stem length scales with how high the shape currently sits above y=0.
    const inst = decor.getById(lastSelectedDecorId);
    const stem = raiseEl.querySelector('.raise-stem');
    if (stem) {
      const stemPx = Math.max(8, Math.min(60, (inst?.y ?? 0) * 0.05));
      stem.style.height = stemPx + 'px';
    }
    // Live readout (also updates outside drag so user sees current Y).
    const span = raiseEl.querySelector('.raise-readout [data-val]');
    if (span && inst) span.textContent = Math.round(inst.y).toString();
  }
}

// ── Drag interactions ──
let _dmDragging = false;

function _attachManipDrag() {
  if (!decorManipEl) return;
  // Corner drag → uniform scale based on distance from opposite corner in screen space.
  _dmCorners.forEach((el, idx) => {
    el.addEventListener('pointerdown', (ev) => {
      const mesh = _selectedDecorMesh();
      const inst = decor.getById(lastSelectedDecorId);
      if (!mesh || !inst) return;
      ev.preventDefault(); ev.stopPropagation();
      el.setPointerCapture(ev.pointerId);
      _dmDragging = true;
      decorManipEl.classList.add('dragging');
      controls.enabled = false;
      // Opposite corner index (XOR all 3 bits).
      const oppIdx = idx ^ 7;
      const rect = canvas.getBoundingClientRect();
      const min = mesh.geometry.boundingBox.min;
      const max = mesh.geometry.boundingBox.max;
      const oppLocal = _dmCornersLocal[oppIdx];
      _dmCornerWorld.set(
        oppLocal[0] > 0 ? max.x : min.x,
        oppLocal[1] > 0 ? max.y : min.y,
        oppLocal[2] > 0 ? max.z : min.z,
      );
      mesh.localToWorld(_dmCornerWorld);
      const oppScreen = _projectToScreen(_dmCornerWorld, rect);
      const startMouse = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
      const startDist = Math.hypot(startMouse.x - oppScreen.x, startMouse.y - oppScreen.y);
      const startScale = { x: inst.sx, y: inst.sy, z: inst.sz };
      const onMove = (e) => {
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const dist = Math.hypot(mx - oppScreen.x, my - oppScreen.y);
        let f = startDist > 0 ? dist / startDist : 1;
        f = Math.max(0.05, f);
        // Shift = uniform 3-axis scale; default = horizontal scale only (X+Z),
        // matching Tinkercad's corner-handle behaviour for the workplane.
        const uniform = !!e.shiftKey;
        let nx = startScale.x * f;
        let nz = startScale.z * f;
        let ny = uniform ? (startScale.y * f) : startScale.y;
        if (gizmoSnap) {
          const step = 0.1;
          nx = Math.max(step, Math.round(nx / step) * step);
          nz = Math.max(step, Math.round(nz / step) * step);
          if (uniform) ny = Math.max(step, Math.round(ny / step) * step);
        }
        inst.sx = nx; inst.sy = ny; inst.sz = nz;
        mesh.scale.set(nx, ny, nz);
        if (typeof showInspectorPopup === 'function') showInspectorPopup();
      };
      const onUp = (e) => {
        try { el.releasePointerCapture(ev.pointerId); } catch {}
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        _dmDragging = false;
        decorManipEl.classList.remove('dragging');
        controls.enabled = true;
        pushUndo();
        refreshInspector();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  });

  // Ring drag was replaced by curved-arrow rotation handles + edge handles below.
  // Curved-arrow rotation drag — each .dm-rot rotates the shape around its axis
  // based on angular delta around the mesh center in screen space.
  _dmRots.forEach((rot) => {
    const startDrag = (ev) => {
      const mesh = _selectedDecorMesh();
      const inst = decor.getById(lastSelectedDecorId);
      if (!mesh || !inst) return;
      ev.preventDefault(); ev.stopPropagation();
      try { rot.setPointerCapture(ev.pointerId); } catch {}
      _dmDragging = true;
      decorManipEl.classList.add('dragging');
      rot.classList.add('dragging');
      controls.enabled = false;
      const axis = rot.dataset.axis;
      const rect = canvas.getBoundingClientRect();
      _dmBox.setFromObject(mesh);
      const center = new THREE.Vector3();
      _dmBox.getCenter(center);
      const cs = _projectToScreen(center, rect);
      const startAngle = Math.atan2((ev.clientY - rect.top) - cs.y, (ev.clientX - rect.left) - cs.x);
      const startRot = { x: inst.rx, y: inst.ry, z: inst.rz };
      const onMove = (e) => {
        const a = Math.atan2((e.clientY - rect.top) - cs.y, (e.clientX - rect.left) - cs.x);
        let delta = a - startAngle;
        if (axis === 'y') delta = -delta; // top-down view inverts.
        let next = startRot[axis] + delta;
        if (gizmoSnap) {
          const step = Math.PI / 8; // 22.5°
          next = Math.round(next / step) * step;
        }
        inst[`r${axis}`] = next;
        mesh.rotation[axis] = next;
        if (typeof showInspectorPopup === 'function') showInspectorPopup();
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        _dmDragging = false;
        decorManipEl.classList.remove('dragging');
        rot.classList.remove('dragging');
        controls.enabled = true;
        pushUndo();
        refreshInspector();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };
    rot.addEventListener('pointerdown', startDrag);
  });

  // Single-axis edge/top-y scale handles. Each one scales exactly one axis
  // by tracking screen-space distance between the cursor and the OPPOSITE
  // mid-face anchor (for ±X/±Z) or the bottom-center (for +Y).
  _dmEdges.forEach((el) => {
    el.addEventListener('pointerdown', (ev) => {
      const mesh = _selectedDecorMesh();
      const inst = decor.getById(lastSelectedDecorId);
      if (!mesh || !inst) return;
      ev.preventDefault(); ev.stopPropagation();
      try { el.setPointerCapture(ev.pointerId); } catch {}
      _dmDragging = true;
      decorManipEl.classList.add('dragging');
      controls.enabled = false;
      const key = el.dataset.edge;
      const axisLetter = key[1]; // 'x' | 'y' | 'z'
      const rect = canvas.getBoundingClientRect();
      const min = mesh.geometry.boundingBox.min;
      const max = mesh.geometry.boundingBox.max;
      // Opposite anchor in local space.
      const oppLocal = (() => {
        if (key === '+x') return [ min.x, min.y, (min.z + max.z) / 2 ];
        if (key === '-x') return [ max.x, min.y, (min.z + max.z) / 2 ];
        if (key === '+z') return [ (min.x + max.x) / 2, min.y, min.z ];
        if (key === '-z') return [ (min.x + max.x) / 2, min.y, max.z ];
        if (key === '+y') return [ (min.x + max.x) / 2, min.y, (min.z + max.z) / 2 ];
        return [0,0,0];
      })();
      _dmCornerWorld.set(oppLocal[0], oppLocal[1], oppLocal[2]);
      mesh.localToWorld(_dmCornerWorld);
      const oppScreen = _projectToScreen(_dmCornerWorld, rect);
      const startMouse = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
      const startDist = Math.hypot(startMouse.x - oppScreen.x, startMouse.y - oppScreen.y);
      const startScale = { x: inst.sx, y: inst.sy, z: inst.sz };
      const onMove = (e) => {
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const dist = Math.hypot(mx - oppScreen.x, my - oppScreen.y);
        let f = startDist > 0 ? dist / startDist : 1;
        f = Math.max(0.05, f);
        let nx = startScale.x, ny = startScale.y, nz = startScale.z;
        if (axisLetter === 'x') nx = startScale.x * f;
        else if (axisLetter === 'y') ny = startScale.y * f;
        else if (axisLetter === 'z') nz = startScale.z * f;
        if (gizmoSnap) {
          const step = 0.1;
          if (axisLetter === 'x') nx = Math.max(step, Math.round(nx / step) * step);
          if (axisLetter === 'y') ny = Math.max(step, Math.round(ny / step) * step);
          if (axisLetter === 'z') nz = Math.max(step, Math.round(nz / step) * step);
        }
        inst.sx = nx; inst.sy = ny; inst.sz = nz;
        mesh.scale.set(nx, ny, nz);
        if (typeof showInspectorPopup === 'function') showInspectorPopup();
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        _dmDragging = false;
        decorManipEl.classList.remove('dragging');
        controls.enabled = true;
        pushUndo();
        refreshInspector();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  });

  // Numeric size readout → click to edit, type a new length, Enter/blur to commit.
  _dmSizes.forEach((lab) => {
    lab.addEventListener('click', (ev) => {
      const mesh = _selectedDecorMesh();
      const inst = decor.getById(lastSelectedDecorId);
      if (!mesh || !inst || lab._editing) return;
      ev.stopPropagation();
      const axis = lab.dataset.axis;
      const min = mesh.geometry.boundingBox.min;
      const max = mesh.geometry.boundingBox.max;
      const baseSize = (axis === 'x') ? (max.x - min.x)
                     : (axis === 'y') ? (max.y - min.y)
                     : (max.z - min.z);
      const scl = (axis === 'x') ? inst.sx : (axis === 'y') ? inst.sy : inst.sz;
      const cur = (Math.round(baseSize * scl * 10) / 10).toFixed(1);
      lab._editing = true;
      const letter = (axis === 'x') ? 'L' : (axis === 'y') ? 'H' : 'W';
      lab.innerHTML = letter + ':<input type="number" step="0.1" min="0.1" value="' + cur + '" />';
      const inp = lab.querySelector('input');
      inp.focus(); inp.select();
      const commit = () => {
        const v = parseFloat(inp.value);
        if (isFinite(v) && v > 0 && baseSize > 0) {
          const newScale = v / baseSize;
          if (axis === 'x') { inst.sx = newScale; mesh.scale.x = newScale; }
          else if (axis === 'y') { inst.sy = newScale; mesh.scale.y = newScale; }
          else { inst.sz = newScale; mesh.scale.z = newScale; }
          pushUndo();
          refreshInspector();
        }
        lab._editing = false;
        lab.innerHTML = letter + ':<span data-val>' + cur + '</span>';
      };
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { lab._editing = false; lab.innerHTML = letter + ':<span data-val>' + cur + '</span>'; }
      });
      inp.addEventListener('blur', commit);
    });
  });

  // ── Tinkercad-style raise handle (Y-axis translate) ──
  // Drag the floating cone above the shape to lift/lower it. The cone reads
  // out the current Y in mm. We screen-space project drag delta onto world-Y
  // by computing the world-units-per-pixel at the mesh's depth, so the
  // cursor stays glued to the cone regardless of camera zoom.
  const raiseEl = document.getElementById('dmRaise');
  if (raiseEl) {
    const cone = raiseEl.querySelector('.raise-cone');
    const stem = raiseEl.querySelector('.raise-stem');
    const startRaiseDrag = (ev) => {
      const mesh = _selectedDecorMesh();
      const inst = decor.getById(lastSelectedDecorId);
      if (!mesh || !inst) return;
      ev.preventDefault(); ev.stopPropagation();
      try { ev.target.setPointerCapture(ev.pointerId); } catch {}
      _dmDragging = true;
      decorManipEl.classList.add('dragging');
      raiseEl.classList.add('dragging');
      controls.enabled = false;
      const startY = inst.y;
      // Compute world-units-per-screen-pixel at the mesh depth so vertical
      // pointer travel maps 1:1 to world-Y motion at the current zoom.
      const meshWorld = new THREE.Vector3();
      mesh.getWorldPosition(meshWorld);
      const camDist = activeCamera.position.distanceTo(meshWorld);
      const fovRad = (activeCamera.fov || 55) * Math.PI / 180;
      const worldPerPx = (2 * Math.tan(fovRad / 2) * camDist) / canvas.clientHeight;
      const startMouseY = ev.clientY;
      const onMove = (e) => {
        const dy = e.clientY - startMouseY;
        // Screen-Y inverted vs. world-Y (drag up = lift).
        let nextY = startY - dy * worldPerPx;
        if (gizmoSnap && snapStep > 0) {
          nextY = Math.round(nextY / snapStep) * snapStep;
        }
        inst.y = nextY;
        mesh.position.y = nextY;
        const span = raiseEl.querySelector('.raise-readout [data-val]');
        if (span) span.textContent = Math.round(nextY).toString();
        if (typeof showInspectorPopup === 'function') showInspectorPopup();
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        _dmDragging = false;
        decorManipEl.classList.remove('dragging');
        raiseEl.classList.remove('dragging');
        controls.enabled = true;
        pushUndo();
        refreshInspector();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };
    cone?.addEventListener('pointerdown', startRaiseDrag);
    stem?.addEventListener('pointerdown', startRaiseDrag);
  }
}
_attachManipDrag();

// ── Align panel button wiring ──
document.getElementById('alignPanel')?.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-axis]');
  if (!btn) return;
  alignSelection(btn.dataset.axis, btn.dataset.mode);
});

// ── Workplane axis badge: shows current view (TOP / FRONT / SIDE / PERSP) ──
const _axisBadgeEl = document.getElementById('axisBadge');
function _updateAxisBadge() {
  if (!_axisBadgeEl) return;
  const v = camera.position.clone().normalize();
  // Pure top-down → TOP; pure -Z → FRONT; pure +X → SIDE; otherwise PERSP.
  const TH = 0.95;
  let label = 'PERSP';
  if (v.y > TH) label = 'TOP';
  else if (Math.abs(v.z) > TH && v.y < 0.4) label = v.z < 0 ? 'BACK' : 'FRONT';
  else if (Math.abs(v.x) > TH && v.y < 0.4) label = v.x < 0 ? 'LEFT' : 'SIDE';
  if (_axisBadgeEl.textContent !== label) _axisBadgeEl.textContent = label;
}

// Hook into the existing render loop by appending to setAnimationLoop callback.
// The original loop already calls updateActionRing() — we piggy-back via a separate
// rAF tick to avoid re-wiring the loop.
(function _dmTick() {
  try { updateDecorManip(); } catch {}
  try { _updateAxisBadge(); } catch {}
  requestAnimationFrame(_dmTick);
})();

// Expose for debugging
// ── Header buttons (top-tabs, hamburger menu, right-aside tabs) ────────
// These were rendered in editor.html but had no JS handlers — clicking did
// nothing. We wire each to a sensible Tinkercad-equivalent action.

// 1) Hamburger menu — opens a small dropdown with file actions.
const _menuBtn = document.getElementById('menuBtn');
const _menuDropdown = document.getElementById('menuDropdown');
function _closeMenu() { if (_menuDropdown) _menuDropdown.hidden = true; }
_menuBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!_menuDropdown) return;
  _menuDropdown.hidden = !_menuDropdown.hidden;
});
// Use both click + pointerdown in capture phase, scoped to window so canvas
// pointer interactions still close the menu even when they preventDefault.
const _maybeCloseMenu = (e) => {
  if (!_menuDropdown || _menuDropdown.hidden) return;
  if (e.target === _menuBtn || _menuBtn?.contains(e.target)) return;
  if (!_menuDropdown.contains(e.target)) _closeMenu();
};
window.addEventListener('pointerdown', _maybeCloseMenu, true);
window.addEventListener('click', _maybeCloseMenu, true);
_menuDropdown?.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  _closeMenu();
  if (action === 'new') {
    if (!confirm('Start a new track? Unsaved changes will be lost.')) return;
    track.clear(); decor.clear(); rebuildAll(); rebuildAllDecor();
    clearSelection(); pushUndo(); toast('New track');
  } else if (action === 'open') {
    const url = prompt('Paste a track share URL or ?track=… code:');
    if (!url) return;
    try {
      const m = url.match(/[?&]track=([^&]+)/);
      const code = m ? m[1] : url.trim();
      const decoded = decodeTrack(code);
      loadFromJSON(decoded);
      toast('Track loaded');
    } catch (err) { toast('Invalid track code'); console.warn(err); }
  } else if (action === 'export') {
    const json = JSON.stringify(saveJSON(), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (track.name || 'track').replace(/[^a-z0-9_-]+/gi, '_') + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Exported JSON');
  } else if (action === 'import') {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const f = input.files?.[0]; if (!f) return;
      try {
        const text = await f.text();
        loadFromJSON(JSON.parse(text));
        toast('Imported');
      } catch (err) { toast('Import failed'); console.warn(err); }
    };
    input.click();
  } else if (action === 'save') {
    document.getElementById('saveBtn')?.click();
  } else if (action === 'clear') {
    document.getElementById('clearBtn')?.click()
      ?? (confirm('Clear all pieces?') && (track.clear(), decor.clear(), rebuildAll(), rebuildAllDecor(), clearSelection(), pushUndo()));
  }
});

// 2) Top tabs — Design / Simulate / Home / Library / Adjust / Brick view.
const _topTabs = [
  document.getElementById('topTabDesign'),
  document.getElementById('topTabSimulate'),
  document.getElementById('topTabHome'),
  document.getElementById('topTabLibrary'),
  document.getElementById('topTabAdjust'),
  document.getElementById('topTabBrick'),
].filter(Boolean);
function _setTopTabActive(btn) {
  for (const t of _topTabs) t.classList.toggle('active', t === btn);
}
document.getElementById('topTabDesign')?.addEventListener('click', (e) => {
  _setTopTabActive(e.currentTarget); // current view
});
document.getElementById('topTabSimulate')?.addEventListener('click', () => {
  document.getElementById('playBtn')?.click();
});
document.getElementById('topTabHome')?.addEventListener('click', () => {
  if (confirm('Leave the editor and return to the lobby? Unsaved work will be lost.')) {
    window.location.href = '/index.html';
  }
});
document.getElementById('topTabLibrary')?.addEventListener('click', () => {
  document.getElementById('shareBtn')?.click();
});
document.getElementById('topTabAdjust')?.addEventListener('click', (e) => {
  _setTopTabActive(e.currentTarget);
  document.getElementById('settingsBtn')?.click();
  // Reset visual state shortly so it doesn't look stuck.
  setTimeout(() => _setTopTabActive(document.getElementById('topTabDesign')), 1200);
});
// Brick view = toggle wireframe rendering on every placement + decor mesh.
let _brickViewOn = false;
document.getElementById('topTabBrick')?.addEventListener('click', (e) => {
  _brickViewOn = !_brickViewOn;
  e.currentTarget.classList.toggle('active', _brickViewOn);
  const apply = (root) => root.traverse?.((o) => {
    if (o.isMesh && o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m.wireframe = _brickViewOn;
    }
  });
  scene.traverse((o) => apply(o));
  toast(_brickViewOn ? 'Wireframe ON' : 'Wireframe OFF');
});

// 3) Right-aside tabs — Shapes / Workplane.
const _rightTabs = [
  document.getElementById('tabShapes'),
  document.getElementById('tabWorkplane'),
].filter(Boolean);
function _setRightTab(name) {
  const map = { shapes: 'tabShapes', workplane: 'tabWorkplane' };
  for (const t of _rightTabs) t.classList.toggle('active', t.id === map[name]);
  if (name === 'workplane') {
    // Pop the existing terrain settings popup as the "workplane" panel.
    document.getElementById('settingsBtn')?.click();
    // Auto-revert active state so the Shapes palette stays usable.
    setTimeout(() => {
      for (const t of _rightTabs) t.classList.toggle('active', t.id === 'tabShapes');
    }, 1200);
  }
}
document.getElementById('tabShapes')?.addEventListener('click', () => _setRightTab('shapes'));
document.getElementById('tabWorkplane')?.addEventListener('click', () => _setRightTab('workplane'));

window.__studio = { track, decor, scene, camera, renderer, rebuildAll, rebuildAllDecor, refreshHud, refreshPlayButton, selectDecor, rebuildAllCSG, rebuildCSGForGroup, csgMeshByGid, decorMeshById, groupSelection, ungroupSelection, setActiveTool, selectedIds, selectedDecorIds, THREE, SEGMENTS, SEGMENT_KEYS, autoOrientRot };
