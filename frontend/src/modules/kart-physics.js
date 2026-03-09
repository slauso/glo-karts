/**
 * kart-physics.js — Shared arcade kart driving physics for all game modes.
 *
 * Single canonical implementation used by both solo modes (main.js, battle-main.js)
 * and multiplayer (colyseus-babylon-client.js).
 *
 * Operates directly on a Babylon.js PhysicsBody + TransformNode — no NullEngine dependency.
 */

import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';

// ── Physics timestep ────────────────────────────────────────────────────────
export const FIXED_PHYSICS_STEP = 1 / 60; // 60 Hz

// ── Gravity ─────────────────────────────────────────────────────────────────
export const GRAVITY = -20;

// ── Kart body dimensions & mass ─────────────────────────────────────────────
export const KART_MASS    = 800;
export const KART_EXTENTS = new Vector3(1.8, 0.5, 3.2);

// ── Driving tuning constants ────────────────────────────────────────────────
const MAX_SPEED       = 35;
const ACCEL_FORCE     = 55;
const TURN_BASE       = 3.0;
const TURN_MIN        = 1.0;
const LATERAL_GRIP    = 0.70;
const DRIFT_GRIP_MUL  = 0.35;
const DOWNFORCE       = 20;
const COAST_DRAG      = 0.96;
const BRAKE_DRAG      = 0.88;
const ROLL_DAMP       = 0.85;
const PITCH_DAMP      = 0.85;
const YAW_COAST_DAMP  = 0.70;

// ── Mini-turbo drift system ─────────────────────────────────────────────────
const MINI_TURBO_CHARGE_RATE = 1.5;
const MINI_TURBO_TIER1       = 1.0;
const MINI_TURBO_TIER2       = 2.2;
const MINI_TURBO_BOOST_T1    = 0.4;
const MINI_TURBO_BOOST_T2    = 0.8;
const MINI_TURBO_SPEED_MUL   = 1.35;

// ── Per-kart drift state (keyed by body reference or caller-managed) ────────

/**
 * Create a fresh drift state object. Each kart needs its own instance.
 * @returns {DriftState}
 */
export function createDriftState() {
  return {
    driftCharge: 0,
    wasDrifting: false,
    miniBoostTimer: 0,
    miniBoostTier: 0,
  };
}

/**
 * Apply arcade kart driving physics for one tick.
 *
 * @param {import("@babylonjs/core").PhysicsBody} body        The kart's physics body
 * @param {import("@babylonjs/core").TransformNode} transform The kart's transform node (same mesh)
 * @param {{ throttle: number, steer: number, brake: boolean }} input  Normalised input
 * @param {number} dt           Fixed timestep in seconds
 * @param {DriftState} drift    Mutable drift state for this kart
 * @param {{ spdMult?: number, strMult?: number }} [mults]  Item-effect multipliers
 * @returns {{ speedKPH: number, driftTier: number, miniBoostTier: number, miniBoostActive: boolean }}
 */
