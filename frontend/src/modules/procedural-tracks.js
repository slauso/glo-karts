/**
 * procedural-tracks.js — Parametric procedural track/arena generator.
 *
 * Generates unique playable geometry for addon tracks and arenas
 * until real GLB models are imported via the map pipeline.
 *
 * Shapes: oval, figure8, diamond, lshape (race tracks)
 *         square, circle, rect, cross (battle arenas)
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PhysicsAggregate } from '@babylonjs/core/Physics/v2/physicsAggregate';
import { PhysicsShapeType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import { FILTER, applyFilterToAggregate } from './realtime/collision-layers.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function _mat(scene, name, r, g, b, alpha = 1) {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = new Color3(r, g, b);
  if (alpha < 1) m.alpha = alpha;
  return m;
}

function _boxCollider(scene, name, w, h, d, x, y, z, filter = FILTER.TRACK) {
  const box = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
  box.position.set(x, y, z);
  box.isVisible = false;
  const agg = new PhysicsAggregate(box, PhysicsShapeType.BOX, { mass: 0, friction: 0.6, restitution: 0.05 }, scene);
  applyFilterToAggregate(agg, filter);
  return box;
}

// ── Kill-plane ───────────────────────────────────────────────────────────────

function _createKillPlane(scene) {
  const kp = MeshBuilder.CreateBox('killPlane', { width: 2000, height: 1, depth: 2000 }, scene);
  kp.position.y = -80;
  kp.isVisible = false;
  kp._isBoundary = true;
  const agg = new PhysicsAggregate(kp, PhysicsShapeType.BOX, { mass: 0, friction: 0, restitution: 0 }, scene);
  applyFilterToAggregate(agg, FILTER.BOUNDARY);
}

// ── Race Track Shapes ────────────────────────────────────────────────────────

/**
 * Generate an oval race track (ribbon loop with banked walls).
 */
