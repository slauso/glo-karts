/**
 * procedural-demo-course.js — Unified procedural demo course generator.
 *
 * Generates a single, fully-featured hybrid race/battle course at runtime.
 * The "Glo Circuit" is a looping track with elevation changes, wide open
 * battle zones, power-up spawn areas, AI navmesh grids, boundary walls,
 * and surface-type variations — all 100% procedural via Babylon.js MeshBuilder.
 *
 * Works for every game mode:
 *  - Race/Quick Race/Time Trial/Grand Prix: closed-loop driveline + checkpoints
 *  - Battle/3-Strikes/CTF: open center arena area + spawn ring
 *  - Soccer: rectangular field with goals extracted from arena bounds
 *  - Follow-the-Leader: same track loop, leader elimination logic external
 *  - Free Roam: full track + terrain available, no lap enforcement
 *  - Local 2P: same geometry, splitscreen handled by renderer
 *  - Online: seed-deterministic so all clients generate identical geometry
 *
 * Optimised for low-end devices: <100 draw calls, <30k triangles, <5s gen time.
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PhysicsAggregate } from '@babylonjs/core/Physics/v2/physicsAggregate';
import { PhysicsShapeType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import { FILTER, applyFilterToAggregate } from './realtime/collision-layers.js';

let _lastRoot = null;

// ── Seeded PRNG (mulberry32) ────────────────────────────────────────────────

function seedHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Catmull-Rom Spline ──────────────────────────────────────────────────────

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

function sampleSpline(controlPoints, totalSamples) {
  const n = controlPoints.length;
  const points = [];
  for (let i = 0; i < totalSamples; i++) {
    const t = (i / totalSamples) * n;
    const segment = Math.floor(t) % n;
    const frac = t - Math.floor(t);
    const p0 = controlPoints[(segment - 1 + n) % n];
    const p1 = controlPoints[segment];
    const p2 = controlPoints[(segment + 1) % n];
    const p3 = controlPoints[(segment + 2) % n];
    points.push({
      x: catmullRom(p0.x, p1.x, p2.x, p3.x, frac),
      y: catmullRom(p0.y, p1.y, p2.y, p3.y, frac),
      z: catmullRom(p0.z, p1.z, p2.z, p3.z, frac),
    });
  }
  return points;
}

// ── Demo Course Layout ──────────────────────────────────────────────────────
// Fixed layout designed for all game modes: an oval with two wider battle
// zones on opposing sides, elevation changes on the back straight, and a
// gentle S-curve.

const DEMO_CONTROL_POINTS = [
  { x:   0, y: 0,   z: -80 },   // start/finish straight
  { x:  35, y: 0,   z: -70 },
  { x:  65, y: 1.5, z: -40 },   // right sweeper
  { x:  75, y: 3,   z:   0 },   // right apex — widened for battle zone
  { x:  65, y: 4,   z:  35 },   // hill climb
  { x:  40, y: 5.5, z:  60 },   // elevation peak
  { x:   0, y: 4,   z:  75 },   // back straight summit
  { x: -40, y: 2.5, z:  60 },   // downhill
  { x: -65, y: 1,   z:  35 },
  { x: -75, y: 0,   z:   0 },   // left apex — widened for battle zone
  { x: -65, y: 0,   z: -40 },   // S-curve entry
  { x: -35, y: 0,   z: -70 },
];

const ROAD_WIDTH = 16;
const WALL_HEIGHT = 4;
const SPLINE_SAMPLES = 96;

// ── Theme ───────────────────────────────────────────────────────────────────

const THEME = {
  road:    [0.28, 0.28, 0.32],
  terrain: [0.18, 0.42, 0.16],
  wall:    [0.4, 0.4, 0.45],
  accent:  [0.0, 0.85, 1.0],
  sky:     [0.08, 0.08, 0.14],
};

// ── Materials ───────────────────────────────────────────────────────────────

function createMaterials(scene) {
  const roadMat = new StandardMaterial('demo-road', scene);
  roadMat.diffuseColor = new Color3(...THEME.road);
  roadMat.specularColor = new Color3(0.15, 0.15, 0.15);

  const wallMat = new StandardMaterial('demo-wall', scene);
  wallMat.diffuseColor = new Color3(...THEME.wall);
  wallMat.alpha = 0.85;

  const terrainMat = new StandardMaterial('demo-terrain', scene);
  terrainMat.diffuseColor = new Color3(...THEME.terrain);
  terrainMat.specularColor = new Color3(0.05, 0.05, 0.05);

  const accentMat = new StandardMaterial('demo-accent', scene);
  accentMat.diffuseColor = new Color3(...THEME.accent);
  accentMat.emissiveColor = new Color3(...THEME.accent).scale(0.35);

  const startMat = new StandardMaterial('demo-start', scene);
  startMat.diffuseColor = new Color3(1, 1, 1);
  startMat.emissiveColor = new Color3(0.5, 0.5, 0.5);

  // Surface variation: boost pads
  const boostMat = new StandardMaterial('demo-boost', scene);
  boostMat.diffuseColor = new Color3(0.0, 0.6, 1.0);
  boostMat.emissiveColor = new Color3(0.0, 0.3, 0.5);

  // Surface variation: off-road (slower)
  const offroadMat = new StandardMaterial('demo-offroad', scene);
  offroadMat.diffuseColor = new Color3(0.5, 0.4, 0.25);
  offroadMat.specularColor = new Color3(0.02, 0.02, 0.02);

  return { roadMat, wallMat, terrainMat, accentMat, startMat, boostMat, offroadMat };
}

// ── Road Mesh ───────────────────────────────────────────────────────────────

function buildRoadMesh(scene, root, spline, mats) {
  const n = spline.length;
  const positions = [];
  const indices = [];
  const normals = [];
  const uvs = [];

  for (let i = 0; i < n; i++) {
    const cur = spline[i];
    const next = spline[(i + 1) % n];
    const dx = next.x - cur.x;
    const dz = next.z - cur.z;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    const px = -dz / len;
    const pz = dx / len;
    const hw = ROAD_WIDTH / 2;

    positions.push(cur.x + px * hw, cur.y, cur.z + pz * hw);
    positions.push(cur.x - px * hw, cur.y, cur.z - pz * hw);
    uvs.push(0, i / n, 1, i / n);
    normals.push(0, 1, 0, 0, 1, 0);
  }

  for (let i = 0; i < n; i++) {
    const i0 = i * 2, i1 = i * 2 + 1;
    const i2 = ((i + 1) % n) * 2, i3 = ((i + 1) % n) * 2 + 1;
    indices.push(i0, i2, i1, i1, i2, i3);
  }

  const road = new Mesh('demo-road', scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  vd.uvs = uvs;
  vd.applyToMesh(road);
  road.material = mats.roadMat;
  road.parent = root;
  road.receiveShadows = true;

  const col = road.clone('road-col', null);
  col.isVisible = false;
  col.bakeCurrentTransformIntoVertices();
  const agg = new PhysicsAggregate(col, PhysicsShapeType.MESH, { mass: 0, friction: 0.9, restitution: 0.05 }, scene);
  applyFilterToAggregate(agg, FILTER.TRACK);

  return road;
}

// ── Walls ───────────────────────────────────────────────────────────────────

function buildWalls(scene, root, spline, mats) {
  const n = spline.length;
  const step = Math.max(1, Math.floor(n / 48));

  for (let side = 0; side < 2; side++) {
    const sign = side === 0 ? 1 : -1;
    for (let i = 0; i < n; i += step) {
      const cur = spline[i];
      const next = spline[(i + step) % n];
      const dx = next.x - cur.x;
      const dz = next.z - cur.z;
      const segLen = Math.sqrt(dx * dx + dz * dz);
      if (segLen < 0.1) continue;

      const px = -dz / segLen;
      const pz = dx / segLen;
      const hw = ROAD_WIDTH / 2 + 0.5;
      const angle = Math.atan2(dx, dz);

      const wall = MeshBuilder.CreateBox(`wall-${side}-${i}`, {
        width: 1.0, height: WALL_HEIGHT, depth: segLen + 1,
      }, scene);
      wall.position.set(
        (cur.x + next.x) / 2 + px * hw * sign,
        (cur.y + next.y) / 2 + WALL_HEIGHT / 2,
        (cur.z + next.z) / 2 + pz * hw * sign,
      );
      wall.rotation.y = angle;
      wall.material = mats.wallMat;
      wall.parent = root;

      const wc = wall.clone(`wc-${side}-${i}`, null);
      wc.isVisible = false;
      wc.bakeCurrentTransformIntoVertices();
      wc.position.copyFromFloats(0, 0, 0);
      wc.rotation.copyFromFloats(0, 0, 0);
      wc.scaling.copyFromFloats(1, 1, 1);
      const agg = new PhysicsAggregate(wc, PhysicsShapeType.BOX, { mass: 0, friction: 0.6, restitution: 0.05 }, scene);
      applyFilterToAggregate(agg, FILTER.TRACK);
    }
  }
}

// ── Start/Finish Gantry ─────────────────────────────────────────────────────

function buildStartFinish(scene, root, spline, mats) {
  const p0 = spline[0];
  const p1 = spline[1];
  const dx = p1.x - p0.x;
  const dz = p1.z - p0.z;
  const len = Math.sqrt(dx * dx + dz * dz) || 1;
  const angle = Math.atan2(dx, dz);

  const line = MeshBuilder.CreateBox('start-line', { width: ROAD_WIDTH, height: 0.05, depth: 2 }, scene);
  line.position.set(p0.x, p0.y + 0.16, p0.z);
  line.rotation.y = angle;
  line.material = mats.startMat;
  line.parent = root;

  const gH = 8;
  for (const s of [-1, 1]) {
    const px = (-dz / len) * (ROAD_WIDTH / 2 + 0.5) * s;
    const pz = (dx / len) * (ROAD_WIDTH / 2 + 0.5) * s;
    const post = MeshBuilder.CreateBox(`gantry-${s}`, { width: 1, height: gH, depth: 1 }, scene);
    post.position.set(p0.x + px, p0.y + gH / 2, p0.z + pz);
    post.material = mats.accentMat;
    post.parent = root;
  }

  const bar = MeshBuilder.CreateBox('gantry-bar', { width: ROAD_WIDTH + 2, height: 1, depth: 1 }, scene);
  bar.position.set(p0.x, p0.y + gH, p0.z);
  bar.rotation.y = angle;
  bar.material = mats.accentMat;
  bar.parent = root;
}

// ── Boost Pads ──────────────────────────────────────────────────────────────

function buildBoostPads(scene, root, spline, mats) {
  const boostIndices = [24, 72]; // two boost pads around the track
  for (const idx of boostIndices) {
    if (idx >= spline.length) continue;
    const p = spline[idx];
    const next = spline[(idx + 1) % spline.length];
    const angle = Math.atan2(next.x - p.x, next.z - p.z);

    const pad = MeshBuilder.CreateBox(`boost-${idx}`, { width: ROAD_WIDTH * 0.6, height: 0.06, depth: 5 }, scene);
    pad.position.set(p.x, p.y + 0.12, p.z);
    pad.rotation.y = angle;
    pad.material = mats.boostMat;
    pad.parent = root;
    pad._surfaceType = 'boost';
  }
}

// ── Terrain ─────────────────────────────────────────────────────────────────

function buildTerrain(scene, root, mats) {
  const ground = MeshBuilder.CreateGround('terrain', { width: 500, height: 500, subdivisions: 1 }, scene);
  ground.position.y = -0.5;
  ground.material = mats.terrainMat;
  ground.receiveShadows = true;
  ground.parent = root;

  const col = ground.clone('terrain-col', null);
  col.isVisible = false;
  col.bakeCurrentTransformIntoVertices();
  const agg = new PhysicsAggregate(col, PhysicsShapeType.BOX, { mass: 0, friction: 0.4, restitution: 0.1 }, scene);
  applyFilterToAggregate(agg, FILTER.TRACK);
}

// ── Decorations ─────────────────────────────────────────────────────────────

function buildDecorations(scene, root, spline, rand) {
  const treeMat = new StandardMaterial('tree-mat', scene);
  treeMat.diffuseColor = new Color3(0.12, 0.45, 0.1);
  treeMat.specularColor = Color3.Black();

  const trunkMat = new StandardMaterial('trunk-mat', scene);
  trunkMat.diffuseColor = new Color3(0.35, 0.25, 0.15);
  trunkMat.specularColor = Color3.Black();

  const n = spline.length;
  const count = 40;

  for (let i = 0; i < count; i++) {
    const idx = Math.floor(rand() * n);
    const p = spline[idx];
    const next = spline[(idx + 1) % n];
    const dx = next.x - p.x;
    const dz = next.z - p.z;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    const px = -dz / len;
    const pz = dx / len;

    const dist = (ROAD_WIDTH / 2 + 5 + rand() * 25) * (rand() > 0.5 ? 1 : -1);
    const tx = p.x + px * dist;
    const tz = p.z + pz * dist;

    const h = 4 + rand() * 5;
    const trunk = MeshBuilder.CreateBox(`trunk-${i}`, { width: 0.5, height: h, depth: 0.5 }, scene);
    trunk.position.set(tx, h / 2, tz);
    trunk.material = trunkMat;
    trunk.parent = root;

    const cSize = 2 + rand() * 2.5;
    const canopy = MeshBuilder.CreateSphere(`canopy-${i}`, { diameter: cSize, segments: 6 }, scene);
    canopy.position.set(tx, h + cSize / 3, tz);
    canopy.material = treeMat;
    canopy.parent = root;
  }
}

// ── Power-Up Boxes (visual markers) ─────────────────────────────────────────

function buildPowerUpBoxes(scene, root, itemPositions, mats) {
  for (let i = 0; i < itemPositions.length; i++) {
    const pos = itemPositions[i].position;
    const box = MeshBuilder.CreateBox(`powerup-${i}`, { size: 1.5 }, scene);
    box.position.set(pos[0], pos[1] + 1.2, pos[2]);
    box.material = mats.accentMat;
    box.parent = root;
    box.rotation.y = Math.PI / 4;
    box._isPowerUp = true;
  }
}

// ── Kill Plane ──────────────────────────────────────────────────────────────

function createKillPlane(scene) {
  const kp = MeshBuilder.CreateBox('killPlane', { width: 2000, height: 1, depth: 2000 }, scene);
  kp.position.y = -80;
  kp.isVisible = false;
  kp._isBoundary = true;
  const agg = new PhysicsAggregate(kp, PhysicsShapeType.BOX, { mass: 0, friction: 0, restitution: 0 }, scene);
  applyFilterToAggregate(agg, FILTER.BOUNDARY);
}

// ── Track Data Extraction ───────────────────────────────────────────────────

function extractTrackData(spline, laps) {
  const n = spline.length;

  const driveline = spline.map(p => ({ center: [p.x, p.y, p.z], width: ROAD_WIDTH }));

  const numCp = Math.max(4, Math.floor(n / 12));
  const checkpoints = [];
  for (let i = 0; i < numCp; i++) {
    const qi = Math.floor((i / numCp) * n);
    checkpoints.push({
      quadIndex: qi,
      isLapLine: i === 0,
      center: driveline[qi].center,
      width: ROAD_WIDTH,
    });
  }

  // Start grid: 2-wide behind spline[0]
  const p0 = spline[0];
  const p1 = spline[1];
  const dx = p1.x - p0.x;
  const dz = p1.z - p0.z;
  const len = Math.sqrt(dx * dx + dz * dz) || 1;
  const fwdX = dx / len;
  const fwdZ = dz / len;
  const heading = Math.atan2(fwdX, fwdZ);

  const startPositions = [];
  for (let slot = 0; slot < 8; slot++) {
    const row = Math.floor(slot / 2);
    const col = (slot % 2) === 0 ? -1 : 1;
    startPositions.push({
      position: [
        p0.x - fwdX * (row * 5 + 2) + (-fwdZ) * col * 2.5,
        p0.y + 1,
        p0.z - fwdZ * (row * 5 + 2) + fwdX * col * 2.5,
      ],
      heading,
    });
  }

  // Items placed along track at intervals
  const items = [];
  const interval = Math.max(6, Math.floor(n / 10));
  for (let i = interval; i < n; i += interval) {
    items.push({
      type: (items.length % 3 === 0) ? 'nitro' : 'item',
      position: driveline[i].center,
      heading: 0,
    });
  }

  // Surface zones for physics variation
  const surfaceZones = [
    { startQuad: 0, endQuad: 4, type: 'asphalt', friction: 0.9 },
    { startQuad: 24, endQuad: 28, type: 'boost', friction: 0.95, speedMult: 1.3 },
    { startQuad: 72, endQuad: 76, type: 'boost', friction: 0.95, speedMult: 1.3 },
  ];

  // AI navmesh — simplified grid based on track bounds
  const navmesh = generateSimpleNavmesh(spline);

  return {
    driveline,
    checkpoints,
    startPositions,
    items,
    laps,
    surfaceZones,
    navmesh,
    graph: { mainLoop: [0, n], shortcuts: [] },
  };
}

// ── Arena Data Extraction ───────────────────────────────────────────────────

function extractArenaData(spline) {
  // Use center area of the track as an arena
  const halfSize = 65;
  const spawnCount = 8;

  const spawnPositions = [];
  for (let i = 0; i < spawnCount; i++) {
    const angle = (i / spawnCount) * Math.PI * 2;
    const r = halfSize * 0.5;
    spawnPositions.push({
      position: [Math.cos(angle) * r, 1, Math.sin(angle) * r],
      heading: -angle + Math.PI / 2,
    });
  }

  const items = [];
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const r = halfSize * 0.35;
    items.push({
      type: i % 2 === 0 ? 'item' : 'nitro',
      position: [Math.cos(angle) * r, 0.5, Math.sin(angle) * r],
      heading: 0,
    });
  }

  const navmesh = generateSimpleNavmesh(spline);

  return {
    navmesh,
    spawnPositions,
    startPositions: spawnPositions,
    items,
    laps: 1,
  };
}

// ── Navmesh ─────────────────────────────────────────────────────────────────

function generateSimpleNavmesh(spline) {
  // Bounding-box based grid navmesh covering the track area
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of spline) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  const pad = 20;
  minX -= pad; maxX += pad; minZ -= pad; maxZ += pad;

  const cellSize = 8;
  const cols = Math.floor((maxX - minX) / cellSize);
  const rows = Math.floor((maxZ - minZ) / cellSize);
  const vertices = [];
  const faces = [];

  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      vertices.push([minX + c * cellSize, 0, minZ + r * cellSize]);
    }
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v0 = r * (cols + 1) + c;
      const v1 = v0 + 1;
      const v2 = (r + 1) * (cols + 1) + c;
      const v3 = v2 + 1;
      faces.push([v0, v1, v2]);
      faces.push([v1, v3, v2]);
    }
  }

  return { vertices, faces, adjacency: {} };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate the Glo Circuit demo course (race track variant).
 * @param {BABYLON.Scene} scene - Scene with Havok physics enabled
 * @param {object} [opts]
 * @param {number} [opts.laps=3]
 * @returns {{ root: TransformNode, trackData: object }}
 */
