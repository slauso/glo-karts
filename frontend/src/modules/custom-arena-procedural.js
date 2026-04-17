import {
  Color3,
  MeshBuilder,
  PBRMaterial,
  SceneLoader,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { GRID_SIZE } from './track-placement.js';
import { resolveCustomArenaSegmentSpec, getFallbackSegmentFootprint, PGH_BRIDGE_DEFS } from './custom-arena-segments.js';
import { createFallbackPortAnchors } from './custom-arena-anchors.js';
import { getSegmentConstants, getSurfaceType, PALETTE } from './track-materials.js';

const { HALF, DECK_HEIGHT, ROAD_WIDTH, CURB_WIDTH, HALF_STRAIGHT, CAP_LENGTH } = getSegmentConstants(GRID_SIZE);
const SHOULDER_WIDTH = ROAD_WIDTH + CURB_WIDTH * 2;

/* ── Exact hex colors from the builder's asset-loader.js ── */
const HEX = Object.freeze({
  asphalt:     '#5e697c',
  asphaltDark: '#536074',
  asphaltWarm: '#687488',
  curb:        '#d46e43',
  stripe:      '#dfe7f1',
  accentBlue:  '#63b4ff',
  accentGold:  '#ffc063',
  accentGreen: '#4bd297',
  accentRed:   '#ff7d66',
  support:     '#344155',
  underlay:    '#2d394c',
});

const MATERIAL_CACHE = new WeakMap();

/* ── GLB segment map — SAME files the builder uses (Kenney tiles) ── */
const GLB_BASE = '/models/track/';
const SEGMENT_GLB_MAP = Object.freeze({
  'straight':           'track-straight.glb',
  'corner-large':       'track-corner.glb',
  'corner-small':       'track-corner.glb',
  'corner-large-ramp':  'track-corner.glb',
  'corner-small-ramp':  'track-corner.glb',
  'curve':              'track-corner.glb',
});

/* Per-scene GLB master mesh cache — clone from these for each segment */
const GLB_MASTER_CACHE = new WeakMap();

/**
 * Load (or clone from cache) a GLB segment mesh for Babylon.js.
 * Normalizes scale to GRID_SIZE and centres at origin, ground at y=0.
 * Returns a TransformNode wrapper with all child meshes, or null on failure.
 */
async function loadSegmentGLB(scene, key, segmentId) {
  const file = SEGMENT_GLB_MAP[key];
  if (!file) return null;

  let sceneCache = GLB_MASTER_CACHE.get(scene);
  if (!sceneCache) {
    sceneCache = new Map();
    GLB_MASTER_CACHE.set(scene, sceneCache);
  }

  try {
    let masterRoot = sceneCache.get(file);
    if (!masterRoot) {
      const result = await SceneLoader.ImportMeshAsync('', GLB_BASE, file, scene);

      /* Wrap imported meshes under an inner node for scale/offset */
      const inner = new TransformNode(`glb-inner-${file}`, scene);
      for (const mesh of result.meshes) {
        if (!mesh.parent || mesh.parent === scene) {
          mesh.parent = inner;
        }
      }

      /* Measure raw bounding box */
      const children = inner.getChildMeshes(false);
      let minV = new Vector3(Infinity, Infinity, Infinity);
      let maxV = new Vector3(-Infinity, -Infinity, -Infinity);
      for (const m of children) {
        m.computeWorldMatrix(true);
        const bounds = m.getBoundingInfo().boundingBox;
        minV = Vector3.Minimize(minV, bounds.minimumWorld);
        maxV = Vector3.Maximize(maxV, bounds.maximumWorld);
      }
      const size = maxV.subtract(minV);
      const center = minV.add(maxV).scale(0.5);
      const maxSpan = Math.max(size.x, size.z) || 1;

      /* Scale so the footprint fills one grid cell */
      if (Math.abs(maxSpan - GRID_SIZE) > 0.1) {
        const s = GRID_SIZE / maxSpan;
        inner.scaling.scaleInPlace(s);
        /* Recompute after scale */
        minV = new Vector3(Infinity, Infinity, Infinity);
        maxV = new Vector3(-Infinity, -Infinity, -Infinity);
        for (const m of children) {
          m.computeWorldMatrix(true);
          const bounds = m.getBoundingInfo().boundingBox;
          minV = Vector3.Minimize(minV, bounds.minimumWorld);
          maxV = Vector3.Maximize(maxV, bounds.maximumWorld);
        }
        size.copyFrom(maxV.subtract(minV));
        center.copyFrom(minV.add(maxV).scale(0.5));
      }

      /* Centre at origin, ground plane at y = 0 */
      inner.position.set(-center.x, -minV.y, -center.z);

      /* Outer wrapper so placement code can set position without clobbering offset */
      masterRoot = new TransformNode(`glb-master-${file}`, scene);
      inner.parent = masterRoot;
      masterRoot.setEnabled(false);
      sceneCache.set(file, masterRoot);
    }

    /* Clone the master hierarchy for this segment instance */
    const clone = masterRoot.clone(`glb-segment-${segmentId}`, null);
    if (!clone) return null;
    clone.setEnabled(true);

    const renderMeshes = [];
    const physicsMeshes = [];
    for (const child of clone.getChildMeshes(false)) {
      child.setEnabled(true);
      child.receiveShadows = true;
      renderMeshes.push(child);
      physicsMeshes.push(child);
    }

    return { visual: clone, renderMeshes, physicsMeshes };
  } catch (err) {
    console.warn(`[arena-proc] GLB load failed for "${key}" (${file}), falling back to procedural:`, err.message);
    return null;
  }
}

function getSceneMaterials(scene) {
  let materials = MATERIAL_CACHE.get(scene);
  if (materials) return materials;

  /* PBR material matching Three.js MeshStandardMaterial properties */
  const makePBR = (name, hex, roughness = 0.92, metallic = 0.04) => {
    const mat = new PBRMaterial(name, scene);
    mat.albedoColor = Color3.FromHexString(hex);
    mat.roughness = roughness;
    mat.metallic = metallic;
    return mat;
  };

  /* Emissive PBR for beacons — roughness 0.55, emissiveIntensity 0.18 */
  const makeBeacon = (name, hex) => {
    const mat = new PBRMaterial(name, scene);
    mat.albedoColor = Color3.FromHexString(hex);
    mat.roughness = 0.55;
    mat.metallic = 0;
    mat.emissiveColor = Color3.FromHexString(hex).scale(0.18);
    return mat;
  };

  /* Emissive PBR for chevrons — roughness 0.72, emissiveIntensity 0.1 */
  const makeChevron = (name, hex) => {
    const mat = new PBRMaterial(name, scene);
    mat.albedoColor = Color3.FromHexString(hex);
    mat.roughness = 0.72;
    mat.metallic = 0;
    mat.emissiveColor = Color3.FromHexString(hex).scale(0.1);
    return mat;
  };

  /* Unlit material for lane stripes (matches Three.js MeshBasicMaterial) */
  const makeUnlit = (name, hex, alpha = 1) => {
    const mat = new StandardMaterial(name, scene);
    mat.disableLighting = true;
    mat.emissiveColor = Color3.FromHexString(hex);
    mat.alpha = alpha;
    mat.backFaceCulling = false;
    return mat;
  };

  materials = {
    asphalt:       makePBR('arena-proc-asphalt',       HEX.asphalt),
    asphaltDark:   makePBR('arena-proc-asphalt-dark',   HEX.asphaltDark),
    asphaltWarm:   makePBR('arena-proc-asphalt-warm',   HEX.asphaltWarm),
    curb:          makePBR('arena-proc-curb',            HEX.curb),
    stripe:        makeUnlit('arena-proc-stripe',        HEX.stripe, 0.5),
    /* Beacon materials (edge beacons — glowing cylinders) */
    accentBlue:    makeBeacon('arena-proc-beacon-blue',  HEX.accentBlue),
    accentGold:    makeBeacon('arena-proc-beacon-gold',  HEX.accentGold),
    accentGreen:   makeBeacon('arena-proc-beacon-green', HEX.accentGreen),
    accentRed:     makeBeacon('arena-proc-beacon-red',   HEX.accentRed),
    /* Chevron materials (direction indicator boxes) */
    chevronBlue:   makeChevron('arena-proc-chevron-blue',  HEX.accentBlue),
    chevronGold:   makeChevron('arena-proc-chevron-gold',  HEX.accentGold),
    chevronGreen:  makeChevron('arena-proc-chevron-green', HEX.accentGreen),
    chevronRed:    makeChevron('arena-proc-chevron-red',   HEX.accentRed),
    support:       makePBR('arena-proc-support',         HEX.support),
    underlay:      makePBR('arena-proc-underlay',        HEX.underlay),
  };
  MATERIAL_CACHE.set(scene, materials);
  return materials;
}

function registerMesh(mesh, renderMeshes, physicsMeshes, isPhysical = true) {
  mesh.receiveShadows = true;
  renderMeshes.push(mesh);
  if (isPhysical) physicsMeshes.push(mesh);
  return mesh;
}

/* Resolve an accent (beacon) material to its chevron variant */
function chevronOf(materials, accentMat) {
  if (accentMat === materials.accentBlue) return materials.chevronBlue;
  if (accentMat === materials.accentGold) return materials.chevronGold;
  if (accentMat === materials.accentGreen) return materials.chevronGreen;
  if (accentMat === materials.accentRed) return materials.chevronRed;
  return accentMat;
}

function createDeck(scene, renderMeshes, physicsMeshes, name, width, length, material, y = DECK_HEIGHT / 2) {
  const mesh = MeshBuilder.CreateBox(name, { width, height: DECK_HEIGHT, depth: length }, scene);
  mesh.position.y = y;
  mesh.material = material;
  return registerMesh(mesh, renderMeshes, physicsMeshes, true);
}

function createCurb(scene, materials, renderMeshes, physicsMeshes, name, length, x, y = DECK_HEIGHT * 0.425) {
  const curb = MeshBuilder.CreateBox(name, { width: CURB_WIDTH, height: DECK_HEIGHT * 0.85, depth: length }, scene);
  curb.position.set(x, y, 0);
  curb.material = materials.curb;
  return registerMesh(curb, renderMeshes, physicsMeshes, true);
}

function createLaneStripe(scene, materials, renderMeshes, name, length, rotationY = 0, x = 0, z = 0) {
  const stripe = MeshBuilder.CreatePlane(name, { width: 0.18, height: length }, scene);
  stripe.rotation.x = Math.PI / 2;
  stripe.rotation.z = rotationY;
  stripe.position.set(x, DECK_HEIGHT + 0.012, z);
  stripe.material = materials.stripe;
  return registerMesh(stripe, renderMeshes, [], false);
}

function createEdgeBeacon(scene, renderMeshes, name, x, z, material) {
  const beacon = MeshBuilder.CreateCylinder(name, { diameter: 0.28, height: 0.3, tessellation: 10 }, scene);
  beacon.position.set(x, DECK_HEIGHT + 0.18, z);
  beacon.material = material;
  return registerMesh(beacon, renderMeshes, [], false);
}

/** Thin physical deck at segment edge ports so wheels bridge between adjacent segments. */
function createSeamBridges(scene, materials, parent, renderMeshes, physicsMeshes, portAnchors) {
  const BRIDGE_DEPTH = 0.5;
  const BRIDGE_HEIGHT = DECK_HEIGHT;
  const BRIDGE_WIDTH = ROAD_WIDTH;
  if (!portAnchors) return;
  for (const [dirStr, anchor] of Object.entries(portAnchors)) {
    const dir = Number(dirStr);
    const name = `${parent.name}-seam-${dir}`;
    let w = BRIDGE_WIDTH;
    let d = BRIDGE_DEPTH;
    if (dir === 1 || dir === 3) {
      w = BRIDGE_DEPTH;
      d = BRIDGE_WIDTH;
    }
    const bridge = MeshBuilder.CreateBox(name, { width: w, height: BRIDGE_HEIGHT, depth: d }, scene);
    bridge.position.set(anchor.x, BRIDGE_HEIGHT / 2, anchor.z);
    bridge.material = materials.asphalt;
    registerMesh(bridge, renderMeshes, physicsMeshes, true).parent = parent;
  }
}

function createChevron(scene, renderMeshes, name, x, z, material, rotationY = 0) {
  const chevron = MeshBuilder.CreateBox(name, { width: 1.1, height: 0.08, depth: 0.24 }, scene);
  chevron.position.set(x, DECK_HEIGHT + 0.05, z);
  chevron.rotation.y = rotationY;
  chevron.material = material;
  return registerMesh(chevron, renderMeshes, [], false);
}

function createSupportPillar(scene, materials, renderMeshes, physicsMeshes, name, x, z, height = 0.8) {
  const pillar = MeshBuilder.CreateBox(name, { width: 0.45, height, depth: 0.45 }, scene);
  pillar.position.set(x, height / 2 - 0.02, z);
  pillar.material = materials.support;
  return registerMesh(pillar, renderMeshes, physicsMeshes, true);
}

function buildStraightBase(scene, materials, parent, renderMeshes, physicsMeshes, deckMaterial, accentMaterial) {
  createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-deck`, ROAD_WIDTH, GRID_SIZE, deckMaterial).parent = parent;
  createCurb(scene, materials, renderMeshes, physicsMeshes, `${parent.name}-curb-left`, GRID_SIZE, -(ROAD_WIDTH + CURB_WIDTH) / 2).parent = parent;
  createCurb(scene, materials, renderMeshes, physicsMeshes, `${parent.name}-curb-right`, GRID_SIZE, (ROAD_WIDTH + CURB_WIDTH) / 2).parent = parent;
  createLaneStripe(scene, materials, renderMeshes, `${parent.name}-stripe`, GRID_SIZE * 0.76).parent = parent;
  createEdgeBeacon(scene, renderMeshes, `${parent.name}-beacon-a`, 0, -HALF + 0.7, accentMaterial).parent = parent;
  createEdgeBeacon(scene, renderMeshes, `${parent.name}-beacon-b`, 0, HALF - 0.7, accentMaterial).parent = parent;
}

function buildWidePad(scene, materials, parent, renderMeshes, physicsMeshes) {
  // 2×2 pad (matches builder footprint [[0,0],[1,0],[0,1],[1,1]])
  // Geometry spans from (-HALF,-HALF) to (GRID_SIZE+HALF, GRID_SIZE+HALF)
  const TOTAL = GRID_SIZE * 2;
  const cx = HALF; // center of the 2×2 area relative to origin cell

  // Base slab covering all 4 cells
  const base = createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-base`, TOTAL, TOTAL, materials.asphaltWarm);
  base.position.x = cx;
  base.position.z = cx;
  base.parent = parent;

  // Cross road strips (N-S and E-W through the center)
  const crossA = createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-cross-a`, ROAD_WIDTH, TOTAL, materials.asphaltDark, DECK_HEIGHT / 2 + 0.01);
  crossA.position.x = cx;
  crossA.position.z = cx;
  crossA.parent = parent;
  const crossB = createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-cross-b`, TOTAL, ROAD_WIDTH, materials.asphaltDark, DECK_HEIGHT / 2 + 0.01);
  crossB.position.x = cx;
  crossB.position.z = cx;
  crossB.parent = parent;

  createLaneStripe(scene, materials, renderMeshes, `${parent.name}-stripe-a`, TOTAL * 0.78, 0, cx, cx).parent = parent;
  createLaneStripe(scene, materials, renderMeshes, `${parent.name}-stripe-b`, TOTAL * 0.78, Math.PI / 2, cx, cx).parent = parent;
  createEdgeBeacon(scene, renderMeshes, `${parent.name}-beacon-n`, cx, -HALF + 0.8, materials.accentBlue).parent = parent;
  createEdgeBeacon(scene, renderMeshes, `${parent.name}-beacon-e`, GRID_SIZE + HALF - 0.8, cx, materials.accentBlue).parent = parent;
  createEdgeBeacon(scene, renderMeshes, `${parent.name}-beacon-s`, cx, GRID_SIZE + HALF - 0.8, materials.accentBlue).parent = parent;
  createEdgeBeacon(scene, renderMeshes, `${parent.name}-beacon-w`, -HALF + 0.8, cx, materials.accentBlue).parent = parent;
}

