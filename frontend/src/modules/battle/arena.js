import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import "@babylonjs/loaders/glTF";
import { isSTKArena, getTrackModelPath, getTrackScale, getStartPosition } from '../track-data.js';
import { createTrackCollider, createBoxCollider } from '../havok-physics.js';

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
  const vertices = [];
  const indices = [];
  let indexOffset = 0;

  root.computeWorldMatrix(true);

  meshes.forEach((mesh) => {
    if (mesh.getTotalVertices() === 0) return;
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
    if (!positions) return;

    mesh.computeWorldMatrix(true);
    const worldMatrix = mesh.getWorldMatrix();
    const vertexCount = positions.length / 3;

    for (let i = 0; i < vertexCount; i++) {
      const local = new Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      const world = Vector3.TransformCoordinates(local, worldMatrix);
      vertices.push(world.x, world.y, world.z);
    }

    const meshIndices = mesh.getIndices();
    if (meshIndices) {
      for (let i = 0; i < meshIndices.length; i++) indices.push(meshIndices[i] + indexOffset);
    } else {
      for (let i = 0; i < vertexCount; i++) indices.push(i + indexOffset);
    }
    indexOffset += vertexCount;
  });

  createTrackCollider(new Float32Array(vertices), new Uint32Array(indices), 1.0);
  console.log(`Arena Havok collider created (${indices.length / 3} triangles)`);
}

function createBoxArena(scene) {
  const width = 100;
  const depth = 100;
  const wallHeight = 5;

  const ground = MeshBuilder.CreateGround('arenaGround', { width, height: depth }, scene);
  const groundMat = new StandardMaterial('arenaGroundMat', scene);
  groundMat.diffuseColor = new Color3(0.29, 0.29, 0.29);
  ground.material = groundMat;
  ground.receiveShadows = true;

  createBoxCollider({ x: width / 2, y: 0.5, z: depth / 2 }, { x: 0, y: -0.5, z: 0 }, 0, 0.9);

  const wallMat = new StandardMaterial('arenaWallMat', scene);
  wallMat.diffuseColor = new Color3(1, 0.42, 0.42);

  const walls = [
    { pos: [0, wallHeight / 2, depth / 2], rotY: 0, size: [width, wallHeight, 1] },
    { pos: [0, wallHeight / 2, -depth / 2], rotY: 0, size: [width, wallHeight, 1] },
    { pos: [width / 2, wallHeight / 2, 0], rotY: Math.PI / 2, size: [depth, wallHeight, 1] },
    { pos: [-width / 2, wallHeight / 2, 0], rotY: Math.PI / 2, size: [depth, wallHeight, 1] },
  ];

  walls.forEach((w, i) => {
    const wallMesh = MeshBuilder.CreateBox(`arenaWall${i}`, {
      width: w.size[0], height: w.size[1], depth: w.size[2],
    }, scene);
    wallMesh.material = wallMat;
    wallMesh.position.copyFromFloats(w.pos[0], w.pos[1], w.pos[2]);
    wallMesh.rotation.y = w.rotY;
    wallMesh.receiveShadows = true;
    createBoxCollider(
      { x: w.size[0] / 2, y: w.size[1] / 2, z: w.size[2] / 2 },
      { x: w.pos[0], y: w.pos[1], z: w.pos[2] },
      w.rotY, 0.6,
    );
  });

  const spawnPoints = [];
  const spawnRadius = 28;
  const spawnCount = 12;
  for (let i = 0; i < spawnCount; i++) {
    const angle = (i / spawnCount) * Math.PI * 2;
    spawnPoints.push({ x: Math.cos(angle) * spawnRadius, y: 3, z: Math.sin(angle) * spawnRadius });
  }

  return { spawnPoints, bounds: { width, depth } };
}
