/**
 * physics-bridge.js — Main-thread proxy for the off-thread cannon-es runtime.
 *
 * Spawns physics-worker.js, ships the world build inputs, and exposes
 * proxies that mimic the CANNON.Body/RaycastVehicle API surface that
 * play-main.js (and mp-client.js) read every frame:
 *
 *   bridge.chassisBody.position.{x,y,z}
 *   bridge.chassisBody.quaternion.{x,y,z,w}
 *   bridge.chassisBody.interpolatedPosition.{x,y,z}
 *   bridge.chassisBody.interpolatedQuaternion.{x,y,z,w}
 *   bridge.chassisBody.velocity.{x,y,z}   ·   .length()
 *   bridge.vehicle.wheelInfos[i].isInContact / .suspensionLength
 *   bridge.vehicle.wheelInfos[i].worldTransform.{position,quaternion}
 *   bridge.vehicle.updateWheelTransform(i)   — no-op (snapshot is fresh)
 *
 * Mutations go the other way: keys, combat multipliers, recover/respawn
 * commands, pause toggle. The bridge keeps no physics state of its
 * own — it just mirrors the latest snapshot the worker posted.
 */

// Vite-friendly worker import. The `{ type: 'module' }` is critical so
// the worker can use ES imports (cannon-es, our local modules).
const PhysicsWorkerCtor = () => new Worker(
  new URL('./physics-worker.js', import.meta.url),
  { type: 'module' },
);

class Vec3Mirror {
  constructor() { this.x = 0; this.y = 0; this.z = 0; }
  set(arr) { this.x = arr[0]; this.y = arr[1]; this.z = arr[2]; }
  length() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
}
class QuatMirror {
  constructor() { this.x = 0; this.y = 0; this.z = 0; this.w = 1; }
  set(arr) { this.x = arr[0]; this.y = arr[1]; this.z = arr[2]; this.w = arr[3]; }
}

class WheelMirror {
  constructor() {
    this.isInContact = false;
    this.suspensionLength = 0;
    this.worldTransform = { position: new Vec3Mirror(), quaternion: new QuatMirror() };
  }
}

class ChassisBodyMirror {
  constructor() {
    this.position = new Vec3Mirror();
    this.quaternion = new QuatMirror();
    this.interpolatedPosition = new Vec3Mirror();
    this.interpolatedQuaternion = new QuatMirror();
    this.velocity = new Vec3Mirror();
  }
}

class VehicleMirror {
  constructor() {
    this.wheelInfos = [new WheelMirror(), new WheelMirror(), new WheelMirror(), new WheelMirror()];
  }
  // Snapshot already includes wheel world transforms — this is a no-op
  // kept for source-compatibility with the original main-thread code.
  updateWheelTransform(_i) {}
}

