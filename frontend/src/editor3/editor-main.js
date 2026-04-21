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

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1000);
camera.position.set(40, 40, 40);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 8;
controls.maxDistance = 200;
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
let selectedId = null;
const previewGroup = new THREE.Group();
scene.add(previewGroup);
let previewMesh = null;
let previewCell = null;

// Selection highlight box
const selectBox = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(TILE, 1, TILE)),
  new THREE.LineBasicMaterial({ color: 0xff3aa1, linewidth: 2 }),
);
selectBox.visible = false;
scene.add(selectBox);

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

// ── Palette UI ────────────────────────────────────────────────
const paletteEl = document.getElementById('palette');
function buildPalette() {
  paletteEl.innerHTML = '';
  for (const key of SEGMENT_KEYS) {
    const def = SEGMENTS[key];
    const btn = document.createElement('button');
    btn.dataset.key = key;
    btn.innerHTML = `<div class="swatch"></div><div>${def.label}</div>`;
    if (key === activeKey) btn.classList.add('active');
    btn.addEventListener('click', () => {
      activeKey = key;
      activeRot = 0;
      paletteEl.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.key === key));
      updatePreview();
    });
    paletteEl.appendChild(btn);
  }
}
buildPalette();

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
  raycaster.setFromCamera(ndc, camera);
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

canvas.addEventListener('click', (e) => {
  if (e.button !== 0) return;
  const hit = pickGroundCell(e);
  if (!hit) return;
  if (hit.kind === 'placement') {
    selectPlacement(hit.id);
    return;
  }
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

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ── Selection ──────────────────────────────────────────────────
function selectPlacement(id) {
  selectedId = id;
  const p = track.getById(id);
  if (!p) { selectBox.visible = false; return; }
  selectBox.position.set(p.gx * TILE, 1, p.gz * TILE);
  selectBox.visible = true;
  refreshInspector();
}

function clearSelection() {
  selectedId = null;
  selectBox.visible = false;
  refreshInspector();
}

// ── Keyboard ───────────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'r' || e.key === 'R') {
    if (selectedId != null) {
      const p = track.getById(selectedId);
      if (p) {
        const newRot = (p.rot + 1) % 4;
        if (track.isClear(p.key, p.gx, p.gz, newRot, p.id)) {
          // Re-register at new rotation
          track.remove(p.id);
          const np = track.place(p.key, p.gx, p.gz, newRot);
          if (np) {
            removePlacementMesh(p.id);
            addPlacementMesh(np);
            selectPlacement(np.id);
            pushUndo();
          }
        } else {
          toast('Rotation blocked');
        }
      }
    } else {
      activeRot = (activeRot + 1) % 4;
      if (previewMesh) previewMesh.rotation.y = -activeRot * Math.PI / 2;
    }
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedId != null) {
      removePlacementMesh(selectedId);
      track.remove(selectedId);
      clearSelection();
      pushUndo();
      refreshHud();
    }
  } else if (e.key === 'Escape') {
    clearSelection();
  } else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    doUndo();
  }
});

// ── Undo stack (whole-track snapshots, simple but reliable) ────
const undoStack = [];
let undoIndex = -1;
function pushUndo() {
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

// ── HUD + inspector ───────────────────────────────────────────
function refreshHud() {
  document.getElementById('pieceCount').textContent = track.placements.size;
  document.getElementById('infoPieces').textContent = track.placements.size;
  const b = track.bounds();
  document.getElementById('infoBounds').textContent = b
    ? `${b.maxX - b.minX + 1}×${b.maxZ - b.minZ + 1}` : '—';
  const sp = track.spawn();
  document.getElementById('infoSpawn').textContent = sp ? `(${sp.gx},${sp.gz})` : 'none';
}
function refreshInspector() {
  const el = document.getElementById('inspector');
  if (selectedId == null) {
    el.innerHTML = `<div style="color:var(--muted); font-size:12px;">Nothing selected.</div>`;
    return;
  }
  const p = track.getById(selectedId);
  if (!p) return;
  const def = SEGMENTS[p.key];
  el.innerHTML = `
    <div class="row"><span>Type</span><b>${def.label}</b></div>
    <div class="row"><span>Cell</span><b>${p.gx}, ${p.gz}</b></div>
    <div class="row"><span>Rotation</span><b>${p.rot * 90}°</b></div>
    <div style="margin-top:8px; font-size:11px; color:var(--muted);">R to rotate · Del to remove</div>
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
  const code = encodeTrack(track);
  sessionStorage.setItem('gloKartsStudio.playtest', code);
  window.location.href = `/play.html?track=${code}&from=editor`;
});

// ── Resize + render loop ──────────────────────────────────────
function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
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
window.__studio = { track, scene, camera, renderer };