function buildCornerBase(scene, materials, parent, renderMeshes, physicsMeshes, deckMaterial, accentMaterial) {
  // Each leg spans from center (0) to the cell boundary (±HALF) so
  // adjacent segments meet flush with no gap.
  const legLength = HALF;
  const legCenter = HALF / 2;
  createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-underlay`, GRID_SIZE, GRID_SIZE, materials.underlay, 0.04).parent = parent;

  const northLeg = createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-north-leg`, ROAD_WIDTH, legLength, deckMaterial);
  northLeg.position.z = -legCenter;
  northLeg.parent = parent;

  const northLeft = createCurb(scene, materials, renderMeshes, physicsMeshes, `${parent.name}-north-left`, legLength, -(ROAD_WIDTH + CURB_WIDTH) / 2);
  northLeft.position.z = -legCenter;
  northLeft.parent = parent;

  const northRight = createCurb(scene, materials, renderMeshes, physicsMeshes, `${parent.name}-north-right`, legLength, (ROAD_WIDTH + CURB_WIDTH) / 2);
  northRight.position.z = -legCenter;
  northRight.parent = parent;

  const eastLeg = createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-east-leg`, legLength, ROAD_WIDTH, deckMaterial);
  eastLeg.position.x = legCenter;
  eastLeg.parent = parent;

  const eastTop = MeshBuilder.CreateBox(`${parent.name}-east-top`, { width: legLength, height: DECK_HEIGHT * 0.85, depth: CURB_WIDTH }, scene);
  eastTop.position.set(legCenter, DECK_HEIGHT * 0.425, -(ROAD_WIDTH + CURB_WIDTH) / 2);
  eastTop.material = materials.curb;
  registerMesh(eastTop, renderMeshes, physicsMeshes, true).parent = parent;

  const eastBottom = MeshBuilder.CreateBox(`${parent.name}-east-bottom`, { width: legLength, height: DECK_HEIGHT * 0.85, depth: CURB_WIDTH }, scene);
  eastBottom.position.set(legCenter, DECK_HEIGHT * 0.425, (ROAD_WIDTH + CURB_WIDTH) / 2);
  eastBottom.material = materials.curb;
  registerMesh(eastBottom, renderMeshes, physicsMeshes, true).parent = parent;

  const patch = createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-patch`, ROAD_WIDTH, ROAD_WIDTH, deckMaterial, DECK_HEIGHT / 2 + 0.01);
  patch.position.set(legCenter - ROAD_WIDTH / 2, DECK_HEIGHT / 2 + 0.01, -legCenter + ROAD_WIDTH / 2);
  patch.parent = parent;

  createLaneStripe(scene, materials, renderMeshes, `${parent.name}-north-stripe`, legLength * 0.72, 0, 0, -legCenter).parent = parent;
  createLaneStripe(scene, materials, renderMeshes, `${parent.name}-east-stripe`, legLength * 0.72, Math.PI / 2, legCenter, 0).parent = parent;
  createChevron(scene, renderMeshes, `${parent.name}-chevron`, 1.9, -2.2, chevronOf(materials, accentMaterial), Math.PI / 4).parent = parent;
  createEdgeBeacon(scene, renderMeshes, `${parent.name}-beacon-n`, 0, -HALF + 0.7, accentMaterial).parent = parent;
  createEdgeBeacon(scene, renderMeshes, `${parent.name}-beacon-e`, HALF - 0.7, 0, accentMaterial).parent = parent;
}