export function createPhysicsBridge({
  staticBodies, drivableCells, tile,
  spawnPos, spawnRot, perfBudget,
}) {
  const worker = PhysicsWorkerCtor();
  const chassisBody = new ChassisBodyMirror();
  const vehicle = new VehicleMirror();

  // Snapshot ring + per-axis velocity used by `bridge.interpolate(now)`.
  //
  // We do NOT add a render-delay buffer — that adds ≥1 physics tick of
  // input lag (~16 ms) and makes the kart feel sluggish even at 240
  // fps. Instead, render at the latest snapshot pose with **forward
  // extrapolation** ("dead reckoning") using the snapshot velocity.
  //
  // For chassis position:
  //   visual = currPos + vel * (now - currAt)     // capped to 33 ms
  // For orientation we nlerp from prev→curr using the elapsed fraction
  // since prev (so alpha can drift past 1 while a snapshot is in
  // flight; clamped to 1.5 so a stalled worker can't fling the kart).
  // Wheel positions are linearly extrapolated the same way as chassis
  // pos so the wheels track the body during high-Hz rendering.
  //
  // Tradeoff: tiny overshoot on hard direction changes (1-2 mm at
  // 30 m/s with a 16 ms tick) — invisible. Wins: zero added input
  // lag, smooth at any refresh rate, robust to setInterval jitter
  // in the worker (snapshots arrive 16-22 ms apart, not exactly).
  const MAX_EXTRAP_MS = 33;
  let havePrev = false;
  let prevAt = 0, currAt = 0;
  const prevPos = [0, 0, 0], prevQuat = [0, 0, 0, 1];
  const currPos = [0, 0, 0], currQuat = [0, 0, 0, 1];
  const currVel = [0, 0, 0];
  const prevWheelP = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const currWheelP = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const prevWheelQ = [[0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1]];
  const currWheelQ = [[0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1]];

  // Normalize-after-lerp quaternion blend. Cheaper than slerp and
  // visually identical for the small per-tick rotation deltas a kart
  // produces; equivalent to Bullet's btTransformUtil pattern.
  function nlerp(a, b, t, out) {
    // Pick shortest arc.
    const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    const s = dot < 0 ? -1 : 1;
    const x = a[0] + (b[0] * s - a[0]) * t;
    const y = a[1] + (b[1] * s - a[1]) * t;
    const z = a[2] + (b[2] * s - a[2]) * t;
    const w = a[3] + (b[3] * s - a[3]) * t;
    const inv = 1 / Math.sqrt(x * x + y * y + z * z + w * w) || 1;
    out[0] = x * inv; out[1] = y * inv; out[2] = z * inv; out[3] = w * inv;
  }
  const _qOut = [0, 0, 0, 1];

  const bridge = {
    worker,
    chassisBody,
    vehicle,
    controlState: {
      steer: 0, throttle: 0, driftHopCooldown: 0, lastDriftPress: false,
      driftArmed: false, driftAirborne: false, driftLandTimer: 0,
      driftActive: false, driftDir: 0,
      driftCharge: 0, driftTier: 0,
      boostTimer: 0, boostTier: 0, driftJustReleasedTier: 0,
    },
    ready: false,
    lastSnapAt: 0,
    snapCount: 0,
    onReady: null,
    onSnap: null,
  };

  worker.onmessage = (e) => {
    const m = e.data;
    if (!m) return;
    if (m.type === 'ready') {
      bridge.ready = true;
      if (typeof bridge.onReady === 'function') bridge.onReady(m);
    } else if (m.type === 'error') {
      console.error('[physics-worker error]', m.message);
    } else if (m.type === 'snap') {
      const s = m.snap;
      // Authoritative state — combat sweep, lap detection, debug
      // logs read these (no interpolation desired).
      chassisBody.position.set(s.pos);
      chassisBody.quaternion.set(s.quat);
      chassisBody.velocity.set(s.vel);
      if (s.controlState) Object.assign(bridge.controlState, s.controlState);
      for (let i = 0; i < s.wheels.length && i < vehicle.wheelInfos.length; i++) {
        const w = s.wheels[i];
        const wm = vehicle.wheelInfos[i];
        wm.isInContact = w.inContact;
        wm.suspensionLength = w.sus;
      }

      // Shift current → previous, store new as current. Stamp on
      // arrival in main-thread time so interpolate() can compare
      // against `performance.now()` directly.
      const now = performance.now();
      if (bridge.snapCount === 0) {
        // Seed both ends with the first snapshot so interpolate()
        // doesn't lerp from a zero pose during warmup.
        prevPos[0] = currPos[0] = s.pos[0];
        prevPos[1] = currPos[1] = s.pos[1];
        prevPos[2] = currPos[2] = s.pos[2];
        prevQuat[0] = currQuat[0] = s.quat[0];
        prevQuat[1] = currQuat[1] = s.quat[1];
        prevQuat[2] = currQuat[2] = s.quat[2];
        prevQuat[3] = currQuat[3] = s.quat[3];
        currVel[0] = s.vel[0]; currVel[1] = s.vel[1]; currVel[2] = s.vel[2];
        for (let i = 0; i < s.wheels.length && i < 4; i++) {
          const w = s.wheels[i];
          prevWheelP[i][0] = currWheelP[i][0] = w.px;
          prevWheelP[i][1] = currWheelP[i][1] = w.py;
          prevWheelP[i][2] = currWheelP[i][2] = w.pz;
          prevWheelQ[i][0] = currWheelQ[i][0] = w.qx;
          prevWheelQ[i][1] = currWheelQ[i][1] = w.qy;
          prevWheelQ[i][2] = currWheelQ[i][2] = w.qz;
          prevWheelQ[i][3] = currWheelQ[i][3] = w.qw;
        }
        prevAt = currAt = now;
        havePrev = true;
      } else {
        prevAt = currAt;
        prevPos[0] = currPos[0]; prevPos[1] = currPos[1]; prevPos[2] = currPos[2];
        prevQuat[0] = currQuat[0]; prevQuat[1] = currQuat[1]; prevQuat[2] = currQuat[2]; prevQuat[3] = currQuat[3];
        for (let i = 0; i < 4; i++) {
          prevWheelP[i][0] = currWheelP[i][0]; prevWheelP[i][1] = currWheelP[i][1]; prevWheelP[i][2] = currWheelP[i][2];
          prevWheelQ[i][0] = currWheelQ[i][0]; prevWheelQ[i][1] = currWheelQ[i][1]; prevWheelQ[i][2] = currWheelQ[i][2]; prevWheelQ[i][3] = currWheelQ[i][3];
        }
        currAt = now;
        currPos[0] = s.pos[0]; currPos[1] = s.pos[1]; currPos[2] = s.pos[2];
        currQuat[0] = s.quat[0]; currQuat[1] = s.quat[1]; currQuat[2] = s.quat[2]; currQuat[3] = s.quat[3];
        currVel[0] = s.vel[0]; currVel[1] = s.vel[1]; currVel[2] = s.vel[2];
        for (let i = 0; i < s.wheels.length && i < 4; i++) {
          const w = s.wheels[i];
          currWheelP[i][0] = w.px; currWheelP[i][1] = w.py; currWheelP[i][2] = w.pz;
          currWheelQ[i][0] = w.qx; currWheelQ[i][1] = w.qy; currWheelQ[i][2] = w.qz; currWheelQ[i][3] = w.qw;
        }
      }

      bridge.lastSnapAt = now;
      bridge.snapCount += 1;
      if (typeof bridge.onSnap === 'function') bridge.onSnap(s);
    }
  };

  // Per-render dead-reckoning. Call once per rAF before reading
  // chassisBody.interpolatedPosition / wheel.worldTransform.
  //
  // Two-stage pipeline:
  //   1. Compute a target pose by forward-extrapolating from the
  //      latest snapshot (zero added input lag).
  //   2. Critically-damp the *displayed* pose toward that target.
  //
  // Stage 2 is what eats the worker's setInterval jitter (snapshots
  // arrive 16–22 ms apart, not exactly 16.67). Without it, every
  // late-arriving snapshot snaps the visual backward by a few mm
  // since we'd already extrapolated ahead — perceived as a small
  // bob in place during steady acceleration / coasting / braking.
  // The smoothing tau is small enough (~30 ms) that the added lag
  // is sub-frame at 60 fps and invisible to input feel.
  let _dispInit = false;
  const _dispPos = [0, 0, 0];
  const _dispQuat = [0, 0, 0, 1];
  const _dispWheelP = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const _dispWheelQ = [[0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1]];
  let _lastInterpAt = 0;
  // Smoothing time constants (seconds). Position is smoothed a touch
  // tighter than orientation because translation jitter is more
  // visible (chassis "shimmies"); rotation jitter is less obvious
  // because the chassis is small. Wheels track chassis pos.
  const POS_TAU   = 0.030;
  const QUAT_TAU  = 0.045;
  const WHEEL_TAU = 0.030;

  bridge.interpolate = (now) => {
    if (!havePrev) return;

    // ── Stage 1: build extrapolated target pose ──────────────
    // Position: forward-extrapolate from latest snapshot using its
    // velocity. dt is bounded so a stalled worker can't fling the
    // visual past the authoritative pose.
    let dt = (now - currAt) / 1000;
    if (dt < 0) dt = 0;
    else if (dt > MAX_EXTRAP_MS / 1000) dt = MAX_EXTRAP_MS / 1000;
    const tgtX = currPos[0] + currVel[0] * dt;
    const tgtY = currPos[1] + currVel[1] * dt;
    const tgtZ = currPos[2] + currVel[2] * dt;

    // Orientation: nlerp prev→curr, allowing alpha > 1 for forward
    // extrapolation while the next snap is in flight. Clamped at 1.5
    // (≈ one full extra physics tick) so a stalled worker can't spin
    // the chassis arbitrarily.
    const interval = currAt - prevAt;
    let alpha = interval > 0 ? (now - prevAt) / interval : 1;
    if (alpha < 0) alpha = 0;
    else if (alpha > 1.5) alpha = 1.5;
    nlerp(prevQuat, currQuat, alpha, _qOut);
    const tgtQx = _qOut[0], tgtQy = _qOut[1], tgtQz = _qOut[2], tgtQw = _qOut[3];

    // ── Stage 2: critically-damped smoothing toward target ───
    // Render-time delta (not physics dt). Bounded so a tab-switch
    // doesn't slam the visual through a giant blend.
    let rdt = _lastInterpAt > 0 ? (now - _lastInterpAt) / 1000 : 1 / 60;
    if (rdt < 0) rdt = 0;
    else if (rdt > 0.10) rdt = 0.10;
    _lastInterpAt = now;

    if (!_dispInit) {
      // Snap on first frame so the kart doesn't ease in from origin.
      _dispPos[0] = tgtX; _dispPos[1] = tgtY; _dispPos[2] = tgtZ;
      _dispQuat[0] = tgtQx; _dispQuat[1] = tgtQy; _dispQuat[2] = tgtQz; _dispQuat[3] = tgtQw;
      _dispInit = true;
    } else {
      const kPos  = 1 - Math.exp(-rdt / POS_TAU);
      const kQuat = 1 - Math.exp(-rdt / QUAT_TAU);
      _dispPos[0] += (tgtX - _dispPos[0]) * kPos;
      _dispPos[1] += (tgtY - _dispPos[1]) * kPos;
      _dispPos[2] += (tgtZ - _dispPos[2]) * kPos;
      // nlerp current displayed quat → target quat by kQuat.
      const tgtQ = [tgtQx, tgtQy, tgtQz, tgtQw];
      nlerp(_dispQuat, tgtQ, kQuat, _qOut);
      _dispQuat[0] = _qOut[0]; _dispQuat[1] = _qOut[1]; _dispQuat[2] = _qOut[2]; _dispQuat[3] = _qOut[3];
    }

    chassisBody.interpolatedPosition.x = _dispPos[0];
    chassisBody.interpolatedPosition.y = _dispPos[1];
    chassisBody.interpolatedPosition.z = _dispPos[2];
    chassisBody.interpolatedQuaternion.x = _dispQuat[0];
    chassisBody.interpolatedQuaternion.y = _dispQuat[1];
    chassisBody.interpolatedQuaternion.z = _dispQuat[2];
    chassisBody.interpolatedQuaternion.w = _dispQuat[3];

    // Wheel transforms: lerp/extrap pos with the same alpha as
    // orientation, then critically-damp toward the result so wheels
    // don't shimmy independently of the chassis.
    const kWheel = _dispInit ? (1 - Math.exp(-rdt / WHEEL_TAU)) : 1;
    for (let i = 0; i < 4; i++) {
      const wt = vehicle.wheelInfos[i].worldTransform;
      const wtgtX = prevWheelP[i][0] + (currWheelP[i][0] - prevWheelP[i][0]) * alpha;
      const wtgtY = prevWheelP[i][1] + (currWheelP[i][1] - prevWheelP[i][1]) * alpha;
      const wtgtZ = prevWheelP[i][2] + (currWheelP[i][2] - prevWheelP[i][2]) * alpha;
      _dispWheelP[i][0] += (wtgtX - _dispWheelP[i][0]) * kWheel;
      _dispWheelP[i][1] += (wtgtY - _dispWheelP[i][1]) * kWheel;
      _dispWheelP[i][2] += (wtgtZ - _dispWheelP[i][2]) * kWheel;
      wt.position.x = _dispWheelP[i][0];
      wt.position.y = _dispWheelP[i][1];
      wt.position.z = _dispWheelP[i][2];
      nlerp(prevWheelQ[i], currWheelQ[i], alpha, _qOut);
      const wtgtQ = [_qOut[0], _qOut[1], _qOut[2], _qOut[3]];
      nlerp(_dispWheelQ[i], wtgtQ, kWheel, _qOut);
      _dispWheelQ[i][0] = _qOut[0]; _dispWheelQ[i][1] = _qOut[1]; _dispWheelQ[i][2] = _qOut[2]; _dispWheelQ[i][3] = _qOut[3];
      wt.quaternion.x = _qOut[0]; wt.quaternion.y = _qOut[1]; wt.quaternion.z = _qOut[2]; wt.quaternion.w = _qOut[3];
    }
  };

  worker.postMessage({
    type: 'init',
    staticBodies,
    drivableCells: Array.from(drivableCells || []),
    tile,
    spawnPos,
    spawnRot,
    physicsSubsteps: perfBudget?.physicsSubsteps ?? 3,
  });

  bridge.sendKeys = (keys) => worker.postMessage({ type: 'keys', keys });
  bridge.sendCombat = (state) => worker.postMessage({ type: 'combat', state });
  bridge.recover = () => worker.postMessage({ type: 'recover' });
  bridge.respawn = () => worker.postMessage({ type: 'respawn' });
  bridge.setPaused = (value) => worker.postMessage({ type: 'pause', value });
  bridge.shutdown = () => {
    worker.postMessage({ type: 'shutdown' });
    worker.terminate();
  };

  return bridge;
}