export function applyKartDriving(body, transform, input, dt, drift, mults) {
  const spdMult = mults?.spdMult ?? 1.0;
  const strMult = mults?.strMult ?? 1.0;

  const effectiveMaxSpeed  = MAX_SPEED * spdMult;
  const effectiveAccel     = ACCEL_FORCE * spdMult;
  const effectiveTurnBase  = TURN_BASE * strMult;

  let currentVel    = body.getLinearVelocity();
  let currentAngVel = body.getAngularVelocity();

  // Sanitise NaN velocities
  if (
    !Number.isFinite(currentVel.x) || !Number.isFinite(currentVel.y) || !Number.isFinite(currentVel.z) ||
    !Number.isFinite(currentAngVel.x) || !Number.isFinite(currentAngVel.y) || !Number.isFinite(currentAngVel.z)
  ) {
    body.setLinearVelocity(new Vector3(0, 0, 0));
    body.setAngularVelocity(new Vector3(0, 0, 0));
    return { speedKPH: 0, driftTier: 0, miniBoostTier: 0, miniBoostActive: false };
  }

  body.disablePreStep = false;

  const hSpeed     = Math.sqrt(currentVel.x ** 2 + currentVel.z ** 2);
  const speedRatio = Math.min(hSpeed / effectiveMaxSpeed, 1);
  const speedKPH   = hSpeed * 3.6;

  // ── 1. Steering ───────────────────────────────────────────────────────
  const turnSpeed = effectiveTurnBase - (effectiveTurnBase - TURN_MIN) * speedRatio;

  if (input.steer !== 0 && hSpeed > 0.5) {
    const fwd = transform.forward.scale(-1);
    const isReversing = Vector3.Dot(currentVel, fwd) < -1;
    const dir = isReversing ? -1 : 1;
    const driftBoost = input.brake ? 1.3 : 1.0;
    const targetYaw = input.steer * turnSpeed * dir * driftBoost;

    body.setAngularVelocity(new Vector3(
      currentAngVel.x * ROLL_DAMP,
      targetYaw,
      currentAngVel.z * PITCH_DAMP,
    ));
  } else {
    body.setAngularVelocity(new Vector3(
      currentAngVel.x * ROLL_DAMP,
      currentAngVel.y * YAW_COAST_DAMP,
      currentAngVel.z * PITCH_DAMP,
    ));
  }

  let nextVel = new Vector3(currentVel.x, currentVel.y, currentVel.z);

  // ── Mini-turbo drift charge ───────────────────────────────────────────
  const isDrifting = input.brake && input.steer !== 0 && hSpeed > 5;
  if (isDrifting) {
    drift.driftCharge += MINI_TURBO_CHARGE_RATE * dt;
  }
  if (drift.wasDrifting && !isDrifting && drift.driftCharge > 0) {
    if (drift.driftCharge >= MINI_TURBO_TIER2) {
      drift.miniBoostTimer = MINI_TURBO_BOOST_T2;
      drift.miniBoostTier = 2;
    } else if (drift.driftCharge >= MINI_TURBO_TIER1) {
      drift.miniBoostTimer = MINI_TURBO_BOOST_T1;
      drift.miniBoostTier = 1;
    }
    drift.driftCharge = 0;
  }
  if (!isDrifting && !drift.wasDrifting) {
    drift.driftCharge = 0;
  }
  drift.wasDrifting = isDrifting;

  if (drift.miniBoostTimer > 0) drift.miniBoostTimer -= dt;
  if (drift.miniBoostTimer <= 0) { drift.miniBoostTimer = 0; drift.miniBoostTier = 0; }

  const boostMul = drift.miniBoostTimer > 0 ? MINI_TURBO_SPEED_MUL : 1.0;

  // ── 2. Acceleration ───────────────────────────────────────────────────
  let forwardDir = transform.forward.scale(-1);
  if (forwardDir.lengthSquared() > 0.00001) {
    forwardDir.normalize();
  } else {
    forwardDir.copyFromFloats(0, 0, 1);
  }

  if (input.throttle > 0 && hSpeed < effectiveMaxSpeed * boostMul) {
    const falloff = 1 - speedRatio * speedRatio;
    const accel = effectiveAccel * boostMul * Math.max(falloff, 0.08) * dt;
    nextVel.x += forwardDir.x * accel;
    nextVel.z += forwardDir.z * accel;
  } else if (input.throttle < 0) {
    const accel = effectiveAccel * 0.4 * dt;
    nextVel.x -= forwardDir.x * accel;
    nextVel.z -= forwardDir.z * accel;
  }

  // ── 3. Braking & coasting drag ────────────────────────────────────────
  if (input.brake) {
    nextVel.x *= BRAKE_DRAG;
    nextVel.z *= BRAKE_DRAG;
  } else if (input.throttle === 0) {
    nextVel.x *= COAST_DRAG;
    nextVel.z *= COAST_DRAG;
  }

  // ── 4. Lateral grip ──────────────────────────────────────────────────
  let rightDir = transform.right;
  if (rightDir.lengthSquared() > 0.00001) {
    rightDir.normalize();
  } else {
    rightDir = new Vector3(1, 0, 0);
  }
  const latSpeed = Vector3.Dot(nextVel, rightDir);
  const grip = input.brake ? LATERAL_GRIP * DRIFT_GRIP_MUL : LATERAL_GRIP;
  nextVel.x -= rightDir.x * latSpeed * grip;
  nextVel.z -= rightDir.z * latSpeed * grip;

  // ── 5. Downforce ─────────────────────────────────────────────────────
  if (hSpeed > 3) {
    nextVel.y -= DOWNFORCE * speedRatio * dt;
  }
  if (nextVel.y > 4) nextVel.y = 4;

  body.setLinearVelocity(nextVel);

  // ── Return feedback ───────────────────────────────────────────────────
  const driftTier = isDrifting
    ? (drift.driftCharge >= MINI_TURBO_TIER2 ? 2 : drift.driftCharge >= MINI_TURBO_TIER1 ? 1 : 0)
    : 0;

  return {
    speedKPH,
    driftTier,
    miniBoostTier: drift.miniBoostTier,
    miniBoostActive: drift.miniBoostTimer > 0,
  };
}

