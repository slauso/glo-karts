/**
 * asset-loader.js - Builder-native road tiles for consistent grid placement.
 *
 * The runtime still uses authored GLBs, but the builder now uses a strict tile
 * kit so every segment obeys the same snap contract and preview footprint.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GRID_SIZE } from '../modules/track-placement.js';
import { createFallbackPortAnchors } from '../modules/custom-arena-anchors.js';
import { getSegmentConstants, PALETTE } from '../modules/track-materials.js';
import { PGH_BRIDGE_DEFS } from '../modules/custom-arena-segments.js';

const templateCache = new Map();
const glbCache = new Map();
const glbLoader = new GLTFLoader();
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

const { HALF, DECK_HEIGHT, ROAD_WIDTH, CURB_WIDTH, HALF_STRAIGHT, CAP_LENGTH } = getSegmentConstants(GRID_SIZE);
const SHOULDER_WIDTH = ROAD_WIDTH + CURB_WIDTH * 2;

const COLORS = Object.freeze({
  asphalt: PALETTE.asphalt,
  asphaltDark: PALETTE.asphaltDark,
  asphaltWarm: PALETTE.asphaltWarm,
  curb: PALETTE.curb,
  stripe: PALETTE.stripe,
  edge: PALETTE.edge,
  accentBlue: PALETTE.accentBlue,
  accentGold: PALETTE.accentGold,
  accentGreen: PALETTE.accentGreen,
  accentRed: PALETTE.accentRed,
});

export const TRACK_ASSETS = [
  { key: 'straight', file: 'track-straight.glb', label: 'Straight' },
  { key: 'corner-large', file: 'track-corner.glb', label: 'Corner L' },
  { key: 'corner-small', file: 'track-corner.glb', label: 'Corner S' },
  { key: 'corner-large-ramp', file: 'track-corner.glb', label: 'Corner L Ramp' },
  { key: 'corner-small-ramp', file: 'track-corner.glb', label: 'Corner S Ramp' },
  { key: 'curve', file: 'track-corner.glb', label: 'Curve' },
  { key: 'bend', label: 'Bend' },
  { key: 'bend-large', label: 'Bend Large' },
  { key: 'bump-up', label: 'Bump Up' },
  { key: 'bump-down', label: 'Bump Down' },
  { key: 'hill-beginning', label: 'Hill Start' },
  { key: 'hill-end', label: 'Hill End' },
  { key: 'hill-complete', label: 'Hill Full' },
  { key: 'hill-complete-half', label: 'Hill Half' },
  { key: 'skew-left', label: 'Skew Left' },
  { key: 'skew-right', label: 'Skew Right' },
  { key: 'skew-left-side', label: 'Skew L Side' },
  { key: 'skew-right-side', label: 'Skew R Side' },
  { key: 'cap-front', label: 'Cap Front' },
  { key: 'cap-back', label: 'Cap Back' },
  { key: 'wide', label: 'Wide Pad' },
  { key: 'end', label: 'End' },
  // ── Bridge ramps ───────────────────────────────────────────────
  { key: 'bridge-onramp', label: 'Bridge On-Ramp' },
  { key: 'bridge-offramp', label: 'Bridge Off-Ramp' },
  // ── Pittsburgh Bridge Collection ──────────────────────────────
  { key: 'pgh-clemente', label: 'Roberto Clemente' },
  { key: 'pgh-warhol', label: 'Andy Warhol' },
  { key: 'pgh-carson', label: 'Rachel Carson' },
  { key: 'pgh-fort-pitt', label: 'Fort Pitt' },
  { key: 'pgh-fort-duquesne', label: 'Fort Duquesne' },
  { key: 'pgh-west-end', label: 'West End' },
  { key: 'pgh-veterans', label: 'Veterans' },
  { key: 'pgh-16th-st', label: 'David McCullough' },
  { key: 'pgh-south-10th', label: 'South 10th St' },
  { key: 'pgh-31st-st', label: '31st Street' },
  { key: 'pgh-mckees-rocks', label: 'McKees Rocks' },
  { key: 'pgh-smithfield', label: 'Smithfield St' },
  { key: 'pgh-liberty', label: 'Liberty' },
  { key: 'pgh-62nd-st', label: '62nd Street' },
  { key: 'pgh-birmingham', label: 'Birmingham' },
  { key: 'pgh-40th-st', label: '40th Street' },
  { key: 'pgh-hot-metal', label: 'Hot Metal' },
  { key: 'pgh-glenwood', label: 'Glenwood' },
  { key: 'pgh-highland-park', label: 'Highland Park' },
  { key: 'pgh-homestead', label: 'Homestead Grays' },
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

/** Build a bump segment with a raised centre hump. */
function buildBump(direction = 'up') {
  const group = new THREE.Group();
  const sign = direction === 'up' ? 1 : -1;
  const bumpHeight = 0.65;
  const accentColor = direction === 'up' ? COLORS.accentGreen : COLORS.accentRed;

  // Flat entry/exit thirds
  const third = GRID_SIZE / 3;
  for (const zOff of [-third, third]) {
    const slab = createDeck(ROAD_WIDTH, third, COLORS.asphalt);
    slab.position.z = zOff;
    group.add(slab);
    for (const s of [-1, 1]) {
      const c = new THREE.Mesh(
        new THREE.BoxGeometry(CURB_WIDTH, DECK_HEIGHT * 0.85, third),
        makeStandardMaterial(COLORS.curb),
      );
      c.position.set(s * (ROAD_WIDTH + CURB_WIDTH) / 2, DECK_HEIGHT * 0.425, zOff);
      group.add(finalizeMesh(c));
    }
  }

  // Raised centre hump – tilted ramp halves
  const rampLen = third * 0.5;
  const rampGeo = new THREE.BoxGeometry(ROAD_WIDTH, DECK_HEIGHT, rampLen);
  const rampUp = new THREE.Mesh(rampGeo, makeStandardMaterial(COLORS.asphaltWarm));
  rampUp.position.set(0, DECK_HEIGHT / 2 + sign * bumpHeight * 0.5, -rampLen * 0.5);
  rampUp.rotation.x = sign * Math.atan2(bumpHeight, rampLen);
  group.add(finalizeMesh(rampUp));
  const rampDown = new THREE.Mesh(rampGeo.clone(), makeStandardMaterial(COLORS.asphaltWarm));
  rampDown.position.set(0, DECK_HEIGHT / 2 + sign * bumpHeight * 0.5, rampLen * 0.5);
  rampDown.rotation.x = -sign * Math.atan2(bumpHeight, rampLen);
  group.add(finalizeMesh(rampDown));

  // Peak cap
  const capMesh = new THREE.Mesh(
    new THREE.BoxGeometry(ROAD_WIDTH, DECK_HEIGHT * 0.5, 0.5),
    makeStandardMaterial(accentColor),
  );
  capMesh.position.set(0, DECK_HEIGHT / 2 + sign * bumpHeight, 0);
  group.add(finalizeMesh(capMesh));

  group.add(createLaneStripe(GRID_SIZE * 0.76));
  group.add(createChevron(0, -HALF + 1.2, accentColor));
  group.add(createChevron(0, HALF - 1.2, accentColor));
  group.add(createEdgeBeacon(0, -HALF + 0.7, accentColor));
  group.add(createEdgeBeacon(0, HALF - 0.7, accentColor));
  return group;
}

