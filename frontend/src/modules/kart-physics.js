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
const MAX_SPEED       = 36;
const ACCEL_FORCE     = 60;
const TURN_BASE       = 3.25;
const TURN_MIN        = 1.1;
const LATERAL_GRIP    = 0.80;
const DRIFT_GRIP_MUL  = 0.42;
const DOWNFORCE       = 20;
const COAST_DRAG      = 0.968;
const BRAKE_DRAG      = 0.84;
const ROLL_DAMP       = 0.85;
const PITCH_DAMP      = 0.85;
const YAW_COAST_DAMP  = 0.70;

// ── Ground detection ────────────────────────────────────────────────────────
const GROUND_RAY_LENGTH   = 2.5;   // raycast distance below kart centre
const LANDING_DAMPEN_FRAMES = 3;   // frames over which landing bounce is absorbed

// ── Collision response ──────────────────────────────────────────────────────
const WALL_SPEED_PENALTY  = 0.85;  // lose 15% speed on hard wall hit
const WALL_SLIDE_FRICTION = 0.6;   // lateral slide friction against walls
const BUMP_INVULN_MS      = 300;   // brief invulnerability after being bumped

// ── Reverse / brake state machine ───────────────────────────────────────────
const REVERSE_MAX_RATIO   = 0.4;   // reverse max speed = 40% of forward
const STOP_THRESHOLD      = 1.5;   // speed below which brake input engages reverse

// ── Mini-turbo drift system (MK3.js 3-tier: blue → yellow → purple) ─────────
const MINI_TURBO_CHARGE_RATE = 1.0;         // seconds of drift = charge (MK3.js: power += delta)
const MINI_TURBO_TIER1       = 1.0;         // blue  (MK3.js threshold: 1)
const MINI_TURBO_TIER2       = 3.0;         // yellow (MK3.js threshold: 3)
const MINI_TURBO_TIER3       = 6.0;         // purple (MK3.js threshold: 6)
const MINI_TURBO_BOOST_T1    = 0.5;         // blue boost duration (s)
const MINI_TURBO_BOOST_T2    = 0.9;         // yellow boost duration (s)
const MINI_TURBO_BOOST_T3    = 1.5;         // purple boost duration (s)
const MINI_TURBO_SPEED_MUL   = 1.35;        // speed multiplier during mini-turbo
const MINI_TURBO_SPEED_MUL_T3 = 1.50;       // tier-3 purple gets a bigger boost

// ── Direction smoothing (ported from MK3.js smoothedDirectionRef.lerp) ───────
const DIR_SMOOTH_RATE = 12;                  // MK3.js: lerp(dir, desired, 12 * delta)

// ── Drift visual constants (MK3.js: driftDirection * 0.4 body yaw offset) ───
const DRIFT_BODY_YAW  = 0.35;               // radians of body yaw offset during drift
const DRIFT_YAW_DAMP  = 4;                  // rate at which drift yaw smooths

// ── Per-wheel raycast defaults (local space) ───────────────────────────────
// Used only if no per-kart offsets are supplied by KartEntity.getWheelRayOffsets().
const DEFAULT_WHEEL_RAY_OFFSETS = [
  new Vector3(-0.7,  0.3,  0.7),  // front-left
  new Vector3( 0.7,  0.3,  0.7),  // front-right
  new Vector3(-0.77, 0.3, -0.7),  // rear-left
  new Vector3( 0.77, 0.3, -0.7),  // rear-right
];
const WHEEL_RAY_LENGTH = 2.5;
const BODY_PITCH_ROLL_LERP = 6;   // rate at which visual pitch/roll smooths

// ── Suspension spring-damper (visual only — over the Havok rigid body) ──────
const SUSP_REST_LENGTH  = 0.0;    // wheel Y offset at rest (neutral)
const SUSP_SPRING_K     = 35;     // spring stiffness (higher = stiffer)
const SUSP_DAMP         = 8;      // damping coefficient
const SUSP_MAX_TRAVEL   = 0.12;   // max compression/extension in metres
const SUSP_LANDING_KICK = 0.08;   // extra compression on landing

// ── Steering lean (body roll during any turn, not just drift) ───────────────
const STEER_LEAN_MAX    = 0.08;   // ~4.5° max roll into a turn
const STEER_LEAN_RATE   = 6;      // smoothing rate (higher = snappier)

