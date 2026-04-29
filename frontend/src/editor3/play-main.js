/**
 * play-main.js — Playtest runtime.
 *
 * Loads a track (from URL ?track=<code> or sessionStorage) and lets the
 * user drive a kart around it using cannon-es RaycastVehicle.
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { TILE, decodeTrack, Track } from './track-data.js';
import { SEGMENTS } from './segments.js';
import { buildSegmentMesh, buildSegmentBody, getDrivableTopY } from './segment-builder.js';
import { cloneKart } from './kart-loader.js';
import { resolveSelectedKartId, getKart } from './kart-catalog.js';
import { DecorStore, buildDecorMesh } from './decor.js';
import { WORLD_UNITS_PER_M, m as M, mm as MM } from './units.js';
import { buildCombatState, sweepKart, tickRespawns } from './combat-runtime.js';

// Playtest runs in world units where 1 unit = 1 mm.
// (TILE arrives from track-data already in world units.)

// ── Scene ─────────────────────────────────────────────────────
const canvas = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0d12);
scene.fog = new THREE.Fog(0x0a0d12, TILE * 15, TILE * 50);

const camera = new THREE.PerspectiveCamera(70, 1, M(0.1), M(2000));

const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(M(60), M(120), M(40));
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -M(120); sun.shadow.camera.right = M(120);
sun.shadow.camera.top = M(120); sun.shadow.camera.bottom = -M(120);
sun.shadow.camera.near = M(1); sun.shadow.camera.far = M(400);
scene.add(sun);
scene.add(new THREE.AmbientLight(0x6b7a92, 0.55));
scene.add(new THREE.HemisphereLight(0x88aaff, 0x222530, 0.4));

// Ground (visual + physics)
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(M(2000), M(2000)),
  new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ── Physics world ─────────────────────────────────────────────
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -M(25), 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;
world.defaultContactMaterial.friction = 0.4;

const groundMat = new CANNON.Material('ground');
const wheelMat = new CANNON.Material('wheel');
const groundWheelContact = new CANNON.ContactMaterial(groundMat, wheelMat, {
  friction: 0.65, restitution: 0.05,
});
world.addContactMaterial(groundWheelContact);

const groundBody = new CANNON.Body({
  mass: 0, material: groundMat,
  shape: new CANNON.Plane(),
});
groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
world.addBody(groundBody);

// ── Load track from URL/storage ───────────────────────────────
function loadTrack() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('track') || sessionStorage.getItem('gloKartsStudio.playtest');
  if (code) {
    const t = decodeTrack(code);
    if (t) return t;
  }
  // Fallback: small demo track
  const t = new Track();
  t.place('spawn', 0, 0, 0);
  t.place('straight', 0, 1, 0);
  t.place('straight', 0, 2, 0);
  t.place('finish', 0, 3, 0);
  return t;
}

const track = loadTrack();

// Load decor (Tinkercad-style props placed in the editor) so the playtest
// scene renders the user's full design 1:1. Decor is stored separately from
// the track-share code because it can be much larger; we read it back from
// sessionStorage when the player came from the editor.
const decor = new DecorStore();
try {
  const raw = sessionStorage.getItem('gloKartsStudio.playtest.decor');
  if (raw) decor.fromJSON(JSON.parse(raw));
} catch (err) {
  console.warn('[play] failed to load decor', err);
}
for (const inst of decor.all()) {
  const mesh = buildDecorMesh(inst);
  if (mesh) scene.add(mesh);
  // Static collider so karts collide with placed shapes (uses the AABB of
  // the rendered mesh — accurate enough for boxes/walls/pillars and
  // conservative for round shapes).
  if (mesh && typeof CANNON !== 'undefined') {
    const bb = new THREE.Box3().setFromObject(mesh);
    const sz = new THREE.Vector3(); bb.getSize(sz);
    const ctr = new THREE.Vector3(); bb.getCenter(ctr);
    if (sz.x > 0 && sz.y > 0 && sz.z > 0) {
      const body = new CANNON.Body({ mass: 0, material: groundMat });
      body.addShape(new CANNON.Box(new CANNON.Vec3(sz.x / 2, sz.y / 2, sz.z / 2)));
      body.position.set(ctr.x, ctr.y, ctr.z);
      world.addBody(body);
    }
  }
}

// Build all segments: visual + collider
const placedBodies = [];
// Collect finish-line placements so we can detect lap completion.
/** @type {{gx:number,gz:number,rot:number,forward:THREE.Vector3,center:THREE.Vector3}[]} */
const finishLines = [];
// Map placement id → THREE.Group containing the overlay's pickup cube /
// orb / paint patch. Used to hide the cube while the pickup is on
// respawn cooldown and show it again when re-armed.
/** @type {Map<number, THREE.Group>} */
const overlayMeshById = new Map();
for (const p of track.all()) {
  const mesh = buildSegmentMesh(p.key);
  mesh.position.set(p.gx * TILE, 0, p.gz * TILE);
  mesh.rotation.y = -p.rot * Math.PI / 2;
  scene.add(mesh);

  const body = buildSegmentBody(
    p.key,
    { x: p.gx * TILE, y: 0, z: p.gz * TILE },
    -p.rot * Math.PI / 2,
  );
  if (body) {
    body.material = groundMat;
    world.addBody(body);
    placedBodies.push(body);
  }

  if (SEGMENTS[p.key]?.runtime) overlayMeshById.set(p.id, mesh);

  if (SEGMENTS[p.key]?.isFinish) {
    const rotY = -p.rot * Math.PI / 2;
    // Segment-local forward is +Z; apply rotation to get world forward.
    const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    finishLines.push({
      gx: p.gx, gz: p.gz, rot: p.rot,
      forward,
      center: new THREE.Vector3(p.gx * TILE, 0, p.gz * TILE),
    });
  }
}

