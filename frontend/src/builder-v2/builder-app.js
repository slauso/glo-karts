/**
 * builder-app.js — GLO Karts Arena Builder v2 — main orchestrator.
 *
 * Wires together: viewport, camera, input, scene graph, asset loader,
 * selection, transform gizmo, command stack, road painter, extras,
 * terrain, serializer, and playtest bridge.
 */
import * as THREE from 'three';
import { createViewport } from './viewport.js';
import { CameraController } from './camera-controller.js';
import { SceneGraph } from './scene-graph.js';
import { loadModel, TRACK_ASSETS } from './asset-loader.js';
import { ObjectsPanel } from './objects-panel.js';
import { Selection } from './selection.js';
import { TransformGizmo } from './transform-gizmo.js';
import { InputRouter, TOOL } from './input-router.js';
import { CommandStack, PlaceObjectCmd, DeleteObjectCmd, TransformCmd } from './command-stack.js';
import { RoadPainter } from './road-panel.js';
import { ExtrasPanel, createSpawnMarker, createItemBoxMarker, createCheckpointMarker } from './extras-panel.js';
import { TerrainPanel } from './terrain-panel.js';
import { Serializer } from './serializer.js';
import { PlaytestBridge } from './playtest-bridge.js';
import { GridState, PIECE_DEFS, makeGhostMaterial, tintGhost } from './grid-placement.js';
import { snapToGrid, cellKey } from '../modules/track-placement.js';

// ── DOM refs ──────────────────────────────────────────────────
const canvas   = document.getElementById('bv2-viewport');
const stage    = document.getElementById('bv2-stage');
const hint     = document.getElementById('bv2-hint');
const nameInput = document.getElementById('bv2-name');

// ── Viewport ──────────────────────────────────────────────────
const { renderer, scene, ground, grid, entityGroup } = createViewport(canvas);

// Expose for automated testing / debugging (non-production only)
if (typeof window !== 'undefined') {
  window.__scene = scene;
  window.__THREE = THREE;
}

// ── Camera ────────────────────────────────────────────────────
const camCtrl = new CameraController(canvas, renderer);

// ── Scene Graph ───────────────────────────────────────────────
const sceneGraph = new SceneGraph(entityGroup);

// ── Road Painter ──────────────────────────────────────────────
const roadGroup = new THREE.Group();
roadGroup.name = '__roadCells';
scene.add(roadGroup);
const roadPainter = new RoadPainter(roadGroup, (key) => loadModel(key));

// ── Unified Grid State ────────────────────────────────────────
const gridState = new GridState();
scene.add(gridState.indicatorGroup);

// ── Selection ─────────────────────────────────────────────────
const selection = new Selection(sceneGraph, onSelectionChange);

// ── Command Stack ─────────────────────────────────────────────
const cmdStack = new CommandStack();
cmdStack.setOnChange(() => {
  triggerAutoSave();
  updateInspector();
});

// ── Transform Gizmo ───────────────────────────────────────────
const gizmo = new TransformGizmo(
  camCtrl.camera, canvas, sceneGraph, selection,
  camCtrl.controls, onTransformEnd,
);
gizmo.init(scene, camCtrl.camera);

// ── Serializer & Playtest ─────────────────────────────────────
const serializer = new Serializer(sceneGraph, roadPainter);
const playtestBridge = new PlaytestBridge(serializer);

// ── State ─────────────────────────────────────────────────────
let gridSnap = true;
let activePlacementKey = null; // current asset key being placed
let activeExtraTool = null;    // current extras tool
let ghostObj = null;           // actual-model ghost preview
let ghostPieceKey = null;      // cached key for ghost model swap
let ghostRotation = 0;         // current ghost rotation (degrees)
let manualRotation = null;     // null = auto-connect, number = user override
let lastGhostCell = null;      // cellKey of last ghost position
let isPainting = false;        // road painting in progress