function _buildOvalTrack(root, scene, params) {
  const { halfSize: R, roadWidth: W, elevationAmplitude: elev, wallHeight: WH, color, accent } = params;
  const segments = 64;
  const floorMat = _mat(scene, 'track-floor', ...color);
  const wallMat  = _mat(scene, 'track-wall', ...accent, 0.7);

  // Road surface — disc ring
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const cos0 = Math.cos(a0), sin0 = Math.sin(a0);
    const cos1 = Math.cos(a1), sin1 = Math.sin(a1);
    const y0 = elev * Math.sin(a0 * 2);
    const y1 = elev * Math.sin(a1 * 2);

    const innerR = R - W / 2;
    const outerR = R + W / 2;

    // Road segment (box approximation)
    const cx = ((innerR + outerR) / 2) * ((cos0 + cos1) / 2);
    const cz = ((innerR + outerR) / 2) * ((sin0 + sin1) / 2);
    const cy = (y0 + y1) / 2;
    const segLen = (2 * Math.PI * R) / segments;
    const angle = (a0 + a1) / 2;

    const seg = MeshBuilder.CreateBox(`road-${i}`, { width: W, height: 0.3, depth: segLen + 1 }, scene);
    seg.position.set(cx, cy, cz);
    seg.rotation.y = -angle + Math.PI / 2;
    seg.material = floorMat;
    seg.parent = root;

    // Physics collider
    const col = seg.clone(`road-col-${i}`, null);
    col.isVisible = false;
    col.bakeCurrentTransformIntoVertices();
    col.position.copyFromFloats(0, 0, 0);
    col.rotation.copyFromFloats(0, 0, 0);
    col.scaling.copyFromFloats(1, 1, 1);
    const agg = new PhysicsAggregate(col, PhysicsShapeType.BOX, { mass: 0, friction: 0.9, restitution: 0.05 }, scene);
    applyFilterToAggregate(agg, FILTER.TRACK);
  }

  // Inner and outer walls
  const wallSegs = 48;
  for (let i = 0; i < wallSegs; i++) {
    const a0 = (i / wallSegs) * Math.PI * 2;
    const a1 = ((i + 1) / wallSegs) * Math.PI * 2;
    const angle = (a0 + a1) / 2;
    const segLen = (2 * Math.PI * R) / wallSegs + 2;

    for (const radius of [R - W / 2, R + W / 2]) {
      const cx = radius * Math.cos(angle);
      const cz = radius * Math.sin(angle);
      const cy = elev * Math.sin(angle * 2) + WH / 2;
      const w = MeshBuilder.CreateBox(`wall-${i}-${radius}`, { width: 1, height: WH, depth: segLen }, scene);
      w.position.set(cx, cy, cz);
      w.rotation.y = -angle + Math.PI / 2;
      w.material = wallMat;
      w.parent = root;

      const wc = w.clone(`wc-${i}-${radius}`, null);
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

/**
 * Generate a figure-8 track.
 */
function _buildFigure8Track(root, scene, params) {
  const { halfSize: HS, roadWidth: W, wallHeight: WH, color, accent } = params;
  const floorMat = _mat(scene, 'track-floor', ...color);
  const wallMat  = _mat(scene, 'track-wall', ...accent, 0.7);

  const R = HS * 0.45;
  const segments = 48;

  // Two loops offset on Z axis
  for (const offsetZ of [-R, R]) {
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const angle = (a0 + a1) / 2;
      const segLen = (2 * Math.PI * R) / segments + 1;

      const cx = R * Math.cos(angle);
      const cz = R * Math.sin(angle) + offsetZ;

      const seg = MeshBuilder.CreateBox(`road-${offsetZ}-${i}`, { width: W, height: 0.3, depth: segLen }, scene);
      seg.position.set(cx, 0, cz);
      seg.rotation.y = -angle + Math.PI / 2;
      seg.material = floorMat;
      seg.parent = root;

      const col = seg.clone(`rc-${offsetZ}-${i}`, null);
      col.isVisible = false;
      col.bakeCurrentTransformIntoVertices();
      col.position.copyFromFloats(0, 0, 0);
      col.rotation.copyFromFloats(0, 0, 0);
      col.scaling.copyFromFloats(1, 1, 1);
      const agg = new PhysicsAggregate(col, PhysicsShapeType.BOX, { mass: 0, friction: 0.9, restitution: 0.05 }, scene);
      applyFilterToAggregate(agg, FILTER.TRACK);

      // Walls
      for (const radius of [R - W / 2 - 0.5, R + W / 2 + 0.5]) {
        const wx = radius * Math.cos(angle);
        const wz = radius * Math.sin(angle) + offsetZ;
        const wall = MeshBuilder.CreateBox(`w-${offsetZ}-${i}-${radius}`, { width: 1, height: WH, depth: segLen }, scene);
        wall.position.set(wx, WH / 2, wz);
        wall.rotation.y = -angle + Math.PI / 2;
        wall.material = wallMat;
        wall.parent = root;

        const wc = wall.clone(`wc-${offsetZ}-${i}-${radius}`, null);
        wc.isVisible = false;
        wc.bakeCurrentTransformIntoVertices();
        wc.position.copyFromFloats(0, 0, 0);
        wc.rotation.copyFromFloats(0, 0, 0);
        wc.scaling.copyFromFloats(1, 1, 1);
        const wagg = new PhysicsAggregate(wc, PhysicsShapeType.BOX, { mass: 0, friction: 0.6, restitution: 0.05 }, scene);
        applyFilterToAggregate(wagg, FILTER.TRACK);
      }
    }
  }
}

/**
 * Generate a diamond-shaped track.
 */
function _buildDiamondTrack(root, scene, params) {
  const { halfSize: HS, roadWidth: W, wallHeight: WH, color, accent, elevationAmplitude: elev } = params;
  const floorMat = _mat(scene, 'track-floor', ...color);
  const wallMat  = _mat(scene, 'track-wall', ...accent, 0.7);

  // Four straight segments forming a diamond
  const corners = [
    { x: 0, z: -HS },    // north
    { x: HS, z: 0 },     // east
    { x: 0, z: HS },     // south
    { x: -HS, z: 0 },    // west
  ];

  for (let i = 0; i < 4; i++) {
    const c0 = corners[i];
    const c1 = corners[(i + 1) % 4];
    const dx = c1.x - c0.x;
    const dz = c1.z - c0.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    const angle = Math.atan2(dx, dz);
    const cy = elev * Math.sin(i * Math.PI / 2);

    // Road segment
    const seg = MeshBuilder.CreateBox(`diamond-${i}`, { width: W, height: 0.3, depth: len + W }, scene);
    seg.position.set((c0.x + c1.x) / 2, cy, (c0.z + c1.z) / 2);
    seg.rotation.y = angle;
    seg.material = floorMat;
    seg.parent = root;

    const col = seg.clone(`dc-${i}`, null);
    col.isVisible = false;
    col.bakeCurrentTransformIntoVertices();
    col.position.copyFromFloats(0, 0, 0);
    col.rotation.copyFromFloats(0, 0, 0);
    col.scaling.copyFromFloats(1, 1, 1);
    const agg = new PhysicsAggregate(col, PhysicsShapeType.BOX, { mass: 0, friction: 0.9, restitution: 0.05 }, scene);
    applyFilterToAggregate(agg, FILTER.TRACK);

    // Walls
    for (const side of [-1, 1]) {
      const perpX = -dz / len * side * W / 2;
      const perpZ = dx / len * side * W / 2;
      const wall = MeshBuilder.CreateBox(`dw-${i}-${side}`, { width: 1, height: WH, depth: len + W }, scene);
      wall.position.set((c0.x + c1.x) / 2 + perpX, cy + WH / 2, (c0.z + c1.z) / 2 + perpZ);
      wall.rotation.y = angle;
      wall.material = wallMat;
      wall.parent = root;

      const wc = wall.clone(`dwc-${i}-${side}`, null);
      wc.isVisible = false;
      wc.bakeCurrentTransformIntoVertices();
      wc.position.copyFromFloats(0, 0, 0);
      wc.rotation.copyFromFloats(0, 0, 0);
      wc.scaling.copyFromFloats(1, 1, 1);
      const wagg = new PhysicsAggregate(wc, PhysicsShapeType.BOX, { mass: 0, friction: 0.6, restitution: 0.05 }, scene);
      applyFilterToAggregate(wagg, FILTER.TRACK);
    }
  }
}

/**
 * Generate an L-shaped track.
 */
function _buildLShapeTrack(root, scene, params) {
  const { halfSize: HS, roadWidth: W, wallHeight: WH, color, accent } = params;
  const floorMat = _mat(scene, 'track-floor', ...color);
  const wallMat  = _mat(scene, 'track-wall', ...accent, 0.7);

  // L-shape: 4 straight segments + 4 corners forming a rectangular loop with an L notch
  const waypoints = [
    { x: -HS, z: -HS },
    { x: HS, z: -HS },
    { x: HS, z: 0 },
    { x: 0, z: 0 },
    { x: 0, z: HS },
    { x: -HS, z: HS },
  ];

  for (let i = 0; i < waypoints.length; i++) {
    const c0 = waypoints[i];
    const c1 = waypoints[(i + 1) % waypoints.length];
    const dx = c1.x - c0.x;
    const dz = c1.z - c0.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 1) continue;
    const angle = Math.atan2(dx, dz);

    const seg = MeshBuilder.CreateBox(`lroad-${i}`, { width: W, height: 0.3, depth: len + W }, scene);
    seg.position.set((c0.x + c1.x) / 2, 0, (c0.z + c1.z) / 2);
    seg.rotation.y = angle;
    seg.material = floorMat;
    seg.parent = root;

    const col = seg.clone(`lrc-${i}`, null);
    col.isVisible = false;
    col.bakeCurrentTransformIntoVertices();
    col.position.copyFromFloats(0, 0, 0);
    col.rotation.copyFromFloats(0, 0, 0);
    col.scaling.copyFromFloats(1, 1, 1);
    const agg = new PhysicsAggregate(col, PhysicsShapeType.BOX, { mass: 0, friction: 0.9, restitution: 0.05 }, scene);
    applyFilterToAggregate(agg, FILTER.TRACK);

    for (const side of [-1, 1]) {
      const perpX = -dz / len * side * W / 2;
      const perpZ = dx / len * side * W / 2;
      const wall = MeshBuilder.CreateBox(`lw-${i}-${side}`, { width: 1, height: WH, depth: len + W }, scene);
      wall.position.set((c0.x + c1.x) / 2 + perpX, WH / 2, (c0.z + c1.z) / 2 + perpZ);
      wall.rotation.y = angle;
      wall.material = wallMat;
      wall.parent = root;

      const wc = wall.clone(`lwc-${i}-${side}`, null);
      wc.isVisible = false;
      wc.bakeCurrentTransformIntoVertices();
      wc.position.copyFromFloats(0, 0, 0);
      wc.rotation.copyFromFloats(0, 0, 0);
      wc.scaling.copyFromFloats(1, 1, 1);
      const wagg = new PhysicsAggregate(wc, PhysicsShapeType.BOX, { mass: 0, friction: 0.6, restitution: 0.05 }, scene);
      applyFilterToAggregate(wagg, FILTER.TRACK);
    }
  }
}