// ── Kart (RaycastVehicle) ─────────────────────────────────────
const KART_MASS = 150;
const CHASSIS_HX = M(0.6), CHASSIS_HY = M(0.3), CHASSIS_HZ = M(1.0);
const WHEEL_RADIUS = M(0.4);

const chassisShape = new CANNON.Box(new CANNON.Vec3(CHASSIS_HX, CHASSIS_HY, CHASSIS_HZ));
const chassisBody = new CANNON.Body({ mass: KART_MASS });
chassisBody.addShape(chassisShape);
// Linear damping helps reverse-glide stop quickly; angular damping kills
// residual yaw spin so the chassis settles instead of weather-vaning,
// which is what made the third-person camera feel "swimmy".
chassisBody.linearDamping = 0.05;
chassisBody.angularDamping = 0.6;

// Spawn position: center of spawn cell, slightly above
const spawnPlacement = track.spawn();
const spawnPos = spawnPlacement
  ? { x: spawnPlacement.gx * TILE, y: getDrivableTopY(spawnPlacement.key) + M(1.0), z: spawnPlacement.gz * TILE }
  : { x: 0, y: M(1.5), z: 0 };
const spawnRot = spawnPlacement ? -spawnPlacement.rot * Math.PI / 2 : 0;

chassisBody.position.set(spawnPos.x, spawnPos.y, spawnPos.z);
chassisBody.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), spawnRot);
world.addBody(chassisBody);

const vehicle = new CANNON.RaycastVehicle({
  chassisBody,
  indexRightAxis: 0,    // x
  indexUpAxis: 1,       // y
  indexForwardAxis: 2,  // z
});

const wheelOptions = {
  radius: WHEEL_RADIUS,
  directionLocal: new CANNON.Vec3(0, -1, 0),
  // Stiffer suspension + matched damping → less body roll/pitch wobble that
  // the camera was over-compensating for. Mario-Kart-feel comes from a
  // chassis that *barely* tilts even on cornering, so we crank these up.
  suspensionStiffness: 55,
  suspensionRestLength: M(0.32),
  // Higher slip = more grip = less drifty. We pair this with manual
  // lateral-velocity damping so the kart feels planted, not on rails.
  frictionSlip: 4.5,
  dampingRelaxation: 3.2,
  dampingCompression: 5.5,
  maxSuspensionForce: M(100000),
  // Almost zero roll influence so the chassis doesn't lean into corners
  // (which fed back into the camera and made it sway).
  rollInfluence: 0.0,
  axleLocal: new CANNON.Vec3(-1, 0, 0),
  chassisConnectionPointLocal: new CANNON.Vec3(),
  maxSuspensionTravel: M(0.28),
  customSlidingRotationalSpeed: -30,
  useCustomSlidingRotationalSpeed: true,
};

const WHEEL_X = CHASSIS_HX + M(0.05);
const WHEEL_Z = CHASSIS_HZ * 0.75;
const WHEEL_Y = -CHASSIS_HY * 0.5;
[
  [-WHEEL_X, WHEEL_Y, -WHEEL_Z],   // rear left
  [ WHEEL_X, WHEEL_Y, -WHEEL_Z],   // rear right
  [-WHEEL_X, WHEEL_Y,  WHEEL_Z],   // front left
  [ WHEEL_X, WHEEL_Y,  WHEEL_Z],   // front right
].forEach((p) => {
  wheelOptions.chassisConnectionPointLocal.set(p[0], p[1], p[2]);
  vehicle.addWheel(wheelOptions);
});
vehicle.addToWorld(world);

