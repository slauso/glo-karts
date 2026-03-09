/**
 * physics.js — Backward-compatibility shim.
 *
 * The old two-scene physics relay is retired. Physics now runs in the unified
 * rendering scene via scene.render() auto-stepping Havok. This module provides
 * the same API surface so transitional callers work during Phase 13 rollout.
 */

import { applyKartDriving, createDriftState, FIXED_PHYSICS_STEP } from './kart-physics.js';

export { FIXED_PHYSICS_STEP };

// Module-level refs — set by the game loop after kart loads
let _kartBody = null;
let _kartMesh = null;
let _driftState = createDriftState();

/**
 * Register kart refs so the shim updatePhysics() works.
 * Called from main.js / battle-main.js after createVehicle callback.
 */
export function setPhysicsKartRefs(body, mesh) {
  _kartBody = body;
  _kartMesh = mesh;
  _driftState = createDriftState();
}

/**
 * No-op — physics is now initialised by babylon-renderer.js.
 * Kept for backward compatibility with existing callers.
 */
export async function initPhysics() {
  console.log('Physics world initialised (Havok — unified scene)');
}

/**
 * Run one fixed-timestep tick using the shared kart-physics module.
 * scene.render() handles Havok stepping, so no manual step call needed.
 *
 * @param {number}  deltaTime
 * @param {object}  carState   { carModel, wheelMeshes, keyState }
 * @param {object}  raceState  { raceStarted, raceFinished }
 * @returns {{ currentSpeed: number, driftTier: number, miniBoostTier: number, miniBoostActive: boolean }}
 */
export function updatePhysics(deltaTime, carState, raceState) {
  if (!_kartBody || !_kartMesh) {
    return { currentSpeed: 0, driftTier: 0, miniBoostTier: 0, miniBoostActive: false };
  }

  const { keyState } = carState;

  // Block driving when race hasn't started or is finished
  if (!raceState.raceStarted || raceState.raceFinished) {
    // Just return zero speed — kart is frozen (STATIC body)
    return { currentSpeed: 0, driftTier: 0, miniBoostTier: 0, miniBoostActive: false };
  }

  // Convert keyState to normalised input
  const input = {
    throttle: (keyState.w ? 1 : 0) + (keyState.s ? -1 : 0),
    steer:    (keyState.a ? 1 : 0) + (keyState.d ? -1 : 0),
    brake:    !!keyState.space,
  };

  const result = applyKartDriving(_kartBody, _kartMesh, input, deltaTime, _driftState);

  // Spin wheel meshes based on speed
  if (carState.wheelMeshes) {
    const rotAmt = (result.speedKPH / 3.6) * deltaTime * 2.5;
    for (const wm of carState.wheelMeshes) {
      if (wm) wm.rotation.x -= rotAmt;
    }
  }

  return {
    currentSpeed: result.speedKPH,
    driftTier: result.driftTier || 0,
    miniBoostTier: result.miniBoostTier || 0,
    miniBoostActive: result.miniBoostActive || false,
  };
}