// ── Arena Shapes ─────────────────────────────────────────────────────────────

function _buildSquareArena(root, scene, params) {
  const { halfSize: HS, wallHeight: WH, color, accent, obstacles } = params;
  const floorMat = _mat(scene, 'arena-floor', ...color);
  const wallMat  = _mat(scene, 'arena-wall', ...accent, 0.7);

  // Floor
  const floor = MeshBuilder.CreateGround('arena-ground', { width: HS * 2, height: HS * 2 }, scene);
  floor.material = floorMat;
  floor.parent = root;
  _boxCollider(scene, 'arena-floor-col', HS * 2, 0.2, HS * 2, 0, -0.1, 0);

  // Grid overlay
  const gridMat = _mat(scene, 'arena-grid', 0.5, 0.5, 0.55, 0.3);
  gridMat.wireframe = true;
  const grid = MeshBuilder.CreateGround('arena-grid', { width: HS * 2, height: HS * 2, subdivisions: Math.floor(HS / 5) }, scene);
  grid.position.y = 0.02;
  grid.material = gridMat;
  grid.parent = root;

  // Walls
  const wallDefs = [
    { w: HS * 2, d: 1, x: 0, z: -HS },
    { w: HS * 2, d: 1, x: 0, z: HS },
    { w: 1, d: HS * 2, x: HS, z: 0 },
    { w: 1, d: HS * 2, x: -HS, z: 0 },
  ];
  wallDefs.forEach((wd, i) => {
    const wall = MeshBuilder.CreateBox(`arena-wall-${i}`, { width: wd.w, height: WH, depth: wd.d }, scene);
    wall.position.set(wd.x, WH / 2, wd.z);
    wall.material = wallMat;
    wall.parent = root;
    const wagg = new PhysicsAggregate(wall, PhysicsShapeType.BOX, { mass: 0, friction: 0.6, restitution: 0.05 }, scene);
    applyFilterToAggregate(wagg, FILTER.TRACK);
  });

  // Obstacles
  _addObstacles(root, scene, obstacles, HS, WH, accent);
}

