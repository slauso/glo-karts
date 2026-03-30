import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import {
  TrackEditor,
  SEGMENT_TYPES,
  OBSTACLE_TYPES,
  exportTrackCode,
  importTrackCode,
  getSavedCustomTracks,
  saveCustomTrack,
  removeCustomTrack,
} from './modules/track-editor.js';
import { CUSTOM_TRACK_ID } from './modules/content-registry.js';

const BUILDER_DRAFT_KEY = 'gloBuilderDraft';
const BUILDER_LAUNCH_INTENT_KEY = 'gloBuilderLaunchIntent';
const BUILDER_PLAYTEST_META_KEY = 'gloBuilderPlaytestMeta';
const GRID_SIZE = 10;

function ensureBuilderPlaytestPlayerId() {
  const existing = sessionStorage.getItem('myPlayerId') || localStorage.getItem('myPlayerId');
  if (existing) return existing;

  const next = `builder-${Math.random().toString(36).slice(2, 10)}`;
  sessionStorage.setItem('myPlayerId', next);
  localStorage.setItem('myPlayerId', next);
  return next;
}

const TOOL_MODES = {
  select: 'select',
  drawRoad: 'drawRoad',
  placeObject: 'placeObject',
  erase: 'erase',
};

const SEGMENT_ASSET_PATHS = {
  straight: '/models/track/track-road-wide-straight.glb',
  flat_wide: '/models/track/track-road-wide.glb',
  curve_left: '/models/track/track-road-wide-corner-large.glb',
  curve_right: '/models/track/track-road-wide-corner-large.glb',
  ramp_up: '/models/track/track-road-wide-straight-hill-beginning.glb',
  ramp_down: '/models/track/track-road-wide-straight-hill-end.glb',
};

const TOOL_HINTS = {
  [TOOL_MODES.select]: 'Select pieces directly in 3D, then drag them across the arena floor or edit them in the inspector.',
  [TOOL_MODES.drawRoad]: 'Click-drag in the 3D scene to sketch traversal lanes. Straights and corners are inferred automatically.',
  [TOOL_MODES.placeObject]: 'Choose a tile or object, then click in the 3D scene to place it on the arena floor.',
  [TOOL_MODES.erase]: 'Click a road, tile, prop, or spawn point in 3D to remove it.',
};

const LIBRARY_ITEMS = [
  {
    id: 'road_brush',
    category: 'Road Kit',
    kind: 'road_brush',
    toolMode: TOOL_MODES.drawRoad,
    label: 'Wide Road Painter',
    icon: '🛣',
    description: 'Sketch connected lanes in 3D. The editor converts your stroke into straights and corners.',
    assetPath: SEGMENT_ASSET_PATHS.straight,
  },
  {
    id: 'flat_wide',
    category: 'Road Kit',
    kind: 'segment',
    toolMode: TOOL_MODES.placeObject,
    label: 'Arena Pad',
    icon: SEGMENT_TYPES.flat_wide.icon,
    description: 'Drop a broad platform for combat islands, hubs, and choke points.',
    assetPath: SEGMENT_ASSET_PATHS.flat_wide,
  },
  {
    id: 'ramp_up',
    category: 'Road Kit',
    kind: 'segment',
    toolMode: TOOL_MODES.placeObject,
    label: 'Ramp Up',
    icon: SEGMENT_TYPES.ramp_up.icon,
    description: 'Lift the route upward for layered arena flow.',
    assetPath: SEGMENT_ASSET_PATHS.ramp_up,
  },
  {
    id: 'ramp_down',
    category: 'Road Kit',
    kind: 'segment',
    toolMode: TOOL_MODES.placeObject,
    label: 'Ramp Down',
    icon: SEGMENT_TYPES.ramp_down.icon,
    description: 'Return elevated lanes back to ground level.',
    assetPath: SEGMENT_ASSET_PATHS.ramp_down,
  },
  {
    id: 'barrier',
    category: 'Arena Objects',
    kind: 'obstacle',
    toolMode: TOOL_MODES.placeObject,
    label: OBSTACLE_TYPES.barrier.label,
    icon: OBSTACLE_TYPES.barrier.icon,
    description: 'Solid cover for lane blockers and combat choke points.',
  },
  {
    id: 'boost_pad',
    category: 'Arena Objects',
    kind: 'obstacle',
    toolMode: TOOL_MODES.placeObject,
    label: OBSTACLE_TYPES.boost_pad.label,
    icon: OBSTACLE_TYPES.boost_pad.icon,
    description: 'Speed-up strip for traversal lines and aggressive entries.',
  },
  {
    id: 'item_box',
    category: 'Arena Objects',
    kind: 'obstacle',
    toolMode: TOOL_MODES.placeObject,
    label: OBSTACLE_TYPES.item_box.label,
    icon: OBSTACLE_TYPES.item_box.icon,
    description: 'Battle pickup anchor for hot intersections.',
  },
  {
    id: 'banana',
    category: 'Arena Objects',
    kind: 'obstacle',
    toolMode: TOOL_MODES.placeObject,
    label: OBSTACLE_TYPES.banana.label,
    icon: OBSTACLE_TYPES.banana.icon,
    description: 'Place a slippery trap on lane exits or ambush routes.',
  },
  {
    id: 'start',
    category: 'Spawns',
    kind: 'start',
    toolMode: TOOL_MODES.placeObject,
    label: 'Spawn Point',
    icon: '🏁',
    description: 'Choose where players enter the arena and which way they face.',
  },
];

const LIBRARY_BY_ID = new Map(LIBRARY_ITEMS.map((item) => [item.id, item]));

class ArenaBuilderApp {
  constructor() {
    this.editor = new TrackEditor();
    this.elements = this._collectElements();

    this.toolMode = TOOL_MODES.drawRoad;
    this.activeLibraryId = 'road_brush';
    this.selectedEntity = null;
    this.hoverCell = null;
    this.rotation = 0;
    this.isSyncingInspector = false;

    this.pointer = {
      mode: 'idle',
      lastCellKey: '',
      roadStroke: [],
      orbiting: false,
      orbitX: 0,
      orbitY: 0,
      panning: false,
      panX: 0,
      panY: 0,
      rotateCenter: null,
      rotatePlaneY: 0,
      rotateChanged: false,
      lastClickTime: 0,
      lastClickPos: { x: 0, y: 0 },
    };

    this.cameraPresets = {
      iso: { yaw: 0.78, pitch: 0.615 },       // Isometric
      front: { yaw: 0, pitch: 0.4 },          // Front view
      back: { yaw: Math.PI, pitch: 0.4 },     // Back view
      left: { yaw: Math.PI / 2, pitch: 0.4 }, // Left side view
      right: { yaw: -Math.PI / 2, pitch: 0.4 }, // Right side view
      top: { yaw: 0, pitch: Math.PI / 2 - 0.1 }, // Top-down (nearly overhead)
    };

    this.viewport = null;
    this.resizeObserver = null;

    this._renderPalette();
    this._initViewport();
    this._primeAssets();
    this._bindEvents();
    this._loadInitialArena();
    this._refreshSavedList();
    this._refreshValidation();
    this._setToolMode(this.toolMode, { syncLibrary: false });
    this._syncInspector();
    this._resizeViewport();
    this._frameArena(true);
    this._createHelpOverlay();
    this._toast('The 3D viewport is now the builder. Drag roads and place objects directly in the scene.', 'ok');
  }

  _collectElements() {
    return {
      viewport: document.getElementById('ab-viewport'),
      palette: document.getElementById('ab-palette'),
      toastWrap: document.getElementById('ab-toast-wrap'),
      hint: document.getElementById('ab-hint'),
      stats: document.getElementById('ab-stats'),
      validationList: document.getElementById('ab-validation-list'),
      nameInput: document.getElementById('ab-name'),
      backBtn: document.getElementById('ab-back'),
      cameraHomeBtn: document.getElementById('ab-nav-home'),
      toolSelectBtn: document.getElementById('ab-tool-select'),
      toolRoadBtn: document.getElementById('ab-tool-road'),
      toolObjectBtn: document.getElementById('ab-tool-object'),
      toolEraseBtn: document.getElementById('ab-tool-erase'),
      undoBtn: document.getElementById('ab-undo'),
      redoBtn: document.getElementById('ab-redo'),
      rotateBtn: document.getElementById('ab-rotate'),
      deleteBtn: document.getElementById('ab-delete'),
      clearBtn: document.getElementById('ab-clear'),
      saveBtn: document.getElementById('ab-save'),
      loadBtn: document.getElementById('ab-load'),
      shareBtn: document.getElementById('ab-share'),
      playBtn: document.getElementById('ab-play'),
      hostBtn: document.getElementById('ab-host'),
      selectionBadge: document.getElementById('ab-selection-badge'),
      selectionEmpty: document.getElementById('ab-selection-empty'),
      selectionFields: document.getElementById('ab-selection-fields'),
      inspectorType: document.getElementById('ab-inspector-type'),
      inspectorX: document.getElementById('ab-inspector-x'),
      inspectorY: document.getElementById('ab-inspector-y'),
      inspectorZ: document.getElementById('ab-inspector-z'),
      inspectorRotation: document.getElementById('ab-inspector-rotation'),
      rotCcwBtn: document.getElementById('ab-rot-ccw'),
      rotCwBtn: document.getElementById('ab-rot-cw'),
      loadDialog: document.getElementById('ab-load-dialog'),
      shareDialog: document.getElementById('ab-share-dialog'),
      savedList: document.getElementById('ab-saved-list'),
      shareCode: document.getElementById('ab-share-code'),
      importCode: document.getElementById('ab-import-code'),
      exportBtn: document.getElementById('ab-export-btn'),
      copyBtn: document.getElementById('ab-copy-btn'),
      importBtn: document.getElementById('ab-import-btn'),
    };
  }