// ── Sidebar Panels ────────────────────────────────────────────
const objectsPanel = new ObjectsPanel(
  document.getElementById('bv2-panel-objects'),
  (key) => {
    activePlacementKey = key;
    manualRotation = null;
    if (key) {
      inputRouter.setTool(TOOL.PLACE);
      setHint(`Click to place ${key}. R to rotate. Auto-connects to neighbors.`);
    } else {
      removeGhost();
      setHint('');
    }
  },
);

const extrasPanel = new ExtrasPanel(
  document.getElementById('bv2-panel-extras'),
  {
    onToolSelect(tool) {
      activeExtraTool = tool;
      if (tool) {
        inputRouter.setTool(TOOL.PLACE);
        setHint(`Click to place ${tool}. Press Escape to cancel.`);
      } else {
        setHint('');
      }
    },
  },
);

// Road panel sidebar — just instructions (actual painting is via viewport)
const roadPanelEl = document.getElementById('bv2-panel-road');
if (roadPanelEl) {
  roadPanelEl.innerHTML = `
    <div class="bv2-panel-section-head">Quick Road Painting</div>
    <div style="padding:12px;font-size:0.82rem;color:#888;line-height:1.5;">
      <p>Select the <b style="color:#c8c8d8">Road</b> tool (2), then <b style="color:#c8c8d8">click & drag</b> to paint road cells.</p>
      <p style="margin-top:8px;">Pieces auto-tile based on neighbors (straights, corners, intersections).</p>
      <p style="margin-top:8px;">For specific pieces, use the <b style="color:#c8c8d8">Objects</b> panel — they auto-rotate to connect.</p>
      <p style="margin-top:8px;">Press <b style="color:#c8c8d8">R</b> to manually rotate while placing.</p>
      <p style="margin-top:8px;">Switch to <b style="color:#c8c8d8">Erase</b> (4) to remove cells.</p>
    </div>
  `;
}

const terrainPanel = new TerrainPanel(
  document.getElementById('bv2-panel-terrain'),
  ground, grid,
);

// ── Input Router ──────────────────────────────────────────────
const inputRouter = new InputRouter(canvas, {
  onToolChange: onToolChange,
  onPointerDown: onPointerDown,
  onPointerMove: onPointerMove,
  onPointerUp: onPointerUp,
  onUndo: () => cmdStack.undo(),
  onRedo: () => cmdStack.redo(),
  onDelete: onDelete,
  onSelectAll: () => selection.selectAll(),
  onEscape: onEscape,
  onSave: onSave,
  onRotate: onRotatePiece,
  onToggleGrid: () => {
    gridSnap = !gridSnap;
    document.getElementById('bv2-grid-snap')?.classList.toggle('active', gridSnap);
    setHint(gridSnap ? 'Grid snap ON' : 'Grid snap OFF');
  },
  onToggleCam: () => {
    const isOrtho = camCtrl.toggleOrtho();
    gizmo.updateCamera(camCtrl.camera);
    gizmo.init(scene, camCtrl.camera);
    document.getElementById('bv2-cam-toggle')?.classList.toggle('active', isOrtho);
    setHint(isOrtho ? 'Orthographic (top-down)' : 'Perspective (3D)');
    reattachGizmo();
  },
  onGizmoMode: (mode) => {
    gizmo.setMode(mode);
    setHint(`Gizmo: ${mode}`);
  },
});

// ── Toolbar buttons ───────────────────────────────────────────
const toolButtons = {
  [TOOL.SELECT]: document.getElementById('bv2-tool-select'),
  [TOOL.ROAD]:   document.getElementById('bv2-tool-road'),
  [TOOL.PLACE]:  document.getElementById('bv2-tool-place'),
  [TOOL.ERASE]:  document.getElementById('bv2-tool-erase'),
};

Object.entries(toolButtons).forEach(([tool, btn]) => {
  btn?.addEventListener('click', () => inputRouter.setTool(tool));
});

