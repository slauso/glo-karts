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
  suspensionStiffness: 30,
  suspensionRestLength: M(0.35),
  frictionSlip: 2.5,
  dampingRelaxation: 2.3,
  dampingCompression: 4.5,
  maxSuspensionForce: M(100000),
  rollInfluence: 0.01,
  axleLocal: new CANNON.Vec3(-1, 0, 0),
  chassisConnectionPointLocal: new CANNON.Vec3(),
  maxSuspensionTravel: M(0.3),
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
const keys = { w: false, a: false, s: false, d: false, space: false };
const KEYMAP = {
  KeyW: 'w', ArrowUp: 'w',
  KeyS: 's', ArrowDown: 's',
  KeyA: 'a', ArrowLeft: 'a',
  KeyD: 'd', ArrowRight: 'd',
  Space: 'space',
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
}

const MAX_ENGINE = M(1500);
const MAX_BRAKE = M(50);
const MAX_STEER = 0.55;

function applyControls() {
  // intent: +1 = drive forward (along chassis +Z, where the visible kart
  // nose and camera trail are aligned), -1 = reverse.
  const accel = (keys.w ? 1 : 0) + (keys.s ? -1 : 0);
  // cannon-es RaycastVehicle convention: applyEngineForce(+v) drives the
  // chassis in the −forward-axis direction. Negate so positive intent
  // (W) actually pushes the chassis along +Z toward the track.
  // Combat overlays modulate engine force: boost pads multiply, slow
  // strips divide, oil slicks zero out steering torque temporarily.
  const now = performance.now();
  let mult = 1.0;
  if (now < playerCombat.boostUntil) mult *= (1 + playerCombat.boostStrength);
  if (now < playerCombat.slowUntil) mult *= (1 - playerCombat.slowStrength);
  const force = -accel * MAX_ENGINE * mult;
  // Steering inverts on reverse so left/right feels natural backing up.
  const steerSign = accel < 0 ? -1 : 1;
  const oilNow = now < playerCombat.oilUntil;
  // Oil slick: random ±jitter to steering input so the kart wobbles.
  const oilJitter = oilNow ? (Math.random() * 2 - 1) * 0.5 : 0;
  const steer = (((keys.a ? 1 : 0) + (keys.d ? -1 : 0)) * steerSign) + oilJitter;
  const braking = keys.space;

  // Front wheels steer (indices 2, 3)
  vehicle.setSteeringValue(steer * MAX_STEER, 2);
  vehicle.setSteeringValue(steer * MAX_STEER, 3);

  // All wheels drive
  vehicle.applyEngineForce(force, 0);
  vehicle.applyEngineForce(force, 1);
  vehicle.applyEngineForce(force, 2);
  vehicle.applyEngineForce(force, 3);

  const brake = braking ? MAX_BRAKE : 0;
  for (let i = 0; i < 4; i++) vehicle.setBrake(brake, i);
}

// ── Camera follow ─────────────────────────────────────────────
// Vehicle forward is +Z, so "behind the kart" = -Z relative to its facing.
// Camera sits ~2 car-lengths back and slightly above; look-ahead points
// forward (+Z) so the player sees where they're going.
const camOffset = new THREE.Vector3(0, M(5.5), -M(11));
const camLookAhead = new THREE.Vector3(0, M(1.2), M(4));
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

function updateCamera() {
  // Position camera behind the chassis along its forward axis
  tmpQ.set(chassisBody.quaternion.x, chassisBody.quaternion.y, chassisBody.quaternion.z, chassisBody.quaternion.w);
  const offset = camOffset.clone().applyQuaternion(tmpQ);
  const target = new THREE.Vector3(chassisBody.position.x, chassisBody.position.y, chassisBody.position.z);
  const desired = target.clone().add(offset);
  camera.position.lerp(desired, 0.12);
  const lookAt = target.clone().add(camLookAhead.clone().applyQuaternion(tmpQ));
  camera.lookAt(lookAt);
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
    applyControls();
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

  updateCamera();

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

window.__play = { world, vehicle, chassisBody, scene, camera, renderer, track, combatState, playerCombat };