/** Build a hill segment with stepped ramp visible from above. */
function buildHill(variant) {
  const group = new THREE.Group();
  let frontY = 0, backY = 0;
  let color = COLORS.accentGreen;
  const maxH = 2.6;

  if (variant === 'hill-beginning')      { backY = maxH; }
  else if (variant === 'hill-end')       { frontY = maxH; color = COLORS.accentRed; }
  else if (variant === 'hill-complete')  { frontY = 0; backY = maxH; }
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

    // Mix colour from dark to warm as elevation increases
    const tColor = stepY / Math.max(frontY, backY, 0.01);
    const stepColor = tColor > 0.5 ? COLORS.asphaltWarm : COLORS.asphalt;
    const slab = createDeck(ROAD_WIDTH, stepLen + 0.04, stepColor);
    slab.position.set(0, stepY, z);
    group.add(slab);

    // Curbs at step height
    for (const s of [-1, 1]) {
      const c = new THREE.Mesh(
        new THREE.BoxGeometry(CURB_WIDTH, DECK_HEIGHT * 0.85, stepLen + 0.04),
        makeStandardMaterial(COLORS.curb),
      );
      c.position.set(s * (ROAD_WIDTH + CURB_WIDTH) / 2, stepY + DECK_HEIGHT * 0.425 - DECK_HEIGHT / 2, z);
      group.add(finalizeMesh(c));
    }

    // Side wall fill below elevated steps (visible from above as widening shadow)
    if (stepY > 0.3) {
      for (const s of [-1, 1]) {
        const wall = new THREE.Mesh(
          new THREE.BoxGeometry(0.25, stepY, stepLen + 0.04),
          makeStandardMaterial(0x344155),
        );
        wall.position.set(s * (ROAD_WIDTH / 2 + CURB_WIDTH + 0.2), stepY / 2, z);
        group.add(finalizeMesh(wall));
      }
    }
  }

  // Support columns at the high end
  const highZ = backY > frontY ? HALF - 1.2 : -HALF + 1.2;
  const highH = Math.max(frontY, backY);
  if (highH > 0.3) {
    for (const xOff of [-ROAD_WIDTH * 0.35, ROAD_WIDTH * 0.35]) {
      group.add(createSupportPillar(xOff, highZ, highH + 0.4));
    }
    if (highH > 1.2) {
      const midZ = highZ * 0.45;
      for (const xOff of [-ROAD_WIDTH * 0.35, ROAD_WIDTH * 0.35]) {
        group.add(createSupportPillar(xOff, midZ, highH * 0.55));
      }
    }
  }

  // Arrow-style chevrons along the ramp direction
  const arrDir = backY > frontY ? 1 : -1;
  for (let i = 0; i < 3; i++) {
    const t = (i + 1) / 4;
    const z = -HALF + t * GRID_SIZE;
    const y = frontY + (backY - frontY) * t + DECK_HEIGHT;
    const chev = createChevron(0, z, color, 0);
    chev.position.y = y;
    group.add(chev);
  }
  group.add(createEdgeBeacon(0, -HALF + 0.7, color));
  group.add(createEdgeBeacon(0, HALF - 0.7, color));
  return group;
}

/** Build a bend segment with a pronounced lateral S-curve. */
function buildBend(large = false) {
  const group = new THREE.Group();
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

    const slab = createDeck(ROAD_WIDTH, segLen + 0.08, COLORS.asphalt);
    slab.position.set(xOff, 0, z);
    slab.rotation.y = yaw * 0.6;
    group.add(slab);

    // Curbs track the curve
    for (const s of [-1, 1]) {
      const cx = xOff + s * (ROAD_WIDTH + CURB_WIDTH) / 2 * Math.cos(yaw * 0.6);
      const c = new THREE.Mesh(
        new THREE.BoxGeometry(CURB_WIDTH, DECK_HEIGHT * 0.85, segLen + 0.08),
        makeStandardMaterial(COLORS.curb),
      );
      c.position.set(cx, DECK_HEIGHT * 0.425, z);
      c.rotation.y = yaw * 0.6;
      group.add(finalizeMesh(c));
    }
  }

  // Accent markers at widest offset
  group.add(createChevron(lateralShift * 0.6, -HALF + 1.5, COLORS.accentGold, 0.45));
  group.add(createChevron(lateralShift, 0, COLORS.accentGold, 0));
  group.add(createChevron(lateralShift * 0.6, HALF - 1.5, COLORS.accentGold, -0.45));
  group.add(createEdgeBeacon(-lateralShift * 0.1, -HALF + 0.7, COLORS.accentGold));
  group.add(createEdgeBeacon(-lateralShift * 0.1, HALF - 0.7, COLORS.accentGold));
  return group;
}

