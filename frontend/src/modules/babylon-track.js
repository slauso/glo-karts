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
import { generateDemoArena } from './procedural-demo-course.js';
import { generateMapDefinition } from './map-definition-generator.js';

// Expose a global or scene-attached definition so the game logic can grab generated metadata
export let currentMapDefinition = null;

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
    if (mapId === 'glo_arena') {
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

      // Auto-generate missing metadata immediately from imported geometry
      currentMapDefinition = generateMapDefinition(scene, result, {
        numPlayers: 12,
        numItems: 12,
        generateWalls: true,
        applyPhysics: false // handled below by unified clone+bake
      });


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
  const U = 10;
  const ARENA = 17 * U;
  const HALF = ARENA / 2;
  const H1 = 1.5 * U;
  const H2 = 3.0 * U;
  const WALL_H = 4 * U;
  const WALL_T = 2;
  const BRIDGE_T = 0.2 * U;
  const FORT_OFF = 3.5 * U;
  const root = new TransformNode('trackRoot', scene);

  const _box = (name, w, h, d, x, y, z, mat, filter = FILTER.TRACK) => {
    const m = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
    m.position.set(x, y, z); m.material = mat; m.parent = root; m.receiveShadows = true;
    const agg = new PhysicsAggregate(m, PhysicsShapeType.BOX, { mass: 0, friction: 0.7, restitution: 0.05 }, scene);
    applyFilterToAggregate(agg, filter);
    return m;
  };

  const _ramp = (name, w, h, l, x, y, z, isXAxis, isNeg, mat) => {
    const hyp = Math.sqrt(h * h + l * l);
    const angle = Math.atan2(h, l);
    const m = MeshBuilder.CreateBox(name, { width: isXAxis ? hyp : w, height: 1, depth: isXAxis ? w : hyp }, scene);
    m.position.set(x, y, z); m.material = mat; m.parent = root; m.receiveShadows = true;
    if (isXAxis) m.rotation.z = isNeg ? -angle : angle;
    else m.rotation.x = isNeg ? angle : -angle;
    const agg = new PhysicsAggregate(m, PhysicsShapeType.BOX, { mass: 0, friction: 0.8 }, scene);
    applyFilterToAggregate(agg, FILTER.TRACK);
    return m;
  };

  // Materials
  const matGround = new StandardMaterial("bf-ground-mat", scene);
  matGround.diffuseColor = new Color3(0.45, 0.45, 0.48);
  const matWall = new StandardMaterial("bf-wall-mat", scene);
  matWall.diffuseColor = new Color3(0.12, 0.12, 0.12);
  const matBridge = new StandardMaterial("bf-bridge-mat", scene);
  matBridge.diffuseColor = new Color3(0.55, 0.55, 0.55);
  const fortColors = {
    red: new Color3(0.85, 0.18, 0.18), blue: new Color3(0.18, 0.35, 0.85),
    yellow: new Color3(0.85, 0.78, 0.15), green: new Color3(0.18, 0.72, 0.28),
  };
  const fortMats = {};
  for (const [k, c] of Object.entries(fortColors)) {
    const m = new StandardMaterial(`bf-${k}-mat`, scene); m.diffuseColor = c; fortMats[k] = m;
  }

  // Ground
  const ground = MeshBuilder.CreateGround('bf-ground', { width: ARENA, height: ARENA }, scene);
  ground.material = matGround; ground.parent = root; ground.receiveShadows = true;
  const groundCollider = MeshBuilder.CreateBox('ground-collider', { width: ARENA, height: 0.2, depth: ARENA }, scene);
  groundCollider.position.y = -0.1; groundCollider.isVisible = false;
  const groundAgg = new PhysicsAggregate(groundCollider, PhysicsShapeType.BOX, { mass: 0, friction: 0.8 }, scene);
  applyFilterToAggregate(groundAgg, FILTER.TRACK);

  // Grid overlay
  const gridMat = new StandardMaterial('bf-grid-mat', scene);
  gridMat.diffuseColor = new Color3(0.55, 0.55, 0.58); gridMat.alpha = 0.35; gridMat.wireframe = true;
  const grid = MeshBuilder.CreateGround('bf-grid', { width: ARENA, height: ARENA, subdivisions: 17 }, scene);
  grid.position.y = 0.02; grid.parent = root; grid.material = gridMat;

  // Outer walls
  _box("bf-wall-N", ARENA, WALL_H, WALL_T, 0, WALL_H/2, -HALF, matWall, FILTER.BOUNDARY);
  _box("bf-wall-S", ARENA, WALL_H, WALL_T, 0, WALL_H/2,  HALF, matWall, FILTER.BOUNDARY);
  _box("bf-wall-E", WALL_T, WALL_H, ARENA,  HALF, WALL_H/2, 0, matWall, FILTER.BOUNDARY);
  _box("bf-wall-W", WALL_T, WALL_H, ARENA, -HALF, WALL_H/2, 0, matWall, FILTER.BOUNDARY);

  // 4 Forts
  const forts = [
    { key: "red", x: -FORT_OFF, z: -FORT_OFF, name: "NW" },
    { key: "blue", x: FORT_OFF, z: -FORT_OFF, name: "NE" },
    { key: "yellow", x: -FORT_OFF, z: FORT_OFF, name: "SW" },
    { key: "green", x: FORT_OFF, z: FORT_OFF, name: "SE" },
  ];
  for (const f of forts) {
    const mat = fortMats[f.key]; const fx = f.x, fz = f.z;
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

  _createKillPlane(scene);

  return root;
}

/**
 * Create per-mesh static trimesh physics colliders (clone+bake pattern).
 * Matches colyseus-babylon-client._createTrackPhysics().
 */
function _createTrackPhysics(importResult, scene) {
  if (!importResult?.meshes?.length) return;

  // Broader filter: include InstancedMesh, don't filter by isVisible
  const geometryMeshes = importResult.meshes.filter((m) => {
    if (!m.getTotalVertices) return false;
    if (m.getTotalVertices() > 0) return true;
    if (m.sourceMesh && m.sourceMesh.getTotalVertices && m.sourceMesh.getTotalVertices() > 0) return true;
    return false;
  });

  console.log(`[track] Geometry meshes found: ${geometryMeshes.length} / ${importResult.meshes.length} total`);

  if (geometryMeshes.length === 0) {
    console.warn('[track] Track has zero geometry meshes – using fallback');
    return;
  }

  // Ensure world matrices are up-to-date
  scene.render();
  geometryMeshes.forEach((m) => m.computeWorldMatrix(true));

  let physicsCreated = 0;

  for (const mesh of geometryMeshes) {
    try {
      const sourceMesh = mesh.sourceMesh || mesh;
      const clone = sourceMesh.clone(`${mesh.name}_collider`, null);
      if (!clone) continue;

      if (mesh.sourceMesh) {
        clone.position.copyFrom(mesh.absolutePosition);
        if (mesh.absoluteRotationQuaternion) {
          clone.rotationQuaternion = mesh.absoluteRotationQuaternion.clone();
        }
        clone.scaling.copyFrom(mesh.absoluteScaling);
      }

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
export function loadMapDecorations(mapId = 'test_box', scene, renderer, camera, loadingManager, shadowGen) {
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