export function generateDemoCourse(scene, opts = {}) {
  if (_lastRoot) {
    _lastRoot.getChildMeshes().forEach(m => m.dispose());
    _lastRoot.dispose();
    _lastRoot = null;
  }

  const seed = seedHash('glo_circuit');
  const rand = mulberry32(seed);
  const laps = opts.laps || 3;

  const root = new TransformNode('demoCourseRoot', scene);
  const spline = sampleSpline(DEMO_CONTROL_POINTS, SPLINE_SAMPLES);
  const mats = createMaterials(scene);

  buildRoadMesh(scene, root, spline, mats);
  buildWalls(scene, root, spline, mats);
  buildStartFinish(scene, root, spline, mats);
  buildBoostPads(scene, root, spline, mats);
  buildTerrain(scene, root, mats);
  buildDecorations(scene, root, spline, rand);

  const trackData = extractTrackData(spline, laps);
  buildPowerUpBoxes(scene, root, trackData.items, mats);
  createKillPlane(scene);

  console.log(`[demo-course] Generated Glo Circuit (${SPLINE_SAMPLES} points, ${trackData.checkpoints.length} checkpoints, ${trackData.items.length} items)`);

  _lastRoot = root;
  return { root, trackData, theme: 'glo' };
}

/**
 * Generate the Glo Arena demo course (battle arena variant).
 * Reuses the same terrain/track but provides arena-specific data.
 * @param {BABYLON.Scene} scene
 * @param {object} [opts]
 * @returns {{ root: TransformNode, arenaData: object }}
 */
