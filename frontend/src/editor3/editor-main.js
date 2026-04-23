/**
 * editor-main.js — Track Studio editor app.
 *
 * Three.js scene + orbit camera + grid raycast for placement.
 * No external editor framework; tight scope, predictable behavior.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { SEGMENTS, SEGMENT_KEYS, TILE } from './segments.js';
import { buildSegmentMesh } from './segment-builder.js';
import { Track, encodeTrack, decodeTrack } from './track-data.js';
import { KARTS, resolveSelectedKartId } from './kart-catalog.js';
import { preloadAllKarts, cloneKart } from './kart-loader.js';
import {
  DECOR, DECOR_KEYS, DECOR_CATEGORY_ORDER, DECOR_CATEGORY_LABELS,
  isDecorKey, DecorStore, buildDecorMesh, syncDecorMesh, getDecorMaterial,
} from './decor.js';

const STORAGE_KEY = 'gloKartsStudio.lastTrack';

// ── Scene ─────────────────────────────────────────────────────
const canvas = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xeaf6f8);
scene.fog = new THREE.Fog(0xeaf6f8, 120, 600);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
// Defaults scale with TILE so the editor frames the same number of cells
// regardless of world units.
camera.position.set(TILE * 10, TILE * 10, TILE * 10);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = TILE * 2;
controls.maxDistance = TILE * 50;
controls.maxPolarAngle = Math.PI * 0.48;
controls.mouseButtons = {
  LEFT: null,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: THREE.MOUSE.ROTATE,
};
controls.touches = {
  ONE: THREE.TOUCH.ROTATE,
  TWO: THREE.TOUCH.DOLLY_PAN,
};

// Lights
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(60, 120, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -80; sun.shadow.camera.right = 80;
sun.shadow.camera.top = 80; sun.shadow.camera.bottom = -80;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 300;
scene.add(sun);
scene.add(new THREE.AmbientLight(0x6b7a92, 0.55));
scene.add(new THREE.HemisphereLight(0x88aaff, 0x222530, 0.4));

// Ground plane (raycast target for placement)
const groundGeo = new THREE.PlaneGeometry(2000, 2000);
const groundMat = new THREE.MeshStandardMaterial({ color: 0xcfe7f0, roughness: 1, metalness: 0.0 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
ground.name = 'ground';
scene.add(ground);

// Grid helper
const grid = new THREE.GridHelper(40 * TILE, 40, 0x9ec9d6, 0xc5dde6);
grid.position.y = 0.01;
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
const selectedDecorIds = new Set();
let lastSelectedDecorId = null;
let gizmoMode = 'translate';
let gizmoSnap = true;
let snapStep = 1.0;

let activeKey = SEGMENT_KEYS[0];
let activeRot = 0;       // 0..3
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
    new THREE.EdgesGeometry(new THREE.BoxGeometry(TILE, 1, TILE)),
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
    b.position.set(p.gx * TILE, 1, p.gz * TILE);
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
  _thumbCam = new THREE.PerspectiveCamera(35, 1, 0.1, 500);
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
      const dr = def.defaultRot || [0, 0, 0];
      const ds = def.defaultScale || [1, 1, 1];
      mesh = new THREE.Mesh(def.build(), getDecorMaterial(def.color, false).clone());
      mesh.rotation.set(dr[0], dr[1], dr[2]);
      mesh.scale.set(ds[0], ds[1], ds[2]);
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
const CATEGORY_ORDER = ['road', 'junction', 'height', 'special', ...DECOR_CATEGORY_ORDER];
const CATEGORY_LABELS = {
  road: 'Road',
  junction: 'Junctions',
  height: 'Vertical',
  special: 'Special',
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
    if (catFilter && (def.category || 'special') !== catFilter && !(catFilter === 'road' && ['road','junction','height','special'].includes(def.category))) return;
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
        activeKey = key;
        activeRot = 0;
        paletteEl.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.key === key));
        updatePreview();
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
if (paletteSearchEl) {
  paletteSearchEl.addEventListener('input', () => {
    paletteFilter = paletteSearchEl.value;
    buildPalette();
  });
}

// ── Preview ghost ─────────────────────────────────────────────
function updatePreview() {
  while (previewGroup.children.length) previewGroup.remove(previewGroup.children[0]);
  if (isDecorKey(activeKey)) {
    const def = DECOR[activeKey];
    const dr = def.defaultRot || [0, 0, 0];
    const ds = def.defaultScale || [1, 1, 1];
    const m = new THREE.MeshStandardMaterial({
      color: def.color, roughness: 0.65, metalness: 0.05,
      transparent: true, opacity: 0.55, depthWrite: false,
    });
    previewMesh = new THREE.Mesh(def.build(), m);
    previewMesh.rotation.set(dr[0], dr[1], dr[2]);
    previewMesh.scale.set(ds[0], ds[1], ds[2]);
    previewGroup.add(previewMesh);
    if (previewCell) {
      const y = def.defaultY || 0;
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
  // sitting on top of a road segment can still be picked.
  const decorHits = raycaster.intersectObjects(decorGroup.children, true);
  if (decorHits.length) {
    let obj = decorHits[0].object;
    while (obj && obj.userData.decorId == null) obj = obj.parent;
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
  if (!hit) {
    previewCell = null;
    if (previewMesh) previewMesh.visible = false;
    return;
  }
  // Overlay segments (spawn) are allowed to land on top of existing placements,
  // so prefer the underlying cell coords whenever they are available.
  const overlayActive = track.isOverlay(activeKey);
  const showCell = hit.kind === 'cell' || (overlayActive && hit.gx != null);
  if (showCell) {
    previewCell = { gx: hit.gx, gz: hit.gz };
    if (!previewMesh) updatePreview();
    previewMesh.visible = true;
    previewMesh.position.set(hit.gx * TILE, 0, hit.gz * TILE);
    previewMesh.rotation.y = -activeRot * Math.PI / 2;
    // tint based on validity
    const valid = track.isClear(activeKey, hit.gx, hit.gz, activeRot);
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
      mouseDownState.anchorStart = { gx: anchor.gx, gz: anchor.gz };
      mouseDownState.lastCell = { gx: anchor.gx, gz: anchor.gz };
    }
  }
});

canvas.addEventListener('mousemove', (e) => {
  if (!mouseDownState || !mouseDownState.snapshot) return;
  const dx = e.clientX - mouseDownState.startX;
  const dy = e.clientY - mouseDownState.startY;
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
    // Refresh the snapshot ids after move (they have new ids now).
    mouseDownState.snapshot = [...selectedIds].map(id => track.getById(id)).filter(Boolean)
      .map(p => ({ id: p.id, key: p.key, gx: p.gx, gz: p.gz, rot: p.rot }));
    const anchorNow = mouseDownState.snapshot.find(p => p.id === lastSelectedId) || mouseDownState.snapshot[0];
    if (anchorNow) {
      mouseDownState.anchorId = anchorNow.id;
      mouseDownState.anchorStart = { gx: anchorNow.gx - offDx, gz: anchorNow.gz - offDz };
    }
  }
});

window.addEventListener('mouseup', (e) => {
  if (e.button !== 0 || !mouseDownState) { mouseDownState = null; return; }
  const wasDragging = mouseDownState.dragging && mouseDownState.movedSinceStart;
  mouseDownState = null;
  if (wasDragging) {
    _lastDragConsumedAt = performance.now();
    pushUndo();
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
    const inst = decor.add({ type: activeKey, x, y: DECOR[activeKey].defaultY || 0, z });
    if (inst) {
      addDecorMesh(inst);
      selectDecor(inst.id, 'replace');
      pushUndo();
      refreshHud();
    }
    return;
  }
  if (hit.gx == null || hit.gz == null) return;
  // Click on empty cell with no modifier clears the selection.
  if (!e.shiftKey && !e.ctrlKey && !e.metaKey) clearSelection();
  // Place
  const placement = track.place(activeKey, hit.gx, hit.gz, activeRot);
  if (placement) {
    addPlacementMesh(placement);
    pushUndo();
    refreshHud();
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
  if (mode === 'add') {
    selectedDecorIds.add(id);
    lastSelectedDecorId = id;
  } else if (mode === 'toggle') {
    if (selectedDecorIds.has(id)) {
      selectedDecorIds.delete(id);
      if (lastSelectedDecorId === id) lastSelectedDecorId = selectedDecorIds.size ? [...selectedDecorIds].pop() : null;
    } else {
      selectedDecorIds.add(id);
      lastSelectedDecorId = id;
    }
  } else {
    selectedDecorIds.clear();
    selectedDecorIds.add(id);
    lastSelectedDecorId = id;
  }
  selectedIds.clear();
  lastSelectedId = null;
  refreshSelectionBoxes();
  refreshDecorGizmo();
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
  const newIds = [];
  for (const id of selectedDecorIds) {
    const d = decor.getById(id);
    if (!d) continue;
    const copy = decor.add({
      type: d.type,
      x: d.x + 2, y: d.y, z: d.z + 2,
      rx: d.rx, ry: d.ry, rz: d.rz,
      sx: d.sx, sy: d.sy, sz: d.sz,
      color: d.color, isHole: d.isHole,
    });
    if (copy) { addDecorMesh(copy); newIds.push(copy.id); }
  }
  if (newIds.length) {
    selectedDecorIds.clear();
    for (const id of newIds) selectedDecorIds.add(id);
    lastSelectedDecorId = newIds[newIds.length - 1];
    refreshDecorGizmo();
    refreshInspector();
    pushUndo();
    refreshHud();
  }
}
let transformControls = null;
function ensureTransformControls() {
  if (transformControls) return transformControls;
  transformControls = new TransformControls(activeCamera, renderer.domElement);
  transformControls.setSize(0.85);
  transformControls.addEventListener('dragging-changed', (e) => {
    controls.enabled = !e.value;
    if (!e.value) {
      syncSelectedDecorFromMesh();
      pushUndo();
      refreshInspector();
    }
  });
  transformControls.addEventListener('objectChange', () => {
    syncSelectedDecorFromMesh();
    if (selectedDecorIds.size > 0) showInspectorPopup();
  });
  const helper = transformControls.getHelper ? transformControls.getHelper() : transformControls;
  scene.add(helper);
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
  if (selectedDecorIds.size === 0 || lastSelectedDecorId == null) {
    transformControls.detach();
    if (gizmoBar) gizmoBar.hidden = true;
    return;
  }
  const mesh = decorMeshById.get(lastSelectedDecorId);
  if (!mesh) { transformControls.detach(); if (gizmoBar) gizmoBar.hidden = true; return; }
  transformControls.attach(mesh);
  transformControls.setMode(gizmoMode);
  transformControls.translationSnap = gizmoSnap && snapStep > 0 ? snapStep : null;
  transformControls.rotationSnap = gizmoSnap ? Math.PI / 12 : null;
  transformControls.scaleSnap = gizmoSnap ? 0.1 : null;
  if (gizmoBar) gizmoBar.hidden = false;
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
    transformControls.rotationSnap = gizmoSnap ? Math.PI / 12 : null;
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
      activeRot = (activeRot + 1) % 4;
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

  // ── Arrow-key nudge (group move by 1 cell) ──
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
const TINKER_PALETTE = [
  0xe6453a, 0xee8b1a, 0xead33a, 0x4ab84a, 0x2e9bd6,
  0x9b6dc6, 0xf06ec6, 0x6e7378, 0xb0b6bf, 0x2a2f36,
  0xffffff, 0xff7a3a, 0xc4a06b, 0x4ec0a3, 0xff5c8a,
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
let _ipBound = false;
function bindInspectorPopupOnce() {
  if (_ipBound) return; _ipBound = true;
  const upd = (key) => (v) => {
    const d = decor.getById(lastSelectedDecorId);
    if (!d) return;
    d[key] = v;
  };
  const updRad = (key) => (v) => {
    const d = decor.getById(lastSelectedDecorId);
    if (!d) return;
    d[key] = v * Math.PI / 180;
  };
  _bindPair('decorX_r', 'decorX', upd('x'));
  _bindPair('decorY_r', 'decorY', upd('y'));
  _bindPair('decorZ_r', 'decorZ', upd('z'));
  _bindPair('decorRX_r', 'decorRX', updRad('rx'));
  _bindPair('decorRY_r', 'decorRY', updRad('ry'));
  _bindPair('decorRZ_r', 'decorRZ', updRad('rz'));
  _bindPair('decorSX_r', 'decorSX', (v) => upd('sx')(Math.max(0.05, v)));
  _bindPair('decorSY_r', 'decorSY', (v) => upd('sy')(Math.max(0.05, v)));
  _bindPair('decorSZ_r', 'decorSZ', (v) => upd('sz')(Math.max(0.05, v)));
  document.querySelectorAll('#inspectorPopup .ip-tab').forEach(b => {
    b.addEventListener('click', () => {
      const mode = b.dataset.mode;
      document.querySelectorAll('#inspectorPopup .ip-tab').forEach(t => t.classList.toggle('active', t === b));
      const d = decor.getById(lastSelectedDecorId);
      if (!d) return;
      d.isHole = (mode === 'hole');
      applySelectedDecor();
      pushUndo();
    });
  });
  document.getElementById('ipClose')?.addEventListener('click', () => clearSelection());
}
function showInspectorPopup() {
  const pop = document.getElementById('inspectorPopup');
  if (!pop) return;
  bindInspectorPopupOnce();
  if (selectedDecorIds.size > 1) {
    document.getElementById('ipTitle').textContent = selectedDecorIds.size + ' objects';
  } else {
    const d = decor.getById(lastSelectedDecorId);
    if (!d) { pop.hidden = true; return; }
    const def = DECOR[d.type];
    document.getElementById('ipTitle').textContent = def.label;
    _setRange('decorX_r', 'decorX', round2(d.x));
    _setRange('decorY_r', 'decorY', round2(d.y));
    _setRange('decorZ_r', 'decorZ', round2(d.z));
    _setRange('decorRX_r', 'decorRX', Math.round(d.rx * 180 / Math.PI));
    _setRange('decorRY_r', 'decorRY', Math.round(d.ry * 180 / Math.PI));
    _setRange('decorRZ_r', 'decorRZ', Math.round(d.rz * 180 / Math.PI));
    _setRange('decorSX_r', 'decorSX', round2(d.sx));
    _setRange('decorSY_r', 'decorSY', round2(d.sy));
    _setRange('decorSZ_r', 'decorSZ', round2(d.sz));
    buildColorSwatches(d.color);
    document.querySelectorAll('#inspectorPopup .ip-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === (d.isHole ? 'hole' : 'solid'));
    });
  }
  pop.hidden = false;
  positionInspectorPopup();
}
function hideInspectorPopup() {
  const pop = document.getElementById('inspectorPopup');
  if (pop) pop.hidden = true;
}
function positionInspectorPopup() {
  const pop = document.getElementById('inspectorPopup');
  if (!pop || pop.hidden) return;
  if (lastSelectedDecorId == null) return;
  const mesh = decorMeshById.get(lastSelectedDecorId);
  if (!mesh) return;
  const v = new THREE.Vector3();
  mesh.getWorldPosition(v);
  v.y += 2;
  v.project(activeCamera);
  if (v.z > 1) { pop.hidden = true; return; }
  const rect = canvas.getBoundingClientRect();
  const px = (v.x * 0.5 + 0.5) * rect.width + 60;
  const py = (-v.y * 0.5 + 0.5) * rect.height - 40;
  const x = Math.max(8, Math.min(rect.width - 240, px));
  const y = Math.max(8, Math.min(rect.height - 380, py));
  pop.style.left = x + 'px';
  pop.style.top = y + 'px';
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
document.getElementById('loadBtn').addEventListener('click', () => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) { toast('No saved track'); return; }
  loadFromJSON(JSON.parse(raw));
  toast('Loaded');
});
document.getElementById('clearBtn').addEventListener('click', () => {
  if (!confirm('Clear all pieces?')) return;
  track.clear();
  decor.clear();
  rebuildAll();
  rebuildAllDecor();
  clearSelection();
  pushUndo();
});
document.getElementById('undoBtn').addEventListener('click', doUndo);

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
  kartPreviewAnchor.position.set(spawn.gx * TILE, 0.2, spawn.gz * TILE);
  kartPreviewAnchor.rotation.y = -spawn.rot * Math.PI / 2;
}
// Kick off kart preload so the playtest swap is instant.
preloadAllKarts([activeKartId]);
updateKartPreview(activeKartId);

// ── Terrain controls ──────────────────────────────────────────
const TERRAIN_KEY = 'gloKartsStudio.terrain';
const terrainState = {
  ground: '#cfe7f0',
  sky: '#eaf6f8',
  grid: true,
  fog: true,
};
function applyTerrain() {
  groundMat.color.set(terrainState.ground);
  scene.background = new THREE.Color(terrainState.sky);
  scene.fog = terrainState.fog ? new THREE.Fog(terrainState.sky, 120, 600) : null;
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
  orthoCamera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 0.1, 2000);
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
    case 'top':   pos = target.clone().add(new THREE.Vector3(0, dist, 0.001)); break;
    case 'front': pos = target.clone().add(new THREE.Vector3(0, dist * 0.3, dist)); break;
    case 'side':  pos = target.clone().add(new THREE.Vector3(dist, dist * 0.3, 0)); break;
    case 'iso':
    default:      pos = target.clone().add(new THREE.Vector3(dist * 0.7, dist * 0.7, dist * 0.7)); break;
  }
  activeCamera.position.copy(pos);
  activeCamera.lookAt(target);
  controls.update();
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
  _ringWorld.set(p.gx * TILE, 6, p.gz * TILE);
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
document.getElementById('alignBtn')?.addEventListener('click', () => toast('Align: select multiple shapes'));
document.getElementById('groupBtn')?.addEventListener('click', () => toast('Group: coming soon'));
document.getElementById('ungroupBtn')?.addEventListener('click', () => toast('Ungroup: coming soon'));

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

// Reposition inspector popup on every frame (cheap, runs from render loop)
const _origAnimLoop = renderer.animation?.loop;
const _ipTick = () => { positionInspectorPopup(); requestAnimationFrame(_ipTick); };
requestAnimationFrame(_ipTick);

// Expose for debugging
window.__studio = { track, decor, scene, camera, renderer, rebuildAll, rebuildAllDecor, refreshHud, refreshPlayButton, selectDecor };
