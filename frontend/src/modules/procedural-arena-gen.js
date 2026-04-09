/**
 * procedural-arena-gen.js — Advanced procedural battle arena generator.
 *
 * Generates complete, playable battle arenas from a seed string using
 * Babylon.js MeshBuilder. Produces navmesh, spawn points, item locations,
 * and themed obstacles. Zero asset downloads.
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PhysicsAggregate } from '@babylonjs/core/Physics/v2/physicsAggregate';
import { PhysicsShapeType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import { FILTER, applyFilterToAggregate } from './realtime/collision-layers.js';

let _lastArenaRoot = null;

// ── Seeded PRNG ─────────────────────────────────────────────────────────────

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

// ── Arena Theme Presets ─────────────────────────────────────────────────────

const ARENA_THEMES = {
  fortress:   { floor: [0.4, 0.38, 0.35], wall: [0.55, 0.5, 0.45], accent: [0.8, 0.6, 0.2], obstacle: [0.5, 0.45, 0.4] },
  ice:        { floor: [0.7, 0.8, 0.9],   wall: [0.6, 0.7, 0.85], accent: [0.2, 0.6, 1.0], obstacle: [0.5, 0.65, 0.8] },
  lava:       { floor: [0.3, 0.15, 0.1],  wall: [0.4, 0.2, 0.15], accent: [1.0, 0.4, 0.05],obstacle: [0.35, 0.18, 0.12] },
  neon:       { floor: [0.08, 0.08, 0.12],wall: [0.15, 0.05, 0.25],accent: [0.0, 1.0, 0.8], obstacle: [0.1, 0.08, 0.18] },
  garden:     { floor: [0.25, 0.5, 0.2],  wall: [0.4, 0.35, 0.25],accent: [1.0, 0.85, 0.3],obstacle: [0.3, 0.42, 0.22] },
  industrial: { floor: [0.35, 0.35, 0.38],wall: [0.45, 0.45, 0.48],accent: [1.0, 0.5, 0.0], obstacle: [0.4, 0.4, 0.42] },
  candy:      { floor: [0.95, 0.8, 0.85], wall: [0.9, 0.5, 0.6],  accent: [0.4, 0.9, 0.4], obstacle: [0.85, 0.7, 0.75] },
  space:      { floor: [0.1, 0.1, 0.15],  wall: [0.2, 0.15, 0.3], accent: [0.6, 0.3, 1.0], obstacle: [0.15, 0.12, 0.22] },
};

const THEME_NAMES = Object.keys(ARENA_THEMES);

// ── Arena Archetype Definitions ─────────────────────────────────────────────

const ARCHETYPES = ['open', 'corridors', 'pillared', 'multi_level', 'maze'];

// ── Material Factory ────────────────────────────────────────────────────────

function _mats(scene, theme) {
  const make = (name, rgb, alpha = 1) => {
    const m = new StandardMaterial(name, scene);
    m.diffuseColor = new Color3(...rgb);
    if (alpha < 1) m.alpha = alpha;
    m.specularColor = new Color3(0.1, 0.1, 0.1);
    return m;
  };
  return {
    floorMat: make('arena-floor', theme.floor),
    wallMat: make('arena-wall', theme.wall, 0.85),
    accentMat: (() => {
      const m = make('arena-accent', theme.accent);
      m.emissiveColor = new Color3(...theme.accent).scale(0.25);
      return m;
    })(),
    obsMat: make('arena-obstacle', theme.obstacle),
  };
}

// ── Collider Helper ─────────────────────────────────────────────────────────

function _addCollider(mesh, scene, filter = FILTER.TRACK) {
  const col = mesh.clone(mesh.name + '-col', null);
  col.isVisible = false;
  col.bakeCurrentTransformIntoVertices();
  col.position.copyFromFloats(0, 0, 0);
  col.rotation.copyFromFloats(0, 0, 0);
  col.scaling.copyFromFloats(1, 1, 1);
  const agg = new PhysicsAggregate(col, PhysicsShapeType.BOX, { mass: 0, friction: 0.7, restitution: 0.05 }, scene);
  applyFilterToAggregate(agg, filter);
}

// ── Floor Generation ────────────────────────────────────────────────────────

function buildFloor(scene, root, halfSize, mats) {
  const floor = MeshBuilder.CreateGround('arena-floor', { width: halfSize * 2, height: halfSize * 2, subdivisions: 1 }, scene);
  floor.position.y = 0;
  floor.material = mats.floorMat;
  floor.receiveShadows = true;
  floor.parent = root;

  // Use BOX collider for flat ground (more efficient than MESH)
  const floorCol = MeshBuilder.CreateBox('floor-col', { width: halfSize * 2, height: 0.3, depth: halfSize * 2 }, scene);
  floorCol.position.y = -0.15;
  floorCol.isVisible = false;
  const agg = new PhysicsAggregate(floorCol, PhysicsShapeType.BOX, { mass: 0, friction: 0.8, restitution: 0.05 }, scene);
  applyFilterToAggregate(agg, FILTER.TRACK);

  return floor;
}

// ── Perimeter Walls ─────────────────────────────────────────────────────────

function buildPerimeterWalls(scene, root, halfSize, wallHeight, mats) {
  const sides = [
    { x: 0, z: -halfSize, w: halfSize * 2, d: 1 },
    { x: 0, z: halfSize, w: halfSize * 2, d: 1 },
    { x: -halfSize, z: 0, w: 1, d: halfSize * 2 },
    { x: halfSize, z: 0, w: 1, d: halfSize * 2 },
  ];

  sides.forEach((s, i) => {
    const wall = MeshBuilder.CreateBox(`perim-wall-${i}`, { width: s.w, height: wallHeight, depth: s.d }, scene);
    wall.position.set(s.x, wallHeight / 2, s.z);
    wall.material = mats.wallMat;
    wall.parent = root;
    _addCollider(wall, scene, FILTER.TRACK);
  });
}

// ── Obstacle Generators ─────────────────────────────────────────────────────

function buildPillars(scene, root, rand, halfSize, wallHeight, mats, count) {
  const radius = halfSize * 0.5;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + rand() * 0.3;
    const r = radius * (0.3 + rand() * 0.7);
    const h = wallHeight * (0.8 + rand() * 0.6);
    const pillar = MeshBuilder.CreateBox(`pillar-${i}`, { width: 3, height: h, depth: 3 }, scene);
    pillar.position.set(r * Math.cos(angle), h / 2, r * Math.sin(angle));
    pillar.material = mats.obsMat;
    pillar.parent = root;
    _addCollider(pillar, scene);
  }
}

function buildBlocks(scene, root, rand, halfSize, wallHeight, mats, count) {
  for (let i = 0; i < count; i++) {
    const x = (rand() - 0.5) * halfSize * 1.4;
    const z = (rand() - 0.5) * halfSize * 1.4;
    const w = 4 + rand() * 8;
    const d = 4 + rand() * 8;
    const h = wallHeight * (0.3 + rand() * 0.5);
    const block = MeshBuilder.CreateBox(`block-${i}`, { width: w, height: h, depth: d }, scene);
    block.position.set(x, h / 2, z);
    block.rotation.y = rand() * Math.PI;
    block.material = mats.obsMat;
    block.parent = root;
    _addCollider(block, scene);
  }
}

function buildRamps(scene, root, rand, halfSize, wallHeight, mats, count) {
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const r = halfSize * 0.35;
    const ramp = MeshBuilder.CreateBox(`ramp-${i}`, { width: 8, height: 0.4, depth: 12 }, scene);
    ramp.position.set(r * Math.cos(angle), 1.5, r * Math.sin(angle));
    ramp.rotation.x = 0.2;
    ramp.rotation.y = angle + Math.PI;
    ramp.material = mats.accentMat;
    ramp.parent = root;
    _addCollider(ramp, scene);
  }
}

function buildCorridors(scene, root, rand, halfSize, wallHeight, mats) {
  // Cross-shaped interior walls creating 4 corridors
  const thickness = 1;
  const gapSize = 6;
  const wallLen = halfSize - gapSize;

  const segments = [
    // Horizontal left
    { x: -(gapSize + wallLen) / 2, z: 0, w: wallLen, d: thickness },
    // Horizontal right
    { x: (gapSize + wallLen) / 2, z: 0, w: wallLen, d: thickness },
    // Vertical top
    { x: 0, z: -(gapSize + wallLen) / 2, w: thickness, d: wallLen },
    // Vertical bottom
    { x: 0, z: (gapSize + wallLen) / 2, w: thickness, d: wallLen },
  ];

  segments.forEach((s, i) => {
    const wall = MeshBuilder.CreateBox(`corridor-${i}`, { width: s.w, height: wallHeight, depth: s.d }, scene);
    wall.position.set(s.x, wallHeight / 2, s.z);
    wall.material = mats.wallMat;
    wall.parent = root;
    _addCollider(wall, scene);
  });
}

function buildMultiLevel(scene, root, rand, halfSize, wallHeight, mats) {
  // Elevated platform in center with ramps
  const platSize = halfSize * 0.5;
  const platHeight = wallHeight * 0.6;

  const platform = MeshBuilder.CreateBox('platform', { width: platSize, height: 0.4, depth: platSize }, scene);
  platform.position.y = platHeight;
  platform.material = mats.accentMat;
  platform.parent = root;
  _addCollider(platform, scene);

  // 4 ramps leading up
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    const ramp = MeshBuilder.CreateBox(`plat-ramp-${i}`, { width: 6, height: 0.4, depth: platSize * 0.6 }, scene);
    const rampDist = platSize / 2 + platSize * 0.2;
    ramp.position.set(Math.cos(angle) * rampDist, platHeight / 2, Math.sin(angle) * rampDist);
    ramp.rotation.x = Math.atan2(platHeight, platSize * 0.6);
    ramp.rotation.y = angle + Math.PI;
    ramp.material = mats.obsMat;
    ramp.parent = root;
    _addCollider(ramp, scene);
  }
}

// ── Navmesh Generation ──────────────────────────────────────────────────────

function generateNavmesh(halfSize, obstacles) {
  // Simple grid-based navmesh
  const cellSize = 6;
  const gridSize = Math.floor((halfSize * 2) / cellSize);
  const vertices = [];
  const faces = [];
  const adjacency = {};

  // Create grid vertices
  for (let gz = 0; gz <= gridSize; gz++) {
    for (let gx = 0; gx <= gridSize; gx++) {
      vertices.push([
        -halfSize + gx * cellSize,
        0,
        -halfSize + gz * cellSize,
      ]);
    }
  }

  // Create grid faces (two triangles per cell)
  let faceIdx = 0;
  for (let gz = 0; gz < gridSize; gz++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const v0 = gz * (gridSize + 1) + gx;
      const v1 = v0 + 1;
      const v2 = (gz + 1) * (gridSize + 1) + gx;
      const v3 = v2 + 1;

      faces.push([v0, v1, v2]);
      faces.push([v1, v3, v2]);

      adjacency[faceIdx] = [];
      adjacency[faceIdx + 1] = [];

      // Adjacent faces
      if (faceIdx > 0) {
        adjacency[faceIdx].push(faceIdx - 1);
        adjacency[faceIdx - 1].push(faceIdx);
      }
      adjacency[faceIdx].push(faceIdx + 1);
      adjacency[faceIdx + 1].push(faceIdx);

      if (gx > 0) {
        const leftFace = faceIdx - 2;
        if (leftFace >= 0) {
          adjacency[faceIdx].push(leftFace + 1);
          adjacency[leftFace + 1].push(faceIdx);
        }
      }

      faceIdx += 2;
    }
  }

  return { vertices, faces, adjacency };
}

// ── Spawn & Item Placement ──────────────────────────────────────────────────

function generateSpawnPoints(halfSize, count) {
  const positions = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const radius = Math.max(12, halfSize * 0.5);
    positions.push({
      position: [Math.cos(angle) * radius, 1, Math.sin(angle) * radius],
      heading: -angle + Math.PI / 2,
    });
  }
  return positions;
}

function generateItemSpawns(halfSize, rand, count) {
  const items = [];
  for (let i = 0; i < count; i++) {
    const x = (rand() - 0.5) * halfSize * 1.2;
    const z = (rand() - 0.5) * halfSize * 1.2;
    items.push({
      type: i % 2 === 0 ? 'item' : 'nitro',
      position: [x, 0.5, z],
      heading: 0,
    });
  }
  return items;
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

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate a complete procedural battle arena with geometry + physics + navmesh.
 *
 * @param {string} mapId - Arena identifier (used as seed)
 * @param {BABYLON.Scene} scene - Babylon scene with Havok physics
 * @param {object} [opts]
 * @param {number} [opts.halfSize=50]
 * @param {number} [opts.wallHeight=5]
 * @param {number} [opts.spawnCount=8]
 * @returns {{ root: TransformNode, arenaData: object }}
 */
