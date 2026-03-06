/**
 * Havok Physics wrapper for GLO KARTS solo / battle modes.
 *
 * Spins up a headless Babylon.js NullEngine scene exclusively for physics.
 * Three.js keeps handling all rendering — call getKartTransform() each frame
 * to sync the visual mesh.
 */

import HavokPhysics from '@babylonjs/havok';
import {
  NullEngine,
  Scene,
  Vector3,
  Quaternion,
  MeshBuilder,
  Mesh,
  VertexData,
  HavokPlugin,
  PhysicsAggregate,
  PhysicsShapeType,
  PhysicsMotionType,
} from '@babylonjs/core';

const HAVOK_WASM_PATH = `${import.meta.env.BASE_URL}havok/HavokPhysics.wasm`;

// ── Module-level state ────────────────────────────────────────────────────
let _engine = null;
let _scene = null;
let _plugin = null;

let _kartMesh = null;
let _kartAggregate = null;

// ── Kart driving tuning (ported from colyseus-babylon-client applyLocalPrediction) ──
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

const GRAVITY = -20;

// ── Initialisation ────────────────────────────────────────────────────────

/**
 * Initialise the Havok physics engine (async).
 * Must be called once before any other physics function.
 */
export async function initPhysicsEngine() {
  _engine = new NullEngine();
  _scene = new Scene(_engine);

  const hk = await HavokPhysics({
    locateFile: (path) => (path.endsWith('.wasm') ? HAVOK_WASM_PATH : path),
  });

  _plugin = new HavokPlugin(true, hk);
  _scene.enablePhysics(new Vector3(0, GRAVITY, 0), _plugin);

  console.log('Havok physics engine initialised');
}

// ── Kart body ─────────────────────────────────────────────────────────────

const KART_WIDTH  = 2.0;
const KART_HEIGHT = 0.6;
const KART_DEPTH  = 4.0;
const KART_MASS   = 200;

/**
 * Create the kart physics body.
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
export function createKartBody(x = 0, y = 5.2, z = 0) {
  if (_kartMesh) {
    // Dispose previous if re-creating
    _kartAggregate?.dispose();
    _kartMesh.dispose();
  }

  _kartMesh = MeshBuilder.CreateBox(
    'kart-physics',
    { width: KART_WIDTH, height: KART_HEIGHT, depth: KART_DEPTH },
    _scene,
  );
  _kartMesh.position = new Vector3(x, y, z);
  _kartMesh.rotationQuaternion = Quaternion.Identity();

  _kartAggregate = new PhysicsAggregate(
    _kartMesh,
    PhysicsShapeType.BOX,
    { mass: KART_MASS, friction: 0.8, restitution: 0.1 },
    _scene,
  );

  // Lock inertia to Y axis only — prevents tipping
  _kartAggregate.body.setMassProperties({ inertia: new Vector3(0, 500, 0) });
}

// ── Track / arena collider from pre-extracted geometry ────────────────────

/**
 * Create a static triangle-mesh collider.
 * @param {Float32Array|number[]} positions  Flat xyz array
 * @param {Uint32Array|number[]}  indices    Triangle index array
 * @param {number}                friction   Surface friction (default 1.0)
 */