document.getElementById('bv2-undo')?.addEventListener('click', () => cmdStack.undo());
document.getElementById('bv2-redo')?.addEventListener('click', () => cmdStack.redo());
document.getElementById('bv2-delete')?.addEventListener('click', onDelete);
document.getElementById('bv2-grid-snap')?.addEventListener('click', () => {
  gridSnap = !gridSnap;
  document.getElementById('bv2-grid-snap')?.classList.toggle('active', gridSnap);
});
document.getElementById('bv2-cam-toggle')?.addEventListener('click', () => {
  const isOrtho = camCtrl.toggleOrtho();
  gizmo.updateCamera(camCtrl.camera);
  gizmo.init(scene, camCtrl.camera);
  reattachGizmo();
});
document.getElementById('bv2-save')?.addEventListener('click', onSave);
document.getElementById('bv2-load')?.addEventListener('click', onLoad);
document.getElementById('bv2-share')?.addEventListener('click', onShare);
document.getElementById('bv2-play')?.addEventListener('click', onPlaytest);
document.getElementById('bv2-back')?.addEventListener('click', () => {
  window.location.href = '/';
});

// Init grid snap active state
document.getElementById('bv2-grid-snap')?.classList.toggle('active', gridSnap);

// ── Sidebar tab switching ─────────────────────────────────────
const tabs = document.querySelectorAll('.bv2-tab');
const panels = document.querySelectorAll('.bv2-panel');
tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    const panelId = tab.dataset.panel;
    tabs.forEach((t) => t.classList.toggle('active', t === tab));
    panels.forEach((p) => {
      const isTarget = p.id === `bv2-panel-${panelId}`;
      p.classList.toggle('active', isTarget);
      p.hidden = !isTarget;
    });
  });
});

// ── Resize ────────────────────────────────────────────────────
function resize() {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  renderer.setSize(w, h);
  camCtrl.resize(w, h);
}
window.addEventListener('resize', resize);
resize();

// ── Render loop ───────────────────────────────────────────────
function animate() {
  camCtrl.update();
  renderer.render(scene, camCtrl.camera);
  requestAnimationFrame(animate);
}
animate();

// ── Tool change ───────────────────────────────────────────────
function onToolChange(tool) {
  Object.entries(toolButtons).forEach(([t, btn]) => btn?.classList.toggle('active', t === tool));

  // Cleanup when switching tools
  if (tool !== TOOL.PLACE) {
    removeGhost();
    activePlacementKey = null;
    activeExtraTool = null;
    manualRotation = null;
    objectsPanel.deselect();
    extrasPanel.deselect();
    gridState.hideIndicators();
  }
  if (tool !== TOOL.ROAD) {
    roadPainter.hideGhost();
    isPainting = false;
  }
  if (tool === TOOL.SELECT) {
    setHint('Click to select. Shift+click for multi-select. Drag gizmo to transform.');
  } else if (tool === TOOL.ROAD) {
    setHint('Click and drag to paint road. Pieces auto-tile. Press 4 to erase.');
  } else if (tool === TOOL.ERASE) {
    setHint('Click on placed objects or road cells to erase them.');
  }
}

