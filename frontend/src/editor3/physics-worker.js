/**
 * physics-worker.js — Off-main-thread cannon-es runtime.
 *
 * Runs the entire CANNON.World, RaycastVehicle, and per-step control
 * resolution on a Web Worker so the rAF callback on main stays
 * uniformly cheap (no bimodal physics-substep cost in the render
 * frame).
 *
 * Static colliders (segment bodies, decor bodies, ground plane) arrive
 * as PORTABLE DESCRIPTORS from main — the worker has no THREE/decor/
 * segment-builder dependencies. This keeps the worker bundle small
 * and avoids module-load failures when transitive imports touch
 * `document` (which doesn't exist in a worker context).
 *
 * Body descriptor schema:
 *   {
 *     mass: 0,
 *     pos: [x,y,z], quat: [x,y,z,w],
 *     shapes: [
 *       { type: 'box', halfExtents:[hx,hy,hz], offset:[ox,oy,oz], quat:[x,y,z,w] },
 *       ...
 *     ],
 *   }
 */

import * as CANNON from 'cannon-es';
import { m as M } from './units.js';

// ── State ────────────────────────────────────────────────────
let world = null;
let chassisBody = null;
let vehicle = null;
let groundMat = null;
let spawnPos = { x: 0, y: M(1.5), z: 0 };
let spawnRot = 0;
let drivableCells = null;
let TILE_LOCAL = 0;
let physicsSubsteps = 3;
let stepInterval = null;
let paused = false;
let lastTickTime = 0;

const keys = { w: false, a: false, s: false, d: false, space: false, drift: false };
const playerCombat = { boostMult: 1, slowMult: 1, oilNow: false };
const controlState = {
  steer: 0,
  throttle: 0,
  driftHopCooldown: 0,
  lastDriftPress: false,
  // ── Drift state machine (mirrored to main via snapshot) ──
  driftArmed: false,         // true between shift press and commit/expire
  driftAirborne: false,      // true while the kart is in the hop arc
  driftLandTimer: 0,         // seconds remaining in post-land grace window
  driftCommitTimer: 0,       // legacy field, kept for snapshot compatibility
  driftGroundedGrace: 0,     // post-commit suspension-bounce forgiveness
  driftActive: false,        // true while the kart is in a committed drift
  driftDir: 0,               // -1 (left) or +1 (right) lock when drift commits
  driftCharge: 0,            // seconds of accumulated drift
  driftTier: 0,              // 0/1/2/3 — visual stage for HUD + GLO flash
  boostTimer: 0,             // remaining seconds of awarded post-drift boost
  boostTier: 0,              // tier of the active boost (drives strength)
  driftJustReleasedTier: 0,  // one-shot signal for main: tier awarded this step
  driftExitDamp: 0,          // post-exit settle window (s); decays yaw + lateral
  driftExitDir: 0,           // sign of the just-ended drift; used to fade out the
                             // drift-shaped steering bias smoothly across the exit
                             // window so releasing Shift doesn't snap the wheels
                             // hard the other way (esp. mid-countersteer).
};
const lastSafe = { has: false, x: 0, y: 0, z: 0, yaw: 0 };

// ── Rewind ring buffer ──────────────────────────────────────────────
// Cheap 10-second rewind. We sample chassis pose+velocity at 30 Hz
// (every other physics tick) into a flat Float32Array ring. 13 floats
// per snapshot × 300 snapshots ≈ 16 KB total. Restoring just copies the
// oldest entry into the body and clears the inputs/control state so the
// kart resumes from the prior moving state.
const REWIND_HZ = 30;
const REWIND_SECONDS = 10;
const REWIND_CAP = REWIND_HZ * REWIND_SECONDS; // 300
const REWIND_STRIDE = 13; // px,py,pz, qx,qy,qz,qw, vx,vy,vz, wx,wy,wz
const rewindBuf = new Float32Array(REWIND_CAP * REWIND_STRIDE);
let rewindHead = 0;       // next write index (0..REWIND_CAP-1)
let rewindCount = 0;      // number of valid samples (saturates at REWIND_CAP)
let rewindTickCounter = 0; // physics ticks since last sample
const REWIND_TICK_INTERVAL = 2; // 60 Hz / 2 = 30 Hz

// Tunables — arcade feel pass (May 2026).
// Tuned for the TILE=36 arena/battle layout: bigger tracks need more pace,
// and combat play wants snappy turn-in, fast throttle response, and a
// very light grip envelope so spinouts feel earned rather than mushy.
const KART_MASS = 150;
const CHASSIS_HX = M(0.6), CHASSIS_HY = M(0.3), CHASSIS_HZ = M(1.0);
const WHEEL_RADIUS = M(0.4);
// Engine — trimmed from 2200 to curb the torque-reaction wheelie (force
// is applied at wheel contact, well below CoM; too much torque pitches
// the nose up on launch). The top-speed governor still produces the same
// arcade pace, just without the launch wheelie.
const MAX_ENGINE = M(1700);
const REVERSE_ENGINE = M(800);
// Brake force was tuned down from M(45) → M(28) and the front/rear
// distribution flipped (now front-heavy, like a real car) so a hard
// brake at speed decelerates the kart instead of locking the rear and
// pitching the nose forward end-over-end.
const MAX_BRAKE = M(28);
// REAR brake bias — fraction of MAX_BRAKE applied to the rear axle.
// < 1 means the rears get LESS brake than the fronts, which is the
// stable configuration: fronts absorb the decel without rear lockup.
// During a brake-drift (braking + steering at speed) the rears drop
// even further so they slide while the fronts still bite for steering.
const BRAKE_REAR_BIAS = 0.55;
const BRAKE_REAR_BIAS_DRIFT = 0.20;
const HANDBRAKE_FORCE = M(110);
// Anti-pitch: while braking with the wheels on the ground, apply a
// strong corrective torque proportional to the chassis pitch angle so
// the nose can't slowly tip past ~25°. Bumped from M(7000) → M(13000)
// because the old gain was insufficient to catch a hard brake at top
// speed (kart would tip forward and flip end-over-end before the
// torque caught up). Damping tracks the increase to keep the response
// critically damped.
const ANTI_PITCH_TORQUE = M(13000);
const ANTI_PITCH_DAMPING = M(4000);
// Top speed bumped 38 → 52 m/s (~187 km/h) so the speed sensation on
// 36 m tiles matches what 38 m/s felt like on 18 m tiles.
const TOP_SPEED_MS = M(52);
// Steering lock: a touch sharper at low speed for tight chicanes,
// looser at top speed so we don't snap into the wall. Tuned down from
// 0.70 — the previous value made turn-in feel "grabby" / abrupt at
// medium speed.
const STEER_LOCK_LOW = 0.58;
const STEER_LOCK_HIGH = 0.20;
// Steer ramps — eased from 11/18 so flick inputs build a smooth arc
// instead of snapping the wheels to lock instantly. Out > in so the
// wheels still recenter snappily when the player lets go.
const STEER_RAMP_IN_PER_S = 7.5;
const STEER_RAMP_OUT_PER_S = 14.0;
// Drift hop: short, snappy pop so the player can chain hop → land →
// turn into a slide in well under half a second. Previously the hop
// set velocity.y AND added an upward impulse on top, which roughly
// ── Hop / launch tunables ────────────────────────────────────────
// OutRun feel: hop is a quick, low pop — visible enough to read as a
// distinct "shift gear" gesture, but short enough that the player
// doesn't lose contact with the road for long. Air time ≈ 0.6 s, much
// shorter than the previous 1.3 s ballistic arc which felt like the
// kart was floating before the slide.
//
// Three-step trick still applies (snap-lift, upward velocity, force
// wheels out of contact) so the suspension can't immediately re-glue
// the chassis to the ground.
const DRIFT_HOP_VY = M(3.8);          // upward velocity at hop press (was 6.5)
const DRIFT_HOP_LIFT = M(0.30);       // immediate chassis Y lift (was 0.55)
const DRIFT_HOP_COOLDOWN_S = 0.40;    // re-press hop after this
// Land-commit grace: kept generous so a late steer tap right at
// landing still commits the slide. Bumped from 0.18 → 0.30 so a
// player who slightly mistimes the steer on touchdown still gets a
// drift instead of a free hop — a major source of "why didn't I
// drift?" inconsistency in the previous build.
const DRIFT_LAND_COMMIT_WINDOW_S = 0.30;
// ── OutRun-style power-slide tunables ─────────────────────────
// The drift state machine commits when the kart LANDS from a drift hop
// while the player is still holding shift+steer. Once committed, a
// closed-loop PD controller (see DRIFT_YAW_KP/KD below) holds the
// chassis at a TARGET SLIDE ANGLE that the player can modulate with
// steer — widen by countersteering, tighten by steering further into
// the turn. Rear grip is reduced (but not eliminated) so the slide
// looks fluid rather than ice-skate-y.
const DRIFT_COMMIT_MIN_SPEED = M(4.0);   // need to be moving before drift commits
const DRIFT_REAR_GRIP = 0.12;            // rear wheels slide out very loosely once committed —
                                          // this is the "loose feel" of the slide. Dropped
                                          // from 0.20 → 0.12 for an even looser back end on
                                          // hop+turn drift entry. The yaw assist + lateral-
                                          // velocity shedding below keep the slide angle
                                          // bounded so it stays controllable rather than
                                          // snapping into a spin.