// Wheel visuals + chassis visual
const kartGroup = new THREE.Group();
// Placeholder box + head — replaced in-place when the real GLB loads.
const placeholderChassis = new THREE.Mesh(
  new THREE.BoxGeometry(CHASSIS_HX * 2, CHASSIS_HY * 2, CHASSIS_HZ * 2),
  new THREE.MeshStandardMaterial({ color: 0xff3aa1, roughness: 0.5, metalness: 0.2, transparent: true, opacity: 0.9 }),
);
placeholderChassis.castShadow = true;
kartGroup.add(placeholderChassis);
const placeholderHead = new THREE.Mesh(
  new THREE.SphereGeometry(M(0.22), 12, 10),
  new THREE.MeshStandardMaterial({ color: 0x00e5ff }),
);
placeholderHead.position.set(0, CHASSIS_HY + M(0.22), -M(0.1));
placeholderHead.castShadow = true;
kartGroup.add(placeholderHead);
scene.add(kartGroup);

// Swap in the real kart GLB once it loads.
const SELECTED_KART_ID = resolveSelectedKartId();
const selectedKart = getKart(SELECTED_KART_ID);
document.getElementById('trackName').textContent = `${track.name} · ${selectedKart.label}`;
let kartModel = null;
cloneKart(SELECTED_KART_ID, 0xff3aa1).then((model) => {
  // Raise so the chassis box center sits on the kart center of gravity:
  // the kart template has y=0 at wheel contact, so shift down slightly
  // so the RaycastVehicle rays (cast from chassis center downward) land
  // near the visual wheels.
  model.position.y = -CHASSIS_HY;
  kartGroup.add(model);
  kartModel = model;
  // Hide placeholders but keep them in the tree for quick fallback.
  placeholderChassis.visible = false;
  placeholderHead.visible = false;
  // Kart GLB includes its own wheels — hide the RaycastVehicle debug cylinders.
  wheelsGroup.visible = false;
}).catch((err) => {
  console.warn('[play] kart load failed, keeping placeholder', err);
});

const wheelMeshes = [];
const wheelsGroup = new THREE.Group();
wheelsGroup.name = 'debug-wheels';
scene.add(wheelsGroup);
const wheelGeo = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, M(0.25), 14);
wheelGeo.rotateZ(Math.PI / 2);
const wheelMatTHREE = new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.9 });
for (let i = 0; i < 4; i++) {
  const m = new THREE.Mesh(wheelGeo, wheelMatTHREE);
  m.castShadow = true;
  wheelsGroup.add(m);
  wheelMeshes.push(m);
}

// ── Input ─────────────────────────────────────────────────────
const keys = { w: false, a: false, s: false, d: false, space: false, drift: false };
const KEYMAP = {
  KeyW: 'w', ArrowUp: 'w',
  KeyS: 's', ArrowDown: 's',
  KeyA: 'a', ArrowLeft: 'a',
  KeyD: 'd', ArrowRight: 'd',
  Space: 'space',
  ShiftLeft: 'drift', ShiftRight: 'drift',
};
window.addEventListener('keydown', (e) => {
  if (KEYMAP[e.code]) { keys[KEYMAP[e.code]] = true; e.preventDefault(); }
  if (e.code === 'KeyR') respawn();
  if (e.code === 'Escape') togglePause();
});
window.addEventListener('keyup', (e) => {
  if (KEYMAP[e.code]) { keys[KEYMAP[e.code]] = false; e.preventDefault(); }
});

function respawn() {
  chassisBody.velocity.set(0, 0, 0);
  chassisBody.angularVelocity.set(0, 0, 0);
  chassisBody.position.set(spawnPos.x, spawnPos.y, spawnPos.z);
  chassisBody.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), spawnRot);
  controlState.steer = 0;
  controlState.throttle = 0;
  controlState.driftHopCooldown = 0;
}

// ── Handling tunables (Mario-Kart-flavoured arcade) ───────────
// Engine force scales with current speed so acceleration is punchy at
// low speeds and tapers at top end (gives the classic arcade snap).
const MAX_ENGINE = M(2200);          // peak forward force
const REVERSE_ENGINE = M(900);       // reverse is weaker, like every kart racer
const MAX_BRAKE = M(80);
const HANDBRAKE_FORCE = M(160);
// Top speed is enforced by tapering engine force, not by clamping velocity
// (clamping fights the physics solver and feels rubbery).
const TOP_SPEED_MS = M(38);          // ≈ 137 km/h after WORLD_UNITS conversion
const REVERSE_TOP_SPEED_MS = M(14);
// Steering: full lock at low speed, ~40% lock at top speed. This single
// curve eliminates 90% of the "loose at speed / sluggish in pits" feeling.
const STEER_LOCK_LOW = 0.62;         // radians at standstill
const STEER_LOCK_HIGH = 0.24;        // radians at TOP_SPEED_MS
// Steering ramps in/out instead of snapping, so taps don't yaw-flick the
// camera. ~150ms full-press → full-lock.
const STEER_RAMP_IN_PER_S = 7.0;
const STEER_RAMP_OUT_PER_S = 12.0;
// Lateral grip: kill sideways velocity each frame. 0 = ice, 1 = on-rails.
// 0.85 gives a Mario Kart "cling-to-corner" feel without preventing drifts.
const LATERAL_GRIP = 0.88;
const LATERAL_GRIP_DRIFT = 0.55;     // looser when drift held
// Constant downforce keeps wheels planted on jumps/crests.
const DOWNFORCE_PER_MS = M(1.4);     // applied per m/s of forward speed
// Drift hop pulse — small upward impulse when shift is tapped while moving.
const DRIFT_HOP_VY = M(7.5);
const DRIFT_HOP_COOLDOWN_S = 0.5;