// ── Pointer handlers ──────────────────────────────────────────
function onPointerDown(ndcX, ndcY, event) {
  const pointer = new THREE.Vector2(ndcX, ndcY);

  if (inputRouter.tool === TOOL.SELECT) {
    const entityId = selection.pick(camCtrl.camera, pointer, entityGroup);
    if (entityId !== null) {
      if (event.shiftKey) {
        selection.toggle(entityId);
      } else {
        selection.select(entityId);
      }
    } else {
      selection.clear();
    }
    return;
  }

  if (inputRouter.tool === TOOL.PLACE) {
    const worldPos = selection.pickGround(camCtrl.camera, pointer, ground);
    if (!worldPos) return;

    if (activeExtraTool) {
      placeExtra(worldPos);
    } else if (activePlacementKey) {
      placeObject(worldPos);
    }
    return;
  }

  if (inputRouter.tool === TOOL.ROAD) {
    isPainting = true;
    const worldPos = selection.pickGround(camCtrl.camera, pointer, ground);
    if (worldPos) {
      roadPainter.paint(worldPos.x, worldPos.z);
      registerRoadCell(worldPos.x, worldPos.z);
    }
    return;
  }

  if (inputRouter.tool === TOOL.ERASE) {
    const worldPos = selection.pickGround(camCtrl.camera, pointer, ground);
    if (worldPos) {
      eraseAtWorld(worldPos, pointer);
    }
    return;
  }
}

function onPointerMove(ndcX, ndcY, event) {
  const pointer = new THREE.Vector2(ndcX, ndcY);

  // Model ghost preview for placement
  if (inputRouter.tool === TOOL.PLACE && (activePlacementKey || activeExtraTool)) {
    const worldPos = selection.pickGround(camCtrl.camera, pointer, ground);
    if (worldPos) updatePlacementGhost(worldPos);
  }

  // Road painting (drag)
  if (inputRouter.tool === TOOL.ROAD) {
    const worldPos = selection.pickGround(camCtrl.camera, pointer, ground);
    if (worldPos) {
      roadPainter.showGhost(worldPos.x, worldPos.z, scene);
      if (isPainting) {
        roadPainter.paint(worldPos.x, worldPos.z);
        registerRoadCell(worldPos.x, worldPos.z);
      }
    }
  }

  // Erase painting (drag)
  if (inputRouter.tool === TOOL.ERASE && event.buttons === 1) {
    const worldPos = selection.pickGround(camCtrl.camera, pointer, ground);
    if (worldPos) {
      eraseAtWorld(worldPos, pointer);
    }
  }
}

function onPointerUp(ndcX, ndcY, event) {
  isPainting = false;
  if (inputRouter.tool === TOOL.ROAD) {
    triggerAutoSave();
  }
}

// ── Register road cells in shared grid ────────────────────────
function registerRoadCell(worldX, worldZ) {
  const gx = snapToGrid(worldX);
  const gz = snapToGrid(worldZ);
  if (!gridState.isOccupied(gx, gz)) {
    // Road painter auto-classifies, so we register the auto-tiled result
    const classification = 'straight'; // default, updated below
    gridState.set(gx, gz, classification, 0, 'road');
  }
}

/** Sync all road painter cells into gridState (after load/paint). */
function syncRoadToGrid() {
  gridState.clearBySource('road');
  for (const [key, cell] of roadPainter.cells) {
    gridState.set(cell.x, cell.z, 'straight', 0, 'road');
  }
}

// ── Erase logic (unified for entities + road cells) ───────────
function eraseAtWorld(worldPos, pointer) {
  const gx = snapToGrid(worldPos.x);
  const gz = snapToGrid(worldPos.z);

  // Try erase road cell first
  const erased = roadPainter.erase(worldPos.x, worldPos.z);
  if (erased) {
    gridState.remove(gx, gz);
    return;
  }

  // Try erase scene entity
  const entityId = selection.pick(camCtrl.camera, pointer, entityGroup);
  if (entityId !== null) {
    const entity = sceneGraph.get(entityId);
    if (entity) {
      cmdStack.execute(DeleteObjectCmd(sceneGraph, entityId, entity));
      gridState.remove(
        snapToGrid(entity.position.x),
        snapToGrid(entity.position.z),
      );
    }
  }
}