/** Build a skew segment with a pronounced diagonal offset. */
function buildSkew(key) {
  const group = new THREE.Group();
  const dir = key.includes('right') ? 1 : -1;
  const isSide = key.includes('side');
  const shift = isSide ? HALF * 0.35 : HALF * 0.6;
  const segs = 8;
  const segLen = GRID_SIZE / segs;
  const yaw = -dir * Math.atan2(shift, GRID_SIZE);

  for (let i = 0; i < segs; i++) {
    const t = (i + 0.5) / segs;
    const xOff = dir * t * shift;
    const z = -HALF + (i + 0.5) * segLen;
    const slab = createDeck(ROAD_WIDTH, segLen + 0.06, isSide ? COLORS.asphaltDark : COLORS.asphalt);
    slab.position.set(xOff, 0, z);
    slab.rotation.y = yaw * 0.65;
    group.add(slab);

    // Curbs track diagonal
    for (const s of [-1, 1]) {
      const cx = xOff + s * (ROAD_WIDTH + CURB_WIDTH) / 2 * Math.cos(yaw * 0.65);
      const c = new THREE.Mesh(
        new THREE.BoxGeometry(CURB_WIDTH, DECK_HEIGHT * 0.85, segLen + 0.06),
        makeStandardMaterial(COLORS.curb),
      );
      c.position.set(cx, DECK_HEIGHT * 0.425, z);
      c.rotation.y = yaw * 0.65;
      group.add(finalizeMesh(c));
    }
  }

  const accentColor = isSide ? COLORS.accentGold : COLORS.accentBlue;
  group.add(createChevron(dir * shift * 0.2, -HALF + 1.5, accentColor, dir * 0.5));
  group.add(createChevron(dir * shift * 0.5, 0, accentColor, dir * 0.5));
  group.add(createChevron(dir * shift * 0.8, HALF - 1.5, accentColor, dir * 0.5));
  group.add(createEdgeBeacon(0, -HALF + 0.7, accentColor));
  group.add(createEdgeBeacon(dir * shift, HALF - 0.7, accentColor));
  return group;
}

function decorateStraightVariant(group, key) {
  if (key === 'straight') {
    group.add(createChevron(0, -1.5, COLORS.accentBlue, 0));
    group.add(createChevron(0, 1.5, COLORS.accentBlue, 0));
    return;
  }
}

// ── Pittsburgh Bridge Procedural Geometry ─────────────────────
const PGH_GOLD = 0xC39953;   // Aztec Gold — Pittsburgh's signature bridge color
const PGH_ELEV = GRID_SIZE * 0.7;    // raised high enough for road segments to pass underneath

/** Shared elevated bridge deck for all Pittsburgh bridge pieces. */
function buildPghDeck(bridgeColor = PGH_GOLD) {
  const group = new THREE.Group();
  const y = PGH_ELEV;
  const railMat = makeStandardMaterial(bridgeColor);
  const colMat = makeStandardMaterial(0x555566);

  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(ROAD_WIDTH, DECK_HEIGHT, GRID_SIZE),
    makeStandardMaterial(COLORS.asphalt),
  );
  deck.position.y = y;
  group.add(finalizeMesh(deck));

  for (const s of [-1, 1]) {
    const curb = new THREE.Mesh(
      new THREE.BoxGeometry(CURB_WIDTH, DECK_HEIGHT * 0.85, GRID_SIZE),
      makeStandardMaterial(COLORS.curb),
    );
    curb.position.set(s * (ROAD_WIDTH + CURB_WIDTH) / 2, y, 0);
    group.add(finalizeMesh(curb));

    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.5, GRID_SIZE),
      railMat,
    );
    rail.position.set(s * (SHOULDER_WIDTH / 2 + 0.08), y + DECK_HEIGHT / 2 + 0.25, 0);
    group.add(finalizeMesh(rail));
  }

  const stripe = createLaneStripe(GRID_SIZE * 0.76);
  stripe.position.y = y + DECK_HEIGHT / 2 + 0.01;
  group.add(stripe);

  for (const z of [-HALF + 1.5, HALF - 1.5]) {
    for (const x of [-ROAD_WIDTH / 3, ROAD_WIDTH / 3]) {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.4, y, 0.4), colMat);
      col.position.set(x, y / 2, z);
      group.add(finalizeMesh(col));
    }
  }
  return group;
}

/** Segmented arch made of rotated box segments. */
function pghArch(group, x, baseY, peakH, spanZ, mat, segs = 8, thick = 0.18) {
  const hs = spanZ / 2;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const z0 = -hs + t0 * spanZ, z1 = -hs + t1 * spanZ;
    const y0 = baseY + Math.sin(t0 * Math.PI) * peakH;
    const y1 = baseY + Math.sin(t1 * Math.PI) * peakH;
    const dz = z1 - z0, dy = y1 - y0;
    const len = Math.sqrt(dz * dz + dy * dy);
    const seg = new THREE.Mesh(new THREE.BoxGeometry(thick, thick, len + 0.01), mat);
    seg.position.set(x, (y0 + y1) / 2, (z0 + z1) / 2);
    seg.rotation.x = -Math.atan2(dy, dz);
    group.add(finalizeMesh(seg));
  }
}

/** Vertical hanger rods from arch curve down to a reference height. */
function pghHangers(group, x, archBaseY, archPeakH, bottomY, spanZ, mat, count = 6) {
  const hs = spanZ / 2;
  for (let i = 1; i < count; i++) {
    const t = i / count;
    const z = -hs + t * spanZ;
    const archY = archBaseY + Math.sin(t * Math.PI) * archPeakH;
    const h = archY - bottomY;
    if (h < 0.15) continue;
    const rod = new THREE.Mesh(new THREE.BoxGeometry(0.05, h, 0.05), mat);
    rod.position.set(x, bottomY + h / 2, z);
    group.add(finalizeMesh(rod));
  }
}