/**
 * Teleport a kart to a position and heading, zeroing all velocity.
 *
 * @param {import("@babylonjs/core").PhysicsBody} body
 * @param {import("@babylonjs/core").TransformNode} mesh
 * @param {{ x: number, y: number, z: number }} position
 * @param {number} heading  Y-axis rotation in radians
 */
export function resetKart(body, mesh, position, heading = 0) {
  mesh.position = new Vector3(position.x, position.y, position.z);
  mesh.rotationQuaternion = Quaternion.FromEulerAngles(0, heading, 0);

  body.setLinearVelocity(new Vector3(0, 0, 0));
  body.setAngularVelocity(new Vector3(0, 0, 0));
  body.disablePreStep = false;
}

// ═══════════════════════════════════════════════════════════════════════════
// ── Weapon Impact Physics ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

/** Status effect types */
export const STATUS = Object.freeze({
  NONE:     0,
  STUNNED:  1,  // Can't drive (spin-out hit)
  FROZEN:   2,  // Frozen in place (frost nova)
  BURNING:  3,  // Damage-over-time slow (inferno trail)
  FLIPPED:  4,  // Upside-down (gravity flip)
  DISABLED: 5,  // Electronics off (EMP pulse)
  PULLED:   6,  // Dragged toward point (black hole)
});

/**
 * Create a status-effect state object for one kart.
 * Must be updated each tick via {@link tickStatusEffects}.
 */
export function createStatusState() {
  return {
    effect:    STATUS.NONE,
    timer:     0,
    intensity: 1.0,   // 1.0 = full effect, fades toward 0
    sourcePos: null,   // optional world position (e.g. black-hole centre)
  };
}

/**
 * Apply an instantaneous knockback impulse to a kart.
 *
 * @param {import("@babylonjs/core").PhysicsBody} body
 * @param {Vector3} direction  Normalized world-space direction of the hit
 * @param {number}  force      Impulse magnitude (reasonable range: 10‒80)
 * @param {number}  [lift=8]   Upward component so the kart pops off the ground
 */
export function applyHitImpulse(body, direction, force, lift = 8) {
  const impulse = direction.normalize().scale(force);
  impulse.y += lift;
  const vel = body.getLinearVelocity();
  body.setLinearVelocity(new Vector3(
    vel.x + impulse.x,
    vel.y + impulse.y,
    vel.z + impulse.z,
  ));
}

/**
 * Apply a violent spin-out (hit by explosive / shockwave).
 *
 * @param {import("@babylonjs/core").PhysicsBody} body
 * @param {number} [yawForce=12]  Angular velocity around Y
 */
export function applySpinout(body, yawForce = 12) {
  const dir = Math.random() < 0.5 ? -1 : 1;
  const av = body.getAngularVelocity();
  body.setAngularVelocity(new Vector3(av.x, dir * yawForce, av.z));
}

