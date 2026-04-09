/**
 * fps-controller.js — First-person controller with Havok V2 physics capsule.
 *
 * Provides:
 *  - PhysicsAggregate capsule body (mass 80, locked rotation)
 *  - Pointer-lock FreeCamera parented to capsule
 *  - WASD movement via linear velocity on physics body
 *  - Space to jump (ground-checked via raycast)
 *  - Input state for weapon switch / reload keys
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { PhysicsAggregate } from '@babylonjs/core/Physics/v2/physicsAggregate';
import { PhysicsShapeType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import { Ray } from '@babylonjs/core/Culling/ray';
import { FPS_ARENA_DIMENSIONS } from './fps-arena-layout.js';

const MOVE_SPEED = 8;        // m/s horizontal
const SPRINT_SPEED = 12;     // m/s when shift held
const JUMP_VELOCITY = 6;     // m/s upward impulse
const PLAYER_HEIGHT = FPS_ARENA_DIMENSIONS.playerHeight;
const PLAYER_RADIUS = FPS_ARENA_DIMENSIONS.playerRadius;
const EYE_OFFSET_Y = 0.65;   // Camera height relative to capsule center
const GROUND_RAY_LEN = 1.05; // Distance from center to ground check
const ANGULAR_DAMPING = 100;  // Prevent capsule from tipping over

// Collision layers — self-contained for the FPS mode
const FPS_LAYER = {
  GROUND:     0x0001,
  PLAYER:     0x0002,
  PROJECTILE: 0x0008,
  PROP:       0x0040,
  TARGET:     0x0080,
};

/**
 * @param {import("@babylonjs/core").Scene} scene
 * @param {HTMLCanvasElement} canvas
 * @returns {{ camera, capsule, body, update, isMoving, getVelocity, dispose }}
 */