function buildCap(scene, materials, parent, renderMeshes, physicsMeshes, direction) {
  let z = 0;
  if (direction === 'front' || direction === 'end') z = -HALF + CAP_LENGTH / 2;
  if (direction === 'back') z = HALF - CAP_LENGTH / 2;

  const deck = createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-deck`, ROAD_WIDTH, CAP_LENGTH, materials.asphaltDark);
  deck.position.z = z;
  deck.parent = parent;

  const left = createCurb(scene, materials, renderMeshes, physicsMeshes, `${parent.name}-left`, CAP_LENGTH, -(ROAD_WIDTH + CURB_WIDTH) / 2);
  left.position.z = z;
  left.parent = parent;

  const right = createCurb(scene, materials, renderMeshes, physicsMeshes, `${parent.name}-right`, CAP_LENGTH, (ROAD_WIDTH + CURB_WIDTH) / 2);
  right.position.z = z;
  right.parent = parent;

  const stripe = createLaneStripe(scene, materials, renderMeshes, `${parent.name}-stripe`, CAP_LENGTH * 0.7);
  stripe.position.z = z;
  stripe.parent = parent;

  createChevron(scene, renderMeshes, `${parent.name}-chevron`, 0, z, direction === 'back' ? materials.chevronRed : materials.chevronGold, 0).parent = parent;
}

function decorateStraightVariant(scene, materials, parent, renderMeshes, physicsMeshes, key) {
  if (key === 'straight') {
    createChevron(scene, renderMeshes, `${parent.name}-chevron-a`, 0, -1.5, materials.chevronBlue, 0).parent = parent;
    createChevron(scene, renderMeshes, `${parent.name}-chevron-b`, 0, 1.5, materials.chevronBlue, 0).parent = parent;
    return;
  }

  if (key === 'bend' || key === 'bend-large') {
    createChevron(scene, renderMeshes, `${parent.name}-chevron-a`, -0.8, -2.1, materials.chevronGold, 0.35).parent = parent;
    createChevron(scene, renderMeshes, `${parent.name}-chevron-b`, 0.8, 0.2, materials.chevronGold, -0.35).parent = parent;
    createChevron(scene, renderMeshes, `${parent.name}-chevron-c`, -0.8, 2.2, materials.chevronGold, 0.35).parent = parent;
    return;
  }

  if (key.startsWith('skew')) {
    const dir = key.includes('right') ? 1 : -1;
    createChevron(scene, renderMeshes, `${parent.name}-chevron-a`, dir * 1.15, -2.4, materials.chevronBlue, dir * 0.4).parent = parent;
    createChevron(scene, renderMeshes, `${parent.name}-chevron-b`, 0, 0, materials.chevronBlue, dir * 0.4).parent = parent;
    createChevron(scene, renderMeshes, `${parent.name}-chevron-c`, -dir * 1.15, 2.4, materials.chevronBlue, dir * 0.4).parent = parent;
    return;
  }

  if (key === 'bump-up' || key === 'bump-down') {
    const accent = key === 'bump-up' ? materials.chevronGreen : materials.chevronRed;
    createChevron(scene, renderMeshes, `${parent.name}-chevron-a`, 0, -2, accent, 0).parent = parent;
    createChevron(scene, renderMeshes, `${parent.name}-chevron-b`, 0, 0, accent, 0).parent = parent;
    createChevron(scene, renderMeshes, `${parent.name}-chevron-c`, 0, 2, accent, 0).parent = parent;
    return;
  }

  if (key === 'hill-beginning' || key === 'hill-end' || key === 'hill-complete' || key === 'hill-complete-half') {
    const accent = key === 'hill-end' ? materials.chevronRed : materials.chevronGreen;
    createSupportPillar(scene, materials, renderMeshes, physicsMeshes, `${parent.name}-pillar-a`, -1.5, -1.8, 1.1).parent = parent;
    createSupportPillar(scene, materials, renderMeshes, physicsMeshes, `${parent.name}-pillar-b`, 1.5, 1.8, key === 'hill-complete-half' ? 0.8 : 1.35).parent = parent;
    createChevron(scene, renderMeshes, `${parent.name}-chevron-a`, 0, -2.3, accent, 0).parent = parent;
    createChevron(scene, renderMeshes, `${parent.name}-chevron-b`, 0, 0, accent, 0).parent = parent;
    createChevron(scene, renderMeshes, `${parent.name}-chevron-c`, 0, 2.3, accent, 0).parent = parent;
  }
}

// ── Phase 3 — New piece builders ──────────────────────────────

function buildTJunction(scene, materials, parent, renderMeshes, physicsMeshes) {
  // N/E/S legs with asphalt intersection
  createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-base`, GRID_SIZE, GRID_SIZE, materials.asphaltWarm).parent = parent;
  // N-S through road
  createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-ns`, ROAD_WIDTH, GRID_SIZE, materials.asphaltDark, DECK_HEIGHT / 2 + 0.01).parent = parent;
  // E arm
  const eArm = createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-e-arm`, HALF, ROAD_WIDTH, materials.asphaltDark, DECK_HEIGHT / 2 + 0.01);
  eArm.position.x = HALF / 4;
  eArm.parent = parent;
  createLaneStripe(scene, materials, renderMeshes, `${parent.name}-stripe-ns`, GRID_SIZE * 0.78).parent = parent;
  createLaneStripe(scene, materials, renderMeshes, `${parent.name}-stripe-e`, HALF * 0.6, Math.PI / 2, HALF / 4, 0).parent = parent;
  createEdgeBeacon(scene, renderMeshes, `${parent.name}-beacon-n`, 0, -HALF + 0.8, materials.accentGold).parent = parent;
  createEdgeBeacon(scene, renderMeshes, `${parent.name}-beacon-e`, HALF - 0.8, 0, materials.accentGold).parent = parent;
  createEdgeBeacon(scene, renderMeshes, `${parent.name}-beacon-s`, 0, HALF - 0.8, materials.accentGold).parent = parent;
}