  _initViewport() {
    const renderer = new THREE.WebGLRenderer({
      canvas: this.elements.viewport,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x08101b);

    const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 500);

    const ambient = new THREE.HemisphereLight(0xd6f2ff, 0x152030, 1.15);
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(14, 18, 10);
    const rim = new THREE.DirectionalLight(0x66b5ff, 0.5);
    rim.position.set(-10, 12, -6);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(240, 240),
      new THREE.MeshStandardMaterial({
        color: 0x0d1522,
        metalness: 0.05,
        roughness: 0.94,
      })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;

    const grid = new THREE.GridHelper(240, 120, 0x355d82, 0x1a2e44);
    grid.position.y = 0.001;

    const root = new THREE.Group();
    const ghostRoot = new THREE.Group();
    ghostRoot.visible = false;

    scene.add(ground, grid, ambient, key, rim, root, ghostRoot);

    this.viewport = {
      renderer,
      scene,
      camera,
      root,
      ghostRoot,
      loader: new GLTFLoader(),
      assetCache: new Map(),
      entityNodes: new Map(),
      pickables: [],
      selectionHelper: null,
      rotHandles: [],
      hoverRing: this._createHoverRing(),
      groundPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
      raycaster: new THREE.Raycaster(),
      yaw: 0.84,
      pitch: 0.72,
      distance: 18,
      target: new THREE.Vector3(0, 0.4, 0),
      needsRebuild: true,
      ghostSignature: '',
    };

    scene.add(this.viewport.hoverRing);

    const tick = () => {
      if (!this.viewport) return;
      if (this.viewport.needsRebuild) {
        this._rebuildViewportScene();
        this.viewport.needsRebuild = false;
      }
      this._syncHoverRing();
      this._syncGhostPreview();
      this._updateCamera();
      if (this.viewport.selectionHelper) this.viewport.selectionHelper.update();
      renderer.render(scene, camera);
      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  }

  _createHoverRing() {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.36, 0.5, 28),
      new THREE.MeshBasicMaterial({
        color: 0x7ecbff,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    ring.visible = false;
    return ring;
  }

  _createHelpOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'ab-nav-help';
    overlay.style.cssText = `
      position: absolute;
      top: 10px;
      right: 10px;
      font-size: 11px;
      color: #7ecbff;
      pointer-events: none;
      text-align: right;
      font-family: monospace;
      opacity: 0.6;
      line-height: 1.4;
      max-width: 200px;
      display: none;
    `;
    overlay.innerHTML = `
      <strong>Navigation</strong><br/>
      Right-drag: Orbit • Middle-drag: Pan<br/>
      Mouse wheel: Zoom • Arrow keys: Pan<br/>
      <br/>
      <strong>Views</strong> (Numpad)<br/>
      1: Front | 3: Right | 7: Top | i: Iso | 0: Fit<br/>
      <br/>
      <strong>Tools</strong><br/>
      1-4: Select, Road, Object, Erase<br/>
      R: Rotate | Double-click: Frame
    `;
    this.elements.viewport.parentElement.style.position = 'relative';
    this.elements.viewport.parentElement.appendChild(overlay);
    this.helpOverlay = overlay;
    // Show help for 5 seconds on startup
    overlay.style.display = 'block';
    setTimeout(() => {
      overlay.style.display = 'none';
    }, 5000);
  }

  _primeAssets() {
    const assetPaths = new Set(LIBRARY_ITEMS.map((item) => item.assetPath).filter(Boolean));
    Object.values(SEGMENT_ASSET_PATHS).forEach((path) => assetPaths.add(path));
    assetPaths.forEach((path) => {
      this._loadAsset(path).then(() => {
        this._markViewportDirty();
      });
    });
  }

  _loadAsset(path) {
    if (!path || !this.viewport) return Promise.resolve(null);
    const cached = this.viewport.assetCache.get(path);
    if (cached?.promise) return cached.promise;

    const promise = new Promise((resolve) => {
      this.viewport.loader.load(
        path,
        (gltf) => resolve(gltf.scene),
        undefined,
        () => resolve(null)
      );
    }).then((scene) => {
      this.viewport.assetCache.set(path, { promise: Promise.resolve(scene), scene });
      return scene;
    });

    this.viewport.assetCache.set(path, { promise, scene: null });
    return promise;
  }

  _bindEvents() {
    const viewport = this.elements.viewport;

    viewport.addEventListener('pointerdown', (event) => this._onViewportPointerDown(event));
    viewport.addEventListener('pointermove', (event) => this._onViewportPointerMove(event));
    viewport.addEventListener('contextmenu', (event) => event.preventDefault());
    viewport.addEventListener('wheel', (event) => this._onViewportWheel(event), { passive: false });

    window.addEventListener('pointermove', (event) => this._onGlobalPointerMove(event));
    window.addEventListener('pointerup', () => this._onGlobalPointerUp());
    window.addEventListener('keydown', (event) => this._onKeyDown(event));

    this.elements.nameInput.addEventListener('input', () => this._syncMetadata());
    this.elements.backBtn.addEventListener('click', () => { window.location.href = 'index.html'; });
    this.elements.cameraHomeBtn.addEventListener('click', () => {
      Object.assign(this.viewport, this.cameraPresets.iso);
      this._frameArena(true);
    });

    this.elements.toolSelectBtn.addEventListener('click', () => this._setToolMode(TOOL_MODES.select));
    this.elements.toolRoadBtn.addEventListener('click', () => this._setToolMode(TOOL_MODES.drawRoad));
    this.elements.toolObjectBtn.addEventListener('click', () => this._setToolMode(TOOL_MODES.placeObject));
    this.elements.toolEraseBtn.addEventListener('click', () => this._setToolMode(TOOL_MODES.erase));

    this.elements.undoBtn.addEventListener('click', () => this._runUndo());
    this.elements.redoBtn.addEventListener('click', () => this._runRedo());
    this.elements.rotateBtn.addEventListener('click', () => this._rotateSelectedTool());
    this.elements.deleteBtn.addEventListener('click', () => this._deleteSelection());
    this.elements.clearBtn.addEventListener('click', () => this._createFreshArena());
    this.elements.saveBtn.addEventListener('click', () => this._saveArena(false));
    this.elements.loadBtn.addEventListener('click', () => this.elements.loadDialog.showModal());
    this.elements.shareBtn.addEventListener('click', () => this.elements.shareDialog.showModal());
    this.elements.playBtn.addEventListener('click', () => this._launchArena({ autoStart: true, maxPlayers: 1, label: 'Launching direct playtest.' }));
    this.elements.hostBtn.addEventListener('click', () => this._launchArena({ autoStart: false, maxPlayers: 8, label: 'Online battle queued.' }));

    this.elements.exportBtn.addEventListener('click', () => this._exportArenaCode());
    this.elements.copyBtn.addEventListener('click', () => this._copyShareCode());
    this.elements.importBtn.addEventListener('click', () => this._importArena());

    // TinkerCAD-style inline rotation buttons in the Shape inspector
    if (this.elements.rotCcwBtn) {
      this.elements.rotCcwBtn.addEventListener('click', () => this._rotateSelectedBy(-1));
    }
    if (this.elements.rotCwBtn) {
      this.elements.rotCwBtn.addEventListener('click', () => this._rotateSelectedBy(1));
    }

    this.elements.inspectorType.addEventListener('change', () => this._applyInspectorType());
    this.elements.inspectorX.addEventListener('change', () => this._applyInspectorTransform());
    this.elements.inspectorY.addEventListener('change', () => this._applyInspectorTransform());
    this.elements.inspectorZ.addEventListener('change', () => this._applyInspectorTransform());
    this.elements.inspectorRotation.addEventListener('change', () => this._applyInspectorTransform());

    document.querySelectorAll('[data-close]').forEach((button) => {
      button.addEventListener('click', () => button.closest('dialog')?.close());
    });

    this.resizeObserver = new ResizeObserver(() => {
      this._resizeViewport();
    });
    this.resizeObserver.observe(this.elements.viewport.parentElement);
    this._bindNavWidget();
    this._bindViewCube();
  }

  _bindNavWidget() {
    const ORBIT_STEP = 0.048;   // radians per frame (~2.7°)
    const ZOOM_FACTOR = 0.955;  // per frame
    let rafId = null;
    let currentAction = null;

    const tick = () => {
      if (!currentAction || !this.viewport) return;
      currentAction();
      rafId = requestAnimationFrame(tick);
    };

    const startRepeat = (fn) => {
      currentAction = fn;
      fn(); // immediate first step
      rafId = requestAnimationFrame(tick);
    };

    const stopRepeat = () => {
      currentAction = null;
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    };

    const bindRepeat = (id, fn) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); startRepeat(fn); });
      btn.addEventListener('pointerup', stopRepeat);
      btn.addEventListener('pointerleave', stopRepeat);
      btn.addEventListener('pointercancel', stopRepeat);
    };

    bindRepeat('ab-nav-up',   () => {
      this.viewport.pitch = THREE.MathUtils.clamp(this.viewport.pitch + ORBIT_STEP, 0.24, 1.28);
    });
    bindRepeat('ab-nav-down', () => {
      this.viewport.pitch = THREE.MathUtils.clamp(this.viewport.pitch - ORBIT_STEP, 0.24, 1.28);
    });
    bindRepeat('ab-nav-left',  () => { this.viewport.yaw += ORBIT_STEP; });
    bindRepeat('ab-nav-right', () => { this.viewport.yaw -= ORBIT_STEP; });
    bindRepeat('ab-nav-zoom-in',  () => {
      this.viewport.distance = THREE.MathUtils.clamp(this.viewport.distance * ZOOM_FACTOR, 6, 60);
    });
    bindRepeat('ab-nav-zoom-out', () => {
      this.viewport.distance = THREE.MathUtils.clamp(this.viewport.distance / ZOOM_FACTOR, 6, 60);
    });
  }

  _bindViewCube() {
    document.querySelectorAll('.ab-vc-face[data-view]').forEach((face) => {
      face.addEventListener('click', () => {
        const view = face.dataset.view;
        if (!this.viewport) return;
        if (this.cameraPresets[view]) {
          Object.assign(this.viewport, this.cameraPresets[view]);
          this._toast(view.charAt(0).toUpperCase() + view.slice(1) + ' view', 'ok');
        } else if (view === 'iso') {
          Object.assign(this.viewport, this.cameraPresets.iso);
          this._frameArena(false);
          this._toast('Isometric view', 'ok');
        }
      });
    });
  }

  _rotateSelectedBy(dir) {
    const selected = this._resolveSelectedEntity();
    if (!selected) {
      this.rotation = this._normalizeRotation(this.rotation + (dir * 90));
      this._toast(`Rotation ${this.rotation}°`, 'ok');
      return;
    }

    if (selected.type === 'obstacle') {
      this._toast('This object type does not support rotation.', 'err');
      return;
    }

    if (selected.type === 'segment' && selected.inspectorType === 'auto_road') {
      this._toast('Auto roads orient automatically. Switch from Auto Road to rotate manually.', 'err');
      return;
    }

    const next = this._normalizeRotation(selected.rotation + (dir * 90));
    this._applySelectedRotation(next, { finalize: true });
  }

  _renderPalette() {
    const grouped = new Map();
    LIBRARY_ITEMS.forEach((item) => {
      if (!grouped.has(item.category)) grouped.set(item.category, []);
      grouped.get(item.category).push(item);
    });

    this.elements.palette.innerHTML = '';

    for (const [category, items] of grouped.entries()) {
      const title = document.createElement('div');
      title.className = 'ab-palette-title';
      title.textContent = category;
      this.elements.palette.appendChild(title);

      const grid = document.createElement('div');
      grid.className = 'ab-palette-grid';

      items.forEach((item) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'ab-piece';
        card.dataset.itemId = item.id;
        card.innerHTML = `
          <div class="ab-piece-thumb" style="background:${this._paletteThumbFill(item)}">${item.icon}</div>
          <div class="ab-piece-label">${item.label}</div>
          <div class="ab-piece-copy">${item.description}</div>
        `;
        card.addEventListener('click', () => this._selectLibraryItem(item.id, { syncToolMode: true }));
        grid.appendChild(card);
      });

      this.elements.palette.appendChild(grid);
    }

    this._syncPaletteState();
  }

  _paletteThumbFill(item) {
    if (item.kind === 'road_brush') {
      return 'linear-gradient(180deg, rgba(85, 161, 255, 0.98), rgba(43, 89, 156, 0.96))';
    }
    if (item.kind === 'segment') {
      if (item.id === 'flat_wide') return 'linear-gradient(180deg, rgba(74, 170, 130, 0.98), rgba(38, 104, 77, 0.96))';
      return 'linear-gradient(180deg, rgba(187, 123, 255, 0.98), rgba(99, 57, 156, 0.96))';
    }
    if (item.kind === 'start') {
      return 'linear-gradient(180deg, rgba(255, 209, 98, 0.98), rgba(255, 149, 56, 0.96))';
    }
    return 'linear-gradient(180deg, rgba(38, 50, 66, 0.98), rgba(18, 24, 33, 0.98))';
  }

  _loadInitialArena() {
    const draft = localStorage.getItem(BUILDER_DRAFT_KEY);
    const staged = sessionStorage.getItem('customTrackData');

    if (draft && this.editor.importTrack(draft)) {
      this._afterImportedArena();
      return;
    }
    if (staged && this.editor.importTrack(staged)) {
      this._afterImportedArena();
      return;
    }

    this._createStarterArena();
  }

  _afterImportedArena() {
    this._normalizeImportedSegments();
    this._applyMetadataToInputs();
    this._refreshValidation();
    this._syncInspector();
    this._markViewportDirty();
  }

  _normalizeImportedSegments() {
    this.editor.segments.forEach((segment) => {
      segment.rotation = this._normalizeRotation(segment.rotation || 0);
      if (!segment.builderRole) {
        segment.builderRole = (segment.type === 'straight' || segment.type === 'curve_left' || segment.type === 'curve_right')
          ? 'road'
          : 'manual';
      }
      if (segment.builderRole === 'road') {
        segment.position.y = 0;
      }
    });
    this._recomputeRoadNetwork();
  }

  _createFreshArena() {
    this.editor.clear();
    this.editor.trackName = 'Untitled Arena';
    this.editor.trackAuthor = 'Arena Architect';
    this.selectedEntity = null;
    this.rotation = 0;
    this._addRoadCell({ x: 0, z: 0 });
    this._recomputeRoadNetwork();
    this.editor.addStartPosition(0, 1, 20, 0);
    this._applyMetadataToInputs();
    this._afterMutation('New arena started.', { frame: true });
  }

  _createStarterArena() {
    this.editor.clear();
    this.editor.trackName = 'Starter Arena';
    this.editor.trackAuthor = 'Builder';

    [
      { x: -20, z: 0 },
      { x: -10, z: 0 },
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 20, z: 0 },
      { x: 20, z: 10 },
      { x: 20, z: 20 },
      { x: 10, z: 20 },
      { x: 0, z: 20 },
      { x: -10, z: 20 },
      { x: -20, z: 20 },
      { x: -20, z: 10 },
    ].forEach((cell) => this._addRoadCell(cell));

    this._recomputeRoadNetwork();
    const pad = this.editor.placeSegment('flat_wide', 0, 0, 10, 0);
    if (pad) pad.builderRole = 'manual';
    this.editor.placeObstacle('item_box', 0, 0.6, 10);
    this.editor.placeObstacle('boost_pad', 20, 0.6, 0);
    this.editor.placeObstacle('banana', -20, 0.6, 20);
    this.editor.addStartPosition(-10, 1, -10, 0);
    this.editor.addStartPosition(10, 1, -10, Math.PI);

    this._afterImportedArena();
    this._persistDraft();
  }

  _applyMetadataToInputs() {
    this.elements.nameInput.value = this.editor.trackName;
  }

  _syncMetadata() {
    this.editor.trackName = this.elements.nameInput.value.trim() || 'Untitled Arena';
    this.editor.trackAuthor = 'Arena Architect';
    this._persistDraft();
  }

  _persistDraft() {
    const json = this.editor.exportTrack();
    localStorage.setItem(BUILDER_DRAFT_KEY, json);
    sessionStorage.setItem('customTrackData', json);
    return json;
  }

  _saveArena(strict) {
    if (!this.editor.startPositions.length) {
      this.editor.addStartPosition(0, 1, 0, 0);
    }

    const validation = this.editor.validateTrack();
    if (strict && !validation.valid) {
      this._refreshValidation(validation);
      this._toast(validation.errors[0] || 'Arena is not valid yet.', 'err');
      return null;
    }

    const json = this.editor.exportTrack();
    saveCustomTrack(JSON.parse(json));
    localStorage.setItem(BUILDER_DRAFT_KEY, json);
    sessionStorage.setItem('customTrackData', json);
    this._refreshSavedList();
    this._refreshValidation(validation);
    this._toast(strict ? 'Arena locked and ready.' : 'Arena saved locally.', 'ok');
    return json;
  }

  _exportArenaCode() {
    const json = this._saveArena(false);
    if (!json) return;
    this.elements.shareCode.value = exportTrackCode(json);
    this.elements.shareDialog.showModal();
    this._toast('Share code generated.', 'ok');
  }

  async _copyShareCode() {
    const value = this.elements.shareCode.value.trim();
    if (!value) {
      this._toast('Export a share code first.', 'err');
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      this._toast('Share code copied.', 'ok');
    } catch {
      this._toast('Copy failed in this browser.', 'err');
    }
  }

  _importArena() {
    const raw = this.elements.importCode.value.trim();
    if (!raw) {
      this._toast('Paste a TK1 code or arena JSON to import.', 'err');
      return;
    }

    let json = raw;
    if (raw.startsWith('TK1:')) {
      json = importTrackCode(raw);
    }
    if (!json || !this.editor.importTrack(json)) {
      this._toast('Could not import that arena.', 'err');
      return;
    }

    this.elements.importCode.value = '';
    this.elements.shareDialog.close();
    this.selectedEntity = null;
    this._afterImportedArena();
    this._persistDraft();
    this._frameArena(true);
    this._toast('Arena imported.', 'ok');
  }

  _launchArena({ autoStart, maxPlayers, label }) {
    const json = this._saveArena(true);
    if (!json) return;

    if (autoStart && Number(maxPlayers) === 1) {
      this._launchDirectPlaytest(json, label);
      return;
    }

    const intent = {
      modeId: 'battle_online',
      selectedMap: CUSTOM_TRACK_ID,
      battleType: 'deathmatch',
      loadoutId: 'combat',
      maxPlayers,
      scoreLimit: 5,
      autoCreateLobby: true,
      autoStart,
      customTrackData: json,
    };
    sessionStorage.setItem(BUILDER_LAUNCH_INTENT_KEY, JSON.stringify(intent));
    this._toast(label, 'ok');
    window.location.href = 'index.html';
  }

  _launchDirectPlaytest(json, label) {
    let arenaData = null;
    try {
      arenaData = JSON.parse(json);
    } catch {
      arenaData = null;
    }

    const playerId = ensureBuilderPlaytestPlayerId();
    const selectedKart = sessionStorage.getItem('selectedKart') || 'tux';
    const selectedKartName = sessionStorage.getItem('selectedKartName') || 'Builder Kart';
    const playerColor = sessionStorage.getItem('carColor') || 'red';
    const arenaName = String(arenaData?.name || this.elements.nameInput?.value || 'Untitled Arena').trim() || 'Untitled Arena';
    const playtestMeta = {
      name: arenaName,
      segmentCount: Array.isArray(arenaData?.segments) ? arenaData.segments.length : 0,
      obstacleCount: Array.isArray(arenaData?.obstacles) ? arenaData.obstacles.length : 0,
      spawnCount: Array.isArray(arenaData?.startPositions) ? arenaData.startPositions.length : 0,
      startedAt: Date.now(),
    };
    const gameConfig = {
      type: 'startGame',
      modeId: 'builder_playtest',
      gameMode: 'battle',
      subMode: 'builder_playtest',
      battleType: 'deathmatch',
      loadoutId: 'combat',
      trackId: CUSTOM_TRACK_ID,
      arenaId: CUSTOM_TRACK_ID,
      resolvedContentId: CUSTOM_TRACK_ID,
      contentType: 'arena',
      customTrackData: json,
      scoreLimit: 5,
      maxPlayers: 1,
      multiplayer: true,
      multiplayerProvider: 'colyseus',
      singlePlayerMode: true,
      directPlaytest: true,
      builderPlaytest: true,
      selectedKart,
      players: [{
        id: playerId,
        name: `${selectedKartName} Pilot`,
        isHost: true,
        playerColor,
        playerKart: selectedKart,
      }],
    };

    sessionStorage.removeItem(BUILDER_LAUNCH_INTENT_KEY);
    sessionStorage.setItem('customTrackData', json);
    sessionStorage.setItem('gameConfig', JSON.stringify(gameConfig));
    sessionStorage.setItem(BUILDER_PLAYTEST_META_KEY, JSON.stringify(playtestMeta));
    this._toast(label, 'ok');
    window.location.href = 'realtime.html?builderPlaytest=1';
  }

  _refreshSavedList() {
    const saved = getSavedCustomTracks();
    this.elements.savedList.innerHTML = '';

    if (!saved.length) {
      const empty = document.createElement('div');
      empty.className = 'ab-saved-empty';
      empty.textContent = 'No saved arenas yet.';
      this.elements.savedList.appendChild(empty);
      return;
    }

    saved.forEach((arena, index) => {
      const card = document.createElement('div');
      card.className = 'ab-saved-card';
      card.innerHTML = `
        <div class="ab-saved-info">
          <div class="ab-saved-title">${arena.name || 'Untitled Arena'}</div>
          <div class="ab-saved-meta">${arena.author || 'Anonymous'} · ${(arena.segments || []).length} placed tiles</div>
        </div>
        <div class="ab-saved-actions">
          <button class="ab-btn" data-action="load" data-index="${index}">Load</button>
          <button class="ab-btn ab-btn--danger" data-action="delete" data-index="${index}">Delete</button>
        </div>
      `;
      this.elements.savedList.appendChild(card);
    });

    this.elements.savedList.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.index || -1);
        const action = button.dataset.action;
        const arena = saved[index];
        if (!arena) return;

        if (action === 'load') {
          this.editor.importTrack(JSON.stringify(arena));
          this.selectedEntity = null;
          this.elements.loadDialog.close();
          this._afterImportedArena();
          this._persistDraft();
          this._frameArena(true);
          this._toast('Saved arena loaded.', 'ok');
          return;
        }

        removeCustomTrack(arena.name, arena.author);
        this._refreshSavedList();
        this._toast('Saved arena deleted.', 'ok');
      });
    });
  }

  _setToolMode(mode, { syncLibrary = true } = {}) {
    this.toolMode = mode;

    if (syncLibrary) {
      if (mode === TOOL_MODES.drawRoad) {
        this.activeLibraryId = 'road_brush';
      } else if (mode === TOOL_MODES.placeObject && this.activeLibraryId === 'road_brush') {
        this.activeLibraryId = 'flat_wide';
      }
    }

    this.elements.hint.textContent = TOOL_HINTS[mode];
    this.elements.toolSelectBtn.classList.toggle('is-active', mode === TOOL_MODES.select);
    this.elements.toolRoadBtn.classList.toggle('is-active', mode === TOOL_MODES.drawRoad);
    this.elements.toolObjectBtn.classList.toggle('is-active', mode === TOOL_MODES.placeObject);
    this.elements.toolEraseBtn.classList.toggle('is-active', mode === TOOL_MODES.erase);
    this._syncPaletteState();
  }

  _selectLibraryItem(itemId, { syncToolMode = true } = {}) {
    const item = LIBRARY_BY_ID.get(itemId);
    if (!item) return;

    this.activeLibraryId = itemId;
    if (syncToolMode && item.toolMode) {
      this._setToolMode(item.toolMode, { syncLibrary: false });
    } else {
      this._syncPaletteState();
    }
    this._toast(`${item.label} ready.`, 'ok');
  }

  _syncPaletteState() {
    this.elements.palette.querySelectorAll('.ab-piece').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.itemId === this.activeLibraryId);
    });
  }

  _refreshValidation(validation = this.editor.validateTrack()) {
    this.elements.validationList.innerHTML = '';

    const items = [];
    if (validation.valid) {
      items.push({ text: 'Arena is valid and ready for battle.', className: 'is-ok' });
    } else {
      validation.errors.forEach((error) => items.push({ text: error, className: 'is-error' }));
    }

    if (this._roadSegments().length === 0) {
      items.push({ text: 'No auto-generated road network yet. Use Wide Road Painter to sketch traversal lanes.', className: 'is-error' });
    }

    items.forEach((entry) => {
      const li = document.createElement('li');
      li.className = entry.className;
      li.textContent = entry.text;
      this.elements.validationList.appendChild(li);
    });
  }

  _onViewportPointerDown(event) {
    const currentTime = Date.now();
    const timeSinceLastClick = currentTime - this.pointer.lastClickTime;
    const isDoubleClick = timeSinceLastClick < 300 && 
      Math.abs(event.clientX - this.pointer.lastClickPos.x) < 5 &&
      Math.abs(event.clientY - this.pointer.lastClickPos.y) < 5;

    // Middle mouse (button 1) or Shift+Right for PAN
    if (event.button === 1 || (event.button === 2 && event.shiftKey)) {
      this.pointer.mode = 'pan';
      this.pointer.panning = true;
      this.pointer.panX = event.clientX;
      this.pointer.panY = event.clientY;
      return;
    }

    // Right mouse (button 2) for ORBIT
    if (event.button === 2 && !event.shiftKey) {
      this.pointer.mode = 'orbit';
      this.pointer.orbiting = true;
      this.pointer.orbitX = event.clientX;
      this.pointer.orbitY = event.clientY;
      return;
    }

    if (event.button !== 0) return;

    const groundHit = this._groundHit(event.clientX, event.clientY);
    const entityHit = this._pickEntityAtScreen(event.clientX, event.clientY);

    this.pointer.lastClickTime = currentTime;
    this.pointer.lastClickPos = { x: event.clientX, y: event.clientY };

    if (groundHit) {
      this.hoverCell = groundHit.cell;
    }

    // Double-click to frame selection
    if (isDoubleClick && entityHit) {
      this._frameSelection(entityHit);
      return;
    }

    // Double-click on empty space to frame all
    if (isDoubleClick && !entityHit) {
      this._frameArena(false);
      return;
    }

    if (this.toolMode === TOOL_MODES.erase) {
      if (entityHit) {
        this.selectedEntity = entityHit;
        this._deleteSelection();
      } else {
        this._toast('Nothing there to erase.', 'err');
      }
      return;
    }

    if (this.toolMode === TOOL_MODES.select) {
      // Check 3D rotation gizmo first.
      const rotHandle = this._pickRotHandleAtScreen(event.clientX, event.clientY);
      if (rotHandle?.isRotHandle) {
        this.pointer.mode = 'rotate-selection';
        this.pointer.rotateCenter = rotHandle.center.clone();
        this.pointer.rotatePlaneY = rotHandle.planeY;
        this.pointer.rotateChanged = false;
        this._updateSelectedRotationFromPointer(event.clientX, event.clientY);
        return;
      }

      this.selectedEntity = entityHit;
      if (entityHit && groundHit) {
        this.pointer.mode = 'drag-selection';
        this.pointer.lastCellKey = this._cellKey(groundHit.cell.x, groundHit.cell.z);
        const selected = this._resolveSelectedEntity();
        if (selected) this.rotation = selected.rotation;
      } else {
        this.pointer.mode = 'idle';
      }
      this._syncInspector();
      this._syncSelectionHelper();
      return;
    }

    if (!groundHit) return;

    if (this.toolMode === TOOL_MODES.drawRoad) {
      this.pointer.mode = 'road-stroke';
      this.pointer.roadStroke = [groundHit.cell];
      this.pointer.lastCellKey = this._cellKey(groundHit.cell.x, groundHit.cell.z);
      return;
    }

    if (this.toolMode === TOOL_MODES.placeObject) {
      const item = LIBRARY_BY_ID.get(this.activeLibraryId);
      if (!item || item.kind === 'road_brush') {
        this._toast('Choose a tile, prop, or spawn point first.', 'err');
        return;
      }
      this._placeLibraryItemAtCell(item, groundHit.cell);
    }
  }

  _onViewportPointerMove(event) {
    const groundHit = this._groundHit(event.clientX, event.clientY);
    this.hoverCell = groundHit ? groundHit.cell : null;

    if (this.pointer.mode === 'rotate-selection') {
      this._updateSelectedRotationFromPointer(event.clientX, event.clientY);
      return;
    }

    // PAN mode: move the camera target (translate)
    if (this.pointer.mode === 'pan' && this.pointer.panning) {
      const dx = event.clientX - this.pointer.panX;
      const dy = event.clientY - this.pointer.panY;
      this.pointer.panX = event.clientX;
      this.pointer.panY = event.clientY;

      // Calculate world-space pan direction based on camera orientation
      const panSpeed = this.viewport.distance * 0.005;
      const worldRight = Math.sin(this.viewport.yaw);
      const worldForward = Math.cos(this.viewport.yaw);

      this.viewport.target.x += (worldRight * dx - worldForward * dy) * panSpeed;
      this.viewport.target.z += (worldForward * dx + worldRight * dy) * panSpeed;
      return;
    }

    // ORBIT mode: rotate around target
    if (this.pointer.mode === 'orbit' && this.pointer.orbiting) {
      const dx = event.clientX - this.pointer.orbitX;
      const dy = event.clientY - this.pointer.orbitY;
      this.pointer.orbitX = event.clientX;
      this.pointer.orbitY = event.clientY;
      this.viewport.yaw -= dx * 0.008;
      this.viewport.pitch = THREE.MathUtils.clamp(this.viewport.pitch - (dy * 0.008), 0.24, 1.28);
      return;
    }

    if (!groundHit) return;

    if (this.pointer.mode === 'road-stroke') {
      this._extendRoadStroke(groundHit.cell);
      return;
    }

    if (this.pointer.mode === 'drag-selection' && this.selectedEntity) {
      this._moveSelectedToCell(groundHit.cell);
    }
  }

  _onGlobalPointerMove(event) {
    if (this.pointer.mode === 'rotate-selection') {
      this._updateSelectedRotationFromPointer(event.clientX, event.clientY);
      return;
    }

    // PAN mode: move the camera target
    if (this.pointer.mode === 'pan' && this.pointer.panning) {
      const dx = event.clientX - this.pointer.panX;
      const dy = event.clientY - this.pointer.panY;
      this.pointer.panX = event.clientX;
      this.pointer.panY = event.clientY;

      const panSpeed = this.viewport.distance * 0.005;
      const worldRight = Math.sin(this.viewport.yaw);
      const worldForward = Math.cos(this.viewport.yaw);

      this.viewport.target.x += (worldRight * dx - worldForward * dy) * panSpeed;
      this.viewport.target.z += (worldForward * dx + worldRight * dy) * panSpeed;
      return;
    }

    // ORBIT mode: rotate around target
    if (this.pointer.mode === 'orbit' && this.pointer.orbiting) {
      const dx = event.clientX - this.pointer.orbitX;
      const dy = event.clientY - this.pointer.orbitY;
      this.pointer.orbitX = event.clientX;
      this.pointer.orbitY = event.clientY;
      this.viewport.yaw -= dx * 0.008;
      this.viewport.pitch = THREE.MathUtils.clamp(this.viewport.pitch - (dy * 0.008), 0.24, 1.28);
    }
  }

  _onGlobalPointerUp() {
    if (this.pointer.mode === 'road-stroke') {
      this._commitRoadStroke();
      this.pointer.roadStroke = [];
      this.pointer.lastCellKey = '';
    }

    if (this.pointer.mode === 'drag-selection') {
      this._persistDraft();
      this._refreshValidation();
      this._markViewportDirty();
    }

    if (this.pointer.mode === 'rotate-selection') {
      if (this.pointer.rotateChanged) {
        this._afterMutation('Selection rotated.');
      } else {
        this._syncSelectionHelper();
      }
      this.pointer.rotateCenter = null;
      this.pointer.rotatePlaneY = 0;
      this.pointer.rotateChanged = false;
    }

    this.pointer.mode = 'idle';
    this.pointer.orbiting = false;
    this.pointer.panning = false;
  }

  _onViewportWheel(event) {
    event.preventDefault();
    const zoomFactor = event.deltaY < 0 ? 0.88 : 1.12; // Faster zoom
    this.viewport.distance = THREE.MathUtils.clamp(
      this.viewport.distance * zoomFactor,
      6,
      60
    );
  }

  _onKeyDown(event) {
    const key = event.key.toLowerCase();

    // VIEW PRESETS (TinkerCAD-style)
    if (key === 'i' || (event.code === 'Numpad7' && !event.shiftKey)) {
      // Isometric/default view
      Object.assign(this.viewport, this.cameraPresets.iso);
      this._toast('Isometric view', 'ok');
      return;
    }
    if (key === '0' || event.code === 'Numpad0') {
      // Fit all
      this._frameArena(false);
      this._toast('Fit all', 'ok');
      return;
    }
    if (event.code === 'Numpad1') {
      // Front
      Object.assign(this.viewport, this.cameraPresets.front);
      this._toast('Front view', 'ok');
      return;
    }
    if (event.code === 'Numpad3') {
      // Side (right)
      Object.assign(this.viewport, this.cameraPresets.right);
      this._toast('Right view', 'ok');
      return;
    }
    if (event.code === 'Numpad7') {
      // Top
      Object.assign(this.viewport, this.cameraPresets.top);
      this._toast('Top view', 'ok');
      return;
    }

    // KEYBOARD NAVIGATION (Pan with arrow keys)
    const panKey = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key);
    if (panKey) {
      const panSpeed = 1.5;
      const worldRight = Math.sin(this.viewport.yaw);
      const worldForward = Math.cos(this.viewport.yaw);

      if (key === 'arrowup') this.viewport.target.z += worldForward * panSpeed;
      if (key === 'arrowdown') this.viewport.target.z -= worldForward * panSpeed;
      if (key === 'arrowleft') this.viewport.target.x -= worldRight * panSpeed;
      if (key === 'arrowright') this.viewport.target.x += worldRight * panSpeed;
      event.preventDefault();
      return;
    }

    // ZOOM with +/- keys
    if (key === '+' || key === '=') {
      this.viewport.distance *= 0.88;
      this.viewport.distance = THREE.MathUtils.clamp(this.viewport.distance, 6, 60);
      return;
    }
    if (key === '-' || key === '_') {
      this.viewport.distance *= 1.12;
      this.viewport.distance = THREE.MathUtils.clamp(this.viewport.distance, 6, 60);
      return;
    }

    // TOOL SHORTCUTS
    if (key === '1') this._setToolMode(TOOL_MODES.select);
    if (key === '2') this._setToolMode(TOOL_MODES.drawRoad);
    if (key === '3') this._setToolMode(TOOL_MODES.placeObject);
    if (key === '4') this._setToolMode(TOOL_MODES.erase);

    // ROTATE (R key)
    if (key === 'r') {
      this._rotateSelectedTool();
      return;
    }

    // SAVE & UNDO/REDO
    if ((event.ctrlKey || event.metaKey) && key === 's') {
      event.preventDefault();
      this._saveArena(false);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) this._runRedo();
      else this._runUndo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 'y') {
      event.preventDefault();
      this._runRedo();
      return;
    }

    // DELETE
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this._deleteSelection();
    }
  }

  _runUndo() {
    if (!this.editor.undo()) return;
    this._normalizeImportedSegments();
    this.selectedEntity = null;
    this._persistDraft();
    this._refreshValidation();
    this._syncInspector();
    this._markViewportDirty();
    this._toast('Undo', 'ok');
  }

  _runRedo() {
    if (!this.editor.redo()) return;
    this._normalizeImportedSegments();
    this.selectedEntity = null;
    this._persistDraft();
    this._refreshValidation();
    this._syncInspector();
    this._markViewportDirty();
    this._toast('Redo', 'ok');
  }

  _rotateSelectedTool() {
    this._rotateSelectedBy(1);
  }

  _deleteSelection() {
    if (!this.selectedEntity) {
      this._toast('Nothing selected.', 'err');
      return;
    }

    if (this.selectedEntity.type === 'segment') {
      const segment = this.editor.segments.find((item) => item.id === this.selectedEntity.id);
      if (segment) this.editor.removeSegment(segment.id);
    }
    if (this.selectedEntity.type === 'obstacle') {
      this.editor.removeObstacle(this.selectedEntity.index);
    }
    if (this.selectedEntity.type === 'start') {
      this.editor.removeStartPosition(this.selectedEntity.index);
    }

    this.selectedEntity = null;
    this._recomputeRoadNetwork();
    this._afterMutation('Selection deleted.');
  }

  _placeLibraryItemAtCell(item, cell) {
    if (item.kind === 'segment') {
      const occupied = this.editor.segments.some((segment) => this._cellKey(segment.position.x, segment.position.z) === this._cellKey(cell.x, cell.z));
      if (occupied) {
        this._toast('A tile already occupies that grid cell.', 'err');
        return;
      }

      const segment = this.editor.placeSegment(item.id, cell.x, item.id === 'ramp_down' ? -2 : 0, cell.z, this.rotation);
      if (!segment) {
        this._toast('Could not place that tile.', 'err');
        return;
      }
      segment.builderRole = 'manual';
      this.selectedEntity = { type: 'segment', id: segment.id };
      this._afterMutation(`${item.label} placed.`);
      return;
    }

    if (item.kind === 'obstacle') {
      const obstacleHere = this.editor.obstacles.some((obstacle) => this._snapObstacleToCell(obstacle).key === this._cellKey(cell.x, cell.z));
      if (obstacleHere) {
        this._toast('A prop already occupies that grid cell.', 'err');
        return;
      }
      const obstacle = this.editor.placeObstacle(item.id, cell.x, 0.6, cell.z);
      if (!obstacle) {
        this._toast('Could not place that object.', 'err');
        return;
      }
      this.selectedEntity = { type: 'obstacle', index: this.editor.obstacles.length - 1 };
      this._afterMutation(`${item.label} placed.`);
      return;
    }

    if (item.kind === 'start') {
      const start = this.editor.addStartPosition(cell.x, 1, cell.z, THREE.MathUtils.degToRad(this.rotation));
      if (!start) {
        this._toast('Maximum start points reached.', 'err');
        return;
      }
      this.selectedEntity = { type: 'start', index: this.editor.startPositions.length - 1 };
      this._afterMutation('Spawn point placed.');
    }
  }

  _extendRoadStroke(cell) {
    const key = this._cellKey(cell.x, cell.z);
    if (key === this.pointer.lastCellKey) return;

    const lastCell = this.pointer.roadStroke[this.pointer.roadStroke.length - 1];
    const bridge = this._traceGridPath(lastCell, cell);
    bridge.forEach((step) => {
      const stepKey = this._cellKey(step.x, step.z);
      const exists = this.pointer.roadStroke.some((entry) => this._cellKey(entry.x, entry.z) === stepKey);
      if (!exists) this.pointer.roadStroke.push(step);
    });
    this.pointer.lastCellKey = key;
  }

  _commitRoadStroke() {
    if (!this.pointer.roadStroke.length) return;

    this.pointer.roadStroke.forEach((cell) => {
      const exists = this.editor.segments.find((segment) => this._cellKey(segment.position.x, segment.position.z) === this._cellKey(cell.x, cell.z));
      if (!exists) this._addRoadCell(cell);
    });

    this._recomputeRoadNetwork();
    const lastCell = this.pointer.roadStroke[this.pointer.roadStroke.length - 1];
    const lastSegment = this.editor.segments.find((segment) => this._cellKey(segment.position.x, segment.position.z) === this._cellKey(lastCell.x, lastCell.z));
    this.selectedEntity = lastSegment ? { type: 'segment', id: lastSegment.id } : this.selectedEntity;
    this._afterMutation('Road stroke committed.');
  }

  _addRoadCell(cell) {
    const segment = this.editor.placeSegment('straight', cell.x, 0, cell.z, 0);
    if (segment) segment.builderRole = 'road';
    return segment;
  }

  _roadSegments() {
    return this.editor.segments.filter((segment) => segment.builderRole === 'road');
  }

  _recomputeRoadNetwork() {
    const roadSegments = this._roadSegments();
    const roadMap = new Map(roadSegments.map((segment) => [this._cellKey(segment.position.x, segment.position.z), segment]));

    roadSegments.forEach((segment) => {
      const x = segment.position.x;
      const z = segment.position.z;
      const north = roadMap.has(this._cellKey(x, z - GRID_SIZE));
      const east = roadMap.has(this._cellKey(x + GRID_SIZE, z));
      const south = roadMap.has(this._cellKey(x, z + GRID_SIZE));
      const west = roadMap.has(this._cellKey(x - GRID_SIZE, z));
      const count = [north, east, south, west].filter(Boolean).length;

      segment.position.y = 0;

      if (count === 0 || count >= 3) {
        segment.type = 'flat_wide';
        segment.rotation = 0;
        return;
      }

      if (count === 1) {
        segment.type = 'straight';
        segment.rotation = (east || west) ? 90 : 0;
        return;
      }

      if ((north && south) || (east && west)) {
        segment.type = 'straight';
        segment.rotation = (east && west) ? 90 : 0;
        return;
      }

      segment.type = 'curve_right';
      if (north && east) segment.rotation = 0;
      else if (east && south) segment.rotation = 90;
      else if (south && west) segment.rotation = 180;
      else segment.rotation = 270;
    });
  }

  _moveSelectedToCell(cell) {
    const key = this._cellKey(cell.x, cell.z);
    if (key === this.pointer.lastCellKey) return;

    if (this.selectedEntity.type === 'segment') {
      const segment = this.editor.segments.find((item) => item.id === this.selectedEntity.id);
      if (!segment) return;
      const occupied = this.editor.segments.some((item) => item.id !== segment.id && this._cellKey(item.position.x, item.position.z) === key);
      if (occupied) return;

      segment.position.x = cell.x;
      segment.position.z = cell.z;
      if (segment.builderRole === 'road') {
        segment.position.y = 0;
        this._recomputeRoadNetwork();
      } else {
        segment.rotation = this.rotation;
      }
    }

    if (this.selectedEntity.type === 'obstacle') {
      const obstacle = this.editor.obstacles[this.selectedEntity.index];
      if (!obstacle) return;
      obstacle.position.x = cell.x;
      obstacle.position.z = cell.z;
    }

    if (this.selectedEntity.type === 'start') {
      const start = this.editor.startPositions[this.selectedEntity.index];
      if (!start) return;
      start.position.x = cell.x;
      start.position.z = cell.z;
      start.heading = THREE.MathUtils.degToRad(this.rotation);
    }

    this.pointer.lastCellKey = key;
    this._syncInspector();
    this._refreshValidation();
    this._markViewportDirty();
  }

  _syncInspector() {
    const selected = this._resolveSelectedEntity();

    if (!selected) {
      this.elements.selectionBadge.textContent = 'None';
      this.elements.selectionEmpty.hidden = false;
      this.elements.selectionFields.hidden = true;
      if (this.elements.rotCcwBtn) this.elements.rotCcwBtn.disabled = true;
      if (this.elements.rotCwBtn) this.elements.rotCwBtn.disabled = true;
      this._syncSelectionHelper();
      return;
    }

    this.isSyncingInspector = true;
    this.elements.selectionBadge.textContent = selected.badge;
    this.elements.selectionEmpty.hidden = true;
    this.elements.selectionFields.hidden = false;

    this.elements.inspectorType.innerHTML = '';
    this._getInspectorTypeOptions(selected).forEach((option) => {
      const node = document.createElement('option');
      node.value = option.value;
      node.textContent = option.label;
      this.elements.inspectorType.appendChild(node);
    });

    this.elements.inspectorType.value = selected.inspectorType;
    this.elements.inspectorX.value = String(selected.x);
    this.elements.inspectorY.value = String(selected.y);
    this.elements.inspectorZ.value = String(selected.z);
    this.elements.inspectorRotation.value = String(selected.rotation);
    this.elements.inspectorRotation.disabled = selected.type === 'obstacle';
    const canRotate = selected.type !== 'obstacle' && !(selected.type === 'segment' && selected.inspectorType === 'auto_road');
    if (this.elements.rotCcwBtn) this.elements.rotCcwBtn.disabled = !canRotate;
    if (this.elements.rotCwBtn) this.elements.rotCwBtn.disabled = !canRotate;
    this.isSyncingInspector = false;
    this._syncSelectionHelper();
  }

  _getInspectorTypeOptions(selected) {
    if (selected.type === 'segment') {
      return [
        { value: 'auto_road', label: 'Auto Road' },
        { value: 'flat_wide', label: SEGMENT_TYPES.flat_wide.label },
        { value: 'ramp_up', label: SEGMENT_TYPES.ramp_up.label },
        { value: 'ramp_down', label: SEGMENT_TYPES.ramp_down.label },
      ];
    }

    if (selected.type === 'obstacle') {
      return Object.values(OBSTACLE_TYPES).map((item) => ({ value: item.id, label: item.label }));
    }

    return [{ value: 'start', label: 'Spawn Point' }];
  }

  _applyInspectorType() {
    if (this.isSyncingInspector || !this.selectedEntity) return;
    const value = this.elements.inspectorType.value;

    if (this.selectedEntity.type === 'segment') {
      const segment = this.editor.segments.find((item) => item.id === this.selectedEntity.id);
      if (!segment) return;
      if (value === 'auto_road') {
        segment.builderRole = 'road';
        segment.position.y = 0;
        this._recomputeRoadNetwork();
      } else {
        segment.builderRole = 'manual';
        segment.type = value;
        if (value === 'ramp_down') segment.position.y = -2;
      }
    }

    if (this.selectedEntity.type === 'obstacle') {
      const obstacle = this.editor.obstacles[this.selectedEntity.index];
      if (obstacle) obstacle.type = value;
    }

    this._afterMutation('Selection type updated.');
  }

  _applyInspectorTransform() {
    if (this.isSyncingInspector || !this.selectedEntity) return;

    const x = this._snapToGrid(Number(this.elements.inspectorX.value || 0));
    const y = Number(this.elements.inspectorY.value || 0);
    const z = this._snapToGrid(Number(this.elements.inspectorZ.value || 0));
    const rotation = this._normalizeRotation(Number(this.elements.inspectorRotation.value || 0));
    const targetKey = this._cellKey(x, z);

    if (this.selectedEntity.type === 'segment') {
      const segment = this.editor.segments.find((item) => item.id === this.selectedEntity.id);
      if (!segment) return;
      const occupied = this.editor.segments.some((item) => item.id !== segment.id && this._cellKey(item.position.x, item.position.z) === targetKey);
      if (occupied) {
        this._toast('Another tile already uses that grid cell.', 'err');
        this._syncInspector();
        return;
      }
      segment.position.x = x;
      segment.position.y = segment.builderRole === 'road' ? 0 : y;
      segment.position.z = z;
      segment.rotation = rotation;
      if (segment.builderRole === 'road') this._recomputeRoadNetwork();
    }

    if (this.selectedEntity.type === 'obstacle') {
      const obstacle = this.editor.obstacles[this.selectedEntity.index];
      if (!obstacle) return;
      obstacle.position.x = x;
      obstacle.position.y = y;
      obstacle.position.z = z;
    }

    if (this.selectedEntity.type === 'start') {
      const start = this.editor.startPositions[this.selectedEntity.index];
      if (!start) return;
      start.position.x = x;
      start.position.y = y;
      start.position.z = z;
      start.heading = THREE.MathUtils.degToRad(rotation);
    }

    this.rotation = rotation;
    this._afterMutation('Selection updated.');
  }

  _applySelectedRotation(rotation, { finalize = false } = {}) {
    const selected = this._resolveSelectedEntity();
    if (!selected || !this.selectedEntity) return false;

    const normalized = this._normalizeRotation(rotation);
    if (selected.type === 'segment') {
      const segment = this.editor.segments.find((item) => item.id === this.selectedEntity.id);
      if (!segment || segment.builderRole === 'road') return false;
      segment.rotation = normalized;
    } else if (selected.type === 'start') {
      const start = this.editor.startPositions[this.selectedEntity.index];
      if (!start) return false;
      start.heading = THREE.MathUtils.degToRad(normalized);
    } else {
      return false;
    }

    this.rotation = normalized;
    this.elements.inspectorRotation.value = String(normalized);

    if (finalize) {
      this._afterMutation('Selection rotated.');
    } else {
      this._markViewportDirty();
      this._updateHud();
    }
    return true;
  }

  _resolveSelectedEntity() {
    if (!this.selectedEntity) return null;

    if (this.selectedEntity.type === 'segment') {
      const segment = this.editor.segments.find((item) => item.id === this.selectedEntity.id);
      if (!segment) return null;
      return {
        type: 'segment',
        badge: segment.builderRole === 'road' ? 'Road' : 'Tile',
        label: segment.builderRole === 'road' ? 'Auto Road' : SEGMENT_TYPES[segment.type]?.label || 'Tile',
        inspectorType: segment.builderRole === 'road' ? 'auto_road' : segment.type,
        x: segment.position.x,
        y: segment.position.y,
        z: segment.position.z,
        rotation: this._normalizeRotation(segment.rotation || 0),
        entityKey: this._entityKey(this.selectedEntity),
      };
    }

    if (this.selectedEntity.type === 'obstacle') {
      const obstacle = this.editor.obstacles[this.selectedEntity.index];
      if (!obstacle) return null;
      const snapped = this._snapObstacleToCell(obstacle);
      return {
        type: 'obstacle',
        badge: 'Prop',
        label: OBSTACLE_TYPES[obstacle.type]?.label || 'Prop',
        inspectorType: obstacle.type,
        x: snapped.x,
        y: obstacle.position.y,
        z: snapped.z,
        rotation: 0,
        entityKey: this._entityKey(this.selectedEntity),
      };
    }

    if (this.selectedEntity.type === 'start') {
      const start = this.editor.startPositions[this.selectedEntity.index];
      if (!start) return null;
      const snapped = this._snapStartToCell(start);
      return {
        type: 'start',
        badge: 'Spawn',
        label: `Spawn ${this.selectedEntity.index + 1}`,
        inspectorType: 'start',
        x: snapped.x,
        y: start.position.y,
        z: snapped.z,
        rotation: this._normalizeRotation(THREE.MathUtils.radToDeg(start.heading || 0)),
        entityKey: this._entityKey(this.selectedEntity),
      };
    }

    return null;
  }

  _afterMutation(message, { frame = false } = {}) {
    this._persistDraft();
    this._refreshValidation();
    this._syncInspector();
    this._markViewportDirty();
    if (frame) this._frameArena(true);
    this._updateHud();
    if (message) this._toast(message, 'ok');
  }

  _groundHit(clientX, clientY) {
    if (!this.viewport) return null;

    const rect = this.elements.viewport.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((clientY - rect.top) / rect.height) * 2 - 1);
    const pointer = new THREE.Vector2(x, y);
    this.viewport.raycaster.setFromCamera(pointer, this.viewport.camera);

    const point = new THREE.Vector3();
    const hit = this.viewport.raycaster.ray.intersectPlane(this.viewport.groundPlane, point);
    if (!hit) return null;

    const cell = {
      x: this._sceneToGrid(point.x),
      z: this._sceneToGrid(point.z),
    };

    return { point, cell };
  }

  _pickEntityAtScreen(clientX, clientY) {
    if (!this.viewport || !this.viewport.pickables.length) return null;

    const rect = this.elements.viewport.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((clientY - rect.top) / rect.height) * 2 - 1);
    const pointer = new THREE.Vector2(x, y);
    this.viewport.raycaster.setFromCamera(pointer, this.viewport.camera);
    const hits = this.viewport.raycaster.intersectObjects(this.viewport.pickables, true);

    for (const hit of hits) {
      let node = hit.object;
      while (node) {
        if (node.userData?.entity) return node.userData.entity;
        node = node.parent;
      }
    }
    return null;
  }

  _traceGridPath(fromCell, toCell) {
    const result = [];
    let x = fromCell.x;
    let z = fromCell.z;

    while (x !== toCell.x || z !== toCell.z) {
      const remainingX = toCell.x - x;
      const remainingZ = toCell.z - z;
      if (x !== toCell.x && (Math.abs(remainingX) >= Math.abs(remainingZ) || z === toCell.z)) {
        x += Math.sign(remainingX) * GRID_SIZE;
      } else if (z !== toCell.z) {
        z += Math.sign(remainingZ) * GRID_SIZE;
      }
      result.push({ x, z });
    }

    return result;
  }

  _snapToGrid(value) {
    return Math.round(value / GRID_SIZE) * GRID_SIZE;
  }

  _sceneToGrid(value) {
    return Math.round(value) * GRID_SIZE;
  }

  _gridToScene(value) {
    return value / GRID_SIZE;
  }

  _cellKey(x, z) {
    return `${x}:${z}`;
  }

  _normalizeRotation(value) {
    const snapped = Math.round(value / 90) * 90;
    return ((snapped % 360) + 360) % 360;
  }

  _snapObstacleToCell(obstacle) {
    const x = this._snapToGrid(obstacle.position.x);
    const z = this._snapToGrid(obstacle.position.z);
    return { x, z, key: this._cellKey(x, z) };
  }

  _snapStartToCell(start) {
    const x = this._snapToGrid(start.position.x);
    const z = this._snapToGrid(start.position.z);
    return { x, z, key: this._cellKey(x, z) };
  }

  _entityKey(entity) {
    if (!entity) return '';
    if (entity.type === 'segment') return `segment:${entity.id}`;
    if (entity.type === 'obstacle') return `obstacle:${entity.index}`;
    return `start:${entity.index}`;
  }

  _resizeViewport() {
    if (!this.viewport) return;
    const rect = this.elements.viewport.parentElement.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(320, Math.floor(rect.height));
    this.viewport.renderer.setSize(width, height, false);
    this.viewport.camera.aspect = width / Math.max(height, 1);
    this.viewport.camera.updateProjectionMatrix();
  }

  _updateCamera() {
    if (!this.viewport) return;
    const target = this.viewport.target;
    const distance = this.viewport.distance;
    const x = target.x + Math.cos(this.viewport.yaw) * Math.cos(this.viewport.pitch) * distance;
    const y = target.y + Math.sin(this.viewport.pitch) * distance;
    const z = target.z + Math.sin(this.viewport.yaw) * Math.cos(this.viewport.pitch) * distance;
    this.viewport.camera.position.set(x, y, z);
    this.viewport.camera.lookAt(target);
  }

  _frameArena(resetAngles = false) {
    if (!this.viewport) return;
    if (resetAngles) {
      this.viewport.yaw = 0.84;
      this.viewport.pitch = 0.72;
    }

    if (!this.editor.segments.length && !this.editor.obstacles.length && !this.editor.startPositions.length) {
      this.viewport.target.set(0, 0.4, 0);
      this.viewport.distance = 18;
      return;
    }

    if (this.viewport.needsRebuild) {
      this._rebuildViewportScene();
      this.viewport.needsRebuild = false;
    }

    const box = new THREE.Box3().setFromObject(this.viewport.root);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y * 1.4, size.z, 6);
    this.viewport.target.copy(center);
    this.viewport.target.y = Math.max(0.5, center.y + 0.2);
    this.viewport.distance = THREE.MathUtils.clamp(radius * 1.35, 10, 60);
  }

  _frameSelection(entity) {
    // Frame/focus on a specific selected entity (invoked by double-click)
    if (!this.viewport || !entity) return;

    const node = this.viewport.entityNodes.get(this._entityKey(entity));
    if (!node) return;

    const box = new THREE.Box3().setFromObject(node);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.z, 2);

    this.viewport.target.copy(center);
    this.viewport.target.y = center.y + 0.5;
    this.viewport.distance = THREE.MathUtils.clamp(radius * 2.5, 6, 40);
    this.selectedEntity = entity;
    this._syncInspector();
    this._toast(`Framed: ${entity.type}`, 'ok');
  }

  _markViewportDirty() {
    if (this.viewport) this.viewport.needsRebuild = true;
  }

  _rebuildViewportScene() {
    if (!this.viewport) return;

    while (this.viewport.root.children.length) {
      this.viewport.root.remove(this.viewport.root.children[0]);
    }
    this.viewport.entityNodes.clear();
    this.viewport.pickables = [];

    this.editor.segments.forEach((segment) => {
      const node = this._createSegmentNode(segment);
      this.viewport.root.add(node);
      this.viewport.entityNodes.set(`segment:${segment.id}`, node);
      this._registerPickable(node, { type: 'segment', id: segment.id });
    });

    this.editor.obstacles.forEach((obstacle, index) => {
      const node = this._createObstacleNode(obstacle);
      this.viewport.root.add(node);
      this.viewport.entityNodes.set(`obstacle:${index}`, node);
      this._registerPickable(node, { type: 'obstacle', index });
    });

    this.editor.startPositions.forEach((start, index) => {
      const node = this._createStartNode(start, index);
      this.viewport.root.add(node);
      this.viewport.entityNodes.set(`start:${index}`, node);
      this._registerPickable(node, { type: 'start', index });
    });

    this._syncSelectionHelper();
    this._updateHud();
  }

  _registerPickable(node, entity) {
    node.userData.entity = entity;
    node.traverse((child) => {
      child.userData.entity = entity;
      if (child.isMesh) this.viewport.pickables.push(child);
    });
  }

  _createSegmentNode(segment) {
    const group = new THREE.Group();
    const def = SEGMENT_TYPES[segment.type] || SEGMENT_TYPES.straight;
    const assetPath = SEGMENT_ASSET_PATHS[segment.type];
    const cached = assetPath ? this.viewport.assetCache.get(assetPath)?.scene : null;

    let visual = cached ? cached.clone(true) : this._createFallbackSegmentMesh(segment.type, def);
    visual = this._normalizeVisual(visual, def, segment.type);
    group.add(visual);
    group.position.set(this._gridToScene(segment.position.x), this._gridToScene(segment.position.y), this._gridToScene(segment.position.z));
    group.rotation.y = THREE.MathUtils.degToRad(-segment.rotation);

    if (assetPath && !cached) {
      this._loadAsset(assetPath).then(() => this._markViewportDirty());
    }

    return group;
  }

  _createFallbackSegmentMesh(type, def) {
    const material = new THREE.MeshStandardMaterial({
      color: this._segmentColor(type),
      roughness: 0.82,
      metalness: 0.08,
    });

    if (type === 'curve_left' || type === 'curve_right') {
      const shape = new THREE.Shape();
      shape.absarc(0, 0, 1, 0, Math.PI / 2, false);
      shape.lineTo(0.42, 0.42);
      shape.absarc(0, 0, 0.42, Math.PI / 2, 0, true);
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: false });
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(-0.6, 0, -0.6);
      return new THREE.Mesh(geometry, material);
    }

    return new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(0.8, def.width / GRID_SIZE), Math.max(0.12, Math.abs(def.height) / GRID_SIZE + 0.12), Math.max(0.8, def.length / GRID_SIZE)),
      material
    );
  }

  _normalizeVisual(object, def, type) {
    const wrapper = new THREE.Group();
    wrapper.add(object);

    object.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const targetX = Math.max(0.85, def.width / GRID_SIZE);
    const targetZ = Math.max(0.85, def.length / GRID_SIZE);
    const scale = Math.min(targetX / Math.max(size.x, 0.01), targetZ / Math.max(size.z, 0.01));
    object.scale.multiplyScalar(scale);

    object.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const min = box.min.clone();
    object.position.x -= center.x;
    object.position.z -= center.z;
    object.position.y -= min.y;

    if (type === 'curve_left') {
      object.scale.x *= -1;
    }

    return wrapper;
  }

  _createObstacleNode(obstacle) {
    const group = new THREE.Group();

    if (obstacle.type === 'barrier') {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.95, 0.55, 0.25),
        new THREE.MeshStandardMaterial({ color: 0x66758a, roughness: 0.9 })
      );
      mesh.position.y = 0.28;
      group.add(mesh);
    }

    if (obstacle.type === 'boost_pad') {
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(0.72, 0.06, 1.12),
        new THREE.MeshStandardMaterial({ color: 0x00a8ff, emissive: 0x0f4f66, roughness: 0.6 })
      );
      base.position.y = 0.03;
      group.add(base);
    }

    if (obstacle.type === 'item_box') {
      const cube = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.5, 0.5),
        new THREE.MeshStandardMaterial({ color: 0x4ab7ff, emissive: 0x133b6a, transparent: true, opacity: 0.86 })
      );
      cube.position.y = 0.36;
      group.add(cube);
    }

    if (obstacle.type === 'banana') {
      const arc = new THREE.Mesh(
        new THREE.TorusGeometry(0.22, 0.08, 10, 18, Math.PI * 1.15),
        new THREE.MeshStandardMaterial({ color: 0xf6d44c, emissive: 0x473802, roughness: 0.7 })
      );
      arc.rotation.x = Math.PI / 2;
      arc.rotation.z = 0.7;
      arc.position.y = 0.24;
      group.add(arc);
    }

    group.position.set(this._gridToScene(obstacle.position.x), 0, this._gridToScene(obstacle.position.z));
    return group;
  }

  _createStartNode(start, index) {
    const group = new THREE.Group();

    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.75, 6),
      new THREE.MeshStandardMaterial({ color: 0xffc857, emissive: 0x5d3c04, roughness: 0.55 })
    );
    arrow.rotation.z = Math.PI / 2;
    arrow.position.y = 0.42;
    group.add(arrow);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.32, 0.03, 8, 18),
      new THREE.MeshStandardMaterial({ color: 0xffde8c, emissive: 0x6b4e10, roughness: 0.45 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.02;
    group.add(ring);

    group.position.set(this._gridToScene(start.position.x), 0, this._gridToScene(start.position.z));
    group.rotation.y = -(start.heading || 0);
    group.userData.label = `Spawn ${index + 1}`;
    return group;
  }

  _syncSelectionHelper() {
    if (!this.viewport) return;

    if (this.viewport.selectionHelper) {
      this.viewport.scene.remove(this.viewport.selectionHelper);
      this.viewport.selectionHelper.geometry.dispose();
      this.viewport.selectionHelper.material.dispose();
      this.viewport.selectionHelper = null;
    }

    this._clearRotationHandles();

    const key = this._entityKey(this.selectedEntity);
    if (!key) return;
    const node = this.viewport.entityNodes.get(key);
    if (!node) return;
    this.viewport.selectionHelper = new THREE.BoxHelper(node, 0xffc857);
    this.viewport.scene.add(this.viewport.selectionHelper);
    this._buildRotationHandles(node);
  }

  _clearRotationHandles() {
    if (!this.viewport?.rotHandles?.length) return;
    this.viewport.rotHandles.forEach((h) => {
      this.viewport.scene.remove(h);
      h.traverse?.((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material?.map) child.material.map.dispose();
        if (child.material) child.material.dispose();
      });
      if (h.geometry) h.geometry.dispose();
      if (h.material?.map) h.material.map.dispose();
      if (h.material) h.material.dispose();
      this.viewport.pickables = this.viewport.pickables.filter((p) => p !== h);
    });
    this.viewport.rotHandles = [];
  }

  _buildRotationHandles(node) {
    if (!this.viewport) return;
    const selected = this._resolveSelectedEntity();
    if (!selected) return;
    if (selected.type === 'obstacle') return;
    if (selected.type === 'segment' && selected.inspectorType === 'auto_road') return;

    const box = new THREE.Box3().setFromObject(node);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = new THREE.Vector3();
    box.getSize(size);
    const radius = Math.max(size.x, size.z) * 0.62 + 0.18;
    const planeY = Math.max(box.min.y + 0.08, 0.08);

    const gizmo = new THREE.Group();
    gizmo.position.set(center.x, planeY, center.z);
    gizmo.rotation.y = THREE.MathUtils.degToRad(-(selected.rotation || 0));

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.018, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0xffc857, transparent: true, opacity: 0.92, depthTest: false })
    );
    ring.rotation.x = Math.PI / 2;
    gizmo.add(ring);

    const handle = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 18, 18),
      new THREE.MeshBasicMaterial({ color: 0xfff2b8, depthTest: false })
    );
    handle.position.set(radius, 0, 0);
    handle.userData.isRotHandle = true;
    handle.userData.center = center.clone();
    handle.userData.planeY = planeY;
    gizmo.add(handle);

    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.045, 0.12, 10),
      new THREE.MeshBasicMaterial({ color: 0xffc857, depthTest: false })
    );
    arrow.rotation.z = -Math.PI / 2;
    arrow.position.set(radius + 0.08, 0, 0);
    gizmo.add(arrow);

    this.viewport.scene.add(gizmo);
    this.viewport.pickables.push(handle);
    this.viewport.rotHandles.push(gizmo, handle);
  }

  _pickRotHandleAtScreen(clientX, clientY) {
    if (!this.viewport?.rotHandles?.length) return null;
    const rect = this.elements.viewport.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((clientY - rect.top) / rect.height) * 2 - 1);
    this.viewport.raycaster.setFromCamera(new THREE.Vector2(x, y), this.viewport.camera);
    const hits = this.viewport.raycaster.intersectObjects(this.viewport.rotHandles, false);
    return hits.length ? hits[0].object.userData : null;
  }

  _screenPointOnPlane(clientX, clientY, planeY) {
    if (!this.viewport) return null;
    const rect = this.elements.viewport.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((clientY - rect.top) / rect.height) * 2 - 1);
    this.viewport.raycaster.setFromCamera(new THREE.Vector2(x, y), this.viewport.camera);
    const point = new THREE.Vector3();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
    return this.viewport.raycaster.ray.intersectPlane(plane, point) ? point : null;
  }

  _updateSelectedRotationFromPointer(clientX, clientY) {
    if (!this.pointer.rotateCenter) return;
    const point = this._screenPointOnPlane(clientX, clientY, this.pointer.rotatePlaneY);
    if (!point) return;

    const angle = Math.atan2(point.z - this.pointer.rotateCenter.z, point.x - this.pointer.rotateCenter.x);
    const rotation = this._normalizeRotation(-THREE.MathUtils.radToDeg(angle));
    const selected = this._resolveSelectedEntity();
    if (!selected || rotation === selected.rotation) return;

    if (this._applySelectedRotation(rotation, { finalize: false })) {
      this.pointer.rotateChanged = true;
    }
  }

  _syncHoverRing() {
    if (!this.viewport?.hoverRing) return;
    if (!this.hoverCell) {
      this.viewport.hoverRing.visible = false;
      return;
    }

    this.viewport.hoverRing.visible = true;
    this.viewport.hoverRing.position.set(this._gridToScene(this.hoverCell.x), 0.02, this._gridToScene(this.hoverCell.z));
    this.viewport.hoverRing.material.color.setHex(this.toolMode === TOOL_MODES.erase ? 0xff6d7f : 0x7ecbff);
  }

  _syncGhostPreview() {
    if (!this.viewport) return;

    const item = LIBRARY_BY_ID.get(this.activeLibraryId);
    const shouldShow = this.hoverCell && (this.toolMode === TOOL_MODES.drawRoad || (this.toolMode === TOOL_MODES.placeObject && item));

    if (!shouldShow) {
      this.viewport.ghostRoot.visible = false;
      return;
    }

    let ghostSignature = `${this.toolMode}:${this.activeLibraryId}`;
    if (this.toolMode === TOOL_MODES.drawRoad) ghostSignature = 'drawRoad:straight';

    if (ghostSignature !== this.viewport.ghostSignature) {
      while (this.viewport.ghostRoot.children.length) {
        this.viewport.ghostRoot.remove(this.viewport.ghostRoot.children[0]);
      }

      const node = this.toolMode === TOOL_MODES.drawRoad
        ? this._createGhostSegmentNode('straight')
        : this._createGhostLibraryNode(item);
      if (node) this.viewport.ghostRoot.add(node);
      this.viewport.ghostSignature = ghostSignature;
    }

    this.viewport.ghostRoot.visible = this.viewport.ghostRoot.children.length > 0;
    this.viewport.ghostRoot.position.set(this._gridToScene(this.hoverCell.x), 0, this._gridToScene(this.hoverCell.z));
    this.viewport.ghostRoot.rotation.y = THREE.MathUtils.degToRad(-this.rotation);
  }

  _createGhostSegmentNode(type) {
    const def = SEGMENT_TYPES[type] || SEGMENT_TYPES.straight;
    const assetPath = SEGMENT_ASSET_PATHS[type];
    const cached = assetPath ? this.viewport.assetCache.get(assetPath)?.scene : null;
    const visual = cached
      ? this._normalizeVisual(cached.clone(true), def, type)
      : this._normalizeVisual(this._createFallbackSegmentMesh(type, def), def, type);
    this._makeNodeGhosted(visual);
    return visual;
  }

  _createGhostLibraryNode(item) {
    if (!item) return null;
    if (item.kind === 'segment') return this._createGhostSegmentNode(item.id);
    if (item.kind === 'obstacle') {
      const node = this._createObstacleNode({ type: item.id, position: { x: 0, y: 0.6, z: 0 } });
      this._makeNodeGhosted(node);
      return node;
    }
    if (item.kind === 'start') {
      const node = this._createStartNode({ position: { x: 0, y: 1, z: 0 }, heading: 0 }, 0);
      this._makeNodeGhosted(node);
      return node;
    }
    return null;
  }

  _makeNodeGhosted(node) {
    node.traverse((child) => {
      if (!child.isMesh) return;
      child.material = child.material.clone();
      child.material.transparent = true;
      child.material.opacity = 0.5;
      if ('emissiveIntensity' in child.material) child.material.emissiveIntensity *= 0.4;
    });
  }

  _segmentColor(type) {
    if (type === 'flat_wide') return 0x3da27d;
    if (type === 'curve_left' || type === 'curve_right') return 0xf39b4f;
    if (type === 'ramp_up' || type === 'ramp_down') return 0xb379ff;
    return 0x4f95ff;
  }

  _updateHud() {
    const selected = this._resolveSelectedEntity();
    const activeLabel = selected
      ? `Selected ${selected.label}`
      : (LIBRARY_BY_ID.get(this.activeLibraryId)?.label || 'Builder');
    this.elements.stats.textContent = `${activeLabel} · rot ${this.rotation}° · ${this.editor.segments.length} tiles · ${this.editor.obstacles.length} props · ${this.editor.startPositions.length} spawns`;
  }

  _toast(message, tone = 'ok') {
    const toast = document.createElement('div');
    toast.className = `ab-toast ${tone === 'err' ? 'is-err' : 'is-ok'}`;
    toast.textContent = message;
    this.elements.toastWrap.appendChild(toast);
    window.setTimeout(() => toast.remove(), 1900);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new ArenaBuilderApp();
});