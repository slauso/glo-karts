/**
 * kart-physics.js — Shared kart handling core.
 *
 * Single source of truth for the cannon-es kart vehicle constants,
 * suspension setup, and the per-tick `applyKartControls` body. Both
 * the SP playtest physics worker (`frontend/src/editor3/physics-worker.js`)
 * and the authoritative online race room
 * (`realtime/src/rooms/Editor3RaceRoom.js`) import this module so kart
 * handling is exactly 1-to-1 across modes.
 *
 * The function operates on a `ctx` object that owns ALL per-kart state:
 *   {
 *     chassisBody:  CANNON.Body          // dynamic chassis
 *     vehicle:      CANNON.RaycastVehicle
 *     controlState: object               // throttle/steer/drift/boost state
 *     keys:         { w,a,s,d,space,drift }
 *     playerCombat: { boostMult, slowMult, oilNow }
 *   }
 *
 * Why a single shared module?
 *   The SP file evolved a long, hand-tuned arcade feel (anti-pitch,
 *   slope-aware ground stick, drift hop+commit+exit-damp, post-drift
 *   boost). Re-implementing any of it server-side would drift away
 *   from playtest the moment SP gets re-tuned. By importing the same
 *   source, every constant change to playtest applies to online
 *   races without further coordination.
 */
import * as CANNON from 'cannon-es';

// ── Scale ────────────────────────────────────────────────────
// 1 world unit = 1 mm. Track segments, gravity, and kart geometry
// are all expressed in mm so cannon-es solver tolerances behave
// consistently across the whole world (no metres-vs-mm mismatch).
export const SCALE = 1000;
export const M = (n) => n * SCALE;

// ── Geometry / mass ─────────────────────────────────────────
export const KART_MASS = 150;
export const CHASSIS_HX = M(0.6);
export const CHASSIS_HY = M(0.3);
export const CHASSIS_HZ = M(1.0);
export const WHEEL_RADIUS = M(0.4);

// ── Power & speed ───────────────────────────────────────────
// Engine — trimmed from 2200 to curb the torque-reaction wheelie
// (force is applied at wheel contact, well below CoM; too much
// torque pitches the nose up on launch).
export const MAX_ENGINE = M(1700);
export const REVERSE_ENGINE = M(800);
// Brake force tuned to M(28) and front-heavy so a hard brake at
// speed decelerates the kart instead of locking the rear and
// pitching the nose forward end-over-end.
export const MAX_BRAKE = M(28);
export const BRAKE_REAR_BIAS = 0.55;
export const BRAKE_REAR_BIAS_DRIFT = 0.20;
export const HANDBRAKE_FORCE = M(110);
export const ANTI_PITCH_TORQUE = M(13000);
export const ANTI_PITCH_DAMPING = M(4000);
export const TOP_SPEED_MS = M(52);

// ── Steering ────────────────────────────────────────────────
export const STEER_LOCK_LOW = 0.58;
export const STEER_LOCK_HIGH = 0.20;
export const STEER_RAMP_IN_PER_S = 7.5;
export const STEER_RAMP_OUT_PER_S = 14.0;

// ── Drift ────────────────────────────────────────────────────
export const DRIFT_HOP_VY = M(3.8);
export const DRIFT_HOP_LIFT = M(0.30);
export const DRIFT_HOP_COOLDOWN_S = 0.40;
export const DRIFT_LAND_COMMIT_WINDOW_S = 0.30;
export const DRIFT_COMMIT_MIN_SPEED = M(4.0);
export const DRIFT_REAR_GRIP = 0.12;
export const DRIFT_FRONT_GRIP = 3.0;
export const DRIFT_STEER_BIAS = 0.12;
export const DRIFT_STEER_INPUT_GAIN = 0.30;
export const DRIFT_YAW_ASSIST_GAIN_UNDER = 0.50;
export const DRIFT_YAW_ASSIST_GAIN_OVER = 1.60;
export const DRIFT_YAW_ASSIST_TAU_S = 0.12;
export const DRIFT_YAW_RATE_SCALE = 2.4;
export const DRIFT_MAX_YAW_RATE = 1.75;
export const DRIFT_TARGET_SLIDE_BASE = 0.46;
export const DRIFT_TARGET_SLIDE_RANGE = 0.24;
export const DRIFT_THROTTLE_FLOOR = 0.05;
export const DRIFT_EXIT_DAMP_S = 1.80;
export const DRIFT_EXIT_YAW_TAU_S = 0.10;
export const DRIFT_EXIT_LAT_TAU_S = 0.18;
export const DRIFT_CHARGE_T1 = 0.85;
export const DRIFT_CHARGE_T2 = 1.85;
export const DRIFT_CHARGE_T3 = 3.20;
export const DRIFT_BOOST_T1_S = 0.55;
export const DRIFT_BOOST_T2_S = 1.05;
export const DRIFT_BOOST_T3_S = 1.60;
export const DRIFT_BOOST_FORCE = M(2400);
export const DRIFT_BOOST_TOPSPEED_MUL = 1.28;