function _buildCircleArena(root, scene, params) {
  const { halfSize: R, wallHeight: WH, color, accent, obstacles } = params;
  const floorMat = _mat(scene, 'arena-floor', ...color);
  const wallMat  = _mat(scene, 'arena-wall', ...accent, 0.7);

  // Circular ground (disc)
  const disc = MeshBuilder.CreateDisc('arena-disc', { radius: R, tessellation: 48 }, scene);
  disc.rotation.x = Math.PI / 2;
  disc.material = floorMat;
  disc.parent = root;

  // Flat collider under disc
  _boxCollider(scene, 'arena-floor-col', R * 2, 0.2, R * 2, 0, -0.1, 0);

  // Circular walls (segmented boxes)
  const segments = 36;
  const segLen = (2 * Math.PI * R) / segments + 2;
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2 + Math.PI / segments;
    const cx = R * Math.cos(angle);
    const cz = R * Math.sin(angle);
    const wall = MeshBuilder.CreateBox(`cwall-${i}`, { width: 1.5, height: WH, depth: segLen }, scene);
    wall.position.set(cx, WH / 2, cz);
    wall.rotation.y = -angle + Math.PI / 2;
    wall.material = wallMat;
    wall.parent = root;
    const wagg = new PhysicsAggregate(wall, PhysicsShapeType.BOX, { mass: 0, friction: 0.6, restitution: 0.05 }, scene);
    applyFilterToAggregate(wagg, FILTER.TRACK);
  }

  _addObstacles(root, scene, obstacles, R, WH, accent);
}