export function createTrackCollider(positions, indices, friction = 1.0) {
  const colliderMesh = new Mesh('track-collider', _scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.applyToMesh(colliderMesh);

  colliderMesh.isVisible = false;

  const agg = new PhysicsAggregate(
    colliderMesh,
    PhysicsShapeType.MESH,
    { mass: 0, friction, restitution: 0.05 },
    _scene,
  );

  return agg;
}

/**
 * Create a static box collider (for arena walls, ground, etc.).
 * @param {{x:number,y:number,z:number}} halfExtents
 * @param {{x:number,y:number,z:number}} position
 * @param {number}                       rotationY  Rotation around Y in radians
 * @param {number}                       friction
 */
export function createBoxCollider(halfExtents, position, rotationY = 0, friction = 0.6) {
  const box = MeshBuilder.CreateBox(
    'box-collider',
    { width: halfExtents.x * 2, height: halfExtents.y * 2, depth: halfExtents.z * 2 },
    _scene,
  );
  box.position = new Vector3(position.x, position.y, position.z);
  box.rotationQuaternion = Quaternion.FromEulerAngles(0, rotationY, 0);
  box.isVisible = false;

  const agg = new PhysicsAggregate(
    box,
    PhysicsShapeType.BOX,
    { mass: 0, friction, restitution: 0.05 },
    _scene,
  );

  return agg;
}

// ── Kart driving input ────────────────────────────────────────────────────

/**
 * Apply arcade kart physics for one tick.
 *
 * @param {{w:boolean, s:boolean, a:boolean, d:boolean}} keyState
 * @param {boolean} raceStarted
 * @param {boolean} raceFinished
 * @param {number}  dt  Fixed timestep (seconds)
 * @returns {{ speedKPH: number }}
 */
export function applyKartDriving(keyState, raceStarted, raceFinished, dt) {
  if (!_kartMesh || !_kartAggregate) return { speedKPH: 0 };

  const body = _kartAggregate.body;
  const transform = _kartMesh;

  const currentVel = body.getLinearVelocity();
  const currentAngVel = body.getAngularVelocity();

  const hSpeed = Math.sqrt(currentVel.x ** 2 + currentVel.z ** 2);
  const speedRatio = Math.min(hSpeed / MAX_SPEED, 1);
  const speedKPH = hSpeed * 3.6;

  // Clone velocity for mutation
  const nextVel = currentVel.clone();

  // ── Block driving when race hasn't started or is finished ──
  if (!raceStarted || raceFinished) {
    nextVel.x *= BRAKE_DRAG;
    nextVel.z *= BRAKE_DRAG;
    body.setLinearVelocity(nextVel);
    body.setAngularVelocity(new Vector3(
      currentAngVel.x * ROLL_DAMP,
      currentAngVel.y * 0.5,
      currentAngVel.z * PITCH_DAMP,
    ));
    return { speedKPH };
  }

  // ── Determine input ──
  const throttle = (keyState.w ? 1 : 0) + (keyState.s ? -1 : 0);
  const steer    = (keyState.a ? 1 : 0) + (keyState.d ? -1 : 0);
  const brake    = false; // Space / shift handled outside for now

  // ── Steering (yaw) ──
  const turnSpeed = TURN_BASE - (TURN_BASE - TURN_MIN) * speedRatio;
  if (steer !== 0 && hSpeed > 0.5) {
    const fwd = transform.forward.scale(-1);
    const isReversing = Vector3.Dot(currentVel, fwd) < -1;
    const dir = isReversing ? -1 : 1;
    const driftBoost = brake ? 1.3 : 1.0;
    const targetYaw = steer * turnSpeed * dir * driftBoost;

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

  // ── Acceleration ──
  let forwardDir = transform.forward.scale(-1);
  if (forwardDir.lengthSquared() > 0.00001) forwardDir.normalize();

  if (throttle > 0 && hSpeed < MAX_SPEED) {
    const falloff = 1 - speedRatio * speedRatio;
    const accel = ACCEL_FORCE * Math.max(falloff, 0.08) * dt;
    nextVel.x += forwardDir.x * accel;
    nextVel.z += forwardDir.z * accel;
  } else if (throttle < 0) {
    const accel = ACCEL_FORCE * 0.4 * dt;
    nextVel.x -= forwardDir.x * accel;
    nextVel.z -= forwardDir.z * accel;
  }

  // ── Braking / coasting drag ──
  if (brake) {
    nextVel.x *= BRAKE_DRAG;
    nextVel.z *= BRAKE_DRAG;
  } else if (throttle === 0) {
    nextVel.x *= COAST_DRAG;
    nextVel.z *= COAST_DRAG;
  }

  // ── Lateral grip (anti-slide) ──
  let rightDir = transform.right;
  if (rightDir.lengthSquared() > 0.00001) rightDir.normalize();
  const latSpeed = Vector3.Dot(nextVel, rightDir);
  const grip = brake ? LATERAL_GRIP * DRIFT_GRIP_MUL : LATERAL_GRIP;
  nextVel.x -= rightDir.x * latSpeed * grip;
  nextVel.z -= rightDir.z * latSpeed * grip;

  // ── Downforce ──
  if (hSpeed > 3) {
    nextVel.y -= DOWNFORCE * speedRatio * dt;
  }
  if (nextVel.y > 4) nextVel.y = 4; // cap upward bounce

  body.setLinearVelocity(nextVel);

  return { speedKPH };
}

// ── Step physics ──────────────────────────────────────────────────────────

/**
 * Advance the physics simulation by one frame.
 * Call this inside your fixed-timestep loop.
 */
export function stepPhysics() {
  if (_scene) _scene.render();
}

// ── Transform readback ────────────────────────────────────────────────────

/**
 * @returns {{ position: {x,y,z}, quaternion: {x,y,z,w} } | null}
 */
export function getKartTransform() {
  if (!_kartMesh) return null;
  const p = _kartMesh.position;
  const q = _kartMesh.rotationQuaternion;
  return {
    position:   { x: p.x, y: p.y, z: p.z },
    quaternion: { x: q.x, y: q.y, z: q.z, w: q.w },
  };
}

/**
 * Get the kart Y position (for fall-off checks).
 */
export function getKartY() {
  return _kartMesh ? _kartMesh.position.y : 0;
}

// ── Position reset / teleport ─────────────────────────────────────────────

/**
 * Teleport the kart to a given position and heading.
 * @param {{x:number,y:number,z:number}} position
 * @param {number} heading  Rotation around Y in radians
 */
export function resetKart(position, heading = 0) {
  if (!_kartMesh || !_kartAggregate) return;

  _kartMesh.position = new Vector3(position.x, position.y, position.z);
  _kartMesh.rotationQuaternion = Quaternion.FromEulerAngles(0, heading, 0);

  const body = _kartAggregate.body;
  body.setLinearVelocity(new Vector3(0, 0, 0));
  body.setAngularVelocity(new Vector3(0, 0, 0));
  body.disablePreStep = false;
}

// ── Cleanup ───────────────────────────────────────────────────────────────

export function dispose() {
  _kartAggregate?.dispose();
  _kartMesh?.dispose();
  _scene?.dispose();
  _engine?.dispose();
  _kartMesh = null;
  _kartAggregate = null;
  _scene = null;
  _engine = null;
  _plugin = null;
}
