/**
 * babylon-track.js — Babylon.js track model loader with unified-scene physics.
 *
 * Loads track/arena GLB models, creates per-mesh clone+bake physics colliders
 * in the SAME rendering scene. No separate NullEngine physics scene.
 * Matches the multiplayer architecture (colyseus-babylon-client._createTrackPhysics).
 */

import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Quaternion } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PhysicsAggregate } from '@babylonjs/core/Physics/v2/physicsAggregate';
import { PhysicsShapeType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import '@babylonjs/loaders/glTF';

import { getTrackModelPath, getTrackScale, getTrackInfo, isCustomMap, getFallThreshold, isAddonTrack, getAddonParams } from './track-data.js';
import { FILTER, applyFilterToAggregate } from './realtime/collision-layers.js';
import { createProceduralAddonTrack } from './procedural-tracks.js';
import { generateProceduralTrack } from './procedural-track-gen.js';
import { generateProceduralArena } from './procedural-arena-gen.js';
import { generateDemoCourse, generateDemoArena } from './procedural-demo-course.js';

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
    // ── Phase 19.4 procedural demo course ──
    if (mapId === 'glo_circuit') {
      try {
        const result = generateDemoCourse(scene);
        if (callback) callback(result.root);
        return;
      } catch (e) {
        console.warn(`[track] Demo course generation failed for ${mapId}:`, e);
      }
    } else if (mapId === 'glo_arena') {
      try {
        const result = generateDemoArena(scene);
        if (callback) callback(result.root);
        return;
      } catch (e) {
        console.warn(`[track] Demo arena generation failed for ${mapId}:`, e);
      }
    }

    // ── New procedural generators (19.13) ──
    // Arena maps (identified by addon params or "arena" in ID)
    const addonParams = getAddonParams(mapId);
    const isArena = addonParams?.isArena || /arena|battle|soccer/i.test(mapId);

    if (isArena) {
      console.log(`[track] Generating procedural arena for "${mapId}" (19.x generator)`);
      try {
        const result = generateProceduralArena(mapId, scene);
        if (callback) callback(result.root);
        return;
      } catch (e) {
        console.warn('[track] Procedural arena gen failed, falling back:', e.message);
      }
    }

    // Race tracks — try advanced generator first
    if (!isArena) {
      console.log(`[track] Generating procedural track for "${mapId}" (19.x generator)`);
      try {
        const result = generateProceduralTrack(mapId, scene);
        if (callback) callback(result.root);
        return;
      } catch (e) {
        console.warn('[track] Procedural track gen failed, falling back:', e.message);
      }
    }

    // Legacy addon fallback
    if (addonParams) {
      console.log(`[track] Falling back to legacy procedural addon for "${mapId}"`);
      const track = createProceduralAddonTrack(mapId, addonParams, scene);
      if (callback) callback(track);
      return;
    }

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

    // Create per-mesh physics colliders in the SAME scene (clone+bake pattern)
    _createTrackPhysics(result, scene);

    // Add kill-plane boundary below the track
    _createKillPlane(scene);

    if (callback && typeof callback === 'function') {
      callback(track);
    }
  }).catch((error) => {
    console.error(`Error loading track for ${mapId}:`, error);
  });
}

/**
 * Build a large flat arena with four border walls (solo/race mode).
 * Physics colliders are created directly in the rendering scene.
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
  const groundCollider = MeshBuilder.CreateBox('ground-collider', { width: HALF * 2, height: 0.2, depth: HALF * 2 }, scene);
  groundCollider.position.y = -0.1;
  groundCollider.isVisible = false;
  const groundAgg = new PhysicsAggregate(groundCollider, PhysicsShapeType.BOX, { mass: 0, friction: 0.9, restitution: 0.05 }, scene);
  applyFilterToAggregate(groundAgg, FILTER.TRACK);

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
    // Physics collider directly on the visual wall
    const wallAgg = new PhysicsAggregate(wall, PhysicsShapeType.BOX, { mass: 0, friction: 0.6, restitution: 0.05 }, scene);
    applyFilterToAggregate(wallAgg, FILTER.TRACK);
  }

  // Kill plane
  _createKillPlane(scene);

  return root;
}

/**
 * Create per-mesh static trimesh physics colliders (clone+bake pattern).
 * Matches colyseus-babylon-client._createTrackPhysics().
 */