const DRIFT_FRONT_GRIP = 3.0;            // front grip during drift
const DRIFT_STEER_BIAS = 0.12;           // baked-in inward steer (small — avoids commit whip)
const DRIFT_STEER_INPUT_GAIN = 0.30;     // player steer modulates wheel angle
// Yaw-rate ASSIST. Wheels do most of the rotating; this nudges the
// chassis yaw rate toward what would maintain the desired slide angle.
// ASYMMETRIC: gentle pull when under-rotating, AGGRESSIVE brake when
// over-rotating past the target. This is what stops a commit transient
// from spinning the kart out before the slide settles.
const DRIFT_YAW_ASSIST_GAIN_UNDER = 0.50; // gentle when below target slide angle
const DRIFT_YAW_ASSIST_GAIN_OVER  = 1.60; // strong when above target (anti-spin / lock)
const DRIFT_YAW_ASSIST_TAU_S = 0.12;     // smoothing window for the additive correction
const DRIFT_YAW_RATE_SCALE = 2.4;        // converts angle-error (rad) → desired yaw-rate (rad/s)
const DRIFT_MAX_YAW_RATE = 1.75;         // hard cap on chassis yaw-rate during drift (rad/s)
                                          // — enforced as a clamp on angularVelocity.y so a
                                          // wheel-force runaway can never spin the kart out.
const DRIFT_TARGET_SLIDE_BASE = 0.46;    // baseline slide angle (~26°)
const DRIFT_TARGET_SLIDE_RANGE = 0.24;   // ± player modulation around base (~14°)
const DRIFT_THROTTLE_FLOOR = 0.05;       // drift cancels if throttle drops below (was 0.15)
// Post-drift exit damping. When the drift breaks the chassis can be holding
// up to DRIFT_MAX_YAW_RATE rad/s of yaw and big lateral velocity. Without
// help the kart keeps rotating ('tornado spin') until normal angular damping
// bleeds it off, which at low forward speed is far too slow. Decay both yaw
// and lateral velocity over a short window after exit so the kart settles.
const DRIFT_EXIT_DAMP_S    = 1.80;       // length of post-drift settle window (covers full boost duration)
const DRIFT_EXIT_YAW_TAU_S = 0.10;       // exponential time-constant for yaw decay
const DRIFT_EXIT_LAT_TAU_S = 0.18;       // exponential time-constant for lateral-V decay
const DRIFT_CHARGE_T1 = 0.85;            // blue   threshold (s)
const DRIFT_CHARGE_T2 = 1.85;            // orange threshold (s)
const DRIFT_CHARGE_T3 = 3.20;            // purple threshold (s)
const DRIFT_BOOST_T1_S = 0.55;           // blue   boost duration
const DRIFT_BOOST_T2_S = 1.05;           // orange boost duration
const DRIFT_BOOST_T3_S = 1.60;           // purple boost duration
const DRIFT_BOOST_FORCE = M(2400);       // forward impulse force during boost (N)
const DRIFT_BOOST_TOPSPEED_MUL = 1.28;   // raises governor cap during boost
// Linear damping bleeds residual sideways drift so the kart settles
// quickly after correction inputs. Angular damping prevents post-spin
// wobble. Both run on the chassis body each step.
const KART_LINEAR_DAMPING = 0.06;
const KART_ANGULAR_DAMPING = 0.55;
// Grip baseline; raised from 3.0 to plant the kart in corners. The drift
// system will dial this back to ~60% of grip when handbrake is engaged.
const TYRE_GRIP = 4.6;
const TYRE_GRIP_DRIFT = 2.3;

// Scratch.
const FORWARD_LOCAL = new CANNON.Vec3(0, 0, 1);
const RIGHT_LOCAL = new CANNON.Vec3(1, 0, 0);
const _fwd = new CANNON.Vec3();
const _right = new CANNON.Vec3();
const _antiPitchTorque = new CANNON.Vec3();
const _brakeForce = new CANNON.Vec3();
const _coastForce = new CANNON.Vec3();
const _driftImpulse = new CANNON.Vec3();
const _boostPoint   = new CANNON.Vec3();
const _driftPoint = new CANNON.Vec3(0, 0, 0);
const _yawAxis = new CANNON.Vec3(0, 1, 0);

function bodyFromDescriptor(d, material) {
  const body = new CANNON.Body({
    mass: d.mass || 0,
    material,
    type: d.mass ? CANNON.Body.DYNAMIC : CANNON.Body.STATIC,
  });
  if (d.pos) body.position.set(d.pos[0], d.pos[1], d.pos[2]);
  if (d.quat) body.quaternion.set(d.quat[0], d.quat[1], d.quat[2], d.quat[3]);
  for (const s of d.shapes) {
    const offset = s.offset
      ? new CANNON.Vec3(s.offset[0], s.offset[1], s.offset[2])
      : new CANNON.Vec3(0, 0, 0);
    const quat = s.quat
      ? new CANNON.Quaternion(s.quat[0], s.quat[1], s.quat[2], s.quat[3])
      : new CANNON.Quaternion();
    if (s.type === 'box') {
      body.addShape(
        new CANNON.Box(new CANNON.Vec3(s.halfExtents[0], s.halfExtents[1], s.halfExtents[2])),
        offset, quat,
      );
    } else if (s.type === 'plane') {
      body.addShape(new CANNON.Plane(), offset, quat);
    } else if (s.type === 'trimesh') {
      // Vertices/indices arrive as plain Arrays (cloned across the
      // worker boundary). cannon-es Trimesh accepts Number[] | TypedArray.
      body.addShape(new CANNON.Trimesh(s.vertices, s.indices), offset, quat);
    }
  }
  return body;
}