export function createFPSController(scene, canvas) {
  // ── Capsule mesh (invisible — physics only) ──────────────────────────
  const capsule = MeshBuilder.CreateCapsule('playerCapsule', {
    height: PLAYER_HEIGHT,
    radius: PLAYER_RADIUS,
    tessellation: 16,
    subdivisions: 6,
  }, scene);
  capsule.position = new Vector3(0, PLAYER_HEIGHT, 0);
  capsule.isVisible = false;
  capsule.isPickable = false;

  // ── Physics aggregate ────────────────────────────────────────────────
  const aggregate = new PhysicsAggregate(
    capsule,
    PhysicsShapeType.CAPSULE,
    { mass: 80, friction: 0.5, restitution: 0.0 },
    scene,
  );
  const body = aggregate.body;
  body.setAngularDamping(ANGULAR_DAMPING);
  body.setLinearDamping(0.1);

  // Collision filter: player collides with ground + props
  const shape = aggregate.shape;
  shape.filterMembershipMask = FPS_LAYER.PLAYER;
  shape.filterCollideMask = FPS_LAYER.GROUND | FPS_LAYER.PROP | FPS_LAYER.TARGET;

  // ── Camera ───────────────────────────────────────────────────────────
  const camera = new FreeCamera('fpsCam', new Vector3(0, EYE_OFFSET_Y, 0), scene);
  camera.parent = capsule;
  camera.minZ = 0.1;
  camera.maxZ = 2000;
  camera.fov = 1.1; // ~63° gives a nice FPS feel
  camera.inertia = 0;
  camera.angularSensibility = 600;

  // Attach mouse look, disable built-in keyboard movement
  camera.attachControl(canvas, true);
  camera.inputs.removeByType('FreeCameraKeyboardMoveInput');

  // ── Keyboard state ───────────────────────────────────────────────────
  const keys = { w: false, a: false, s: false, d: false, space: false, shift: false };
  let weaponSwitchCb = null;
  let reloadCb = null;
  let jumpQueued = false;

  const keyDown = (e) => {
    switch (e.code) {
      case 'KeyW': keys.w = true; break;
      case 'KeyA': keys.a = true; break;
      case 'KeyS': keys.s = true; break;
      case 'KeyD': keys.d = true; break;
      case 'Space': keys.space = true; jumpQueued = true; e.preventDefault(); break;
      case 'ShiftLeft': case 'ShiftRight': keys.shift = true; break;
      case 'KeyR': if (reloadCb) reloadCb(); break;
      case 'Digit1': if (weaponSwitchCb) weaponSwitchCb(0); break;
      case 'Digit2': if (weaponSwitchCb) weaponSwitchCb(1); break;
      case 'Digit3': if (weaponSwitchCb) weaponSwitchCb(2); break;
    }
  };
  const keyUp = (e) => {
    switch (e.code) {
      case 'KeyW': keys.w = false; break;
      case 'KeyA': keys.a = false; break;
      case 'KeyS': keys.s = false; break;
      case 'KeyD': keys.d = false; break;
      case 'Space': keys.space = false; break;
      case 'ShiftLeft': case 'ShiftRight': keys.shift = false; break;
    }
  };
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);

  // ── Ground check via scene pick ray ──────────────────────────────────
  function isGrounded() {
    const origin = capsule.getAbsolutePosition().clone();
    const ray = new Ray(origin, new Vector3(0, -1, 0), GROUND_RAY_LEN);
    const hit = scene.pickWithRay(ray, (m) => m !== capsule && m.isPickable);
    return !!(hit && hit.hit);
  }

  // ── Public interface ─────────────────────────────────────────────────
  let _moving = false;
  let _velocity = Vector3.Zero();

  return {
    camera,
    capsule,
    body,

    onWeaponSwitch(cb) { weaponSwitchCb = cb; },
    onReloadKey(cb) { reloadCb = cb; },

    update(_dt) {
      // Compute move direction from camera yaw
      const forward = camera.getForwardRay().direction;
      const flatFwd = new Vector3(forward.x, 0, forward.z);
      if (flatFwd.lengthSquared() > 0.0001) flatFwd.normalize();
      const flatRight = Vector3.Cross(Vector3.Up(), flatFwd);
      if (flatRight.lengthSquared() > 0.0001) flatRight.normalize();

      let mx = 0, mz = 0;
      if (keys.w) { mx += flatFwd.x; mz += flatFwd.z; }
      if (keys.s) { mx -= flatFwd.x; mz -= flatFwd.z; }
      if (keys.a) { mx -= flatRight.x; mz -= flatRight.z; }
      if (keys.d) { mx += flatRight.x; mz += flatRight.z; }

      const len = Math.sqrt(mx * mx + mz * mz);
      if (len > 0) { mx /= len; mz /= len; }

      const speed = keys.shift ? SPRINT_SPEED : MOVE_SPEED;
      const vel = body.getLinearVelocity();

      body.setLinearVelocity(new Vector3(
        mx * speed,
        vel.y,  // preserve vertical (gravity / jump)
        mz * speed,
      ));

      // Jump
      const grounded = isGrounded();
      if (keys.space && grounded) {
        body.setLinearVelocity(new Vector3(vel.x, JUMP_VELOCITY, vel.z));
      }

      // Track state for external queries
      _moving = len > 0;
      _velocity = body.getLinearVelocity();
    },

    getNetworkIntent() {
      let moveX = 0;
      let moveY = 0;
      if (keys.a) moveX -= 1;
      if (keys.d) moveX += 1;
      if (keys.w) moveY += 1;
      if (keys.s) moveY -= 1;
      const length = Math.hypot(moveX, moveY);
      if (length > 0) {
        moveX /= length;
        moveY /= length;
      }

      const intent = {
        moveX,
        moveY,
        sprint: keys.shift,
        jump: jumpQueued,
        yaw: camera.rotation.y,
        pitch: camera.rotation.x,
      };
      jumpQueued = false;
      return intent;
    },

    isMoving() { return _moving; },
    getVelocity() { return _velocity; },
    getSpeed() {
      const v = _velocity;
      return Math.sqrt(v.x * v.x + v.z * v.z);
    },

    setPosition(pos) {
      body.disablePreStep = false;
      capsule.position.copyFrom(pos);
      body.setLinearVelocity(Vector3.Zero());
      // Re-enable physics-driven transform next frame
      setTimeout(() => { body.disablePreStep = true; }, 50);
    },

    nudgeTowards(pos, blend = 0.18) {
      const delta = pos.subtract(capsule.position);
      if (delta.lengthSquared() < 0.0001) return;
      body.disablePreStep = false;
      capsule.position.addInPlace(delta.scale(blend));
      setTimeout(() => { body.disablePreStep = true; }, 20);
    },

    dispose() {
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      aggregate.dispose();
      capsule.dispose();
      camera.dispose();
    },
  };
}