// ── Damping & grip ──────────────────────────────────────────
export const KART_LINEAR_DAMPING = 0.06;
export const KART_ANGULAR_DAMPING = 0.55;
export const TYRE_GRIP = 4.6;
export const TYRE_GRIP_DRIFT = 2.3;

// ── Burnout (W+Space stationary charge → release boost) ────
// Mirror of SP play-main.js client-side mechanic so online karts
// have the same charge meter + release boost. Detection (brake +
// throttle while nearly stationary) already lives in applyKartControls;
// these constants drive the timer/boost overlay built on top.
export const BURNOUT_CHARGE_MIN_S = 0.18;
export const BURNOUT_BOOST_DURATION_S = 0.7;
export const BURNOUT_BOOST_DURATION_MAX_S = 2.2;
export const BURNOUT_OVERHEAT_S = 6.0;
export const ENGINE_LOCKOUT_S = 1.6;
export const ENGINE_STEAM_S = 4.0;
// Boost force applied while gloBurnoutT > 0. Mirrors drift mini-turbo
// scaling so a fully-charged burnout release reads as a stronger,
// longer boost than a tier-3 drift.
export const BURNOUT_BOOST_FORCE = M(2800);
export const BURNOUT_BOOST_TOPSPEED_MUL = 1.32;

// ── Local axis constants ────────────────────────────────────
const FORWARD_LOCAL = new CANNON.Vec3(0, 0, 1);
const RIGHT_LOCAL = new CANNON.Vec3(1, 0, 0);

// ── Suspension defaults (used by createKartVehicle) ─────────
export const WHEEL_OPTIONS_BASE = {
  radius: WHEEL_RADIUS,
  suspensionStiffness: 60,
  suspensionRestLength: M(0.3),
  frictionSlip: TYRE_GRIP,
  dampingRelaxation: 4.4,
  dampingCompression: 4.6,
  maxSuspensionForce: M(150000),
  rollInfluence: 0.012,
  maxSuspensionTravel: M(0.45),
  customSlidingRotationalSpeed: -30,
  useCustomSlidingRotationalSpeed: true,
};

/**
 * Create a fresh per-kart `controlState`. Both SP and online use the
 * same shape so all branches in `applyKartControls` work identically.
 */
export function createControlState() {
  return {
    steer: 0,
    throttle: 0,
    driftHopCooldown: 0,
    lastDriftPress: false,
    driftArmed: false,
    driftAirborne: false,
    driftLandTimer: 0,
    driftCommitTimer: 0,
    driftGroundedGrace: 0,
    driftActive: false,
    driftDir: 0,
    driftCharge: 0,
    driftTier: 0,
    boostTimer: 0,
    boostTier: 0,
    driftJustReleasedTier: 0,
    driftExitDamp: 0,
    driftExitDir: 0,
    // Burnout overlay (W+Space hold → release boost)
    burnoutCharge: 0,           // seconds of W+Space hold accumulated
    burnoutPrevSpace: false,    // edge detector for release
    gloBurnoutT: 0,             // remaining seconds of burnout boost
    engineExplodedUntilMs: 0,   // wall-time ms; controls input lockout
    chargingBurnout: false,     // true while accumulating charge (broadcast)
  };
}

export function createPlayerCombat() {
  return { boostMult: 1, slowMult: 1, oilNow: false };
}

/**
 * Build a chassis Body + RaycastVehicle wired with the standard
 * suspension and wheel placement. Mirrors the SP playtest exactly so
 * kart geometry, weight transfer, and raycast origins are identical.
 */
export function createKartVehicle(world, pose) {
  const chassisShape = new CANNON.Box(new CANNON.Vec3(CHASSIS_HX, CHASSIS_HY, CHASSIS_HZ));
  const chassisBody = new CANNON.Body({ mass: KART_MASS });
  chassisBody.addShape(chassisShape);
  chassisBody.position.set(pose.x, pose.y, pose.z);
  chassisBody.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), pose.heading || 0);
  chassisBody.linearDamping = KART_LINEAR_DAMPING;
  chassisBody.angularDamping = KART_ANGULAR_DAMPING;
  world.addBody(chassisBody);

  const vehicle = new CANNON.RaycastVehicle({
    chassisBody,
    indexRightAxis: 0,
    indexUpAxis: 1,
    indexForwardAxis: 2,
  });

  const WX = CHASSIS_HX + M(0.05);
  const WZ = CHASSIS_HZ * 0.75;
  const WY = -CHASSIS_HY * 0.5;
  // Order MUST match the rest of the code: [rear-left, rear-right, front-left, front-right].
  // Wheels 0,1 are rear (-Z); 2,3 are front (+Z).
  for (const p of [[-WX, WY, -WZ], [WX, WY, -WZ], [-WX, WY, WZ], [WX, WY, WZ]]) {
    vehicle.addWheel({
      ...WHEEL_OPTIONS_BASE,
      directionLocal: new CANNON.Vec3(0, -1, 0),
      axleLocal: new CANNON.Vec3(-1, 0, 0),
      chassisConnectionPointLocal: new CANNON.Vec3(p[0], p[1], p[2]),
    });
  }
  vehicle.addToWorld(world);
  return { chassisBody, vehicle };
}