// ── Acceleration lean (nose pitch under accel/brake) ────────────────────────
const ACCEL_LEAN_MAX    = 0.06;   // ~3.4° max nose-up under hard accel
const BRAKE_LEAN_MAX    = 0.10;   // ~5.7° max nose-down under hard brake
const ACCEL_LEAN_RATE   = 5;      // smoothing rate

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
    // Phase 21 additions
    isGrounded: true,
    slopeNormal: new Vector3(0, 1, 0),
    landingFrames: 0,      // frames of landing dampening remaining
    wasAirborne: false,
    bumpInvulnUntil: 0,    // timestamp until which bump stun is suppressed
    reverseEngaged: false,  // true when stopped and holding reverse
    driftTiltAngle: 0,     // current visual lean angle (radians)
    // Per-wheel ground contact (MK3.js inspired)
    wheelGroundY: [0, 0, 0, 0],  // world-space Y of ground under each wheel
    wheelOnGround: [true, true, true, true],
    bodyPitch: 0,          // current smoothed pitch from wheel contacts
    bodyRoll: 0,           // current smoothed roll from wheel contacts
    // MK3.js direction smoothing
    smoothedDirX: 0,       // smoothed forward direction X
    smoothedDirZ: -1,      // smoothed forward direction Z
    // MK3.js drift visual body yaw offset
    driftBodyYaw: 0,       // current drift body yaw (smoothed)
    driftDirection: 0,     // -1 = left, +1 = right, 0 = none (MK3.js driftDirection)
    // Suspension spring-damper per wheel (visual)
    suspTravel: [0, 0, 0, 0],      // current Y offset for each wheel
    suspVelocity: [0, 0, 0, 0],    // spring velocity per wheel
    // Steering lean (continuous, not just drift)
    steerLean: 0,                   // current body roll from steering
    // Acceleration lean (nose pitch)
    accelLean: 0,                   // current body pitch from accel/brake
    prevHSpeed: 0,                  // previous frame horizontal speed
  };
}

/**
 * Sync ground contact data from a RaycastVehicle into the drift state.
 * Replaces the need to call raycastWheels() separately when a raycast vehicle
 * is active — avoids double raycasting.
 *
 * @param {import('./raycast-vehicle.js').RaycastVehicle} vehicle
 * @param {DriftState} drift
 */
export function syncVehicleGroundState(vehicle, drift) {
  const normals = [];
  for (let i = 0; i < vehicle.wheels.length && i < 4; i++) {
    const w = vehicle.wheels[i];
    drift.wheelOnGround[i] = w.inContact;
    drift.wheelGroundY[i] = w.inContact ? w.hitPoint.y : (w.positionWorld.y - w.suspensionRestLength);
    if (w.inContact && w.hitNormal && Number.isFinite(w.hitNormal.x)) {
      normals.push(new Vector3(w.hitNormal.x, w.hitNormal.y, w.hitNormal.z));
    }
  }

  const wasGrounded = drift.isGrounded;
  drift.isGrounded = vehicle.nWheelsOnGround >= 2;

  // Aggregate slope normal
  if (normals.length > 0) {
    const avg = normals.reduce((a, b) => a.add(b), Vector3.Zero()).scale(1 / normals.length);
    drift.slopeNormal = avg.lengthSquared() > 0.0001 ? avg.normalize() : new Vector3(0, 1, 0);
  } else {
    drift.slopeNormal = new Vector3(0, 1, 0);
  }

  // Landing detection
  if (!wasGrounded && drift.isGrounded) {
    drift.landingFrames = 3; // LANDING_DAMPEN_FRAMES
    drift.wasAirborne = false;
  }
  if (!drift.isGrounded) {
    drift.wasAirborne = true;
  }
}

/**
 * Per-wheel ground raycasting — casts 4 rays downward from wheel positions
 * to determine ground contact per-wheel.  Updates drift.wheelGroundY[] and
 * drift.wheelOnGround[].  Also computes aggregate isGrounded and slopeNormal.
 *
 * Inspired by Mario-Kart-3.js `getGroundPosition()` which raycasts per-wheel
 * and uses the 4 contact points to compute body pitch/roll.
 *
 * @param {object} havokPlugin  HavokPlugin instance
 * @param {import("@babylonjs/core").TransformNode} transform  Kart root transform
 * @param {DriftState} drift  Mutable drift state
 * @param {object} PhysicsRaycastResult  Constructor for raycast results
 */
