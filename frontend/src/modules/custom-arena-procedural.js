import {
  MeshBuilder,
  SceneLoader,
  StandardMaterial,
  Color3,
  Vector3,
  VertexBuffer,
} from '@babylonjs/core';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import '@babylonjs/loaders/glTF';
import { GRID_SIZE } from './track-placement.js';
import {
  resolveCustomArenaSegmentSpec,
  getFallbackSegmentFootprint,
  CUSTOM_ARENA_TRACK_ASSETS,
} from './custom-arena-segments.js';
import { createFallbackPortAnchors } from './custom-arena-anchors.js';

const MODEL_BASE_PATH = '/models/skr/';
const DECK_HEIGHT = 0.75;
const ASSET_BY_KEY = new Map(CUSTOM_ARENA_TRACK_ASSETS.map(a => [a.key, a]));

/* ── Babylon.js mesh-warp functions ──────────────────────────── *
 * Mirror the Three.js warps in asset-loader.js but using
 * Babylon's VertexBuffer API instead of BufferGeometry.
 */

function bboxFromPositions(positions) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

function warpStretchZ(positions, factor) {
  for (let i = 0; i < positions.length; i += 3) {
    positions[i + 2] *= factor;
  }
}

function warpRamp(positions, maxHeight, direction) {
  const bb = bboxFromPositions(positions);
  const range = (bb.maxZ - bb.minZ) || 1;
  for (let i = 0; i < positions.length; i += 3) {
    const t = (positions[i + 2] - bb.minZ) / range;
    const lift = direction > 0 ? t : (1 - t);
    positions[i + 1] += maxHeight * lift;
  }
}

function warpHill(positions, height) {
  const bb = bboxFromPositions(positions);
  const range = (bb.maxZ - bb.minZ) || 1;
  for (let i = 0; i < positions.length; i += 3) {
    const t = (positions[i + 2] - bb.minZ) / range;
    positions[i + 1] += height * Math.sin(Math.PI * t);
  }
}

function warpSCurve(positions, amplitude) {
  const bb = bboxFromPositions(positions);
  const range = (bb.maxZ - bb.minZ) || 1;
  for (let i = 0; i < positions.length; i += 3) {
    const t = (positions[i + 2] - bb.minZ) / range;
    positions[i] += amplitude * Math.sin(2 * Math.PI * t);
  }
}

function warpBank(positions, height, side) {
  const bb = bboxFromPositions(positions);
  const range = (bb.maxX - bb.minX) || 1;
  for (let i = 0; i < positions.length; i += 3) {
    const t = (positions[i] - bb.minX) / range;
    const lift = side > 0 ? t : (1 - t);
    positions[i + 1] += height * lift;
  }
}

function warpElevate(positions, height) {
  for (let i = 0; i < positions.length; i += 3) {
    positions[i + 1] += height;
  }
}

function warpBridgeRamp(positions, height, direction) {
  const bb = bboxFromPositions(positions);
  const range = (bb.maxZ - bb.minZ) || 1;
  for (let i = 0; i < positions.length; i += 3) {
    const t = (positions[i + 2] - bb.minZ) / range;
    const eased = direction > 0
      ? Math.sin(t * Math.PI * 0.5)
      : 1 - Math.sin((1 - t) * Math.PI * 0.5);
    positions[i + 1] += height * eased;
  }
}

const BRIDGE_HEIGHT = 5.0;