function _buildRectArena(root, scene, params) {
  const { halfSize: HS, wallHeight: WH, color, accent, obstacles } = params;
  const W = HS;
  const D = HS * 0.6;
  const floorMat = _mat(scene, 'arena-floor', ...color);
  const wallMat  = _mat(scene, 'arena-wall', ...accent, 0.7);

  const floor = MeshBuilder.CreateGround('arena-ground', { width: W * 2, height: D * 2 }, scene);
  floor.material = floorMat;
  floor.parent = root;
  _boxCollider(scene, 'arena-floor-col', W * 2, 0.2, D * 2, 0, -0.1, 0);

  const wallDefs = [
    { w: W * 2, d: 1, x: 0, z: -D },
    { w: W * 2, d: 1, x: 0, z: D },
    { w: 1, d: D * 2, x: W, z: 0 },
    { w: 1, d: D * 2, x: -W, z: 0 },
  ];
  wallDefs.forEach((wd, i) => {
    const wall = MeshBuilder.CreateBox(`arena-wall-${i}`, { width: wd.w, height: WH, depth: wd.d }, scene);
    wall.position.set(wd.x, WH / 2, wd.z);
    wall.material = wallMat;
    wall.parent = root;
    const wagg = new PhysicsAggregate(wall, PhysicsShapeType.BOX, { mass: 0, friction: 0.6, restitution: 0.05 }, scene);
    applyFilterToAggregate(wagg, FILTER.TRACK);
  });

  // Goal lines for soccer variants
  const lineMat = _mat(scene, 'goalline', 1, 1, 1, 0.5);
  for (const z of [-D + 5, D - 5]) {
    const line = MeshBuilder.CreateBox('goalline', { width: W * 0.6, height: 0.02, depth: 0.5 }, scene);
    line.position.set(0, 0.01, z);
    line.material = lineMat;
    line.parent = root;
  }

  _addObstacles(root, scene, obstacles, HS, WH, accent);
}

