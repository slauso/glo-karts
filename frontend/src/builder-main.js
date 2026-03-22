/**
 * builder-main.js — Track Builder entry point.
 *
 * Initialises the Three.js 3D editor scene, wires palette/tool
 * buttons to the TrackEditor module, and handles export/share/test.
 *
 * GPL v3 — derived from SuperTuxKart track editor concepts.
 */

import * as THREE from 'three';
import {
  TrackEditor,
  SEGMENT_TYPES,
  OBSTACLE_TYPES,
  generateSegmentGeometry,
  exportTrackCode,
  importTrackCode,
} from './modules/track-editor.js';

// ── State ──────────────────────────────────────────────────────
const editor = new TrackEditor();
let activeTool = 'straight'; // current palette selection
let scene, camera, renderer, gridHelper, raycaster, mouse;
let segmentMeshes = new Map(); // segId → THREE.Mesh
let obstacleMeshes = [];
let startMarkers = [];
let hoverIndicator;

const GRID_SIZE = 10;
const GRID_DIVISIONS = 40;
const GRID_EXTENT = GRID_SIZE * GRID_DIVISIONS / 2;

// ── Colour palette for segments ────────────────────────────────
const SEGMENT_COLORS = {
  straight:    0x4488ff,
  curve_left:  0x44bbff,
  curve_right: 0x44bbff,
  ramp_up:     0x88ff44,
  ramp_down:   0xff8844,
  flat_wide:   0xcccc44,
};

// ── Init ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initScene();
  initPalette();
  initControls();
  initActions();
  animate();
});

