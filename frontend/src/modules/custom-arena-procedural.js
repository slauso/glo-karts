import {
  Color3,
  MeshBuilder,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { GRID_SIZE } from './track-placement.js';
import { resolveCustomArenaSegmentSpec, getFallbackSegmentFootprint } from './custom-arena-segments.js';
import { createFallbackPortAnchors } from './custom-arena-anchors.js';

const HALF = GRID_SIZE / 2;
const DECK_HEIGHT = 0.34;
const ROAD_WIDTH = GRID_SIZE * 0.46;
const CURB_WIDTH = 0.36;
const HALF_STRAIGHT = GRID_SIZE * 0.56;
const CAP_LENGTH = GRID_SIZE * 0.34;

const COLORS = Object.freeze({
  asphalt: new Color3(0.368, 0.412, 0.486),
  asphaltDark: new Color3(0.325, 0.376, 0.455),
  asphaltWarm: new Color3(0.408, 0.455, 0.533),
  curb: new Color3(0.831, 0.431, 0.263),
  stripe: new Color3(0.875, 0.906, 0.945),
  accentBlue: new Color3(0.388, 0.706, 1),
  accentGold: new Color3(1, 0.753, 0.388),
  accentGreen: new Color3(0.294, 0.824, 0.592),
  accentRed: new Color3(1, 0.49, 0.4),
  support: new Color3(0.204, 0.255, 0.333),
  underlay: new Color3(0.176, 0.224, 0.298),
});

const MATERIAL_CACHE = new WeakMap();

function getSceneMaterials(scene) {
  let materials = MATERIAL_CACHE.get(scene);
  if (materials) return materials;

  const make = (name, diffuse, emissive = null, alpha = 1) => {
    const material = new StandardMaterial(name, scene);
    material.diffuseColor = diffuse;
    material.specularColor = new Color3(0.05, 0.06, 0.08);
    material.emissiveColor = emissive || Color3.Black();
    material.alpha = alpha;
    return material;
  };

  materials = {
    asphalt: make('arena-proc-asphalt', COLORS.asphalt),
    asphaltDark: make('arena-proc-asphalt-dark', COLORS.asphaltDark),
    asphaltWarm: make('arena-proc-asphalt-warm', COLORS.asphaltWarm),
    curb: make('arena-proc-curb', COLORS.curb),
    stripe: make('arena-proc-stripe', COLORS.stripe, COLORS.stripe.scale(0.08), 0.62),
    accentBlue: make('arena-proc-accent-blue', COLORS.accentBlue, COLORS.accentBlue.scale(0.12)),
    accentGold: make('arena-proc-accent-gold', COLORS.accentGold, COLORS.accentGold.scale(0.12)),
    accentGreen: make('arena-proc-accent-green', COLORS.accentGreen, COLORS.accentGreen.scale(0.12)),
    accentRed: make('arena-proc-accent-red', COLORS.accentRed, COLORS.accentRed.scale(0.12)),
    support: make('arena-proc-support', COLORS.support),
    underlay: make('arena-proc-underlay', COLORS.underlay),
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

function createDeck(scene, renderMeshes, physicsMeshes, name, width, length, material, y = DECK_HEIGHT / 2) {
  const mesh = MeshBuilder.CreateBox(name, { width, height: DECK_HEIGHT, depth: length }, scene);
  mesh.position.y = y;
  mesh.material = material;
  return registerMesh(mesh, renderMeshes, physicsMeshes, true);
}

function createCurb(scene, materials, renderMeshes, physicsMeshes, name, length, x) {
  const curb = MeshBuilder.CreateBox(name, { width: CURB_WIDTH, height: DECK_HEIGHT * 0.85, depth: length }, scene);
  curb.position.set(x, DECK_HEIGHT * 0.425, 0);
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
  createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-base`, GRID_SIZE, GRID_SIZE, materials.asphaltWarm).parent = parent;
  createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-cross-a`, ROAD_WIDTH, GRID_SIZE, materials.asphaltDark, DECK_HEIGHT / 2 + 0.01).parent = parent;
  createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-cross-b`, GRID_SIZE, ROAD_WIDTH, materials.asphaltDark, DECK_HEIGHT / 2 + 0.01).parent = parent;
  createLaneStripe(scene, materials, renderMeshes, `${parent.name}-stripe-a`, GRID_SIZE * 0.78).parent = parent;
  createLaneStripe(scene, materials, renderMeshes, `${parent.name}-stripe-b`, GRID_SIZE * 0.78, Math.PI / 2).parent = parent;
  createEdgeBeacon(scene, renderMeshes, `${parent.name}-beacon-n`, 0, -HALF + 0.8, materials.accentBlue).parent = parent;
  createEdgeBeacon(scene, renderMeshes, `${parent.name}-beacon-e`, HALF - 0.8, 0, materials.accentBlue).parent = parent;
  createEdgeBeacon(scene, renderMeshes, `${parent.name}-beacon-s`, 0, HALF - 0.8, materials.accentBlue).parent = parent;
  createEdgeBeacon(scene, renderMeshes, `${parent.name}-beacon-w`, -HALF + 0.8, 0, materials.accentBlue).parent = parent;
}

function buildCornerBase(scene, materials, parent, renderMeshes, physicsMeshes, deckMaterial, accentMaterial) {
  const legOffset = HALF_STRAIGHT / 2 - HALF / 2;
  createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-underlay`, GRID_SIZE, GRID_SIZE, materials.underlay, 0.04).parent = parent;

  const northLeg = createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-north-leg`, ROAD_WIDTH, HALF_STRAIGHT, deckMaterial);
  northLeg.position.z = -legOffset;
  northLeg.parent = parent;

  const northLeft = createCurb(scene, materials, renderMeshes, physicsMeshes, `${parent.name}-north-left`, HALF_STRAIGHT, -(ROAD_WIDTH + CURB_WIDTH) / 2);
  northLeft.position.z = -legOffset;
  northLeft.parent = parent;

  const northRight = createCurb(scene, materials, renderMeshes, physicsMeshes, `${parent.name}-north-right`, HALF_STRAIGHT, (ROAD_WIDTH + CURB_WIDTH) / 2);
  northRight.position.z = -legOffset;
  northRight.parent = parent;

  const eastLeg = createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-east-leg`, HALF_STRAIGHT, ROAD_WIDTH, deckMaterial);
  eastLeg.position.x = legOffset;
  eastLeg.parent = parent;

  const eastTop = MeshBuilder.CreateBox(`${parent.name}-east-top`, { width: HALF_STRAIGHT, height: DECK_HEIGHT * 0.85, depth: CURB_WIDTH }, scene);
  eastTop.position.set(legOffset, DECK_HEIGHT * 0.425, -(ROAD_WIDTH + CURB_WIDTH) / 2);
  eastTop.material = materials.curb;
  registerMesh(eastTop, renderMeshes, physicsMeshes, true).parent = parent;

  const eastBottom = MeshBuilder.CreateBox(`${parent.name}-east-bottom`, { width: HALF_STRAIGHT, height: DECK_HEIGHT * 0.85, depth: CURB_WIDTH }, scene);
  eastBottom.position.set(legOffset, DECK_HEIGHT * 0.425, (ROAD_WIDTH + CURB_WIDTH) / 2);
  eastBottom.material = materials.curb;
  registerMesh(eastBottom, renderMeshes, physicsMeshes, true).parent = parent;

  const patch = createDeck(scene, renderMeshes, physicsMeshes, `${parent.name}-patch`, ROAD_WIDTH, ROAD_WIDTH, deckMaterial, DECK_HEIGHT / 2 + 0.01);
  patch.position.set(HALF / 2 - ROAD_WIDTH / 2, DECK_HEIGHT / 2 + 0.01, -HALF / 2 + ROAD_WIDTH / 2);
  patch.parent = parent;

  createLaneStripe(scene, materials, renderMeshes, `${parent.name}-north-stripe`, HALF_STRAIGHT * 0.72, 0, 0, -legOffset).parent = parent;
  createLaneStripe(scene, materials, renderMeshes, `${parent.name}-east-stripe`, HALF_STRAIGHT * 0.72, Math.PI / 2, legOffset, 0).parent = parent;
  createChevron(scene, renderMeshes, `${parent.name}-chevron`, 1.9, -2.2, accentMaterial, Math.PI / 4).parent = parent;
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

  createChevron(scene, renderMeshes, `${parent.name}-chevron`, 0, z, direction === 'back' ? materials.accentRed : materials.accentGold, 0).parent = parent;
}