/** Build a Pittsburgh bridge piece with type-specific superstructure. */
function buildPghBridge(key) {
  const def = PGH_BRIDGE_DEFS[key];
  if (!def) return buildStraightBase();

  const bridgeColor = def.color || PGH_GOLD;
  const group = buildPghDeck(bridgeColor);
  const gold = makeStandardMaterial(bridgeColor);
  const cableMat = makeStandardMaterial(0x888899);
  const deckTop = PGH_ELEV + DECK_HEIGHT / 2;
  const sx = SHOULDER_WIDTH / 2 + 0.15;

  if (def.type === 'suspension') {
    // Three Sisters: twin towers with crossbeams, cables, suspenders
    const tH = 3.0;
    for (const z of [-GRID_SIZE / 3, GRID_SIZE / 3]) {
      for (const s of [-1, 1]) {
        const tower = new THREE.Mesh(new THREE.BoxGeometry(0.3, tH, 0.3), gold);
        tower.position.set(s * sx, deckTop + tH / 2, z);
        group.add(finalizeMesh(tower));
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(sx * 2 + 0.3, 0.18, 0.18), gold);
      beam.position.set(0, deckTop + tH * 0.85, z);
      group.add(finalizeMesh(beam));
    }
    for (const s of [-1, 1]) {
      const cLine = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, GRID_SIZE), cableMat);
      cLine.position.set(s * sx, deckTop + tH * 0.7, 0);
      group.add(finalizeMesh(cLine));
      for (let i = 1; i < 8; i++) {
        const z = -HALF + i * (GRID_SIZE / 8);
        const h = tH * 0.7 - 0.3;
        const rod = new THREE.Mesh(new THREE.BoxGeometry(0.04, h, 0.04), cableMat);
        rod.position.set(s * sx, deckTop + h / 2 + 0.2, z);
        group.add(finalizeMesh(rod));
      }
    }
  }

  else if (def.type === 'bowstring') {
    // Fort Pitt / Fort Duquesne: dual bowstring arches with hangers
    const archH = 3.5;
    for (const s of [-1, 1]) {
      pghArch(group, s * sx, deckTop, archH, GRID_SIZE * 0.92, gold, 10, 0.22);
      pghHangers(group, s * sx, deckTop, archH, deckTop, GRID_SIZE * 0.92, gold, 8);
    }
    for (const z of [-HALF + 0.4, HALF - 0.4]) {
      for (const s of [-1, 1]) {
        const sup = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.8, 0.3), gold);
        sup.position.set(s * sx, deckTop + 0.4, z);
        group.add(finalizeMesh(sup));
      }
    }
  }

  else if (def.type === 'tied-arch') {
    // West End, Veterans, etc.: single arch with vertical hangers
    const archH = 3.0;
    for (const s of [-1, 1]) {
      pghArch(group, s * sx, deckTop, archH, GRID_SIZE * 0.88, gold, 8, 0.18);
      pghHangers(group, s * sx, deckTop, archH, deckTop, GRID_SIZE * 0.88, gold, 6);
    }
  }

  else if (def.type === 'lenticular') {
    // Smithfield St: lenticular (lens-shaped) truss — top chord arches up, bottom sags
    const tH = 2.5;
    for (const s of [-1, 1]) {
      pghArch(group, s * sx, deckTop + 0.2, tH * 0.6, GRID_SIZE * 0.9, gold, 6, 0.14);
      pghArch(group, s * sx, deckTop + 0.2, -0.4, GRID_SIZE * 0.9, gold, 4, 0.12);
      for (let i = 1; i < 6; i++) {
        const t = i / 6;
        const z = -GRID_SIZE * 0.45 + t * GRID_SIZE * 0.9;
        const topY = deckTop + 0.2 + Math.sin(t * Math.PI) * tH * 0.6;
        const botY = deckTop + 0.2 + Math.sin(t * Math.PI) * (-0.4);
        const h = topY - botY;
        if (h < 0.1) continue;
        const v = new THREE.Mesh(new THREE.BoxGeometry(0.07, h, 0.07), gold);
        v.position.set(s * sx, (topY + botY) / 2, z);
        group.add(finalizeMesh(v));
      }
    }
    for (const z of [-HALF + 0.8, HALF - 0.8]) {
      const portal = new THREE.Mesh(new THREE.BoxGeometry(SHOULDER_WIDTH + 0.3, 0.18, 0.18), gold);
      portal.position.set(0, deckTop + tH * 0.3, z);
      group.add(finalizeMesh(portal));
    }
  }

  else if (def.type === 'cantilever') {
    // Liberty Bridge: tall triangular piers with diagonal struts
    const pH = 3.5;
    for (const z of [-GRID_SIZE / 3, GRID_SIZE / 3]) {
      for (const s of [-1, 1]) {
        const pier = new THREE.Mesh(new THREE.BoxGeometry(0.35, pH, 0.35), gold);
        pier.position.set(s * sx, deckTop + pH / 2, z);
        group.add(finalizeMesh(pier));
        for (const dz of [-1.5, 1.5]) {
          const angle = Math.atan2(pH * 0.35, 1.5);
          const strut = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 2.0), gold);
          strut.position.set(s * sx, deckTop + pH * 0.55, z + dz * 0.55);
          strut.rotation.x = dz > 0 ? -angle : angle;
          group.add(finalizeMesh(strut));
        }
      }
      const topBeam = new THREE.Mesh(new THREE.BoxGeometry(sx * 2 + 0.3, 0.18, 0.18), gold);
      topBeam.position.set(0, deckTop + pH, z);
      group.add(finalizeMesh(topBeam));
    }
  }

  else if (def.type === 'girder') {
    // Birmingham, 40th St: tall solid plate girders on each side
    const gH = 1.8;
    for (const s of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.12, gH, GRID_SIZE), gold);
      plate.position.set(s * sx, deckTop + gH / 2, 0);
      group.add(finalizeMesh(plate));
    }
    for (const z of [-HALF + 0.5, HALF - 0.5]) {
      const cross = new THREE.Mesh(new THREE.BoxGeometry(SHOULDER_WIDTH + 0.2, 0.12, 0.12), gold);
      cross.position.set(0, deckTop + gH * 0.8, z);
      group.add(finalizeMesh(cross));
    }
  }

  else if (def.type === 'truss') {
    // Hot Metal, Glenwood: Warren truss with diagonals
    const tH = 2.2;
    const panels = 5;
    const panelW = GRID_SIZE / panels;
    for (const s of [-1, 1]) {
      const x = s * sx;
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, GRID_SIZE), gold);
      top.position.set(x, deckTop + tH, 0);
      group.add(finalizeMesh(top));
      for (let i = 0; i <= panels; i++) {
        const z = -HALF + i * panelW;
        const vert = new THREE.Mesh(new THREE.BoxGeometry(0.07, tH, 0.07), gold);
        vert.position.set(x, deckTop + tH / 2, z);
        group.add(finalizeMesh(vert));
      }
      for (let i = 0; i < panels; i++) {
        const dy = i % 2 === 0 ? tH : -tH;
        const diagLen = Math.sqrt(panelW * panelW + tH * tH);
        const diag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, diagLen), gold);
        diag.position.set(x, deckTop + tH / 2, -HALF + (i + 0.5) * panelW);
        diag.rotation.x = -Math.atan2(dy, panelW);
        group.add(finalizeMesh(diag));
      }
    }
    for (const z of [-HALF + 0.3, HALF - 0.3]) {
      const cross = new THREE.Mesh(new THREE.BoxGeometry(SHOULDER_WIDTH + 0.2, 0.1, 0.1), gold);
      cross.position.set(0, deckTop + tH, z);
      group.add(finalizeMesh(cross));
    }
  }

  else if (def.type === 'steel-arch') {
    // Highland Park, Homestead Grays: arch BELOW deck
    const archPeak = PGH_ELEV * 0.5;
    for (const s of [-1, 1]) {
      pghArch(group, s * (ROAD_WIDTH / 3), 0, archPeak, GRID_SIZE * 0.9, gold, 8, 0.2);
    }
    for (let i = 1; i < 6; i++) {
      const t = i / 6;
      const z = -GRID_SIZE * 0.45 + t * GRID_SIZE * 0.9;
      const archY = Math.sin(t * Math.PI) * archPeak;
      const h = PGH_ELEV - archY;
      if (h < 0.2) continue;
      for (const x of [-ROAD_WIDTH / 3, ROAD_WIDTH / 3]) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.12, h, 0.12), gold);
        col.position.set(x, archY + h / 2, z);
        group.add(finalizeMesh(col));
      }
    }
  }

  // Apply per-bridge deck scale for length differentiation
  const ds = def.deckScale || 1;
  if (ds !== 1) group.scale.set(1, 1, ds);

  return group;
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

  // Pittsburgh bridge themed pieces
  if (PGH_BRIDGE_DEFS[key]) {
    wrapper.add(buildPghBridge(key));
    return wrapper;
  }

  // Bump segments – raised/dipped centre hump
  if (key === 'bump-up' || key === 'bump-down') {
    wrapper.add(buildBump(key === 'bump-up' ? 'up' : 'down'));
    return wrapper;
  }

  // Hill segments – tilted ramp decks with support pillars
  if (key.startsWith('hill-')) {
    wrapper.add(buildHill(key));
    return wrapper;
  }

  // Bend segments – S-curved lateral offset
  if (key === 'bend' || key === 'bend-large') {
    wrapper.add(buildBend(key === 'bend-large'));
    return wrapper;
  }

  // Skew segments – diagonal offset deck
  if (key.startsWith('skew-')) {
    wrapper.add(buildSkew(key));
    return wrapper;
  }

  const straight = buildStraightBase(COLORS.asphalt);
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

