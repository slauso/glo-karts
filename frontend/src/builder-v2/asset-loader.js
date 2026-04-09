/**
 * asset-loader.js - Builder-native road tiles for consistent grid placement.
 *
 * The runtime still uses authored GLBs, but the builder now uses a strict tile
 * kit so every segment obeys the same snap contract and preview footprint.
 */
import * as THREE from 'three';
import { GRID_SIZE } from '../modules/track-placement.js';
import { createFallbackPortAnchors } from '../modules/custom-arena-anchors.js';

const templateCache = new Map();
const metaCache = new Map();
let thumbnailRenderer = null;
let thumbnailQueue = Promise.resolve();

const thumbnailScene = new THREE.Scene();
thumbnailScene.background = new THREE.Color(0x182334);
thumbnailScene.add(new THREE.AmbientLight(0xffffff, 1.1));

const thumbnailLight = new THREE.DirectionalLight(0xffffff, 1.4);
thumbnailLight.position.set(5, 8, 6);
thumbnailScene.add(thumbnailLight);

const thumbnailCamera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);

const HALF = GRID_SIZE / 2;
const DECK_HEIGHT = 0.34;
const ROAD_WIDTH = GRID_SIZE * 0.46;
const CURB_WIDTH = 0.36;
const SHOULDER_WIDTH = ROAD_WIDTH + CURB_WIDTH * 2;
const HALF_STRAIGHT = GRID_SIZE * 0.56;
const CAP_LENGTH = GRID_SIZE * 0.34;

const COLORS = Object.freeze({
  asphalt: 0x5e697c,
  asphaltDark: 0x536074,
  asphaltWarm: 0x687488,
  curb: 0xd46e43,
  stripe: 0xdfe7f1,
  edge: 0xa8b4c3,
  accentBlue: 0x63b4ff,
  accentGold: 0xffc063,
  accentGreen: 0x4bd297,
  accentRed: 0xff7d66,
});

export const TRACK_ASSETS = [
  { key: 'straight', file: 'track-road-wide-straight.glb', label: 'Straight' },
  { key: 'corner-large', file: 'track-road-wide-corner-large.glb', label: 'Corner L' },
  { key: 'corner-small', file: 'track-road-wide-corner-small.glb', label: 'Corner S' },
  { key: 'corner-large-ramp', file: 'track-road-wide-corner-large-ramp.glb', label: 'Corner L Ramp' },
  { key: 'corner-small-ramp', file: 'track-road-wide-corner-small-ramp.glb', label: 'Corner S Ramp' },
  { key: 'curve', file: 'track-road-wide-curve.glb', label: 'Curve' },
  { key: 'bend', file: 'track-road-wide-straight-bend.glb', label: 'Bend' },
  { key: 'bend-large', file: 'track-road-wide-straight-bend-large.glb', label: 'Bend Large' },
  { key: 'bump-up', file: 'track-road-wide-straight-bump-up.glb', label: 'Bump Up' },
  { key: 'bump-down', file: 'track-road-wide-straight-bump-down.glb', label: 'Bump Down' },
  { key: 'hill-beginning', file: 'track-road-wide-straight-hill-beginning.glb', label: 'Hill Start' },
  { key: 'hill-end', file: 'track-road-wide-straight-hill-end.glb', label: 'Hill End' },
  { key: 'hill-complete', file: 'track-road-wide-straight-hill-complete.glb', label: 'Hill Full' },
  { key: 'hill-complete-half', file: 'track-road-wide-straight-hill-complete-half.glb', label: 'Hill Half' },
  { key: 'skew-left', file: 'track-road-wide-straight-skew-left.glb', label: 'Skew Left' },
  { key: 'skew-right', file: 'track-road-wide-straight-skew-right.glb', label: 'Skew Right' },
  { key: 'skew-left-side', file: 'track-road-wide-straight-skew-left-side.glb', label: 'Skew L Side' },
  { key: 'skew-right-side', file: 'track-road-wide-straight-skew-right-side.glb', label: 'Skew R Side' },
  { key: 'cap-front', file: 'track-road-wide-cap-front.glb', label: 'Cap Front' },
  { key: 'cap-back', file: 'track-road-wide-cap-back.glb', label: 'Cap Back' },
  { key: 'wide', file: 'track-road-wide.glb', label: 'Wide Pad' },
  { key: 'end', file: 'track-end.glb', label: 'End' },
];

function getThumbnailRenderer() {
  if (!thumbnailRenderer) {
    thumbnailRenderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
  }
  return thumbnailRenderer;
}

function makeStandardMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.92,
    metalness: 0.04,
  });
}

function finalizeMesh(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createDeck(width, length, color = COLORS.asphalt, y = DECK_HEIGHT / 2) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, DECK_HEIGHT, length),
    makeStandardMaterial(color),
  );
  mesh.position.y = y;
  return finalizeMesh(mesh);
}

function createCurb(length, x) {
  const curb = new THREE.Mesh(
    new THREE.BoxGeometry(CURB_WIDTH, DECK_HEIGHT * 0.85, length),
    makeStandardMaterial(COLORS.curb),
  );
  curb.position.set(x, DECK_HEIGHT * 0.425, 0);
  return finalizeMesh(curb);
}

function createLaneStripe(length, rotationY = 0, x = 0, z = 0, color = COLORS.stripe) {
  const stripe = new THREE.Mesh(
    new THREE.PlaneGeometry(0.18, length),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
    }),
  );
  stripe.rotation.x = -Math.PI / 2;
  stripe.rotation.z = rotationY;
  stripe.position.set(x, DECK_HEIGHT + 0.01, z);
  return stripe;
}

function createEdgeBeacon(x, z, color = COLORS.accentBlue) {
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.14, 0.3, 10),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.18,
      roughness: 0.55,
    }),
  );
  beacon.position.set(x, DECK_HEIGHT + 0.18, z);
  return finalizeMesh(beacon);
}

function createChevron(x, z, color = COLORS.accentGold, rotationY = 0) {
  const chevron = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.08, 0.24),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.1,
      roughness: 0.72,
    }),
  );
  chevron.position.set(x, DECK_HEIGHT + 0.05, z);
  chevron.rotation.y = rotationY;
  return finalizeMesh(chevron);
}

function createSupportPillar(x, z, height = 0.8) {
  const pillar = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, height, 0.45),
    makeStandardMaterial(0x344155),
  );
  pillar.position.set(x, height / 2 - 0.02, z);
  return finalizeMesh(pillar);
}

function buildStraightBase(color = COLORS.asphalt) {
  const group = new THREE.Group();
  group.add(createDeck(ROAD_WIDTH, GRID_SIZE, color));
  group.add(createCurb(GRID_SIZE, -(ROAD_WIDTH + CURB_WIDTH) / 2));
  group.add(createCurb(GRID_SIZE, (ROAD_WIDTH + CURB_WIDTH) / 2));
  group.add(createLaneStripe(GRID_SIZE * 0.76));
  group.add(createEdgeBeacon(0, -HALF + 0.7, COLORS.accentGreen));
  group.add(createEdgeBeacon(0, HALF - 0.7, COLORS.accentGreen));
  return group;
}

function buildWidePad() {
  const group = new THREE.Group();
  group.add(createDeck(GRID_SIZE, GRID_SIZE, COLORS.asphaltWarm));
  group.add(createDeck(ROAD_WIDTH, GRID_SIZE, COLORS.asphaltDark, DECK_HEIGHT / 2 + 0.01));
  group.add(createDeck(GRID_SIZE, ROAD_WIDTH, COLORS.asphaltDark, DECK_HEIGHT / 2 + 0.01));
  group.add(createLaneStripe(GRID_SIZE * 0.78));
  group.add(createLaneStripe(GRID_SIZE * 0.78, Math.PI / 2));
  group.add(createEdgeBeacon(0, -HALF + 0.8));
  group.add(createEdgeBeacon(HALF - 0.8, 0));
  group.add(createEdgeBeacon(0, HALF - 0.8));
  group.add(createEdgeBeacon(-HALF + 0.8, 0));
  return group;
}

