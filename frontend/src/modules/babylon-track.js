/**
 * babylon-track.js — Babylon.js track model loader.
 * Replaces the Three.js-based track.js with equivalent Babylon.js functionality.
 *
 * Loads track/arena GLB models, sets up PBR materials with double-sided rendering
 * and vertex normal recomputation for STK meshes, then extracts geometry for the
 * Havok trimesh collider.
 */

import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import '@babylonjs/loaders/glTF';

import { getTrackModelPath, getTrackScale, getTrackInfo, isCustomMap, getFallThreshold } from './track-data.js';
import { createTrackCollider, createBoxCollider, getKartY } from './havok-physics.js';

/**
 * Load the track model and add to the Babylon.js scene.
 *
 * @param {string}        mapId    Track identifier
 * @param {BABYLON.Scene}  scene    Babylon.js scene
 * @param {object|null}   loadingManager  Unused (kept for API compat)
 * @param {Function}      callback Called with root TransformNode when loaded
 * @param {BABYLON.ShadowGenerator} shadowGen  Optional shadow generator
 */
export function loadTrackModel(mapId = 'test_box', scene, loadingManager, callback, shadowGen) {
  const modelPath = getTrackModelPath(mapId);

  // Procedural track — no GLB to load, build geometry inline
  if (!modelPath) {
    console.log(`[track] Creating procedural test-box arena for "${mapId}"`);
    const track = _createProceduralTestBox(scene);
    if (callback) callback(track);
    return;
  }

  const scale = getTrackScale(mapId);
  console.log(`Loading track model from: ${modelPath} (scale ${scale})`);

  const lastSlash = modelPath.lastIndexOf('/');
  const rootUrl   = modelPath.substring(0, lastSlash + 1);
  const fileName  = modelPath.substring(lastSlash + 1);

  SceneLoader.ImportMeshAsync('', rootUrl, fileName, scene).then((result) => {
    const track = new TransformNode('trackRoot', scene);
    track.scaling = new Vector3(scale, scale, scale);
    track.position = Vector3.Zero();

    for (const mesh of result.meshes) {
      if (!mesh.parent || mesh.parent === scene) {
        mesh.parent = track;
      }

      if (mesh instanceof Mesh && mesh.geometry) {
        // Recompute vertex normals (STK SPM pipeline may skip normals)
        mesh.createNormals(true);

        // Enable double-sided rendering for thin STK geometry
        if (mesh.material) {
          const mats = Array.isArray(mesh.material.subMaterials)
            ? mesh.material.subMaterials
            : [mesh.material];
          for (const mat of mats) {
            mat.backFaceCulling = false;
            if (mat.roughness !== undefined) {
              mat.roughness = 0.7;
              mat.metallic = 0.3;
            }
          }
        }

        // Shadows
        if (shadowGen) {
          shadowGen.addShadowCaster(mesh);
        }
        mesh.receiveShadows = true;
      }
    }

    console.log(`Map ${mapId} track loaded successfully`);

    // Create Havok trimesh collider
    addTrackColliderHavok(track, scene);

    if (callback && typeof callback === 'function') {
      callback(track);
    }
  }).catch((error) => {
    console.error(`Error loading track for ${mapId}:`, error);
  });
}

/**
 * Build a large flat arena with four border walls (solo/race mode).
 * Physics colliders are created via havok-physics.js createBoxCollider.
 */
function _createProceduralTestBox(scene) {
  const HALF = 100;
  const WALL_H = 6;
  const WALL_T = 1;
  const root = new TransformNode('trackRoot', scene);

  // Floor
  const ground = MeshBuilder.CreateGround('test-box-floor', { width: HALF * 2, height: HALF * 2 }, scene);
  ground.parent = root;
  const floorMat = new StandardMaterial('test-box-floor-mat', scene);
  floorMat.diffuseColor = new Color3(0.35, 0.35, 0.4);
  ground.material = floorMat;
  createBoxCollider({ x: HALF, y: 0.1, z: HALF }, { x: 0, y: 0, z: 0 });

  // Grid overlay
  const gridMat = new StandardMaterial('test-box-grid-mat', scene);
  gridMat.diffuseColor = new Color3(0.5, 0.5, 0.55);
  gridMat.alpha = 0.4;
  gridMat.wireframe = true;
  const gridPlane = MeshBuilder.CreateGround('test-box-grid', { width: HALF * 2, height: HALF * 2, subdivisions: 20 }, scene);
  gridPlane.position.y = 0.02;
  gridPlane.parent = root;
  gridPlane.material = gridMat;

  // Walls
  const wallMat = new StandardMaterial('test-box-wall-mat', scene);
  wallMat.diffuseColor = new Color3(0.6, 0.15, 0.15);
  wallMat.alpha = 0.7;

  const wallDefs = [
    { name: 'wall-N', w: HALF * 2, h: WALL_H, d: WALL_T, x: 0,     y: WALL_H / 2, z: -HALF },
    { name: 'wall-S', w: HALF * 2, h: WALL_H, d: WALL_T, x: 0,     y: WALL_H / 2, z:  HALF },
    { name: 'wall-E', w: WALL_T,   h: WALL_H, d: HALF * 2, x:  HALF, y: WALL_H / 2, z: 0    },
    { name: 'wall-W', w: WALL_T,   h: WALL_H, d: HALF * 2, x: -HALF, y: WALL_H / 2, z: 0    },
  ];
  for (const wd of wallDefs) {
    const wall = MeshBuilder.CreateBox(wd.name, { width: wd.w, height: wd.h, depth: wd.d }, scene);
    wall.position.set(wd.x, wd.y, wd.z);
    wall.material = wallMat;
    wall.parent = root;
    createBoxCollider({ x: wd.w / 2, y: wd.h / 2, z: wd.d / 2 }, { x: wd.x, y: wd.y, z: wd.z });
  }

  return root;
}