// ── Bridge superstructure on Kenney road tiles ────────────────
const KENNEY_DECK_TOP = 0.75;   // approx road-surface height of Kenney models
const BRIDGE_SX = HALF * 0.82;  // x-offset for structural elements at road edge

/** Polished metallic bridge steel material. */
function makeBridgeMetal(color, emissiveBoost = 0.08) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.3,
    metalness: 0.75,
    emissive: color,
    emissiveIntensity: emissiveBoost,
  });
}

/** Add bridge superstructure on top of a Kenney road tile clone. */
function addBridgeSuperstructure(model, key, deckTop = KENNEY_DECK_TOP) {
  const def = PGH_BRIDGE_DEFS[key];
  if (!def) return;

  const dt = deckTop;
  const sx = BRIDGE_SX;
  const bridgeColor = def.color || PGH_GOLD;
  const gold = makeBridgeMetal(bridgeColor);
  const steel = makeBridgeMetal(0x99AABB, 0.04);

  // Side rails for every bridge
  for (const s of [-1, 1]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.55, GRID_SIZE), gold,
    );
    rail.position.set(s * sx, dt + 0.28, 0);
    model.add(finalizeMesh(rail));
  }

  if (def.type === 'suspension') {
    const tH = 3.0;
    for (const z of [-GRID_SIZE / 3, GRID_SIZE / 3]) {
      for (const s of [-1, 1]) {
        const tower = new THREE.Mesh(new THREE.BoxGeometry(0.3, tH, 0.3), gold);
        tower.position.set(s * sx, dt + tH / 2, z);
        model.add(finalizeMesh(tower));
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(sx * 2 + 0.3, 0.18, 0.18), gold);
      beam.position.set(0, dt + tH * 0.85, z);
      model.add(finalizeMesh(beam));
    }
    for (const s of [-1, 1]) {
      const cLine = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, GRID_SIZE), steel);
      cLine.position.set(s * sx, dt + tH * 0.7, 0);
      model.add(finalizeMesh(cLine));
      for (let i = 1; i < 8; i++) {
        const z = -HALF + i * (GRID_SIZE / 8);
        const h = tH * 0.7 - 0.3;
        const rod = new THREE.Mesh(new THREE.BoxGeometry(0.04, h, 0.04), steel);
        rod.position.set(s * sx, dt + h / 2 + 0.2, z);
        model.add(finalizeMesh(rod));
      }
    }
  }

  else if (def.type === 'bowstring') {
    const archH = 3.5;
    for (const s of [-1, 1]) {
      pghArch(model, s * sx, dt, archH, GRID_SIZE * 0.92, gold, 10, 0.22);
      pghHangers(model, s * sx, dt, archH, dt, GRID_SIZE * 0.92, steel, 8);
    }
    for (const z of [-HALF + 0.4, HALF - 0.4]) {
      for (const s of [-1, 1]) {
        const sup = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.8, 0.3), gold);
        sup.position.set(s * sx, dt + 0.4, z);
        model.add(finalizeMesh(sup));
      }
    }
  }

  else if (def.type === 'tied-arch') {
    const archH = 3.0;
    for (const s of [-1, 1]) {
      pghArch(model, s * sx, dt, archH, GRID_SIZE * 0.88, gold, 8, 0.18);
      pghHangers(model, s * sx, dt, archH, dt, GRID_SIZE * 0.88, steel, 6);
    }
  }

  else if (def.type === 'lenticular') {
    const tH = 2.5;
    for (const s of [-1, 1]) {
      pghArch(model, s * sx, dt + 0.2, tH * 0.6, GRID_SIZE * 0.9, gold, 6, 0.14);
      pghArch(model, s * sx, dt + 0.2, -0.4, GRID_SIZE * 0.9, gold, 4, 0.12);
      for (let i = 1; i < 6; i++) {
        const t = i / 6;
        const z = -GRID_SIZE * 0.45 + t * GRID_SIZE * 0.9;
        const topY = dt + 0.2 + Math.sin(t * Math.PI) * tH * 0.6;
        const botY = dt + 0.2 + Math.sin(t * Math.PI) * (-0.4);
        const h = topY - botY;
        if (h < 0.1) continue;
        const v = new THREE.Mesh(new THREE.BoxGeometry(0.07, h, 0.07), gold);
        v.position.set(s * sx, (topY + botY) / 2, z);
        model.add(finalizeMesh(v));
      }
    }
    for (const z of [-HALF + 0.8, HALF - 0.8]) {
      const portal = new THREE.Mesh(new THREE.BoxGeometry(sx * 2 + 0.3, 0.18, 0.18), gold);
      portal.position.set(0, dt + tH * 0.3, z);
      model.add(finalizeMesh(portal));
    }
  }

  else if (def.type === 'cantilever') {
    const pH = 3.5;
    for (const z of [-GRID_SIZE / 3, GRID_SIZE / 3]) {
      for (const s of [-1, 1]) {
        const pier = new THREE.Mesh(new THREE.BoxGeometry(0.35, pH, 0.35), gold);
        pier.position.set(s * sx, dt + pH / 2, z);
        model.add(finalizeMesh(pier));
        for (const dz of [-1.5, 1.5]) {
          const angle = Math.atan2(pH * 0.35, 1.5);
          const strut = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 2.0), gold);
          strut.position.set(s * sx, dt + pH * 0.55, z + dz * 0.55);
          strut.rotation.x = dz > 0 ? -angle : angle;
          model.add(finalizeMesh(strut));
        }
      }
      const topBeam = new THREE.Mesh(new THREE.BoxGeometry(sx * 2 + 0.3, 0.18, 0.18), gold);
      topBeam.position.set(0, dt + pH, z);
      model.add(finalizeMesh(topBeam));
    }
  }

  else if (def.type === 'girder') {
    const gH = 1.8;
    for (const s of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.12, gH, GRID_SIZE), gold);
      plate.position.set(s * sx, dt + gH / 2, 0);
      model.add(finalizeMesh(plate));
    }
    for (const z of [-HALF + 0.5, HALF - 0.5]) {
      const cross = new THREE.Mesh(new THREE.BoxGeometry(sx * 2 + 0.2, 0.12, 0.12), gold);
      cross.position.set(0, dt + gH * 0.8, z);
      model.add(finalizeMesh(cross));
    }
  }

  else if (def.type === 'truss') {
    const tH = 2.2;
    const panels = 5;
    const panelW = GRID_SIZE / panels;
    for (const s of [-1, 1]) {
      const x = s * sx;
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, GRID_SIZE), gold);
      top.position.set(x, dt + tH, 0);
      model.add(finalizeMesh(top));
      for (let i = 0; i <= panels; i++) {
        const z = -HALF + i * panelW;
        const vert = new THREE.Mesh(new THREE.BoxGeometry(0.07, tH, 0.07), gold);
        vert.position.set(x, dt + tH / 2, z);
        model.add(finalizeMesh(vert));
      }
      for (let i = 0; i < panels; i++) {
        const dy = i % 2 === 0 ? tH : -tH;
        const diagLen = Math.sqrt(panelW * panelW + tH * tH);
        const diag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, diagLen), gold);
        diag.position.set(x, dt + tH / 2, -HALF + (i + 0.5) * panelW);
        diag.rotation.x = -Math.atan2(dy, panelW);
        model.add(finalizeMesh(diag));
      }
    }
    for (const z of [-HALF + 0.3, HALF - 0.3]) {
      const cross = new THREE.Mesh(new THREE.BoxGeometry(sx * 2 + 0.2, 0.1, 0.1), gold);
      cross.position.set(0, dt + tH, z);
      model.add(finalizeMesh(cross));
    }
  }

  else if (def.type === 'steel-arch') {
    const archH = 2.5;
    for (const s of [-1, 1]) {
      pghArch(model, s * sx, dt, archH, GRID_SIZE * 0.9, gold, 8, 0.2);
    }
    for (const z of [-HALF + 0.8, HALF - 0.8]) {
      const cross = new THREE.Mesh(new THREE.BoxGeometry(sx * 2 + 0.2, 0.14, 0.14), gold);
      cross.position.set(0, dt + archH * 0.6, z);
      model.add(finalizeMesh(cross));
    }
  }
}