// ── Place track piece (auto-connect aware) ────────────────────
async function placeObject(worldPos) {
  const gx = snapToGrid(worldPos.x);
  const gz = snapToGrid(worldPos.z);

  // Prevent double-placement
  if (gridState.isOccupied(gx, gz)) {
    showToast('Cell is already occupied', 'warn');
    return;
  }

  // Determine rotation: manual override or auto-connect
  const rotation = manualRotation ?? gridState.findBestRotation(activePlacementKey, gx, gz);

  try {
    const model = await loadModel(activePlacementKey);
    model.position.set(gx, 0, gz);
    model.rotation.y = -(rotation * Math.PI / 180);

    const entity = {
      id: 0,
      type: activePlacementKey,
      category: 'segment',
      modelKey: activePlacementKey,
      object3D: model,
      position: { x: gx, y: 0, z: gz },
      rotation,
      scale: 1,
    };

    cmdStack.execute(PlaceObjectCmd(sceneGraph, entity));
    gridState.set(gx, gz, activePlacementKey, rotation, 'entity', entity.id);

    const conns = gridState.getConnections(gx, gz, activePlacementKey, rotation);
    const connected = conns.filter(c => c.status === 'connected').length;
    setHint(`Placed ${activePlacementKey} (${connected} connection${connected !== 1 ? 's' : ''}). Click to place more, R to rotate.`);
  } catch (err) {
    console.error('[builder] Failed to place object:', err);
    showToast('Failed to load model', 'error');
  }
}

// ── Place extras (spawn, items, etc.) ─────────────────────────
function placeExtra(worldPos) {
  const gx = snapToGrid(worldPos.x);
  const gz = snapToGrid(worldPos.z);

  let obj3D;
  let category;
  const type = activeExtraTool;

  if (type === 'spawn') {
    const spawnCount = sceneGraph.getByCategory('spawn').length;
    if (spawnCount >= 8) { showToast('Max 8 spawn points', 'warn'); return; }
    obj3D = createSpawnMarker(spawnCount + 1, gx, 0, gz);
    category = 'spawn';
  } else if (type === 'checkpoint') {
    obj3D = createCheckpointMarker(gx, 0, gz);
    category = 'obstacle';
  } else {
    obj3D = createItemBoxMarker(type, gx, 0, gz);
    category = 'obstacle';
  }

  const entity = {
    id: 0,
    type,
    category,
    modelKey: type,
    object3D: obj3D,
    position: { x: gx, y: 0, z: gz },
    rotation: 0,
    scale: 1,
    heading: 0,
  };

  cmdStack.execute(PlaceObjectCmd(sceneGraph, entity));
  setHint(`Placed ${type}. Click to place more.`);
}

// ── Rotate piece shortcut ─────────────────────────────────────
function onRotatePiece() {
  if (inputRouter.tool === TOOL.PLACE && activePlacementKey) {
    // Cycle manual rotation: null → 0 → 90 → 180 → 270 → null (auto)
    if (manualRotation === null) {
      manualRotation = 0;
    } else {
      manualRotation = (manualRotation + 90) % 360;
    }
    setHint(`Rotation: ${manualRotation}° (press R again, or Esc for auto-connect)`);
    // Re-render ghost at new rotation
    if (ghostObj) {
      ghostObj.rotation.y = -(manualRotation * Math.PI / 180);
    }
    return;
  }

  // Rotate selected entity
  const entity = selection.first();
  if (entity && entity.category === 'segment') {
    const oldRot = entity.rotation;
    const newRot = (oldRot + 90) % 360;
    cmdStack.execute(TransformCmd(
      sceneGraph, entity.id,
      { ...entity.position }, oldRot, entity.scale,
      { ...entity.position }, newRot, entity.scale,
    ));
    // Update grid
    const gx = snapToGrid(entity.position.x);
    const gz = snapToGrid(entity.position.z);
    gridState.set(gx, gz, entity.type, newRot, 'entity', entity.id);
    updateInspector();
    reattachGizmo();
    setHint(`Rotated to ${newRot}°`);
  }
}

