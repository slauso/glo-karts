import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { resolveKartAsset } from './content-registry.js';
import { createKartBody, resetKart as havokResetKart } from './havok-physics.js';

// Visual-only wheel constants (for fallback cylinder geometry)
const WHEEL_RADIUS = 0.4;
const WHEEL_WIDTH  = 0.25;
const WHEEL_X_OFFSET = 0.8;
const WHEEL_Z_OFFSET = 1.5;

const wheelPositions = [
  { x: -WHEEL_X_OFFSET, y: 0, z: WHEEL_Z_OFFSET,  name: 'wheel-fl' },
  { x:  WHEEL_X_OFFSET, y: 0, z: WHEEL_Z_OFFSET,  name: 'wheel-fr' },
  { x: -WHEEL_X_OFFSET, y: 0, z: -WHEEL_Z_OFFSET, name: 'wheel-bl' },
  { x:  WHEEL_X_OFFSET, y: 0, z: -WHEEL_Z_OFFSET, name: 'wheel-br' },
];

/**
 * Load the kart visual model and create the Havok physics body.
 * Fires `onCarLoaded({ carModel, wheelMeshes })` when the GLB is ready.
 */
export function createVehicle(scene, onCarLoaded) {
  console.log('Starting vehicle creation (Havok)');

  // Create the Havok physics body
  createKartBody(0, 5.2, 0);

  const carComponents = {
    carModel: null,
    wheelMeshes: [],
  };

  loadCarModel(scene, carComponents, (updated) => {
    console.log('Car model fully loaded, calling onCarLoaded callback');
    if (onCarLoaded) onCarLoaded(updated);
  });

  return carComponents;
}

// ── Internal: load kart GLB ───────────────────────────────────────────────

function loadCarModel(scene, carComponents, onModelLoaded) {
  const loader = new GLTFLoader();

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

  const kartInfo    = resolveKartAsset(kartId);
  const isSTKKart   = kartInfo.id !== 'default';
  const kartModelPath  = isSTKKart ? kartInfo.modelPath : null;
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

  loader.load(
    modelPath,
    (gltf) => {
      const carModel = gltf.scene;
      carModel.scale.setScalar(modelScale);
      carModel.position.set(0, 0, 0);

      carModel.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = false;
        }
      });

      // ── Wheel extraction (only for the old car_*.glb with named wheel meshes) ──
      if (!isSTKKart) {
        const names = ['wheel-fr', 'wheel-fl', 'wheel-br', 'wheel-bl'];
        const wheelModelMeshes = names.map((n) => carModel.getObjectByName(n));

        for (let i = 0; i < wheelModelMeshes.length; i++) {
          if (wheelModelMeshes[i]) {
            wheelModelMeshes[i].updateMatrixWorld(true);
            carModel.remove(wheelModelMeshes[i]);
            scene.add(wheelModelMeshes[i]);
            wheelModelMeshes[i].scale.setScalar(modelScale);
            carComponents.wheelMeshes[i] = wheelModelMeshes[i];
          } else {
            const geo = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 24);
            geo.rotateZ(Math.PI / 2);
            const mat = new THREE.MeshStandardMaterial({ color: 0x222222 });
            const wm  = new THREE.Mesh(geo, mat);
            wm.castShadow = true;
            scene.add(wm);
            wm.scale.setScalar(modelScale);
            carComponents.wheelMeshes[i] = wm;
          }
        }
      }

      // STK karts render their own wheels — create invisible proxies
      if (isSTKKart) {
        for (let i = 0; i < wheelPositions.length; i++) {
          const geo   = new THREE.SphereGeometry(WHEEL_RADIUS, 6, 6);
          const mat   = new THREE.MeshBasicMaterial({ visible: false });
          const proxy = new THREE.Mesh(geo, mat);
          scene.add(proxy);
          carComponents.wheelMeshes[i] = proxy;
        }
      }

      scene.add(carModel);
      carComponents.carModel = carModel;
      console.log(`Car model loaded: ${modelPath} (scale ${modelScale}${isSTKKart ? ', STK kart' : ', classic'})`);
      if (onModelLoaded) onModelLoaded(carComponents);
    },
    undefined,
    (error) => {
      console.error(`Error loading ${carColor} car model:`, error);
      if (carColor !== 'red') {
        loadFallbackCarModel(scene, carComponents, onModelLoaded);
      }
    },
  );
}

function loadFallbackCarModel(scene, carComponents, onModelLoaded) {
  console.log('Falling back to red car model');
  const loader = new GLTFLoader();

  loader.load(
    '/models/car_red.glb',
    (gltf) => {
      const carModel = gltf.scene;
      carModel.scale.set(4, 4, 4);
      carModel.position.set(0, 0, 0);

      carModel.traverse((node) => {
        if (node.isMesh) { node.castShadow = true; node.receiveShadow = false; }
      });

      const names = ['wheel-fr', 'wheel-fl', 'wheel-br', 'wheel-bl'];
      const wheelModelMeshes = names.map((n) => carModel.getObjectByName(n));

      for (let i = 0; i < wheelModelMeshes.length; i++) {
        if (wheelModelMeshes[i]) {
          wheelModelMeshes[i].updateMatrixWorld(true);
          carModel.remove(wheelModelMeshes[i]);
          scene.add(wheelModelMeshes[i]);
          wheelModelMeshes[i].scale.set(4, 4, 4);
          carComponents.wheelMeshes[i] = wheelModelMeshes[i];
        } else {
          const geo = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 24);
          geo.rotateZ(Math.PI / 2);
          const mat = new THREE.MeshStandardMaterial({ color: 0x222222 });
          const wm  = new THREE.Mesh(geo, mat);
          wm.castShadow = true;
          scene.add(wm);
          wm.scale.set(4, 4, 4);
          carComponents.wheelMeshes[i] = wm;
        }
      }

      scene.add(carModel);
      carComponents.carModel = carModel;
      console.log('Fallback car model loaded successfully');
      if (onModelLoaded) onModelLoaded(carComponents);
    },
    undefined,
    (error) => { console.error('Error loading fallback red car model:', error); },
  );
}

/**
 * Reset kart to a position + quaternion.
 * Thin wrapper around havok-physics resetKart, converting a THREE.Quaternion
 * to a Y-axis heading angle.
 */
export function resetCarPosition(position, quaternion) {
  // Extract heading from quaternion (Y-axis Euler angle)
  const euler = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w),
    'YXZ',
  );
  havokResetKart(
    { x: position.x, y: position.y, z: position.z },
    euler.y,
  );
}