export function generateProceduralArena(mapId, scene, opts = {}) {
  // Dispose previous procedural arena if any
  if (_lastArenaRoot) {
    _lastArenaRoot.getChildMeshes().forEach(m => m.dispose());
    _lastArenaRoot.dispose();
    _lastArenaRoot = null;
  }

  const seed = seedHash(mapId || 'default_arena');
  const rand = mulberry32(seed);

  const halfSize = opts.halfSize || 50;
  const wallHeight = opts.wallHeight || 5;
  const spawnCount = opts.spawnCount || 8;

  // Deterministic theme selection
  const themeIndex = Math.floor(rand() * THEME_NAMES.length);
  const themeName = THEME_NAMES[themeIndex];
  const theme = ARENA_THEMES[themeName];

  // Deterministic archetype selection
  const archetype = ARCHETYPES[Math.floor(rand() * ARCHETYPES.length)];

  const root = new TransformNode('arenaRoot', scene);
  const mats = _mats(scene, theme);

  // Build floor + perimeter
  buildFloor(scene, root, halfSize, mats);
  buildPerimeterWalls(scene, root, halfSize, wallHeight, mats);

  // Build obstacles based on archetype
  switch (archetype) {
    case 'open':
      buildPillars(scene, root, rand, halfSize, wallHeight, mats, 4);
      break;
    case 'corridors':
      buildCorridors(scene, root, rand, halfSize, wallHeight, mats);
      buildPillars(scene, root, rand, halfSize, wallHeight, mats, 3);
      break;
    case 'pillared':
      buildPillars(scene, root, rand, halfSize, wallHeight, mats, 8 + Math.floor(rand() * 6));
      break;
    case 'multi_level':
      buildMultiLevel(scene, root, rand, halfSize, wallHeight, mats);
      buildRamps(scene, root, rand, halfSize, wallHeight, mats, 2);
      break;
    case 'maze':
      buildBlocks(scene, root, rand, halfSize, wallHeight, mats, 6 + Math.floor(rand() * 4));
      buildCorridors(scene, root, rand, halfSize, wallHeight, mats);
      break;
  }

  createKillPlane(scene);

  // Generate navmesh and game data
  const navmesh = generateNavmesh(halfSize, []);
  const spawnPositions = generateSpawnPoints(halfSize, spawnCount);
  const items = generateItemSpawns(halfSize, rand, 8);

  const arenaData = {
    navmesh,
    spawnPositions,
    startPositions: spawnPositions,
    items,
    laps: 1,
  };

  console.log(`[proc-arena] Generated "${mapId}" (theme=${themeName}, archetype=${archetype}, halfSize=${halfSize})`);

  _lastArenaRoot = root;
  return { root, arenaData, theme: themeName, archetype };
}

/**
 * Generate arena data only (no geometry) for pre-caching.
 */
export function generateArenaDataOnly(mapId, opts = {}) {
  const seed = seedHash(mapId || 'default_arena');
  const rand = mulberry32(seed);
  const halfSize = opts.halfSize || 50;
  const spawnCount = opts.spawnCount || 8;

  const navmesh = generateNavmesh(halfSize, []);
  const spawnPositions = generateSpawnPoints(halfSize, spawnCount);
  const items = generateItemSpawns(halfSize, rand, 8);

  return {
    navmesh,
    spawnPositions,
    startPositions: spawnPositions,
    items,
    laps: 1,
  };
}