const controlState = {
  steer: 0,           // smoothed steering -1..+1
  throttle: 0,        // smoothed throttle -1..+1
  driftHopCooldown: 0,
  lastDriftPress: false,
};

// Reusable scratch vectors (avoid GC churn in tick loop).
const _fwd = new CANNON.Vec3();
const _right = new CANNON.Vec3();
const _up = new CANNON.Vec3();
const _vel = new CANNON.Vec3();

function applyControls(dt) {
  const now = performance.now();
  // ── Resolve raw input (-1..+1)
  const rawAccel = (keys.w ? 1 : 0) + (keys.s ? -1 : 0);
  const rawSteer = (keys.a ? 1 : 0) + (keys.d ? -1 : 0);
  const braking = keys.space;
  const drifting = keys.drift && Math.abs(controlState.throttle) > 0.1;

  // ── Smooth throttle (instant response on press, gentle decay on release
  // so the chassis doesn't lurch when you tap-drive).
  const throttleTarget = rawAccel;
  const throttleRate = (throttleTarget !== 0) ? 6.0 : 3.0;
  controlState.throttle += (throttleTarget - controlState.throttle) * Math.min(1, throttleRate * dt);

  // ── Smooth steering with separate ramp-in / ramp-out rates.
  const steerTarget = rawSteer;
  const ramping = (Math.sign(steerTarget) === Math.sign(controlState.steer) && steerTarget !== 0);
  const steerRate = ramping ? STEER_RAMP_IN_PER_S : STEER_RAMP_OUT_PER_S;
  controlState.steer += (steerTarget - controlState.steer) * Math.min(1, steerRate * dt);

  // ── Compute current forward speed (signed, in m/s of world units).
  chassisBody.quaternion.vmult(new CANNON.Vec3(0, 0, 1), _fwd);
  chassisBody.quaternion.vmult(new CANNON.Vec3(1, 0, 0), _right);
  chassisBody.quaternion.vmult(new CANNON.Vec3(0, 1, 0), _up);
  const v = chassisBody.velocity;
  const speedFwd = v.dot(_fwd);          // signed forward speed (world u/s)
  const speedAbs = Math.abs(speedFwd);
  const speedRatio = Math.min(1, speedAbs / TOP_SPEED_MS);

  // ── Engine force with top-speed taper + boost/slow modulation.
  // Forward intent (W) drives chassis along +Z (handled by the −sign below
  // for cannon-es RaycastVehicle's convention).
  let mult = 1.0;
  if (now < playerCombat.boostUntil) mult *= (1 + playerCombat.boostStrength);
  if (now < playerCombat.slowUntil) mult *= (1 - playerCombat.slowStrength);
  const intent = controlState.throttle;
  let engineMag;
  if (intent >= 0) {
    // Tapered curve: full force until 70% top speed, then ramp to 0 at 100%.
    const taper = (speedFwd >= 0) ? Math.max(0, 1 - Math.max(0, (speedFwd - TOP_SPEED_MS * 0.7) / (TOP_SPEED_MS * 0.3))) : 1;
    engineMag = intent * MAX_ENGINE * taper * mult;
  } else {
    const taper = (speedFwd <= 0) ? Math.max(0, 1 - Math.max(0, (-speedFwd - REVERSE_TOP_SPEED_MS * 0.7) / (REVERSE_TOP_SPEED_MS * 0.3))) : 1;
    engineMag = intent * REVERSE_ENGINE * taper * mult;
  }
  const force = -engineMag;            // cannon-es convention (see comment above)

  // ── Speed-sensitive steering lock.
  const steerLock = STEER_LOCK_LOW + (STEER_LOCK_HIGH - STEER_LOCK_LOW) * speedRatio;
  // Steering inverts on reverse so left/right feels natural backing up.
  const steerSign = (speedFwd < -M(0.5)) ? -1 : 1;
  const oilNow = now < playerCombat.oilUntil;
  const oilJitter = oilNow ? (Math.random() * 2 - 1) * 0.4 : 0;
  const steerCmd = (controlState.steer * steerSign + oilJitter) * steerLock;
  vehicle.setSteeringValue(steerCmd, 2);
  vehicle.setSteeringValue(steerCmd, 3);

  // ── All-wheel drive: engine force on every wheel keeps acceleration
  // consistent regardless of which wheels are loaded over crests.
  vehicle.applyEngineForce(force, 0);
  vehicle.applyEngineForce(force, 1);
  vehicle.applyEngineForce(force, 2);
  vehicle.applyEngineForce(force, 3);

  // ── Brake / handbrake. Space = service brake (all wheels). Drift +
  // brake = handbrake on rear axle for tight rotation.
  let brakeRear = braking ? MAX_BRAKE : 0;
  let brakeFront = braking ? MAX_BRAKE : 0;
  if (drifting && braking) brakeRear = HANDBRAKE_FORCE;
  vehicle.setBrake(brakeRear, 0);
  vehicle.setBrake(brakeRear, 1);
  vehicle.setBrake(brakeFront, 2);
  vehicle.setBrake(brakeFront, 3);

  // ── Drift hop (Shift tap). Provides the visual/feel cue that drift
  // mode just engaged. Must press, not hold.
  controlState.driftHopCooldown = Math.max(0, controlState.driftHopCooldown - dt);
  if (keys.drift && !controlState.lastDriftPress
      && controlState.driftHopCooldown <= 0
      && (speedAbs > M(0.5) || Math.abs(intent) > 0.05)) {
    // Bump vy AND fire an impulse so the wheel suspension can't instantly
    // reel the chassis back to the road plane.
    chassisBody.velocity.y = Math.max(chassisBody.velocity.y, DRIFT_HOP_VY);
    chassisBody.applyImpulse(new CANNON.Vec3(0, KART_MASS * DRIFT_HOP_VY * 0.5, 0), new CANNON.Vec3(0, 0, 0));
    controlState.driftHopCooldown = DRIFT_HOP_COOLDOWN_S;
  }
  controlState.lastDriftPress = keys.drift;

  // ── Lateral grip: damp the sideways component of chassis velocity each
  // frame. This is the single biggest fix for the "loose" feel — the
  // RaycastVehicle's built-in friction cone alone isn't enough at this
  // mass + scale.
  const grip = drifting ? LATERAL_GRIP_DRIFT : LATERAL_GRIP;
  const lateralSpeed = v.dot(_right);
  const dampingFactor = 1 - Math.min(1, grip * dt * 12);  // exponential-ish
  // Subtract the right-vector component scaled by (1 - dampingFactor).
  const cut = lateralSpeed * (1 - dampingFactor);
  v.x -= _right.x * cut;
  v.y -= _right.y * cut;
  v.z -= _right.z * cut;

  // ── Downforce so jumps don't drift forever and high-speed cornering
  // doesn't lift the inside wheels.
  const df = DOWNFORCE_PER_MS * speedAbs;
  chassisBody.force.y -= df * KART_MASS;

  // ── Auto-righting: when airborne (no wheels on ground) gently rotate
  // chassis upright so we land on wheels, not on the roof. Mario Kart
  // does this aggressively; we keep it subtle.
  let onGround = 0;
  for (let i = 0; i < vehicle.wheelInfos.length; i++) {
    if (vehicle.wheelInfos[i].isInContact) onGround++;
  }
  if (onGround === 0) {
    // Cross product (chassisUp × worldUp(0,1,0)) gives the axis to torque
    // around to align the kart upright. Result = (upZ, 0, -upX).
    chassisBody.torque.x += _up.z * KART_MASS * M(8);
    chassisBody.torque.z += -_up.x * KART_MASS * M(8);
  }
}