function decorateStraightVariant(scene, materials, parent, renderMeshes, physicsMeshes, key) {
  if (key === 'straight') {
    createChevron(scene, renderMeshes, `${parent.name}-chevron-a`, 0, -1.5, materials.accentBlue, 0).parent = parent;
    createChevron(scene, renderMeshes, `${parent.name}-chevron-b`, 0, 1.5, materials.accentBlue, 0).parent = parent;
    return;
  }

  if (key === 'bend' || key === 'bend-large') {
    createChevron(scene, renderMeshes, `${parent.name}-chevron-a`, -0.8, -2.1, materials.accentGold, 0.35).parent = parent;
    createChevron(scene, renderMeshes, `${parent.name}-chevron-b`, 0.8, 0.2, materials.accentGold, -0.35).parent = parent;
    createChevron(scene, renderMeshes, `${parent.name}-chevron-c`, -0.8, 2.2, materials.accentGold, 0.35).parent = parent;
    return;
  }

  if (key.startsWith('skew')) {
    const dir = key.includes('right') ? 1 : -1;
    createChevron(scene, renderMeshes, `${parent.name}-chevron-a`, dir * 1.15, -2.4, materials.accentBlue, dir * 0.4).parent = parent;
    createChevron(scene, renderMeshes, `${parent.name}-chevron-b`, 0, 0, materials.accentBlue, dir * 0.4).parent = parent;
    createChevron(scene, renderMeshes, `${parent.name}-chevron-c`, -dir * 1.15, 2.4, materials.accentBlue, dir * 0.4).parent = parent;
    return;
  }

  if (key === 'bump-up' || key === 'bump-down') {
    const accent = key === 'bump-up' ? materials.accentGreen : materials.accentRed;
    createChevron(scene, renderMeshes, `${parent.name}-chevron-a`, 0, -2, accent, 0).parent = parent;
    createChevron(scene, renderMeshes, `${parent.name}-chevron-b`, 0, 0, accent, 0).parent = parent;
    createChevron(scene, renderMeshes, `${parent.name}-chevron-c`, 0, 2, accent, 0).parent = parent;
    return;
  }

  if (key === 'hill-beginning' || key === 'hill-end' || key === 'hill-complete' || key === 'hill-complete-half') {
    const accent = key === 'hill-end' ? materials.accentRed : materials.accentGreen;
    createSupportPillar(scene, materials, renderMeshes, physicsMeshes, `${parent.name}-pillar-a`, -1.5, -1.8, 1.1).parent = parent;
    createSupportPillar(scene, materials, renderMeshes, physicsMeshes, `${parent.name}-pillar-b`, 1.5, 1.8, key === 'hill-complete-half' ? 0.8 : 1.35).parent = parent;
    createChevron(scene, renderMeshes, `${parent.name}-chevron-a`, 0, -2.3, accent, 0).parent = parent;
    createChevron(scene, renderMeshes, `${parent.name}-chevron-b`, 0, 0, accent, 0).parent = parent;
    createChevron(scene, renderMeshes, `${parent.name}-chevron-c`, 0, 2.3, accent, 0).parent = parent;
  }
}