/**
 * Begin a status effect on a kart.
 * Overwrites any current effect (stronger effect wins by convention — caller decides).
 *
 * @param {ReturnType<typeof createStatusState>} state
 * @param {number} effect   One of {@link STATUS}
 * @param {number} duration Seconds
 * @param {Vector3} [sourcePos] Optional world pos (for pull effects)
 */
export function applyStatusEffect(state, effect, duration, sourcePos = null) {
  state.effect    = effect;
  state.timer     = duration;
  state.intensity = 1.0;
  state.sourcePos = sourcePos;
}

/**
 * Tick the status-effect timer and return multiplier overrides.
 * Call once per physics tick, BEFORE applyKartDriving().
 *
 * The returned object can be spread into the `mults` parameter of applyKartDriving.
 *
 * @param {ReturnType<typeof createStatusState>} state
 * @param {import("@babylonjs/core").PhysicsBody} body
 * @param {import("@babylonjs/core").TransformNode} transform
 * @param {number} dt
 * @returns {{ spdMult: number, strMult: number, inputDisabled: boolean }}
 */
export function tickStatusEffects(state, body, transform, dt) {
  if (state.effect === STATUS.NONE || state.timer <= 0) {
    state.effect = STATUS.NONE;
    state.timer  = 0;
    return { spdMult: 1, strMult: 1, inputDisabled: false };
  }

  state.timer -= dt;
  state.intensity = Math.max(state.timer, 0) / (state.timer + dt); // fade

  switch (state.effect) {
    case STATUS.STUNNED:
      // Kart spins helplessly — no input
      return { spdMult: 0.3, strMult: 0, inputDisabled: true };

    case STATUS.FROZEN:
      // Frozen solid — full stop
      body.setLinearVelocity(new Vector3(0, body.getLinearVelocity().y, 0));
      return { spdMult: 0, strMult: 0, inputDisabled: true };

    case STATUS.BURNING:
      // Slow + slight random swerve
      return { spdMult: 0.55, strMult: 0.7, inputDisabled: false };

    case STATUS.FLIPPED: {
      // Launch upward and invert controls
      if (state.timer > 0 && state.intensity > 0.9) {
        const vel = body.getLinearVelocity();
        body.setLinearVelocity(new Vector3(vel.x * 0.5, 15, vel.z * 0.5));
      }
      return { spdMult: 0.4, strMult: -1, inputDisabled: false };
    }

    case STATUS.DISABLED:
      // EMP — steering dead, coasting only
      return { spdMult: 0.7, strMult: 0, inputDisabled: true };

    case STATUS.PULLED: {
      // Black-hole pull toward source position
      if (state.sourcePos) {
        const pos  = transform.position;
        const diff = state.sourcePos.subtract(pos);
        diff.y = 0;
        const dist = diff.length();
        if (dist > 2) {
          const pull = diff.normalize().scale(25 * state.intensity);
          const vel  = body.getLinearVelocity();
          body.setLinearVelocity(new Vector3(
            vel.x + pull.x * dt,
            vel.y,
            vel.z + pull.z * dt,
          ));
        }
      }
      return { spdMult: 0.5, strMult: 0.5, inputDisabled: false };
    }

    default:
      return { spdMult: 1, strMult: 1, inputDisabled: false };
  }
}

/**
 * Clear any active status effect immediately (e.g. shield pickup clears debuff).
 */
export function clearStatusEffect(state) {
  state.effect    = STATUS.NONE;
  state.timer     = 0;
  state.intensity = 0;
  state.sourcePos = null;
}

/**
 * Helper: compute direction from attacker position to victim position (XZ plane).
 */
export function hitDirection(fromPos, toPos) {
  const d = new Vector3(toPos.x - fromPos.x, 0, toPos.z - fromPos.z);
  return d.length() > 0.001 ? d.normalize() : new Vector3(0, 0, 1);
}
