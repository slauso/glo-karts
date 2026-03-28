/**
 * glo-flux-arena.js — Procedural post-apocalyptic wasteland generator for gloFLUX.
 *
 * Generates:
 *   - Ruined terrain with noise heightmap
 *   - Radiation pools, fungal growths, collapsed structures
 *   - Shrinking boundary for battle-royale variant
 *   - Race-circuit variant with wasteland driveline
 *   - Dynamic arena evolution based on player power-up chains
 *
 * 100% procedural — zero external assets.
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PhysicsAggregate } from '@babylonjs/core/Physics/v2/physicsAggregate';
import { PhysicsShapeType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import { FILTER, applyFilterToAggregate } from '../realtime/collision-layers.js';

// ── Seeded PRNG ─────────────────────────────────────────────────────────────

function seedHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Simple 2D Perlin-ish noise from seeded PRNG
function noiseGrid(rand, size) {
  const grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i++) grid[i] = rand() * 2 - 1;
  return grid;
}

function sampleNoise(grid, size, x, z) {
  const gx = ((x % size) + size) % size;
  const gz = ((z % size) + size) % size;
  const ix = Math.floor(gx), iz = Math.floor(gz);
  const fx = gx - ix, fz = gz - iz;
  const i00 = grid[iz * size + ix];
  const i10 = grid[iz * size + ((ix + 1) % size)];
  const i01 = grid[((iz + 1) % size) * size + ix];
  const i11 = grid[((iz + 1) % size) * size + ((ix + 1) % size)];
  const mx = fx * fx * (3 - 2 * fx);
  const mz = fz * fz * (3 - 2 * fz);
  return (i00 * (1 - mx) + i10 * mx) * (1 - mz) + (i01 * (1 - mx) + i11 * mx) * mz;
}

// ── Wasteland Themes ────────────────────────────────────────────────────────

const WASTELAND_THEMES = {
  nuclear_desert: {
    groundColor: new Color3(0.25, 0.2, 0.12),
    rubbleColor: new Color3(0.35, 0.28, 0.18),
    hazardColor: new Color3(0.1, 0.8, 0.2),
    skyColor: new Color3(0.15, 0.1, 0.05),
    fogDensity: 0.015,
  },
  fungal_wastes: {
    groundColor: new Color3(0.12, 0.15, 0.08),
    rubbleColor: new Color3(0.2, 0.25, 0.12),
    hazardColor: new Color3(0.5, 0.05, 0.6),
    skyColor: new Color3(0.08, 0.12, 0.05),
    fogDensity: 0.025,
  },
  frozen_fallout: {
    groundColor: new Color3(0.3, 0.32, 0.35),
    rubbleColor: new Color3(0.4, 0.42, 0.45),
    hazardColor: new Color3(0.0, 0.6, 0.9),
    skyColor: new Color3(0.1, 0.12, 0.18),
    fogDensity: 0.01,
  },
  molten_ruins: {
    groundColor: new Color3(0.2, 0.08, 0.04),
    rubbleColor: new Color3(0.3, 0.12, 0.06),
    hazardColor: new Color3(1.0, 0.4, 0.0),
    skyColor: new Color3(0.15, 0.05, 0.02),
    fogDensity: 0.02,
  },
  // 20.21 — expanded content depth
  void_rift: {
    groundColor: new Color3(0.05, 0.02, 0.12),
    rubbleColor: new Color3(0.1, 0.05, 0.18),
    hazardColor: new Color3(0.6, 0.0, 1.0),
    skyColor: new Color3(0.03, 0.01, 0.08),
    fogDensity: 0.03,
  },
  coral_overgrowth: {
    groundColor: new Color3(0.15, 0.18, 0.12),
    rubbleColor: new Color3(0.22, 0.28, 0.15),
    hazardColor: new Color3(0.9, 0.2, 0.4),
    skyColor: new Color3(0.06, 0.1, 0.06),
    fogDensity: 0.018,
  },
};
const THEME_NAMES = Object.keys(WASTELAND_THEMES);

// ── Arena Variants ──────────────────────────────────────────────────────────

export const ARENA_VARIANT = Object.freeze({
  RACE:  'race',   // Circuit with laps
  ARENA: 'arena',  // Shrinking battle royale field
});

// ── Material Factory ────────────────────────────────────────────────────────

function _mats(scene, theme) {
  const ground = new StandardMaterial('gf_ground', scene);
  ground.diffuseColor = theme.groundColor;
  ground.specularColor = Color3.Black();
  ground.backFaceCulling = false;

  const rubble = new StandardMaterial('gf_rubble', scene);
  rubble.diffuseColor = theme.rubbleColor;
  rubble.specularColor = new Color3(0.05, 0.05, 0.05);

  const hazard = new StandardMaterial('gf_hazard', scene);
  hazard.diffuseColor = theme.hazardColor;
  hazard.emissiveColor = theme.hazardColor.scale(0.4);
  hazard.alpha = 0.7;

  const wall = new StandardMaterial('gf_wall', scene);
  wall.diffuseColor = theme.rubbleColor.scale(0.6);
  wall.specularColor = Color3.Black();

  return { ground, rubble, hazard, wall };
}

// ── Terrain Generation ──────────────────────────────────────────────────────

function buildWastelandTerrain(scene, root, halfSize, rand, theme, mats) {
  const subdivisions = 64;
  const ground = MeshBuilder.CreateGround('gf_terrain', {
    width: halfSize * 2,
    height: halfSize * 2,
    subdivisions,
    updatable: true,
  }, scene);
  ground.material = mats.ground;
  ground.parent = root;

  // Apply noise heightmap
  const positions = ground.getVerticesData('position');
  const noiseSize = 32;
  const grid = noiseGrid(rand, noiseSize);
  const scale = 0.15;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], z = positions[i + 2];
    const nx = (x / halfSize) * noiseSize * 0.5 + noiseSize * 0.5;
    const nz = (z / halfSize) * noiseSize * 0.5 + noiseSize * 0.5;
    positions[i + 1] = sampleNoise(grid, noiseSize, nx, nz) * halfSize * scale;
  }
  ground.updateVerticesData('position', positions);
  ground.createNormals(true);

  // Physics collider
  const agg = new PhysicsAggregate(ground, PhysicsShapeType.MESH, { mass: 0, friction: 0.9 }, scene);
  applyFilterToAggregate(agg, FILTER.TRACK);

  return { ground, noiseGrid: grid, noiseSize };
}

// ── Hazard Zones (Radiation Pools / Fungal Growths) ─────────────────────────

function buildHazardZones(scene, root, halfSize, rand, mats, count) {
  const zones = [];
  for (let i = 0; i < count; i++) {
    const x = (rand() - 0.5) * halfSize * 1.4;
    const z = (rand() - 0.5) * halfSize * 1.4;
    const radius = 3 + rand() * 5;
    const pool = MeshBuilder.CreateDisc(`gf_hazard_${i}`, {
      radius, tessellation: 24,
    }, scene);
    pool.rotation.x = Math.PI / 2;
    pool.position.set(x, 0.05, z);
    pool.material = mats.hazard;
    pool.parent = root;
    zones.push({ mesh: pool, position: [x, 0, z], radius, type: 'radiation' });
  }
  return zones;
}

// ── Ruins / Rubble ──────────────────────────────────────────────────────────

function buildRuins(scene, root, halfSize, rand, mats, count) {
  const ruins = [];
  for (let i = 0; i < count; i++) {
    const x = (rand() - 0.5) * halfSize * 1.6;
    const z = (rand() - 0.5) * halfSize * 1.6;
    const w = 2 + rand() * 6;
    const h = 1 + rand() * 4;
    const d = 2 + rand() * 6;

    const box = MeshBuilder.CreateBox(`gf_ruin_${i}`, { width: w, height: h, depth: d }, scene);
    box.position.set(x, h / 2, z);
    box.rotation.y = rand() * Math.PI * 2;
    box.material = mats.rubble;
    box.parent = root;

    const agg = new PhysicsAggregate(box, PhysicsShapeType.BOX, { mass: 0, friction: 0.7 }, scene);
    applyFilterToAggregate(agg, FILTER.TRACK);

    ruins.push({ mesh: box, position: [x, h / 2, z], size: [w, h, d] });
  }
  return ruins;
}

// ── Perimeter Walls ─────────────────────────────────────────────────────────

function buildPerimeter(scene, root, halfSize, wallHeight, mats) {
  const sides = [
    { pos: [0, wallHeight / 2, halfSize], size: [halfSize * 2, wallHeight, 1] },
    { pos: [0, wallHeight / 2, -halfSize], size: [halfSize * 2, wallHeight, 1] },
    { pos: [halfSize, wallHeight / 2, 0], size: [1, wallHeight, halfSize * 2] },
    { pos: [-halfSize, wallHeight / 2, 0], size: [1, wallHeight, halfSize * 2] },
  ];
  for (let i = 0; i < sides.length; i++) {
    const s = sides[i];
    const wall = MeshBuilder.CreateBox(`gf_wall_${i}`, {
      width: s.size[0], height: s.size[1], depth: s.size[2],
    }, scene);
    wall.position.set(s.pos[0], s.pos[1], s.pos[2]);
    wall.material = mats.wall;
    wall.parent = root;
    const agg = new PhysicsAggregate(wall, PhysicsShapeType.BOX, { mass: 0, friction: 0.5 }, scene);
    applyFilterToAggregate(agg, FILTER.BOUNDARY);
  }
}

// ── Kill Plane ──────────────────────────────────────────────────────────────

function buildKillPlane(scene) {
  const kp = MeshBuilder.CreateGround('gf_killplane', { width: 500, height: 500 }, scene);
  kp.position.y = -20;
  kp.isVisible = false;
  const agg = new PhysicsAggregate(kp, PhysicsShapeType.BOX, { mass: 0 }, scene);
  applyFilterToAggregate(agg, FILTER.BOUNDARY);
}

// ── Spawn Points ────────────────────────────────────────────────────────────

function generateSpawns(halfSize, count, rand) {
  const spawns = [];
  const margin = halfSize * 0.6;
  for (let i = 0; i < count; i++) {
    spawns.push({
      position: [
        (rand() - 0.5) * margin * 2,
        2,
        (rand() - 0.5) * margin * 2,
      ],
      heading: rand() * Math.PI * 2,
    });
  }
  return spawns;
}

// ── Power-Up Spawn Locations ────────────────────────────────────────────────

function generatePowerSpawns(halfSize, rand, count) {
  const items = [];
  for (let i = 0; i < count; i++) {
    items.push({
      type: 'gloflux_power',
      position: [
        (rand() - 0.5) * halfSize * 1.2,
        1.5,
        (rand() - 0.5) * halfSize * 1.2,
      ],
    });
  }
  return items;
}

// ── Race Circuit Generation (for Race variant) ──────────────────────────────

function generateRaceCircuit(halfSize, rand) {
  const points = 12;
  const driveline = [];
  const angleStep = (Math.PI * 2) / points;
  const baseRadius = halfSize * 0.6;

  for (let i = 0; i < points; i++) {
    const angle = i * angleStep;
    const r = baseRadius + (rand() - 0.5) * halfSize * 0.3;
    driveline.push({
      center: [Math.cos(angle) * r, 0.5, Math.sin(angle) * r],
      width: 12 + rand() * 4,
    });
  }

  const checkpoints = [];
  const cpCount = Math.max(4, Math.floor(points / 2));
  for (let i = 0; i < cpCount; i++) {
    const idx = Math.floor((i / cpCount) * driveline.length);
    checkpoints.push({
      quadIndex: idx,
      isLapLine: i === 0,
      center: driveline[idx].center,
      width: driveline[idx].width,
    });
  }

  // Start grid
  const p0 = driveline[0].center;
  const p1 = driveline[1].center;
  const dx = p1[0] - p0[0], dz = p1[2] - p0[2];
  const len = Math.sqrt(dx * dx + dz * dz) || 1;
  const heading = Math.atan2(dx / len, dz / len);

  const startPositions = [];
  for (let slot = 0; slot < 12; slot++) {
    const row = Math.floor(slot / 2);
    const col = (slot % 2 === 0) ? -1 : 1;
    startPositions.push({
      position: [
        p0[0] - (dx / len) * (row * 5 + 2) + (-dz / len) * col * 2.5,
        2,
        p0[2] - (dz / len) * (row * 5 + 2) + (dx / len) * col * 2.5,
      ],
      heading,
    });
  }

  return { driveline, checkpoints, startPositions, laps: 5 };
}

// ── Shrink Boundary State (for Arena variant) ───────────────────────────────

/**
 * Create a shrinking boundary state for battle royale.
 * @param {number} initialHalfSize
 * @param {number} shrinkRate - Units per second to shrink
 * @returns {object}
 */