function _createTrackPhysics(importResult, scene) {
  if (!importResult?.meshes?.length) return;

  const geometryMeshes = importResult.meshes.filter(
    (m) => m.getTotalVertices && m.getTotalVertices() > 0 && m.isVisible !== false
  );

  if (geometryMeshes.length === 0) {
    console.warn('[track] Track has zero geometry meshes – skipping physics');
    return;
  }

  // Ensure world matrices are up-to-date
  scene.render();
  geometryMeshes.forEach((m) => m.computeWorldMatrix(true));

  let physicsCreated = 0;

  for (const mesh of geometryMeshes) {
    try {
      const clone = mesh.clone(`${mesh.name}_collider`, null);
      if (!clone) continue;

      clone.computeWorldMatrix(true);
      clone.bakeCurrentTransformIntoVertices();
      clone.parent = null;
      clone.position.copyFromFloats(0, 0, 0);
      if (clone.rotationQuaternion) {
        clone.rotationQuaternion.copyFromFloats(0, 0, 0, 1);
      } else {
        clone.rotation.copyFromFloats(0, 0, 0);
      }
      clone.scaling.copyFromFloats(1, 1, 1);
      clone.isVisible = false;

      const agg = new PhysicsAggregate(
        clone, PhysicsShapeType.MESH,
        { mass: 0, friction: 0.6, restitution: 0.05 },
        scene,
      );
      applyFilterToAggregate(agg, FILTER.TRACK);
      physicsCreated++;
    } catch (err) {
      console.warn(`[track] Physics failed for mesh "${mesh.name}":`, err.message);
    }
  }

  console.log(`[track] Track physics: ${physicsCreated}/${geometryMeshes.length} colliders created`);

  // Safety net: if no colliders were created, add a large flat ground
  if (physicsCreated === 0) {
    const fallback = MeshBuilder.CreateGround('fallbackGround', { width: 400, height: 400 }, scene);
    fallback.isVisible = false;
    const fbAgg = new PhysicsAggregate(fallback, PhysicsShapeType.BOX, { mass: 0, friction: 0.6, restitution: 0.05 }, scene);
    applyFilterToAggregate(fbAgg, FILTER.TRACK);
    console.warn('[track] Created fallback ground collider');
  }
}

/**
 * Create a kill-plane boundary below the track for out-of-bounds detection.
 */
function _createKillPlane(scene) {
  const killPlane = MeshBuilder.CreateBox('killPlane', { width: 2000, height: 1, depth: 2000 }, scene);
  killPlane.position.y = -80;
  killPlane.isVisible = false;
  killPlane._isBoundary = true;
  const kpAgg = new PhysicsAggregate(killPlane, PhysicsShapeType.BOX, { mass: 0, friction: 0, restitution: 0 }, scene);
  applyFilterToAggregate(kpAgg, FILTER.BOUNDARY);
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
 * Uses the carModel's position directly from the unified scene.
 * @param {Function} resetFunction  Callback to execute on fall-off
 * @param {number}   fallThreshold  Y position below which to reset
 * @param {import("@babylonjs/core").TransformNode} [carModel]  Optional car mesh — if provided, use directly
 */
export function checkGroundCollision(resetFunction, fallThreshold = -50, carModel) {
  if (carModel) {
    if (carModel.position.y < fallThreshold) {
      console.log('Car fell off track - resetting position');
      if (resetFunction) resetFunction();
    }
    return;
  }
  // Legacy fallback: check using window._carModel if set
  const model = typeof window !== 'undefined' && window._carModel;
  if (model && model.position && model.position.y < fallThreshold) {
    console.log('Car fell off track - resetting position');
    if (resetFunction) resetFunction();
  }
}
