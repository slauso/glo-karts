/**
 * builder-app.js — TinkerTracks — main orchestrator.
 *
 * Wires together: viewport, camera, input, scene graph, asset loader,
 * selection, transform gizmo, command stack, road painter, extras,
 * terrain, serializer, and playtest bridge.
 */
import * as THREE from 'three';
import { createViewport } from './viewport.js';
import { CameraController } from './camera-controller.js';
import { SceneGraph } from './scene-graph.js';
import { getModelMeta, loadModel } from './asset-loader.js';
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
import { ViewCube } from './view-cube.js';
import { GridState, PIECE_DEFS, getGridLayer, makeGhostMaterial, tintGhost } from './grid-placement.js';
import { GRID_SIZE, snapToGrid, cellKey } from '../modules/track-placement.js';
import { publishTrack, browseTracks } from '../modules/track-api.js';

// ── DOM refs ──────────────────────────────────────────────────
const builderRoot = document.getElementById('builder-root');
const canvas = document.getElementById('bv2-viewport');
const stage = document.getElementById('bv2-stage');
const hint = document.getElementById('bv2-hint');
const nameInput = document.getElementById('bv2-name');
const sidebarModeEl = document.getElementById('bv2-sidebar-mode');
const landingOverlay = document.getElementById('bv2-landing');
const landingSubtitle = document.getElementById('bv2-landing-subtitle');
const landingResumeBtn = document.getElementById('bv2-land-continue');
const landingResumeCopy = document.getElementById('bv2-land-autosave-info');
const landingNewTrackBtn = document.getElementById('bv2-land-new');
const landingNewArenaBtn = document.getElementById('bv2-land-new-arena');
const landingCloseBtn = document.getElementById('bv2-landing-close');
const recentProjectsEl = document.getElementById('bv2-recent-projects');
const landSavedBtn = document.getElementById('bv2-land-saved');
const landImportBtn = document.getElementById('bv2-land-import');
const landBackBtn = document.getElementById('bv2-land-back');
const landSavesPanel = document.getElementById('bv2-land-saves-panel');
const landSavesClose = document.getElementById('bv2-land-saves-close');
const landSavesList = document.getElementById('bv2-land-saves-list');
const landImportPanel = document.getElementById('bv2-land-import-panel');
const landImportClose = document.getElementById('bv2-land-import-close');
const landImportCode = document.getElementById('bv2-land-import-code');
const landImportGo = document.getElementById('bv2-land-import-go');
const selectionHudEl = document.getElementById('bv2-selection-hud');
const selectionTitleEl = document.getElementById('bv2-selection-title');
const selectionMetaEl = document.getElementById('bv2-selection-meta');
const selectionTipEl = document.getElementById('bv2-selection-tip');
const projectsBtn = document.getElementById('bv2-projects');
const helpBtn = document.getElementById('bv2-help-btn');
const helpPanel = document.getElementById('bv2-help');
const helpCloseBtn = document.getElementById('bv2-help-close');
const focusBtn = document.getElementById('bv2-focus');
const duplicateBtn = document.getElementById('bv2-duplicate');
const viewHomeBtn = document.getElementById('bv2-view-home');
const viewCubeCanvas = document.getElementById('bv2-viewcube');
const zoomInBtn = document.getElementById('bv2-zoom-in');
const zoomOutBtn = document.getElementById('bv2-zoom-out');
const camToggleLabel = document.getElementById('bv2-cam-toggle-label');
const playtestBtn = document.getElementById('bv2-play');
const actionRing = document.getElementById('bv2-action-ring');
const contextMenu = document.getElementById('bv2-context-menu');
const marqueeEl = document.getElementById('bv2-marquee');
const urlParams = new URLSearchParams(window.location.search);
const forcedPreset = ['track', 'arena'].includes(urlParams.get('preset')) ? urlParams.get('preset') : null;
const forceFreshWorkspace = urlParams.get('fresh') === '1';

const PRESET_UI = Object.freeze({
  track: {
    title: 'GLO KARTS - TinkerTracks',
    sidebar: {
      kicker: 'TinkerTracks',
      title: 'Design. Place. Race.',
    },
    toolbar: {
      roadLabel: 'Road',
      roadTitle: 'Road Painter (2)',
      placeLabel: 'Segment',
      placeTitle: 'Place Track Segment (3)',
    },
    tabs: {
      road: { label: 'Road', title: 'Paint your road layout' },
      objects: { label: 'Segments', title: 'Track pieces' },
      extras: { label: 'Race Setup', title: 'Spawns, checkpoints, pickups' },
      terrain: { label: 'Terrain', title: 'Ground and grid settings' },
    },
    objects: {
      sections: [
        {
          id: 'road-core',
          label: 'Road Core',
          icon: 'R',
          assetKeys: ['straight', 'wide'],
        },
        {
          id: 'road-turns',
          label: 'Turns',
          icon: 'T',
          assetKeys: ['corner-small', 'corner-large', 'curve'],
        },
        {
          id: 'road-elevation',
          label: 'Elevation',
          icon: 'E',
          assetKeys: ['bump-up', 'bump-down', 'hill-beginning', 'hill-end', 'hill-complete', 'hill-complete-half', 'corner-small-ramp', 'corner-large-ramp', 'ramp-up', 'ramp-down', 'bridge', 'jump'],
        },
        {
          id: 'road-shaping',
          label: 'Offsets',
          icon: 'F',
          assetKeys: ['bend', 'bend-large', 'skew-left', 'skew-right', 'skew-left-side', 'skew-right-side', 'chicane', 'banked-turn'],
        },
        {
          id: 'road-junctions',
          label: 'Junctions',
          icon: 'J',
          assetKeys: ['t-junction', 'crossroads', 'tunnel'],
        },
        {
          id: 'road-pgh-bridges',
          label: 'Pittsburgh Bridges',
          icon: 'P',
          assetKeys: [
            'bridge-onramp', 'bridge-offramp',
            'pgh-clemente', 'pgh-warhol', 'pgh-carson',
            'pgh-fort-pitt', 'pgh-fort-duquesne',
            'pgh-west-end', 'pgh-veterans', 'pgh-16th-st',
            'pgh-south-10th', 'pgh-31st-st', 'pgh-mckees-rocks',
            'pgh-smithfield', 'pgh-liberty', 'pgh-62nd-st',
            'pgh-birmingham', 'pgh-40th-st',
            'pgh-hot-metal', 'pgh-glenwood',
            'pgh-highland-park', 'pgh-homestead',
          ],
        },
        {
          id: 'road-finish',
          label: 'Start & Finish',
          icon: 'S',
          assetKeys: ['cap-front', 'cap-back', 'end'],
        },
      ],
    },
    extras: {
      groups: [
        {
          label: 'Race Starts',
          tools: [
            { id: 'spawn', label: 'Start Slot' },
          ],
        },
        {
          label: 'Checkpoints',
          tools: [
            { id: 'checkpoint', label: 'Gate' },
            { id: 'barrier', label: 'Barrier' },
          ],
        },
        {
          label: 'Pickups',
          tools: [
            { id: 'boost_pad', label: 'Boost Pad' },
            { id: 'item_box', label: 'Item Box' },
          ],
        },
      ],
    },
    roadContent: `
      <div class="bv2-road-keys">
        <div class="bv2-key-row"><kbd>Click + Drag</kbd><span>Paint road</span></div>
        <div class="bv2-key-row"><kbd>R</kbd><span>Rotate piece</span></div>
        <div class="bv2-key-row"><kbd>4</kbd><span>Erase</span></div>
        <div class="bv2-key-row"><kbd>W</kbd><span>Top-down view</span></div>
      </div>
    `,
    defaultPanel: 'road',
    defaultTool: TOOL.ROAD,
    defaultName: 'New Race Track',
    namePlaceholder: 'Track Name',
    defaultHint: 'Paint the road first, then add pieces and race markers.',
    toolHints: {
      [TOOL.SELECT]: 'Click to select. Drag empty space to box-select. Ctrl+A to select all.',
      [TOOL.ROAD]: 'Click and drag to paint road. W for top-down view.',
      [TOOL.PLACE]: 'Pick a piece from the sidebar, then click to place.',
      [TOOL.ERASE]: 'Click or drag to erase.',
    },
  },
  arena: {
    title: 'GLO KARTS - TinkerTracks',
    sidebar: {
      kicker: 'TinkerTracks',
      title: 'Build. Fight. Win.',
    },
    toolbar: {
      roadLabel: 'Flow Paint',
      roadTitle: 'Paint Movement Lanes (2)',
      placeLabel: 'Structure',
      placeTitle: 'Place Arena Structure (3)',
    },
    tabs: {
      road: { label: 'Flow', title: 'Optional movement lanes' },
      objects: { label: 'Structures', title: 'Arena building blocks' },
      extras: { label: 'Combat', title: 'Spawns, pickups, barriers' },
      terrain: { label: 'Terrain', title: 'Ground and grid settings' },
    },
    objects: {
      sections: [
        {
          id: 'arena-floor',
          label: 'Floor Plates',
          icon: 'P',
          assetKeys: ['wide', 'straight', 't-junction', 'crossroads'],
        },
        {
          id: 'arena-choke',
          label: 'Chokepoints',
          icon: 'C',
          assetKeys: ['corner-small', 'corner-large', 'curve', 'banked-turn', 'tunnel', 'chicane', 'cap-front', 'cap-back', 'end'],
        },
        {
          id: 'arena-cover',
          label: 'Cover',
          icon: 'B',
          assetKeys: ['bend', 'bend-large', 'skew-left', 'skew-right', 'skew-left-side', 'skew-right-side'],
        },
        {
          id: 'arena-height',
          label: 'Height',
          icon: 'V',
          assetKeys: ['bump-up', 'bump-down', 'hill-beginning', 'hill-end', 'hill-complete', 'hill-complete-half', 'corner-small-ramp', 'corner-large-ramp', 'ramp-up', 'ramp-down', 'bridge', 'jump'],
        },
        {
          id: 'arena-pgh-bridges',
          label: 'Pittsburgh Bridges',
          icon: 'P',
          assetKeys: [
            'bridge-onramp', 'bridge-offramp',
            'pgh-clemente', 'pgh-warhol', 'pgh-carson',
            'pgh-fort-pitt', 'pgh-fort-duquesne',
            'pgh-west-end', 'pgh-veterans', 'pgh-16th-st',
            'pgh-south-10th', 'pgh-31st-st', 'pgh-mckees-rocks',
            'pgh-smithfield', 'pgh-liberty', 'pgh-62nd-st',
            'pgh-birmingham', 'pgh-40th-st',
            'pgh-hot-metal', 'pgh-glenwood',
            'pgh-highland-park', 'pgh-homestead',
          ],
        },
      ],
    },
    extras: {
      groups: [
        {
          label: 'Player Spawns',
          tools: [
            { id: 'spawn', label: 'Spawn Pad' },
            { id: 'checkpoint', label: 'Control Gate' },
          ],
        },
        {
          label: 'Pickups',
          tools: [
            { id: 'item_box', label: 'Pickup Crate' },
            { id: 'boost_pad', label: 'Boost Strip' },
          ],
        },
        {
          label: 'Cover',
          tools: [
            { id: 'barrier', label: 'Cover Block' },
          ],
        },
      ],
    },
    roadContent: `
      <div class="bv2-road-keys">
        <div class="bv2-key-row"><kbd>Click + Drag</kbd><span>Paint flow lanes</span></div>
        <div class="bv2-key-row"><kbd>R</kbd><span>Rotate</span></div>
        <div class="bv2-key-row"><kbd>4</kbd><span>Erase</span></div>
        <div class="bv2-key-row"><kbd>F</kbd><span>Frame view</span></div>
      </div>
    `,
    defaultPanel: 'objects',
    defaultTool: TOOL.SELECT,
    defaultName: 'New Battle Arena',
    namePlaceholder: 'Arena Name',
    defaultHint: 'Place structures and combat markers to build your arena.',
    toolHints: {
      [TOOL.SELECT]: 'Click to select. Drag empty space to box-select. Ctrl+A to select all.',
      [TOOL.ROAD]: 'Click and drag to paint movement lanes.',
      [TOOL.PLACE]: 'Pick a piece from the sidebar, then click to place.',
      [TOOL.ERASE]: 'Click or drag to erase.',
    },
  },
});