function buildCornerBase(color = COLORS.asphalt, accentColor = COLORS.accentBlue) {
  const group = new THREE.Group();
  const legOffset = HALF_STRAIGHT / 2 - HALF / 2;
  group.add(createDeck(GRID_SIZE, GRID_SIZE, 0x2d394c, 0.04));

  const northLeg = createDeck(ROAD_WIDTH, HALF_STRAIGHT, color);
  northLeg.position.z = -legOffset;
  group.add(northLeg);

  const northLeft = createCurb(HALF_STRAIGHT, -(ROAD_WIDTH + CURB_WIDTH) / 2);
  northLeft.position.z = -legOffset;
  group.add(northLeft);
  const northRight = createCurb(HALF_STRAIGHT, (ROAD_WIDTH + CURB_WIDTH) / 2);
  northRight.position.z = -legOffset;
  group.add(northRight);

  const eastLeg = createDeck(HALF_STRAIGHT, ROAD_WIDTH, color);
  eastLeg.position.x = legOffset;
  group.add(eastLeg);
  const eastTop = new THREE.Mesh(
    new THREE.BoxGeometry(HALF_STRAIGHT, DECK_HEIGHT * 0.85, CURB_WIDTH),
    makeStandardMaterial(COLORS.curb),
  );
  eastTop.position.set(legOffset, DECK_HEIGHT * 0.425, -(ROAD_WIDTH + CURB_WIDTH) / 2);
  group.add(finalizeMesh(eastTop));
  const eastBottom = eastTop.clone();
  eastBottom.position.z = (ROAD_WIDTH + CURB_WIDTH) / 2;
  eastBottom.material = eastBottom.material.clone();
  group.add(finalizeMesh(eastBottom));

  const patch = createDeck(ROAD_WIDTH, ROAD_WIDTH, color, DECK_HEIGHT / 2 + 0.01);
  patch.position.set(HALF / 2 - ROAD_WIDTH / 2, 0, -HALF / 2 + ROAD_WIDTH / 2);
  group.add(patch);

  group.add(createLaneStripe(HALF_STRAIGHT * 0.72, 0, 0, -legOffset));
  group.add(createLaneStripe(HALF_STRAIGHT * 0.72, Math.PI / 2, legOffset, 0));
  group.add(createChevron(1.9, -2.2, accentColor, Math.PI / 4));
  group.add(createEdgeBeacon(0, -HALF + 0.7, accentColor));
  group.add(createEdgeBeacon(HALF - 0.7, 0, accentColor));
  return group;
}

function buildCap(direction = 'front') {
  const group = new THREE.Group();
  const deck = createDeck(ROAD_WIDTH, CAP_LENGTH, COLORS.asphaltDark);
  const left = createCurb(CAP_LENGTH, -(ROAD_WIDTH + CURB_WIDTH) / 2);
  const right = createCurb(CAP_LENGTH, (ROAD_WIDTH + CURB_WIDTH) / 2);
  const stripe = createLaneStripe(CAP_LENGTH * 0.7);
  let z = 0;
  if (direction === 'front' || direction === 'end') z = -HALF + CAP_LENGTH / 2;
  if (direction === 'back') z = HALF - CAP_LENGTH / 2;
  deck.position.z = z;
  left.position.z = z;
  right.position.z = z;
  stripe.position.z = z;
  group.add(deck, left, right, stripe);
  group.add(createChevron(0, z, direction === 'back' ? COLORS.accentRed : COLORS.accentGold));
  return group;
}

function decorateStraightVariant(group, key) {
  if (key === 'straight') {
    group.add(createChevron(0, -1.5, COLORS.accentBlue, 0));
    group.add(createChevron(0, 1.5, COLORS.accentBlue, 0));
    return;
  }

  if (key === 'bend' || key === 'bend-large') {
    group.add(createChevron(-0.8, -2.1, COLORS.accentGold, 0.35));
    group.add(createChevron(0.8, 0.2, COLORS.accentGold, -0.35));
    group.add(createChevron(-0.8, 2.2, COLORS.accentGold, 0.35));
    return;
  }

  if (key.startsWith('skew')) {
    const dir = key.includes('right') ? 1 : -1;
    group.add(createChevron(dir * 1.15, -2.4, COLORS.accentBlue, dir * 0.4));
    group.add(createChevron(0, 0, COLORS.accentBlue, dir * 0.4));
    group.add(createChevron(-dir * 1.15, 2.4, COLORS.accentBlue, dir * 0.4));
    return;
  }

  if (key === 'bump-up' || key === 'bump-down') {
    const color = key === 'bump-up' ? COLORS.accentGreen : COLORS.accentRed;
    group.add(createChevron(0, -2, color, 0));
    group.add(createChevron(0, 0, color, 0));
    group.add(createChevron(0, 2, color, 0));
    return;
  }

  if (key === 'hill-beginning' || key === 'hill-end' || key === 'hill-complete' || key === 'hill-complete-half') {
    const color = key === 'hill-end' ? COLORS.accentRed : COLORS.accentGreen;
    group.add(createSupportPillar(-1.5, -1.8, 1.1));
    group.add(createSupportPillar(1.5, 1.8, key === 'hill-complete-half' ? 0.8 : 1.35));
    group.add(createChevron(0, -2.3, color, 0));
    group.add(createChevron(0, 0, color, 0));
    group.add(createChevron(0, 2.3, color, 0));
  }
}