function _buildCrossArena(root, scene, params) {
  const { halfSize: HS, wallHeight: WH, color, accent, obstacles } = params;
  const armW = HS * 0.4;
  const floorMat = _mat(scene, 'arena-floor', ...color);
  const wallMat  = _mat(scene, 'arena-wall', ...accent, 0.7);

  // Cross = center square + 4 arms
  // Center
  const center = MeshBuilder.CreateGround('cross-center', { width: armW * 2, height: armW * 2 }, scene);
  center.material = floorMat;
  center.parent = root;
  _boxCollider(scene, 'cross-c-col', armW * 2, 0.2, armW * 2, 0, -0.1, 0);

  // Arms
  const arms = [
    { x: 0, z: -(armW + HS / 2) / 1, w: armW * 2, d: HS - armW },
    { x: 0, z: (armW + HS / 2) / 1, w: armW * 2, d: HS - armW },
    { x: -(armW + HS / 2) / 1, z: 0, w: HS - armW, d: armW * 2 },
    { x: (armW + HS / 2) / 1, z: 0, w: HS - armW, d: armW * 2 },
  ];
  arms.forEach((arm, i) => {
    const g = MeshBuilder.CreateGround(`arm-${i}`, { width: arm.w, height: arm.d }, scene);
    g.position.set(arm.x, 0, arm.z);
    g.material = floorMat;
    g.parent = root;
    _boxCollider(scene, `arm-col-${i}`, arm.w, 0.2, arm.d, arm.x, -0.1, arm.z);
  });

  // Outer walls around cross perimeter
  const wallSegs = [
    // Top of north arm
    { w: armW * 2, d: 1, x: 0, z: -HS },
    // Bottom of south arm
    { w: armW * 2, d: 1, x: 0, z: HS },
    // Left of west arm
    { w: 1, d: armW * 2, x: -HS, z: 0 },
    // Right of east arm
    { w: 1, d: armW * 2, x: HS, z: 0 },
    // Inner corners (8 wall segments)
    { w: (HS - armW) / 2, d: 1, x: -(armW + (HS - armW) / 4), z: -armW },
    { w: (HS - armW) / 2, d: 1, x: (armW + (HS - armW) / 4), z: -armW },
    { w: (HS - armW) / 2, d: 1, x: -(armW + (HS - armW) / 4), z: armW },
    { w: (HS - armW) / 2, d: 1, x: (armW + (HS - armW) / 4), z: armW },
    { w: 1, d: (HS - armW) / 2, x: -armW, z: -(armW + (HS - armW) / 4) },
    { w: 1, d: (HS - armW) / 2, x: armW, z: -(armW + (HS - armW) / 4) },
    { w: 1, d: (HS - armW) / 2, x: -armW, z: (armW + (HS - armW) / 4) },
    { w: 1, d: (HS - armW) / 2, x: armW, z: (armW + (HS - armW) / 4) },
  ];
  wallSegs.forEach((ws, i) => {
    const wall = MeshBuilder.CreateBox(`xwall-${i}`, { width: ws.w, height: WH, depth: ws.d }, scene);
    wall.position.set(ws.x, WH / 2, ws.z);
    wall.material = wallMat;
    wall.parent = root;
    const wagg = new PhysicsAggregate(wall, PhysicsShapeType.BOX, { mass: 0, friction: 0.6, restitution: 0.05 }, scene);
    applyFilterToAggregate(wagg, FILTER.TRACK);
  });

  _addObstacles(root, scene, obstacles, HS, WH, accent);
}

// ── Obstacles ────────────────────────────────────────────────────────────────