export function createShrinkState(initialHalfSize, shrinkRate = 0.5) {
  return {
    currentHalfSize: initialHalfSize,
    minHalfSize: 15,
    shrinkRate,
    shrinking: false,
    shrinkDelay: 30,   // seconds before shrink starts
    elapsed: 0,
  };
}

/**
 * Tick the shrink boundary.
 * @param {object} shrinkState
 * @param {number} dt
 * @returns {number} Current half size
 */
export function tickShrinkBoundary(shrinkState, dt) {
  shrinkState.elapsed += dt;
  if (shrinkState.elapsed >= shrinkState.shrinkDelay) {
    shrinkState.shrinking = true;
  }
  if (shrinkState.shrinking && shrinkState.currentHalfSize > shrinkState.minHalfSize) {
    shrinkState.currentHalfSize = Math.max(
      shrinkState.minHalfSize,
      shrinkState.currentHalfSize - shrinkState.shrinkRate * dt
    );
  }
  return shrinkState.currentHalfSize;
}

/**
 * Check if a position is outside the current shrink boundary.
 */
export function isOutsideBoundary(shrinkState, x, z) {
  const hs = shrinkState.currentHalfSize;
  return Math.abs(x) > hs || Math.abs(z) > hs;
}

// ── Arena Evolution (mutation based on player chains) ───────────────────────