/**
 * Load a GLB file from /models/track/ and cache it.
 * Wrap in a parent Group and normalise so it fills a GRID_SIZE × GRID_SIZE cell,
 * centred at origin with y=0 at the bottom.
 * Returns null on failure so callers can fall back to procedural.
 */
async function loadGLB(file) {
  if (glbCache.has(file)) return glbCache.get(file);
  return new Promise((resolve) => {
    glbLoader.load(`/models/track/${file}`, (gltf) => {
      const inner = gltf.scene;
      inner.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      // Measure raw bounding box
      const box = new THREE.Box3().setFromObject(inner);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxSpan = Math.max(size.x, size.z) || 1;

      // Scale so the footprint fills one grid cell
      if (Math.abs(maxSpan - GRID_SIZE) > 0.1) {
        const s = GRID_SIZE / maxSpan;
        inner.scale.multiplyScalar(s);
        // Recompute after scale
        box.setFromObject(inner);
        box.getSize(size);
        box.getCenter(center);
      }

      // Centre at origin, ground plane at y = 0
      inner.position.set(
        -center.x,
        -box.min.y,
        -center.z,
      );

      // Wrap so that placement code can set wrapper.position
      // without clobbering the centering offset.
      const wrapper = new THREE.Group();
      wrapper.name = file.replace('.glb', '');
      wrapper.add(inner);

      glbCache.set(file, wrapper);
      resolve(wrapper);
    }, undefined, (err) => {
      console.warn(`[asset-loader] GLB load failed for ${file}, using procedural fallback`, err);
      glbCache.set(file, null);
      resolve(null);
    });
  });
}