// ── Ghost preview (actual model, auto-rotated) ────────────────
async function updatePlacementGhost(worldPos) {
  const gx = snapToGrid(worldPos.x);
  const gz = snapToGrid(worldPos.z);
  const key = cellKey(gx, gz);

  // Skip update if cursor is on the same cell
  if (key === lastGhostCell && ghostObj && ghostPieceKey === activePlacementKey) return;
  lastGhostCell = key;

  const occupied = gridState.isOccupied(gx, gz);

  // Swap ghost model if piece type changed
  const neededKey = activeExtraTool || activePlacementKey;
  if (neededKey !== ghostPieceKey) {
    removeGhost();
    try {
      if (activePlacementKey && PIECE_DEFS[activePlacementKey]) {
        ghostObj = await loadModel(activePlacementKey);
      } else {
        // Extras / unknown — simple box ghost
        const geo = new THREE.BoxGeometry(4, 2, 4);
        const mat = new THREE.MeshBasicMaterial({ color: 0x66aaff, wireframe: true });
        ghostObj = new THREE.Mesh(geo, mat);
      }
      makeGhostMaterial(ghostObj);
      ghostObj.name = '__ghost';
      scene.add(ghostObj);
      ghostPieceKey = neededKey;
    } catch {
      return; // model load failed, skip ghost
    }
  }

  if (!ghostObj) return;

  // Auto-rotate (segments only)
  if (activePlacementKey && PIECE_DEFS[activePlacementKey]) {
    const rot = manualRotation ?? gridState.findBestRotation(activePlacementKey, gx, gz);
    ghostRotation = rot;
    ghostObj.rotation.y = -(rot * Math.PI / 180);

    // Connection indicators
    const conns = gridState.getConnections(gx, gz, activePlacementKey, rot);
    gridState.showIndicators(gx, gz, conns);
  } else {
    gridState.hideIndicators();
  }

  // Position & tint
  ghostObj.position.set(gx, 0, gz);
  ghostObj.visible = true;
  tintGhost(ghostObj, !occupied);
}

function removeGhost() {
  if (ghostObj) {
    scene.remove(ghostObj);
    ghostObj.traverse(c => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
        else c.material.dispose();
      }
    });
    ghostObj = null;
  }
  ghostPieceKey = null;
  lastGhostCell = null;
  gridState.hideIndicators();
}

// ── Selection change → update inspector + gizmo ───────────────
function onSelectionChange() {
  updateInspector();
  reattachGizmo();
}

function reattachGizmo() {
  const entity = selection.first();
  if (entity) {
    gizmo.attach(entity);
  } else {
    gizmo.detach();
  }
}

function onTransformEnd(entityId, oldPos, oldRot, oldScale) {
  const entity = sceneGraph.get(entityId);
  if (!entity) return;
  cmdStack.execute(TransformCmd(
    sceneGraph, entityId,
    oldPos, oldRot, oldScale,
    { ...entity.position }, entity.rotation, entity.scale,
  ));
}