export function raycastWheels(havokPlugin, transform, drift, PhysicsRaycastResult, wheelRayOffsets) {
  if (!havokPlugin || !transform || !PhysicsRaycastResult) {
    drift.isGrounded = true;
    drift.slopeNormal = new Vector3(0, 1, 0);
    return;
  }

  const offsets = wheelRayOffsets || DEFAULT_WHEEL_RAY_OFFSETS;
  let groundedCount = 0;
  const normals = [];

  for (let i = 0; i < 4; i++) {
    try {
      // Transform wheel offset from local to world space
      const localOff = offsets[i];
      const worldFrom = Vector3.TransformCoordinates(localOff, transform.getWorldMatrix());
      const worldTo = worldFrom.add(new Vector3(0, -WHEEL_RAY_LENGTH, 0));

      const hit = new PhysicsRaycastResult();
      havokPlugin.raycast(worldFrom, worldTo, hit);

      if (hit.hasHit) {
        drift.wheelGroundY[i] = hit.hitPointWorld?.y ?? worldFrom.y - 1;
        drift.wheelOnGround[i] = true;
        groundedCount++;

        const n = hit.hitNormalWorld;
        if (n && Number.isFinite(n.x)) {
          normals.push(new Vector3(n.x, n.y, n.z));
        }
      } else {
        drift.wheelGroundY[i] = worldFrom.y - WHEEL_RAY_LENGTH;
        drift.wheelOnGround[i] = false;
      }
    } catch (_) {
      drift.wheelOnGround[i] = true;
    }
  }

  // Aggregate grounded state (grounded if >= 2 wheels hit)
  const wasGrounded = drift.isGrounded;
  drift.isGrounded = groundedCount >= 2;

  // Aggregate slope normal (average of hit normals)
  if (normals.length > 0) {
    const avg = normals.reduce((a, b) => a.add(b), Vector3.Zero()).scale(1 / normals.length);
    if (avg.lengthSquared() > 0.0001) {
      drift.slopeNormal = avg.normalize();
    } else {
      drift.slopeNormal = new Vector3(0, 1, 0);
    }
  } else {
    drift.slopeNormal = new Vector3(0, 1, 0);
  }

  // Landing detection
  if (!wasGrounded && drift.isGrounded) {
    drift.landingFrames = LANDING_DAMPEN_FRAMES;
    drift.wasAirborne = false;
  }
  if (!drift.isGrounded) {
    drift.wasAirborne = true;
  }
}

/**
 * Compute body pitch and roll from per-wheel ground contact heights.
 * Uses the 4 wheelGroundY values to derive terrain-conforming angles,
 * then smoothly interpolates to prevent jitter.
 *
 * @param {DriftState} drift  Drift state with wheelGroundY populated
 * @param {number} dt  Delta time in seconds
 * @returns {{ pitch: number, roll: number }}  Current smoothed angles in radians
 */
export function computeBodyPitchRoll(drift, dt, wheelRayOffsets) {
  if (!drift.isGrounded) {
    // Airborne: gently return to neutral
    drift.bodyPitch *= (1 - 3 * dt);
    drift.bodyRoll  *= (1 - 3 * dt);
    return { pitch: drift.bodyPitch, roll: drift.bodyRoll };
  }

  const [fl, fr, rl, rr] = drift.wheelGroundY;

  // Height deltas between front/rear and left/right
  const dPitch = ((rl + rr) - (fl + fr)) * 0.5; // positive = rear higher
  const dRoll  = ((fr + rr) - (fl + rl)) * 0.5; // positive = right higher

  // Convert height deltas to proper angles using the actual wheelbase
  // and track width so the result is in radians, not raw metres.
  const offsets = wheelRayOffsets || DEFAULT_WHEEL_RAY_OFFSETS;
  // Wheelbase = front-Z minus rear-Z (local space distance)
  const wheelbase  = Math.abs((offsets[0].z + offsets[1].z) * 0.5
                            - (offsets[2].z + offsets[3].z) * 0.5) || 1.4;
  // Track width = left-X to right-X
  const trackWidth = Math.abs((offsets[1].x + offsets[3].x) * 0.5
                            - (offsets[0].x + offsets[2].x) * 0.5) || 1.4;

  const targetPitch = Math.atan2(dPitch, wheelbase);
  const targetRoll  = Math.atan2(dRoll,  trackWidth);

  // Smooth interpolation
  drift.bodyPitch += (targetPitch - drift.bodyPitch) * BODY_PITCH_ROLL_LERP * dt;
  drift.bodyRoll  += (targetRoll  - drift.bodyRoll)  * BODY_PITCH_ROLL_LERP * dt;

  // Clamp to reasonable limits
  drift.bodyPitch = Math.max(-0.18, Math.min(0.18, drift.bodyPitch));
  drift.bodyRoll  = Math.max(-0.15, Math.min(0.15, drift.bodyRoll));

  return { pitch: drift.bodyPitch, roll: drift.bodyRoll };
}

// ═══════════════════════════════════════════════════════════════════════════
// ── Visual suspension spring-damper ────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Per-wheel spring-damper that produces smooth Y offsets for wheel meshes.
 * Driven by the delta between the current wheelGroundY and the kart body Y.
 * Pure visual — does NOT affect physics body.
 *
 * @param {DriftState} drift  Drift state (reads wheelGroundY, writes suspTravel/suspVelocity)
 * @param {number} bodyY      World Y of the kart root mesh
 * @param {number} dt         Delta time in seconds
 * @param {boolean} justLanded  True on the frame the kart touches down
 */
