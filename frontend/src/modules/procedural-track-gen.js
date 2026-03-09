/**
 * procedural-track-gen.js — Advanced spline-based procedural track generator.
 *
 * Generates complete, drivable race tracks from a seed string using Catmull-Rom
 * splines, ribbon meshes, terrain, start/finish lines, item placements, and
 * themed procedural decorations. All geometry is Babylon.js MeshBuilder — zero
 * asset downloads required (except kart GLTFs).
 *
 * Produces a full track data bundle compatible with track-data-loader.js
 * (driveline, checkpoints, startPositions, items, graph) so bots, checkpoint
 * system, and minimap all work automatically.
 */

import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Quaternion } from '@babylonjs/core/Maths/math.vector';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PhysicsAggregate } from '@babylonjs/core/Physics/v2/physicsAggregate';
import { PhysicsShapeType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import { FILTER, applyFilterToAggregate } from './realtime/collision-layers.js';

let _lastTrackRoot = null;

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

// ── Track Theme Presets ─────────────────────────────────────────────────────

const TRACK_THEMES = {
  grasslands:  { road: [0.35, 0.35, 0.32], terrain: [0.28, 0.55, 0.18], wall: [0.5, 0.5, 0.45], accent: [1.0, 0.85, 0.2], sky: [0.55, 0.78, 1.0], fog: [0.55, 0.78, 1.0] },
  desert:      { road: [0.7, 0.6, 0.4],    terrain: [0.85, 0.75, 0.55], wall: [0.65, 0.5, 0.3],  accent: [1.0, 0.5, 0.1],  sky: [0.9, 0.82, 0.6], fog: [0.9, 0.82, 0.6] },
  snow:        { road: [0.6, 0.6, 0.65],   terrain: [0.9, 0.92, 0.95],  wall: [0.7, 0.72, 0.75], accent: [0.3, 0.7, 1.0],  sky: [0.75, 0.85, 1.0], fog: [0.75, 0.85, 1.0] },
  volcano:     { road: [0.3, 0.2, 0.2],    terrain: [0.25, 0.15, 0.1],  wall: [0.5, 0.2, 0.1],   accent: [1.0, 0.3, 0.05], sky: [0.15, 0.08, 0.05], fog: [0.2, 0.1, 0.05] },
  forest:      { road: [0.3, 0.28, 0.22],  terrain: [0.15, 0.4, 0.12],  wall: [0.35, 0.25, 0.15],accent: [0.1, 0.8, 0.3],  sky: [0.4, 0.6, 0.35], fog: [0.3, 0.45, 0.25] },
  neon:        { road: [0.1, 0.1, 0.15],   terrain: [0.05, 0.05, 0.08], wall: [0.2, 0.05, 0.3],  accent: [0.0, 1.0, 1.0],  sky: [0.02, 0.02, 0.05], fog: [0.02, 0.02, 0.05] },
  beach:       { road: [0.65, 0.6, 0.45],  terrain: [0.9, 0.85, 0.6],   wall: [0.5, 0.45, 0.3],  accent: [0.2, 0.7, 0.9],  sky: [0.5, 0.8, 1.0], fog: [0.5, 0.8, 1.0] },
  castle:      { road: [0.45, 0.42, 0.4],  terrain: [0.35, 0.38, 0.3],  wall: [0.55, 0.5, 0.48], accent: [0.8, 0.6, 0.2],  sky: [0.3, 0.35, 0.5], fog: [0.3, 0.35, 0.5] },
};

const THEME_NAMES = Object.keys(TRACK_THEMES);

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

// ── Control Point Generation ────────────────────────────────────────────────

function generateControlPoints(rand, complexity) {
  const numPoints = 8 + Math.floor(rand() * complexity * 6);
  const baseRadius = 50 + rand() * 60;
  const points = [];

  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * Math.PI * 2;
    const radiusVariation = baseRadius + (rand() - 0.5) * baseRadius * 0.5;
    const elevation = (rand() - 0.3) * 8;
    points.push({
      x: Math.cos(angle) * radiusVariation,
      y: Math.max(0, elevation),
      z: Math.sin(angle) * radiusVariation,
    });
  }

  return points;
}

// ── Materials ───────────────────────────────────────────────────────────────