// ── Inspector panel ───────────────────────────────────────────
function updateInspector() {
  const badge = document.getElementById('bv2-sel-badge');
  const content = document.getElementById('bv2-inspector-content');
  if (!badge || !content) return;

  if (selection.isEmpty) {
    badge.textContent = 'None';
    content.innerHTML = '<p class="bv2-empty">Select an object to inspect its properties.</p>';
    return;
  }

  const entities = selection.all();
  badge.textContent = entities.length === 1 ? entities[0].type : `${entities.length} selected`;

  if (entities.length === 1) {
    const e = entities[0];
    content.innerHTML = `
      <div class="bv2-insp-fields">
        <label class="bv2-insp-field">
          <span>Type</span>
          <span class="bv2-insp-val">${e.type}</span>
        </label>
        <label class="bv2-insp-field">
          <span>Category</span>
          <span class="bv2-insp-val">${e.category}</span>
        </label>
        <label class="bv2-insp-field">
          <span>X</span>
          <input type="number" step="1" value="${Math.round(e.position.x)}" data-prop="x" class="bv2-insp-input" />
        </label>
        <label class="bv2-insp-field">
          <span>Y</span>
          <input type="number" step="1" value="${Math.round(e.position.y)}" data-prop="y" class="bv2-insp-input" />
        </label>
        <label class="bv2-insp-field">
          <span>Z</span>
          <input type="number" step="1" value="${Math.round(e.position.z)}" data-prop="z" class="bv2-insp-input" />
        </label>
        <label class="bv2-insp-field">
          <span>Rotation</span>
          <input type="number" step="90" min="0" max="270" value="${e.rotation || 0}" data-prop="rot" class="bv2-insp-input" />
        </label>
      </div>
    `;

    // Bind inspector inputs
    content.querySelectorAll('.bv2-insp-input').forEach(input => {
      input.addEventListener('change', () => {
        const prop = input.dataset.prop;
        const val = Number(input.value);
        const oldPos = { ...e.position };
        const oldRot = e.rotation;
        if (prop === 'x') e.position.x = val;
        else if (prop === 'y') e.position.y = val;
        else if (prop === 'z') e.position.z = val;
        else if (prop === 'rot') e.rotation = val;
        sceneGraph.updateTransform(e.id, e.position, e.rotation, e.scale);
        cmdStack.execute(TransformCmd(
          sceneGraph, e.id,
          oldPos, oldRot, e.scale,
          { ...e.position }, e.rotation, e.scale,
        ));
        reattachGizmo();
      });
    });
  } else {
    content.innerHTML = `<p class="bv2-empty">${entities.length} objects selected.</p>`;
  }
}

// ── Delete selected ───────────────────────────────────────────
function onDelete() {
  const entities = selection.all();
  if (entities.length === 0) return;
  selection.clear(true);
  for (const entity of entities) {
    cmdStack.execute(DeleteObjectCmd(sceneGraph, entity.id, entity));
    // Remove from grid
    gridState.remove(
      snapToGrid(entity.position.x),
      snapToGrid(entity.position.z),
    );
  }
  gizmo.detach();
  updateInspector();
}

function onEscape() {
  selection.clear();
  gizmo.detach();
  removeGhost();
  activePlacementKey = null;
  activeExtraTool = null;
  manualRotation = null;
  objectsPanel.deselect();
  extrasPanel.deselect();
  gridState.hideIndicators();
  inputRouter.setTool(TOOL.SELECT);
  setHint('');
}

// ── Save / Load / Share handlers ──────────────────────────────
function onSave() {
  const name = nameInput?.value?.trim() || 'Untitled Arena';
  serializer.saveToSlot(name, 'Builder v2');
  showToast(`Saved "${name}"`, 'success');
}

function onLoad() {
  const slots = serializer.listSlots();
  if (slots.length === 0) {
    showToast('No saved arenas found', 'warn');
    return;
  }

  // Simple prompt-based load (could be upgraded to a modal)
  const names = slots.map((s, i) => `${i + 1}. ${s.name}`).join('\n');
  const choice = prompt(`Load arena:\n${names}\n\nEnter number:`);
  if (!choice) return;

  const idx = parseInt(choice, 10) - 1;
  if (idx < 0 || idx >= slots.length) return;

  const data = serializer.loadFromSlot(slots[idx].key);
  if (data) {
    loadTrackData(data);
    showToast(`Loaded "${data.name}"`, 'success');
  }
}

function onShare() {
  const name = nameInput?.value?.trim() || 'Untitled Arena';
  const code = serializer.exportShareCode(name, 'Builder v2');
  if (code) {
    navigator.clipboard?.writeText(code).then(() => {
      showToast('Share code copied to clipboard!', 'success');
    }).catch(() => {
      prompt('Copy this share code:', code);
    });
  } else {
    showToast('Nothing to share — place some objects first.', 'warn');
  }
}