/**
 * Apply arena mutations based on active synergies.
 * For now returns a list of mutation descriptors — actual mesh mutations
 * are applied by the orchestrator via VFX system.
 */
export function computeArenaMutations(activeSynergies) {
  const mutations = [];
  for (const syn of activeSynergies) {
    switch (syn.id) {
      case 'void_portal':
        mutations.push({ type: 'pull_zone', radius: 15, strength: 8 });
        break;
      case 'bio_psyche_bloom':
        mutations.push({ type: 'spore_forest', count: 6, radius: 10 });
        break;
      case 'phantom_entropy':
        mutations.push({ type: 'decay_field', radius: 12, damagePerSec: 5 });
        break;
      default:
        mutations.push({ type: 'radiation_spike', intensity: 1.2 });
    }
  }
  return mutations;
}

// ── Public API ──────────────────────────────────────────────────────────────

let _lastRoot = null;

/**
 * Generate a full gloFLUX wasteland arena with geometry + physics.
 * @param {string} mapId - Seed string
 * @param {BABYLON.Scene} scene
 * @param {object} opts
 * @returns {{ root, arenaData, theme, variant }}
 */
export function generateGloFluxArena(mapId, scene, opts = {}) {
  // Dispose previous
  if (_lastRoot) {
    _lastRoot.getChildMeshes().forEach(m => m.dispose());
    _lastRoot.dispose();
    _lastRoot = null;
  }

  const seed = seedHash(mapId || 'gloflux_default');
  const rand = mulberry32(seed);
  const halfSize = opts.halfSize || 60;
  const wallHeight = opts.wallHeight || 6;
  const variant = opts.variant || ARENA_VARIANT.ARENA;

  // Pick theme
  const themeName = THEME_NAMES[Math.floor(rand() * THEME_NAMES.length)];
  const theme = WASTELAND_THEMES[themeName];

  const root = new TransformNode('glofluxRoot', scene);
  const mats = _mats(scene, theme);

  // Atmosphere
  scene.clearColor = new Color4(theme.skyColor.r, theme.skyColor.g, theme.skyColor.b, 1);
  scene.fogMode = 2; // exponential
  scene.fogDensity = theme.fogDensity;
  scene.fogColor = theme.skyColor;

  // Build terrain
  const terrain = buildWastelandTerrain(scene, root, halfSize, rand, theme, mats);

  // Hazards (6-12)
  const hazardCount = 6 + Math.floor(rand() * 7);
  const hazardZones = buildHazardZones(scene, root, halfSize, rand, mats, hazardCount);

  // Ruins (8-16)
  const ruinCount = 8 + Math.floor(rand() * 9);
  const ruins = buildRuins(scene, root, halfSize, rand, mats, ruinCount);

  // Perimeter + kill plane
  buildPerimeter(scene, root, halfSize, wallHeight, mats);
  buildKillPlane(scene);

  // Power-up spawns (12-18)
  const powerSpawnCount = 12 + Math.floor(rand() * 7);
  const powerSpawns = generatePowerSpawns(halfSize, rand, powerSpawnCount);

  // Build variant-specific data
  let arenaData;
  if (variant === ARENA_VARIANT.RACE) {
    const circuit = generateRaceCircuit(halfSize, rand);
    arenaData = {
      ...circuit,
      items: powerSpawns,
      spawnPositions: circuit.startPositions,
      variant,
    };
  } else {
    const spawns = generateSpawns(halfSize, 12, rand);
    arenaData = {
      spawnPositions: spawns,
      startPositions: spawns,
      items: powerSpawns,
      laps: 0,
      variant,
    };
  }

  arenaData.hazardZones = hazardZones.map(z => ({ position: z.position, radius: z.radius, type: z.type }));
  arenaData.halfSize = halfSize;

  console.log(`[gloflux-arena] Generated "${mapId}" (theme=${themeName}, variant=${variant}, halfSize=${halfSize})`);

  _lastRoot = root;
  return { root, arenaData, theme: themeName, variant };
}

/**
 * Arena data only (no geometry) for pre-caching or tests.
 */
export function generateGloFluxArenaData(mapId, opts = {}) {
  const seed = seedHash(mapId || 'gloflux_default');
  const rand = mulberry32(seed);
  const halfSize = opts.halfSize || 60;
  const variant = opts.variant || ARENA_VARIANT.ARENA;

  const powerSpawns = generatePowerSpawns(halfSize, rand, 15);

  if (variant === ARENA_VARIANT.RACE) {
    const circuit = generateRaceCircuit(halfSize, rand);
    return { ...circuit, items: powerSpawns, variant, halfSize };
  }

  return {
    spawnPositions: generateSpawns(halfSize, 12, rand),
    startPositions: generateSpawns(halfSize, 12, rand),
    items: powerSpawns,
    laps: 0,
    variant,
    halfSize,
  };
}