/**
 * Extract geometry from a Babylon.js model and create a Havok trimesh collider.
 */
function addTrackColliderHavok(trackNode, scene) {
  const MAX_TRIANGLES = 80000;
  const positions = [];
  const indices = [];
  let vertOffset = 0;
  let triCount = 0;

  // Get all descendant meshes
  const meshes = trackNode.getChildMeshes(false);

  for (const child of meshes) {
    if (triCount >= MAX_TRIANGLES) break;
    if (!(child instanceof Mesh) || !child.geometry) continue;

    const posData = child.getVerticesData(VertexBuffer.PositionKind);
    if (!posData) continue;

    const worldMatrix = child.computeWorldMatrix(true);
    const idx = child.getIndices();

    // Append world-space vertices
    const baseVert = vertOffset;
    for (let i = 0; i < posData.length; i += 3) {
      const local = new Vector3(posData[i], posData[i + 1], posData[i + 2]);
      const world = Vector3.TransformCoordinates(local, worldMatrix);
      positions.push(world.x, world.y, world.z);
      vertOffset++;
    }

    // Append triangle indices
    if (idx) {
      for (let i = 0; i + 2 < idx.length && triCount < MAX_TRIANGLES; i += 3) {
        indices.push(baseVert + idx[i], baseVert + idx[i + 1], baseVert + idx[i + 2]);
        triCount++;
      }
    } else {
      const vertCount = posData.length / 3;
      for (let i = 0; i + 2 < vertCount && triCount < MAX_TRIANGLES; i += 3) {
        indices.push(baseVert + i, baseVert + i + 1, baseVert + i + 2);
        triCount++;
      }
    }
  }

  createTrackCollider(
    new Float32Array(positions),
    new Uint32Array(indices),
    1.0,
  );
  console.log(`Track physics collider (Havok): ${triCount.toLocaleString()} triangles (cap ${MAX_TRIANGLES.toLocaleString()})`);
}

/**
 * Load map decorations (only for custom maps, STK tracks skip this).
 *
 * @param {string}        mapId
 * @param {BABYLON.Scene}  scene
 * @param {object|null}   renderer  Unused (kept for API compat)
 * @param {object|null}   camera    Unused (kept for API compat)
 * @param {object|null}   loadingManager  Unused
 * @param {BABYLON.ShadowGenerator} shadowGen  Optional shadow generator
 */
export function loadMapDecorations(mapId = 'map1', scene, renderer, camera, loadingManager, shadowGen) {
  if (!isCustomMap(mapId)) {
    console.log(`Skipping decorations for ${mapId} (STK track/arena — no decorations.glb)`);
    return;
  }

  const scale = getTrackScale(mapId);
  const decoPath = `/models/maps/${mapId}/`;

  SceneLoader.ImportMeshAsync('', decoPath, 'decorations.glb', scene).then((result) => {
    const decorations = new TransformNode('decorationsRoot', scene);
    decorations.scaling = new Vector3(scale, scale, scale);
    decorations.position = Vector3.Zero();

    for (const mesh of result.meshes) {
      if (!mesh.parent || mesh.parent === scene) {
        mesh.parent = decorations;
      }

      if (mesh.material) {
        mesh.material.backFaceCulling = false;
        if (mesh.material.roughness !== undefined) {
          mesh.material.roughness = 0.7;
          mesh.material.metallic = 0.2;
        }
      }

      if (shadowGen) shadowGen.addShadowCaster(mesh);
      mesh.receiveShadows = true;
    }

    console.log(`Map ${mapId} decorations loaded successfully`);
  }).catch((error) => {
    console.error(`Error loading map decorations for ${mapId}:`, error);
  });
}

/**
 * Check if the kart has fallen below the fall threshold.
 */
export function checkGroundCollision(resetFunction, fallThreshold = -50) {
  const y = getKartY();
  if (y < fallThreshold) {
    console.log('Car fell off track - resetting position');
    if (resetFunction) resetFunction();
  }
}