function buildCrossroads(scene, materials, parent, renderMeshes, physicsMeshes) {
  createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-base`, GRID_SIZE, GRID_SIZE, materials.asphaltWarm).parent = parent;
  createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-cross-ns`, ROAD_WIDTH, GRID_SIZE, materials.asphaltDark, DECK_HEIGHT / 2 + 0.01).parent = parent;
  createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-cross-ew`, GRID_SIZE, ROAD_WIDTH, materials.asphaltDark, DECK_HEIGHT / 2 + 0.01).parent = parent;
  createLaneStripe(scene, materials, renderMeshes, `${parent.name}-stripe-ns`, GRID_SIZE * 0.78).parent = parent;
  createLaneStripe(scene, materials, renderMeshes, `${parent.name}-stripe-ew`, GRID_SIZE * 0.78, Math.PI / 2).parent = parent;
  createEdgeBeacon(scene, renderMeshes, `${parent.name}-beacon-n`, 0, -HALF + 0.8, materials.accentGold).parent = parent;
  createEdgeBeacon(scene, renderMeshes, `${parent.name}-beacon-e`, HALF - 0.8, 0, materials.accentGold).parent = parent;
  createEdgeBeacon(scene, renderMeshes, `${parent.name}-beacon-s`, 0, HALF - 0.8, materials.accentGold).parent = parent;
  createEdgeBeacon(scene, renderMeshes, `${parent.name}-beacon-w`, -HALF + 0.8, 0, materials.accentGold).parent = parent;
}

function buildRampUp(scene, materials, parent, renderMeshes, physicsMeshes) {
  const RAMP_RISE = GRID_SIZE * 0.3;
  // Angled deck for the ramp surface
  const deck = MeshBuilder.CreateBox(`${parent.name}-deck`, { width: ROAD_WIDTH, height: DECK_HEIGHT, depth: GRID_SIZE }, scene);
  deck.rotation.x = Math.atan2(RAMP_RISE, GRID_SIZE);
  deck.position.y = RAMP_RISE / 2 + DECK_HEIGHT / 2;
  deck.material = materials.asphaltDark;
  registerMesh(deck, renderMeshes, physicsMeshes, true).parent = parent;
  // Support pillars
  createSupportPillar(scene, materials, renderMeshes, physicsMeshes, `${parent.name}-pillar-l`, -(ROAD_WIDTH / 2 - 0.5), HALF - 1, RAMP_RISE + 0.5).parent = parent;
  createSupportPillar(scene, materials, renderMeshes, physicsMeshes, `${parent.name}-pillar-r`, (ROAD_WIDTH / 2 - 0.5), HALF - 1, RAMP_RISE + 0.5).parent = parent;
  createChevron(scene, renderMeshes, `${parent.name}-chevron-a`, 0, -2, materials.chevronGreen, 0).parent = parent;
  createChevron(scene, renderMeshes, `${parent.name}-chevron-b`, 0, 2, materials.chevronGreen, 0).parent = parent;
}

function buildRampDown(scene, materials, parent, renderMeshes, physicsMeshes) {
  const RAMP_RISE = GRID_SIZE * 0.3;
  const deck = MeshBuilder.CreateBox(`${parent.name}-deck`, { width: ROAD_WIDTH, height: DECK_HEIGHT, depth: GRID_SIZE }, scene);
  deck.rotation.x = -Math.atan2(RAMP_RISE, GRID_SIZE);
  deck.position.y = RAMP_RISE / 2 + DECK_HEIGHT / 2;
  deck.material = materials.asphaltDark;
  registerMesh(deck, renderMeshes, physicsMeshes, true).parent = parent;
  createSupportPillar(scene, materials, renderMeshes, physicsMeshes, `${parent.name}-pillar-l`, -(ROAD_WIDTH / 2 - 0.5), -HALF + 1, RAMP_RISE + 0.5).parent = parent;
  createSupportPillar(scene, materials, renderMeshes, physicsMeshes, `${parent.name}-pillar-r`, (ROAD_WIDTH / 2 - 0.5), -HALF + 1, RAMP_RISE + 0.5).parent = parent;
  createChevron(scene, renderMeshes, `${parent.name}-chevron-a`, 0, -2, materials.chevronRed, 0).parent = parent;
  createChevron(scene, renderMeshes, `${parent.name}-chevron-b`, 0, 2, materials.chevronRed, 0).parent = parent;
}

function buildBridge(scene, materials, parent, renderMeshes, physicsMeshes) {
  const BRIDGE_ELEV = GRID_SIZE * 0.35;
  // Elevated deck
  createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-deck`, ROAD_WIDTH, GRID_SIZE, materials.asphalt, BRIDGE_ELEV).parent = parent;
  // Curbs at deck height (not ground level)
  createCurb(scene, materials, renderMeshes, physicsMeshes, `${parent.name}-curb-l`, GRID_SIZE, -(ROAD_WIDTH + CURB_WIDTH) / 2, BRIDGE_ELEV).parent = parent;
  createCurb(scene, materials, renderMeshes, physicsMeshes, `${parent.name}-curb-r`, GRID_SIZE, (ROAD_WIDTH + CURB_WIDTH) / 2, BRIDGE_ELEV).parent = parent;
  // Side railings at deck top
  for (const [side, s] of [['l', -1], ['r', 1]]) {
    const rail = MeshBuilder.CreateBox(`${parent.name}-rail-${side}`, { width: 0.2, height: 0.6, depth: GRID_SIZE }, scene);
    rail.position.set(s * (ROAD_WIDTH / 2 + 0.2), BRIDGE_ELEV + DECK_HEIGHT / 2 + 0.3, 0);
    rail.material = materials.support;
    registerMesh(rail, renderMeshes, physicsMeshes, false).parent = parent;
  }
  // Support columns
  for (const z of [-HALF + 1.5, HALF - 1.5]) {
    for (const x of [-ROAD_WIDTH / 3, ROAD_WIDTH / 3]) {
      createSupportPillar(scene, materials, renderMeshes, physicsMeshes, `${parent.name}-col-${x > 0 ? 'r' : 'l'}-${z > 0 ? 's' : 'n'}`, x, z, BRIDGE_ELEV).parent = parent;
    }
  }
  // Lane stripe at deck height
  const stripe = createLaneStripe(scene, materials, renderMeshes, `${parent.name}-stripe`, GRID_SIZE * 0.76);
  stripe.position.y = BRIDGE_ELEV + DECK_HEIGHT / 2 + 0.01;
  stripe.parent = parent;
}

function buildJump(scene, materials, parent, renderMeshes, physicsMeshes) {
  const LAUNCH_HEIGHT = GRID_SIZE * 0.18;
  // Launch ramp (wedge via angled box)
  const launchDeck = MeshBuilder.CreateBox(`${parent.name}-launch`, { width: ROAD_WIDTH, height: DECK_HEIGHT, depth: HALF }, scene);
  launchDeck.rotation.x = Math.atan2(LAUNCH_HEIGHT, HALF);
  launchDeck.position.set(0, LAUNCH_HEIGHT / 2 + DECK_HEIGHT / 2, -HALF / 2);
  launchDeck.material = materials.accentGreen;
  registerMesh(launchDeck, renderMeshes, physicsMeshes, true).parent = parent;
  // Landing deck (flat at other end)
  createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-landing`, ROAD_WIDTH, HALF, materials.asphalt, DECK_HEIGHT / 2).parent = parent;
  const landing = parent.getChildMeshes().find(m => m.name.includes('landing'));
  if (landing) landing.position.z = HALF / 4;
  createChevron(scene, renderMeshes, `${parent.name}-chevron-a`, -1.5, -2, materials.chevronGreen, 0).parent = parent;
  createChevron(scene, renderMeshes, `${parent.name}-chevron-b`, 1.5, -2, materials.chevronGreen, 0).parent = parent;
}

function buildTunnel(scene, materials, parent, renderMeshes, physicsMeshes) {
  // Road deck through tunnel
  createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-deck`, ROAD_WIDTH, GRID_SIZE, materials.asphaltDark).parent = parent;
  createLaneStripe(scene, materials, renderMeshes, `${parent.name}-stripe`, GRID_SIZE * 0.76).parent = parent;
  // Tunnel walls (tall curbs, non-physical so kart can pass through)
  const WALL_H = 2.0;
  const lWall = MeshBuilder.CreateBox(`${parent.name}-wall-l`, { width: 0.4, height: WALL_H, depth: GRID_SIZE }, scene);
  lWall.position.set(-(ROAD_WIDTH / 2 + 0.2), WALL_H / 2, 0);
  lWall.material = materials.support;
  registerMesh(lWall, renderMeshes, physicsMeshes, false).parent = parent;
  const rWall = MeshBuilder.CreateBox(`${parent.name}-wall-r`, { width: 0.4, height: WALL_H, depth: GRID_SIZE }, scene);
  rWall.position.set((ROAD_WIDTH / 2 + 0.2), WALL_H / 2, 0);
  rWall.material = materials.support;
  registerMesh(rWall, renderMeshes, physicsMeshes, false).parent = parent;
  // Ceiling
  const ceiling = MeshBuilder.CreateBox(`${parent.name}-ceiling`, { width: ROAD_WIDTH + 0.8, height: 0.3, depth: GRID_SIZE }, scene);
  ceiling.position.set(0, WALL_H, 0);
  ceiling.material = materials.underlay;
  registerMesh(ceiling, renderMeshes, physicsMeshes, false).parent = parent;
}

function buildBankedTurn(scene, materials, parent, renderMeshes, physicsMeshes) {
  // Corner with banked surface (inner edge higher).
  // Legs span center→cell boundary so adjacent segments meet flush.
  const legLength = HALF;
  const legCenter = HALF / 2;
  createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-underlay`, GRID_SIZE, GRID_SIZE, materials.underlay, 0.04).parent = parent;
  const northLeg = createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-north-leg`, ROAD_WIDTH, legLength, materials.asphaltDark);
  northLeg.position.z = -legCenter;
  northLeg.rotation.x = 0.12; // slight bank
  northLeg.parent = parent;
  const eastLeg = createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-east-leg`, legLength, ROAD_WIDTH, materials.asphaltDark);
  eastLeg.position.x = legCenter;
  eastLeg.rotation.z = -0.12; // slight bank
  eastLeg.parent = parent;
  const patch = createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-patch`, ROAD_WIDTH, ROAD_WIDTH, materials.asphaltDark, DECK_HEIGHT / 2 + 0.01);
  patch.position.set(legCenter - ROAD_WIDTH / 2, DECK_HEIGHT / 2 + 0.01, -legCenter + ROAD_WIDTH / 2);
  patch.parent = parent;
  createChevron(scene, renderMeshes, `${parent.name}-chevron`, 1.9, -2.2, materials.chevronBlue, Math.PI / 4).parent = parent;
  createEdgeBeacon(scene, renderMeshes, `${parent.name}-beacon-n`, 0, -HALF + 0.7, materials.accentBlue).parent = parent;
  createEdgeBeacon(scene, renderMeshes, `${parent.name}-beacon-e`, HALF - 0.7, 0, materials.accentBlue).parent = parent;
}