/** Warp definition per variant key. Matches asset-loader.js warp params. */
const WARP_DEFS = {
  'straight-2x':  (p) => warpStretchZ(p, 2),
  'straight-3x':  (p) => warpStretchZ(p, 3),
  'straight-4x':  (p) => warpStretchZ(p, 4),
  'ramp-up':      (p) => warpRamp(p, 2.5, 1),
  'ramp-down':    (p) => warpRamp(p, 2.5, -1),
  'jump-ramp':    (p) => warpRamp(p, 4.0, 1),
  'landing-ramp': (p) => warpRamp(p, 4.0, -1),
  'hill':         (p) => warpHill(p, 2.5),
  'dip':          (p) => warpHill(p, -1.5),
  's-curve':      (p) => warpSCurve(p, 1.5),
  'bank-left':    (p) => warpBank(p, 1.5, -1),
  'bank-right':   (p) => warpBank(p, 1.5, 1),
  'gentle-s':     (p) => { warpStretchZ(p, 3); warpSCurve(p, 2.5); },
  'bridge-ramp-up':   (p) => { warpStretchZ(p, 2); warpBridgeRamp(p, BRIDGE_HEIGHT, 1); },
  'bridge-ramp-down': (p) => { warpStretchZ(p, 2); warpBridgeRamp(p, BRIDGE_HEIGHT, -1); },
  'bridge-1x':     (p) => warpElevate(p, BRIDGE_HEIGHT),
  'bridge-2x':     (p) => { warpStretchZ(p, 2); warpElevate(p, BRIDGE_HEIGHT); },
  'bridge-3x':     (p) => { warpStretchZ(p, 3); warpElevate(p, BRIDGE_HEIGHT); },
  'bridge-4x':     (p) => { warpStretchZ(p, 4); warpElevate(p, BRIDGE_HEIGHT); },

  // ── Pittsburgh-themed bridges (elevated + stretched) ──
  'pgh-clemente':      (p) => { warpStretchZ(p, 2); warpElevate(p, BRIDGE_HEIGHT); },
  'pgh-warhol':        (p) => { warpStretchZ(p, 2); warpElevate(p, BRIDGE_HEIGHT); },
  'pgh-carson':        (p) => { warpStretchZ(p, 2); warpElevate(p, BRIDGE_HEIGHT); },
  'pgh-fort-pitt':     (p) => { warpStretchZ(p, 3); warpElevate(p, BRIDGE_HEIGHT); },
  'pgh-fort-duquesne': (p) => { warpStretchZ(p, 3); warpElevate(p, BRIDGE_HEIGHT); },
  'pgh-west-end':      (p) => { warpStretchZ(p, 2); warpElevate(p, BRIDGE_HEIGHT); },
  'pgh-veterans':      (p) => { warpStretchZ(p, 4); warpElevate(p, BRIDGE_HEIGHT); },
  'pgh-16th-st':       (p) => { warpStretchZ(p, 4); warpElevate(p, BRIDGE_HEIGHT); },
  'pgh-south-10th':    (p) => { warpStretchZ(p, 3); warpElevate(p, BRIDGE_HEIGHT); },
  'pgh-31st-st':       (p) => { warpStretchZ(p, 4); warpElevate(p, BRIDGE_HEIGHT); },
  'pgh-mckees-rocks':  (p) => { warpStretchZ(p, 5); warpElevate(p, BRIDGE_HEIGHT); },
  'pgh-smithfield':    (p) => { warpStretchZ(p, 3); warpElevate(p, BRIDGE_HEIGHT); },
  'pgh-liberty':       (p) => { warpStretchZ(p, 6); warpElevate(p, BRIDGE_HEIGHT); },
  'pgh-62nd-st':       (p) => warpElevate(p, BRIDGE_HEIGHT),
  'pgh-birmingham':    (p) => { warpStretchZ(p, 5); warpElevate(p, BRIDGE_HEIGHT); },
  'pgh-40th-st':       (p) => { warpStretchZ(p, 4); warpElevate(p, BRIDGE_HEIGHT); },
  'pgh-hot-metal':     (p) => { warpStretchZ(p, 4); warpElevate(p, BRIDGE_HEIGHT); },
  'pgh-glenwood':      (p) => { warpStretchZ(p, 3); warpElevate(p, BRIDGE_HEIGHT); },
  'pgh-highland-park': (p) => { warpStretchZ(p, 3); warpElevate(p, BRIDGE_HEIGHT); },
  'pgh-homestead':     (p) => { warpStretchZ(p, 3); warpElevate(p, BRIDGE_HEIGHT); },
};

/** Cache GLB templates per scene to avoid reloading. */
const _templateCache = new Map();

