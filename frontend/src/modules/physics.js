/**
 * physics.js — Thin relay over havok-physics.js.
 *
 * Exports kept compatible with existing callers so main.js / battle-main.js
 * need only minimal changes.
 */

import {
  initPhysicsEngine,
  applyKartDriving,
  stepPhysics as havokStep,
  getKartTransform,
} from './havok-physics.js';

// Re-export the async init (no longer takes an `ammo` argument)
export async function initPhysics() {
  await initPhysicsEngine();
  console.log('Physics world initialised (Havok)');
}

/**
 * Run one fixed-timestep tick: apply driving input, step Havok, sync Three.js mesh.
 *
 * @param {number}  deltaTime
 * @param {object}  carState   { carModel, wheelMeshes, keyState }
 * @param {object}  raceState  { raceStarted, raceFinished }
 * @returns {{ currentSpeed: number }}
 */
export function updatePhysics(deltaTime, carState, raceState) {
  const { carModel, wheelMeshes, keyState } = carState;

  // Apply arcade kart input
  const { speedKPH } = applyKartDriving(
    keyState,
    raceState.raceStarted,
    raceState.raceFinished,
    deltaTime,
  );

  // Advance the Havok simulation
  havokStep();

  // Sync Three.js mesh to physics transform
  const t = getKartTransform();
  if (t && carModel) {
    carModel.position.set(t.position.x, t.position.y, t.position.z);
    carModel.quaternion.set(t.quaternion.x, t.quaternion.y, t.quaternion.z, t.quaternion.w);
  }

  // Spin wheel meshes based on speed
  if (wheelMeshes) {
    const rotAmt = (speedKPH / 3.6) * deltaTime * 2.5;
    for (const wm of wheelMeshes) {
      if (wm) wm.rotation.x -= rotAmt;
    }
  }

  return { currentSpeed: speedKPH };
}

// Physics time step constants
export const FIXED_PHYSICS_STEP = 1 / 60; // 60 Hz