function getPresetUi(preset = 'arena') {
  return PRESET_UI[preset] || PRESET_UI.arena;
}

// ── Viewport ──────────────────────────────────────────────────
const { renderer, scene, ground, grid, entityGroup } = createViewport(canvas);

// Expose for automated testing / debugging (non-production only)
if (typeof window !== 'undefined') {
  window.__scene = scene;
  window.__THREE = THREE;
  window.__renderer = renderer;
}

// ── Camera ────────────────────────────────────────────────────
const camCtrl = new CameraController(canvas, renderer);
if (typeof window !== 'undefined') {
  window.__camCtrl = camCtrl;
}

// ── ViewCube (TinkerCad-style 3D orientation widget) ──────────
const viewCube = new ViewCube(
  viewCubeCanvas,
  () => {
    // Derive spherical angles from OrbitControls
    const offset = new THREE.Vector3().subVectors(camCtrl.camera.position, camCtrl.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    return { azimuth: spherical.theta, polar: spherical.phi };
  },
  (faceName) => {
    // Map cube face names to existing view presets
    const map = { front: 'front', back: 'back', left: 'left', right: 'right', top: 'top', bottom: 'home' };
    setCameraView(map[faceName] || 'home');
  },
);
viewCube.onDragRotate = (dAzimuth, dPolar) => {
  // Orbit the main camera by adjusting OrbitControls spherical angles
  const offset = new THREE.Vector3().subVectors(camCtrl.camera.position, camCtrl.controls.target);
  const spherical = new THREE.Spherical().setFromVector3(offset);
  spherical.theta += dAzimuth;
  spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi + dPolar));
  offset.setFromSpherical(spherical);
  camCtrl.camera.position.copy(camCtrl.controls.target).add(offset);
  camCtrl.camera.lookAt(camCtrl.controls.target);
  camCtrl.controls.update();
};

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
  syncEntityGridFromScene();
  triggerAutoSave();
  updateInspector();
  updateSelectionHud();
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
let roadGridDirty = false;     // road grid needs re-sync (after erase)
let currentPreset = 'arena';
let currentAutoSave = null;

function getBuilderSegmentSnapshot(entity) {
  const bbox = new THREE.Box3().setFromObject(entity.object3D);
  const size = bbox.getSize(new THREE.Vector3());
  const center = bbox.getCenter(new THREE.Vector3());
  const meta = getModelMeta(entity.type);
  const portAnchors = meta?.portAnchors || {};

  const connectors = Object.entries(portAnchors).map(([baseDir, anchor]) => {
    const local = new THREE.Vector3(anchor.x, anchor.y, anchor.z);
    local.applyAxisAngle(new THREE.Vector3(0, 1, 0), -(Number(entity.rotation || 0) * Math.PI) / 180);
    const world = local.add(new THREE.Vector3(entity.position.x, entity.position.y || 0, entity.position.z));
    return {
      baseDir: Number(baseDir),
      position: {
        x: Number(world.x.toFixed(3)),
        y: Number(world.y.toFixed(3)),
        z: Number(world.z.toFixed(3)),
      },
    };
  });

  return {
    id: String(entity.id),
    type: entity.type,
    position: {
      x: Number((entity.position.x || 0).toFixed(3)),
      y: Number((entity.position.y || 0).toFixed(3)),
      z: Number((entity.position.z || 0).toFixed(3)),
    },
    rotation: Number(entity.rotation || 0),
    scale: Number(entity.scale || 1),
    bounds: {
      min: {
        x: Number(bbox.min.x.toFixed(3)),
        y: Number(bbox.min.y.toFixed(3)),
        z: Number(bbox.min.z.toFixed(3)),
      },
      max: {
        x: Number(bbox.max.x.toFixed(3)),
        y: Number(bbox.max.y.toFixed(3)),
        z: Number(bbox.max.z.toFixed(3)),
      },
      center: {
        x: Number(center.x.toFixed(3)),
        y: Number(center.y.toFixed(3)),
        z: Number(center.z.toFixed(3)),
      },
      size: {
        x: Number(size.x.toFixed(3)),
        y: Number(size.y.toFixed(3)),
        z: Number(size.z.toFixed(3)),
      },
    },
    connectors,
  };
}

function getBuilderParitySnapshot() {
  return {
    preset: currentPreset,
    placement: (typeof window !== 'undefined' && window.__builderDebug?.placement) || null,
    segments: sceneGraph.getByCategory('segment').map(getBuilderSegmentSnapshot),
    roadCells: roadPainter.serialize().map((roadCell) => ({
      id: Number(roadCell.id || 0),
      position: {
        x: Number((roadCell.position?.x || 0).toFixed(3)),
        y: Number((roadCell.position?.y || 0).toFixed(3)),
        z: Number((roadCell.position?.z || 0).toFixed(3)),
      },
    })),
    playtestTrackData: serializer.buildPlaytestTrackData(
      nameInput?.value?.trim() || 'Untitled Track',
      'TinkerTracks',
      { preset: currentPreset },
    ),
  };
}

if (typeof window !== 'undefined') {
  window.__builderDebug = {
    sceneGraph,
    roadPainter,
    gridState,
    selection,
    serializer,
    playtestBridge,
    currentPreset,
    placement: null,
    getParitySnapshot: () => getBuilderParitySnapshot(),
  };
}