function onPlaytest() {
  const name = nameInput?.value?.trim() || 'Untitled Arena';
  const result = playtestBridge.launch(name, 'Builder v2');
  if (!result.ok) {
    showToast(result.reason, 'warn');
  }
}

// ── Load track data into scene ────────────────────────────────
async function loadTrackData(data) {
  // Clear current
  sceneGraph.clear();
  roadPainter.clearAll();
  gridState.clear();
  selection.clear(true);
  gizmo.detach();
  cmdStack.clear();

  if (nameInput) nameInput.value = data.name || 'Untitled Arena';

  // Road cells
  if (data.roadCells?.length) {
    await roadPainter.deserialize(data.roadCells);
    syncRoadToGrid();
  }

  // Segments
  for (const seg of (data.segments || [])) {
    try {
      const model = await loadModel(seg.type);
      model.position.set(seg.position.x, seg.position.y || 0, seg.position.z);
      model.rotation.y = -(seg.rotation * Math.PI / 180);
      if (seg.scale && seg.scale !== 1) model.scale.setScalar(seg.scale);

      const entity = sceneGraph.add({
        id: seg.id,
        type: seg.type,
        category: 'segment',
        modelKey: seg.type,
        object3D: model,
        position: { ...seg.position },
        rotation: seg.rotation || 0,
        scale: seg.scale || 1,
      });

      // Register in grid
      const gx = snapToGrid(seg.position.x);
      const gz = snapToGrid(seg.position.z);
      gridState.set(gx, gz, seg.type, seg.rotation || 0, 'entity', entity.id);
    } catch {
      console.warn(`[builder] Skipping unknown segment type: ${seg.type}`);
    }
  }

  // Obstacles
  for (const obs of (data.obstacles || [])) {
    const obj3D = createItemBoxMarker(obs.type, obs.position.x, obs.position.y || 0, obs.position.z);
    sceneGraph.add({
      id: obs.id,
      type: obs.type,
      category: 'obstacle',
      modelKey: obs.type,
      object3D: obj3D,
      position: { ...obs.position },
      rotation: 0,
      scale: 1,
    });
  }

  // Start positions
  for (const sp of (data.startPositions || [])) {
    const obj3D = createSpawnMarker(sp.id, sp.position.x, sp.position.y || 0, sp.position.z, sp.heading);
    sceneGraph.add({
      id: sp.id,
      type: 'spawn',
      category: 'spawn',
      modelKey: 'spawn',
      object3D: obj3D,
      position: { ...sp.position },
      rotation: 0,
      scale: 1,
      heading: sp.heading || 0,
    });
  }

  // Fit camera to content
  const bounds = sceneGraph.getBounds();
  camCtrl.fitToExtent(bounds.min, bounds.max);

  setHint(`Loaded "${data.name}" — ${sceneGraph.entities.size} objects`);
}

// ── Auto-save ─────────────────────────────────────────────────
function triggerAutoSave() {
  const name = nameInput?.value?.trim() || 'Untitled Arena';
  serializer.autoSave(name, 'Builder v2');
}

// ── Toast notifications ───────────────────────────────────────
function showToast(msg, type = 'info') {
  const wrap = document.getElementById('bv2-toast-wrap');
  if (!wrap) return;
  const toast = document.createElement('div');
  toast.className = `bv2-toast bv2-toast--${type}`;
  toast.textContent = msg;
  wrap.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

function setHint(text) {
  if (hint) hint.textContent = text;
}

// ── Load auto-save on startup ─────────────────────────────────
(async function init() {
  const autoSave = serializer.loadAutoSave();
  if (autoSave) {
    await loadTrackData(autoSave);
    setHint('Restored auto-saved session. Start building!');
  } else {
    setHint('Arena Builder v2 ready. Pick a tool to start.');
  }
  console.log('[builder-v2] Initialized');
})();