function initWorld(msg) {
  TILE_LOCAL = msg.tile || 0;
  drivableCells = new Set(msg.drivableCells || []);

  world = new CANNON.World({ gravity: new CANNON.Vec3(0, -M(25), 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  world.defaultContactMaterial.friction = 0.4;

  groundMat = new CANNON.Material('ground');
  const wheelMat = new CANNON.Material('wheel');
  world.addContactMaterial(new CANNON.ContactMaterial(groundMat, wheelMat, {
    friction: 0.65, restitution: 0.05,
  }));

  // Ground plane is well-known; built here, not shipped.
  const groundBody = new CANNON.Body({ mass: 0, material: groundMat, shape: new CANNON.Plane() });
  groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
  world.addBody(groundBody);

  if (Array.isArray(msg.staticBodies)) {
    for (const d of msg.staticBodies) {
      world.addBody(bodyFromDescriptor(d, groundMat));
    }
  }

  spawnPos = { ...msg.spawnPos };
  spawnRot = msg.spawnRot || 0;

  const chassisShape = new CANNON.Box(new CANNON.Vec3(CHASSIS_HX, CHASSIS_HY, CHASSIS_HZ));
  chassisBody = new CANNON.Body({ mass: KART_MASS });
  chassisBody.addShape(chassisShape);
  chassisBody.position.set(spawnPos.x, spawnPos.y, spawnPos.z);
  chassisBody.quaternion.setFromAxisAngle(_yawAxis, spawnRot);
  // Damping bleeds residual lateral velocity / yaw wobble so corrections
  // settle quickly — key for arcade-feel responsiveness.
  chassisBody.linearDamping = KART_LINEAR_DAMPING;
  chassisBody.angularDamping = KART_ANGULAR_DAMPING;
  world.addBody(chassisBody);

  vehicle = new CANNON.RaycastVehicle({
    chassisBody, indexRightAxis: 0, indexUpAxis: 1, indexForwardAxis: 2,
  });
  // Suspension tuning (May 2026 incline/decline pass + revised after
  // "bouncing up inclines" report).
  //   • Stiffness 70 was too snappy at slope-base transitions — the front
  //     wheels hit the rising slope at high vertical velocity and the stiff
  //     spring transferred that into the chassis before the rears caught up,
  //     popping the kart up off the road. 60 keeps the chassis tighter than
  //     the original 55 baseline but soft enough to absorb the impact.
  //   • dampingCompression 5.6 → 4.6: less harsh impact damping so the spring
  //     can swallow the slope-base hit instead of slamming the chassis upward.
  //   • dampingRelaxation 4.4 (kept) — fast rebound is what keeps the wheel
  //     pressed back into the road on declines.
  //   • maxSuspensionTravel M(0.45) (kept) — droop headroom for crests.
  //   • The active anti-lift / down-stick term in applyControls (search for
  //     "ground-stick") is what actually keeps the chassis planted on uphill
  //     transitions; suspension just has to absorb the bumps.
  const wheelOptions = {
    radius: WHEEL_RADIUS,
    directionLocal: new CANNON.Vec3(0, -1, 0),
    suspensionStiffness: 60,
    suspensionRestLength: M(0.3),
    frictionSlip: TYRE_GRIP,
    dampingRelaxation: 4.4,
    dampingCompression: 4.6,
    maxSuspensionForce: M(150000),
    rollInfluence: 0.012,
    axleLocal: new CANNON.Vec3(-1, 0, 0),
    chassisConnectionPointLocal: new CANNON.Vec3(),
    maxSuspensionTravel: M(0.45),
    customSlidingRotationalSpeed: -30,
    useCustomSlidingRotationalSpeed: true,
  };
  const WX = CHASSIS_HX + M(0.05);
  const WZ = CHASSIS_HZ * 0.75;
  const WY = -CHASSIS_HY * 0.5;
  for (const p of [[-WX, WY, -WZ], [WX, WY, -WZ], [-WX, WY, WZ], [WX, WY, WZ]]) {
    wheelOptions.chassisConnectionPointLocal.set(p[0], p[1], p[2]);
    vehicle.addWheel(wheelOptions);
  }
  vehicle.addToWorld(world);

  if (typeof msg.physicsSubsteps === 'number') physicsSubsteps = msg.physicsSubsteps;
}

function applyControls(dt) {
  const rawAccel = (keys.w ? 1 : 0) + (keys.s ? -1 : 0);
  const rawSteer = (keys.a ? 1 : 0) + (keys.d ? -1 : 0);
  const braking = keys.space;
  // Note: legacy handbrake-drift (shift+space) is preserved below for
  // power-slides on straights; the new committed drift below is the
  // primary Mario-Kart-style mechanic, gated behind hop+steer-on-land.
  const drifting = keys.drift && Math.abs(controlState.throttle) > 0.1;

  const throttleTarget = rawAccel;
  // Asymmetric ramp: a brief easing on press (so torque arrives over ~150ms
  // instead of as an instantaneous slap that pitches the nose up), much
  // faster bleed on release for arcade snap.
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
  // Top-speed governor: when forward-aligned speed exceeds the cap, taper
  // engine force to zero so the kart asymptotes instead of accelerating
  // forever. Boost pickups raise the cap via `mult`.
  // Drift mini-turbo also raises the cap while a boost is active so the
  // tier 1/2/3 reward actually reads as additional top-end speed and not
  // just a brief surge that hits the governor.
  const driftBoostMul = controlState.boostTimer > 0 ? DRIFT_BOOST_TOPSPEED_MUL : 1;
  const speedCap = TOP_SPEED_MS * mult * driftBoostMul;
  const overspeed = (intent > 0 && speedFwd > speedCap * 0.92)
    ? Math.max(0, 1 - (speedFwd - speedCap * 0.92) / (speedCap * 0.18))
    : 1;
  const engineMag = intent * (intent >= 0 ? MAX_ENGINE : REVERSE_ENGINE) * mult * overspeed;
  const force = -engineMag;

  const steerLock = STEER_LOCK_LOW + (STEER_LOCK_HIGH - STEER_LOCK_LOW) * speedRatio;
  const steerSign = (speedFwd < -M(0.5)) ? -1 : 1;
  const oilJitter = playerCombat.oilNow ? (Math.random() * 2 - 1) * 0.4 : 0;
  // Steering routing.
  //   Default     : raw player steer
  //   Drift active: rotate the input around the drift direction so a
  //                 fully-locked outside steer (against the drift)
  //                 widens the slide and a fully-locked inside steer
  //                 (with the drift) tightens it. The constant inward
  //                 bias keeps the front noses pointed into the corner
  //                 even on neutral input — reads as a Mario Kart slide.
  let steerInput = controlState.steer;
  if (controlState.driftActive) {
    const dd = controlState.driftDir;
    // Map raw steer (-1..+1) to (dd*0.30 .. dd*1.0) so even outside
    // steer keeps SOME inward bias — the kart can't unwind into a
    // straight line during the slide.
    const sLocal = Math.max(-1, Math.min(1, controlState.steer * dd));
    const blended = DRIFT_STEER_BIAS + sLocal * DRIFT_STEER_INPUT_GAIN;
    steerInput = dd * Math.max(0.15, Math.min(1.0, blended));
  } else if ((controlState.driftExitDamp || 0) > 0 && controlState.driftExitDir) {
    // Drift just released. The drift-active branch above remapped the
    // player's raw steer through `dd * f(steer)` so the wheels were
    // always biased toward the slide direction. The instant the drift
    // breaks that mapping disappears — if the player was countersteering
    // to widen the slide, the steering value sent to the wheels jumps
    // from a gentle inward bias to a hard outward lock in one tick,
    // which reads as the kart "snapping in the opposite direction."
    // Fade the drift-shaped value back toward raw input across the
    // existing exit-damp window so the transition is continuous.
    const dd = controlState.driftExitDir;
    const sLocal = Math.max(-1, Math.min(1, controlState.steer * dd));
    const blended = DRIFT_STEER_BIAS + sLocal * DRIFT_STEER_INPUT_GAIN;
    const driftShaped = dd * Math.max(0.15, Math.min(1.0, blended));
    // Blend factor t: 1 at the moment of release, 0 when the exit-damp
    // window expires. Quadratic so the bias mostly clears in the first
    // half of the window (where the snap risk is highest) and the
    // back half is essentially raw player input.
    const tNorm = controlState.driftExitDamp / DRIFT_EXIT_DAMP_S; // 1 → 0
    const k = Math.max(0, Math.min(1, tNorm * tNorm));
    steerInput = driftShaped * k + controlState.steer * (1 - k);
  }
  const steerCmd = (steerInput * steerSign + oilJitter) * steerLock;
  vehicle.setSteeringValue(steerCmd, 2);
  vehicle.setSteeringValue(steerCmd, 3);

  // Drive layout: front-wheel drive (wheels 2 & 3 are the +Z front pair).
  // Engine force at the FRONT contact patches creates a torque about the
  // CoM that pitches the nose DOWN — the opposite of a rear-wheel-drive
  // wheelie. We still feed a small fraction (~25%) to the rear so very
  // low-friction surfaces don't lose forward bite when the front wheels
  // slip during a turn.
  //
  // Burnout suppression: when braking + throttle is held nearly stationary
  // (the burnout condition computed below), the 25% rear assist would
  // push the chassis forward against the handbrake-locked rears at far
  // more force than HANDBRAKE_FORCE can resist (~425k vs 110k), causing
  // the kart to creep at ~0.8 m/s instead of staying stationary like a
  // real burnout. Detect the burnout state here and zero the rear assist
  // so the rears are pure brake; fronts still get full engine torque so
  // the powered (low-friction during burnout) front wheels can scream.
  const _isBurnoutPre = braking
    && controlState.throttle > 0.1
    && Math.abs(speedFwd) < M(2.5)
    && !drifting
    && !controlState.driftActive;
  // Engine force split. During burnout we ALSO scale down the front
  // drive: the powered fronts only need a small torque to keep the
  // wheel models visibly spinning + drive engine RPM/audio — full
  // MAX_ENGINE force at the front contact patches, even with the
  // burnout-low friction (0.128) override below, still scrubs ~0.35
  // m/s of forward chassis motion per physics tick. A 8% scale keeps
  // the wheels spinning fast enough to feel like a real burnout while
  // dropping the per-tick push to a level the v=0 damper can fully
  // absorb (sub-cm net motion over multi-second holds).
  const burnoutFrontScale = _isBurnoutPre ? 0.08 : 1.0;
  const frontDrive = force * burnoutFrontScale;
  const rearAssist = _isBurnoutPre ? 0 : force * 0.25;
  vehicle.applyEngineForce(rearAssist, 0);
  vehicle.applyEngineForce(rearAssist, 1);
  vehicle.applyEngineForce(frontDrive, 2);
  vehicle.applyEngineForce(frontDrive, 3);

  // Tyre grip: cut to drift values when the player is on the handbrake
  // with active throttle, restoring full grip the rest of the time.
  // Committed drift takes priority: rear wheels (0,1) lose serious bite,
  // front wheels (2,3) keep enough grip for steering authority. This
  // asymmetric grip is what makes the slide feel controllable instead
  // of a slick spin.
  // BRAKE-DRIFT: braking at speed with steering input also drops the
  // rear grip, so a hard "tap brake into the corner" enters a slide
  // instead of plowing straight. Speed gate (>8 m/s forward) prevents
  // it kicking in during low-speed parking maneuvers.
  const brakeDrift = braking
                  && speedFwd > M(8)
                  && Math.abs(controlState.steer) > 0.25
                  && !drifting
                  && !controlState.driftActive;
  // BURNOUT: brake + throttle held while nearly stationary. With a
  // FWD layout we want the REARS locked while the FRONTS are powered
  // — that's the "fighting itself" sensation that lets the rear
  // tyres scream and the burnout-charge timer in main accumulate.
  // The 2.5 m/s cap matches `play-main`'s `|fwdSpeed| < M(2.5)` gate
  // for charge accumulation; above that we drop out into normal
  // braking / brake-drift handling.
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
    // Stationary burnout (FWD layout): we want the chassis to STAY
    // STILL while the powered front wheels scream and scrub. To do
    // that the friction split is inverted vs a normal drive:
    //   • Front wheels: very low friction so the engine torque
    //     spins them freely without producing forward thrust at the
    //     contact patch — looks/sounds like wheels lighting up.
    //   • Rear wheels:  full grip, combined with the rear handbrake
    //     lock, so the kart is actually anchored to the ground and
    //     doesn't creep forward.
    // Previously both ends were dropped to DRIFT_REAR_GRIP, which let
    // the powered fronts overpower the slipping rears and the kart
    // crept forward at ~0.8 m/s — the burnout still "worked" (charge
    // accumulated, boost fired on release) but it didn't *feel*
    // stationary, which is the whole point of the move.
    vehicle.wheelInfos[0].frictionSlip = TYRE_GRIP;
    vehicle.wheelInfos[1].frictionSlip = TYRE_GRIP;
    vehicle.wheelInfos[2].frictionSlip = DRIFT_REAR_GRIP * 0.40;
    vehicle.wheelInfos[3].frictionSlip = DRIFT_REAR_GRIP * 0.40;
  } else if ((controlState.driftExitDamp || 0) > 0) {
    // Smoothly restore rear grip across the exit-damp window so the rears
    // don't suddenly bite while the chassis is still sliding sideways.
    const restoreT = 1 - (controlState.driftExitDamp / DRIFT_EXIT_DAMP_S);
    const eased = restoreT * restoreT; // ease-in: hold low grip then ramp up
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

  // Brake distribution. Normal braking is now applied as a horizontal
  // damping FORCE at the centre of mass (see chassisBody.applyForce
  // below) — this produces zero pitching moment and makes it
  // impossible to flip the kart by hard braking at speed. We still
  // apply a tiny amount of wheel-level brake (≈15% of MAX_BRAKE) so
  // the wheel friction model has something to lock onto and the tyres
  // visibly stop spinning, which keeps the SKID particles + audio
  // cues firing. Handbrake-drift and brake-drift continue to use real
  // wheel brakes because we WANT the rear lockup for sliding.
  let brakeFront = braking ? MAX_BRAKE * 0.15 : 0;
  let brakeRear  = braking ? MAX_BRAKE * 0.15 * BRAKE_REAR_BIAS : 0;
  if (brakeDrift) {
    // Brake-drift: full front brake for scrubbing speed + steering bite,
    // very light rear brake so rears can break loose and slide.
    brakeFront = MAX_BRAKE;
    brakeRear  = MAX_BRAKE * BRAKE_REAR_BIAS_DRIFT;
  }
  if (burnout) {
    // Burnout: lock the rears HARD against the powered fronts so the
    // kart sits roughly still while the rear tyres scream. No front
    // brake — the front wheels need to be free to spin under engine
    // torque so the FWD throttle stays effective.
    brakeFront = 0;
    brakeRear  = HANDBRAKE_FORCE;
  }
  if (drifting && braking) brakeRear = HANDBRAKE_FORCE;
  vehicle.setBrake(brakeRear, 0);
  vehicle.setBrake(brakeRear, 1);
  vehicle.setBrake(brakeFront, 2);
  vehicle.setBrake(brakeFront, 3);

  // Detect grounded contact ONCE per frame — used by the brake force,
  // the coast deceleration, and the anti-pitch stabiliser below.
  let grounded = false;
  let groundedCount = 0;
  for (let i = 0; i < vehicle.wheelInfos.length; i++) {
    if (vehicle.wheelInfos[i].isInContact) { grounded = true; groundedCount++; }
  }

  // ── Slope-aware ground stick ──────────────────────────────────────
  // Goal: keep all four wheels planted across upward and downward slope
  // transitions WITHOUT fighting the legitimate vertical velocity that
  // climbing/descending naturally produces.
  //
  // Background: a previous attempt clamped chassis vy to 0.4 m/s whenever
  // grounded. On a 16.7° slope at 40 m/s, the *correct* vy ≈ 11.5 m/s,
  // so that clamp pinned the chassis flat while the road climbed under
  // it (over-compressing the suspension); when the deck flattened all the
  // stored energy released and the chassis launched off the descending
  // offramp at ~25 m/s of freefall. Bridge traversal probe confirmed
  // 38 bounce events on the climb and the kart leaving the track entirely.
  //
  // Replacement: an EXPECTED-VY DEVIATION DAMPER. The "expected" vy on a
  // smooth slope is `v_horizontal · sin(pitch) = speedFwd · forward.y`.
  // Anything beyond that (in either direction) past a small tolerance is
  // bounce/launch. Bleed only the EXCESS back to expected over a short
  // tau so the chassis follows the slope smoothly but doesn't fight it.
  // Plus a SLOPE-NORMAL DOWNFORCE (along chassis -Y, not world -Y) so on
  // a steep slope the press goes INTO the road rather than flat down
  // (which would otherwise add a downhill-sliding component).
  // Both forces apply at the CoM (no relativePoint) so they generate no
  // pitching torque. Skipped during the drift hop and while airborne.
  if (grounded && !controlState.driftAirborne) {
    const fwdY = _fwd.y;                                  // sin(pitch); + = nose up
    const vxz = Math.hypot(chassisBody.velocity.x, chassisBody.velocity.z);
    const vy = chassisBody.velocity.y;
    const expectedVy = fwdY * speedFwd;
    const vyExcess = vy - expectedVy;
    // Asymmetric tolerance: tight on descents (fwdY<0) where positive
    // vy excess means the chassis is starting to launch off a deck→ramp
    // joint, looser on flat ground / climbs where minor spring rebound
    // shouldn't constantly fight the suspension.
    const descentFactor = Math.max(0, -fwdY); // 0 on flat/climb, ~0.2 at 11°, ~0.3 at 17°
    const tol = M(1.0) * (1 - 0.7 * descentFactor); // 1.0 → 0.30 at -17°
    if (Math.abs(vyExcess) > tol) {
      // Asymmetric tau: tighter for upward spikes (suppresses bounce off
      // slope-base impact) than downward spikes (which we still help so the
      // chassis gets pulled back into contact at a deck-to-descent edge).
      const sign = vyExcess > 0 ? 1 : -1;
      const overshoot = Math.abs(vyExcess) - tol;
      // Pitch-aware tau on UPWARD excess: while actively climbing
      // (fwdY > 0) keep gentle damping (tau≈0.10) so we don't fight the
      // legitimate climb. The instant the slope flattens at the crest
      // (fwdY → 0) the carried-over upward vy becomes pure overshoot
      // and needs to be killed FAST or the chassis bobs over the top of
      // the ramp (visual: wheels briefly sink into the deck on rebound,
      // then chassis pops back up). tau ramps 0.02s (flat) → 0.10s (steep climb).
      const climbFactor = Math.min(1, Math.max(0, fwdY) / 0.20); // 0 flat → 1 at ~11.5°
      const tauUp = 0.02 + 0.08 * climbFactor;
      const tau = sign > 0 ? tauUp : 0.18;
      const accel = overshoot / Math.max(tau, dt);
      // For UPWARD damping at the crest we deliberately do NOT scale by
      // grounded-wheel fraction. At the deck-top transition only 2/4
      // wheels may touch for a frame; halving the damping there is
      // exactly what causes the bob. For DOWNWARD damping (pulling
      // chassis back into contact at deck→descent edges) keep the
      // groundFrac so we don't slam an airborne kart into the road.
      const groundFrac = groundedCount / vehicle.wheelInfos.length;
      const forceScale = sign > 0 ? 1 : groundFrac;
      const fY = -sign * KART_MASS * accel * forceScale;
      _coastForce.set(0, fY, 0);
      chassisBody.applyForce(_coastForce);
    }
    // Slope-normal downforce: along chassis -Y so on inclines it presses
    // into the road normal, not straight down. ~0.05 G base → ~0.40 G at
    // top speed.
    const speedFrac = Math.min(1, vxz / TOP_SPEED_MS);
    const groundFrac2 = groundedCount / vehicle.wheelInfos.length;
    const downG = 0.05 + 0.35 * speedFrac;
    const _q = chassisBody.quaternion;
    // chassis-up vector in world frame = q * (0,1,0):
    const upX = 2 * (_q.x * _q.y + _q.w * _q.z);
    const upY = 1 - 2 * (_q.x * _q.x + _q.z * _q.z);
    const upZ = 2 * (_q.y * _q.z - _q.w * _q.x);
    const fmag = KART_MASS * M(9.81) * downG * groundFrac2;
    _coastForce.set(-upX * fmag, -upY * fmag, -upZ * fmag);
    chassisBody.applyForce(_coastForce);
  }

  // CoM-aligned braking force. Acts opposite the horizontal velocity
  // vector so the kart decelerates without any pitching torque. This
  // is only applied for "normal" braking (not handbrake/brake-drift/
  // burnout, which all want wheel-level lockup behaviour).
  if (braking && !drifting && !brakeDrift && !burnout) {
    const vx = chassisBody.velocity.x;
    const vy = chassisBody.velocity.y;
    const vz = chassisBody.velocity.z;
    const vMagH = Math.hypot(vx, vz);
    // Operate on the full 3D velocity when grounded so braking on a
    // downhill actually opposes the gravity-fed component and the
    // chassis decelerates instead of just losing horizontal speed
    // while sliding ever-faster down the slope. When airborne we fall
    // back to horizontal-only so brake-press in flight doesn't cancel
    // gravity (would feel like an air-brake floating).
    const useY = grounded;
    const vMag = useY ? Math.hypot(vx, vy, vz) : vMagH;
    if (vMag > M(0.5)) {
      // Scale brake by speed so a faster kart loses speed faster
      // (proportional to v) — gives natural log-decay deceleration.
      const brakeAccel = M(45);  // m/s^2 of equivalent decel at unit-vel direction
      const fMag = KART_MASS * brakeAccel * Math.min(1, vMag / TOP_SPEED_MS);
      const inv = -fMag / vMag;
      _brakeForce.set(vx * inv, useY ? vy * inv : 0, vz * inv);
      // NOTE: cannon-es applyForce(force, relativePoint) treats the
      // second arg as a WORLD-SPACE OFFSET FROM THE CoM, not an
      // absolute position. To apply a pure CoM force (zero pitching
      // moment) we MUST omit it (or pass Vec3.ZERO). Passing
      // chassisBody.position turns it into a massive spurious torque
      // = position × force, which spins the kart wildly.
      chassisBody.applyForce(_brakeForce);
    }
  }

  // ── Burnout anti-creep ───────────────────────────────────────
  // Even with rear assist zeroed and front friction dropped, the
  // powered fronts still scrub a tiny amount of forward thrust into
  // the chassis (~0.6 m/s creep). For a satisfying *stationary*
  // burnout the chassis must actually be stationary. Apply a strong
  // CoM-aligned counter-force opposite to the horizontal velocity so
  // the kart is pinned against the locked rear handbrake while the
  // fronts spin in place.
  if (burnout && grounded) {
    // Direct velocity damp (bypasses explicit-Euler stability limits
    // that any applyForce-based damper hits at high rates). Each tick
    // we zero the planar velocity entirely; the next physics step
    // re-applies engine force from the powered fronts, which produces
    // a small (~0.7 m/s) intra-tick blip before the next applyControls
    // wipes it again. Net visible motion is negligible (the displayed
    // average sits well below 0.5 m/s and the kart stays parked).
    // Vertical velocity is left alone so suspension / gravity behave.
    const v = chassisBody.velocity;
    v.x = 0;
    v.z = 0;
  }

  // ── Coast deceleration ───────────────────────────────────────
  // When the player releases the throttle (and isn't braking, drifting,
  // boost-charging, or on a boost), simulate the rolling resistance of
  // the tyres + aerodynamic drag so the kart bleeds momentum and
  // eventually stops instead of coasting forever. Without this,
  // chassis.linearDamping (0.06) is too weak to noticeably slow a
  // free-rolling kart, especially after pickups stack up speed.
  //
  // Decel model (in M-scaled units to match brake/gravity convention):
  //   • base               : M(3.0)  — constant rolling-resistance floor
  //   • speed-proportional : M(8.0)  — ramps with v / TOP_SPEED, simulates
  //                                    aerodynamic drag (∝ v in this
  //                                    simplified arcade model)
  //   • low-speed stop     : if |v| < M(1.0), boost decel ratio so the
  //                          kart actually settles to rest cleanly
  //                          rather than crawling forever near zero.
  //
  // Force is applied at the CoM (no relativePoint) so it produces no
  // pitching torque. Boost pickups disable coast entirely so a boost
  // pad still launches the kart at full top end.
  if (!braking && !drifting && !brakeDrift && !burnout && !controlState.driftActive
      && controlState.boostTimer <= 0
      && Math.abs(intent) < 0.05
      && grounded) {
    // Slope-aware coast deceleration. Operate on the FULL 3D velocity
    // (not just XZ) so the rolling resistance also bleeds the
    // gravity-induced velocity gain when coasting downhill. Without the
    // vertical component the kart accelerates indefinitely on any decline
    // because gravity feeds vy/vz with nothing to oppose it. We only do
    // this when grounded — falling through the air must remain free.
    const vx = chassisBody.velocity.x;
    const vy = chassisBody.velocity.y;
    const vz = chassisBody.velocity.z;
    const vMag = Math.hypot(vx, vy, vz);
    const vMagH = Math.hypot(vx, vz);
    if (vMag > M(0.05)) {
      const speedFrac = Math.min(1, vMag / TOP_SPEED_MS);
      // Base rolling resistance + speed-proportional drag.
      let coastAccel = M(3.0) + M(8.0) * speedFrac;
      // Extra grade-resist when descending (vy < 0). Scales with how
      // steep the slope is (|vy| / |v|). On a 30° decline that ratio is
      // ~0.5; on a 45° decline ~0.71. Adds up to M(6.0) of decel so a
      // sustained downhill coast settles to a steady-state speed instead
      // of accelerating through the governor cap.
      if (vy < -M(0.25)) {
        const grade = Math.min(1, -vy / Math.max(M(0.25), vMag));
        coastAccel += M(6.0) * grade;
      }
      if (vMagH < M(1.0)) {
        // Final-stop assist: scale up to a strong decel as we approach
        // zero (horizontal) so the kart doesn't crawl indefinitely.
        coastAccel = Math.max(coastAccel, M(12.0));
      }
      // Cap the impulse so dt * a can't exceed the current speed (would
      // flip the velocity sign and produce a tiny back-and-forth jitter).
      const maxAccel = vMag / Math.max(dt, 1e-3);
      const accel = Math.min(coastAccel, maxAccel);
      const fMag = KART_MASS * accel;
      const inv = -fMag / vMag;
      // Apply opposing the FULL 3D velocity vector. The vertical
      // component naturally counters gravity-induced downhill speed-up;
      // suspension reaction handles the normal-force side cleanly.
      _coastForce.set(vx * inv, vy * inv, vz * inv);
      chassisBody.applyForce(_coastForce);
    }
  }

  // Anti-pitch stabiliser. Compute the chassis pitch (rotation around
  // its right axis) from the world-space forward vector's Y component.
  // pitch = asin(forward.y); positive pitch means nose-up. Apply a
  // restoring torque around the WORLD right axis (chassis right vector
  // projected onto the XZ plane) proportional to the pitch angle, plus
  // a damping term proportional to angular velocity around that axis.
  // Only active while braking with at least one wheel on the ground so
  // jumps and ramps still feel free.
  if (braking && grounded) {
    const pitch = Math.asin(Math.max(-1, Math.min(1, _fwd.y)));
    chassisBody.quaternion.vmult(RIGHT_LOCAL, _right);
    _right.y = 0;
    const rl = Math.hypot(_right.x, _right.z);
    if (rl > 1e-4) {
      _right.x /= rl; _right.z /= rl;
      // Damping: project angular velocity onto the world right axis.
      const wPitchRate = chassisBody.angularVelocity.x * _right.x
                       + chassisBody.angularVelocity.z * _right.z;
      const tMag = -ANTI_PITCH_TORQUE * pitch - ANTI_PITCH_DAMPING * wPitchRate;
      _antiPitchTorque.set(_right.x * tMag, 0, _right.z * tMag);
      chassisBody.torque.vadd(_antiPitchTorque, chassisBody.torque);
    }
  }

  controlState.driftHopCooldown = Math.max(0, controlState.driftHopCooldown - dt);
  // Re-detect grounded for drift bookkeeping (the brake block above
  // also computed it but only inside its `if`; cheap to redo here).
  let driftGrounded = false;
  for (let i = 0; i < vehicle.wheelInfos.length; i++) {
    if (vehicle.wheelInfos[i].isInContact) { driftGrounded = true; break; }
  }

  // ── Hop trigger ────────────────────────────────────────
  // Shift-press while grounded (and either moving or actively
  // throttling) gives a real visible hop. We snap-lift the chassis,
  // inject upward velocity AND mark every wheel as out of contact for
  // the same tick — cannon will redo the raycasts on the next step,
  // but by then the chassis is genuinely above the ground.
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
    controlState._dbgArmFired = (controlState._dbgArmFired | 0) + 1;
  }
  // ── Diagnostics: log every press edge regardless of gate outcome.
  if (keys.drift && !controlState.lastDriftPress) {
    controlState._dbgPressEdge = (controlState._dbgPressEdge | 0) + 1;
    controlState._dbgPressCd = controlState.driftHopCooldown;
    controlState._dbgPressGrounded = driftGrounded ? 1 : 0;
    controlState._dbgPressSpeed = speedAbs;
    controlState._dbgPressIntent = intent;
  }
  controlState.lastDriftPress = keys.drift;

  // ── Land detection ───────────────────────────────────────
  // Touchdown = was airborne, now any wheel back in contact. Open the
  // land-commit grace window so a steer input within it still commits.
  if (controlState.driftAirborne && driftGrounded) {
    controlState.driftAirborne = false;
    controlState.driftLandTimer = DRIFT_LAND_COMMIT_WINDOW_S;
  }
  if (controlState.driftLandTimer > 0) {
    controlState.driftLandTimer = Math.max(0, controlState.driftLandTimer - dt);
  }

  // Releasing shift mid-hop or before commit aborts cleanly.
  if (controlState.driftArmed && !keys.drift) {
    controlState.driftArmed = false;
    controlState.driftAirborne = false;
    controlState.driftLandTimer = 0;
  }

  // ── Drift commit ─────────────────────────────────────
  // Classic hop→land→slide: the drift commits the moment the kart
  // touches down (or any time within DRIFT_LAND_COMMIT_WINDOW_S after
  // touchdown) provided shift is still held, A/D is held, throttle is
  // up, and we're moving. If the land-window expires without a steer,
  // the armed flag drops and the player just gets a free hop.
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
    // Suspension can momentarily unweight a wheel right after landing
    // — grant a short grace where `driftBreak` ignores `driftGrounded`
    // so the freshly committed drift survives the bounce.
    controlState.driftGroundedGrace = 0.25;
    controlState._dbgCommitFired = (controlState._dbgCommitFired | 0) + 1;
  } else if (controlState.driftArmed
             && !controlState.driftAirborne
             && controlState.driftLandTimer <= 0) {
    // Land-window closed without a steer commit — free hop, no drift.
    controlState.driftArmed = false;
    controlState._dbgCommitExpired = (controlState._dbgCommitExpired | 0) + 1;
  }
  // Diagnose every armed tick: why didn’t commit fire?
  if (controlState.driftArmed) {
    controlState._dbgArmedTicks = (controlState._dbgArmedTicks | 0) + 1;
    controlState._dbgArmedRawSteer = rawSteer;
    controlState._dbgArmedSpeed = speedAbs;
    controlState._dbgArmedIntent = intent;
    controlState._dbgArmedGrounded = driftGrounded ? 1 : 0;
    controlState._dbgArmedDrift = keys.drift ? 1 : 0;
    controlState._dbgArmedKeysA = keys.a ? 1 : 0;
    controlState._dbgArmedKeysD = keys.d ? 1 : 0;
  }

  // ── Drift maintenance ────────────────────────────────────
  // While the slide is active, accumulate charge and shape the kart's
  // motion: constant inward yaw torque, extra angular damping so the
  // chassis doesn't pirouette, and tier promotion at the threshold
  // boundaries. The shaped steering + asymmetric grip applied earlier
  // in this function handle the actual slide trajectory.
  if (controlState.driftActive) {
    // Refresh the grounded grace every tick the wheels actually touch
    // ground. Previously the grace was only set once at commit and
    // would tick down to zero — at high slide angles the inside wheels
    // unweight enough that ground contact flickers, and a 0.25 s grace
    // would expire mid-drift, prematurely breaking the slide.
    if (driftGrounded) {
      controlState.driftGroundedGrace = 0.40;
    } else if ((controlState.driftGroundedGrace || 0) > 0) {
      controlState.driftGroundedGrace -= dt;
    }
    const groundedOk = driftGrounded || (controlState.driftGroundedGrace || 0) > 0;
    // World-plane speed survives momentary chassis yaw (the slide).
    // `speedAbs` is chassis-forward only and crashes to zero when the
    // chassis swings sideways during a slide — using it alone would
    // false-trigger driftBreak halfway through the very slide it's
    // supposed to allow.
    const vx = chassisBody.velocity.x, vz = chassisBody.velocity.z;
    const worldSpeed = Math.hypot(vx, vz);
    const minMaintain = DRIFT_COMMIT_MIN_SPEED * 0.55;
    const tooSlow = speedAbs < minMaintain && worldSpeed < minMaintain;
    const driftBreak =
      !keys.drift ||
      !groundedOk ||
      intent < DRIFT_THROTTLE_FLOOR ||
      tooSlow;
    controlState._dbgActiveTicks = (controlState._dbgActiveTicks | 0) + 1;
    if (driftBreak) {
      controlState._dbgBreakReason =
        !keys.drift ? 1 :
        !groundedOk ? 2 :
        intent < DRIFT_THROTTLE_FLOOR ? 3 :
        tooSlow ? 4 : 0;
      controlState._dbgBreakAtTicks = controlState._dbgActiveTicks;
      // Award boost based on accumulated charge tier.
      let tier = 0, dur = 0;
      if (controlState.driftCharge >= DRIFT_CHARGE_T3) { tier = 3; dur = DRIFT_BOOST_T3_S; }
      else if (controlState.driftCharge >= DRIFT_CHARGE_T2) { tier = 2; dur = DRIFT_BOOST_T2_S; }
      else if (controlState.driftCharge >= DRIFT_CHARGE_T1) { tier = 1; dur = DRIFT_BOOST_T1_S; }
      if (tier > 0) {
        // If a previous boost is still ticking, take the better of the
        // two so a quick T1 doesn't clip a long T3.
        if (dur > controlState.boostTimer) {
          controlState.boostTimer = dur;
          controlState.boostTier = tier;
        }
      }
      controlState.driftJustReleasedTier = tier;
      if (tier > (controlState._dbgMaxBoostTier | 0)) {
        controlState._dbgMaxBoostTier = tier;
      }
      controlState.driftActive = false;
      controlState.driftExitDir = controlState.driftDir; // remember sign for steer fade-out
      controlState.driftDir = 0;
      controlState.driftCharge = 0;
      controlState.driftTier = 0;
      // Hard-clamp residual yaw at the moment of break so the decay window
      // doesn't start from a runaway value. The exit-damp loop below handles
      // the rest (gradual rear-grip restoration + roll damping).
      const _yawCap = 0.6; // rad/s -- gentle settle baseline
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
      if (controlState.driftTier > (controlState._dbgMaxTier | 0)) {
        controlState._dbgMaxTier = controlState.driftTier;
      }
      // ── Closed-loop slide-angle controller ────────────────
      // Compute the kart's current slide angle (chassis-relative
      // velocity direction vs. chassis forward). Drive a PD
      // controller against a TARGET slide angle that the player
      // modulates with steer:
      //   • Inside steer  (with the slide direction)  → tightens
      //   • Outside steer (countersteer)              → widens
      //
      // The PD output is added to chassis torque each frame. Authority
      // scales with speed so low-speed drifts feel gentle while high-
      // speed drifts have the bite to actually carry through a sweep.
      // This is what gives the "OutRun power-slide" feel — a stable,
      // controllable angle rather than the previous open-loop torque
      // that just kept rotating until friction caught up.
      chassisBody.quaternion.vmult(RIGHT_LOCAL, _right);
      const lateralV = v.dot(_right);
      const forwardV = v.dot(_fwd);
      const sLocalCtl = Math.max(-1, Math.min(1, controlState.steer * controlState.driftDir));
      const targetMag = DRIFT_TARGET_SLIDE_BASE - sLocalCtl * DRIFT_TARGET_SLIDE_RANGE;
      const targetAngle = controlState.driftDir * Math.max(0.10, Math.min(0.85, targetMag));
      const denom = Math.max(M(5), Math.hypot(forwardV, lateralV));
      const currentAngle = Math.asin(Math.max(-1, Math.min(1, lateralV / denom)));
      const angleErr = targetAngle - currentAngle;
      // Authority ramps in over 0..15 m/s — full at ~54 km/h.
      const speedScale = Math.min(1, speedAbs / M(15));
      // Desired yaw rate that would maintain the target slide angle.
      let desiredYaw = angleErr * DRIFT_YAW_RATE_SCALE * speedScale;
      if (desiredYaw >  DRIFT_MAX_YAW_RATE) desiredYaw =  DRIFT_MAX_YAW_RATE;
      if (desiredYaw < -DRIFT_MAX_YAW_RATE) desiredYaw = -DRIFT_MAX_YAW_RATE;
      // ADDITIVE asymmetric correction: gentle when below the target
      // slide angle (so the slide can build naturally) and aggressive
      // when above target (so a commit transient can't run away into
      // a full spin-out). Magnitude of |currentAngle| compared to
      // |targetAngle| picks which gain applies.
      const yawNow = chassisBody.angularVelocity.y;
      const yawErr = desiredYaw - yawNow;
      const overTarget = Math.abs(currentAngle) > Math.abs(targetAngle);
      const gain = overTarget ? DRIFT_YAW_ASSIST_GAIN_OVER : DRIFT_YAW_ASSIST_GAIN_UNDER;
      const blend = (1 - Math.exp(-dt / DRIFT_YAW_ASSIST_TAU_S)) * gain;
      chassisBody.angularVelocity.y = yawNow + yawErr * blend;
      // Hard angular-velocity clamp during drift. The wheel solver can
      // pump huge angular momentum into the chassis in a single tick;
      // without this clamp the kart spins out before the assist has
      // time to brake. Cap is symmetric in both yaw directions.
      if (chassisBody.angularVelocity.y >  DRIFT_MAX_YAW_RATE) chassisBody.angularVelocity.y =  DRIFT_MAX_YAW_RATE;
      if (chassisBody.angularVelocity.y < -DRIFT_MAX_YAW_RATE) chassisBody.angularVelocity.y = -DRIFT_MAX_YAW_RATE;
      // Active lateral-velocity shedding. Once slide angle exceeds the
      // target by a meaningful margin, actively bleed lateral velocity
      // back into the chassis-forward axis. This is what stops a long
      // drift from snowballing into a full spin: lateral keeps growing
      // because the rears are loose, and forward scrubs against tyres,
      // so without intervention sa creeps to 90°. Shedding caps the
      // angle at roughly 1.4 × target.
      const angleAbs = Math.abs(currentAngle);
      const targetAbs = Math.abs(targetAngle);
      if (angleAbs > targetAbs * 1.30) {
        const excess = (angleAbs - targetAbs * 1.30) / Math.max(0.05, targetAbs);
        // shed up to 28% of lateral velocity per tick when way over
        const shedFrac = Math.min(0.28, excess * 0.40);
        const shed = lateralV * shedFrac;
        chassisBody.velocity.x -= shed * _right.x;
        chassisBody.velocity.z -= shed * _right.z;
      }
    }
  } else {
    controlState.driftJustReleasedTier = 0;
  }

  // -- Post-drift exit damp --------------------------------------------
  // For DRIFT_EXIT_DAMP_S after a drift breaks, exponentially decay the
  // chassis yaw rate and the chassis-lateral component of velocity. This
  // bleeds the residual rotation/sideways momentum so the kart doesn't
  // keep spinning like a tornado after throttle release. Grounded only.
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
      // Aggressively damp roll & pitch so any tip-over impulse from the
      // rear-grip restoration or boost can't accumulate into a flip.
      const rollDecay = 1 - Math.exp(-dt / 0.06);
      chassisBody.angularVelocity.x *= (1 - rollDecay);
      chassisBody.angularVelocity.z *= (1 - rollDecay);
      // Hard cap on roll/pitch angular velocity. Even with strong damping,
      // a single tick of high force (boost ramp + grip restoration) can spike
      // angular velocity past a recoverable point. Clamping ensures no flip.
      const _rollCap = 0.8;
      if (chassisBody.angularVelocity.x >  _rollCap) chassisBody.angularVelocity.x =  _rollCap;
      if (chassisBody.angularVelocity.x < -_rollCap) chassisBody.angularVelocity.x = -_rollCap;
      if (chassisBody.angularVelocity.z >  _rollCap) chassisBody.angularVelocity.z =  _rollCap;
      if (chassisBody.angularVelocity.z < -_rollCap) chassisBody.angularVelocity.z = -_rollCap;
      // Hard cap on YAW during the exit window too. Without this, a
      // still-sideways chassis hitting restored grip generates a huge
      // self-aligning torque that the gentle yaw-decay (tau 0.10 s)
      // can't outpace — the chassis snaps to align with velocity in
      // a single tick, producing the "glitch / snap" the player sees
      // at drift release. Cap ramps from a tight 1.2 rad/s right at
      // release up to a more permissive 3.0 rad/s as exit-damp expires
      // (so normal turning is unaffected once the window ends).
      const _yawSettle = controlState.driftExitDamp / DRIFT_EXIT_DAMP_S; // 1→0
      const _yawCapExit = 1.2 + (1 - _yawSettle) * 1.8;
      if (chassisBody.angularVelocity.y >  _yawCapExit) chassisBody.angularVelocity.y =  _yawCapExit;
      if (chassisBody.angularVelocity.y < -_yawCapExit) chassisBody.angularVelocity.y = -_yawCapExit;
      // Active upright-correction torque if chassis tilts past ~14 degrees.
      // Cross product (bodyUp x worldUp) gives the rotation axis that brings
      // the chassis back upright; scaling that by _kUp produces the torque.
      const _q = chassisBody.quaternion;
      // Body up vector in world: rotate (0,1,0) by quaternion.
      const _bx = 2*(_q.x*_q.y + _q.w*_q.z);
      const _by = 1 - 2*(_q.x*_q.x + _q.z*_q.z);
      const _bz = 2*(_q.y*_q.z - _q.w*_q.x);
      if (_by < 0.97) { // tilted more than ~14 deg
        // bodyUp x worldUp where worldUp = (0,1,0):
        //   x = by*0 - bz*1 = -bz
        //   y = bz*0 - bx*0 =  0
        //   z = bx*1 - by*0 =  bx
        const _kUp = M(2200); // strong corrective torque
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

  // ── Mini-turbo boost integration ──────────────────────────
  // While boostTimer ticks down, apply a forward force aligned with the
  // chassis' forward axis. Strength scales with tier so purple snaps
  // hardest, blue is just a kiss. The top-speed governor multiplier
  // (driftBoostMul, applied above) lets the boost actually accelerate
  // past the baseline cap rather than mash against it.
  if (controlState.boostTimer > 0) {
    controlState.boostTimer = Math.max(0, controlState.boostTimer - dt);
    if (driftGrounded) {
      const tierScale =
        controlState.boostTier >= 3 ? 1.40 :
        controlState.boostTier >= 2 ? 1.10 : 0.85;
      // Ramp boost in as the exit-damp decays so a purple doesn't slam a
      // still-sideways chassis and tip it over. Full power once exit settled.
      const damp = controlState.driftExitDamp || 0;
      const ramp = damp > 0 ? Math.max(0, 1 - (damp / DRIFT_EXIT_DAMP_S)) : 1;
      const fmag = -DRIFT_BOOST_FORCE * tierScale * ramp;
      _driftImpulse.set(_fwd.x * fmag, 0, _fwd.z * fmag);
      // Apply boost at wheel-axle height (below CoM) so the friction
      // reaction at the contact patch generates no pitch torque. Applying
      // at chassisBody.position (CoM) caused the chassis to pitch nose-up
      // at low forward speed, which then tipped the kart over backward.
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
}

function sampleLastSafePose() {
  let grounded = false;
  for (let i = 0; i < vehicle.wheelInfos.length; i++) {
    if (vehicle.wheelInfos[i].isInContact) { grounded = true; break; }
  }
  if (!grounded) return;
  const px = chassisBody.position.x;
  const pz = chassisBody.position.z;
  if (TILE_LOCAL > 0) {
    const gx = Math.round(px / TILE_LOCAL);
    const gz = Math.round(pz / TILE_LOCAL);
    if (!drivableCells.has(`${gx},${gz}`)) return;
  }
  const q = chassisBody.quaternion;
  const sinyCosp = 2 * (q.w * q.y + q.x * q.z);
  const cosyCosp = 1 - 2 * (q.y * q.y + q.x * q.x);
  lastSafe.has = true;
  lastSafe.x = px;
  lastSafe.y = chassisBody.position.y;
  lastSafe.z = pz;
  lastSafe.yaw = Math.atan2(sinyCosp, cosyCosp);
}

function recoverToLastSafe() {
  if (!lastSafe.has) { respawn(); return; }
  chassisBody.velocity.set(0, 0, 0);
  chassisBody.angularVelocity.set(0, 0, 0);
  chassisBody.position.set(lastSafe.x, lastSafe.y + M(0.5), lastSafe.z);
  chassisBody.quaternion.setFromAxisAngle(_yawAxis, lastSafe.yaw);
  controlState.steer = 0; controlState.throttle = 0; controlState.driftHopCooldown = 0;
  controlState.driftArmed = false; controlState.driftActive = false; controlState.driftDir = 0;
  controlState.driftCharge = 0; controlState.driftTier = 0; controlState.driftCommitTimer = 0;
  controlState.driftAirborne = false; controlState.driftLandTimer = 0; controlState.driftGroundedGrace = 0;
  controlState.boostTimer = 0; controlState.boostTier = 0; controlState.driftJustReleasedTier = 0; controlState.driftExitDamp = 0; controlState.driftExitDir = 0;
}

// ── Rewind: write current pose+velocity to ring buffer ─────────────
function sampleRewind() {
  rewindTickCounter++;
  if (rewindTickCounter < REWIND_TICK_INTERVAL) return;
  rewindTickCounter = 0;
  const off = rewindHead * REWIND_STRIDE;
  const p = chassisBody.position;
  const q = chassisBody.quaternion;
  const v = chassisBody.velocity;
  const w = chassisBody.angularVelocity;
  rewindBuf[off + 0] = p.x;  rewindBuf[off + 1] = p.y;  rewindBuf[off + 2] = p.z;
  rewindBuf[off + 3] = q.x;  rewindBuf[off + 4] = q.y;  rewindBuf[off + 5] = q.z;  rewindBuf[off + 6] = q.w;
  rewindBuf[off + 7] = v.x;  rewindBuf[off + 8] = v.y;  rewindBuf[off + 9] = v.z;
  rewindBuf[off + 10] = w.x; rewindBuf[off + 11] = w.y; rewindBuf[off + 12] = w.z;
  rewindHead = (rewindHead + 1) % REWIND_CAP;
  if (rewindCount < REWIND_CAP) rewindCount++;
}

// Restore to the OLDEST entry in the ring (≈10s back, or whatever has
// been recorded so far if the buffer hasn't filled yet). Falls back to
// lastSafe → respawn if no rewind data is available (shouldn't happen
// after the first sample).
function rewindToOldest() {
  if (rewindCount === 0) { recoverToLastSafe(); return; }
  // Oldest valid entry: when full, it's at rewindHead (the next slot to
  // overwrite). When partial, it's at slot 0.
  const oldestIdx = (rewindCount === REWIND_CAP) ? rewindHead : 0;
  const off = oldestIdx * REWIND_STRIDE;
  chassisBody.position.set(rewindBuf[off + 0], rewindBuf[off + 1], rewindBuf[off + 2]);
  chassisBody.quaternion.set(rewindBuf[off + 3], rewindBuf[off + 4], rewindBuf[off + 5], rewindBuf[off + 6]);
  chassisBody.velocity.set(rewindBuf[off + 7], rewindBuf[off + 8], rewindBuf[off + 9]);
  chassisBody.angularVelocity.set(rewindBuf[off + 10], rewindBuf[off + 11], rewindBuf[off + 12]);
  // Drop the consumed history so a second R-press rewinds 10s further
  // back from the just-restored pose, not back to the same point.
  rewindCount = 0;
  rewindHead = 0;
  rewindTickCounter = 0;
  // Clear transient control state so the kart doesn't carry forward
  // mid-drift / boost timers from the moment of the crash.
  controlState.steer = 0; controlState.throttle = 0; controlState.driftHopCooldown = 0;
  controlState.driftArmed = false; controlState.driftActive = false; controlState.driftDir = 0;
  controlState.driftCharge = 0; controlState.driftTier = 0; controlState.driftCommitTimer = 0;
  controlState.driftAirborne = false; controlState.driftLandTimer = 0; controlState.driftGroundedGrace = 0;
  controlState.boostTimer = 0; controlState.boostTier = 0; controlState.driftJustReleasedTier = 0; controlState.driftExitDamp = 0; controlState.driftExitDir = 0;
}

function respawn() {
  chassisBody.velocity.set(0, 0, 0);
  chassisBody.angularVelocity.set(0, 0, 0);
  chassisBody.position.set(spawnPos.x, spawnPos.y, spawnPos.z);
  chassisBody.quaternion.setFromAxisAngle(_yawAxis, spawnRot);
  controlState.steer = 0; controlState.throttle = 0; controlState.driftHopCooldown = 0;
  controlState.driftArmed = false; controlState.driftActive = false; controlState.driftDir = 0;
  controlState.driftCharge = 0; controlState.driftTier = 0; controlState.driftCommitTimer = 0;
  controlState.driftAirborne = false; controlState.driftLandTimer = 0; controlState.driftGroundedGrace = 0;
  controlState.boostTimer = 0; controlState.boostTier = 0; controlState.driftJustReleasedTier = 0; controlState.driftExitDamp = 0; controlState.driftExitDir = 0;
  // Drop rewind history — a respawn is a hard reset, the prior trajectory
  // is no longer relevant and rewinding into it would teleport the kart.
  rewindCount = 0; rewindHead = 0; rewindTickCounter = 0;
}

function makeSnapshot() {
  const wheels = new Array(vehicle.wheelInfos.length);
  for (let i = 0; i < vehicle.wheelInfos.length; i++) {
    // NOTE: Do NOT call vehicle.updateWheelTransform(i) here — it
    // invokes updateWheelTransformWorld() which clobbers
    // wi.isInContact back to false. The wheel's worldTransform is
    // already fresh (updated by RaycastVehicle.updateVehicle during
    // world.step) so we can read it directly.
    const wi = vehicle.wheelInfos[i];
    const t = wi.worldTransform;
    wheels[i] = {
      px: t.position.x, py: t.position.y, pz: t.position.z,
      qx: t.quaternion.x, qy: t.quaternion.y, qz: t.quaternion.z, qw: t.quaternion.w,
      inContact: !!wi.isInContact,
      sus: Number.isFinite(wi.suspensionLength) ? wi.suspensionLength : 0,
    };
  }
  const p = chassisBody.position;
  const q = chassisBody.quaternion;
  const ip = chassisBody.interpolatedPosition;
  const iq = chassisBody.interpolatedQuaternion;
  const v = chassisBody.velocity;
  return {
    pos: [p.x, p.y, p.z],
    quat: [q.x, q.y, q.z, q.w],
    interpPos: [ip.x, ip.y, ip.z],
    interpQuat: [iq.x, iq.y, iq.z, iq.w],
    vel: [v.x, v.y, v.z],
    speedLen: v.length(),
    wheels,
    hasSafe: lastSafe.has,
    controlState: {
      steer: controlState.steer,
      throttle: controlState.throttle,
      driftHopCooldown: controlState.driftHopCooldown,
      lastDriftPress: controlState.lastDriftPress,
      driftArmed: controlState.driftArmed,
      driftActive: controlState.driftActive,
      driftDir: controlState.driftDir,
      driftCharge: controlState.driftCharge,
      driftTier: controlState.driftTier,
      boostTimer: controlState.boostTimer,
      boostTier: controlState.boostTier,
      driftJustReleasedTier: controlState.driftJustReleasedTier,
      driftExitDamp: controlState.driftExitDamp || 0,
      driftExitDir: controlState.driftExitDir || 0,
      driftAirborne: !!controlState.driftAirborne,
      driftLandTimer: controlState.driftLandTimer || 0,
      driftCommitTimer: controlState.driftCommitTimer || 0,
      _dbgArmFired: controlState._dbgArmFired | 0,
      _dbgPressEdge: controlState._dbgPressEdge | 0,
      _dbgPressCd: controlState._dbgPressCd || 0,
      _dbgPressGrounded: controlState._dbgPressGrounded || 0,
      _dbgPressSpeed: controlState._dbgPressSpeed || 0,
      _dbgPressIntent: controlState._dbgPressIntent || 0,
      _dbgCommitFired: controlState._dbgCommitFired | 0,
      _dbgCommitExpired: controlState._dbgCommitExpired | 0,
      _dbgArmedTicks: controlState._dbgArmedTicks | 0,
      _dbgArmedRawSteer: controlState._dbgArmedRawSteer || 0,
      _dbgArmedSpeed: controlState._dbgArmedSpeed || 0,
      _dbgArmedIntent: controlState._dbgArmedIntent || 0,
      _dbgArmedGrounded: controlState._dbgArmedGrounded || 0,
      _dbgArmedDrift: controlState._dbgArmedDrift || 0,
      _dbgArmedKeysA: controlState._dbgArmedKeysA || 0,
      _dbgArmedKeysD: controlState._dbgArmedKeysD || 0,
      _dbgWorkerKeysA: keys.a ? 1 : 0,
      _dbgWorkerKeysD: keys.d ? 1 : 0,
      _dbgWorkerKeysDrift: keys.drift ? 1 : 0,
      _dbgActiveTicks: controlState._dbgActiveTicks | 0,
      _dbgBreakReason: controlState._dbgBreakReason | 0,
      _dbgBreakAtTicks: controlState._dbgBreakAtTicks | 0,
      _dbgMaxTier: controlState._dbgMaxTier | 0,
      _dbgMaxBoostTier: controlState._dbgMaxBoostTier | 0,
    },
  };
}

function startLoop() {
  if (stepInterval) clearInterval(stepInterval);
  lastTickTime = performance.now();
  stepInterval = setInterval(() => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastTickTime) / 1000);
    lastTickTime = now;
    if (!paused && world) {
      applyControls(dt);
      world.step(1 / 60, dt, physicsSubsteps);
      sampleLastSafePose();
      sampleRewind();
      if (chassisBody.position.y < -M(20)) respawn();
    }
    if (chassisBody) {
      self.postMessage({ type: 'snap', t: now, snap: makeSnapshot() });
    }
  }, 1000 / 60);
}

self.onmessage = (e) => {
  const m = e.data;
  if (!m) return;
  switch (m.type) {
    case 'init':
      try {
        initWorld(m);
        self.postMessage({ type: 'ready' });
        startLoop();
      } catch (err) {
        self.postMessage({ type: 'error', message: String(err && err.message || err) });
      }
      break;
    case 'keys':
      Object.assign(keys, m.keys);
      break;
    case 'combat':
      Object.assign(playerCombat, m.state);
      break;
    case 'recover':
      if (chassisBody) rewindToOldest();
      break;
    case 'respawn':
      if (chassisBody) respawn();
      break;
    case 'pause':
      paused = !!m.value;
      if (!paused) lastTickTime = performance.now();
      break;
    case 'shutdown':
      if (stepInterval) clearInterval(stepInterval);
      stepInterval = null;
      world = null; chassisBody = null; vehicle = null;
      break;
    default:
      break;
  }
};
