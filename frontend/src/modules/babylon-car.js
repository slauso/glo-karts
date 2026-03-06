/**
 * babylon-car.js — Babylon.js car model loader.
 * Replaces the Three.js-based car.js with equivalent Babylon.js functionality.
 *
 * Loads kart GLB models via @babylonjs/loaders, sets up shadow casting,
 * extracts/creates wheel meshes, and delegates physics to havok-physics.js.
 */

import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import '@babylonjs/loaders/glTF';

import { resolveKartAsset } from './content-registry.js';
import { createKartBody, resetKart as havokResetKart } from './havok-physics.js';

// Visual-only wheel constants (for fallback cylinder geometry)
const WHEEL_RADIUS = 0.4;
const WHEEL_WIDTH  = 0.25;
const WHEEL_X_OFFSET = 0.8;
const WHEEL_Z_OFFSET = 1.5;

const wheelPositions = [
  { x: -WHEEL_X_OFFSET, y: 0, z:  WHEEL_Z_OFFSET, name: 'wheel-fl' },
  { x:  WHEEL_X_OFFSET, y: 0, z:  WHEEL_Z_OFFSET, name: 'wheel-fr' },
  { x: -WHEEL_X_OFFSET, y: 0, z: -WHEEL_Z_OFFSET, name: 'wheel-bl' },
  { x:  WHEEL_X_OFFSET, y: 0, z: -WHEEL_Z_OFFSET, name: 'wheel-br' },
];

/**
 * Load the kart visual model and create the Havok physics body.
 * Fires `onCarLoaded({ carModel, wheelMeshes })` when the GLB is ready.
 *
 * @param {BABYLON.Scene} scene     Babylon.js scene
 * @param {Function}      onCarLoaded  Callback with { carModel, wheelMeshes }
 * @param {BABYLON.ShadowGenerator} shadowGen  Optional shadow generator
 * @returns {{ carModel: null, wheelMeshes: [] }}
 */
export function createVehicle(scene, onCarLoaded, shadowGen) {
  console.log('Starting vehicle creation (Havok + Babylon.js)');

  // Create the Havok physics body
  createKartBody(0, 5.2, 0);

  const carComponents = {
    carModel: null,
    wheelMeshes: [],
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
  let kartId = sessionStorage.getItem('kartId') || 'default';
  try {
    const savedConfig = sessionStorage.getItem('gameConfig');
    if (savedConfig) {
      const gc = JSON.parse(savedConfig);
      const me = gc?.players?.find((p) => p.id === myPlayerId);
      if (me?.kartId) kartId = me.kartId;
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
  const modelScale = kartModelScale ?? 4;

  // Split URL into root + filename for Babylon's SceneLoader
  const lastSlash = modelPath.lastIndexOf('/');
  const rootUrl   = modelPath.substring(0, lastSlash + 1);
  const fileName  = modelPath.substring(lastSlash + 1);

  SceneLoader.ImportMeshAsync('', rootUrl, fileName, scene).then((result) => {
    // Create a root TransformNode for the car
    const carModel = new TransformNode('carRoot', scene);
    carModel.scaling = new Vector3(modelScale, modelScale, modelScale);
    carModel.position = Vector3.Zero();

    // Attach all loaded meshes under the root
    for (const mesh of result.meshes) {
      if (!mesh.parent || mesh.parent === scene) {
        mesh.parent = carModel;
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

    carComponents.carModel = carModel;
    console.log(`Car model loaded: ${modelPath} (scale ${modelScale}${isSTKKart ? ', STK kart' : ', classic'})`);
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
    carModel.scaling = new Vector3(4, 4, 4);
    carModel.position = Vector3.Zero();

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
        found.scaling = new Vector3(4, 4, 4);
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

    carComponents.carModel = carModel;
    console.log('Fallback car model loaded successfully');
    if (onModelLoaded) onModelLoaded(carComponents);
  }).catch((error) => {
    console.error('Error loading fallback red car model:', error);
  });
}

/**
 * Reset kart to a position + quaternion.
 * Thin wrapper around havok-physics resetKart, converting a Babylon quaternion
 * to a Y-axis heading angle.
 */
export function resetCarPosition(position, quaternion) {
  // Extract heading from quaternion (Y-axis Euler angle)
  const euler = quaternion.toEulerAngles('YXZ');
  havokResetKart(
    { x: position.x, y: position.y, z: position.z },
    euler.y,
  );
}