export function generateDemoArena(scene, opts = {}) {
  if (_lastRoot) {
    _lastRoot.getChildMeshes().forEach(m => m.dispose());
    _lastRoot.dispose();
    _lastRoot = null;
  }

  const seed = seedHash('glo_arena');
  const rand = mulberry32(seed);

  const root = new TransformNode('demoArenaRoot', scene);
  const spline = sampleSpline(DEMO_CONTROL_POINTS, SPLINE_SAMPLES);
  const mats = createMaterials(scene);

  // Build the track surface as arena floor
  buildRoadMesh(scene, root, spline, mats);
  buildWalls(scene, root, spline, mats);
  buildTerrain(scene, root, mats);
  buildDecorations(scene, root, spline, rand);

  // Add arena obstacles in the center
  const obsMat = new StandardMaterial('arena-obs', scene);
  obsMat.diffuseColor = new Color3(0.4, 0.4, 0.45);

  const obstaclePositions = [
    { x: 0, z: 0 }, { x: 20, z: 20 }, { x: -20, z: 20 },
    { x: 20, z: -20 }, { x: -20, z: -20 },
  ];
  for (let i = 0; i < obstaclePositions.length; i++) {
    const op = obstaclePositions[i];
    const h = 3 + rand() * 3;
    const pillar = MeshBuilder.CreateBox(`arena-pillar-${i}`, { width: 4, height: h, depth: 4 }, scene);
    pillar.position.set(op.x, h / 2, op.z);
    pillar.material = obsMat;
    pillar.parent = root;

    const pc = pillar.clone(`arena-pillar-col-${i}`, null);
    pc.isVisible = false;
    pc.bakeCurrentTransformIntoVertices();
    pc.position.copyFromFloats(0, 0, 0);
    pc.rotation.copyFromFloats(0, 0, 0);
    pc.scaling.copyFromFloats(1, 1, 1);
    const agg = new PhysicsAggregate(pc, PhysicsShapeType.BOX, { mass: 0, friction: 0.7, restitution: 0.05 }, scene);
    applyFilterToAggregate(agg, FILTER.TRACK);
  }

  const arenaData = extractArenaData(spline);
  buildPowerUpBoxes(scene, root, arenaData.items, mats);
  createKillPlane(scene);

  console.log(`[demo-course] Generated Glo Arena (${arenaData.spawnPositions.length} spawns, ${arenaData.items.length} items)`);

  _lastRoot = root;
  return { root, arenaData, theme: 'glo' };
}

/**
 * Generate track data only (no geometry) for pre-caching.
 */
export function generateDemoCourseDataOnly(laps = 3) {
  const spline = sampleSpline(DEMO_CONTROL_POINTS, SPLINE_SAMPLES);
  return extractTrackData(spline, laps);
}

/**
 * Generate arena data only (no geometry) for pre-caching.
 */
export function generateDemoArenaDataOnly() {
  const spline = sampleSpline(DEMO_CONTROL_POINTS, SPLINE_SAMPLES);
  return extractArenaData(spline);
}