// ── Geometry Tessellation ─────────────────────────────────────
// Subdivides mesh geometry so vertex warps produce smooth, visible surface
// deformation.  Without this, the GLB's sparse vertex layout (road-surface
// vertices only at cell edges, 10-unit face spans) makes hills / bumps /
// bends appear flat even though the underlying base vertices are warped.

function tessellateGeometry(geo, maxEdge = 1.0, maxPasses = 5) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();

  for (let pass = 0; pass < maxPasses; pass++) {
    const pos = g.attributes.position;
    const uv  = g.attributes.uv;
    const norm = g.attributes.normal;
    const triCount = pos.count / 3;
    let didSplit = false;

    const np = [], nu = [], nn = [];

    for (let t = 0; t < triCount; t++) {
      const base = t * 3;
      const p = [], u = [], n = [];
      for (let v = 0; v < 3; v++) {
        const i = base + v;
        p.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
        if (uv) u.push([uv.getX(i), uv.getY(i)]);
        if (norm) n.push([norm.getX(i), norm.getY(i), norm.getZ(i)]);
      }

      // Find longest edge
      let longest = 0, longestLen = 0;
      for (let e = 0; e < 3; e++) {
        const a = p[e], b = p[(e + 1) % 3];
        const d = Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
        if (d > longestLen) { longestLen = d; longest = e; }
      }

      if (longestLen > maxEdge) {
        didSplit = true;
        const a = longest, b = (a + 1) % 3, c = (a + 2) % 3;
        const mp  = p[a].map((v, i) => (v + p[b][i]) * 0.5);
        const mu  = uv   ? u[a].map((v, i) => (v + u[b][i]) * 0.5) : null;
        const mn  = norm  ? n[a].map((v, i) => (v + n[b][i]) * 0.5) : null;
        // Triangle 1:  vertex a → midpoint → vertex c
        np.push(...p[a], ...mp, ...p[c]);
        if (uv)   nu.push(...u[a], ...mu, ...u[c]);
        if (norm)  nn.push(...n[a], ...mn, ...n[c]);
        // Triangle 2:  midpoint → vertex b → vertex c
        np.push(...mp, ...p[b], ...p[c]);
        if (uv)   nu.push(...mu, ...u[b], ...u[c]);
        if (norm)  nn.push(...mn, ...n[b], ...n[c]);
      } else {
        np.push(...p[0], ...p[1], ...p[2]);
        if (uv)   nu.push(...u[0], ...u[1], ...u[2]);
        if (norm)  nn.push(...n[0], ...n[1], ...n[2]);
      }
    }

    if (!didSplit) break;

    g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(np, 3));
    if (nu.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(nu, 2));
    if (nn.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(nn, 3));
  }

  return g;
}

// ── GLB Vertex Warp System ───────────────────────────────────
// Deforms the polished track-straight.glb mesh into different segment shapes,
// preserving its materials, UVs, textures, and visual quality.

const SEGMENT_WARPS = {
  // Hills — linear & sinusoidal elevation along the road
  'hill-beginning':     (x, y, z) => [x, y + ((z + HALF) / GRID_SIZE) * 2.6, z],
  'hill-end':           (x, y, z) => [x, y + (1 - (z + HALF) / GRID_SIZE) * 2.6, z],
  'hill-complete':      (x, y, z) => [x, y + Math.sin(((z + HALF) / GRID_SIZE) * Math.PI) * 2.6, z],
  'hill-complete-half': (x, y, z) => [x, y + Math.sin(((z + HALF) / GRID_SIZE) * Math.PI) * 1.4, z],

  // Bumps — dramatic raised / dipped hump centred on the cell
  'bump-up':   (x, y, z) => { const t = z / HALF; return [x, y + Math.max(0, 1 - t * t) * 1.8, z]; },
  'bump-down': (x, y, z) => { const t = z / HALF; return [x, y - Math.max(0, 1 - t * t) * 1.0, z]; },

  // Bends — gentle lateral S-curve, entry & exit centred for grid linking
  'bend':       (x, y, z) => [x + Math.sin(((z + HALF) / GRID_SIZE) * Math.PI) * 1.3, y, z],
  'bend-large': (x, y, z) => [x + Math.sin(((z + HALF) / GRID_SIZE) * Math.PI) * 2.0, y, z],

  // Skews — banked (tilted) road surface for cornering feel
  'skew-left':       (x, y, z) => { const t = Math.min(y / 0.75, 1); return [x, y - (x / (ROAD_WIDTH * 0.5)) * 1.2 * t, z]; },
  'skew-right':      (x, y, z) => { const t = Math.min(y / 0.75, 1); return [x, y + (x / (ROAD_WIDTH * 0.5)) * 1.2 * t, z]; },
  'skew-left-side':  (x, y, z) => { const t = Math.min(y / 0.75, 1); return [x, y - (x / (ROAD_WIDTH * 0.5)) * 0.7 * t, z]; },
  'skew-right-side': (x, y, z) => { const t = Math.min(y / 0.75, 1); return [x, y + (x / (ROAD_WIDTH * 0.5)) * 0.7 * t, z]; },

  // Bridge ramps — 2-cell (20-unit) linear rise from ground to PGH_ELEV
  'bridge-onramp':  (x, y, z) => [x, y + ((z + HALF) / (GRID_SIZE * 2)) * PGH_ELEV, z],
  'bridge-offramp': (x, y, z) => [x, y + (1 - (z + HALF) / (GRID_SIZE * 2)) * PGH_ELEV, z],

  // Caps — road compressed to half-cell length
  'cap-front': (x, y, z) => {
    const nz = (z + HALF) * 0.5;
    const t = nz / HALF;                 // 0 at dead end, 1 at entry
    return [x, y + (1 - t) * 0.6, nz];  // raised lip at dead end
  },
  'cap-back': (x, y, z) => {
    const nz = (z + HALF) * 0.5 - HALF;
    const t = (nz + HALF) / HALF;        // 0 at entry, 1 at dead end
    return [x, y + t * 0.6, nz];         // raised lip at dead end
  },
  'end': (x, y, z) => {
    const nz = (z + HALF) * 0.5;          // compress to [0, HALF]
    const t = nz / HALF;                  // 0 at dead end, 1 at entry
    const taper = 0.25 + 0.75 * t;       // narrows to 25% at dead end
    return [x * taper, y * taper, nz];
  },
};