// ── Sidebar Panels ────────────────────────────────────────────
const objectsPanel = new ObjectsPanel(
  document.getElementById('bv2-panel-objects'),
  (key) => {
    activePlacementKey = key;
    manualRotation = null;
    if (key) {
      inputRouter.setTool(TOOL.PLACE);
      setHint(`Click to place ${key}. Move mouse to orient, R to rotate.`);
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
    <div class="bv2-panel-section-head">Road Painting</div>
    <div style="padding:12px;font-size:0.82rem;color:#888;line-height:1.5;">
      <p><b style="color:#c8c8d8">Click & drag</b> to paint road.</p>
      <p style="margin-top:8px;">Pieces auto-connect to neighbors.</p>
      <p style="margin-top:8px;"><b style="color:#c8c8d8">R</b> to rotate · <b style="color:#c8c8d8">4</b> to erase</p>
    </div>
  `;
}

const terrainPanel = new TerrainPanel(
  document.getElementById('bv2-panel-terrain'),
  ground, grid, scene,
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
  onDuplicate: onDuplicate,
  onCopy: onCopy,
  onPaste: onPaste,
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
    if (camToggleLabel) camToggleLabel.textContent = isOrtho ? 'Persp' : 'Ortho';
    setHint(isOrtho ? 'Top-down view' : '3D view');
    reattachGizmo();
  },
  onFocus: () => focusSelectionOrWorkspace(),
  onTopView: () => setCameraView('top'),
  onToggleHelp: toggleHelpPanel,
  onNudge: (dx, dz) => nudgeSelection(dx, dz),
  onGizmoMode: (mode) => {
    setGizmoMode(mode, { forceSelect: true });
  },
});

// ── Toolbar buttons ───────────────────────────────────────────
const toolButtons = {
  [TOOL.SELECT]: document.getElementById('bv2-tool-select'),
  [TOOL.ROAD]:   document.getElementById('bv2-tool-road'),
  [TOOL.PLACE]:  document.getElementById('bv2-tool-place'),
  [TOOL.ERASE]:  document.getElementById('bv2-tool-erase'),
};
const gizmoButtons = {
  translate: [
    document.getElementById('bv2-gizmo-move'),
    document.getElementById('bv2-selection-move'),
  ],
  rotate: [
    document.getElementById('bv2-gizmo-rotate'),
    document.getElementById('bv2-selection-rotate'),
  ],
  scale: [
    document.getElementById('bv2-gizmo-scale'),
    document.getElementById('bv2-selection-scale'),
  ],
};

Object.entries(toolButtons).forEach(([tool, btn]) => {
  btn?.addEventListener('click', () => inputRouter.setTool(tool));
});
Object.entries(gizmoButtons).forEach(([mode, buttons]) => {
  buttons.filter(Boolean).forEach((btn) => {
    btn.addEventListener('click', () => setGizmoMode(mode, { forceSelect: true }));
  });
});

document.getElementById('bv2-undo')?.addEventListener('click', () => cmdStack.undo());
document.getElementById('bv2-redo')?.addEventListener('click', () => cmdStack.redo());
duplicateBtn?.addEventListener('click', onDuplicate);
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
  document.getElementById('bv2-cam-toggle')?.classList.toggle('active', isOrtho);
  if (camToggleLabel) camToggleLabel.textContent = isOrtho ? 'Persp' : 'Ortho';
});
document.getElementById('bv2-save')?.addEventListener('click', onSave);
document.getElementById('bv2-load')?.addEventListener('click', onLoad);
document.getElementById('bv2-share')?.addEventListener('click', onShare);
document.getElementById('bv2-publish')?.addEventListener('click', onPublish);
document.getElementById('bv2-browse')?.addEventListener('click', onBrowse);
document.getElementById('bv2-play')?.addEventListener('click', onPlaytest);
projectsBtn?.addEventListener('click', openLanding);
helpBtn?.addEventListener('click', toggleHelpPanel);
helpCloseBtn?.addEventListener('click', closeHelpPanel);
focusBtn?.addEventListener('click', () => focusSelectionOrWorkspace());
viewHomeBtn?.addEventListener('click', () => setCameraView('home'));
zoomInBtn?.addEventListener('click', () => {
  const offset = new THREE.Vector3().subVectors(camCtrl.camera.position, camCtrl.controls.target);
  offset.multiplyScalar(0.75);
  camCtrl.camera.position.copy(camCtrl.controls.target).add(offset);
  camCtrl.controls.update();
});
zoomOutBtn?.addEventListener('click', () => {
  const offset = new THREE.Vector3().subVectors(camCtrl.camera.position, camCtrl.controls.target);
  offset.multiplyScalar(1.33);
  camCtrl.camera.position.copy(camCtrl.controls.target).add(offset);
  camCtrl.controls.update();
});
landingResumeBtn?.addEventListener('click', () => {
  closeLanding();
  setHint('Session resumed.');
});
landingNewTrackBtn?.addEventListener('click', () => openDedicatedFork('track'));
landingNewArenaBtn?.addEventListener('click', () => openDedicatedFork('arena'));
landingCloseBtn?.addEventListener('click', closeLanding);
landSavedBtn?.addEventListener('click', toggleSavesPanel);
landImportBtn?.addEventListener('click', toggleImportPanel);
landBackBtn?.addEventListener('click', () => { window.location.href = '/'; });
landSavesClose?.addEventListener('click', () => { landSavesPanel?.setAttribute('hidden', ''); });
landImportClose?.addEventListener('click', () => { landImportPanel?.setAttribute('hidden', ''); });
landImportGo?.addEventListener('click', handleImportGo);
document.getElementById('bv2-back')?.addEventListener('click', () => {
  window.location.href = '/';
});

// Init grid snap active state
document.getElementById('bv2-grid-snap')?.classList.toggle('active', gridSnap);

// ── Action ring buttons ───────────────────────────────────────
document.getElementById('bv2-ring-cw')?.addEventListener('click', () => {
  const entities = selection.all();
  if (entities.length) rotateEntities(entities, 90);
});
document.getElementById('bv2-ring-ccw')?.addEventListener('click', () => {
  const entities = selection.all();
  if (entities.length) rotateEntities(entities, -90);
});
document.getElementById('bv2-ring-delete')?.addEventListener('click', onDelete);
document.getElementById('bv2-ring-duplicate')?.addEventListener('click', onDuplicate);

// ── Context menu wiring ───────────────────────────────────────
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  // Only show if something is selected or we can pick one
  const rect = canvas.getBoundingClientRect();
  const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  const pointer = new THREE.Vector2(ndcX, ndcY);
  const pickedId = selection.pick(camCtrl.camera, pointer, entityGroup);

  if (pickedId !== null && !selection.has(pickedId)) {
    selection.select(pickedId);
  }

  if (!selection.isEmpty) {
    showContextMenu(e.clientX, e.clientY);
  }
});

contextMenu?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const entities = selection.all();
  if (action === 'rotate-cw' && entities.length) rotateEntities(entities, 90);
  else if (action === 'rotate-ccw' && entities.length) rotateEntities(entities, -90);
  else if (action === 'duplicate') onDuplicate();
  else if (action === 'delete') onDelete();
  hideContextMenu();
});

// Dismiss context menu on any left-click or escape
window.addEventListener('pointerdown', (e) => {
  if (contextMenu && !contextMenu.hidden && !contextMenu.contains(e.target)) {
    hideContextMenu();
  }
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && contextMenu && !contextMenu.hidden) {
    hideContextMenu();
  }
});

// ── Sidebar tab switching ─────────────────────────────────────
const tabs = Array.from(document.querySelectorAll('.bv2-tab'));
const panels = Array.from(document.querySelectorAll('.bv2-panel'));
const panelTabs = new Map(tabs.map((tab) => [tab.dataset.panel, tab]));
const panelNodes = new Map(panels.map((panel) => [panel.id.replace('bv2-panel-', ''), panel]));
tabs.forEach((tab) => {
  tab.addEventListener('click', () => activatePanel(tab.dataset.panel));
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
  viewCube.update();
  renderer.render(scene, camCtrl.camera);
  requestAnimationFrame(animate);
}
animate();

function resetBuilderWorkspace({ clearName = false } = {}) {
  sceneGraph.clear();
  roadPainter.clearAll();
  gridState.clear();
  selection.clear(true);
  gizmo.detach();
  cmdStack.clear();
  camCtrl.reset();
  centerBuildSurface(DEFAULT_VIEW_BOUNDS);
  inputRouter.setTool(TOOL.SELECT);
  removeGhost();
  activePlacementKey = null;
  activeExtraTool = null;
  manualRotation = null;
  lastGhostCell = null;
  isPainting = false;
  objectsPanel.deselect();
  extrasPanel.deselect();
  roadPainter.hideGhost();
  gridState.hideIndicators();
  if (clearName && nameInput) nameInput.value = '';
  updateInspector();
  updateSelectionHud();
  updateGizmoButtons();
}

function activatePanel(panelId = 'objects') {
  const visiblePanelIds = tabs
    .filter((tab) => !tab.hidden)
    .map((tab) => tab.dataset.panel);
  const targetPanelId = visiblePanelIds.includes(panelId)
    ? panelId
    : (visiblePanelIds[0] || 'objects');

  tabs.forEach((tab) => {
    tab.classList.toggle('active', !tab.hidden && tab.dataset.panel === targetPanelId);
  });
  panels.forEach((panel) => {
    const isTarget = panel.id === `bv2-panel-${targetPanelId}`;
    panel.classList.toggle('active', isTarget);
    panel.hidden = !isTarget;
  });
}

function applyPresetSidebar(preset = 'arena') {
  const ui = getPresetUi(preset);

  if (builderRoot) {
    builderRoot.dataset.preset = preset;
  }

  if (sidebarModeEl) {
    sidebarModeEl.innerHTML = `
      <p class="bv2-sidebar-kicker">${ui.sidebar.kicker}</p>
      <h2 class="bv2-sidebar-title">${ui.sidebar.title}</h2>
    `;
  }

  Object.entries(ui.tabs).forEach(([panelId, config]) => {
    const tab = panelTabs.get(panelId);
    if (!tab) return;
    tab.textContent = config.label;
    tab.title = config.title;
    tab.hidden = config.visible === false;
  });

  // Only update title attr — preserve SVG icon content
  if (toolButtons[TOOL.ROAD]) {
    toolButtons[TOOL.ROAD].title = ui.toolbar.roadTitle;
  }
  if (toolButtons[TOOL.PLACE]) {
    toolButtons[TOOL.PLACE].title = ui.toolbar.placeTitle;
  }

  objectsPanel.setLibrary(ui.objects);
  extrasPanel.setConfig(ui.extras);
  if (roadPanelEl) {
    roadPanelEl.innerHTML = ui.roadContent;
  }

  activatePanel(ui.defaultPanel);
}

function formatSavedAt(savedAt) {
  if (!Number.isFinite(savedAt)) return 'just now';
  return new Date(savedAt).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function isWorkspaceEmpty() {
  return sceneGraph.entities.size === 0 && roadPainter.cells.size === 0;
}

function updateGizmoButtons() {
  Object.entries(gizmoButtons).forEach(([mode, buttons]) => {
    buttons.filter(Boolean).forEach((btn) => {
      btn.classList.toggle('active', gizmo.mode === mode);
    });
  });
}

function updateSelectionHud() {
  if (!selectionHudEl || !selectionTitleEl || !selectionMetaEl || !selectionTipEl) return;

  if (selection.isEmpty) {
    selectionHudEl.hidden = true;
    return;
  }

  const entities = selection.all();
  const primary = entities[0];
  const pos = primary?.position || { x: 0, y: 0, z: 0 };

  selectionHudEl.hidden = false;
  selectionTitleEl.textContent = entities.length === 1 ? primary.type : `${entities.length} items selected`;
  selectionMetaEl.textContent = entities.length === 1
    ? `${primary.category} · ${Math.round(pos.x)}, ${Math.round(pos.z)}`
    : 'Drag to move. Ctrl+C to copy.';
  selectionTipEl.textContent = entities.length > 1
    ? 'Drag to move group. Ctrl+C / Ctrl+V to copy & paste.'
    : 'Click & drag to move. Use ring buttons to rotate/delete.';
}

// ── Floating action ring (TinkerCad-style) ────────────────────
function updateActionRing() {
  if (!actionRing) return;
  if (selection.isEmpty) {
    actionRing.hidden = true;
    return;
  }
  actionRing.hidden = false;
  positionActionRing();
}

function positionActionRing() {
  if (!actionRing || selection.isEmpty) return;
  const entity = selection.first();
  if (!entity?.object3D) { actionRing.hidden = true; return; }

  // Project entity center to screen space
  const worldPos = new THREE.Vector3(entity.position.x, 0, entity.position.z);
  worldPos.project(camCtrl.camera);
  const rect = stage.getBoundingClientRect();
  const sx = ((worldPos.x + 1) / 2) * rect.width;
  const sy = ((-worldPos.y + 1) / 2) * rect.height - 50; // offset above the piece

  // Clamp to viewport bounds
  const ringW = 180;
  const ringH = 44;
  const clampedX = Math.max(ringW / 2 + 4, Math.min(rect.width - ringW / 2 - 4, sx));
  const clampedY = Math.max(ringH + 4, Math.min(rect.height - 4, sy));

  actionRing.style.left = `${clampedX}px`;
  actionRing.style.top = `${clampedY}px`;
}

// Update action ring position every rendered frame
const _origAnimate = animate;
// Patch into the render loop — update ring position each frame
(function patchRenderLoop() {
  const origRAF = requestAnimationFrame;
  // Instead of patching, we observe camera changes via a simple poll
  setInterval(positionActionRing, 50);
})();

// ── Right-click context menu ──────────────────────────────────
function showContextMenu(x, y) {
  if (!contextMenu) return;
  contextMenu.hidden = false;
  // Position near cursor, clamped to viewport
  const rect = stage.getBoundingClientRect();
  const menuW = 180;
  const menuH = 200;
  const cx = Math.min(x - rect.left, rect.width - menuW - 8);
  const cy = Math.min(y - rect.top, rect.height - menuH - 8);
  contextMenu.style.left = `${Math.max(8, cx)}px`;
  contextMenu.style.top = `${Math.max(8, cy)}px`;
}

function hideContextMenu() {
  if (contextMenu) contextMenu.hidden = true;
}

// ── Entity rotation helper (works on ALL entity types) ────────
function rotateEntities(entities, degrees = 90) {
  for (const entity of entities) {
    const oldRot = entity.rotation;
    const newRot = ((oldRot + degrees) % 360 + 360) % 360;
    cmdStack.execute(TransformCmd(
      sceneGraph, entity.id,
      { ...entity.position }, oldRot, entity.scale,
      { ...entity.position }, newRot, entity.scale,
    ));
    // Update grid for segments
    if (entity.category === 'segment') {
      const gx = snapToGrid(entity.position.x);
      const gz = snapToGrid(entity.position.z);
      gridState.set(gx, gz, entity.type, newRot, 'entity', entity.id);
    }
  }
  reattachGizmo();
  updateInspector();
  const deg = degrees > 0 ? `+${degrees}` : `${degrees}`;
  setHint(`Rotated ${entities.length > 1 ? entities.length + ' items' : entities[0]?.type || 'selection'} ${deg}°`);
}

function closeHelpPanel() {
  helpPanel?.setAttribute('hidden', '');
}

function toggleHelpPanel() {
  if (!helpPanel) return;
  if (helpPanel.hasAttribute('hidden')) {
    helpPanel.removeAttribute('hidden');
    setHint('Press ? to close.');
  } else {
    closeHelpPanel();
  }
}

function getSelectionBounds() {
  const entities = selection.all().filter(Boolean);
  if (!entities.length) return null;

  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;

  entities.forEach((entity) => {
    minX = Math.min(minX, entity.position.x - GRID_SIZE / 2);
    minZ = Math.min(minZ, entity.position.z - GRID_SIZE / 2);
    maxX = Math.max(maxX, entity.position.x + GRID_SIZE / 2);
    maxZ = Math.max(maxZ, entity.position.z + GRID_SIZE / 2);
  });

  return {
    min: { x: minX, z: minZ },
    max: { x: maxX, z: maxZ },
  };
}

function getWorkspaceBounds() {
  return computeViewBounds({
    roadCells: roadPainter.serialize(),
    segments: sceneGraph.getByCategory('segment'),
    obstacles: sceneGraph.getByCategory('obstacle'),
    startPositions: sceneGraph.getByCategory('spawn'),
  });
}

function getCurrentViewBounds() {
  return getSelectionBounds() || getWorkspaceBounds();
}

function setCameraView(view) {
  const bounds = getCurrentViewBounds();
  const isOrtho = camCtrl.setView(view, bounds);
  document.getElementById('bv2-cam-toggle')?.classList.toggle('active', isOrtho);
  if (camToggleLabel) camToggleLabel.textContent = isOrtho ? 'Persp' : 'Ortho';
  gizmo.updateCamera(camCtrl.camera);
  gizmo.init(scene, camCtrl.camera);
  reattachGizmo();
  const label = view === 'home' ? 'Home' : `${view[0].toUpperCase()}${view.slice(1)}`;
  setHint(`${label} view`);
}

function focusSelectionOrWorkspace() {
  const bounds = getCurrentViewBounds();
  camCtrl.fitToExtent(bounds.min, bounds.max);
  gizmo.updateCamera(camCtrl.camera);
  reattachGizmo();
  setHint(selection.isEmpty ? 'Framed project.' : 'Framed selection.');
}

function setGizmoMode(mode, { forceSelect = false } = {}) {
  if (forceSelect && inputRouter.tool !== TOOL.SELECT) {
    inputRouter.setTool(TOOL.SELECT);
  }
  if (mode === 'scale' && !selection.isEmpty && selection.all().every((entity) => entity.category === 'segment')) {
    showToast('Track pieces can\'t be scaled. Use this on props.', 'info');
    return;
  }
  gizmo.setMode(mode);
  updateGizmoButtons();
  updateSelectionHud();
  setHint(selection.isEmpty ? `${mode[0].toUpperCase()}${mode.slice(1)} mode — select a piece to edit.` : `${mode[0].toUpperCase()}${mode.slice(1)} mode`);
}

function closeLanding() {
  landingOverlay?.setAttribute('hidden', '');
  landSavesPanel?.setAttribute('hidden', '');
  landImportPanel?.setAttribute('hidden', '');
}

function toggleSavesPanel() {
  landImportPanel?.setAttribute('hidden', '');
  if (landSavesPanel?.hasAttribute('hidden')) {
    renderSavesPanel();
    landSavesPanel?.removeAttribute('hidden');
  } else {
    landSavesPanel?.setAttribute('hidden', '');
  }
}

function toggleImportPanel() {
  landSavesPanel?.setAttribute('hidden', '');
  if (landImportPanel?.hasAttribute('hidden')) {
    landImportPanel?.removeAttribute('hidden');
    landImportCode?.focus();
  } else {
    landImportPanel?.setAttribute('hidden', '');
  }
}

function renderSavesPanel() {
  if (!landSavesList) return;
  const slots = serializer.listSlots().sort((a, b) => b.savedAt - a.savedAt);
  landSavesList.innerHTML = '';
  if (!slots.length) {
    landSavesList.innerHTML = '<p class="bv2-land-empty">No saved projects yet.</p>';
    return;
  }
  for (const slot of slots) {
    const row = document.createElement('div');
    row.className = 'bv2-land-slot';
    const dateStr = slot.savedAt
      ? new Date(slot.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : '';
    row.innerHTML = `
      <div class="bv2-land-slot-info">
        <div class="bv2-land-slot-name">${escapeSlotHTML(slot.name || 'Untitled')}</div>
        <div class="bv2-land-slot-date">${escapeSlotHTML(dateStr)}</div>
      </div>
      <div class="bv2-land-slot-actions">
        <button class="bv2-btn" data-action="load" title="Open">▶</button>
        <button class="bv2-btn bv2-btn--danger" data-action="del" title="Delete">✕</button>
      </div>`;
    row.querySelector('[data-action="load"]').addEventListener('click', () => loadSavedProject(slot.key));
    row.querySelector('[data-action="del"]').addEventListener('click', () => {
      serializer.deleteSlot(slot.key);
      renderSavesPanel();
      renderRecentProjects();
    });
    landSavesList.appendChild(row);
  }
}

function handleImportGo() {
  const code = landImportCode?.value?.trim();
  if (!code) return;
  try {
    const data = serializer.importShareCode(code);
    if (data) {
      landImportPanel?.setAttribute('hidden', '');
      loadTrackData(data).then(() => {
        closeLanding();
        showToast('Imported track from share code.', 'success');
      });
    } else {
      landImportCode.style.borderColor = '#f66';
      setTimeout(() => { landImportCode.style.borderColor = ''; }, 1200);
    }
  } catch {
    landImportCode.style.borderColor = '#f66';
    setTimeout(() => { landImportCode.style.borderColor = ''; }, 1200);
  }
}

function escapeSlotHTML(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function renderRecentProjects() {
  if (!recentProjectsEl) return;

  const slots = serializer.listSlots().sort((a, b) => b.savedAt - a.savedAt);
  recentProjectsEl.innerHTML = '';

  if (!slots.length) {
    const empty = document.createElement('div');
    empty.className = 'bv2-recent-empty';
    empty.textContent = 'No saved projects yet.';
    recentProjectsEl.appendChild(empty);
    return;
  }

  slots.slice(0, 8).forEach((slot) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'bv2-recent-item';
    item.innerHTML = `
      <span class="bv2-recent-name">${slot.name}</span>
      <span class="bv2-recent-meta">${slot.author} . ${formatSavedAt(slot.savedAt)}</span>
    `;
    item.addEventListener('click', () => loadSavedProject(slot.key));
    recentProjectsEl.appendChild(item);
  });
}

function openLanding() {
  closeHelpPanel();
  const workspaceLabel = nameInput?.value?.trim() || (currentPreset === 'track' ? 'Race Track' : 'Arena');
  const hasAutoSave = Boolean(currentAutoSave);

  if (landingSubtitle) {
    landingSubtitle.textContent = hasAutoSave
      ? `Working on: ${workspaceLabel}`
      : 'Start a new project or open a recent save.';
  }
  if (landingResumeBtn) {
    landingResumeBtn.disabled = !hasAutoSave;
    landingResumeBtn.classList.toggle('is-disabled', !hasAutoSave);
  }
  if (landingResumeCopy) {
    landingResumeCopy.textContent = hasAutoSave
      ? `"${currentAutoSave.name || workspaceLabel}" · ${formatSavedAt(currentAutoSave.savedAt)}`
      : 'No auto-save available.';
  }

  renderRecentProjects();
  landingOverlay?.removeAttribute('hidden');
}

function applyWorkspacePreset(preset = 'arena') {
  currentPreset = preset;
  const ui = getPresetUi(preset);

  if (typeof window !== 'undefined' && window.__builderDebug) {
    window.__builderDebug.currentPreset = currentPreset;
  }

  applyPresetSidebar(preset);
  if (playtestBtn) {
    playtestBtn.textContent = preset === 'track' ? 'Race Test' : 'Arena Test';
    playtestBtn.title = preset === 'track' ? 'Launch race playtest' : 'Launch arena playtest';
  }

  document.title = ui.title;
  if (!nameInput?.value?.trim() && nameInput) nameInput.value = ui.defaultName;
  if (nameInput) nameInput.placeholder = ui.namePlaceholder;
  inputRouter.setTool(ui.defaultTool);
  setHint(ui.defaultHint);
}

async function loadSavedProject(key) {
  const data = serializer.loadFromSlot(key);
  if (!data) {
    showToast('Could not load that saved project.', 'warn');
    renderRecentProjects();
    return;
  }

  const preset = data.builderPreset === 'track' || data.builderPreset === 'arena'
    ? data.builderPreset
    : (data.roadCells?.length ? 'track' : 'arena');
  const result = await loadTrackData(data);
  currentPreset = preset;
  currentAutoSave = { name: data.name || 'Untitled Track', savedAt: Date.now() };
  applyWorkspacePreset(preset);
  closeLanding();
  updateSelectionHud();

  if (result?.ok) {
    showToast(`Loaded "${data.name || 'Untitled Track'}"`, 'success');
  }
}

function startNewProject(preset = 'arena') {
  serializer.clearAutoSave();
  currentAutoSave = null;
  resetBuilderWorkspace({ clearName: true });
  applyWorkspacePreset(preset);
  closeLanding();
  updateSelectionHud();
  showToast(`Opened a new ${preset === 'track' ? 'race track' : 'battle arena'} project.`, 'info');
}

function openDedicatedFork(preset = 'arena') {
  startNewProject(preset);
}

// ── Tool change ───────────────────────────────────────────────
function onToolChange(tool) {
  const ui = getPresetUi(currentPreset);
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
  setHint(ui.toolHints?.[tool] || '');

  updateSelectionHud();
}

// ── Drag state for click-hold-drag repositioning ──────────────
let dragState = null; // { entityIds[], startPointerWorld, startPositions{}, dragging }

// ── Marquee box-select state ──────────────────────────────────
let marqueeState = null; // { startX, startY } in stage-relative pixels

// ── Clipboard for copy/paste ──────────────────────────────────
let clipboard = null; // [{ type, category, rotation, scale, offset:{x,z}, extra }]

// ── Pointer handlers ──────────────────────────────────────────
function onPointerDown(ndcX, ndcY, event) {
  const pointer = new THREE.Vector2(ndcX, ndcY);
  const pickedEntityId = selection.pick(camCtrl.camera, pointer, entityGroup);

  if (event.detail >= 2 && pickedEntityId !== null) {
    inputRouter.setTool(TOOL.SELECT);
    selection.select(pickedEntityId);
    closeLanding();
    setHint('Selected. Drag to move, or use ring buttons.');
    return;
  }

  if (inputRouter.tool === TOOL.SELECT) {
    if (pickedEntityId !== null) {
      if (event.shiftKey) {
        selection.toggle(pickedEntityId);
      } else if (selection.has(pickedEntityId)) {
        // Already selected — begin multi-entity drag tracking
        const worldPos = selection.pickGround(camCtrl.camera, pointer, ground);
        if (worldPos) {
          const entities = selection.all();
          const startPositions = {};
          entities.forEach(e => { startPositions[e.id] = { ...e.position }; });
          dragState = {
            entityIds: entities.map(e => e.id),
            startPointerWorld: worldPos.clone(),
            startPositions,
            dragging: false,
          };
        }
      } else {
        selection.select(pickedEntityId);
      }
    } else {
      // Click on empty space — start marquee box-select or clear
      if (!event.shiftKey) selection.clear(true);
      const rect = stage.getBoundingClientRect();
      marqueeState = {
        startX: event.clientX - rect.left,
        startY: event.clientY - rect.top,
        active: false,
        shiftKey: event.shiftKey,
      };
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

  // Click-hold-drag for selected entities (multi-entity)
  if (inputRouter.tool === TOOL.SELECT && dragState) {
    const worldPos = selection.pickGround(camCtrl.camera, pointer, ground);
    if (worldPos) {
      if (!dragState.dragging) {
        const dx = worldPos.x - dragState.startPointerWorld.x;
        const dz = worldPos.z - dragState.startPointerWorld.z;
        if (Math.sqrt(dx * dx + dz * dz) < GRID_SIZE * 0.3) return; // movement threshold
        dragState.dragging = true;
        camCtrl.controls.enabled = false;
        if (actionRing) actionRing.hidden = true;
      }

      const offsetX = worldPos.x - dragState.startPointerWorld.x;
      const offsetZ = worldPos.z - dragState.startPointerWorld.z;
      for (const eid of dragState.entityIds) {
        const entity = sceneGraph.get(eid);
        if (entity?.object3D) {
          const sp = dragState.startPositions[eid];
          entity.object3D.position.x = snapToGrid(sp.x + offsetX);
          entity.object3D.position.z = snapToGrid(sp.z + offsetZ);
        }
      }
    }
    return;
  }

  // Marquee box-select drawing
  if (inputRouter.tool === TOOL.SELECT && marqueeState) {
    const rect = stage.getBoundingClientRect();
    const curX = event.clientX - rect.left;
    const curY = event.clientY - rect.top;
    const dx = curX - marqueeState.startX;
    const dy = curY - marqueeState.startY;
    if (!marqueeState.active && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
      marqueeState.active = true;
      camCtrl.controls.enabled = false;
    }
    if (marqueeState.active && marqueeEl) {
      marqueeEl.hidden = false;
      marqueeEl.style.left = `${Math.min(marqueeState.startX, curX)}px`;
      marqueeEl.style.top = `${Math.min(marqueeState.startY, curY)}px`;
      marqueeEl.style.width = `${Math.abs(dx)}px`;
      marqueeEl.style.height = `${Math.abs(dy)}px`;
    }
    return;
  }

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
  if (isPainting || roadGridDirty) {
    isPainting = false;
    roadGridDirty = false;
    // Refresh all road cell classifications — neighbors may have changed
    syncRoadToGrid();
  } else {
    isPainting = false;
  }

  // Finalize click-hold-drag (multi-entity)
  if (dragState) {
    if (dragState.dragging) {
      for (const eid of dragState.entityIds) {
        const entity = sceneGraph.get(eid);
        if (entity) {
          entity.position = {
            x: entity.object3D.position.x,
            y: entity.object3D.position.y,
            z: entity.object3D.position.z,
          };
          onTransformEnd(
            eid,
            dragState.startPositions[eid],
            entity.rotation,
            entity.scale,
          );
        }
      }
      camCtrl.controls.enabled = true;
      updateActionRing();
    }
    dragState = null;
    return;
  }

  // Finalize marquee box-select
  if (marqueeState) {
    if (marqueeState.active) {
      const rect = stage.getBoundingClientRect();
      const curX = event.clientX - rect.left;
      const curY = event.clientY - rect.top;
      const x1 = Math.min(marqueeState.startX, curX);
      const y1 = Math.min(marqueeState.startY, curY);
      const x2 = Math.max(marqueeState.startX, curX);
      const y2 = Math.max(marqueeState.startY, curY);

      if (!marqueeState.shiftKey) selection.clear(true);

      for (const entity of sceneGraph.getAll()) {
        if (!entity.object3D) continue;
        const worldPos = new THREE.Vector3(entity.position.x, 0, entity.position.z);
        worldPos.project(camCtrl.camera);
        const sx = ((worldPos.x + 1) / 2) * rect.width;
        const sy = ((-worldPos.y + 1) / 2) * rect.height;
        if (sx >= x1 && sx <= x2 && sy >= y1 && sy <= y2) {
          selection.toggle(entity.id);
        }
      }
      camCtrl.controls.enabled = true;
    } else {
      // Tiny drag — treat as a click on empty space (clear)
      if (!marqueeState.shiftKey) selection.clear();
    }
    if (marqueeEl) marqueeEl.hidden = true;
    marqueeState = null;
    return;
  }

  if (inputRouter.tool === TOOL.ROAD) {
    triggerAutoSave();
  }
}

// ── Register road cells in shared grid ────────────────────────
function registerRoadCell(worldX, worldZ) {
  const gx = snapToGrid(worldX);
  const gz = snapToGrid(worldZ);
  if (!gridState.isOccupied(gx, gz)) {
    const { model, rotation } = roadPainter.classifyCell(gx, gz);
    gridState.set(gx, gz, model, rotation, 'road');
  }
}

/** Sync all road painter cells into gridState (after load/paint). */
function syncRoadToGrid() {
  gridState.clearBySource('road');
  for (const [key, cell] of roadPainter.cells) {
    const { model, rotation } = roadPainter.classifyCell(cell.x, cell.z);
    gridState.set(cell.x, cell.z, model, rotation, 'road');
  }
}

function syncEntityGridFromScene() {
  gridState.clearBySource('entity');
  for (const entity of sceneGraph.getByCategory('segment')) {
    const gx = snapToGrid(entity.position.x);
    const gz = snapToGrid(entity.position.z);
    const rot = entity.rotation || 0;
    const def = PIECE_DEFS[entity.type];
    const footprint = def?.footprint || [[0, 0]];
    for (const [dx, dz] of footprint) {
      gridState.set(gx + dx * GRID_SIZE, gz + dz * GRID_SIZE, entity.type, rot, 'entity', entity.id);
    }
  }
}

function normalizeRotation(rotation) {
  const normalized = Math.round((Number(rotation) || 0) / 90) * 90;
  return ((normalized % 360) + 360) % 360;
}

function normalizeEntityTransform(entity, { position, rotation, scale }, fallback) {
  const nextPosition = {
    x: Number.isFinite(position?.x) ? position.x : fallback.position.x,
    y: Number.isFinite(position?.y) ? position.y : fallback.position.y,
    z: Number.isFinite(position?.z) ? position.z : fallback.position.z,
  };
  let nextRotation = Number.isFinite(rotation) ? rotation : fallback.rotation;
  let nextScale = Number.isFinite(scale) ? scale : fallback.scale;

  if (gridSnap || entity.category === 'segment' || entity.category === 'spawn') {
    nextPosition.x = snapToGrid(nextPosition.x);
    nextPosition.z = snapToGrid(nextPosition.z);
  }

  if (entity.category === 'segment') {
    nextPosition.y = 0;
    nextRotation = normalizeRotation(nextRotation);
    nextScale = 1;
    const def = PIECE_DEFS[entity.type];
    const footprint = def?.footprint || [[0, 0]];
    const layer = getGridLayer(entity.type);
    const gx = nextPosition.x;
    const gz = nextPosition.z;
    for (const [dx, dz] of footprint) {
      const occupant = gridState.get(gx + dx * GRID_SIZE, gz + dz * GRID_SIZE, layer);
      if (occupant && !(occupant.source === 'entity' && occupant.entityId === entity.id)) {
        return {
          ok: false,
          reason: 'occupied',
          position: { ...fallback.position },
          rotation: fallback.rotation,
          scale: fallback.scale,
        };
      }
    }
  } else {
    nextPosition.y = Math.round(nextPosition.y || 0);
    nextScale = Math.max(0.25, Math.round(nextScale * 4) / 4);
  }

  return {
    ok: true,
    position: nextPosition,
    rotation: nextRotation,
    scale: nextScale,
  };
}

// ── Erase logic (unified for entities + road cells) ───────────
function eraseAtWorld(worldPos, pointer) {
  const gx = snapToGrid(worldPos.x);
  const gz = snapToGrid(worldPos.z);

  // Try erase road cell first
  const erased = roadPainter.erase(worldPos.x, worldPos.z);
  if (erased) {
    gridState.remove(gx, gz);
    roadGridDirty = true;
    return;
  }

  // Try erase scene entity
  const entityId = selection.pick(camCtrl.camera, pointer, entityGroup);
  if (entityId !== null) {
    const entity = sceneGraph.get(entityId);
    if (entity) {
      cmdStack.execute(DeleteObjectCmd(sceneGraph, entityId, entity));
      // Remove all footprint cells for this piece
      const def = PIECE_DEFS[entity.type];
      const footprint = def?.footprint || [[0, 0]];
      const eraseLayer = getGridLayer(entity.type);
      const ex = snapToGrid(entity.position.x);
      const ez = snapToGrid(entity.position.z);
      for (const [dx, dz] of footprint) {
        gridState.remove(ex + dx * GRID_SIZE, ez + dz * GRID_SIZE, eraseLayer);
      }
    }
  }
}

// ── Place track piece (auto-connect aware) ────────────────────
async function placeObject(worldPos) {
  const gx = snapToGrid(worldPos.x);
  const gz = snapToGrid(worldPos.z);

  // Get footprint cells (default: single cell at origin)
  const def = PIECE_DEFS[activePlacementKey];
  const footprint = def?.footprint || [[0, 0]];
  const layer = getGridLayer(activePlacementKey);
  const cells = footprint.map(([dx, dz]) => [gx + dx * GRID_SIZE, gz + dz * GRID_SIZE]);

  // Prevent double-placement: check ALL footprint cells at the same layer
  for (const [cx, cz] of cells) {
    if (gridState.isOccupied(cx, cz, layer)) {
      showToast('Cell is already occupied', 'warn');
      return;
    }
  }

  // Determine rotation: manual override, or ghost preview (mouse-directed / auto-connect)
  const rotation = manualRotation ?? ghostRotation;

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

    // Register all footprint cells
    for (const [cx, cz] of cells) {
      gridState.set(cx, cz, activePlacementKey, rotation, 'entity', entity.id);
    }

    const conns = gridState.getConnections(gx, gz, activePlacementKey, rotation);
    const connected = conns.filter(c => c.status === 'connected').length;
    const rotLabel = manualRotation != null ? `manual ${rotation}°` : (rotation !== 0 ? `auto-rotated ${rotation}°` : '');
    const msg = `Placed ${activePlacementKey}${rotLabel ? ' · ' + rotLabel : ''} · ${connected} join${connected !== 1 ? 's' : ''}`;
    showToast(msg, connected > 0 ? 'success' : 'info');

    // Reset to cursor after placing — user picks next action explicitly
    activePlacementKey = null;
    manualRotation = null;
    removeGhost();
    lastGhostCell = null;
    gridState.hideIndicators();
    inputRouter.setTool(TOOL.SELECT);
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
    // Cycle manual rotation: advance +90 from current ghost rotation
    if (manualRotation === null) {
      // Start from the current auto-connect rotation + 90° so the
      // user always sees an immediate visual change.
      manualRotation = ((ghostRotation || 0) + 90) % 360;
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

  // Rotate ALL selected entities (works on any category)
  const entities = selection.all();
  if (entities.length > 0) {
    rotateEntities(entities, 90);
  }
}

// ── Ghost preview (actual model, mouse-directed rotation) ─────
async function updatePlacementGhost(worldPos) {
  const gx = snapToGrid(worldPos.x);
  const gz = snapToGrid(worldPos.z);
  const key = cellKey(gx, gz);
  const cellChanged = key !== lastGhostCell;

  const activeLayer = activePlacementKey ? getGridLayer(activePlacementKey) : 0;
  const occupied = gridState.isOccupied(gx, gz, activeLayer);

  // Model swap & position/tint only on cell or piece change
  if (cellChanged || !ghostObj || (activeExtraTool || activePlacementKey) !== ghostPieceKey) {
    lastGhostCell = key;

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

    if (ghostObj) {
      ghostObj.position.set(gx, 0, gz);
      ghostObj.visible = true;
      tintGhost(ghostObj, !occupied);
    }
  }

  if (!ghostObj) return;

  // ── Rotation (runs every mouse-move for mouse-directed control) ──
  if (activePlacementKey && PIECE_DEFS[activePlacementKey]) {
    let rot;
    if (manualRotation !== null) {
      rot = manualRotation;
    } else {
      // Mouse-directed rotation: pick the rotation whose ports best
      // face the mouse direction.  Primary score = best single-port
      // alignment (max cosine), tiebreak = sum of all port cosines.
      // Falls back to auto-connect when mouse is near cell center.
      const dx = worldPos.x - gx;
      const dz = worldPos.z - gz;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > GRID_SIZE * 0.15) {
        let mouseAngle = Math.atan2(dx, -dz) * (180 / Math.PI);
        if (mouseAngle < 0) mouseAngle += 360;
        const basePorts = PIECE_DEFS[activePlacementKey].ports;
        const DIR_ANGLE = [0, 90, 180, 270]; // N E S W
        let bestRot = 0, bestMax = -Infinity, bestSum = -Infinity;
        for (const candidate of [0, 90, 180, 270]) {
          const steps = candidate / 90;
          let maxAlign = -Infinity, sumAlign = 0;
          for (const p of basePorts) {
            const portAngle = DIR_ANGLE[(p + steps) % 4];
            let diff = mouseAngle - portAngle;
            if (diff > 180) diff -= 360;
            if (diff < -180) diff += 360;
            const c = Math.cos(diff * Math.PI / 180);
            if (c > maxAlign) maxAlign = c;
            sumAlign += c;
          }
          if (maxAlign > bestMax + 1e-6 ||
              (Math.abs(maxAlign - bestMax) < 1e-6 && sumAlign > bestSum + 1e-6)) {
            bestMax = maxAlign; bestSum = sumAlign; bestRot = candidate;
          }
        }
        rot = bestRot;
      } else {
        // Mouse near cell center — fall back to auto-connect
        rot = gridState.findBestRotation(activePlacementKey, gx, gz);
      }
    }

    if (rot !== ghostRotation || cellChanged) {
      ghostRotation = rot;
      ghostObj.rotation.y = -(rot * Math.PI / 180);

      // Connection indicators
      const conns = gridState.getConnections(gx, gz, activePlacementKey, rot);
      gridState.showIndicators(gx, gz, conns);
      if (typeof window !== 'undefined' && window.__builderDebug) {
        window.__builderDebug.placement = {
          cell: { x: gx, z: gz },
          pieceKey: activePlacementKey,
          rotation: rot,
          occupied,
          snapped: conns.some((conn) => conn.status === 'connected'),
          connected: conns.filter((conn) => conn.status === 'connected').length,
          connections: conns.map((conn) => ({ dir: conn.dir, status: conn.status })),
        };
      }
    }
  } else if (cellChanged) {
    gridState.hideIndicators();
    if (typeof window !== 'undefined' && window.__builderDebug) {
      window.__builderDebug.placement = activeExtraTool
        ? {
            cell: { x: gx, z: gz },
            pieceKey: activeExtraTool,
            rotation: 0,
            occupied,
            snapped: false,
            connected: 0,
            connections: [],
          }
        : null;
    }
  }
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
  if (typeof window !== 'undefined' && window.__builderDebug) {
    window.__builderDebug.placement = null;
  }
}

// ── Selection change → update inspector + gizmo ───────────────
function onSelectionChange() {
  updateInspector();
  // Attach gizmo to first selected entity (or detach if nothing selected)
  reattachGizmo();
  updateSelectionHud();
  updateActionRing();
  hideContextMenu();
}

function reattachGizmo() {
  // Gizmo arrows removed — click-hold-drag replaces translate handles.
  // Always keep detached so no arrows show.
  gizmo.detach();
}

function onTransformEnd(entityId, oldPos, oldRot, oldScale) {
  const entity = sceneGraph.get(entityId);
  if (!entity) return;

  const normalized = normalizeEntityTransform(
    entity,
    {
      position: { ...entity.position },
      rotation: entity.rotation,
      scale: entity.scale,
    },
    {
      position: { ...oldPos },
      rotation: oldRot,
      scale: oldScale,
    },
  );

  if (!normalized.ok) {
    sceneGraph.updateTransform(entityId, oldPos, oldRot, oldScale);
    reattachGizmo();
    showToast('Cell occupied.', 'warn');
    return;
  }

  sceneGraph.updateTransform(entityId, normalized.position, normalized.rotation, normalized.scale);
  cmdStack.execute(TransformCmd(
    sceneGraph, entityId,
    oldPos, oldRot, oldScale,
    normalized.position, normalized.rotation, normalized.scale,
  ));

  // Update gridState so the cell registry tracks the new position
  if (entity.category === 'segment') {
    const def = PIECE_DEFS[entity.type];
    const footprint = def?.footprint || [[0, 0]];
    const layer = getGridLayer(entity.type);

    // Remove old footprint cells
    const ox = snapToGrid(oldPos.x);
    const oz = snapToGrid(oldPos.z);
    for (const [dx, dz] of footprint) {
      gridState.remove(ox + dx * GRID_SIZE, oz + dz * GRID_SIZE, layer);
    }

    // Register new footprint cells
    const nx = snapToGrid(normalized.position.x);
    const nz = snapToGrid(normalized.position.z);
    for (const [dx, dz] of footprint) {
      gridState.set(nx + dx * GRID_SIZE, nz + dz * GRID_SIZE, entity.type, normalized.rotation, 'entity', entityId);
    }
    setHint('Moved track piece to new grid cell.');
  }

  reattachGizmo();
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
        const oldScale = e.scale;
        if (prop === 'x') e.position.x = val;
        else if (prop === 'y') e.position.y = val;
        else if (prop === 'z') e.position.z = val;
        else if (prop === 'rot') e.rotation = val;

        const normalized = normalizeEntityTransform(
          e,
          { position: { ...e.position }, rotation: e.rotation, scale: e.scale },
          { position: oldPos, rotation: oldRot, scale: oldScale },
        );

        if (!normalized.ok) {
          e.position = oldPos;
          e.rotation = oldRot;
          e.scale = oldScale;
          sceneGraph.updateTransform(e.id, oldPos, oldRot, oldScale);
          updateInspector();
          showToast('Cell occupied.', 'warn');
          return;
        }

        sceneGraph.updateTransform(e.id, normalized.position, normalized.rotation, normalized.scale);
        cmdStack.execute(TransformCmd(
          sceneGraph, e.id,
          oldPos, oldRot, oldScale,
          normalized.position, normalized.rotation, normalized.scale,
        ));
        reattachGizmo();
      });
    });
  } else {
    content.innerHTML = `<p class="bv2-empty">${entities.length} objects selected.</p>`;
  }
}

// ── Delete selected ───────────────────────────────────────────
function canMoveSelectionBy(deltaX, deltaZ) {
  const selectedIds = new Set(selection.all().map((entity) => entity.id));
  return selection.all().every((entity) => {
    if (entity.category !== 'segment') return true;
    const targetX = snapToGrid(entity.position.x + deltaX);
    const targetZ = snapToGrid(entity.position.z + deltaZ);
    const layer = getGridLayer(entity.type);
    const occupant = gridState.get(targetX, targetZ, layer);
    return !occupant || (occupant.source === 'entity' && selectedIds.has(occupant.entityId));
  });
}

function nudgeSelection(dx, dz) {
  const entities = selection.all();
  if (!entities.length) return;

  const deltaX = dx * GRID_SIZE;
  const deltaZ = dz * GRID_SIZE;
  if (!canMoveSelectionBy(deltaX, deltaZ)) {
    showToast('Cannot nudge — cell occupied.', 'warn');
    return;
  }

  entities.forEach((entity) => {
    const oldPos = { ...entity.position };
    const oldRot = entity.rotation;
    const oldScale = entity.scale;
    const normalized = normalizeEntityTransform(
      entity,
      {
        position: {
          x: entity.position.x + deltaX,
          y: entity.position.y,
          z: entity.position.z + deltaZ,
        },
        rotation: entity.rotation,
        scale: entity.scale,
      },
      {
        position: oldPos,
        rotation: oldRot,
        scale: oldScale,
      },
    );
    if (!normalized.ok) return;
    cmdStack.execute(TransformCmd(
      sceneGraph,
      entity.id,
      oldPos,
      oldRot,
      oldScale,
      normalized.position,
      normalized.rotation,
      normalized.scale,
    ));
  });

  reattachGizmo();
  setHint('Nudged selection one grid cell.');
}

function createMarkerClone(entity, position) {
  if (entity.type === 'spawn') {
    return createSpawnMarker(entity.id, position.x, position.y, position.z, entity.heading || 0);
  }
  if (entity.type === 'checkpoint') {
    return createCheckpointMarker(position.x, position.y, position.z);
  }
  return createItemBoxMarker(entity.type, position.x, position.y, position.z);
}

async function duplicateEntity(entity, offset) {
  const targetPosition = {
    x: entity.position.x + offset.x,
    y: entity.position.y,
    z: entity.position.z + offset.z,
  };
  const normalized = normalizeEntityTransform(
    entity,
    {
      position: targetPosition,
      rotation: entity.rotation,
      scale: entity.scale,
    },
    {
      position: { ...entity.position },
      rotation: entity.rotation,
      scale: entity.scale,
    },
  );

  if (!normalized.ok) return null;

  let object3D;
  if (entity.category === 'segment') {
    object3D = await loadModel(entity.type);
    object3D.position.set(normalized.position.x, normalized.position.y, normalized.position.z);
    object3D.rotation.y = -(normalized.rotation * Math.PI / 180);
    object3D.scale.setScalar(normalized.scale);
  } else {
    object3D = createMarkerClone(entity, normalized.position);
  }

  const clone = {
    id: 0,
    type: entity.type,
    category: entity.category,
    modelKey: entity.modelKey,
    object3D,
    position: normalized.position,
    rotation: normalized.rotation,
    scale: normalized.scale,
    heading: entity.heading || 0,
  };

  cmdStack.execute(PlaceObjectCmd(sceneGraph, clone));
  return clone;
}

async function onDuplicate() {
  const entities = selection.all();
  if (!entities.length) {
    showToast('Select something to duplicate.', 'info');
    return;
  }

  const bounds = getSelectionBounds();
  const spanX = Math.max(GRID_SIZE, snapToGrid((bounds?.max?.x || 0) - (bounds?.min?.x || 0)) + GRID_SIZE);
  const spanZ = Math.max(GRID_SIZE, snapToGrid((bounds?.max?.z || 0) - (bounds?.min?.z || 0)) + GRID_SIZE);
  const offsets = [
    { x: spanX, z: 0 },
    { x: 0, z: spanZ },
    { x: -spanX, z: 0 },
    { x: 0, z: -spanZ },
  ];

  let chosenOffset = null;
  for (const offset of offsets) {
    const canUseOffset = entities.every((entity) => {
      if (entity.category !== 'segment') return true;
      const gx = snapToGrid(entity.position.x + offset.x);
      const gz = snapToGrid(entity.position.z + offset.z);
      return !gridState.isOccupied(gx, gz, getGridLayer(entity.type));
    });
    if (canUseOffset) {
      chosenOffset = offset;
      break;
    }
  }

  if (!chosenOffset) {
    showToast('No room to duplicate here.', 'warn');
    return;
  }

  const created = [];
  for (const entity of entities) {
    const clone = await duplicateEntity(entity, chosenOffset);
    if (clone) created.push(clone);
  }

  if (!created.length) {
    showToast('Duplicate failed.', 'warn');
    return;
  }

  selection.clear(true);
  created.forEach((entity) => selection.toggle(entity.id));
  reattachGizmo();
  setHint(`Duplicated ${created.length} item${created.length === 1 ? '' : 's'}.`);
}

function onCopy() {
  const entities = selection.all();
  if (!entities.length) {
    showToast('Select something to copy.', 'info');
    return;
  }
  // Compute centroid as anchor
  let cx = 0, cz = 0;
  entities.forEach(e => { cx += e.position.x; cz += e.position.z; });
  cx /= entities.length;
  cz /= entities.length;
  cx = snapToGrid(cx);
  cz = snapToGrid(cz);

  clipboard = entities.map(e => ({
    type: e.type,
    category: e.category,
    modelKey: e.modelKey,
    rotation: e.rotation,
    scale: e.scale,
    heading: e.heading || 0,
    offset: { x: e.position.x - cx, z: e.position.z - cz },
  }));
  showToast(`Copied ${clipboard.length} item${clipboard.length === 1 ? '' : 's'}.`, 'info');
}

async function onPaste() {
  if (!clipboard || !clipboard.length) {
    showToast('Nothing on clipboard. Copy first (Ctrl+C).', 'info');
    return;
  }

  // Place near center of current view
  const cam = camCtrl.camera;
  const center = new THREE.Vector3(0, 0, -1).applyMatrix4(cam.matrixWorld);
  const dir = new THREE.Vector3().subVectors(center, cam.position).normalize();
  const planeY = 0;
  const t = (planeY - cam.position.y) / dir.y;
  const pasteCenter = cam.position.clone().add(dir.multiplyScalar(Math.abs(t)));
  const pcx = snapToGrid(pasteCenter.x);
  const pcz = snapToGrid(pasteCenter.z);

  const created = [];
  for (const item of clipboard) {
    const pos = { x: pcx + item.offset.x, y: 0, z: pcz + item.offset.z };

    let object3D;
    if (item.category === 'segment' || item.category === 'prop') {
      const modelResult = await loadModel(item.modelKey || item.type);
      if (!modelResult) continue;
      object3D = modelResult.scene ? modelResult.scene.clone() : modelResult.clone();
      object3D.position.set(pos.x, pos.y, pos.z);
      object3D.rotation.y = -(item.rotation * Math.PI / 180);
      object3D.scale.setScalar(item.scale);
    } else {
      object3D = createMarkerClone(item, pos);
    }

    const clone = {
      id: 0,
      type: item.type,
      category: item.category,
      modelKey: item.modelKey,
      object3D,
      position: pos,
      rotation: item.rotation,
      scale: item.scale,
      heading: item.heading,
    };

    cmdStack.execute(PlaceObjectCmd(sceneGraph, clone));

    if (item.category === 'segment') {
      const def = PIECE_DEFS[item.type];
      const footprint = def?.footprint || [[0, 0]];
      const gx = snapToGrid(pos.x);
      const gz = snapToGrid(pos.z);
      for (const [fdx, fdz] of footprint) {
        gridState.set(gx + fdx * GRID_SIZE, gz + fdz * GRID_SIZE, item.type, item.rotation, 'entity', clone.id);
      }
    }
    created.push(clone);
  }

  if (created.length) {
    selection.clear(true);
    created.forEach(e => selection.toggle(e.id));
    setHint(`Pasted ${created.length} item${created.length === 1 ? '' : 's'}.`);
    triggerAutoSave();
  } else {
    showToast('Paste failed — could not load models.', 'warn');
  }
}

function onDelete() {
  const entities = selection.all();
  if (entities.length === 0) return;
  selection.clear(true);
  for (const entity of entities) {
    cmdStack.execute(DeleteObjectCmd(sceneGraph, entity.id, entity));
    // Remove all footprint cells for this piece
    const def = PIECE_DEFS[entity.type];
    const footprint = def?.footprint || [[0, 0]];
    const delLayer = getGridLayer(entity.type);
    const gx = snapToGrid(entity.position.x);
    const gz = snapToGrid(entity.position.z);
    for (const [dx, dz] of footprint) {
      gridState.remove(gx + dx * GRID_SIZE, gz + dz * GRID_SIZE, delLayer);
    }
  }
  gizmo.detach();
  updateInspector();
  updateActionRing();
  hideContextMenu();
}

function onEscape() {
  if (helpPanel && !helpPanel.hasAttribute('hidden')) {
    closeHelpPanel();
    return;
  }

  if (landingOverlay && !landingOverlay.hasAttribute('hidden')) {
    closeLanding();
    return;
  }

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
  const name = nameInput?.value?.trim() || 'Untitled Track';
  serializer.saveToSlot(name, 'TinkerTracks', { preset: currentPreset });
  currentAutoSave = { name, savedAt: Date.now() };
  renderRecentProjects();
  showToast(`Saved "${name}"`, 'success');
}

function onLoad() {
  openLanding();
}

function onShare() {
  const name = nameInput?.value?.trim() || 'Untitled Track';
  const code = serializer.exportShareCode(name, 'TinkerTracks', { preset: currentPreset });
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
  const name = nameInput?.value?.trim() || 'Untitled Track';
  const result = playtestBridge.launch(name, 'TinkerTracks', { preset: currentPreset });
  if (!result.ok) {
    showToast(result.reason, 'warn');
  }
}

async function onPublish() {
  const name = nameInput?.value?.trim();
  if (!name) {
    showToast('Give your track a name before publishing.', 'warn');
    return;
  }
  const trackData = serializer.buildTrackData(name, 'TinkerTracks', { preset: currentPreset });
  if (!trackData?.segments?.length && !trackData?.roadCells?.length) {
    showToast('Nothing to publish — place some objects first.', 'warn');
    return;
  }
  try {
    const result = await publishTrack({
      name,
      author: 'Anonymous',
      description: '',
      trackData: trackData,
      tags: currentPreset,
    });
    if (result?.id) {
      showToast(`Published "${name}" to the community!`, 'success');
    } else {
      showToast('Publish failed — try again later.', 'warn');
    }
  } catch (err) {
    console.error('[Publish]', err);
    showToast('Publish failed — server unreachable.', 'warn');
  }
}

async function onBrowse() {
  try {
    const result = await browseTracks({ sort: 'newest', limit: 20 });
    const tracks = result?.results || [];
    if (!tracks.length) {
      showToast('No community tracks found yet.', 'info');
      return;
    }
    // Build and show a lightweight modal
    let existing = document.getElementById('bv2-browse-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'bv2-browse-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;';
    const card = document.createElement('div');
    card.style.cssText = 'background:#1a1d24;border-radius:12px;padding:24px;max-width:560px;width:90%;max-height:70vh;overflow-y:auto;color:#e8eaed;font-family:system-ui,sans-serif;';
    card.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <h2 style="margin:0;font-size:1.2rem;">Community Tracks</h2>
      <button id="bv2-browse-close" style="background:none;border:none;color:#e8eaed;font-size:1.4rem;cursor:pointer;">&times;</button>
    </div>`;
    const list = document.createElement('div');
    for (const t of tracks) {
      const row = document.createElement('div');
      row.style.cssText = 'padding:10px 12px;border-radius:8px;cursor:pointer;margin-bottom:6px;background:#252830;';
      row.innerHTML = `<strong>${escapeHtml(t.name)}</strong> <span style="opacity:.6;font-size:.85rem;">by ${escapeHtml(t.author || 'Anon')}</span>
        <div style="font-size:.8rem;opacity:.5;">${t.play_count || 0} plays</div>`;
      row.addEventListener('click', () => {
        modal.remove();
        if (t.track_data) {
          loadTrackData(typeof t.track_data === 'string' ? JSON.parse(t.track_data) : t.track_data);
          showToast(`Loaded "${t.name}"`, 'success');
        }
      });
      list.appendChild(row);
    }
    card.appendChild(list);
    modal.appendChild(card);
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
    card.querySelector('#bv2-browse-close')?.addEventListener('click', () => modal.remove());
  } catch (err) {
    console.error('[Browse]', err);
    showToast('Could not load community tracks.', 'warn');
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Load track data into scene ────────────────────────────────
const DEFAULT_VIEW_BOUNDS = Object.freeze({
  min: { x: -50, y: 0, z: -50 },
  max: { x: 50, y: 10, z: 50 },
});

function toFiniteNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function sanitizePosition(position, fallbackY = 0) {
  const x = Number(position?.x);
  const z = Number(position?.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return { x, y: toFiniteNumber(position?.y, fallbackY), z };
}

function resolveLoadedEntityId(rawId, usedIds) {
  const preferredId = Number(rawId);
  if (Number.isInteger(preferredId) && preferredId > 0 && !usedIds.has(preferredId)) {
    usedIds.add(preferredId);
    return preferredId;
  }

  let nextId = 1;
  while (usedIds.has(nextId)) nextId++;
  usedIds.add(nextId);
  return nextId;
}

function computeViewBounds({ roadCells = [], segments = [], obstacles = [], startPositions = [] } = {}) {
  const positions = [
    ...roadCells.map((cell) => sanitizePosition(cell?.position)),
    ...segments.map((segment) => sanitizePosition(segment?.position)),
    ...obstacles.map((obstacle) => sanitizePosition(obstacle?.position)),
    ...startPositions.map((start) => sanitizePosition(start?.position)),
  ].filter(Boolean);

  if (!positions.length) return DEFAULT_VIEW_BOUNDS;

  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const pos of positions) {
    minX = Math.min(minX, pos.x);
    minZ = Math.min(minZ, pos.z);
    maxX = Math.max(maxX, pos.x);
    maxZ = Math.max(maxZ, pos.z);
  }

  const pad = 20;
  return {
    min: { x: minX - pad, y: 0, z: minZ - pad },
    max: { x: maxX + pad, y: 10, z: maxZ + pad },
  };
}

function centerBuildSurface(bounds = DEFAULT_VIEW_BOUNDS) {
  const minX = toFiniteNumber(bounds?.min?.x, DEFAULT_VIEW_BOUNDS.min.x);
  const maxX = toFiniteNumber(bounds?.max?.x, DEFAULT_VIEW_BOUNDS.max.x);
  const minZ = toFiniteNumber(bounds?.min?.z, DEFAULT_VIEW_BOUNDS.min.z);
  const maxZ = toFiniteNumber(bounds?.max?.z, DEFAULT_VIEW_BOUNDS.max.z);
  terrainPanel.setCenter((minX + maxX) / 2, (minZ + maxZ) / 2);
}

async function loadTrackData(data) {
  // Clear current
  resetBuilderWorkspace();

  if (!data || typeof data !== 'object') {
    return { ok: false, itemCount: 0, invalidCount: 1 };
  }

  if (nameInput) nameInput.value = data.name || 'Untitled Track';

  let itemCount = 0;
  let invalidCount = 0;
  const safeRoadCells = [];
  const safeSegments = [];
  const safeObstacles = [];
  const safeStartPositions = [];
  const usedEntityIds = new Set();

  // Road cells
  if (data.roadCells?.length) {
    for (const roadCell of data.roadCells) {
      const position = sanitizePosition(roadCell?.position, 0);
      if (!position) {
        invalidCount++;
        continue;
      }
      safeRoadCells.push({
        id: Number(roadCell?.id || safeRoadCells.length + 1),
        position,
      });
    }

    if (safeRoadCells.length) {
      await roadPainter.deserialize(safeRoadCells);
      syncRoadToGrid();
      itemCount += safeRoadCells.length;
    }
  }

  // Segments
  for (const seg of (data.segments || [])) {
    const position = sanitizePosition(seg?.position, 0);
    if (!position || typeof seg?.type !== 'string' || !seg.type) {
      invalidCount++;
      continue;
    }

    const rotation = toFiniteNumber(seg.rotation, 0);
    const scale = Math.max(0.0001, toFiniteNumber(seg.scale, 1));

    try {
      const model = await loadModel(seg.type);
      model.position.set(position.x, position.y, position.z);
      model.rotation.y = -(rotation * Math.PI / 180);
      if (scale !== 1) model.scale.setScalar(scale);

      const entity = sceneGraph.add({
        id: resolveLoadedEntityId(seg.id, usedEntityIds),
        type: seg.type,
        category: 'segment',
        modelKey: seg.type,
        object3D: model,
        position: { ...position },
        rotation,
        scale,
      });

      // Register in grid
      const gx = snapToGrid(position.x);
      const gz = snapToGrid(position.z);
      gridState.set(gx, gz, seg.type, rotation, 'entity', entity.id);
      safeSegments.push({
        id: entity.id,
        type: seg.type,
        position: { ...position },
        rotation,
        scale,
      });
      itemCount++;
    } catch (error) {
      invalidCount++;
      console.warn(`[builder] Skipping segment type "${seg.type}":`, error);
    }
  }

  // Obstacles
  for (const obs of (data.obstacles || [])) {
    const position = sanitizePosition(obs?.position, 0);
    if (!position || typeof obs?.type !== 'string' || !obs.type) {
      invalidCount++;
      continue;
    }

    const obj3D = createItemBoxMarker(obs.type, position.x, position.y, position.z);
    const obstacleId = resolveLoadedEntityId(obs.id, usedEntityIds);
    sceneGraph.add({
      id: obstacleId,
      type: obs.type,
      category: 'obstacle',
      modelKey: obs.type,
      object3D: obj3D,
      position: { ...position },
      rotation: 0,
      scale: 1,
    });
    safeObstacles.push({
      id: obstacleId,
      type: obs.type,
      position,
    });
    itemCount++;
  }

  // Start positions
  for (const sp of (data.startPositions || [])) {
    const position = sanitizePosition(sp?.position, 0);
    if (!position) {
      invalidCount++;
      continue;
    }

    const heading = toFiniteNumber(sp.heading, 0);
    const spawnId = resolveLoadedEntityId(sp.id, usedEntityIds);
    const obj3D = createSpawnMarker(spawnId, position.x, position.y, position.z, heading);
    sceneGraph.add({
      id: spawnId,
      type: 'spawn',
      category: 'spawn',
      modelKey: 'spawn',
      object3D: obj3D,
      position: { ...position },
      rotation: 0,
      scale: 1,
      heading,
    });
    safeStartPositions.push({
      id: spawnId,
      position,
      heading,
    });
    itemCount++;
  }

  const maxEntityId = usedEntityIds.size ? Math.max(...usedEntityIds) : 0;
  sceneGraph.setIdCounter(maxEntityId + 1);

  // Ensure complete grid registration (including multi-cell footprints)
  syncEntityGridFromScene();

  // Fit camera to content
  const bounds = computeViewBounds({
    roadCells: safeRoadCells,
    segments: safeSegments,
    obstacles: safeObstacles,
    startPositions: safeStartPositions,
  });
  centerBuildSurface(bounds);
  camCtrl.fitToExtent(bounds.min, bounds.max);
  const loadSummary = { ok: true, itemCount, invalidCount };

  setHint(`Loaded "${data.name}" — ${sceneGraph.entities.size} objects`);
  updateSelectionHud();
  return loadSummary;
}

// ── Auto-save ─────────────────────────────────────────────────
function triggerAutoSave() {
  const name = nameInput?.value?.trim() || 'Untitled Track';
  currentAutoSave = { name, savedAt: Date.now() };
  serializer.autoSave(name, 'TinkerTracks', { preset: currentPreset });
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
  if (forceFreshWorkspace) {
    serializer.clearAutoSave();
    currentAutoSave = null;
  }

  const autoSave = forceFreshWorkspace ? null : serializer.loadAutoSave();
  if (autoSave) {
    const autoSavePreset = autoSave.builderPreset || (autoSave.roadCells?.length ? 'track' : 'arena');
    if (forcedPreset && autoSavePreset !== forcedPreset) {
      resetBuilderWorkspace({ clearName: true });
      applyWorkspacePreset(forcedPreset);
      renderRecentProjects();
      updateGizmoButtons();
      openLanding();
      console.log('[builder-v2] Initialized');
      return;
    }

    const result = await loadTrackData(autoSave);
    if (!result.ok || (result.itemCount === 0 && result.invalidCount > 0)) {
      serializer.clearAutoSave();
      currentAutoSave = null;
      resetBuilderWorkspace({ clearName: true });
      applyWorkspacePreset(forcedPreset || 'arena');
      showToast('Auto-save was corrupted. Starting fresh.', 'warn');
    } else {
      currentAutoSave = { name: autoSave.name || 'Untitled Track', savedAt: Date.now() };
      currentPreset = forcedPreset || autoSave.builderPreset || (autoSave.roadCells?.length ? 'track' : 'arena');
      applyWorkspacePreset(currentPreset);
      if (result.invalidCount > 0) {
        showToast('Loaded auto-save (some items skipped).', 'warn');
      }
      setHint('Restored auto-saved session. Start building!');
    }
  } else {
    resetBuilderWorkspace({ clearName: true });
    applyWorkspacePreset(forcedPreset || 'arena');
  }
  renderRecentProjects();
  updateGizmoButtons();
  if (!forcedPreset) {
    openLanding();
  }
  console.log('[builder-v2] Initialized');
})();