// ── Three.js scene setup ───────────────────────────────────────
function initScene() {
  const canvas = document.getElementById('builder-canvas');

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a14);
  scene.fog = new THREE.Fog(0x0a0a14, 150, 350);

  // Camera
  camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight, 0.5, 500);
  camera.position.set(40, 60, 80);
  camera.lookAt(0, 0, 0);

  // Renderer
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // Lights
  const ambient = new THREE.AmbientLight(0x334466, 0.8);
  scene.add(ambient);

  const directional = new THREE.DirectionalLight(0xffffff, 1.2);
  directional.position.set(30, 50, 20);
  scene.add(directional);

  const accent = new THREE.PointLight(0xff0080, 0.5, 200);
  accent.position.set(0, 30, 0);
  scene.add(accent);

  // Grid floor
  gridHelper = new THREE.GridHelper(GRID_SIZE * GRID_DIVISIONS, GRID_DIVISIONS, 0x333355, 0x1a1a2e);
  scene.add(gridHelper);

  // Ground plane (invisible, for raycasting)
  const groundGeo = new THREE.PlaneGeometry(GRID_SIZE * GRID_DIVISIONS, GRID_SIZE * GRID_DIVISIONS);
  const groundMat = new THREE.MeshBasicMaterial({ visible: false });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.name = 'ground';
  scene.add(ground);

  // Hover indicator
  const hoverGeo = new THREE.BoxGeometry(GRID_SIZE - 0.5, 0.2, GRID_SIZE - 0.5);
  const hoverMat = new THREE.MeshBasicMaterial({ color: 0xff0080, transparent: true, opacity: 0.3 });
  hoverIndicator = new THREE.Mesh(hoverGeo, hoverMat);
  hoverIndicator.visible = false;
  scene.add(hoverIndicator);

  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  // Orbit controls (simple manual implementation)
  let isDragging = false;
  let dragStart = { x: 0, y: 0 };
  let cameraAngle = { theta: 0.5, phi: 0.8 };
  let cameraDistance = 100;
  let cameraTarget = new THREE.Vector3(0, 0, 0);

  function updateCameraFromOrbit() {
    camera.position.x = cameraTarget.x + cameraDistance * Math.sin(cameraAngle.phi) * Math.sin(cameraAngle.theta);
    camera.position.y = cameraTarget.y + cameraDistance * Math.cos(cameraAngle.phi);
    camera.position.z = cameraTarget.z + cameraDistance * Math.sin(cameraAngle.phi) * Math.cos(cameraAngle.theta);
    camera.lookAt(cameraTarget);
  }

  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 1 || e.button === 2) { // middle or right
      isDragging = true;
      dragStart = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    if (isDragging) {
      const dx = (e.clientX - dragStart.x) * 0.005;
      const dy = (e.clientY - dragStart.y) * 0.005;
      cameraAngle.theta -= dx;
      cameraAngle.phi = Math.max(0.2, Math.min(1.4, cameraAngle.phi - dy));
      dragStart = { x: e.clientX, y: e.clientY };
      updateCameraFromOrbit();
    }

    updateHoverIndicator();
  });

  canvas.addEventListener('mouseup', () => { isDragging = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('wheel', (e) => {
    cameraDistance = Math.max(20, Math.min(300, cameraDistance + e.deltaY * 0.1));
    updateCameraFromOrbit();
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener('click', (e) => {
    if (e.button !== 0) return;
    handleClick();
  });

  // Resize handler
  const resizeObserver = new ResizeObserver(() => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
  resizeObserver.observe(canvas);

  updateCameraFromOrbit();
}

// ── Hover indicator ────────────────────────────────────────────
function updateHoverIndicator() {
  raycaster.setFromCamera(mouse, camera);
  const ground = scene.getObjectByName('ground');
  if (!ground) return;

  const hits = raycaster.intersectObject(ground);
  if (hits.length > 0) {
    const p = hits[0].point;
    const gx = Math.round(p.x / GRID_SIZE) * GRID_SIZE;
    const gz = Math.round(p.z / GRID_SIZE) * GRID_SIZE;
    hoverIndicator.position.set(gx, 0.1, gz);
    hoverIndicator.visible = true;
  } else {
    hoverIndicator.visible = false;
  }
}

// ── Click handling ─────────────────────────────────────────────
function handleClick() {
  if (!hoverIndicator.visible) return;

  const x = hoverIndicator.position.x;
  const z = hoverIndicator.position.z;

  if (activeTool === 'eraser') {
    // Find and remove segment at this position
    const seg = editor.segments.find(s =>
      Math.abs(s.position.x - x) < 1 && Math.abs(s.position.z - z) < 1
    );
    if (seg) {
      editor.removeSegment(seg.id);
      rebuildScene();
      updateStats();
    }
    return;
  }

  if (activeTool === 'start_position') {
    editor.addStartPosition(x, 0, z, 0);
    rebuildScene();
    updateStats();
    return;
  }

  if (OBSTACLE_TYPES[activeTool]) {
    editor.placeObstacle(activeTool, x, 0.5, z);
    rebuildScene();
    updateStats();
    return;
  }

  if (SEGMENT_TYPES[activeTool]) {
    const result = editor.placeSegment(activeTool, x, 0, z, 0);
    if (result) {
      addSegmentMesh(result);
      updateStats();
    }
    return;
  }
}

// ── Scene building ─────────────────────────────────────────────
function addSegmentMesh(segment) {
  const st = SEGMENT_TYPES[segment.type];
  const { vertices, indices } = generateSegmentGeometry(segment.type, st);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();

  const color = SEGMENT_COLORS[segment.type] || 0x4488ff;
  const material = new THREE.MeshPhongMaterial({
    color,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    emissive: color,
    emissiveIntensity: 0.15,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(segment.position.x, segment.position.y + 0.05, segment.position.z);
  mesh.rotation.y = (segment.rotation || 0) * Math.PI / 180;

  // Add edge wireframe
  const edges = new THREE.EdgesGeometry(geometry);
  const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 });
  const wireframe = new THREE.LineSegments(edges, lineMat);
  mesh.add(wireframe);

  scene.add(mesh);
  segmentMeshes.set(segment.id, mesh);
}

function rebuildScene() {
  // Remove old meshes
  for (const [, mesh] of segmentMeshes) {
    scene.remove(mesh);
    mesh.geometry?.dispose();
    mesh.material?.dispose();
  }
  segmentMeshes.clear();

  for (const m of obstacleMeshes) {
    scene.remove(m);
    m.geometry?.dispose();
    m.material?.dispose();
  }
  obstacleMeshes = [];

  for (const m of startMarkers) {
    scene.remove(m);
    m.geometry?.dispose();
    m.material?.dispose();
  }
  startMarkers = [];

  // Rebuild segments
  for (const seg of editor.segments) {
    addSegmentMesh(seg);
  }

  // Rebuild obstacles
  for (const obs of editor.obstacles) {
    const geo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
    const color = obs.type === 'boost_pad' ? 0xffff00 :
                  obs.type === 'banana' ? 0xffcc00 :
                  obs.type === 'item_box' ? 0x44ff44 : 0xff4444;
    const mat = new THREE.MeshPhongMaterial({ color, emissive: color, emissiveIntensity: 0.3 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(obs.position.x, obs.position.y, obs.position.z);
    scene.add(mesh);
    obstacleMeshes.push(mesh);
  }

  // Rebuild start position markers
  for (const sp of editor.startPositions) {
    const geo = new THREE.ConeGeometry(1.5, 3, 4);
    const mat = new THREE.MeshPhongMaterial({ color: 0x00ff88, emissive: 0x00ff88, emissiveIntensity: 0.4 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(sp.position.x, 1.5, sp.position.z);
    mesh.rotation.y = sp.heading;
    scene.add(mesh);
    startMarkers.push(mesh);
  }
}

// ── Palette setup ──────────────────────────────────────────────
function initPalette() {
  const segPalette = document.getElementById('segment-palette');
  const obsPalette = document.getElementById('obstacle-palette');

  for (const [key, def] of Object.entries(SEGMENT_TYPES)) {
    const btn = document.createElement('button');
    btn.className = `palette-btn${key === activeTool ? ' active' : ''}`;
    btn.setAttribute('data-tool', key);
    btn.innerHTML = `<span class="palette-icon">${def.icon}</span><span class="palette-label">${def.label}</span>`;
    btn.addEventListener('click', () => selectTool(key));
    segPalette.appendChild(btn);
  }

  for (const [key, def] of Object.entries(OBSTACLE_TYPES)) {
    const btn = document.createElement('button');
    btn.className = 'palette-btn';
    btn.setAttribute('data-tool', key);
    btn.innerHTML = `<span class="palette-icon">${def.icon}</span><span class="palette-label">${def.label}</span>`;
    btn.addEventListener('click', () => selectTool(key));
    obsPalette.appendChild(btn);
  }

  // Wire marker tools (already in HTML)
  document.querySelectorAll('.palette-btn[data-tool]').forEach(btn => {
    const tool = btn.getAttribute('data-tool');
    if (!SEGMENT_TYPES[tool] && !OBSTACLE_TYPES[tool]) {
      btn.addEventListener('click', () => selectTool(tool));
    }
  });
}

function selectTool(toolId) {
  activeTool = toolId;
  document.querySelectorAll('.palette-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tool') === toolId);
  });

  const status = document.getElementById('builder-status');
  if (toolId === 'eraser') {
    status.textContent = 'Click a segment to remove it';
  } else if (toolId === 'start_position') {
    status.textContent = 'Click grid to place start position';
  } else if (OBSTACLE_TYPES[toolId]) {
    status.textContent = `Click grid to place ${OBSTACLE_TYPES[toolId].label}`;
  } else if (SEGMENT_TYPES[toolId]) {
    status.textContent = `Click grid to place ${SEGMENT_TYPES[toolId].label}`;
  }
}

// ── Controls (undo/redo/clear, keyboard) ───────────────────────
function initControls() {
  document.getElementById('undo-btn')?.addEventListener('click', () => {
    editor.undo();
    rebuildScene();
    updateStats();
  });

  document.getElementById('redo-btn')?.addEventListener('click', () => {
    editor.redo();
    rebuildScene();
    updateStats();
  });

  document.getElementById('clear-btn')?.addEventListener('click', () => {
    if (!confirm('Clear all track data?')) return;
    editor.clear();
    rebuildScene();
    updateStats();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.ctrlKey && e.shiftKey && e.key === 'Z') {
      e.preventDefault();
      editor.redo();
      rebuildScene();
      updateStats();
    } else if (e.ctrlKey && e.key === 'z') {
      e.preventDefault();
      editor.undo();
      rebuildScene();
      updateStats();
    }
  });

  // Sync name/author inputs
  document.getElementById('track-name')?.addEventListener('input', (e) => {
    editor.trackName = e.target.value || 'Untitled Track';
  });
  document.getElementById('track-author')?.addEventListener('input', (e) => {
    editor.trackAuthor = e.target.value || 'Anonymous';
  });
}

// ── Action buttons ─────────────────────────────────────────────
function initActions() {
  document.getElementById('validate-btn')?.addEventListener('click', () => {
    const result = editor.validateTrack();
    const output = document.getElementById('validation-output');
    if (result.valid) {
      output.innerHTML = '<span class="validation-pass"><i class="fas fa-check"></i> Track is valid!</span>';
    } else {
      output.innerHTML = result.errors
        .map(e => `<span class="validation-fail"><i class="fas fa-times"></i> ${e}</span>`)
        .join('<br>');
    }
  });

  document.getElementById('test-race-btn')?.addEventListener('click', () => {
    showToast('Single-player preview has been removed. Use the builder for authoring only.');
  });

  document.getElementById('test-battle-btn')?.addEventListener('click', () => {
    showToast('Single-player arena preview has been removed. Use the multiplayer shell for battle work.');
  });

  document.getElementById('export-btn')?.addEventListener('click', () => {
    const json = editor.exportTrack();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${editor.trackName.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Track exported as JSON');
  });

  document.getElementById('share-btn')?.addEventListener('click', () => {
    const json = editor.exportTrack();
    const code = exportTrackCode(json);
    if (!code) {
      showToast('Failed to generate share code');
      return;
    }
    navigator.clipboard.writeText(code).then(() => {
      showToast('Share code copied to clipboard!');
    }).catch(() => {
      // Fallback: show in prompt
      prompt('Copy this share code:', code);
    });
  });

  // Import modal
  const importModal = document.getElementById('import-modal');
  document.getElementById('import-btn')?.addEventListener('click', () => {
    importModal?.classList.remove('hidden');
  });
  document.getElementById('import-cancel-btn')?.addEventListener('click', () => {
    importModal?.classList.add('hidden');
  });
  document.querySelector('.modal-backdrop')?.addEventListener('click', () => {
    importModal?.classList.add('hidden');
  });
  document.getElementById('import-confirm-btn')?.addEventListener('click', () => {
    const codeInput = document.getElementById('import-code-input');
    const raw = codeInput?.value?.trim();
    if (!raw) { showToast('Paste a share code first'); return; }

    const json = importTrackCode(raw);
    if (!json) {
      showToast('Invalid share code');
      return;
    }

    if (editor.importTrack(json)) {
      document.getElementById('track-name').value = editor.trackName;
      document.getElementById('track-author').value = editor.trackAuthor;
      rebuildScene();
      updateStats();
      importModal?.classList.add('hidden');
      codeInput.value = '';
      showToast(`Imported: ${editor.trackName}`);
    } else {
      showToast('Failed to import track data');
    }
  });
}

// ── Stats update ───────────────────────────────────────────────
function updateStats() {
  const segs = document.getElementById('stat-segments');
  const obs = document.getElementById('stat-obstacles');
  const starts = document.getElementById('stat-starts');
  if (segs) segs.textContent = editor.segments.length;
  if (obs) obs.textContent = editor.obstacles.length;
  if (starts) starts.textContent = editor.startPositions.length;
}

// ── Toast notification ─────────────────────────────────────────
function showToast(message, duration = 2500) {
  const toast = document.getElementById('builder-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), duration);
}

// ── Animation loop ─────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);

  // Gentle rotation of start markers
  for (const m of startMarkers) {
    m.rotation.y += 0.02;
  }

  renderer.render(scene, camera);
}