function buildChicane(scene, materials, parent, renderMeshes, physicsMeshes) {
  // S-shaped chicane with lateral offset
  const OFFSET = ROAD_WIDTH * 0.3;
  // First half — offset left
  const seg1 = createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-seg1`, ROAD_WIDTH, HALF, materials.asphalt);
  seg1.position.set(-OFFSET / 2, DECK_HEIGHT / 2, -HALF / 2);
  seg1.parent = parent;
  // Second half — offset right
  const seg2 = createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-seg2`, ROAD_WIDTH, HALF, materials.asphalt);
  seg2.position.set(OFFSET / 2, DECK_HEIGHT / 2, HALF / 2);
  seg2.parent = parent;
  // Connecting angled strip
  const connector = createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-conn`, ROAD_WIDTH * 1.1, ROAD_WIDTH * 0.4, materials.asphaltDark);
  connector.rotation.y = Math.atan2(OFFSET, ROAD_WIDTH * 0.4);
  connector.position.y = DECK_HEIGHT / 2;
  connector.parent = parent;
  createChevron(scene, renderMeshes, `${parent.name}-chevron-a`, -OFFSET / 2 - 0.5, -2, materials.chevronRed, 0.3).parent = parent;
  createChevron(scene, renderMeshes, `${parent.name}-chevron-b`, OFFSET / 2 + 0.5, 2, materials.chevronRed, -0.3).parent = parent;
}

// ── Shape-accurate builders matching builder-v2/asset-loader.js ──────

function buildBump(scene, materials, parent, renderMeshes, physicsMeshes, direction) {
  const sign = direction === 'up' ? 1 : -1;
  const bumpHeight = 0.65;
  const accentMat = direction === 'up' ? materials.accentGreen : materials.accentRed;
  const chevronMat = direction === 'up' ? materials.chevronGreen : materials.chevronRed;

  // Flat entry/exit thirds
  const third = GRID_SIZE / 3;
  for (const [idx, zOff] of [['a', -third], ['b', third]]) {
    const slab = createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-flat-${idx}`, ROAD_WIDTH, third, materials.asphalt);
    slab.position.z = zOff;
    slab.parent = parent;
    for (const [side, s] of [['l', -1], ['r', 1]]) {
      const c = MeshBuilder.CreateBox(`${parent.name}-curb-${idx}-${side}`, { width: CURB_WIDTH, height: DECK_HEIGHT * 0.85, depth: third }, scene);
      c.position.set(s * (ROAD_WIDTH + CURB_WIDTH) / 2, DECK_HEIGHT * 0.425, zOff);
      c.material = materials.curb;
      registerMesh(c, renderMeshes, physicsMeshes, true).parent = parent;
    }
  }

  // Raised centre hump — tilted ramp halves
  const rampLen = third * 0.5;
  for (const [idx, zSign] of [['up', -1], ['dn', 1]]) {
    const ramp = MeshBuilder.CreateBox(`${parent.name}-ramp-${idx}`, { width: ROAD_WIDTH, height: DECK_HEIGHT, depth: rampLen }, scene);
    ramp.position.set(0, DECK_HEIGHT / 2 + sign * bumpHeight * 0.5, zSign * rampLen * 0.5);
    ramp.rotation.x = -zSign * sign * Math.atan2(bumpHeight, rampLen);
    ramp.material = materials.asphaltWarm;
    registerMesh(ramp, renderMeshes, physicsMeshes, true).parent = parent;
  }

  // Peak cap
  const cap = MeshBuilder.CreateBox(`${parent.name}-peak`, { width: ROAD_WIDTH, height: DECK_HEIGHT * 0.5, depth: 0.5 }, scene);
  cap.position.set(0, DECK_HEIGHT / 2 + sign * bumpHeight, 0);
  cap.material = chevronMat;
  registerMesh(cap, renderMeshes, physicsMeshes, true).parent = parent;

  createLaneStripe(scene, materials, renderMeshes, `${parent.name}-stripe`, GRID_SIZE * 0.76).parent = parent;
  createChevron(scene, renderMeshes, `${parent.name}-chevron-a`, 0, -HALF + 1.2, chevronMat, 0).parent = parent;
  createChevron(scene, renderMeshes, `${parent.name}-chevron-b`, 0, HALF - 1.2, chevronMat, 0).parent = parent;
  createEdgeBeacon(scene, renderMeshes, `${parent.name}-beacon-a`, 0, -HALF + 0.7, accentMat).parent = parent;
  createEdgeBeacon(scene, renderMeshes, `${parent.name}-beacon-b`, 0, HALF - 0.7, accentMat).parent = parent;
}

function buildHill(scene, materials, parent, renderMeshes, physicsMeshes, variant) {
  let frontY = 0, backY = 0;
  const maxH = 2.6;
  let accentMat = materials.accentGreen;
  let chevronMat = materials.chevronGreen;

  if (variant === 'hill-beginning')      { backY = maxH; }
  else if (variant === 'hill-end')       { frontY = maxH; accentMat = materials.accentRed; chevronMat = materials.chevronRed; }
  else if (variant === 'hill-complete')  { backY = maxH; }
  else if (variant === 'hill-complete-half') { backY = maxH * 0.55; }

  const steps = 8;
  const stepLen = GRID_SIZE / steps;

  for (let i = 0; i < steps; i++) {
    const tFront = i / steps;
    const tBack = (i + 1) / steps;
    const yFront = frontY + (backY - frontY) * tFront;
    const yBack = frontY + (backY - frontY) * tBack;
    const stepY = (yFront + yBack) / 2;
    const z = -HALF + (i + 0.5) * stepLen;

    const tColor = stepY / Math.max(frontY, backY, 0.01);
    const stepMat = tColor > 0.5 ? materials.asphaltWarm : materials.asphalt;
    const slab = createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-step-${i}`, ROAD_WIDTH, stepLen + 0.04, stepMat, stepY);
    slab.position.z = z;
    slab.parent = parent;

    // Curbs at step height
    for (const [side, s] of [['l', -1], ['r', 1]]) {
      const c = MeshBuilder.CreateBox(`${parent.name}-curb-${i}-${side}`, { width: CURB_WIDTH, height: DECK_HEIGHT * 0.85, depth: stepLen + 0.04 }, scene);
      c.position.set(s * (ROAD_WIDTH + CURB_WIDTH) / 2, stepY + DECK_HEIGHT * 0.425 - DECK_HEIGHT / 2, z);
      c.material = materials.curb;
      registerMesh(c, renderMeshes, physicsMeshes, true).parent = parent;
    }

    // Side walls below elevated steps
    if (stepY > 0.3) {
      for (const [side, s] of [['l', -1], ['r', 1]]) {
        const wall = MeshBuilder.CreateBox(`${parent.name}-wall-${i}-${side}`, { width: 0.25, height: stepY, depth: stepLen + 0.04 }, scene);
        wall.position.set(s * (ROAD_WIDTH / 2 + CURB_WIDTH + 0.2), stepY / 2, z);
        wall.material = materials.support;
        registerMesh(wall, renderMeshes, physicsMeshes, false).parent = parent;
      }
    }
  }

  // Support columns at the high end
  const highZ = backY > frontY ? HALF - 1.2 : -HALF + 1.2;
  const highH = Math.max(frontY, backY);
  if (highH > 0.3) {
    for (const x of [-ROAD_WIDTH * 0.35, ROAD_WIDTH * 0.35]) {
      createSupportPillar(scene, materials, renderMeshes, physicsMeshes, `${parent.name}-col-${x > 0 ? 'r' : 'l'}`, x, highZ, highH + 0.4).parent = parent;
    }
    if (highH > 1.2) {
      const midZ = highZ * 0.45;
      for (const x of [-ROAD_WIDTH * 0.35, ROAD_WIDTH * 0.35]) {
        createSupportPillar(scene, materials, renderMeshes, physicsMeshes, `${parent.name}-mid-col-${x > 0 ? 'r' : 'l'}`, x, midZ, highH * 0.55).parent = parent;
      }
    }
  }

  // Direction chevrons along the ramp
  for (let i = 0; i < 3; i++) {
    const t = (i + 1) / 4;
    const z = -HALF + t * GRID_SIZE;
    const cy = frontY + (backY - frontY) * t + DECK_HEIGHT;
    const chev = createChevron(scene, renderMeshes, `${parent.name}-chevron-${i}`, 0, z, chevronMat, 0);
    chev.position.y = cy;
    chev.parent = parent;
  }
  createEdgeBeacon(scene, renderMeshes, `${parent.name}-beacon-a`, 0, -HALF + 0.7, accentMat).parent = parent;
  createEdgeBeacon(scene, renderMeshes, `${parent.name}-beacon-b`, 0, HALF - 0.7, accentMat).parent = parent;
}

function buildBend(scene, materials, parent, renderMeshes, physicsMeshes, large) {
  const lateralShift = large ? HALF * 0.7 : HALF * 0.45;
  const segs = 10;
  const segLen = GRID_SIZE / segs;

  for (let i = 0; i < segs; i++) {
    const t = (i + 0.5) / segs;
    const xOff = Math.sin(t * Math.PI) * lateralShift;
    const z = -HALF + (i + 0.5) * segLen;
    const nextT = Math.min((i + 1.5) / segs, 1);
    const nextX = Math.sin(nextT * Math.PI) * lateralShift;
    const yaw = Math.atan2(nextX - xOff, segLen);

    const slab = createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-seg-${i}`, ROAD_WIDTH, segLen + 0.08, materials.asphalt);
    slab.position.set(xOff, DECK_HEIGHT / 2, z);
    slab.rotation.y = yaw * 0.6;
    slab.parent = parent;

    // Curbs track the curve
    for (const [side, s] of [['l', -1], ['r', 1]]) {
      const cx = xOff + s * (ROAD_WIDTH + CURB_WIDTH) / 2 * Math.cos(yaw * 0.6);
      const c = MeshBuilder.CreateBox(`${parent.name}-curb-${i}-${side}`, { width: CURB_WIDTH, height: DECK_HEIGHT * 0.85, depth: segLen + 0.08 }, scene);
      c.position.set(cx, DECK_HEIGHT * 0.425, z);
      c.rotation.y = yaw * 0.6;
      c.material = materials.curb;
      registerMesh(c, renderMeshes, physicsMeshes, true).parent = parent;
    }
  }

  createChevron(scene, renderMeshes, `${parent.name}-chevron-a`, lateralShift * 0.6, -HALF + 1.5, materials.chevronGold, 0.45).parent = parent;
  createChevron(scene, renderMeshes, `${parent.name}-chevron-b`, lateralShift, 0, materials.chevronGold, 0).parent = parent;
  createChevron(scene, renderMeshes, `${parent.name}-chevron-c`, lateralShift * 0.6, HALF - 1.5, materials.chevronGold, -0.45).parent = parent;
  createEdgeBeacon(scene, renderMeshes, `${parent.name}-beacon-a`, -lateralShift * 0.1, -HALF + 0.7, materials.accentGold).parent = parent;
  createEdgeBeacon(scene, renderMeshes, `${parent.name}-beacon-b`, -lateralShift * 0.1, HALF - 0.7, materials.accentGold).parent = parent;
}