// Segments that need geometry tessellation for smooth surface deformation
const TESSELLATE_KEYS = new Set([
  'hill-beginning', 'hill-end', 'hill-complete', 'hill-complete-half',
  'bump-up', 'bump-down',
  'bend', 'bend-large',
  'skew-left', 'skew-right', 'skew-left-side', 'skew-right-side',
  'cap-front', 'cap-back', 'end',
  'bridge-onramp', 'bridge-offramp',
]);

// Bridge elevation warps
for (const bk of Object.keys(PGH_BRIDGE_DEFS)) {
  SEGMENT_WARPS[bk] = (x, y, z) => [x, y + PGH_ELEV, z];
}

/**
 * Apply a vertex warp function to every mesh in a model hierarchy.
 * When tessellate is true, subdivides geometry first so warps produce
 * smooth surface deformation instead of flat-looking faces.
 */
function applyVertexWarp(model, warpFn, tessellate = false) {
  model.traverse((child) => {
    if (!child.isMesh) return;
    // Clone geometry so the cached GLB isn't mutated
    let geo = child.geometry.clone();
    if (tessellate) geo = tessellateGeometry(geo, 1.0);
    child.geometry = geo;
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const [nx, ny, nz] = warpFn(pos.getX(i), pos.getY(i), pos.getZ(i));
      pos.setXYZ(i, nx, ny, nz);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
  });
}

export async function loadModel(key) {
  const asset = TRACK_ASSETS.find((a) => a.key === key);

  // 1. Segments with dedicated GLB files (straight, corners, curve)
  if (asset?.file) {
    const glb = await loadGLB(asset.file);
    if (glb) {
      const model = cloneModel(glb);
      if (PGH_BRIDGE_DEFS[key]) {
        addBridgeSuperstructure(model, key);
      }
      return model;
    }
  }

  // 2. Bridge ramps — 2-cell (1×2) riser from ground to bridge height
  if (key === 'bridge-onramp' || key === 'bridge-offramp') {
    const baseGlb = await loadGLB('track-straight.glb');
    if (baseGlb) {
      const group = new THREE.Group();
      group.name = key;
      const warpFn = SEGMENT_WARPS[key];
      for (const dz of [0, 1]) {
        const copy = cloneModel(baseGlb);
        // Use globalZ only for elevation calc; keep local z so position offset isn't doubled
        applyVertexWarp(copy, (x, y, z) => {
          const globalZ = z + dz * GRID_SIZE;
          const [, ny] = warpFn(x, y, globalZ);
          return [x, ny, z];
        }, true);
        copy.position.set(0, 0, dz * GRID_SIZE);
        group.add(copy);
      }
      // Add side guardrails along the ramp
      const gold = new THREE.MeshStandardMaterial({ color: PGH_GOLD, roughness: 0.3, metalness: 0.75 });
      for (const s of [-1, 1]) {
        const rail = new THREE.Mesh(
          new THREE.BoxGeometry(0.14, 0.55, GRID_SIZE * 2), gold,
        );
        const midElev = PGH_ELEV / 2 + DECK_HEIGHT;
        rail.position.set(s * (ROAD_WIDTH / 2 + 0.08), midElev, HALF);
        group.add(rail);
      }
      return group;
    }
  }

  // 3. Wide pad — 4-cell (2×2) borderless flat area
  if (key === 'wide') {
    const group = new THREE.Group();
    group.name = 'wide';
    const mat = new THREE.MeshStandardMaterial({
      color: COLORS.asphalt,
      roughness: 0.85,
      metalness: 0.05,
    });
    for (const [dx, dz] of [[0,0],[1,0],[0,1],[1,1]]) {
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(GRID_SIZE, DECK_HEIGHT, GRID_SIZE),
        mat,
      );
      slab.position.set(dx * GRID_SIZE, DECK_HEIGHT / 2, dz * GRID_SIZE);
      group.add(slab);
    }
    return group;
  }

  // 3. Warpable segments: deform the polished straight GLB
  const warpFn = SEGMENT_WARPS[key];
  if (warpFn) {
    const baseGlb = await loadGLB('track-straight.glb');
    if (baseGlb) {
      const model = cloneModel(baseGlb);
      applyVertexWarp(model, warpFn, TESSELLATE_KEYS.has(key));
      if (PGH_BRIDGE_DEFS[key]) {
        addBridgeSuperstructure(model, key, KENNEY_DECK_TOP + PGH_ELEV);
      }
      return model;
    }
  }

  // 4. Fallback: procedural geometry
  return cloneModel(getTemplate(key));
}

export function getModelMeta(key) {
  getTemplate(key);
  return metaCache.get(key) || null;
}

export async function preloadAll(onProgress) {
  const total = TRACK_ASSETS.length;
  let loaded = 0;
  const promises = TRACK_ASSETS.map(async (asset) => {
    if (asset.file) {
      await loadGLB(asset.file);
    }
    getTemplate(asset.key);
    loaded += 1;
    onProgress?.(loaded, total);
  });
  await Promise.all(promises);
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