async function loadGLBTemplate(scene, key) {
  const asset = ASSET_BY_KEY.get(key);
  if (!asset) return null;

  // Warped variant: load the base key instead
  const loadKey = asset.base || key;
  const loadAsset = ASSET_BY_KEY.get(loadKey);
  if (!loadAsset || !loadAsset.file) return null;

  const cacheKey = `${scene.uid}_${loadKey}`;
  if (!_templateCache.has(cacheKey)) {
    const promise = SceneLoader.ImportMeshAsync('', MODEL_BASE_PATH, loadAsset.file, scene).then(result => {
      const wrapper = new TransformNode(`__glb-template-${loadKey}`, scene);
      const importedNodes = [...(result.transformNodes || []), ...(result.meshes || [])];
      const importedNodeSet = new Set(importedNodes);
      const topLevelNodes = importedNodes.filter((node) => !node.parent || !importedNodeSet.has(node.parent));
      for (const node of topLevelNodes) {
        node.parent = wrapper;
      }

      const renderMeshes = (result.meshes || []).filter((mesh) => !!mesh.geometry);
      for (const mesh of renderMeshes) {
        mesh.receiveShadows = true;
      }

      // ── Auto-scale + center to fit one grid cell ──────────
      // Mirror the builder's loadBaseGLB() logic: compute the raw
      // bounding box and scale so the largest XZ extent = GRID_SIZE.
      wrapper.setEnabled(true);
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      for (const mesh of renderMeshes) {
        mesh.computeWorldMatrix(true);
        const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
        if (!positions) continue;
        const world = mesh.getWorldMatrix();
        for (let i = 0; i < positions.length; i += 3) {
          const pt = Vector3.TransformCoordinates(
            new Vector3(positions[i], positions[i + 1], positions[i + 2]),
            world,
          );
          if (pt.x < minX) minX = pt.x;
          if (pt.x > maxX) maxX = pt.x;
          if (pt.y < minY) minY = pt.y;
          if (pt.y > maxY) maxY = pt.y;
          if (pt.z < minZ) minZ = pt.z;
          if (pt.z > maxZ) maxZ = pt.z;
        }
      }

      const sizeX = (maxX - minX) || 1;
      const sizeZ = (maxZ - minZ) || 1;
      const rawXZ = Math.max(sizeX, sizeZ);
      const gridScale = GRID_SIZE / rawXZ;

      if (Math.abs(gridScale - 1) > 0.05) {
        wrapper.scaling.setAll(gridScale);
      }

      // Re-center: X/Z to origin, Y so bottom sits at Y=0
      const centerX = (minX + maxX) * 0.5 * gridScale;
      const centerZ = (minZ + maxZ) * 0.5 * gridScale;
      const bottomY = minY * gridScale;
      wrapper.position.set(-centerX, -bottomY, -centerZ);

      wrapper.setEnabled(false);
      return { wrapper, renderMeshes };
    }).catch(err => {
      console.warn(`[custom-arena-procedural] GLB load failed for '${loadKey}':`, err);
      return null;
    });

    _templateCache.set(cacheKey, promise);
  }
  return _templateCache.get(cacheKey);
}

function cloneTemplate(scene, template, segmentId, warpFn) {
  const wrapper = template.wrapper.clone(`custom-segment-glb-${segmentId}`, null);
  wrapper.setEnabled(true);

  const renderMeshes = wrapper.getChildMeshes(false).filter((mesh) => !!mesh.geometry);
  for (const mesh of renderMeshes) {
    mesh.setEnabled(true);
    mesh.isVisible = true;
    mesh.receiveShadows = true;

    // Apply vertex warp if this is a warped variant.
    // Cloned meshes still share geometry by default, so isolate geometry first.
    if (warpFn && mesh.getVerticesData) {
      if (typeof mesh.makeGeometryUnique === 'function') {
        mesh.makeGeometryUnique();
      }
      const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
      if (positions) {
        const warped = new Float32Array(positions);
        warpFn(warped);
        mesh.updateVerticesData(VertexBuffer.PositionKind, warped);
        mesh.createNormals(false);
      }
    }
  }

  return { visual: wrapper, renderMeshes };
}