// ── Camera follow (Mario-Kart-style) ──────────────────────────
// Key principles to fix the "over-compensating" feel:
//   1. Camera tracks a SMOOTHED yaw, not the raw chassis quaternion. The
//      chassis can wobble within the suspension; the camera shouldn't.
//   2. Pitch + roll are NEVER copied from the chassis — camera always
//      stays roughly horizontal regardless of slopes/jumps.
//   3. Look-ahead extends with forward speed so fast cornering feels
//      readable instead of "behind the action".
//   4. Position lerp uses a critically-damped spring, frame-rate
//      independent (1 - exp(-k·dt)), not a fixed alpha.
//   5. FOV stretches mildly with speed for the arcade speed sensation.
const CAM_DIST = M(11);
const CAM_HEIGHT = M(5.0);
const CAM_LOOK_HEIGHT = M(1.4);
const CAM_LOOK_AHEAD_BASE = M(4);
const CAM_LOOK_AHEAD_PER_MS = 0.18;     // adds metres per m/s of speed
const CAM_POS_SPRING = 6.5;             // higher = snappier
const CAM_YAW_SPRING = 5.5;             // separate so yaw can be slower than position
const CAM_LOOK_SPRING = 9.0;
const CAM_FOV_BASE = 70;
const CAM_FOV_BOOST = 14;               // +14° at top speed
const CAM_FOV_BOOST_BONUS = 6;          // extra +6° while a boost pad is active