function buildSkew(scene, materials, parent, renderMeshes, physicsMeshes, key) {
  const dir = key.includes('right') ? 1 : -1;
  const isSide = key.includes('side');
  const shift = isSide ? HALF * 0.35 : HALF * 0.6;
  const segs = 8;
  const segLen = GRID_SIZE / segs;
  const yaw = -dir * Math.atan2(shift, GRID_SIZE);
  const deckMat = isSide ? materials.asphaltDark : materials.asphalt;
  const accentMat = isSide ? materials.accentGold : materials.accentBlue;
  const chevronMat = isSide ? materials.chevronGold : materials.chevronBlue;

  for (let i = 0; i < segs; i++) {
    const t = (i + 0.5) / segs;
    const xOff = dir * t * shift;
    const z = -HALF + (i + 0.5) * segLen;
    const slab = createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-seg-${i}`, ROAD_WIDTH, segLen + 0.06, deckMat);
    slab.position.set(xOff, DECK_HEIGHT / 2, z);
    slab.rotation.y = yaw * 0.65;
    slab.parent = parent;

    for (const [side, s] of [['l', -1], ['r', 1]]) {
      const cx = xOff + s * (ROAD_WIDTH + CURB_WIDTH) / 2 * Math.cos(yaw * 0.65);
      const c = MeshBuilder.CreateBox(`${parent.name}-curb-${i}-${side}`, { width: CURB_WIDTH, height: DECK_HEIGHT * 0.85, depth: segLen + 0.06 }, scene);
      c.position.set(cx, DECK_HEIGHT * 0.425, z);
      c.rotation.y = yaw * 0.65;
      c.material = materials.curb;
      registerMesh(c, renderMeshes, physicsMeshes, true).parent = parent;
    }
  }

  createChevron(scene, renderMeshes, `${parent.name}-chevron-a`, dir * shift * 0.2, -HALF + 1.5, chevronMat, dir * 0.5).parent = parent;
  createChevron(scene, renderMeshes, `${parent.name}-chevron-b`, 0, 0, chevronMat, dir * 0.5).parent = parent;
  createChevron(scene, renderMeshes, `${parent.name}-chevron-c`, dir * shift * 0.8, HALF - 1.5, chevronMat, dir * 0.5).parent = parent;
  createEdgeBeacon(scene, renderMeshes, `${parent.name}-beacon-a`, 0, -HALF + 0.7, accentMat).parent = parent;
  createEdgeBeacon(scene, renderMeshes, `${parent.name}-beacon-b`, dir * shift, HALF - 0.7, accentMat).parent = parent;
}

function buildPghBridge(scene, materials, parent, renderMeshes, physicsMeshes, key) {
  const PGH_ELEV = GRID_SIZE * 0.7;
  const def = PGH_BRIDGE_DEFS[key];
  const bridgeColor = def?.color || 0xC39953;
  const deckTop = PGH_ELEV + DECK_HEIGHT / 2;

  // Elevated deck with curbs and stripe
  createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-deck`, ROAD_WIDTH, GRID_SIZE, materials.asphalt, PGH_ELEV).parent = parent;
  createCurb(scene, materials, renderMeshes, physicsMeshes, `${parent.name}-curb-l`, GRID_SIZE, -(ROAD_WIDTH + CURB_WIDTH) / 2, PGH_ELEV).parent = parent;
  createCurb(scene, materials, renderMeshes, physicsMeshes, `${parent.name}-curb-r`, GRID_SIZE, (ROAD_WIDTH + CURB_WIDTH) / 2, PGH_ELEV).parent = parent;

  // Railings with bridge accent color
  const railMat = (() => {
    const m = new PBRMaterial(`${parent.name}-rail-mat`, scene);
    m.albedoColor = Color3.FromHexString('#' + bridgeColor.toString(16).padStart(6, '0'));
    m.roughness = 0.3;
    m.metallic = 0.75;
    return m;
  })();
  for (const [side, s] of [['l', -1], ['r', 1]]) {
    const rail = MeshBuilder.CreateBox(`${parent.name}-rail-${side}`, { width: 0.12, height: 0.5, depth: GRID_SIZE }, scene);
    rail.position.set(s * (SHOULDER_WIDTH / 2 + 0.08), deckTop + 0.25, 0);
    rail.material = railMat;
    registerMesh(rail, renderMeshes, physicsMeshes, false).parent = parent;
  }

  // Lane stripe at bridge height
  const stripe = createLaneStripe(scene, materials, renderMeshes, `${parent.name}-stripe`, GRID_SIZE * 0.76);
  stripe.position.y = deckTop + 0.01;
  stripe.parent = parent;

  // Support columns
  const colMat = (() => {
    const m = new PBRMaterial(`${parent.name}-col-mat`, scene);
    m.albedoColor = Color3.FromHexString('#555566');
    m.roughness = 0.92;
    m.metallic = 0.04;
    return m;
  })();
  for (const z of [-HALF + 1.5, HALF - 1.5]) {
    for (const x of [-ROAD_WIDTH / 3, ROAD_WIDTH / 3]) {
      const col = MeshBuilder.CreateBox(`${parent.name}-col-${x > 0 ? 'r' : 'l'}-${z > 0 ? 's' : 'n'}`, { width: 0.4, height: PGH_ELEV, depth: 0.4 }, scene);
      col.position.set(x, PGH_ELEV / 2, z);
      col.material = colMat;
      registerMesh(col, renderMeshes, physicsMeshes, false).parent = parent;
    }
  }

  // Superstructure based on bridge type
  const sx = SHOULDER_WIDTH / 2 + 0.15;
  if (def?.type === 'suspension' || def?.type === 'tied-arch') {
    // Arch spans
    const archH = def.type === 'suspension' ? 3.0 : 2.5;
    const archSegs = 8;
    for (const [side, s] of [['l', -1], ['r', 1]]) {
      const hs = GRID_SIZE * 0.44;
      for (let i = 0; i < archSegs; i++) {
        const t0 = i / archSegs, t1 = (i + 1) / archSegs;
        const z0 = -hs + t0 * hs * 2, z1 = -hs + t1 * hs * 2;
        const y0 = deckTop + Math.sin(t0 * Math.PI) * archH;
        const y1 = deckTop + Math.sin(t1 * Math.PI) * archH;
        const dz = z1 - z0, dy = y1 - y0;
        const len = Math.sqrt(dz * dz + dy * dy);
        const seg = MeshBuilder.CreateBox(`${parent.name}-arch-${side}-${i}`, { width: 0.18, height: 0.18, depth: len + 0.01 }, scene);
        seg.position.set(s * sx, (y0 + y1) / 2, (z0 + z1) / 2);
        seg.rotation.x = -Math.atan2(dy, dz);
        seg.material = railMat;
        registerMesh(seg, renderMeshes, physicsMeshes, false).parent = parent;
      }
      // Hangers
      for (let i = 1; i < 6; i++) {
        const t = i / 6;
        const z = -hs + t * hs * 2;
        const archY = deckTop + Math.sin(t * Math.PI) * archH;
        const h = archY - deckTop;
        if (h < 0.15) continue;
        const rod = MeshBuilder.CreateBox(`${parent.name}-hanger-${side}-${i}`, { width: 0.05, height: h, depth: 0.05 }, scene);
        rod.position.set(s * sx, deckTop + h / 2, z);
        rod.material = railMat;
        registerMesh(rod, renderMeshes, physicsMeshes, false).parent = parent;
      }
    }
  } else if (def?.type === 'steel-arch') {
    // Arch below deck
    const archPeak = PGH_ELEV * 0.5;
    for (const x of [-ROAD_WIDTH / 3, ROAD_WIDTH / 3]) {
      const hs = GRID_SIZE * 0.45;
      for (let i = 0; i < 8; i++) {
        const t0 = i / 8, t1 = (i + 1) / 8;
        const z0 = -hs + t0 * hs * 2, z1 = -hs + t1 * hs * 2;
        const y0 = Math.sin(t0 * Math.PI) * archPeak;
        const y1 = Math.sin(t1 * Math.PI) * archPeak;
        const dz = z1 - z0, dy = y1 - y0;
        const len = Math.sqrt(dz * dz + dy * dy);
        const seg = MeshBuilder.CreateBox(`${parent.name}-arch-${x > 0 ? 'r' : 'l'}-${i}`, { width: 0.2, height: 0.2, depth: len + 0.01 }, scene);
        seg.position.set(x, (y0 + y1) / 2, (z0 + z1) / 2);
        seg.rotation.x = -Math.atan2(dy, dz);
        seg.material = railMat;
        registerMesh(seg, renderMeshes, physicsMeshes, false).parent = parent;
      }
    }
  } else if (def?.type === 'truss') {
    // Warren truss
    const tH = 2.2;
    const panels = 5;
    const panelW = GRID_SIZE / panels;
    for (const [side, s] of [['l', -1], ['r', 1]]) {
      const x = s * sx;
      const top = MeshBuilder.CreateBox(`${parent.name}-truss-top-${side}`, { width: 0.1, height: 0.1, depth: GRID_SIZE }, scene);
      top.position.set(x, deckTop + tH, 0);
      top.material = railMat;
      registerMesh(top, renderMeshes, physicsMeshes, false).parent = parent;
      for (let i = 0; i <= panels; i++) {
        const z = -HALF + i * panelW;
        const vert = MeshBuilder.CreateBox(`${parent.name}-truss-v-${side}-${i}`, { width: 0.07, height: tH, depth: 0.07 }, scene);
        vert.position.set(x, deckTop + tH / 2, z);
        vert.material = railMat;
        registerMesh(vert, renderMeshes, physicsMeshes, false).parent = parent;
      }
      for (let i = 0; i < panels; i++) {
        const dy = i % 2 === 0 ? tH : -tH;
        const diagLen = Math.sqrt(panelW * panelW + tH * tH);
        const diag = MeshBuilder.CreateBox(`${parent.name}-truss-d-${side}-${i}`, { width: 0.06, height: 0.06, depth: diagLen }, scene);
        diag.position.set(x, deckTop + tH / 2, -HALF + (i + 0.5) * panelW);
        diag.rotation.x = -Math.atan2(dy, panelW);
        diag.material = railMat;
        registerMesh(diag, renderMeshes, physicsMeshes, false).parent = parent;
      }
    }
  } else if (def?.type === 'girder') {
    const gH = 1.8;
    for (const [side, s] of [['l', -1], ['r', 1]]) {
      const plate = MeshBuilder.CreateBox(`${parent.name}-girder-${side}`, { width: 0.12, height: gH, depth: GRID_SIZE }, scene);
      plate.position.set(s * sx, deckTop + gH / 2, 0);
      plate.material = railMat;
      registerMesh(plate, renderMeshes, physicsMeshes, false).parent = parent;
    }
  } else if (def?.type === 'cantilever') {
    const pH = 3.5;
    for (const z of [-GRID_SIZE / 3, GRID_SIZE / 3]) {
      for (const [side, s] of [['l', -1], ['r', 1]]) {
        const pier = MeshBuilder.CreateBox(`${parent.name}-pier-${side}-${z > 0 ? 's' : 'n'}`, { width: 0.35, height: pH, depth: 0.35 }, scene);
        pier.position.set(s * sx, deckTop + pH / 2, z);
        pier.material = railMat;
        registerMesh(pier, renderMeshes, physicsMeshes, false).parent = parent;
      }
      const beam = MeshBuilder.CreateBox(`${parent.name}-beam-${z > 0 ? 's' : 'n'}`, { width: sx * 2 + 0.3, height: 0.18, depth: 0.18 }, scene);
      beam.position.set(0, deckTop + pH, z);
      beam.material = railMat;
      registerMesh(beam, renderMeshes, physicsMeshes, false).parent = parent;
    }
  } else if (def?.type === 'lenticular') {
    const tH = 2.5;
    for (const [side, s] of [['l', -1], ['r', 1]]) {
      const hs = GRID_SIZE * 0.45;
      // Top arch
      for (let i = 0; i < 6; i++) {
        const t0 = i / 6, t1 = (i + 1) / 6;
        const z0 = -hs + t0 * hs * 2, z1 = -hs + t1 * hs * 2;
        const y0 = deckTop + 0.2 + Math.sin(t0 * Math.PI) * tH * 0.6;
        const y1 = deckTop + 0.2 + Math.sin(t1 * Math.PI) * tH * 0.6;
        const dz = z1 - z0, dy = y1 - y0;
        const len = Math.sqrt(dz * dz + dy * dy);
        const seg = MeshBuilder.CreateBox(`${parent.name}-lent-top-${side}-${i}`, { width: 0.14, height: 0.14, depth: len + 0.01 }, scene);
        seg.position.set(s * sx, (y0 + y1) / 2, (z0 + z1) / 2);
        seg.rotation.x = -Math.atan2(dy, dz);
        seg.material = railMat;
        registerMesh(seg, renderMeshes, physicsMeshes, false).parent = parent;
      }
    }
  } else if (def?.type === 'bowstring') {
    // Fort Pitt / Fort Duquesne: single big arch
    const archH = 3.5;
    for (const [side, s] of [['l', -1], ['r', 1]]) {
      const hs = GRID_SIZE * 0.44;
      for (let i = 0; i < 10; i++) {
        const t0 = i / 10, t1 = (i + 1) / 10;
        const z0 = -hs + t0 * hs * 2, z1 = -hs + t1 * hs * 2;
        const y0 = deckTop + Math.sin(t0 * Math.PI) * archH;
        const y1 = deckTop + Math.sin(t1 * Math.PI) * archH;
        const dz = z1 - z0, dy = y1 - y0;
        const len = Math.sqrt(dz * dz + dy * dy);
        const seg = MeshBuilder.CreateBox(`${parent.name}-bow-${side}-${i}`, { width: 0.2, height: 0.2, depth: len + 0.01 }, scene);
        seg.position.set(s * sx, (y0 + y1) / 2, (z0 + z1) / 2);
        seg.rotation.x = -Math.atan2(dy, dz);
        seg.material = railMat;
        registerMesh(seg, renderMeshes, physicsMeshes, false).parent = parent;
      }
    }
  }

  // Apply per-bridge deck scale
  const ds = def?.deckScale || 1;
  if (ds !== 1) parent.scaling.z = ds;
}