function buildFallbackVisual(scene, key, segmentId) {
  const dims = getFallbackSegmentFootprint(key, GRID_SIZE);

  const wrapper = new TransformNode(`custom-segment-fallback-${segmentId}`, scene);
  const renderMeshes = [];

  // Junction pieces get a more recognizable visual; everything else gets a
  // simple deck box that matches the builder's road surface colour.
  const isJunction = key === 'crossover' || key === 't-junction';

  const roadColor = new Color3(0.325, 0.376, 0.455);
  const markColor = new Color3(0.867, 0.867, 0.267);
  const barrierColor = new Color3(0.267, 0.298, 0.345);

  // ─ Road deck ─
  const deck = MeshBuilder.CreateBox(`${segmentId}-deck`, {
    width: GRID_SIZE * 0.95,
    height: DECK_HEIGHT,
    depth: dims.length,
  }, scene);
  deck.position.y = DECK_HEIGHT / 2;
  const deckMat = new StandardMaterial(`${segmentId}-mat`, scene);
  deckMat.diffuseColor = roadColor;
  deckMat.specularColor = new Color3(0.05, 0.06, 0.08);
  deck.material = deckMat;
  deck.receiveShadows = true;
  deck.parent = wrapper;
  renderMeshes.push(deck);

  if (isJunction) {
    const markMat = new StandardMaterial(`${segmentId}-mark-mat`, scene);
    markMat.diffuseColor = markColor;
    markMat.specularColor = new Color3(0.05, 0.05, 0.02);

    // Center line N-S
    const lineNS = MeshBuilder.CreateBox(`${segmentId}-lineNS`, {
      width: 0.2, height: 0.02, depth: GRID_SIZE * 0.85,
    }, scene);
    lineNS.position.y = DECK_HEIGHT + 0.01;
    lineNS.material = markMat;
    lineNS.parent = wrapper;
    renderMeshes.push(lineNS);

    // Center line E-W (only for crossover)
    if (key === 'crossover') {
      const lineEW = MeshBuilder.CreateBox(`${segmentId}-lineEW`, {
        width: GRID_SIZE * 0.85, height: 0.02, depth: 0.2,
      }, scene);
      lineEW.position.y = DECK_HEIGHT + 0.01;
      lineEW.material = markMat;
      lineEW.parent = wrapper;
      renderMeshes.push(lineEW);
    }

    // T-junction: barrier on closed W side
    if (key === 't-junction') {
      const barrierMat = new StandardMaterial(`${segmentId}-barrier-mat`, scene);
      barrierMat.diffuseColor = barrierColor;
      const barrier = MeshBuilder.CreateBox(`${segmentId}-barrier`, {
        width: 0.35, height: 0.5, depth: GRID_SIZE * 0.95,
      }, scene);
      barrier.position.set(-(GRID_SIZE * 0.475), DECK_HEIGHT + 0.25, 0);
      barrier.material = barrierMat;
      barrier.parent = wrapper;
      renderMeshes.push(barrier);
    }
  }

  return { visual: wrapper, renderMeshes };
}

/**
 * Build (or load) a visual for a custom arena segment.
 * Loads SKR GLB models, applying vertex warps for derived variants.
 * Falls back to a simple box if GLB loading fails.
 */
export async function buildCustomArenaSegmentVisual(scene, type, segmentId = 'segment') {
  const spec = resolveCustomArenaSegmentSpec(type);
  if (!spec) return null;

  const key = spec.canonicalKey;
  const warpFn = WARP_DEFS[key] || null;
  let visual, renderMeshes;

  const template = await loadGLBTemplate(scene, key);
  if (template) {
    ({ visual, renderMeshes } = cloneTemplate(scene, template, segmentId, warpFn));
  } else {
    ({ visual, renderMeshes } = buildFallbackVisual(scene, key, segmentId));
  }

  // Anchor-align: for multi-cell pieces, shift the visual so the anchor
  // cell center is at local Z=0 and additional cells extend in +Z.
  // This mirrors the builder's applyWarp() / buildPghBridgeTemplate()
  // anchor alignment logic.
  const dims = getFallbackSegmentFootprint(key, GRID_SIZE);
  const spanZ = Math.round(dims.length / GRID_SIZE);
  if (spanZ > 1) {
    visual.position.z += ((spanZ - 1) * GRID_SIZE) / 2;
  }

  if (spec.mirrorX) {
    visual.scaling.x *= -1;
  }

  return {
    visual,
    renderMeshes,
    physicsMeshes: [],
    bounds: new Vector3(dims.width, Math.max(dims.height, 1.35), dims.length),
    anchorMeta: {
      scale: 1,
      portAnchors: createFallbackPortAnchors(key, dims.width, dims.length, DECK_HEIGHT * 0.5),
    },
  };
}