// Scratch vectors — module-scoped, reused every call. SAFE because
// `applyKartControls` is invoked sequentially per kart on every host
// (single-threaded JS): no two karts ever share a tick concurrently.
const _fwd = new CANNON.Vec3();
const _right = new CANNON.Vec3();
const _antiPitchTorque = new CANNON.Vec3();
const _brakeForce = new CANNON.Vec3();
const _coastForce = new CANNON.Vec3();
const _driftImpulse = new CANNON.Vec3();
const _boostPoint = new CANNON.Vec3();

/**
 * Apply one tick of kart handling to `ctx`. Must be called once per
 * physics step BEFORE world.step(). Identical control flow to the
 * SP playtest worker — every drift / boost / pitch behaviour is
 * preserved bit-for-bit.
 */
export function applyKartControls(ctx, dt) {
  const { chassisBody, vehicle, controlState, playerCombat } = ctx;
  let { keys } = ctx;

  // Engine-explosion lockout: zero every drive input while the recovery
  // timer is active. Mirrors SP `shipKeysIfChanged()` which sends false
  // keys to the worker for the duration. Kart keeps its momentum but
  // loses throttle/steer/brake/drift, selling the "blown engine" beat.
  const nowMs = Date.now();
  const exploded = nowMs < (controlState.engineExplodedUntilMs || 0);
  if (exploded) {
    keys = { w: false, s: false, a: false, d: false, space: false, drift: false };
  }

  const rawAccel = (keys.w ? 1 : 0) + (keys.s ? -1 : 0);
  const rawSteer = (keys.a ? 1 : 0) + (keys.d ? -1 : 0);
  const braking = keys.space;
  const drifting = keys.drift && Math.abs(controlState.throttle) > 0.1;

  const throttleTarget = rawAccel;
  const throttleRate = throttleTarget !== 0 ? 9.0 : 12.0;
  controlState.throttle += (throttleTarget - controlState.throttle) * Math.min(1, throttleRate * dt);

  const steerTarget = rawSteer;
  const ramping = (Math.sign(steerTarget) === Math.sign(controlState.steer) && steerTarget !== 0);
  const steerRate = ramping ? STEER_RAMP_IN_PER_S : STEER_RAMP_OUT_PER_S;
  controlState.steer += (steerTarget - controlState.steer) * Math.min(1, steerRate * dt);

  chassisBody.quaternion.vmult(FORWARD_LOCAL, _fwd);
  const v = chassisBody.velocity;
  const speedFwd = v.dot(_fwd);
  const speedAbs = Math.abs(speedFwd);
  const speedRatio = Math.min(1, speedAbs / TOP_SPEED_MS);

  const mult = playerCombat.boostMult * playerCombat.slowMult;
  const intent = controlState.throttle;
  const driftBoostMul = controlState.boostTimer > 0 ? DRIFT_BOOST_TOPSPEED_MUL : 1;
  // NOTE: SP playtest does NOT add a burnout-boost top-speed multiplier;
  // the burnout release "feels" fast simply because the kart goes from
  // ~0 m/s to TOP_SPEED in a few seconds with full throttle held. Adding
  // a multiplier here was an MP-only deviation that, combined with the
  // backward-pointing burnout body force below, made online burnout
  // glitch (kart launched then got pushed back). Match SP exactly.
  const speedCap = TOP_SPEED_MS * mult * driftBoostMul;
  const overspeed = (intent > 0 && speedFwd > speedCap * 0.92)
    ? Math.max(0, 1 - (speedFwd - speedCap * 0.92) / (speedCap * 0.18))
    : 1;
  const engineMag = intent * (intent >= 0 ? MAX_ENGINE : REVERSE_ENGINE) * mult * overspeed;
  const force = -engineMag;

  const steerLock = STEER_LOCK_LOW + (STEER_LOCK_HIGH - STEER_LOCK_LOW) * speedRatio;
  const steerSign = (speedFwd < -M(0.5)) ? -1 : 1;
  const oilJitter = playerCombat.oilNow ? (Math.random() * 2 - 1) * 0.4 : 0;
  let steerInput = controlState.steer;
  if (controlState.driftActive) {
    const dd = controlState.driftDir;
    const sLocal = Math.max(-1, Math.min(1, controlState.steer * dd));
    const blended = DRIFT_STEER_BIAS + sLocal * DRIFT_STEER_INPUT_GAIN;
    steerInput = dd * Math.max(0.15, Math.min(1.0, blended));
  } else if ((controlState.driftExitDamp || 0) > 0 && controlState.driftExitDir) {
    const dd = controlState.driftExitDir;
    const sLocal = Math.max(-1, Math.min(1, controlState.steer * dd));
    const blended = DRIFT_STEER_BIAS + sLocal * DRIFT_STEER_INPUT_GAIN;
    const driftShaped = dd * Math.max(0.15, Math.min(1.0, blended));
    const tNorm = controlState.driftExitDamp / DRIFT_EXIT_DAMP_S;
    const k = Math.max(0, Math.min(1, tNorm * tNorm));
    steerInput = driftShaped * k + controlState.steer * (1 - k);
  }
  const steerCmd = (steerInput * steerSign + oilJitter) * steerLock;
  vehicle.setSteeringValue(steerCmd, 2);
  vehicle.setSteeringValue(steerCmd, 3);

  // FWD layout. Burnout suppression mirrors SP exactly.
  const _isBurnoutPre = braking
    && controlState.throttle > 0.1
    && Math.abs(speedFwd) < M(2.5)
    && !drifting
    && !controlState.driftActive;
  const burnoutFrontScale = _isBurnoutPre ? 0.08 : 1.0;
  const frontDrive = force * burnoutFrontScale;
  const rearAssist = _isBurnoutPre ? 0 : force * 0.25;
  vehicle.applyEngineForce(rearAssist, 0);
  vehicle.applyEngineForce(rearAssist, 1);
  vehicle.applyEngineForce(frontDrive, 2);
  vehicle.applyEngineForce(frontDrive, 3);

  const brakeDrift = braking
    && speedFwd > M(8)
    && Math.abs(controlState.steer) > 0.25
    && !drifting
    && !controlState.driftActive;
  const burnout = braking
    && controlState.throttle > 0.1
    && Math.abs(speedFwd) < M(2.5)
    && !drifting
    && !controlState.driftActive;
  const grip = (drifting && braking) ? TYRE_GRIP_DRIFT : TYRE_GRIP;
  if (controlState.driftActive) {
    vehicle.wheelInfos[0].frictionSlip = DRIFT_REAR_GRIP;
    vehicle.wheelInfos[1].frictionSlip = DRIFT_REAR_GRIP;
    vehicle.wheelInfos[2].frictionSlip = DRIFT_FRONT_GRIP;
    vehicle.wheelInfos[3].frictionSlip = DRIFT_FRONT_GRIP;
  } else if (brakeDrift) {
    vehicle.wheelInfos[0].frictionSlip = DRIFT_REAR_GRIP;
    vehicle.wheelInfos[1].frictionSlip = DRIFT_REAR_GRIP;
    vehicle.wheelInfos[2].frictionSlip = DRIFT_FRONT_GRIP;
    vehicle.wheelInfos[3].frictionSlip = DRIFT_FRONT_GRIP;
  } else if (burnout) {
    vehicle.wheelInfos[0].frictionSlip = TYRE_GRIP;
    vehicle.wheelInfos[1].frictionSlip = TYRE_GRIP;
    vehicle.wheelInfos[2].frictionSlip = DRIFT_REAR_GRIP * 0.40;
    vehicle.wheelInfos[3].frictionSlip = DRIFT_REAR_GRIP * 0.40;
  } else if ((controlState.driftExitDamp || 0) > 0) {
    const restoreT = 1 - (controlState.driftExitDamp / DRIFT_EXIT_DAMP_S);
    const eased = restoreT * restoreT;
    const rearGrip = DRIFT_REAR_GRIP + (TYRE_GRIP - DRIFT_REAR_GRIP) * eased;
    vehicle.wheelInfos[0].frictionSlip = rearGrip;
    vehicle.wheelInfos[1].frictionSlip = rearGrip;
    vehicle.wheelInfos[2].frictionSlip = TYRE_GRIP;
    vehicle.wheelInfos[3].frictionSlip = TYRE_GRIP;
  } else {
    for (let i = 0; i < vehicle.wheelInfos.length; i++) {
      vehicle.wheelInfos[i].frictionSlip = grip;
    }
  }

  let brakeFront = braking ? MAX_BRAKE * 0.15 : 0;
  let brakeRear = braking ? MAX_BRAKE * 0.15 * BRAKE_REAR_BIAS : 0;
  if (brakeDrift) {
    brakeFront = MAX_BRAKE;
    brakeRear = MAX_BRAKE * BRAKE_REAR_BIAS_DRIFT;
  }
  if (burnout) {
    brakeFront = 0;
    brakeRear = HANDBRAKE_FORCE;
  }
  if (drifting && braking) brakeRear = HANDBRAKE_FORCE;
  vehicle.setBrake(brakeRear, 0);
  vehicle.setBrake(brakeRear, 1);
  vehicle.setBrake(brakeFront, 2);
  vehicle.setBrake(brakeFront, 3);

  let grounded = false;
  let groundedCount = 0;
  for (let i = 0; i < vehicle.wheelInfos.length; i++) {
    if (vehicle.wheelInfos[i].isInContact) { grounded = true; groundedCount++; }
  }

  // Slope-aware ground stick.
  if (grounded && !controlState.driftAirborne) {
    const fwdY = _fwd.y;
    const vxz = Math.hypot(chassisBody.velocity.x, chassisBody.velocity.z);
    const vy = chassisBody.velocity.y;
    const expectedVy = fwdY * speedFwd;
    const vyExcess = vy - expectedVy;
    const descentFactor = Math.max(0, -fwdY);
    const tol = M(1.0) * (1 - 0.7 * descentFactor);
    if (Math.abs(vyExcess) > tol) {
      const sign = vyExcess > 0 ? 1 : -1;
      const overshoot = Math.abs(vyExcess) - tol;
      const climbFactor = Math.min(1, Math.max(0, fwdY) / 0.20);
      const tauUp = 0.02 + 0.08 * climbFactor;
      const tau = sign > 0 ? tauUp : 0.18;
      const accel = overshoot / Math.max(tau, dt);
      const groundFrac = groundedCount / vehicle.wheelInfos.length;
      const forceScale = sign > 0 ? 1 : groundFrac;
      const fY = -sign * KART_MASS * accel * forceScale;
      _coastForce.set(0, fY, 0);
      chassisBody.applyForce(_coastForce);
    }
    const speedFrac = Math.min(1, vxz / TOP_SPEED_MS);
    const groundFrac2 = groundedCount / vehicle.wheelInfos.length;
    const downG = 0.05 + 0.35 * speedFrac;
    const _q = chassisBody.quaternion;
    const upX = 2 * (_q.x * _q.y + _q.w * _q.z);
    const upY = 1 - 2 * (_q.x * _q.x + _q.z * _q.z);
    const upZ = 2 * (_q.y * _q.z - _q.w * _q.x);
    const fmag = KART_MASS * M(9.81) * downG * groundFrac2;
    _coastForce.set(-upX * fmag, -upY * fmag, -upZ * fmag);
    chassisBody.applyForce(_coastForce);
  }

  // CoM-aligned braking force.
  if (braking && !drifting && !brakeDrift && !burnout) {
    const vx = chassisBody.velocity.x;
    const vy = chassisBody.velocity.y;
    const vz = chassisBody.velocity.z;
    const vMagH = Math.hypot(vx, vz);
    const useY = grounded;
    const vMag = useY ? Math.hypot(vx, vy, vz) : vMagH;
    if (vMag > M(0.5)) {
      const brakeAccel = M(45);
      const fMag = KART_MASS * brakeAccel * Math.min(1, vMag / TOP_SPEED_MS);
      const inv = -fMag / vMag;
      _brakeForce.set(vx * inv, useY ? vy * inv : 0, vz * inv);
      chassisBody.applyForce(_brakeForce);
    }
  }

  // Burnout anti-creep.
  if (burnout && grounded) {
    chassisBody.velocity.x = 0;
    chassisBody.velocity.z = 0;
  }

  // Coast deceleration.
  if (!braking && !drifting && !brakeDrift && !burnout && !controlState.driftActive
      && controlState.boostTimer <= 0
      && Math.abs(intent) < 0.05
      && grounded) {
    const vx = chassisBody.velocity.x;
    const vy = chassisBody.velocity.y;
    const vz = chassisBody.velocity.z;
    const vMag = Math.hypot(vx, vy, vz);
    const vMagH = Math.hypot(vx, vz);
    if (vMag > M(0.05)) {
      const speedFrac = Math.min(1, vMag / TOP_SPEED_MS);
      let coastAccel = M(3.0) + M(8.0) * speedFrac;
      if (vy < -M(0.25)) {
        const grade = Math.min(1, -vy / Math.max(M(0.25), vMag));
        coastAccel += M(6.0) * grade;
      }
      if (vMagH < M(1.0)) {
        coastAccel = Math.max(coastAccel, M(12.0));
      }
      const maxAccel = vMag / Math.max(dt, 1e-3);
      const accel = Math.min(coastAccel, maxAccel);
      const fMag = KART_MASS * accel;
      const inv = -fMag / vMag;
      _coastForce.set(vx * inv, vy * inv, vz * inv);
      chassisBody.applyForce(_coastForce);
    }
  }

  // Anti-pitch stabiliser.
  if (braking && grounded) {
    const pitch = Math.asin(Math.max(-1, Math.min(1, _fwd.y)));
    chassisBody.quaternion.vmult(RIGHT_LOCAL, _right);
    _right.y = 0;
    const rl = Math.hypot(_right.x, _right.z);
    if (rl > 1e-4) {
      _right.x /= rl; _right.z /= rl;
      const wPitchRate = chassisBody.angularVelocity.x * _right.x
                       + chassisBody.angularVelocity.z * _right.z;
      const tMag = -ANTI_PITCH_TORQUE * pitch - ANTI_PITCH_DAMPING * wPitchRate;
      _antiPitchTorque.set(_right.x * tMag, 0, _right.z * tMag);
      chassisBody.torque.vadd(_antiPitchTorque, chassisBody.torque);
    }
  }

  controlState.driftHopCooldown = Math.max(0, controlState.driftHopCooldown - dt);
  let driftGrounded = false;
  for (let i = 0; i < vehicle.wheelInfos.length; i++) {
    if (vehicle.wheelInfos[i].isInContact) { driftGrounded = true; break; }
  }

  // Hop trigger.
  if (keys.drift && !controlState.lastDriftPress
      && controlState.driftHopCooldown <= 0
      && (speedAbs > M(0.5) || Math.abs(intent) > 0.05)
      && driftGrounded) {
    chassisBody.position.y += DRIFT_HOP_LIFT;
    chassisBody.velocity.y = Math.max(chassisBody.velocity.y, DRIFT_HOP_VY);
    for (let i = 0; i < vehicle.wheelInfos.length; i++) {
      vehicle.wheelInfos[i].isInContact = false;
    }
    driftGrounded = false;
    controlState.driftHopCooldown = DRIFT_HOP_COOLDOWN_S;
    controlState.driftAirborne = true;
    controlState.driftArmed = true;
    controlState.driftLandTimer = 0;
  }
  controlState.lastDriftPress = keys.drift;

  // Land detection.
  if (controlState.driftAirborne && driftGrounded) {
    controlState.driftAirborne = false;
    controlState.driftLandTimer = DRIFT_LAND_COMMIT_WINDOW_S;
  }
  if (controlState.driftLandTimer > 0) {
    controlState.driftLandTimer = Math.max(0, controlState.driftLandTimer - dt);
  }

  if (controlState.driftArmed && !keys.drift) {
    controlState.driftArmed = false;
    controlState.driftAirborne = false;
    controlState.driftLandTimer = 0;
  }

  // Drift commit.
  if (controlState.driftArmed && !controlState.driftAirborne
      && keys.drift
      && rawSteer !== 0
      && speedAbs > DRIFT_COMMIT_MIN_SPEED
      && intent > 0.1
      && driftGrounded) {
    controlState.driftActive = true;
    controlState.driftDir = rawSteer > 0 ? 1 : -1;
    controlState.driftCharge = 0;
    controlState.driftTier = 0;
    controlState.driftArmed = false;
    controlState.driftLandTimer = 0;
    controlState.driftGroundedGrace = 0.25;
  } else if (controlState.driftArmed
             && !controlState.driftAirborne
             && controlState.driftLandTimer <= 0) {
    controlState.driftArmed = false;
  }

  // Drift maintenance.
  if (controlState.driftActive) {
    if (driftGrounded) {
      controlState.driftGroundedGrace = 0.40;
    } else if ((controlState.driftGroundedGrace || 0) > 0) {
      controlState.driftGroundedGrace -= dt;
    }
    const groundedOk = driftGrounded || (controlState.driftGroundedGrace || 0) > 0;
    const vx = chassisBody.velocity.x, vz = chassisBody.velocity.z;
    const worldSpeed = Math.hypot(vx, vz);
    const minMaintain = DRIFT_COMMIT_MIN_SPEED * 0.55;
    const tooSlow = speedAbs < minMaintain && worldSpeed < minMaintain;
    const driftBreak =
      !keys.drift ||
      !groundedOk ||
      intent < DRIFT_THROTTLE_FLOOR ||
      tooSlow;
    if (driftBreak) {
      let tier = 0, dur = 0;
      if (controlState.driftCharge >= DRIFT_CHARGE_T3) { tier = 3; dur = DRIFT_BOOST_T3_S; }
      else if (controlState.driftCharge >= DRIFT_CHARGE_T2) { tier = 2; dur = DRIFT_BOOST_T2_S; }
      else if (controlState.driftCharge >= DRIFT_CHARGE_T1) { tier = 1; dur = DRIFT_BOOST_T1_S; }
      if (tier > 0 && dur > controlState.boostTimer) {
        controlState.boostTimer = dur;
        controlState.boostTier = tier;
      }
      controlState.driftJustReleasedTier = tier;
      controlState.driftActive = false;
      controlState.driftExitDir = controlState.driftDir;
      controlState.driftDir = 0;
      controlState.driftCharge = 0;
      controlState.driftTier = 0;
      const _yawCap = 0.6;
      if (chassisBody.angularVelocity.y >  _yawCap) chassisBody.angularVelocity.y =  _yawCap;
      if (chassisBody.angularVelocity.y < -_yawCap) chassisBody.angularVelocity.y = -_yawCap;
      controlState.driftExitDamp = DRIFT_EXIT_DAMP_S;
    } else {
      controlState.driftCharge += dt;
      const cc = controlState.driftCharge;
      controlState.driftTier =
        cc >= DRIFT_CHARGE_T3 ? 3 :
        cc >= DRIFT_CHARGE_T2 ? 2 :
        cc >= DRIFT_CHARGE_T1 ? 1 : 0;
      chassisBody.quaternion.vmult(RIGHT_LOCAL, _right);
      const lateralV = v.dot(_right);
      const forwardV = v.dot(_fwd);
      const sLocalCtl = Math.max(-1, Math.min(1, controlState.steer * controlState.driftDir));
      const targetMag = DRIFT_TARGET_SLIDE_BASE - sLocalCtl * DRIFT_TARGET_SLIDE_RANGE;
      const targetAngle = controlState.driftDir * Math.max(0.10, Math.min(0.85, targetMag));
      const denom = Math.max(M(5), Math.hypot(forwardV, lateralV));
      const currentAngle = Math.asin(Math.max(-1, Math.min(1, lateralV / denom)));
      const angleErr = targetAngle - currentAngle;
      const speedScale = Math.min(1, speedAbs / M(15));
      let desiredYaw = angleErr * DRIFT_YAW_RATE_SCALE * speedScale;
      if (desiredYaw >  DRIFT_MAX_YAW_RATE) desiredYaw =  DRIFT_MAX_YAW_RATE;
      if (desiredYaw < -DRIFT_MAX_YAW_RATE) desiredYaw = -DRIFT_MAX_YAW_RATE;
      const yawNow = chassisBody.angularVelocity.y;
      const yawErr = desiredYaw - yawNow;
      const overTarget = Math.abs(currentAngle) > Math.abs(targetAngle);
      const gain = overTarget ? DRIFT_YAW_ASSIST_GAIN_OVER : DRIFT_YAW_ASSIST_GAIN_UNDER;
      const blend = (1 - Math.exp(-dt / DRIFT_YAW_ASSIST_TAU_S)) * gain;
      chassisBody.angularVelocity.y = yawNow + yawErr * blend;
      if (chassisBody.angularVelocity.y >  DRIFT_MAX_YAW_RATE) chassisBody.angularVelocity.y =  DRIFT_MAX_YAW_RATE;
      if (chassisBody.angularVelocity.y < -DRIFT_MAX_YAW_RATE) chassisBody.angularVelocity.y = -DRIFT_MAX_YAW_RATE;
      const angleAbs = Math.abs(currentAngle);
      const targetAbs = Math.abs(targetAngle);
      if (angleAbs > targetAbs * 1.30) {
        const excess = (angleAbs - targetAbs * 1.30) / Math.max(0.05, targetAbs);
        const shedFrac = Math.min(0.28, excess * 0.40);
        const shed = lateralV * shedFrac;
        chassisBody.velocity.x -= shed * _right.x;
        chassisBody.velocity.z -= shed * _right.z;
      }
    }
  } else {
    controlState.driftJustReleasedTier = 0;
  }

  // Post-drift exit damp.
  if ((controlState.driftExitDamp || 0) > 0 && !controlState.driftActive) {
    controlState.driftExitDamp = Math.max(0, controlState.driftExitDamp - dt);
    if (controlState.driftExitDamp <= 0) controlState.driftExitDir = 0;
    let exitGrounded = false;
    for (let i = 0; i < vehicle.wheelInfos.length; i++) {
      if (vehicle.wheelInfos[i].isInContact) { exitGrounded = true; break; }
    }
    if (exitGrounded) {
      const yawDecay = 1 - Math.exp(-dt / DRIFT_EXIT_YAW_TAU_S);
      chassisBody.angularVelocity.y *= (1 - yawDecay);
      const rollDecay = 1 - Math.exp(-dt / 0.06);
      chassisBody.angularVelocity.x *= (1 - rollDecay);
      chassisBody.angularVelocity.z *= (1 - rollDecay);
      const _rollCap = 0.8;
      if (chassisBody.angularVelocity.x >  _rollCap) chassisBody.angularVelocity.x =  _rollCap;
      if (chassisBody.angularVelocity.x < -_rollCap) chassisBody.angularVelocity.x = -_rollCap;
      if (chassisBody.angularVelocity.z >  _rollCap) chassisBody.angularVelocity.z =  _rollCap;
      if (chassisBody.angularVelocity.z < -_rollCap) chassisBody.angularVelocity.z = -_rollCap;
      const _yawSettle = controlState.driftExitDamp / DRIFT_EXIT_DAMP_S;
      const _yawCapExit = 1.2 + (1 - _yawSettle) * 1.8;
      if (chassisBody.angularVelocity.y >  _yawCapExit) chassisBody.angularVelocity.y =  _yawCapExit;
      if (chassisBody.angularVelocity.y < -_yawCapExit) chassisBody.angularVelocity.y = -_yawCapExit;
      const _q = chassisBody.quaternion;
      const _bx = 2*(_q.x*_q.y + _q.w*_q.z);
      const _by = 1 - 2*(_q.x*_q.x + _q.z*_q.z);
      const _bz = 2*(_q.y*_q.z - _q.w*_q.x);
      if (_by < 0.97) {
        const _kUp = M(2200);
        _boostPoint.set(-_bz * _kUp, 0, _bx * _kUp);
        chassisBody.applyTorque(_boostPoint);
      }
      chassisBody.quaternion.vmult(RIGHT_LOCAL, _right);
      const lateralVexit = chassisBody.velocity.x * _right.x + chassisBody.velocity.z * _right.z;
      const latDecay = 1 - Math.exp(-dt / DRIFT_EXIT_LAT_TAU_S);
      const shedExit = lateralVexit * latDecay;
      chassisBody.velocity.x -= shedExit * _right.x;
      chassisBody.velocity.z -= shedExit * _right.z;
    }
  }

  // Mini-turbo boost integration.
  if (controlState.boostTimer > 0) {
    controlState.boostTimer = Math.max(0, controlState.boostTimer - dt);
    if (driftGrounded) {
      const tierScale =
        controlState.boostTier >= 3 ? 1.40 :
        controlState.boostTier >= 2 ? 1.10 : 0.85;
      const damp = controlState.driftExitDamp || 0;
      const ramp = damp > 0 ? Math.max(0, 1 - (damp / DRIFT_EXIT_DAMP_S)) : 1;
      const fmag = -DRIFT_BOOST_FORCE * tierScale * ramp;
      _driftImpulse.set(_fwd.x * fmag, 0, _fwd.z * fmag);
      _boostPoint.set(
        chassisBody.position.x,
        chassisBody.position.y - M(0.45),
        chassisBody.position.z,
      );
      chassisBody.applyForce(_driftImpulse, _boostPoint);
    }
    if (controlState.boostTimer <= 0) {
      controlState.boostTier = 0;
    }
  }

  // ── Burnout charge / release / boost ────────────────────────────
  // Mirrors the SP play-main client mechanic so online karts have the
  // same charge meter, release-boost reward, and overheat-explosion
  // beat. Inputs read from the post-lockout `keys` so a blown engine
  // can't accumulate charge.
  const _wForBurnout = !!keys.w;
  const _spaceForBurnout = !!keys.space;
  const _stationary = Math.abs(speedFwd) < M(2.5);
  const _chargingNow =
    _spaceForBurnout && _wForBurnout && _stationary
    && !drifting && !controlState.driftActive
    && !exploded;
  controlState.chargingBurnout = _chargingNow;
  if (_chargingNow) {
    controlState.burnoutCharge = (controlState.burnoutCharge || 0) + dt;
    if (controlState.burnoutCharge >= BURNOUT_OVERHEAT_S) {
      controlState.engineExplodedUntilMs = nowMs + ENGINE_LOCKOUT_S * 1000;
      controlState.burnoutCharge = 0;
      controlState.gloBurnoutT = 0;
    }
  } else if ((controlState.burnoutCharge || 0) > 0
             && !_spaceForBurnout && controlState.burnoutPrevSpace) {
    if (controlState.burnoutCharge >= BURNOUT_CHARGE_MIN_S && _wForBurnout && !exploded) {
      const t = Math.min(1, controlState.burnoutCharge / BURNOUT_OVERHEAT_S);
      controlState.gloBurnoutT = BURNOUT_BOOST_DURATION_S
        + (BURNOUT_BOOST_DURATION_MAX_S - BURNOUT_BOOST_DURATION_S) * t;
    }
    controlState.burnoutCharge = 0;
  } else if (!_spaceForBurnout) {
    controlState.burnoutCharge = Math.max(0, (controlState.burnoutCharge || 0) - dt * 2);
  }
  controlState.burnoutPrevSpace = _spaceForBurnout;

  // Burnout boost decay. SP playtest does NOT apply a body force during
  // the gloBurnoutT window — the boost effect is purely "release brake
  // from a stop with full throttle held", letting the engine accelerate
  // the kart from rest. The previous MP-only `chassisBody.applyForce`
  // call here used `_fwd * -BURNOUT_BOOST_FORCE`, which is a WORLD-space
  // backward force (since `_fwd` is the chassis forward direction — see
  // `speedFwd = v.dot(_fwd)`). That backward push fought the engine and
  // produced the "glitches out" symptom (weak, juddery acceleration on
  // release). We still tick gloBurnoutT down here so the visual trail
  // (KartFxRig) and the broadcast `gloBurnoutT` schema field decay at
  // the same rate the SP play-main client decays it.
  if ((controlState.gloBurnoutT || 0) > 0) {
    controlState.gloBurnoutT = Math.max(0, controlState.gloBurnoutT - dt);
  }
}

/**
 * Convert a multiplayer `{throttle, brake, steer}` input message into
 * the `keys` object the physics core consumes. Splits a continuous
 * steer axis into A/D and lets clients drive throttle / brake without
 * needing a full keyboard model on the server.
 */
export function inputsToKeys(input) {
  // Throttle is SIGNED in [-1, 1]: positive = forward (W), negative =
  // reverse (S). Brake is unsigned in [0, 1] = Space. This mirrors SP
  // playtest where reverse is its own gear, not a brake; without this
  // mapping karts had no way to back out of a wall.
  const t = Math.max(-1, Math.min(1, Number(input?.throttle) || 0));
  const b = Math.max(0, Math.min(1, Number(input?.brake) || 0));
  const s = Math.max(-1, Math.min(1, Number(input?.steer) || 0));
  return {
    w: t > 0.01,
    s: t < -0.01,
    a: s < -0.05,
    d: s > 0.05,
    space: b > 0.5,
    drift: !!input?.drift,
  };
}