function buildTemplate(key) {
  const wrapper = new THREE.Group();
  wrapper.name = key;

  if (key === 'wide') {
    wrapper.add(buildWidePad());
    return wrapper;
  }

  if (key === 'corner-small') {
    wrapper.add(buildCornerBase(COLORS.asphalt, COLORS.accentBlue));
    return wrapper;
  }

  if (key === 'corner-large') {
    wrapper.add(buildCornerBase(COLORS.asphaltWarm, COLORS.accentGold));
    wrapper.scale.setScalar(0.985);
    return wrapper;
  }

  if (key === 'curve') {
    wrapper.add(buildCornerBase(COLORS.asphaltDark, COLORS.accentGreen));
    return wrapper;
  }

  if (key === 'corner-small-ramp') {
    const group = buildCornerBase(COLORS.asphaltDark, COLORS.accentGreen);
    group.add(createSupportPillar(2.2, -2.2, 1.05));
    group.add(createChevron(2.1, -2.1, COLORS.accentGreen, Math.PI / 4));
    wrapper.add(group);
    return wrapper;
  }

  if (key === 'corner-large-ramp') {
    const group = buildCornerBase(COLORS.asphaltWarm, COLORS.accentGold);
    group.add(createSupportPillar(2.25, -2.25, 1.35));
    group.add(createChevron(2.1, -2.1, COLORS.accentGold, Math.PI / 4));
    wrapper.add(group);
    return wrapper;
  }

  if (key === 'cap-front' || key === 'cap-back' || key === 'end') {
    wrapper.add(buildCap(key === 'cap-back' ? 'back' : key === 'end' ? 'end' : 'front'));
    return wrapper;
  }

  const straight = buildStraightBase(
    key.startsWith('hill') ? COLORS.asphaltWarm : key.startsWith('skew') ? COLORS.asphaltDark : COLORS.asphalt,
  );
  decorateStraightVariant(straight, key);
  wrapper.add(straight);
  return wrapper;
}

function buildMeta(key, template) {
  const bbox = new THREE.Box3().setFromObject(template);
  const size = bbox.getSize(new THREE.Vector3());
  const center = bbox.getCenter(new THREE.Vector3());
  return {
    size,
    center,
    min: bbox.min.clone(),
    max: bbox.max.clone(),
    scale: 1,
    width: size.x,
    length: size.z,
    portAnchors: createFallbackPortAnchors(key, GRID_SIZE, GRID_SIZE, DECK_HEIGHT * 0.5),
  };
}

function cloneModel(template) {
  const clone = template.clone(true);
  clone.traverse((child) => {
    if (!child.isMesh) return;
    child.material = Array.isArray(child.material)
      ? child.material.map((material) => material.clone())
      : child.material.clone();
    child.castShadow = true;
    child.receiveShadow = true;
  });
  return clone;
}

function getTemplate(key) {
  if (!TRACK_ASSETS.some((asset) => asset.key === key)) {
    throw new Error(`Unknown asset: ${key}`);
  }

  if (!templateCache.has(key)) {
    const template = buildTemplate(key);
    templateCache.set(key, template);
    metaCache.set(key, buildMeta(key, template));
  }
  return templateCache.get(key);
}

export async function loadModel(key) {
  return cloneModel(getTemplate(key));
}

export function getModelMeta(key) {
  getTemplate(key);
  return metaCache.get(key) || null;
}

export async function preloadAll(onProgress) {
  const total = TRACK_ASSETS.length;
  let loaded = 0;
  for (const asset of TRACK_ASSETS) {
    getTemplate(asset.key);
    loaded += 1;
    onProgress?.(loaded, total);
  }
}

export async function generateThumbnail(key, size = 80) {
  const task = thumbnailQueue.catch(() => {}).then(async () => {
    const model = await loadModel(key);
    const renderer = getThumbnailRenderer();
    renderer.setSize(size, size, false);

    thumbnailScene.add(model);

    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const boxSize = box.getSize(new THREE.Vector3());
    model.position.sub(center);

    const maxDim = Math.max(boxSize.x, boxSize.y, boxSize.z) || 1;
    thumbnailCamera.position.set(maxDim * 0.95, maxDim * 0.75, maxDim * 1.05);
    thumbnailCamera.lookAt(0, 0, 0);
    thumbnailCamera.updateProjectionMatrix();

    renderer.render(thumbnailScene, thumbnailCamera);

    const dataUrl = renderer.domElement.toDataURL();
    thumbnailScene.remove(model);
    return dataUrl;
  });

  thumbnailQueue = task.then(() => undefined, () => undefined);
  return task;
}