camera.fov = CAM_FOV_BASE;

const camSmoothed = {
  yaw: 0,                               // smoothed chassis yaw (radians)
  initialised: false,
};
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();

const _camTmp = new THREE.Vector3();
const _camOrigin = new THREE.Vector3();
const _camForward = new THREE.Vector3();

function shortestAngleDelta(a, b) {
  // Returns shortest signed angle from a → b in [-π, π].
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function updateCamera(dt) {
  // Extract chassis yaw from quaternion (rotation around world-Y).
  // yaw = atan2(2(wy + xz), 1 - 2(y² + z²))   ← standard quat-to-yaw
  const q = chassisBody.quaternion;
  const sinyCosp = 2 * (q.w * q.y + q.x * q.z);
  const cosyCosp = 1 - 2 * (q.y * q.y + q.x * q.x);
  const chassisYaw = Math.atan2(sinyCosp, cosyCosp);

  // Lazy-init: snap on first frame so we don't fly in from origin.
  if (!camSmoothed.initialised) {
    camSmoothed.yaw = chassisYaw;
    camSmoothed.initialised = true;
  }

  // Velocity-aware yaw smoothing: when nearly stopped, freeze the camera
  // yaw so spinning the wheels in place doesn't whip the camera around.
  const speedAbs = chassisBody.velocity.length();
  const yawAuthority = Math.min(1, speedAbs / M(2));   // 0 below 2 m/s
  const yawDelta = shortestAngleDelta(camSmoothed.yaw, chassisYaw);
  // Frame-rate independent exponential smoothing.
  const yawAlpha = 1 - Math.exp(-CAM_YAW_SPRING * yawAuthority * dt);
  camSmoothed.yaw += yawDelta * yawAlpha;

  // Build desired camera position from smoothed yaw only (no roll/pitch).
  // Forward vector (yaw only) = (sin(yaw), 0, cos(yaw)). Behind = -forward.
  _camOrigin.set(chassisBody.position.x, chassisBody.position.y, chassisBody.position.z);
  _camForward.set(Math.sin(camSmoothed.yaw), 0, Math.cos(camSmoothed.yaw));
  _camTmp.copy(_camForward).multiplyScalar(-CAM_DIST);
  _camTmp.y += CAM_HEIGHT;
  const desired = _camOrigin.clone().add(_camTmp);

  // Spring-damp camera position toward desired (frame-rate independent).
  const posAlpha = 1 - Math.exp(-CAM_POS_SPRING * dt);
  camPos.lerp(desired, posAlpha);
  camera.position.copy(camPos);

  // Look target: in front of the kart, height-locked, with speed-based
  // look-ahead so fast cornering shows the upcoming track.
  const lookAhead = CAM_LOOK_AHEAD_BASE + CAM_LOOK_AHEAD_PER_MS * speedAbs;
  const desiredLook = _camOrigin.clone()
    .add(_camForward.clone().multiplyScalar(lookAhead));
  desiredLook.y += CAM_LOOK_HEIGHT;
  const lookAlpha = 1 - Math.exp(-CAM_LOOK_SPRING * dt);
  camLook.lerp(desiredLook, lookAlpha);
  camera.lookAt(camLook);

  // FOV stretch with speed + extra kick during a boost pickup.
  const speedRatio = Math.min(1, speedAbs / TOP_SPEED_MS);
  let targetFov = CAM_FOV_BASE + CAM_FOV_BOOST * speedRatio;
  if (performance.now() < playerCombat.boostUntil) targetFov += CAM_FOV_BOOST_BONUS;
  camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-4.0 * dt));
  camera.updateProjectionMatrix();
}

// ── Render loop ───────────────────────────────────────────────
let lastTime = performance.now();
const speedEl = document.getElementById('speed');
const lapEl = document.getElementById('lap');

// Lap tracking: the kart must cross the finish line in the forward direction
// after having left the "near-finish" region. Very forgiving, single-lap
// tracks are the common case but we count up to 99 laps.
/** @type {{lap:number, lastSide:number|null, lapStartedAt:number, bestLap:number|null}} */
const lapState = { lap: 0, lastSide: null, lapStartedAt: performance.now(), bestLap: null };
const LAP_NEAR_RADIUS = TILE * 1.4; // only sample when near the line

