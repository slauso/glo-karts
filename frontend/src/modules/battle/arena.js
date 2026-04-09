import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import "@babylonjs/loaders/glTF";
import { PhysicsAggregate } from '@babylonjs/core/Physics/v2/physicsAggregate';
import { PhysicsShapeType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import { isSTKArena, getTrackModelPath, getTrackScale, getStartPosition } from '../track-data.js';
import { FILTER, applyFilterToAggregate } from '../realtime/collision-layers.js';

// Load a battle arena into the scene (Havok physics via havok-physics.js)
// Returns { spawnPoints: Array<{x,y,z}>, bounds: {width, depth} }
export function loadArena(scene, arenaId = 'test_box') {
  if (isSTKArena(arenaId)) {
    return loadSTKArena(scene, arenaId);
  }
  switch (arenaId) {
    case 'box':
    case 'test_box':
    default:
      return createBoxArena(scene);
  }
}

function loadSTKArena(scene, arenaId) {
  const modelPath = getTrackModelPath(arenaId);
  const scale = getTrackScale(arenaId);
  const center = getStartPosition(arenaId);

  const spawnPoints = [];
  const spawnRadius = 25;
  const spawnCount = 12;
  for (let i = 0; i < spawnCount; i++) {
    const angle = (i / spawnCount) * Math.PI * 2;
    spawnPoints.push({
      x: center.x + Math.cos(angle) * spawnRadius,
      y: center.y,
      z: center.z + Math.sin(angle) * spawnRadius,
    });
  }

  const lastSlash = modelPath.lastIndexOf('/');
  const dir = modelPath.substring(0, lastSlash + 1);
  const file = modelPath.substring(lastSlash + 1);

  SceneLoader.ImportMeshAsync("", dir, file, scene).then((result) => {
    const root = result.meshes[0];
    root.scaling.setAll(scale);
    root.position.setAll(0);
    result.meshes.forEach((mesh) => {
      if (mesh.getTotalVertices() > 0) {
        mesh.receiveShadows = true;
        if (mesh.material) mesh.material.backFaceCulling = false;
      }
    });
    console.log(`STK arena "${arenaId}" model loaded`);
    addArenaColliderHavok(result.meshes, root);
  }).catch((error) => {
    console.error(`Error loading STK arena ${arenaId}:`, error);
  });

  return { spawnPoints, bounds: { width: 200, depth: 200 } };
}

function addArenaColliderHavok(meshes, root) {
  const scene = root.getScene();
  let colliderCount = 0;

  root.computeWorldMatrix(true);

  meshes.forEach((mesh) => {
    if (mesh.getTotalVertices() === 0) return;
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
    if (!positions) return;

    try {
      const agg = new PhysicsAggregate(mesh, PhysicsShapeType.MESH, { mass: 0, friction: 0.8 }, scene);
      applyFilterToAggregate(agg, FILTER.TRACK);
      colliderCount++;
    } catch (e) {
      console.warn('Arena mesh collider failed:', mesh.name, e.message);
    }
  });

  console.log(`Arena Havok colliders created (${colliderCount} meshes)`);
}

function createBoxArena(scene) {
  // Block Fort layout ΓÇö 170├ù170 arena with 4 colored forts, ramps, bridges
  const U = 10;
  const ARENA = 17 * U;
  const HALF = ARENA / 2;
  const H1 = 1.5 * U;
  const H2 = 3.0 * U;
  const WALL_H = 4 * U;
  const WALL_T = 2;
  const BRIDGE_T = 0.2 * U;
  const FORT_OFF = 3.5 * U;

  const _box = (name, w, h, d, x, y, z, mat, filter = FILTER.TRACK) => {
    const m = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
    m.position.set(x, y, z);
    m.material = mat;
    m.receiveShadows = true;
    try {
      const agg = new PhysicsAggregate(m, PhysicsShapeType.BOX, { mass: 0, friction: 0.7, restitution: 0.05 }, scene);
      applyFilterToAggregate(agg, filter);
    } catch (e) { console.warn('Arena box collider failed:', name, e); }
    return m;
  };

  const _ramp = (name, w, h, l, x, y, z, isXAxis, isNeg, mat) => {
    const hyp = Math.sqrt(h * h + l * l);
    const angle = Math.atan2(h, l);
    const m = MeshBuilder.CreateBox(name, { width: isXAxis ? hyp : w, height: 1, depth: isXAxis ? w : hyp }, scene);
    m.position.set(x, y, z);
    m.material = mat;
    m.receiveShadows = true;
    if (isXAxis) m.rotation.z = isNeg ? -angle : angle;
    else m.rotation.x = isNeg ? angle : -angle;
    try {
      const agg = new PhysicsAggregate(m, PhysicsShapeType.BOX, { mass: 0, friction: 0.8 }, scene);
      applyFilterToAggregate(agg, FILTER.TRACK);
    } catch (e) { console.warn('Arena ramp collider failed:', name, e); }
    return m;
  };

  // Materials
  const matGround = new StandardMaterial("bf-ground-mat", scene);
  matGround.diffuseColor = new Color3(0.45, 0.45, 0.48);
  const matWall = new StandardMaterial("bf-wall-mat", scene);
  matWall.diffuseColor = new Color3(0.12, 0.12, 0.12);
  const matBridge = new StandardMaterial("bf-bridge-mat", scene);
  matBridge.diffuseColor = new Color3(0.55, 0.55, 0.55);

  const colors = {
    red: new Color3(0.85, 0.18, 0.18), blue: new Color3(0.18, 0.35, 0.85),
    yellow: new Color3(0.85, 0.78, 0.15), green: new Color3(0.18, 0.72, 0.28),
  };
  const fortMats = {};
  for (const [k, c] of Object.entries(colors)) {
    const m = new StandardMaterial(`bf-${k}-mat`, scene); m.diffuseColor = c; fortMats[k] = m;
  }

  // Ground
  const ground = MeshBuilder.CreateGround('arenaGround', { width: ARENA, height: ARENA }, scene);
  ground.material = matGround; ground.receiveShadows = true;
  try {
    const gAgg = new PhysicsAggregate(ground, PhysicsShapeType.BOX, { mass: 0, friction: 0.8 }, scene);
    applyFilterToAggregate(gAgg, FILTER.TRACK);
  } catch (e) { console.warn('Arena ground collider failed:', e); }

  // Outer walls
  _box("bf-wall-N", ARENA, WALL_H, WALL_T, 0, WALL_H / 2, -HALF, matWall, FILTER.BOUNDARY);
  _box("bf-wall-S", ARENA, WALL_H, WALL_T, 0, WALL_H / 2,  HALF, matWall, FILTER.BOUNDARY);
  _box("bf-wall-E", WALL_T, WALL_H, ARENA,  HALF, WALL_H / 2, 0, matWall, FILTER.BOUNDARY);
  _box("bf-wall-W", WALL_T, WALL_H, ARENA, -HALF, WALL_H / 2, 0, matWall, FILTER.BOUNDARY);

  // 4 Forts
  const forts = [
    { key: "red", x: -FORT_OFF, z: -FORT_OFF, name: "NW" },
    { key: "blue", x: FORT_OFF, z: -FORT_OFF, name: "NE" },
    { key: "yellow", x: -FORT_OFF, z: FORT_OFF, name: "SW" },
    { key: "green", x: FORT_OFF, z: FORT_OFF, name: "SE" },
  ];
  for (const f of forts) {
    const mat = fortMats[f.key];
    const fx = f.x, fz = f.z;
    _box(`bf-${f.key}-L2`, 2*U, H2, 2*U, fx, H2/2, fz, mat);
    _box(`bf-${f.key}-L1-N`, 4*U, H1, U, fx, H1/2, fz-1.5*U, mat);
    _box(`bf-${f.key}-L1-S`, 4*U, H1, U, fx, H1/2, fz+1.5*U, mat);
    _box(`bf-${f.key}-L1-W`, U, H1, 2*U, fx-1.5*U, H1/2, fz, mat);
    _box(`bf-${f.key}-L1-E`, U, H1, 2*U, fx+1.5*U, H1/2, fz, mat);

    const r1Dist = 3*U;
    if (fx < 0) _ramp(`bf-${f.key}-ramp-gL1`, 2*U, H1, 2*U, fx-r1Dist, H1/2, fz, true, false, mat);
    else _ramp(`bf-${f.key}-ramp-gL1`, 2*U, H1, 2*U, fx+r1Dist, H1/2, fz, true, true, mat);
    if (fz < 0) _ramp(`bf-${f.key}-ramp-gL1z`, 2*U, H1, 2*U, fx, H1/2, fz-r1Dist, false, false, mat);
    else _ramp(`bf-${f.key}-ramp-gL1z`, 2*U, H1, 2*U, fx, H1/2, fz+r1Dist, false, true, mat);

    const r2Dist = 1.5*U, r2Y = H1+(H2-H1)/2, dH = H2-H1;
    if (f.name==="NW") {
      _ramp(`bf-${f.key}-ramp-L2a`, U, dH, U, fx+r2Dist, r2Y, fz+0.5*U, true, true, mat);
      _ramp(`bf-${f.key}-ramp-L2b`, U, dH, U, fx-0.5*U, r2Y, fz+r2Dist, false, true, mat);
    } else if (f.name==="NE") {
      _ramp(`bf-${f.key}-ramp-L2a`, U, dH, U, fx-r2Dist, r2Y, fz+0.5*U, true, false, mat);
      _ramp(`bf-${f.key}-ramp-L2b`, U, dH, U, fx+0.5*U, r2Y, fz+r2Dist, false, true, mat);
    } else if (f.name==="SW") {
      _ramp(`bf-${f.key}-ramp-L2a`, U, dH, U, fx+r2Dist, r2Y, fz-0.5*U, true, true, mat);
      _ramp(`bf-${f.key}-ramp-L2b`, U, dH, U, fx-0.5*U, r2Y, fz-r2Dist, false, false, mat);
    } else {
      _ramp(`bf-${f.key}-ramp-L2a`, U, dH, U, fx-r2Dist, r2Y, fz-0.5*U, true, false, mat);
      _ramp(`bf-${f.key}-ramp-L2b`, U, dH, U, fx+0.5*U, r2Y, fz-r2Dist, false, false, mat);
    }
  }

  // Bridges
  const b1Len = 3*U, b1Y = H1 - BRIDGE_T/2;
  _box("bf-bridge-L1-N", b1Len, BRIDGE_T, U, 0, b1Y, -FORT_OFF+1.5*U, matBridge);
  _box("bf-bridge-L1-S", b1Len, BRIDGE_T, U, 0, b1Y,  FORT_OFF-1.5*U, matBridge);
  _box("bf-bridge-L1-W", U, BRIDGE_T, b1Len, -FORT_OFF+1.5*U, b1Y, 0, matBridge);
  _box("bf-bridge-L1-E", U, BRIDGE_T, b1Len,  FORT_OFF-1.5*U, b1Y, 0, matBridge);

  const b2Len = 5*U, b2Y = H2 - BRIDGE_T/2;
  _box("bf-bridge-L2-N", b2Len, BRIDGE_T, U, 0, b2Y, -FORT_OFF-0.5*U, matBridge);
  _box("bf-bridge-L2-S", b2Len, BRIDGE_T, U, 0, b2Y,  FORT_OFF+0.5*U, matBridge);
  _box("bf-bridge-L2-W", U, BRIDGE_T, b2Len, -FORT_OFF-0.5*U, b2Y, 0, matBridge);
  _box("bf-bridge-L2-E", U, BRIDGE_T, b2Len,  FORT_OFF+0.5*U, b2Y, 0, matBridge);

  // Spawn points ΓÇö spread across the open cross between forts
  const spawnPoints = [
    {x: 20, y: 1, z: 0}, {x: -20, y: 1, z: 0}, {x: 0, y: 1, z: 20}, {x: 0, y: 1, z: -20},
    {x: 14, y: 1, z: 14}, {x: -14, y: 1, z: -14}, {x: 14, y: 1, z: -14}, {x: -14, y: 1, z: 14},
    {x: 0, y: 1, z: 0}, {x: 10, y: 1, z: -10}, {x: -10, y: 1, z: 10}, {x: -10, y: 1, z: -10},
  ];

  return { spawnPoints, bounds: { width: ARENA, depth: ARENA } };
}