function createTrackMaterials(scene, theme) {
  const roadMat = new StandardMaterial('road-mat', scene);
  roadMat.diffuseColor = new Color3(...theme.road);
  roadMat.specularColor = new Color3(0.1, 0.1, 0.1);

  const wallMat = new StandardMaterial('wall-mat', scene);
  wallMat.diffuseColor = new Color3(...theme.wall);
  wallMat.alpha = 0.8;

  const terrainMat = new StandardMaterial('terrain-mat', scene);
  terrainMat.diffuseColor = new Color3(...theme.terrain);
  terrainMat.specularColor = new Color3(0.05, 0.05, 0.05);

  const accentMat = new StandardMaterial('accent-mat', scene);
  accentMat.diffuseColor = new Color3(...theme.accent);
  accentMat.emissiveColor = new Color3(...theme.accent).scale(0.3);

  const startLineMat = new StandardMaterial('start-line-mat', scene);
  startLineMat.diffuseColor = new Color3(1, 1, 1);
  startLineMat.emissiveColor = new Color3(0.5, 0.5, 0.5);

  return { roadMat, wallMat, terrainMat, accentMat, startLineMat };
}

// ── Road Mesh Generation ────────────────────────────────────────────────────

function buildRoadMesh(scene, root, splinePoints, roadWidth, mats) {
  const n = splinePoints.length;
  const positions = [];
  const indices = [];
  const normals = [];
  const uvs = [];

  for (let i = 0; i < n; i++) {
    const cur = splinePoints[i];
    const next = splinePoints[(i + 1) % n];
    const dx = next.x - cur.x;
    const dz = next.z - cur.z;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    // Perpendicular in XZ plane
    const px = -dz / len;
    const pz = dx / len;

    const hw = roadWidth / 2;
    // Left vertex
    positions.push(cur.x + px * hw, cur.y, cur.z + pz * hw);
    // Right vertex
    positions.push(cur.x - px * hw, cur.y, cur.z - pz * hw);

    uvs.push(0, i / n);
    uvs.push(1, i / n);

    normals.push(0, 1, 0);
    normals.push(0, 1, 0);
  }

  // Triangulate as a strip
  for (let i = 0; i < n; i++) {
    const i0 = i * 2;
    const i1 = i * 2 + 1;
    const i2 = ((i + 1) % n) * 2;
    const i3 = ((i + 1) % n) * 2 + 1;
    indices.push(i0, i2, i1);
    indices.push(i1, i2, i3);
  }

  const road = new Mesh('road', scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  vd.uvs = uvs;
  vd.applyToMesh(road);
  road.material = mats.roadMat;
  road.parent = root;
  road.receiveShadows = true;

  // Physics collider via MESH shape
  const col = road.clone('road-col', null);
  col.isVisible = false;
  col.bakeCurrentTransformIntoVertices();
  const agg = new PhysicsAggregate(col, PhysicsShapeType.MESH, { mass: 0, friction: 0.9, restitution: 0.05 }, scene);
  applyFilterToAggregate(agg, FILTER.TRACK);

  return road;
}

// ── Wall Generation ─────────────────────────────────────────────────────────

function buildWalls(scene, root, splinePoints, roadWidth, wallHeight, mats) {
  const n = splinePoints.length;
  const wallSegments = Math.min(n, 96);
  const step = Math.max(1, Math.floor(n / wallSegments));

  for (let side = 0; side < 2; side++) {
    const sign = side === 0 ? 1 : -1;
    for (let i = 0; i < n; i += step) {
      const cur = splinePoints[i];
      const next = splinePoints[(i + step) % n];
      const dx = next.x - cur.x;
      const dz = next.z - cur.z;
      const segLen = Math.sqrt(dx * dx + dz * dz);
      if (segLen < 0.1) continue;

      const px = -dz / segLen;
      const pz = dx / segLen;
      const hw = roadWidth / 2 + 0.5;
      const angle = Math.atan2(dx, dz);

      const wall = MeshBuilder.CreateBox(`wall-${side}-${i}`, {
        width: 1.0,
        height: wallHeight,
        depth: segLen + 1,
      }, scene);
      wall.position.set(
        (cur.x + next.x) / 2 + px * hw * sign,
        cur.y + wallHeight / 2,
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

// ── Start/Finish Line ───────────────────────────────────────────────────────

function buildStartFinishLine(scene, root, splinePoints, roadWidth, mats) {
  const p0 = splinePoints[0];
  const p1 = splinePoints[1];
  const dx = p1.x - p0.x;
  const dz = p1.z - p0.z;
  const len = Math.sqrt(dx * dx + dz * dz) || 1;
  const angle = Math.atan2(dx, dz);

  // Checkered start/finish line on road surface
  const line = MeshBuilder.CreateBox('start-line', {
    width: roadWidth,
    height: 0.05,
    depth: 2,
  }, scene);
  line.position.set(p0.x, p0.y + 0.16, p0.z);
  line.rotation.y = angle;
  line.material = mats.startLineMat;
  line.parent = root;

  // Start gantry (archway over the road)
  const gantryHeight = 8;
  const gantryMat = mats.accentMat;

  for (const side of [-1, 1]) {
    const px = (-dz / len) * (roadWidth / 2 + 0.5) * side;
    const pz = (dx / len) * (roadWidth / 2 + 0.5) * side;
    const post = MeshBuilder.CreateBox(`gantry-post-${side}`, { width: 1, height: gantryHeight, depth: 1 }, scene);
    post.position.set(p0.x + px, p0.y + gantryHeight / 2, p0.z + pz);
    post.material = gantryMat;
    post.parent = root;
  }

  // Crossbar
  const crossbar = MeshBuilder.CreateBox('gantry-bar', { width: roadWidth + 2, height: 1, depth: 1 }, scene);
  crossbar.position.set(p0.x, p0.y + gantryHeight, p0.z);
  crossbar.rotation.y = angle;
  crossbar.material = gantryMat;
  crossbar.parent = root;
}

// ── Terrain Ground Plane ────────────────────────────────────────────────────

function buildTerrain(scene, root, mats) {
  const ground = MeshBuilder.CreateGround('terrain', { width: 600, height: 600, subdivisions: 1 }, scene);
  ground.position.y = -0.5;
  ground.material = mats.terrainMat;
  ground.receiveShadows = true;
  ground.parent = root;

  // Terrain collider
  const col = ground.clone('terrain-col', null);
  col.isVisible = false;
  col.bakeCurrentTransformIntoVertices();
  const agg = new PhysicsAggregate(col, PhysicsShapeType.BOX, { mass: 0, friction: 0.4, restitution: 0.1 }, scene);
  applyFilterToAggregate(agg, FILTER.TRACK);
}

// ── Decorations (procedural trees, rocks, etc.) ─────────────────────────────

function buildDecorations(scene, root, splinePoints, roadWidth, rand, theme) {
  const decoMat = new StandardMaterial('deco-mat', scene);
  decoMat.diffuseColor = new Color3(...theme.terrain).scale(0.7);
  decoMat.specularColor = Color3.Black();

  const treeMat = new StandardMaterial('tree-mat', scene);
  treeMat.diffuseColor = new Color3(0.15, 0.45 + rand() * 0.2, 0.1);
  treeMat.specularColor = Color3.Black();

  const treeCount = 30 + Math.floor(rand() * 40);
  const n = splinePoints.length;

  for (let i = 0; i < treeCount; i++) {
    const idx = Math.floor(rand() * n);
    const cur = splinePoints[idx];
    const next = splinePoints[(idx + 1) % n];
    const dx = next.x - cur.x;
    const dz = next.z - cur.z;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    const px = -dz / len;
    const pz = dx / len;

    const dist = (roadWidth / 2 + 4 + rand() * 25) * (rand() > 0.5 ? 1 : -1);
    const tx = cur.x + px * dist;
    const tz = cur.z + pz * dist;

    // Tree trunk
    const height = 4 + rand() * 6;
    const trunk = MeshBuilder.CreateBox(`trunk-${i}`, { width: 0.6, height: height, depth: 0.6 }, scene);
    trunk.position.set(tx, height / 2, tz);
    trunk.material = decoMat;
    trunk.parent = root;

    // Tree canopy
    const canopySize = 2 + rand() * 3;
    const canopy = MeshBuilder.CreateSphere(`canopy-${i}`, { diameter: canopySize, segments: 6 }, scene);
    canopy.position.set(tx, height + canopySize / 3, tz);
    canopy.material = treeMat;
    canopy.parent = root;
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

function extractTrackData(splinePoints, roadWidth, laps) {
  const n = splinePoints.length;

  // Driveline: every spline point becomes a quad center
  const driveline = splinePoints.map(p => ({
    center: [p.x, p.y, p.z],
    width: roadWidth,
  }));

  // Checkpoints: evenly spaced around the loop
  const numCheckpoints = Math.max(4, Math.floor(n / 12));
  const checkpoints = [];
  for (let i = 0; i < numCheckpoints; i++) {
    const quadIndex = Math.floor((i / numCheckpoints) * n);
    checkpoints.push({
      quadIndex,
      isLapLine: i === 0,
      center: driveline[quadIndex].center,
      width: roadWidth,
    });
  }

  // Start positions: 2-wide grid behind spline[0]
  const p0 = splinePoints[0];
  const p1 = splinePoints[1];
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

  // Items: placed along track at regular intervals
  const items = [];
  const itemInterval = Math.max(6, Math.floor(n / 12));
  for (let i = itemInterval; i < n; i += itemInterval) {
    items.push({
      type: (items.length % 3 === 0) ? 'nitro' : 'item',
      position: driveline[i].center,
      heading: 0,
    });
  }

  return {
    driveline,
    checkpoints,
    startPositions,
    items,
    laps,
    graph: {
      mainLoop: [0, n],
      shortcuts: [],
    },
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate a complete procedural race track with full geometry + physics.
 *
 * @param {string} mapId  - Track identifier (used as random seed)
 * @param {BABYLON.Scene} scene - Babylon.js scene with Havok physics enabled
 * @param {object} [opts] - Optional overrides
 * @param {number} [opts.roadWidth=14]
 * @param {number} [opts.wallHeight=3]
 * @param {number} [opts.laps=3]
 * @param {number} [opts.complexity=1] - 0-2 complexity scale
 * @returns {{ root: TransformNode, trackData: object }}
 */
export function generateProceduralTrack(mapId, scene, opts = {}) {
  // Dispose previous procedural track if any
  if (_lastTrackRoot) {
    _lastTrackRoot.getChildMeshes().forEach(m => m.dispose());
    _lastTrackRoot.dispose();
    _lastTrackRoot = null;
  }

  const seed = seedHash(mapId || 'default_track');
  const rand = mulberry32(seed);

  const roadWidth = opts.roadWidth || 14;
  const wallHeight = opts.wallHeight || 3;
  const laps = opts.laps || 3;
  const complexity = opts.complexity ?? 1;

  // Pick theme deterministically
  const themeIndex = Math.floor(rand() * THEME_NAMES.length);
  const themeName = THEME_NAMES[themeIndex];
  const theme = TRACK_THEMES[themeName];

  const root = new TransformNode('trackRoot', scene);

  // Generate spline control points and sample them
  const controlPoints = generateControlPoints(rand, complexity);
  const numSamples = 64 + Math.floor(complexity * 32);
  const splinePoints = sampleSpline(controlPoints, numSamples);

  // Create materials
  const mats = createTrackMaterials(scene, theme);

  // Build geometry
  buildRoadMesh(scene, root, splinePoints, roadWidth, mats);
  buildWalls(scene, root, splinePoints, roadWidth, wallHeight, mats);
  buildStartFinishLine(scene, root, splinePoints, roadWidth, mats);
  buildTerrain(scene, root, mats);
  buildDecorations(scene, root, splinePoints, roadWidth, rand, theme);
  createKillPlane(scene);

  // Extract track data for game systems
  const trackData = extractTrackData(splinePoints, roadWidth, laps);

  console.log(`[proc-track] Generated "${mapId}" (theme=${themeName}, points=${numSamples}, checkpoints=${trackData.checkpoints.length})`);

  _lastTrackRoot = root;
  return { root, trackData, theme: themeName };
}

/**
 * Generate track data only (no geometry) for pre-caching.
 */
export function generateTrackDataOnly(mapId, opts = {}) {
  const seed = seedHash(mapId || 'default_track');
  const rand = mulberry32(seed);
  const complexity = opts.complexity ?? 1;
  const roadWidth = opts.roadWidth || 14;
  const laps = opts.laps || 3;

  const controlPoints = generateControlPoints(rand, complexity);
  const numSamples = 64 + Math.floor(complexity * 32);
  const splinePoints = sampleSpline(controlPoints, numSamples);

  return extractTrackData(splinePoints, roadWidth, laps);
}
