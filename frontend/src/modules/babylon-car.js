/**
 * babylon-car.js — Babylon.js kart loader with unified-scene physics.
 *
 * Loads kart GLB models and creates a PhysicsAggregate directly on the visual
 * mesh in the rendering scene. No separate NullEngine physics scene.
 * Matches the multiplayer architecture (colyseus-babylon-client.js).
 */

import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { PhysicsAggregate } from '@babylonjs/core/Physics/v2/physicsAggregate';
import { PhysicsShapeType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import { PhysicsMotionType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import '@babylonjs/loaders/glTF';

import { resolveKartAsset } from './content-registry.js';
import { KART_MASS, KART_EXTENTS } from './kart-physics.js';
import { FILTER, applyFilterToAggregate } from './realtime/collision-layers.js';

const KART_SIZE_MULTIPLIER = 1.3;

// Visual-only wheel constants (for fallback cylinder geometry)
const WHEEL_RADIUS = 0.4;
const WHEEL_WIDTH  = 0.25;
const WHEEL_X_OFFSET = 0.8;
const WHEEL_Z_OFFSET = 1.5;

// Module-level refs for resetCarPosition backward compatibility
let _currentKartBody = null;
let _currentCarModel = null;

const wheelPositions = [
  { x: -WHEEL_X_OFFSET, y: 0, z:  WHEEL_Z_OFFSET, name: 'wheel-fl' },
  { x:  WHEEL_X_OFFSET, y: 0, z:  WHEEL_Z_OFFSET, name: 'wheel-fr' },
  { x: -WHEEL_X_OFFSET, y: 0, z: -WHEEL_Z_OFFSET, name: 'wheel-bl' },
  { x:  WHEEL_X_OFFSET, y: 0, z: -WHEEL_Z_OFFSET, name: 'wheel-br' },
];

/**
 * Load the kart visual model and create physics in the SAME scene.
 * Fires `onCarLoaded({ carModel, wheelMeshes, kartAggregate })` when the GLB is ready.
 *
 * @param {BABYLON.Scene} scene       Babylon.js scene (physics-enabled)
 * @param {Function}      onCarLoaded Callback with { carModel, wheelMeshes, kartAggregate }
 * @param {BABYLON.ShadowGenerator} shadowGen  Optional shadow generator
 * @returns {{ carModel: null, wheelMeshes: [], kartAggregate: null }}
 */
export function createVehicle(scene, onCarLoaded, shadowGen) {
  console.log('Starting vehicle creation (unified scene)');

  const carComponents = {
    carModel: null,
    wheelMeshes: [],
    kartAggregate: null,
  };

  loadCarModel(scene, carComponents, shadowGen, (updated) => {
    console.log('Car model fully loaded, calling onCarLoaded callback');
    if (onCarLoaded) onCarLoaded(updated);
  });

  return carComponents;
}

// ── Internal: load kart GLB ───────────────────────────────────────────────

function loadCarModel(scene, carComponents, shadowGen, onModelLoaded) {
  const myPlayerId =
    sessionStorage.getItem('myPlayerId') || localStorage.getItem('myPlayerId');

  // Resolve kart from content registry
  let kartId = sessionStorage.getItem('selectedKart') || sessionStorage.getItem('kartId') || 'tux';
  try {
    const savedConfig = sessionStorage.getItem('gameConfig');
    if (savedConfig) {
      const gc = JSON.parse(savedConfig);
      const me = gc?.players?.find((p) => p.id === myPlayerId);
      if (me?.playerKart) kartId = me.playerKart;
      else if (me?.kartId) kartId = me.kartId;
      // Also check top-level selectedKart
      if (kartId === 'default' && gc?.selectedKart) kartId = gc.selectedKart;
    }
  } catch (_) { /* ignore */ }

  const kartInfo     = resolveKartAsset(kartId);
  const isSTKKart    = kartInfo.id !== 'default';
  const kartModelPath = isSTKKart ? kartInfo.modelPath : null;
  const kartModelScale = isSTKKart ? kartInfo.scale : null;

  // Determine car colour
  let carColor = 'red';
  try {
    const savedConfig = sessionStorage.getItem('gameConfig');
    if (savedConfig) {
      const gameConfig = JSON.parse(savedConfig);
      if (gameConfig?.players) {
        const playerInfo = gameConfig.players.find((p) => p.id === myPlayerId);
        if (playerInfo?.playerColor) {
          carColor = playerInfo.playerColor;
          console.log(`Using car color from gameConfig: ${carColor}`);
        }
      }
    }
  } catch (e) {
    console.error('Error getting car color from game config:', e);
  }
  if (carColor === 'red') {
    const storedColor = sessionStorage.getItem('carColor');
    if (storedColor) {
      carColor = storedColor;
      console.log(`Using car color from sessionStorage: ${carColor}`);
    } else {
      console.log('Using default red color');
    }
  }

  const modelPath  = kartModelPath || `/models/car_${carColor}.glb`;
  const modelScale = (kartModelScale ?? 4) * KART_SIZE_MULTIPLIER;

  // Split URL into root + filename for Babylon's SceneLoader
  const lastSlash = modelPath.lastIndexOf('/');
  const rootUrl   = modelPath.substring(0, lastSlash + 1);
  const fileName  = modelPath.substring(lastSlash + 1);

  SceneLoader.ImportMeshAsync('', rootUrl, fileName, scene).then((result) => {
    // Create a root TransformNode for the car
    const carModel = new TransformNode('carRoot', scene);
    carModel.scaling = new Vector3(modelScale, modelScale, modelScale);
    carModel.position = Vector3.Zero();

    // For STK karts: add an intermediate node rotated 180° so the model
    // faces +Z (forward) to match physics heading conventions.
    const meshParent = isSTKKart
      ? (() => { const n = new TransformNode('kartVis', scene); n.rotation.y = Math.PI; n.parent = carModel; return n; })()
      : carModel;

    // Attach all loaded meshes under the root
    for (const mesh of result.meshes) {
      if (!mesh.parent || mesh.parent === scene) {
        mesh.parent = meshParent;
      }
      // Enable shadow casting
      mesh.isPickable = false;
      if (shadowGen) {
        shadowGen.addShadowCaster(mesh);
      }
    }

    // ── Wheel extraction (only for the old car_*.glb with named wheel meshes) ──
    if (!isSTKKart) {
      const names = ['wheel-fr', 'wheel-fl', 'wheel-br', 'wheel-bl'];
      for (let i = 0; i < names.length; i++) {
        const found = scene.getMeshByName(names[i]);
        if (found) {
          // Detach from car root, make scene-level
          found.parent = null;
          found.scaling = new Vector3(modelScale, modelScale, modelScale);
          carComponents.wheelMeshes[i] = found;
        } else {
          // Create fallback cylinder wheel
          const wm = MeshBuilder.CreateCylinder(names[i], {
            height: WHEEL_WIDTH,
            diameter: WHEEL_RADIUS * 2,
            tessellation: 24,
          }, scene);
          wm.rotation.z = Math.PI / 2;
          const mat = new StandardMaterial(names[i] + '_mat', scene);
          mat.diffuseColor = new Color3(0.13, 0.13, 0.13);
          wm.material = mat;
          wm.scaling = new Vector3(modelScale, modelScale, modelScale);
          if (shadowGen) shadowGen.addShadowCaster(wm);
          carComponents.wheelMeshes[i] = wm;
        }
      }
    }

    // STK karts render their own wheels — create invisible proxies
    if (isSTKKart) {
      for (let i = 0; i < wheelPositions.length; i++) {
        const proxy = MeshBuilder.CreateSphere('wheel_proxy_' + i, { diameter: WHEEL_RADIUS * 2, segments: 6 }, scene);
        proxy.isVisible = false;
        carComponents.wheelMeshes[i] = proxy;
      }
    }

    // Provide a Three.js-compatible interface on the TransformNode for
    // code that reads carModel.position.x, carModel.quaternion, etc.
    // Babylon uses rotationQuaternion natively.
    if (!carModel.rotationQuaternion) {
      carModel.rotationQuaternion = Quaternion.Identity();
    }

    // ── Create PhysicsAggregate on the visual mesh (unified scene) ──
    // The visual mesh IS the physics body — no separate NullEngine.
    const effectiveScale = modelScale;
    const extents = new Vector3(
      KART_EXTENTS.x * effectiveScale,
      KART_EXTENTS.y * effectiveScale,
      KART_EXTENTS.z * effectiveScale,
    );
    carModel.position = new Vector3(0, 5.2, 0);

    const kartAggregate = new PhysicsAggregate(
      carModel,
      PhysicsShapeType.BOX,
      { mass: KART_MASS, friction: 0.8, restitution: 0.1, extents },
      scene,
    );
    // Lock inertia to Y axis only — prevents tipping
    kartAggregate.body.setMassProperties({ inertia: new Vector3(0, 500, 0) });
    applyFilterToAggregate(kartAggregate, FILTER.KART);

    // Start frozen until countdown finishes (STATIC → DYNAMIC on "GO!")
    kartAggregate.body.setMotionType(PhysicsMotionType.STATIC);

    carComponents.kartAggregate = kartAggregate;

    carComponents.carModel = carModel;
    // Cache module-level refs for resetCarPosition backward compat
    _currentKartBody = kartAggregate.body;
    _currentCarModel = carModel;
    console.log(`Car model loaded: ${modelPath} (scale ${modelScale}${isSTKKart ? ', STK kart' : ', classic'}, mass ${KART_MASS})`);
    if (onModelLoaded) onModelLoaded(carComponents);
  }).catch((error) => {
    console.error(`Error loading ${modelPath}:`, error);
    if (carColor !== 'red') {
      loadFallbackCarModel(scene, carComponents, shadowGen, onModelLoaded);
    }
  });
}

function loadFallbackCarModel(scene, carComponents, shadowGen, onModelLoaded) {
  console.log('Falling back to red car model');

  SceneLoader.ImportMeshAsync('', '/models/', 'car_red.glb', scene).then((result) => {
    const carModel = new TransformNode('carRoot', scene);
    carModel.scaling = new Vector3(4 * KART_SIZE_MULTIPLIER, 4 * KART_SIZE_MULTIPLIER, 4 * KART_SIZE_MULTIPLIER);
    carModel.position = new Vector3(0, 5.2, 0);

    for (const mesh of result.meshes) {
      if (!mesh.parent || mesh.parent === scene) {
        mesh.parent = carModel;
      }
      mesh.isPickable = false;
      if (shadowGen) shadowGen.addShadowCaster(mesh);
    }

    const names = ['wheel-fr', 'wheel-fl', 'wheel-br', 'wheel-bl'];
    for (let i = 0; i < names.length; i++) {
      const found = scene.getMeshByName(names[i]);
      if (found) {
        found.parent = null;
        found.scaling = new Vector3(4 * KART_SIZE_MULTIPLIER, 4 * KART_SIZE_MULTIPLIER, 4 * KART_SIZE_MULTIPLIER);
        carComponents.wheelMeshes[i] = found;
      } else {
        const wm = MeshBuilder.CreateCylinder(names[i], {
          height: WHEEL_WIDTH,
          diameter: WHEEL_RADIUS * 2,
          tessellation: 24,
        }, scene);
        wm.rotation.z = Math.PI / 2;
        const mat = new StandardMaterial(names[i] + '_mat', scene);
        mat.diffuseColor = new Color3(0.13, 0.13, 0.13);
        wm.material = mat;
        wm.scaling = new Vector3(4, 4, 4);
        if (shadowGen) shadowGen.addShadowCaster(wm);
        carComponents.wheelMeshes[i] = wm;
      }
    }

    if (!carModel.rotationQuaternion) {
      carModel.rotationQuaternion = Quaternion.Identity();
    }

    // Unified-scene physics on fallback car
    const extents = new Vector3(KART_EXTENTS.x * 4, KART_EXTENTS.y * 4, KART_EXTENTS.z * 4);
    const kartAggregate = new PhysicsAggregate(
      carModel,
      PhysicsShapeType.BOX,
      { mass: KART_MASS, friction: 0.8, restitution: 0.1, extents },
      scene,
    );
    kartAggregate.body.setMassProperties({ inertia: new Vector3(0, 500, 0) });
    applyFilterToAggregate(kartAggregate, FILTER.KART);
    kartAggregate.body.setMotionType(PhysicsMotionType.STATIC);
    carComponents.kartAggregate = kartAggregate;

    carComponents.carModel = carModel;
    console.log('Fallback car model loaded successfully');
    if (onModelLoaded) onModelLoaded(carComponents);
  }).catch((error) => {
    console.error('Error loading fallback red car model:', error);
  });
}

/**
 * Reset kart to a position + quaternion.
 * Uses the module-level kart body/model references from the unified scene.
 * @param {Vector3} position
 * @param {Quaternion} quaternion
 */
export function resetCarPosition(position, quaternion) {
  if (!_currentKartBody || !_currentCarModel) return;
  const euler = quaternion.toEulerAngles('YXZ');
  _currentCarModel.position = new Vector3(position.x, position.y, position.z);
  _currentCarModel.rotationQuaternion = Quaternion.FromEulerAngles(0, euler.y, 0);
  _currentKartBody.setLinearVelocity(new Vector3(0, 0, 0));
  _currentKartBody.setAngularVelocity(new Vector3(0, 0, 0));
  _currentKartBody.disablePreStep = false;
}