function buildBridgeRamp(scene, materials, parent, renderMeshes, physicsMeshes, direction) {
  // 2-cell ramp (matches builder footprint [[0,0],[0,1]])
  // Spans from z=-HALF (start of cell 0) to z=GRID_SIZE+HALF (end of cell 1)
  // 'up' rises from ground at z=-HALF to PGH_ELEV at z=GRID_SIZE+HALF
  // 'down' descends from PGH_ELEV at z=-HALF to ground at z=GRID_SIZE+HALF
  const PGH_ELEV = GRID_SIZE * 0.7;
  const TOTAL_LEN = GRID_SIZE * 2;
  const steps = 16;
  const stepLen = TOTAL_LEN / steps;
  const accentMat = direction === 'up' ? materials.accentGreen : materials.accentRed;
  const chevronMat = direction === 'up' ? materials.chevronGreen : materials.chevronRed;

  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    const stepElev = direction === 'up' ? t * PGH_ELEV : (1 - t) * PGH_ELEV;
    const stepY = DECK_HEIGHT / 2 + stepElev;
    const z = -HALF + (i + 0.5) * stepLen;

    const tColor = direction === 'up' ? t : (1 - t);
    const stepMat = tColor > 0.5 ? materials.asphaltWarm : materials.asphaltDark;
    const slab = createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-step-${i}`, ROAD_WIDTH, stepLen + 0.04, stepMat, stepY);
    slab.position.z = z;
    slab.parent = parent;

    for (const [side, s] of [['l', -1], ['r', 1]]) {
      const c = MeshBuilder.CreateBox(`${parent.name}-curb-${i}-${side}`, { width: CURB_WIDTH, height: DECK_HEIGHT * 0.85, depth: stepLen + 0.04 }, scene);
      c.position.set(s * (ROAD_WIDTH + CURB_WIDTH) / 2, stepY + DECK_HEIGHT * 0.425 - DECK_HEIGHT / 2, z);
      c.material = materials.curb;
      registerMesh(c, renderMeshes, physicsMeshes, true).parent = parent;
    }

    if (stepElev > 0.5) {
      for (const [side, s] of [['l', -1], ['r', 1]]) {
        const wall = MeshBuilder.CreateBox(`${parent.name}-wall-${i}-${side}`, { width: 0.25, height: stepElev, depth: stepLen + 0.04 }, scene);
        wall.position.set(s * (ROAD_WIDTH / 2 + CURB_WIDTH + 0.2), stepElev / 2, z);
        wall.material = materials.support;
        registerMesh(wall, renderMeshes, physicsMeshes, false).parent = parent;
      }
    }
  }

  // Guardrails along full 2-cell length
  for (const [side, s] of [['l', -1], ['r', 1]]) {
    const rail = MeshBuilder.CreateBox(`${parent.name}-rail-${side}`, { width: 0.14, height: 0.55, depth: TOTAL_LEN }, scene);
    rail.position.set(s * (ROAD_WIDTH / 2 + CURB_WIDTH + 0.08), PGH_ELEV / 2 + DECK_HEIGHT + 0.275, HALF);
    rail.material = materials.accentGold;
    registerMesh(rail, renderMeshes, physicsMeshes, false).parent = parent;
  }

  // Support pillars at quarter and three-quarter points
  for (const frac of [0.25, 0.75]) {
    const qz = -HALF + frac * TOTAL_LEN;
    const pillarH = (direction === 'up' ? frac : (1 - frac)) * PGH_ELEV;
    if (pillarH > 0.5) {
      for (const x of [-(ROAD_WIDTH / 2 - 0.5), (ROAD_WIDTH / 2 - 0.5)]) {
        createSupportPillar(scene, materials, renderMeshes, physicsMeshes, `${parent.name}-pillar-${x > 0 ? 'r' : 'l'}-${frac}`, x, qz, pillarH).parent = parent;
      }
    }
  }

  // Direction chevrons along the ramp
  for (let i = 0; i < 3; i++) {
    const t = (i + 1) / 4;
    const cz = -HALF + t * TOTAL_LEN;
    const cy = (direction === 'up' ? t : (1 - t)) * PGH_ELEV + DECK_HEIGHT;
    const chev = createChevron(scene, renderMeshes, `${parent.name}-chevron-${i}`, 0, cz, chevronMat, 0);
    chev.position.y = cy;
    chev.parent = parent;
  }
  createEdgeBeacon(scene, renderMeshes, `${parent.name}-beacon-a`, 0, -HALF + 0.7, accentMat).parent = parent;
  createEdgeBeacon(scene, renderMeshes, `${parent.name}-beacon-b`, 0, GRID_SIZE + HALF - 0.7, accentMat).parent = parent;
}

export async function buildCustomArenaSegmentVisual(scene, type, segmentId = 'segment') {
  const spec = resolveCustomArenaSegmentSpec(type);
  if (!spec) return null;

  const key = spec.canonicalKey;
  const dims = getFallbackSegmentFootprint(key, GRID_SIZE);

  /* ── GLB-first: try loading the same model the builder uses ── */
  if (SEGMENT_GLB_MAP[key]) {
    const glbResult = await loadSegmentGLB(scene, key, segmentId);
    if (glbResult) {
      if (spec.mirrorX) {
        glbResult.visual.scaling.x *= -1;
      }
      return {
        visual: glbResult.visual,
        renderMeshes: glbResult.renderMeshes,
        physicsMeshes: glbResult.physicsMeshes,
        bounds: new Vector3(dims.width, Math.max(dims.height, 1.35), dims.length),
        anchorMeta: {
          scale: 1,
          portAnchors: createFallbackPortAnchors(key, dims.width, dims.length, DECK_HEIGHT * 0.5),
        },
      };
    }
  }

  /* ── Procedural fallback ── */
  const wrapper = new TransformNode(`custom-segment-proc-${segmentId}`, scene);
  const renderMeshes = [];
  const physicsMeshes = [];
  const materials = getSceneMaterials(scene);

  if (key === 'wide') {
    buildWidePad(scene, materials, wrapper, renderMeshes, physicsMeshes);
  } else if (key === 't-junction') {
    buildTJunction(scene, materials, wrapper, renderMeshes, physicsMeshes);
  } else if (key === 'crossroads') {
    buildCrossroads(scene, materials, wrapper, renderMeshes, physicsMeshes);
  } else if (key === 'ramp-up') {
    buildRampUp(scene, materials, wrapper, renderMeshes, physicsMeshes);
  } else if (key === 'ramp-down') {
    buildRampDown(scene, materials, wrapper, renderMeshes, physicsMeshes);
  } else if (key === 'bridge') {
    buildBridge(scene, materials, wrapper, renderMeshes, physicsMeshes);
  } else if (key === 'bridge-onramp') {
    buildBridgeRamp(scene, materials, wrapper, renderMeshes, physicsMeshes, 'up');
  } else if (key === 'bridge-offramp') {
    buildBridgeRamp(scene, materials, wrapper, renderMeshes, physicsMeshes, 'down');
  } else if (key === 'jump') {
    buildJump(scene, materials, wrapper, renderMeshes, physicsMeshes);
  } else if (key === 'tunnel') {
    buildTunnel(scene, materials, wrapper, renderMeshes, physicsMeshes);
  } else if (key === 'banked-turn') {
    buildBankedTurn(scene, materials, wrapper, renderMeshes, physicsMeshes);
  } else if (key === 'chicane') {
    buildChicane(scene, materials, wrapper, renderMeshes, physicsMeshes);
  } else if (key === 'corner-small') {
    buildCornerBase(scene, materials, wrapper, renderMeshes, physicsMeshes, materials.asphalt, materials.accentBlue);
  } else if (key === 'corner-large') {
    buildCornerBase(scene, materials, wrapper, renderMeshes, physicsMeshes, materials.asphaltWarm, materials.accentGold);
    wrapper.scaling.scaleInPlace(0.985);
  } else if (key === 'curve') {
    buildCornerBase(scene, materials, wrapper, renderMeshes, physicsMeshes, materials.asphaltDark, materials.accentGreen);
  } else if (key === 'corner-small-ramp') {
    buildCornerBase(scene, materials, wrapper, renderMeshes, physicsMeshes, materials.asphaltDark, materials.accentGreen);
    createSupportPillar(scene, materials, renderMeshes, physicsMeshes, `${wrapper.name}-pillar`, 2.2, -2.2, 1.05).parent = wrapper;
    createChevron(scene, renderMeshes, `${wrapper.name}-ramp-chevron`, 2.1, -2.1, materials.chevronGreen, Math.PI / 4).parent = wrapper;
  } else if (key === 'corner-large-ramp') {
    buildCornerBase(scene, materials, wrapper, renderMeshes, physicsMeshes, materials.asphaltWarm, materials.accentGold);
    createSupportPillar(scene, materials, renderMeshes, physicsMeshes, `${wrapper.name}-pillar`, 2.25, -2.25, 1.35).parent = wrapper;
    createChevron(scene, renderMeshes, `${wrapper.name}-ramp-chevron`, 2.1, -2.1, materials.chevronGold, Math.PI / 4).parent = wrapper;
  } else if (key === 'cap-front' || key === 'cap-back' || key === 'end') {
    buildCap(scene, materials, wrapper, renderMeshes, physicsMeshes, key === 'cap-back' ? 'back' : key === 'end' ? 'end' : 'front');
  } else if (PGH_BRIDGE_DEFS[key]) {
    // Pittsburgh bridge themed pieces — full superstructure
    buildPghBridge(scene, materials, wrapper, renderMeshes, physicsMeshes, key);
  } else if (key === 'bump-up' || key === 'bump-down') {
    buildBump(scene, materials, wrapper, renderMeshes, physicsMeshes, key === 'bump-up' ? 'up' : 'down');
  } else if (key.startsWith('hill-')) {
    buildHill(scene, materials, wrapper, renderMeshes, physicsMeshes, key);
  } else if (key === 'bend' || key === 'bend-large') {
    buildBend(scene, materials, wrapper, renderMeshes, physicsMeshes, key === 'bend-large');
  } else if (key.startsWith('skew-')) {
    buildSkew(scene, materials, wrapper, renderMeshes, physicsMeshes, key);
  } else {
    const deckMaterial = key.startsWith('hill')
      ? materials.asphaltWarm
      : key.startsWith('skew')
        ? materials.asphaltDark
        : materials.asphalt;
    buildStraightBase(scene, materials, wrapper, renderMeshes, physicsMeshes, deckMaterial, materials.accentGreen);
    decorateStraightVariant(scene, materials, wrapper, renderMeshes, physicsMeshes, key);
  }

  if (spec.mirrorX) {
    wrapper.scaling.x *= -1;
  }

  const portAnchors = createFallbackPortAnchors(key, dims.width, dims.length, DECK_HEIGHT * 0.5);

  return {
    visual: wrapper,
    renderMeshes,
    physicsMeshes,
    bounds: new Vector3(dims.width, Math.max(dims.height, 1.35), dims.length),
    anchorMeta: {
      scale: 1,
      portAnchors,
    },
  };
}