export function buildCustomArenaSegmentVisual(scene, type, segmentId = 'segment') {
  const spec = resolveCustomArenaSegmentSpec(type);
  if (!spec) return null;

  const wrapper = new TransformNode(`custom-segment-proc-${segmentId}`, scene);
  const renderMeshes = [];
  const physicsMeshes = [];
  const materials = getSceneMaterials(scene);
  const key = spec.canonicalKey;

  if (key === 'wide') {
    buildWidePad(scene, materials, wrapper, renderMeshes, physicsMeshes);
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
    createChevron(scene, renderMeshes, `${wrapper.name}-ramp-chevron`, 2.1, -2.1, materials.accentGreen, Math.PI / 4).parent = wrapper;
  } else if (key === 'corner-large-ramp') {
    buildCornerBase(scene, materials, wrapper, renderMeshes, physicsMeshes, materials.asphaltWarm, materials.accentGold);
    createSupportPillar(scene, materials, renderMeshes, physicsMeshes, `${wrapper.name}-pillar`, 2.25, -2.25, 1.35).parent = wrapper;
    createChevron(scene, renderMeshes, `${wrapper.name}-ramp-chevron`, 2.1, -2.1, materials.accentGold, Math.PI / 4).parent = wrapper;
  } else if (key === 'cap-front' || key === 'cap-back' || key === 'end') {
    buildCap(scene, materials, wrapper, renderMeshes, physicsMeshes, key === 'cap-back' ? 'back' : key === 'end' ? 'end' : 'front');
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

  const dims = getFallbackSegmentFootprint(key, GRID_SIZE);
  return {
    visual: wrapper,
    renderMeshes,
    physicsMeshes,
    bounds: new Vector3(dims.width, Math.max(dims.height, 1.35), dims.length),
    anchorMeta: {
      scale: 1,
      portAnchors: createFallbackPortAnchors(key, dims.width, dims.length, DECK_HEIGHT * 0.5),
    },
  };
}