export function computeSuspension(drift, bodyY, dt, justLanded = false) {
  // Use average grounded-wheel ground Y as the neutral reference.
  // On flat ground every wheel's delta ≈ 0 → springs at rest.
  // On uneven terrain each wheel deflects relative to the average plane.
  let avgGndY = 0;
  let gndCount = 0;
  for (let i = 0; i < 4; i++) {
    if (drift.wheelOnGround[i]) { avgGndY += drift.wheelGroundY[i]; gndCount++; }
  }
  if (gndCount > 0) avgGndY /= gndCount;

  for (let i = 0; i < 4; i++) {
    const groundDelta = drift.wheelOnGround[i]
      ? (drift.wheelGroundY[i] - avgGndY)
      : -SUSP_MAX_TRAVEL; // airborne: wheels extend fully

    const target = Math.max(-SUSP_MAX_TRAVEL, Math.min(SUSP_MAX_TRAVEL, groundDelta));

    // Spring force = -k * displacement, damping = -c * velocity
    const displacement = drift.suspTravel[i] - target;
    const springForce = -SUSP_SPRING_K * displacement - SUSP_DAMP * drift.suspVelocity[i];

    drift.suspVelocity[i] += springForce * dt;
    drift.suspTravel[i] += drift.suspVelocity[i] * dt;

    // Landing kick: extra downward compression
    if (justLanded) {
      drift.suspVelocity[i] -= SUSP_LANDING_KICK / dt;
    }

    // Clamp travel
    drift.suspTravel[i] = Math.max(-SUSP_MAX_TRAVEL, Math.min(SUSP_MAX_TRAVEL, drift.suspTravel[i]));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ── Steering lean (continuous body roll into turns) ────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Computes a body roll angle that leans the kart into turns.
 * Active any time the kart steers, not just during drift.
 *
 * @param {DriftState} drift
 * @param {number} steer   -1..+1 normalised steer input
 * @param {number} speed   Horizontal speed m/s
 * @param {number} dt
 * @returns {number} Current steer lean angle in radians
 */
export function computeSteerLean(drift, steer, speed, dt) {
  // Scale lean by speed ratio (no lean at standstill)
  const speedFactor = Math.min(speed / (MAX_SPEED * 0.6), 1);
  const targetLean = -steer * STEER_LEAN_MAX * speedFactor;
  drift.steerLean += (targetLean - drift.steerLean) * STEER_LEAN_RATE * dt;
  return drift.steerLean;
}

// ═══════════════════════════════════════════════════════════════════════════
// ── Acceleration lean (nose pitch under accel / brake) ────────────────────
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Produces a pitch angle simulating weight transfer:
 * - Acceleration: nose tilts up slightly (weight on rear)
 * - Braking: nose dips (weight on front)
 *
 * @param {DriftState} drift
 * @param {number} throttle  -1..+1 normalised throttle
 * @param {boolean} brake    True if braking
 * @param {number} speed     Horizontal speed m/s
 * @param {number} dt
 * @returns {number} Current accel lean pitch angle in radians
 */
export function computeAccelLean(drift, throttle, brake, speed, dt) {
  let targetPitch = 0;
  const speedFactor = Math.min(speed / (MAX_SPEED * 0.5), 1);
  // Acceleration: detect increasing speed → nose up
  if (throttle > 0 && drift.isGrounded) {
    targetPitch = -ACCEL_LEAN_MAX * throttle * speedFactor;
  }
  // Braking: nose dip (stronger effect)
  if ((brake || throttle < 0) && speed > 2 && drift.isGrounded) {
    targetPitch = BRAKE_LEAN_MAX * speedFactor;
  }
  drift.accelLean += (targetPitch - drift.accelLean) * ACCEL_LEAN_RATE * dt;
  return drift.accelLean;
}

/**
 * Perform a ground-detection raycast below the kart.
 * Updates drift.isGrounded and drift.slopeNormal.
 * Requires Havok physics plugin reference.
 *
 * @param {object} havokPlugin  The Babylon HavokPlugin instance
 * @param {import("@babylonjs/core").TransformNode} transform
 * @param {DriftState} drift
 * @param {object} PhysicsRaycastResult  The Babylon PhysicsRaycastResult constructor
 */
export function raycastGround(havokPlugin, transform, drift, PhysicsRaycastResult) {
  if (!havokPlugin || !transform || !PhysicsRaycastResult) {
    drift.isGrounded = true;
    drift.slopeNormal = new Vector3(0, 1, 0);
    return;
  }
  try {
    const from = transform.position.add(new Vector3(0, 0.3, 0));
    const to   = transform.position.add(new Vector3(0, -GROUND_RAY_LENGTH, 0));
    const hit  = new PhysicsRaycastResult();
    havokPlugin.raycast(from, to, hit);
    if (hit.hasHit) {
      drift.isGrounded = true;
      // Use hit normal for slope alignment
      const n = hit.hitNormalWorld;
      if (n && Number.isFinite(n.x)) {
        drift.slopeNormal = new Vector3(n.x, n.y, n.z).normalize();
      } else {
        drift.slopeNormal = new Vector3(0, 1, 0);
      }
      // Landing detection
      if (drift.wasAirborne) {
        drift.landingFrames = LANDING_DAMPEN_FRAMES;
        drift.wasAirborne = false;
      }
    } else {
      drift.isGrounded = false;
      drift.wasAirborne = true;
      drift.slopeNormal = new Vector3(0, 1, 0);
    }
  } catch (_) {
    drift.isGrounded = true;
    drift.slopeNormal = new Vector3(0, 1, 0);
  }
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
  const handling = mults?.handling || null;
  const turnResponse = Number(handling?.turnResponse ?? 1);
  const lateralGrip = Number(handling?.lateralGrip ?? LATERAL_GRIP);
  const driftGripMul = Number(handling?.driftGripMul ?? DRIFT_GRIP_MUL);
  const velocityAlign = Number(handling?.velocityAlign ?? 0);

  const effectiveMaxSpeed  = MAX_SPEED * spdMult;
  const effectiveAccel     = ACCEL_FORCE * spdMult;
  const effectiveTurnBase  = TURN_BASE * strMult * turnResponse;

  let currentVel    = body.getLinearVelocity();
  let currentAngVel = body.getAngularVelocity();

  // Sanitise NaN velocities
  if (
    !Number.isFinite(currentVel.x) || !Number.isFinite(currentVel.y) || !Number.isFinite(currentVel.z) ||
    !Number.isFinite(currentAngVel.x) || !Number.isFinite(currentAngVel.y) || !Number.isFinite(currentAngVel.z)
  ) {
    body.setLinearVelocity(new Vector3(0, 0, 0));
    body.setAngularVelocity(new Vector3(0, 0, 0));
    return { speedKPH: 0, driftTier: 0, miniBoostTier: 0, miniBoostActive: false, isGrounded: true, isReversing: false };
  }

  body.disablePreStep = false;

  const hSpeed     = Math.sqrt(currentVel.x ** 2 + currentVel.z ** 2);
  const speedRatio = Math.min(hSpeed / effectiveMaxSpeed, 1);
  const speedKPH   = hSpeed * 3.6;

  // ── Landing bounce dampening (21.1) ───────────────────────────────────
  if (drift.landingFrames > 0) {
    drift.landingFrames--;
    if (currentVel.y > 2) currentVel.y *= 0.5;
  }

  // ── Airborne state: reduced control when not grounded (21.1) ──────────
  const airborneSteerMul = drift.isGrounded ? 1.0 : 0.25;

  // ── Forward direction ─────────────────────────────────────────────────
  let forwardDir = transform.forward.scale(-1);
  if (forwardDir.lengthSquared() > 0.00001) {
    forwardDir.normalize();
  } else {
    forwardDir.copyFromFloats(0, 0, 1);
  }

  // ── Reverse state machine (21.5) ──────────────────────────────────────
  const forwardDot = Vector3.Dot(currentVel, forwardDir);
  const isMovingForward = forwardDot > STOP_THRESHOLD;

  if (input.throttle < 0) {
    if (isMovingForward) {
      // Moving forward + pressing back = brake (not reverse)
      drift.reverseEngaged = false;
    } else if (hSpeed < STOP_THRESHOLD) {
      drift.reverseEngaged = true;
    }
  } else {
    drift.reverseEngaged = false;
  }

  // ── 1. Steering (MK3.js inspired: speed-capped turn influence) ─────────
  // MK3.js: inputTurn * (speed > 40 ? 40 : speed) / maxSpeed
  const cappedSpeed = Math.min(hSpeed, effectiveMaxSpeed * 1.1);
  const turnInfluence = cappedSpeed / effectiveMaxSpeed;
  const turnSpeed = effectiveTurnBase - (effectiveTurnBase - TURN_MIN) * Math.min(turnInfluence, 1);

  if (input.steer !== 0 && hSpeed > 0.5 && drift.isGrounded) {
    const isReversing = drift.reverseEngaged || forwardDot < -1;
    const dir = isReversing ? -1 : 1;
    const driftBoost = input.drift ? 1.26 : 1.0;
    const targetYaw = input.steer * turnSpeed * dir * driftBoost * airborneSteerMul;

    // Set yaw while preserving X/Z angular velocity from suspension forces.
    // Damping on pitch/roll prevents runaway oscillation while letting
    // the body tilt naturally from force-based suspension.
    body.setAngularVelocity(new Vector3(
      currentAngVel.x * PITCH_DAMP,
      targetYaw,
      currentAngVel.z * ROLL_DAMP,
    ));
  } else if (!drift.isGrounded) {
    // Airborne: lighter damping — let predictive landing orient the body
    body.setAngularVelocity(new Vector3(
      currentAngVel.x * 0.97,
      currentAngVel.y * 0.95,
      currentAngVel.z * 0.97,
    ));
  } else {
    // Coasting on ground: damp yaw, preserve suspension pitch/roll
    body.setAngularVelocity(new Vector3(
      currentAngVel.x * PITCH_DAMP,
      currentAngVel.y * YAW_COAST_DAMP,
      currentAngVel.z * ROLL_DAMP,
    ));
  }

  let nextVel = new Vector3(currentVel.x, currentVel.y, currentVel.z);

  // ── Mini-turbo drift charge (MK3.js 3-tier: blue/yellow/purple) ──────
  const isDrifting = input.drift && input.steer !== 0 && hSpeed > 5 && drift.isGrounded;
  if (isDrifting) {
    drift.driftCharge += MINI_TURBO_CHARGE_RATE * dt;
    // Track drift direction (MK3.js: driftDirection = left/right on initiation)
    if (drift.driftDirection === 0) {
      drift.driftDirection = input.steer > 0 ? 1 : -1;
    }
  }
  if (drift.wasDrifting && !isDrifting && drift.driftCharge > 0) {
    // Release drift → grant turbo based on tier (MK3.js: turbo = boostPower)
    if (drift.driftCharge >= MINI_TURBO_TIER3) {
      drift.miniBoostTimer = MINI_TURBO_BOOST_T3;
      drift.miniBoostTier = 3;
    } else if (drift.driftCharge >= MINI_TURBO_TIER2) {
      drift.miniBoostTimer = MINI_TURBO_BOOST_T2;
      drift.miniBoostTier = 2;
    } else if (drift.driftCharge >= MINI_TURBO_TIER1) {
      drift.miniBoostTimer = MINI_TURBO_BOOST_T1;
      drift.miniBoostTier = 1;
    }
    drift.driftCharge = 0;
    drift.driftDirection = 0;
  }
  if (!isDrifting && !drift.wasDrifting) {
    drift.driftCharge = 0;
    drift.driftDirection = 0;
  }
  drift.wasDrifting = isDrifting;

  if (drift.miniBoostTimer > 0) drift.miniBoostTimer -= dt;
  if (drift.miniBoostTimer <= 0) { drift.miniBoostTimer = 0; drift.miniBoostTier = 0; }

  const boostMul = drift.miniBoostTimer > 0
    ? (drift.miniBoostTier >= 3 ? MINI_TURBO_SPEED_MUL_T3 : MINI_TURBO_SPEED_MUL)
    : 1.0;

  // ── Drift visual tilt tracking (21.3) ─────────────────────────────────
  const TARGET_TILT = 0.18; // ~10° lean into turn during drift
  if (isDrifting) {
    const targetTilt = -input.steer * TARGET_TILT;
    drift.driftTiltAngle += (targetTilt - drift.driftTiltAngle) * 6 * dt;
  } else {
    drift.driftTiltAngle *= (1 - 8 * dt);
    if (Math.abs(drift.driftTiltAngle) < 0.001) drift.driftTiltAngle = 0;
  }

  // ── Drift body yaw visual offset (MK3.js: kart.rotation.y = driftDirection * 0.4) ──
  if (isDrifting && drift.driftDirection !== 0) {
    const targetYawOff = drift.driftDirection * DRIFT_BODY_YAW;
    drift.driftBodyYaw += (targetYawOff - drift.driftBodyYaw) * DRIFT_YAW_DAMP * dt;
  } else {
    drift.driftBodyYaw *= (1 - DRIFT_YAW_DAMP * dt);
    if (Math.abs(drift.driftBodyYaw) < 0.005) drift.driftBodyYaw = 0;
  }

  // ── Direction smoothing (MK3.js: smoothedDirectionRef.lerp(desiredDirection, 12 * dt)) ──
  const desiredDirX = -forwardDir.x;
  const desiredDirZ = -forwardDir.z;
  drift.smoothedDirX += (desiredDirX - drift.smoothedDirX) * DIR_SMOOTH_RATE * dt;
  drift.smoothedDirZ += (desiredDirZ - drift.smoothedDirZ) * DIR_SMOOTH_RATE * dt;

  // ── 2. Acceleration (with slope projection & reverse) ─────────────────
  // Project forward direction onto slope plane for natural hill driving (21.1)
  let driveDir = forwardDir.clone();
  if (drift.isGrounded && drift.slopeNormal.y < 0.999) {
    // Project forward onto slope: forward - (forward · normal) * normal
    const dot = Vector3.Dot(forwardDir, drift.slopeNormal);
    driveDir = forwardDir.subtract(drift.slopeNormal.scale(dot));
    if (driveDir.lengthSquared() > 0.0001) driveDir.normalize();
    else driveDir = forwardDir;
  }

  if (drift.reverseEngaged) {
    // Reverse: slower acceleration, capped speed
    const reverseMax = effectiveMaxSpeed * REVERSE_MAX_RATIO;
    if (hSpeed < reverseMax) {
      const accel = effectiveAccel * 0.4 * dt;
      nextVel.x -= driveDir.x * accel;
      nextVel.z -= driveDir.z * accel;
    }
  } else if (input.throttle > 0 && hSpeed < effectiveMaxSpeed * boostMul && drift.isGrounded) {
    const falloff = 1 - speedRatio * speedRatio;
    const accel = effectiveAccel * boostMul * Math.max(falloff, 0.08) * dt;
    nextVel.x += driveDir.x * accel;
    nextVel.z += driveDir.z * accel;
  } else if (input.throttle < 0 && !drift.reverseEngaged && drift.isGrounded) {
    // Braking from forward motion (not yet reversed)
    // Handled in drag section below
  } else if (input.throttle > 0 && !drift.isGrounded) {
    // Airborne: minor forward nudge for hang-time control
    const accel = effectiveAccel * 0.15 * dt;
    nextVel.x += driveDir.x * accel;
    nextVel.z += driveDir.z * accel;
  }

  // ── 3. Braking & coasting drag ────────────────────────────────────────
  if (input.brake && drift.isGrounded) {
    nextVel.x *= BRAKE_DRAG;
    nextVel.z *= BRAKE_DRAG;
  } else if (input.throttle < 0 && isMovingForward && !drift.reverseEngaged) {
    // Holding back while moving forward = brake
    nextVel.x *= BRAKE_DRAG;
    nextVel.z *= BRAKE_DRAG;
  } else if (input.throttle === 0 && drift.isGrounded) {
    nextVel.x *= COAST_DRAG;
    nextVel.z *= COAST_DRAG;
  }

  // ── 4. Lateral grip ──────────────────────────────────────────────────
  if (drift.isGrounded) {
    let rightDir = transform.right;
    if (rightDir.lengthSquared() > 0.00001) {
      rightDir.normalize();
    } else {
      rightDir = new Vector3(1, 0, 0);
    }
    const latSpeed = Vector3.Dot(nextVel, rightDir);
    const grip = input.drift ? lateralGrip * driftGripMul : lateralGrip;
    nextVel.x -= rightDir.x * latSpeed * grip;
    nextVel.z -= rightDir.z * latSpeed * grip;
  }

  if (drift.isGrounded && velocityAlign > 0 && Math.abs(input.steer) > 0.01) {
    const horizontalSpeed = Math.sqrt((nextVel.x ** 2) + (nextVel.z ** 2));
    if (horizontalSpeed > 0.5) {
      const desiredVelX = driveDir.x * horizontalSpeed;
      const desiredVelZ = driveDir.z * horizontalSpeed;
      const blend = Math.max(0, Math.min(1, velocityAlign * dt * 60));
      nextVel.x += (desiredVelX - nextVel.x) * blend;
      nextVel.z += (desiredVelZ - nextVel.z) * blend;
    }
  }

  // ── 5. Downforce (grounded only) ─────────────────────────────────────
  // Reduced from 20 → 5: force-based suspension now handles ground contact;
  // residual downforce just helps stability at high speed over bumps.
  if (drift.isGrounded && hSpeed > 3) {
    nextVel.y -= 5 * speedRatio * dt;
  }
  // Clamp vertical velocity — wider range to let suspension forces work
  if (drift.isGrounded) {
    if (nextVel.y > 8) nextVel.y = 8;
    if (nextVel.y < -15) nextVel.y = -15;
  } else {
    // Airborne: allow normal gravity fall but still cap absurd values
    if (nextVel.y > 15) nextVel.y = 15;
    if (nextVel.y < -40) nextVel.y = -40;
  }

  body.setLinearVelocity(nextVel);

  // ── Return feedback ───────────────────────────────────────────────────
  const driftTier = isDrifting
    ? (drift.driftCharge >= MINI_TURBO_TIER3 ? 3
      : drift.driftCharge >= MINI_TURBO_TIER2 ? 2
        : drift.driftCharge >= MINI_TURBO_TIER1 ? 1 : 0)
    : 0;

  // Track speed for accel lean detection
  drift.prevHSpeed = hSpeed;

  return {
    speedKPH,
    hSpeed,
    driftTier,
    miniBoostTier: drift.miniBoostTier,
    miniBoostActive: drift.miniBoostTimer > 0,
    isGrounded: drift.isGrounded,
    isReversing: drift.reverseEngaged,
    driftTiltAngle: drift.driftTiltAngle,
    driftBodyYaw: drift.driftBodyYaw,
    driftDirection: drift.driftDirection,
    smoothedDirX: drift.smoothedDirX,
    smoothedDirZ: drift.smoothedDirZ,
    steer: input.steer,
    throttle: input.throttle,
    brake: !!input.brake,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ── Collision Response (21.2) ──────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check whether a kart is currently invulnerable to bump stun.
 * @param {DriftState} drift
 * @returns {boolean}
 */
export function checkBumpInvulnerability(drift) {
  return Date.now() < drift.bumpInvulnUntil;
}

/**
 * Apply wall-slide collision response. Call when a kart's physics body
 * contacts a static wall mesh.
 *
 * - Removes velocity component into the wall (slide along surface)
 * - Applies speed penalty proportional to impact force
 * - Applies lateral slide friction so the kart doesn't stick
 *
 * @param {import("@babylonjs/core").PhysicsBody} body
 * @param {Vector3} wallNormal  Outward-facing wall normal (world space)
 * @param {DriftState} drift
 * @returns {{ impactSpeed: number }}  For camera-shake scaling
 */
export function applyWallCollision(body, wallNormal, drift) {
  const vel = body.getLinearVelocity();
  const normal = wallNormal.normalize();

  // Component of velocity into the wall (negative = heading into wall)
  const intoWall = Vector3.Dot(vel, normal);

  if (intoWall >= 0) {
    // Moving away from wall — no collision response needed
    return { impactSpeed: 0 };
  }

  const impactSpeed = Math.abs(intoWall);

  // Remove the into-wall component (reflect/slide)
  const correction = normal.scale(-intoWall * WALL_SLIDE_FRICTION);
  const newVel = new Vector3(
    (vel.x + correction.x) * WALL_SPEED_PENALTY,
    vel.y,
    (vel.z + correction.z) * WALL_SPEED_PENALTY,
  );

  body.setLinearVelocity(newVel);

  return { impactSpeed };
}

/**
 * Apply kart-kart bump impulse. Call when two karts collide.
 * Heavier karts shove lighter karts harder. Applies brief invulnerability
 * to the victim to prevent chain-stun.
 *
 * @param {import("@babylonjs/core").PhysicsBody} victimBody
 * @param {Vector3} victimPos   Victim kart world position
 * @param {Vector3} attackerPos Attacker kart world position
 * @param {Vector3} attackerVel Attacker's linear velocity at moment of contact
 * @param {number}  victimMass  Victim kart mass
 * @param {number}  attackerMass Attacker kart mass
 * @param {DriftState} victimDrift  Victim's drift state (for invulnerability tracking)
 * @returns {{ applied: boolean, bumpForce: number }}
 */
export function applyKartBump(victimBody, victimPos, attackerPos, attackerVel, victimMass, attackerMass, victimDrift) {
  // Skip if victim is currently invulnerable from a recent bump
  if (checkBumpInvulnerability(victimDrift)) {
    return { applied: false, bumpForce: 0 };
  }

  // Direction from attacker to victim (XZ plane)
  const bumpDir = new Vector3(
    victimPos.x - attackerPos.x,
    0,
    victimPos.z - attackerPos.z,
  );
  if (bumpDir.lengthSquared() < 0.0001) {
    bumpDir.copyFromFloats(0, 0, 1);
  }
  bumpDir.normalize();

  // Relative speed of attacker along bump direction
  const relSpeed = Math.max(Vector3.Dot(attackerVel, bumpDir), 0);
  if (relSpeed < 2) {
    // Too slow to register as a bump
    return { applied: false, bumpForce: 0 };
  }

  // Mass ratio: heavier attacker pushes harder
  const massRatio = Math.sqrt(attackerMass / Math.max(victimMass, 100));
  const bumpForce = relSpeed * Math.min(massRatio, 2.0) * 0.6;

  // Apply bump impulse to victim
  const vel = victimBody.getLinearVelocity();
  victimBody.setLinearVelocity(new Vector3(
    vel.x + bumpDir.x * bumpForce,
    vel.y + 2,  // small upward pop
    vel.z + bumpDir.z * bumpForce,
  ));

  // Grant brief invulnerability to prevent chain-stun
  victimDrift.bumpInvulnUntil = Date.now() + BUMP_INVULN_MS;

  return { applied: true, bumpForce };
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
 * @param {number}  [victimMass=800] Victim kart mass (heavier = less knockback)
 * @param {number}  [attackerMass=800] Attacker kart mass (heavier = more knockback)
 */
export function applyHitImpulse(body, direction, force, lift = 8, victimMass = 800, attackerMass = 800) {
  // Mass ratio scaling: heavier attacker pushes harder, heavier victim resists more
  const massRatio = Math.sqrt(attackerMass / Math.max(victimMass, 100));
  const scaledForce = force * Math.min(massRatio, 2.0);
  const impulse = direction.normalize().scale(scaledForce);
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