// ── Combat overlays (Phase 1) ──────────────────────────────────
// Build a per-overlay state map, install a per-tick sweep that fires
// pickup/effect events, and project them onto a tiny HUD ticker. The
// kart's "active boost" timer feeds back into engine force so a freshly
// touched boost pad actually accelerates the chassis.
const combatState = buildCombatState(track.all());
const HUD_TICKER_MAX = 5;
const hudTickerEl = document.getElementById('combatTicker');
let hudTicker = [];
function pushTicker(text) {
  hudTicker.push({ text, until: performance.now() + 2200 });
  if (hudTicker.length > HUD_TICKER_MAX) hudTicker.shift();
}
function renderTicker(now) {
  if (!hudTickerEl) return;
  hudTicker = hudTicker.filter(t => t.until > now);
  hudTickerEl.textContent = hudTicker.map(t => t.text).join('  ·  ');
}
/** @type {{boostUntil:number, slowUntil:number, oilUntil:number, repairUntil:number, coins:number, hp:number, weapon:string|null, lastTouchedById:Map<number,number>}} */
const playerCombat = {
  boostUntil: 0, boostStrength: 0,
  slowUntil: 0, slowStrength: 0,
  oilUntil: 0,
  repairUntil: 0,
  coins: 0,
  hp: 100,
  weapon: null,
  lastTouchedById: new Map(),  // debounce: don't re-fire same effect every frame
};
// E2E hook — exposes the live combat state so smoke tests can assert
// against pickups without scraping the DOM. Read-only contract.
if (typeof window !== 'undefined') {
  window.__play = window.__play || {};
  window.__play.playerCombat = playerCombat;
  window.__play.combatState = combatState;
}
const EFFECT_DEBOUNCE_MS = 250;
function applyCombatEvents(events, now) {
  for (const ev of events) {
    if (ev.type === 'pickup') {
      const ent = combatState.get(ev.id);
      if (ent && overlayMeshById.has(ev.id)) {
        // Hide the floating pickup cube (cosmetic — the road disc on the
        // ground stays visible as a respawn marker).
        const grp = overlayMeshById.get(ev.id);
        grp.traverse(o => { if (o.isMesh && o.userData?.__pickupCube) o.visible = false; });
      }
      if (ev.payload === 'coin') {
        playerCombat.coins += ev.amount || 1;
        pushTicker(`+${ev.amount || 1} coin (${playerCombat.coins})`);
      } else if (ev.payload === 'health') {
        playerCombat.hp = Math.min(100, playerCombat.hp + (ev.amount || 25));
        pushTicker(`+${ev.amount || 25} HP (${playerCombat.hp})`);
      } else if (ev.payload === 'weapon_random' || ev.payload === 'weapon_heavy') {
        const pool = ev.payload === 'weapon_heavy'
          ? ['rocket', 'mine', 'mortar']
          : ['rocket', 'mine', 'shield', 'banana', 'boost_token'];
        const w = pool[(Math.random() * pool.length) | 0];
        playerCombat.weapon = w;
        pushTicker(`got ${w}`);
      }
    } else if (ev.type === 'effect') {
      const last = playerCombat.lastTouchedById.get(ev.id) || 0;
      if (now - last < EFFECT_DEBOUNCE_MS && ev.effect !== 'repair') continue;
      playerCombat.lastTouchedById.set(ev.id, now);
      if (ev.effect === 'boost') {
        playerCombat.boostUntil = now + (ev.durationMs || 1000);
        playerCombat.boostStrength = ev.strength || 0.3;
        pushTicker(`BOOST ×${(1 + playerCombat.boostStrength).toFixed(2)}`);
      } else if (ev.effect === 'slow') {
        playerCombat.slowUntil = now + (ev.durationMs || 600);
        playerCombat.slowStrength = ev.strength || 0.4;
        pushTicker(`SLOW ×${(1 - playerCombat.slowStrength).toFixed(2)}`);
      } else if (ev.effect === 'oil') {
        playerCombat.oilUntil = now + (ev.durationMs || 800);
        pushTicker(`OIL!`);
      } else if (ev.effect === 'repair') {
        // Continuous trickle while standing on the strip.
        const dt = 1 / 60;
        const gain = (ev.amountPerSec || 5) * dt;
        playerCombat.hp = Math.min(100, playerCombat.hp + gain);
      }
    }
  }
}

function tickCombat(now) {
  // Sweep against current kart position.
  const events = sweepKart(combatState, chassisBody.position.x, chassisBody.position.z, now);
  if (events.length) applyCombatEvents(events, now);
  // Re-arm cooled-down pickups + restore their cube visibility.
  const respawned = tickRespawns(combatState, now);
  for (const r of respawned) {
    const grp = overlayMeshById.get(r.id);
    if (grp) grp.traverse(o => { if (o.isMesh && o.userData?.__pickupCube) o.visible = true; });
  }
  renderTicker(now);
}