function _addObstacles(root, scene, obstacleTypes, halfSize, wallHeight, accent) {
  if (!obstacleTypes || !obstacleTypes.length) return;

  const obsMat = _mat(scene, 'obstacle', ...accent, 0.8);
  const HS = halfSize * 0.6;

  for (const otype of obstacleTypes) {
    if (otype === 'blocks') {
      // 4 raised platforms
      const positions = [
        { x: -HS / 2, z: -HS / 2 }, { x: HS / 2, z: -HS / 2 },
        { x: -HS / 2, z: HS / 2 },  { x: HS / 2, z: HS / 2 },
      ];
      positions.forEach((p, i) => {
        const block = MeshBuilder.CreateBox(`block-${i}`, { width: HS / 2, height: wallHeight * 0.5, depth: HS / 2 }, scene);
        block.position.set(p.x, wallHeight * 0.25, p.z);
        block.material = obsMat;
        block.parent = root;
        const bagg = new PhysicsAggregate(block, PhysicsShapeType.BOX, { mass: 0, friction: 0.6, restitution: 0.05 }, scene);
        applyFilterToAggregate(bagg, FILTER.TRACK);
      });
    } else if (otype === 'pillars') {
      // 6 cylindrical pillars in a ring
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const r = HS * 0.5;
        const pillar = MeshBuilder.CreateBox(`pillar-${i}`, { width: 3, height: wallHeight, depth: 3 }, scene);
        pillar.position.set(r * Math.cos(angle), wallHeight / 2, r * Math.sin(angle));
        pillar.material = obsMat;
        pillar.parent = root;
        const pagg = new PhysicsAggregate(pillar, PhysicsShapeType.BOX, { mass: 0, friction: 0.6, restitution: 0.05 }, scene);
        applyFilterToAggregate(pagg, FILTER.TRACK);
      }
    } else if (otype === 'pipes') {
      // Horizontal pipe obstacles
      for (let i = 0; i < 4; i++) {
        const z = (i - 1.5) * HS / 2;
        const pipe = MeshBuilder.CreateBox(`pipe-${i}`, { width: HS * 0.4, height: 2.5, depth: 2.5 }, scene);
        pipe.position.set(0, 1.25, z);
        pipe.material = obsMat;
        pipe.parent = root;
        const pagg = new PhysicsAggregate(pipe, PhysicsShapeType.BOX, { mass: 0, friction: 0.6, restitution: 0.05 }, scene);
        applyFilterToAggregate(pagg, FILTER.TRACK);
      }
    } else if (otype === 'ramps') {
      // Ramp obstacles at corners
      const positions = [
        { x: -HS / 2, z: -HS / 2 }, { x: HS / 2, z: HS / 2 },
      ];
      positions.forEach((p, i) => {
        const ramp = MeshBuilder.CreateBox(`ramp-${i}`, { width: HS / 3, height: 0.3, depth: HS / 3 }, scene);
        ramp.position.set(p.x, 1, p.z);
        ramp.rotation.x = 0.2;
        ramp.material = obsMat;
        ramp.parent = root;
        const ragg = new PhysicsAggregate(ramp, PhysicsShapeType.BOX, { mass: 0, friction: 0.6, restitution: 0.05 }, scene);
        applyFilterToAggregate(ragg, FILTER.TRACK);
      });
    }
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

const TRACK_BUILDERS = {
  oval:    _buildOvalTrack,
  figure8: _buildFigure8Track,
  diamond: _buildDiamondTrack,
  lshape:  _buildLShapeTrack,
};

const ARENA_BUILDERS = {
  square: _buildSquareArena,
  circle: _buildCircleArena,
  rect:   _buildRectArena,
  cross:  _buildCrossArena,
};

/**
 * Create a procedural track or arena for an addon map.
 *
 * @param {string}        mapId   Map identifier
 * @param {object}        params  From getAddonParams()
 * @param {BABYLON.Scene}  scene   Babylon.js scene
 * @returns {TransformNode} Root node for the generated track
 */
export function createProceduralAddonTrack(mapId, params, scene) {
  const root = new TransformNode('trackRoot', scene);

  if (params.isArena) {
    const builder = ARENA_BUILDERS[params.shape] || ARENA_BUILDERS.square;
    console.log(`[track] Building procedural arena "${mapId}" (${params.shape}, size=${params.halfSize})`);
    builder(root, scene, params);
  } else {
    const builder = TRACK_BUILDERS[params.shape] || TRACK_BUILDERS.oval;
    console.log(`[track] Building procedural track "${mapId}" (${params.shape}, size=${params.halfSize})`);
    builder(root, scene, params);
  }

  _createKillPlane(scene);
  return root;
}
