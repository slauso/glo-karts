/**
 * havok-physics.js — Backward-compatibility shim.
 *
 * The NullEngine headless physics pattern has been retired.
 * Physics now runs in the unified rendering scene (babylon-renderer.js).
 * This module re-exports utilities for callers that haven't been updated yet.
 */

import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { FIXED_PHYSICS_STEP, GRAVITY, KART_MASS, KART_EXTENTS } from './kart-physics.js';

// ── Module-level refs set by the new unified-scene car loader ───────────────
// These are set from main.js / battle-main.js after kart loads.
let _kartBody = null;
let _kartMesh = null;

/**
 * Register the unified-scene kart body+mesh so shim functions work.
 * Called from main.js/battle-main.js after createVehicle callback.
 */
export function setKartRefs(body, mesh) {
  _kartBody = body;
  _kartMesh = mesh;
}

/**
 * Legacy resetKart(position, heading) — used by gates.js, track-data.js, health.js, etc.
 * Operates on the unified-scene kart registered via setKartRefs().
 */
export function resetKart(position, heading = 0) {
  if (!_kartBody || !_kartMesh) {
    console.warn('resetKart: no kart refs registered (call setKartRefs first)');
    return;
  }
  _kartMesh.position = new Vector3(position.x, position.y, position.z);
  _kartMesh.rotationQuaternion = Quaternion.FromEulerAngles(0, heading, 0);
  _kartBody.setLinearVelocity(new Vector3(0, 0, 0));
  _kartBody.setAngularVelocity(new Vector3(0, 0, 0));
  _kartBody.disablePreStep = false;
}

/**
 * Legacy getKartY (used by babylon-track.js checkGroundCollision fallback).
 */
export function getKartY() {
  return _kartMesh ? _kartMesh.position.y : 0;
}

// ── Stubs for removed NullEngine functions ──────────────────────────────────
// These are no-ops to prevent import errors during transition.

/** @deprecated Physics now initialised by babylon-renderer.js */
export async function initPhysicsEngine() {
  console.warn('initPhysicsEngine: NullEngine removed. Physics is in the rendering scene.');
}

/** @deprecated Kart body now created by babylon-car.js */
export function createKartBody() {
  console.warn('createKartBody: NullEngine removed. Use createVehicle() which creates PhysicsAggregate in-scene.');
}

/** @deprecated Track collider now created by babylon-track.js */
export function createTrackCollider() {
  console.warn('createTrackCollider: NullEngine removed. Track uses _createTrackPhysics in-scene.');
}

/** @deprecated Box collider now created inline in scene */
export function createBoxCollider() {
  console.warn('createBoxCollider: NullEngine removed. Create PhysicsAggregate(box, BOX, ..., scene) directly.');
}

/** @deprecated scene.render() auto-steps Havok */
export function stepPhysics() {}

/** @deprecated No separate physics transform — mesh IS the body */
export function getKartTransform() {
  if (!_kartMesh) return null;
  const p = _kartMesh.position;
  const q = _kartMesh.rotationQuaternion;
  return {
    position:   { x: p.x, y: p.y, z: p.z },
    quaternion: q ? { x: q.x, y: q.y, z: q.z, w: q.w } : { x: 0, y: 0, z: 0, w: 1 },
  };
}

export function dispose() {
  _kartBody = null;
  _kartMesh = null;
}