function updateLapTracking() {
  if (!finishLines.length) {
    if (lapEl) lapEl.textContent = '—';
    return;
  }
  const fl = finishLines[0];
  const kart = chassisBody.position;
  const dx = kart.x - fl.center.x;
  const dz = kart.z - fl.center.z;
  const planarDist = Math.sqrt(dx * dx + dz * dz);
  if (planarDist > LAP_NEAR_RADIUS) {
    // We've been clear of the line → arm the next crossing.
    if (lapState.lastSide !== null) lapState.lastSide = lapState.lastSide; // no-op, keep sign
    return;
  }
  // Signed distance along the forward axis (negative = behind, positive = past the line).
  // Treat exact-zero as "past the line" so we never lose state when the kart is right on it.
  const dot = dx * fl.forward.x + dz * fl.forward.z;
  const side = dot >= 0 ? 1 : -1;
  if (lapState.lastSide === null) {
    lapState.lastSide = side;
    return;
  }
  // Crossing from negative (before) to positive (past) counts as a lap.
  if (lapState.lastSide < 0 && side > 0) {
    const now = performance.now();
    const elapsed = (now - lapState.lapStartedAt) / 1000;
    // Ignore crossings within the first 2s (start-of-race double-count guard).
    if (lapState.lap === 0 || elapsed > 2.0) {
      lapState.lap += 1;
      if (lapState.lap > 1 && (lapState.bestLap == null || elapsed < lapState.bestLap)) {
        lapState.bestLap = elapsed;
      }
      lapState.lapStartedAt = now;
    }
  }
  lapState.lastSide = side;
  if (lapEl) {
    const bestStr = lapState.bestLap ? ` · best ${lapState.bestLap.toFixed(2)}s` : '';
    lapEl.textContent = `${lapState.lap}${bestStr}`;
  }
}

function tick() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  if (!paused) {
    applyControls(dt);
    world.step(1 / 60, dt, 3);
  }

  // Sync chassis visual
  kartGroup.position.copy(chassisBody.position);
  kartGroup.quaternion.copy(chassisBody.quaternion);

  // Sync wheel visuals
  for (let i = 0; i < vehicle.wheelInfos.length; i++) {
    vehicle.updateWheelTransform(i);
    const t = vehicle.wheelInfos[i].worldTransform;
    wheelMeshes[i].position.copy(t.position);
    wheelMeshes[i].quaternion.copy(t.quaternion);
  }

  updateCamera(dt);

  // HUD
  // velocity is in world units (mm) per second; convert mm/s → km/h.
  const speed = Math.round(chassisBody.velocity.length() * 3.6 / WORLD_UNITS_PER_M);
  speedEl.textContent = speed;
  if (!paused) updateLapTracking();
  if (!paused) tickCombat(now);

  // Auto-respawn if fallen off the world
  if (chassisBody.position.y < -M(20)) respawn();

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

document.getElementById('backBtn').addEventListener('click', () => {
  window.location.href = '/editor.html';
});

// ── Pause overlay ─────────────────────────────────────────────
let paused = false;
const pauseOverlay = document.getElementById('pauseOverlay');
function togglePause() {
  paused = !paused;
  if (pauseOverlay) pauseOverlay.classList.toggle('open', paused);
  // Drop inputs so the kart doesn't coast with held keys after resume.
  keys.w = keys.a = keys.s = keys.d = keys.space = false;
}
document.getElementById('resumeBtn')?.addEventListener('click', togglePause);
document.getElementById('respawnBtn')?.addEventListener('click', () => {
  respawn();
  togglePause();
});
document.getElementById('backBtn2')?.addEventListener('click', () => {
  window.location.href = '/editor.html';
});

// Multiplayer banner stub (room joins added in next phase)
const params = new URLSearchParams(window.location.search);
const roomCode = params.get('room');
if (roomCode) {
  const banner = document.getElementById('roomBanner');
  banner.style.display = '';
  banner.textContent = `Room ${roomCode}`;
  // Multiplayer hookup happens in mp-client.js, dynamically loaded.
  import('./mp-client.js').then(({ joinRoom }) => {
    joinRoom({ roomCode, track, chassisBody, scene, camera });
  }).catch(err => {
    console.warn('[play] multiplayer init failed', err);
    banner.textContent = `Solo (no realtime)`;
  });
}

requestAnimationFrame(tick);

window.__play = { world, vehicle, chassisBody, scene, camera, renderer, track, combatState, playerCombat, controlState, keys };
