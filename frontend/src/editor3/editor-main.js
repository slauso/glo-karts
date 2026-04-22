/**
 * editor-main.js — Track Studio editor app.
 *
 * Three.js scene + orbit camera + grid raycast for placement.
 * No external editor framework; tight scope, predictable behavior.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SEGMENTS, SEGMENT_KEYS, TILE } from './segments.js';
import { buildSegmentMesh } from './segment-builder.js';
import { Track, encodeTrack, decodeTrack } from './track-data.js';
import { KARTS, resolveSelectedKartId } from './kart-catalog.js';
import { preloadAllKarts, cloneKart } from './kart-loader.js';

const STORAGE_KEY = 'gloKartsStudio.lastTrack';

// ── Scene ─────────────────────────────────────────────────────
const canvas = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0d12);
scene.fog = new THREE.Fog(0x0a0d12, 80, 300);

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
const groundMat = new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 1 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
ground.name = 'ground';
scene.add(ground);

// Grid helper
const grid = new THREE.GridHelper(40 * TILE, 40, 0x2a3340, 0x1c222b);
grid.position.y = 0.01;
scene.add(grid);

// ── Editor state ──────────────────────────────────────────────
const track = new Track();
const placementGroup = new THREE.Group();
scene.add(placementGroup);

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
  _thumbRenderer.setClearColor(0x1a2030, 1);
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
    const mesh = buildSegmentMesh(key);
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
    // Dispose to keep memory bounded.
    mesh.traverse(o => {
      if (o.geometry) o.geometry.dispose();
    });
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
const CATEGORY_ORDER = ['road', 'junction', 'height', 'special'];
const CATEGORY_LABELS = {
  road: 'Road',
  junction: 'Junctions',
  height: 'Vertical',
  special: 'Special',
};
function buildPalette() {
  paletteEl.innerHTML = '';
  const filter = paletteFilter.trim().toLowerCase();
  // Group keys by category (preserving insertion order within a group).
  const groups = new Map();
  for (const key of SEGMENT_KEYS) {
    const def = SEGMENTS[key];
    if (filter && !def.label.toLowerCase().includes(filter) && !key.toLowerCase().includes(filter)) continue;
    const cat = def.category || 'special';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(key);
  }
  const renderGroup = (cat, keys) => {
    if (!keys?.length) return;
    const header = document.createElement('div');
    header.className = 'palette-group';
    header.textContent = CATEGORY_LABELS[cat] || cat;
    paletteEl.appendChild(header);
    for (const key of keys) {
      const def = SEGMENTS[key];
      const btn = document.createElement('button');
      btn.dataset.key = key;
      btn.innerHTML = `<div class="swatch"></div><div>${def.label}</div>`;
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
  // First try to hit existing placement meshes (for selection)
  const placementHits = raycaster.intersectObjects(placementGroup.children, true);
  if (placementHits.length) {
    let obj = placementHits[0].object;
    while (obj && obj.userData.placementId == null) obj = obj.parent;
    if (obj && obj.userData.placementId != null) {
      return { kind: 'placement', id: obj.userData.placementId };
    }
  }
  const hits = raycaster.intersectObject(ground);
  if (!hits.length) return null;
  const point = hits[0].point;
  const gx = Math.round(point.x / TILE);
  const gz = Math.round(point.z / TILE);
  return { kind: 'cell', gx, gz };
}

canvas.addEventListener('mousemove', (e) => {
  const hit = pickGroundCell(e);
  if (!hit) {
    previewCell = null;
    if (previewMesh) previewMesh.visible = false;
    return;
  }
  if (hit.kind === 'cell') {
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
  if (hit && hit.kind === 'placement') {
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
  if (hit.kind === 'placement') {
    const mode = e.shiftKey ? 'add' : (e.ctrlKey || e.metaKey) ? 'toggle' : 'replace';
    selectPlacement(hit.id, mode);
    return;
  }
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
    if (selectedIds.size > 0) {
      rotateSelection(e.shiftKey ? -1 : 1);
    } else {
      activeRot = (activeRot + 1) % 4;
      if (previewMesh) previewMesh.rotation.y = -activeRot * Math.PI / 2;
    }
    return;
  }

  // ── Delete ──
  if (e.key === 'Delete' || e.key === 'Backspace') {
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
  undoStack.push(JSON.stringify(track.toJSON()));
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
function refreshInspector() {
  const el = document.getElementById('inspector');
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
const trackNameEl = document.getElementById('trackName');
trackNameEl.addEventListener('change', () => { track.name = trackNameEl.value || 'Untitled Track'; });

function loadFromJSON(json, snapshot = true) {
  const t = Track.fromJSON(json);
  track.clear();
  track.name = t.name;
  trackNameEl.value = track.name;
  for (const p of t.all()) {
    track.place(p.key, p.gx, p.gz, p.rot);
  }
  rebuildAll();
  if (snapshot) pushUndo();
}

document.getElementById('saveBtn').addEventListener('click', () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(track.toJSON()));
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
  rebuildAll();
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
  ground: '#14181f',
  sky: '#0a0d12',
  grid: true,
  fog: true,
};
function applyTerrain() {
  groundMat.color.set(terrainState.ground);
  scene.background = new THREE.Color(terrainState.sky);
  scene.fog = terrainState.fog ? new THREE.Fog(terrainState.sky, 80, 300) : null;
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

// Expose for debugging
window.__studio = { track, scene, camera, renderer, rebuildAll, refreshHud, refreshPlayButton };
