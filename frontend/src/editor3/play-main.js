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
import { cloneKart, resolveKartWheels } from './kart-loader.js';
import { resolveSelectedKartId, getKart, getKartTrailProfile } from './kart-catalog.js';
import { DecorStore, buildDecorMesh } from './decor.js';
import { WORLD_UNITS_PER_M, m as M, mm as MM } from './units.js';
import { buildCombatState, sweepKart, tickRespawns } from './combat-runtime.js';
import { resolvePlaytestBudget } from './playtest-perf.js';
import { mergeSegmentGroups } from './segment-merge.js';
import { buildBatchedDecor } from './decor-batching.js';
import { createPhysicsBridge } from './physics-bridge.js';
import { createKartUnderglow } from '../kart-glo.js';
import { createKartAudio, V8_KITS } from './kart-audio.js';

// ── CANNON-body → portable descriptor serializer ─────────────
// The physics worker can't import segment-builder/decor-batching
// (they pull THREE→GLTFLoader→document, which doesn't exist in a
// worker scope). So main builds the static bodies on its own thread
// using the existing builders, walks the resulting compound shapes,
// and ships a flat JSON description to the worker. Bodies built here
// are *never added to a world on main* — they exist only long enough
// to be serialized.
function serializeBody(body) {
  const shapes = [];
  for (let i = 0; i < body.shapes.length; i++) {
    const sh = body.shapes[i];
    const off = body.shapeOffsets[i];
    const oq = body.shapeOrientations[i];
    if (sh instanceof CANNON.Box) {
      shapes.push({
        type: 'box',
        halfExtents: [sh.halfExtents.x, sh.halfExtents.y, sh.halfExtents.z],
        offset: [off.x, off.y, off.z],
        quat: [oq.x, oq.y, oq.z, oq.w],
      });
    } else if (sh instanceof CANNON.Plane) {
      shapes.push({
        type: 'plane',
        offset: [off.x, off.y, off.z],
        quat: [oq.x, oq.y, oq.z, oq.w],
      });
    } else if (sh instanceof CANNON.Trimesh) {
      // Used by curved/banked surfaces (e.g. banked_turn bowl) where a
      // discrete box approximation can't seal the lateral seams without
      // gaps. Serialise the raw vertex/index arrays — the worker will
      // rebuild a fresh Trimesh on its side.
      shapes.push({
        type: 'trimesh',
        vertices: Array.from(sh.vertices),
        indices:  Array.from(sh.indices),
        offset: [off.x, off.y, off.z],
        quat: [oq.x, oq.y, oq.z, oq.w],
      });
    }
    // Other shape types (Sphere, Cylinder) intentionally
    // dropped for now — the kart sim only uses Box + Plane + Trimesh statics.
  }
  return {
    mass: body.mass,
    pos: [body.position.x, body.position.y, body.position.z],
    quat: [body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w],
    shapes,
  };
}

// Playtest runs in world units where 1 unit = 1 mm.
// (TILE arrives from track-data already in world units.)

// ── Performance budget ──────────────────────────────
// One tier (HIGH/MED/LOW/ULTRA) drives every frame-cost knob in this
// runtime: pixel ratio, shadow size, fog distance, light count,
// decor instancing thresholds, etc. The resolver auto-detects GPU
// class but honours `?perfTier=` URL params and the
// `gloPerformanceMode` storage key for forced overrides.
const PERF = resolvePlaytestBudget();

// ── Scene ─────────────────────────────────────
const canvas = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({
  canvas,
  // AA only on MED+ — it's wasted on ULTRA/LOW where DPR is already ≤1.0.
  antialias: PERF.tier >= 2,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PERF.maxPixelRatio));
renderer.shadowMap.enabled = PERF.shadowsEnabled;
// PCFSoft is the prettiest but most expensive filter; PCF is ~2× faster
// and indistinguishable at the smaller shadow map size we use below.
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(PERF.fogColor);
scene.fog = new THREE.Fog(PERF.fogColor, TILE * PERF.fogNearTiles, TILE * PERF.fogFarTiles);

const camera = new THREE.PerspectiveCamera(70, 1, M(0.1), M(2000));

const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(M(60), M(120), M(40));
sun.castShadow = PERF.shadowsEnabled;
if (PERF.shadowsEnabled) {
  // Shadow map size scales with tier (1024 on MED, 2048 on HIGH). Tighter
  // ortho frustum (was ±120m / far 400m) keeps texel density high.
  sun.shadow.mapSize.set(PERF.shadowMapSize, PERF.shadowMapSize);
  sun.shadow.camera.left = -M(80); sun.shadow.camera.right = M(80);
  sun.shadow.camera.top = M(80); sun.shadow.camera.bottom = -M(80);
  sun.shadow.camera.near = M(1); sun.shadow.camera.far = M(250);
  sun.shadow.bias = -0.0008;
}
scene.add(sun);
scene.add(new THREE.AmbientLight(0x6b7a92, PERF.ambientIntensity));
// Hemi only matters when we have spare light slots; on ULTRA we skip it.
if (PERF.maxLights >= 2) {
  scene.add(new THREE.HemisphereLight(0x88aaff, 0x222530, PERF.hemiIntensity));
}

// Ground (visual + physics)
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(M(2000), M(2000)),
  new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ── Physics world ─────────────────────────────────────────────
// Cannon-es lives entirely on a Web Worker now (see physics-worker.js).
// Main thread holds only the bridge proxy below; chassis, vehicle,
// ground plane, segment colliders and decor colliders are all rebuilt
// and stepped off-thread. Removes the bimodal physics-substep cost
// from the rAF callback so render frames stay uniformly cheap.

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
}

// Collected portable collider descriptors for the off-thread world.
// The worker rebuilds CANNON.Body objects from these on init.
/** @type {Array<{mass:number,pos:number[],quat:number[],shapes:any[]}>} */
const staticBodyDescriptors = [];
// ── Batched decor (instancing + chunked colliders) ──────────────
// Replaces the legacy "one Mesh + one Body per instance" path. On a
// dense scene this can collapse 800 draw calls + 800 broadphase pairs
// down to ~10 InstancedMesh draws and ~30 chunked static bodies.
// Visual + physics still build from the same DecorStore so picking IDs
// remain attachable for future per-prop interactions (weapons, etc.).
{
  // Remove the naive per-instance meshes added above so we don't
  // double-render. The batched build owns visuals + bodies.
  const naiveDecor = scene.children.filter((o) => o.userData?.decorId != null || o.name?.startsWith?.('decor:'));
  for (const o of naiveDecor) scene.remove(o);
  const batched = buildBatchedDecor(decor.all(), {
    instanceMin: PERF.decorInstanceMin,
    maxColliders: PERF.decorMaxColliders,
    chunkUnits: PERF.decorColliderChunkUnits,
    castShadows: PERF.shadowsEnabled && PERF.maxShadowSegments > 0,
    receiveShadows: PERF.shadowsEnabled,
    physicsMaterial: null,
  });
  for (const v of batched.visuals) scene.add(v);
  // Serialize the chunked decor bodies for the off-thread world.
  for (const b of batched.bodies) staticBodyDescriptors.push(serializeBody(b));
  if (batched.stats.total > 0) {
    console.info('[play] decor batched (visuals on main, colliders shipped to worker):', batched.stats);
  }
}

// Build all segment visuals. Colliders are built off-thread in the
// physics worker from the same Track JSON.
// Set of "gx,gz" cell keys covered by any drivable (non-overlay)
// placement. The R-key recovery uses this on the worker side; main
// keeps a copy in case future systems need it.
const drivableCells = new Set();
// Collect finish-line placements so we can detect lap completion.
/** @type {{gx:number,gz:number,rot:number,forward:THREE.Vector3,center:THREE.Vector3}[]} */
const finishLines = [];
// Map placement id → THREE.Group containing the overlay's pickup cube /
// orb / paint patch. Used to hide the cube while the pickup is on
// respawn cooldown and show it again when re-armed.
/** @type {Map<number, THREE.Group>} */
const overlayMeshById = new Map();
// Static segment groups to be collapsed into a few merged meshes after
// the build loop. Overlay (runtime) segments are kept live so combat
// can still toggle their pickup-cube visibility per-frame.
const staticSegmentRoots = [];
for (const p of track.all()) {
  const mesh = buildSegmentMesh(p.key);
  mesh.position.set(p.gx * TILE, 0, p.gz * TILE);
  mesh.rotation.y = -p.rot * Math.PI / 2;
  scene.add(mesh);
  if (!SEGMENTS[p.key]?.runtime) staticSegmentRoots.push(mesh);

  if (SEGMENTS[p.key]?.runtime) overlayMeshById.set(p.id, mesh);

  // Build the segment's collision body on main, then serialize it for
  // the worker. The body itself is GC'd — nothing on this thread ever
  // adds it to a world.
  const segBody = buildSegmentBody(
    p.key,
    { x: p.gx * TILE, y: 0, z: p.gz * TILE },
    -p.rot * Math.PI / 2,
  );
  if (segBody) staticBodyDescriptors.push(serializeBody(segBody));

  if (!SEGMENTS[p.key]?.runtime) {
    for (const [cx, cz] of track.occupiedCells(p.key, p.gx, p.gz, p.rot)) {
      drivableCells.add(`${cx},${cz}`);
    }
  }

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

// ── Collapse static segment draw calls ─────────────────────
// On a 12-tile loop the segment groups can contain 200–400 small
// primitives (curbs, posts, paint stripes, signs). The merge bakes
// every static leaf into a single BufferGeometry per material and
// replaces the originals with a handful of static meshes — typically
// a 20–40× draw-call reduction. Anything tagged `__pickupCube`,
// `__finishLine`, `__overlay`, or `__keepLive` stays live so combat
// and lap detection are unaffected.
if (staticSegmentRoots.length > 0) {
  const mergeRes = mergeSegmentGroups(staticSegmentRoots, {
    castShadow: PERF.shadowsEnabled && PERF.maxShadowSegments > 0,
    receiveShadow: PERF.shadowsEnabled,
  });
  for (const m of mergeRes.merged) scene.add(m);
  console.info('[play] segment merge:', mergeRes.stats);
}

// ── Kart (RaycastVehicle, off-thread) ─────────────────────────
// Constants below are kept on main only because the visual code
// (placeholder box, wheel cylinders, suspension Y-offset) needs the
// same body extents the worker uses. The actual chassis body and
// vehicle live on the worker.
const CHASSIS_HX = M(0.6), CHASSIS_HY = M(0.3), CHASSIS_HZ = M(1.0);
const WHEEL_RADIUS = M(0.4);
const WHEEL_Y = -CHASSIS_HY * 0.5;
const SUSPENSION_REST_LENGTH = M(0.3);

// Spawn position: center of spawn cell, slightly above
const spawnPlacement = track.spawn();
const spawnPos = spawnPlacement
  ? { x: spawnPlacement.gx * TILE, y: getDrivableTopY(spawnPlacement.key) + M(1.0), z: spawnPlacement.gz * TILE }
  : { x: 0, y: M(1.5), z: 0 };
const spawnRot = spawnPlacement ? -spawnPlacement.rot * Math.PI / 2 : 0;

// Spin up the off-thread physics runtime. The bridge mirrors the
// CANNON.Body / RaycastVehicle API surface so existing reads
// (camera, HUD, combat sweep, lap detection, mp-client) work
// unchanged via `bridge.chassisBody` and `bridge.vehicle`.
const physicsBridge = createPhysicsBridge({
  staticBodies: staticBodyDescriptors,
  drivableCells,
  tile: TILE,
  spawnPos,
  spawnRot,
  perfBudget: PERF,
});
// Seed the proxy at the spawn pose so the very first render frames
// (before the worker's first snapshot lands) draw the kart in the
// right place instead of at world-origin.
physicsBridge.chassisBody.position.x = spawnPos.x;
physicsBridge.chassisBody.position.y = spawnPos.y;
physicsBridge.chassisBody.position.z = spawnPos.z;
physicsBridge.chassisBody.interpolatedPosition.x = spawnPos.x;
physicsBridge.chassisBody.interpolatedPosition.y = spawnPos.y;
physicsBridge.chassisBody.interpolatedPosition.z = spawnPos.z;
const _spawnQuat = { x: 0, y: Math.sin(spawnRot / 2), z: 0, w: Math.cos(spawnRot / 2) };
Object.assign(physicsBridge.chassisBody.quaternion, _spawnQuat);
Object.assign(physicsBridge.chassisBody.interpolatedQuaternion, _spawnQuat);

const chassisBody = physicsBridge.chassisBody;
const vehicle = physicsBridge.vehicle;

// Wheel visuals + chassis visual
const kartGroup = new THREE.Group();
// Placeholder box + head — kept in the tree so it can pop in only if
// the GLB load fails. Hidden by default so we never flash the magenta
// debug cube during the brief async load on simulate-mode entry.
const placeholderChassis = new THREE.Mesh(
  new THREE.BoxGeometry(CHASSIS_HX * 2, CHASSIS_HY * 2, CHASSIS_HZ * 2),
  new THREE.MeshStandardMaterial({ color: 0xff3aa1, roughness: 0.5, metalness: 0.2, transparent: true, opacity: 0.9 }),
);
placeholderChassis.castShadow = true;
placeholderChassis.visible = false;
kartGroup.add(placeholderChassis);
const placeholderHead = new THREE.Mesh(
  new THREE.SphereGeometry(M(0.22), 12, 10),
  new THREE.MeshStandardMaterial({ color: 0x00e5ff }),
);
placeholderHead.position.set(0, CHASSIS_HY + M(0.22), -M(0.1));
placeholderHead.castShadow = true;
placeholderHead.visible = false;
kartGroup.add(placeholderHead);
scene.add(kartGroup);

// ── User-selected underglow ────────────────────────────────────
// Reads the "Pick Your GLO" choice the player made in the lobby
// (sessionStorage gloEffect/gloColor/gloColor2) and renders it as a
// flat pool of light pinned to the ground under the kart. The rig
// stays world-axis-aligned so the disc never tilts when the chassis
// rolls/pitches mid-drift. Live `gloChanged` events from the lobby
// hot-swap the effect without a reload.
//
// Sizes are in world units (1 unit = 1 mm); CHASSIS_HZ * 2 is the
// kart's full length, so the inner disc is roughly kart-sized and the
// halo extends ~3× the wheelbase for a generous bleed.
const underglow = createKartUnderglow(THREE, scene, {
  innerRadius:   M(1.1),
  haloRadius:    M(3.0),
  // Push the rig down to ground level so the user's selected GLO
  // effect (the bright inner disc + halo bleed) is clearly visible
  // around the kart's silhouette. Sit just above the wheel-contact
  // plane so the disc clears the tyre meshes (which end at the
  // contact point) without being buried underground — earlier values
  // pushed it BELOW the ground and the player only saw the soft halo
  // bleed, never their actual effect.
  // Lowered 10% (× 0.9) per request to bring the pool closer to the
  // road surface.
  groundOffsetY: (CHASSIS_HY + WHEEL_RADIUS) * 0.9,
  lightRange:    M(5.0),
  castLight:     true,
});

// Swap in the real kart GLB once it loads.
const SELECTED_KART_ID = resolveSelectedKartId();
const selectedKart = getKart(SELECTED_KART_ID);
document.getElementById('trackName').textContent = `${track.name} · ${selectedKart.label}`;
// Per-kart trail profile — drives skid / GLO-trail emission for karts
// whose visible chassis doesn't match the standard 4-wheel raycast
// vehicle (hovercraft, broom, trikes). See KART_TRAIL_PROFILES in
// kart-catalog.js for the schema. Resolved once at load — the chosen
// kart can't change mid-session.
const KART_TRAIL = getKartTrailProfile(SELECTED_KART_ID);
// Project a wheel-contact point onto the chassis longitudinal axis so
// trail emitters in `centerOnlyGlow` / `frontCenter` / `rearCenter`
// modes draw a single ribbon under the chassis centerline instead of
// two parallel ribbons offset by the physics half-track. Uses the
// chassis's smoothed yaw — works regardless of pitch/roll.
const _trailProjectTmp = { x: 0, z: 0 };
function projectContactToCenterline(x, z) {
  if (!chassisBody) {
    _trailProjectTmp.x = x; _trailProjectTmp.z = z;
    return _trailProjectTmp;
  }
  const cx = chassisBody.interpolatedPosition.x;
  const cz = chassisBody.interpolatedPosition.z;
  const q = chassisBody.interpolatedQuaternion;
  const sinyCosp = 2 * (q.w * q.y + q.x * q.z);
  const cosyCosp = 1 - 2 * (q.y * q.y + q.x * q.x);
  const yaw = Math.atan2(sinyCosp, cosyCosp);
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  // Forward distance from chassis centre along its yaw-only forward axis.
  const dx = x - cx, dz = z - cz;
  const fwd = dx * fx + dz * fz;
  _trailProjectTmp.x = cx + fx * fwd;
  _trailProjectTmp.z = cz + fz * fwd;
  return _trailProjectTmp;
}
let kartModel = null;
// Per-kart wheel pivots resolved from the GLB (when the model uses the
// standard `wheel-front-left/right` / `wheel-rear-left/right` naming).
// Null when the model lacks named wheels — the debug cylinders take
// over in that case so the kart still has visibly rolling tyres.
/** @type {{fl:THREE.Object3D, fr:THREE.Object3D, rl:THREE.Object3D, rr:THREE.Object3D}|null} */
let kartWheels = null;
// Cumulative wheel-roll angle in radians, integrated from forward speed
// each frame. Shared across all four wheels (the visible roll rate is
// the same — only the rear vs. front distinction matters for steering,
// not for rolling).
let _wheelRollAngle = 0;
cloneKart(SELECTED_KART_ID, selectedKart.accent || 0xff3aa1).then((model) => {
  // Raise so the chassis box center sits on the kart center of gravity:
  // the kart template has y=0 at wheel contact, so shift down slightly
  // so the RaycastVehicle rays (cast from chassis center downward) land
  // near the visual wheels.
  model.position.y = -CHASSIS_HY;
  kartGroup.add(model);
  kartModel = model;
  // Kart GLB includes its own wheels — try to resolve the named wheel
  // pivots so we can rotate them per-frame. If the model doesn't use
  // the standard naming convention (e.g. older single-mesh karts), fall
  // back to the debug cylinders so the wheels still spin visibly.
  kartWheels = resolveKartWheels(model);
  wheelsGroup.visible = (kartWheels === null);
}).catch((err) => {
  console.warn('[play] kart load failed, showing placeholder fallback', err);
  // Reveal the placeholder ONLY on failure so the user still sees a kart.
  placeholderChassis.visible = true;
  placeholderHead.visible = true;
  // wheelsGroup may be assigned after this catch runs (it's declared
  // below). Defer with a microtask so the variable is in scope.
  queueMicrotask(() => { if (typeof wheelsGroup !== 'undefined') wheelsGroup.visible = true; });
});

const wheelMeshes = [];
const wheelsGroup = new THREE.Group();
wheelsGroup.name = 'debug-wheels';
// The kart GLB ships with its own wheels, so the debug cylinders are
// only useful as a fallback when the GLB never loads. Hide by default
// to avoid the brief "stack of black cylinders" flash on entry.
wheelsGroup.visible = false;
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

// ── Skid-mark trail system ────────────────────────────────────
// Cheap world-space trail rendered as a single dynamic BufferGeometry
// (one mesh, one draw call). Each emit appends a quad between the
// wheel's previous and current contact patch; the buffer is a ring so
// the oldest quad is overwritten when full. Cost per frame:
//   - up to 4 quad writes (16 vertex positions, 12 floats each step)
//   - one needsUpdate flag flip on the position attribute
// Trigger conditions live in the render loop (lateral slide, hard
// brake, or handbrake) so the buffer only grows when the player is
// actually skidding.
const SKID_QUADS_PER_WHEEL = 220;
const SKID_QUAD_COUNT = 4 * SKID_QUADS_PER_WHEEL;
const SKID_WIDTH = M(0.32);
const SKID_Y_OFFSET = M(0.10);
const SKID_MIN_STEP = M(0.12);            // metres of travel between emits
const SKID_LATERAL_THRESHOLD = M(1.8);    // m/s of side-slip before marks
const SKID_BRAKE_SPEED_THRESHOLD = M(5);  // m/s — only mark "hard" brakes
const skidGeo = new THREE.BufferGeometry();
const skidPositions = new Float32Array(SKID_QUAD_COUNT * 4 * 3);
// Per-vertex UV: u runs along the quad's length (prev→curr), v across
// its width (left→right). One-time fill since every quad has identical
// corner UVs — the shader uses these to draw the tread pattern in
// quad-local space, decoupled from world orientation.
const skidUVs = new Float32Array(SKID_QUAD_COUNT * 4 * 2);
const skidIndices = new (SKID_QUAD_COUNT * 4 > 65535 ? Uint32Array : Uint16Array)(SKID_QUAD_COUNT * 6);
for (let q = 0; q < SKID_QUAD_COUNT; q++) {
  const v = q * 4;
  const i = q * 6;
  skidIndices[i + 0] = v;
  skidIndices[i + 1] = v + 1;
  skidIndices[i + 2] = v + 2;
  skidIndices[i + 3] = v;
  skidIndices[i + 4] = v + 2;
  skidIndices[i + 5] = v + 3;
  // Quad winding (see emitSkidQuad): prev-L, prev-R, curr-R, curr-L.
  // Map to (u along length, v across width). 4 verts \u00d7 2 floats = 8
  // floats per quad.
  const u = q * 8;
  skidUVs[u +  0] = 0; skidUVs[u +  1] = 0; // prev-L
  skidUVs[u +  2] = 0; skidUVs[u +  3] = 1; // prev-R
  skidUVs[u +  4] = 1; skidUVs[u +  5] = 1; // curr-R
  skidUVs[u +  6] = 1; skidUVs[u +  7] = 0; // curr-L
}
skidGeo.setAttribute('position', new THREE.BufferAttribute(skidPositions, 3));
skidGeo.setAttribute('uv',       new THREE.BufferAttribute(skidUVs, 2));
skidGeo.setIndex(new THREE.BufferAttribute(skidIndices, 1));
skidGeo.setDrawRange(0, 0);
// Procedural tyre-mark shader. Reads the quad-local UV to render:
//   • Two parallel tread ribs (per-tyre groove) so the mark looks like
//     contact-patch rubber, not a single flat strip.
//   • Soft Gaussian falloff at the side edges so the mark blends into
//     the road instead of having a hard line.
//   • World-space value noise along the length so density / opacity
//     varies organically (heavier here, lighter there) the way real
//     burnt rubber lays down on tarmac.
//   • Light/dark grain variation so the mark has internal contrast,
//     not a flat black fill.
// Single draw call, no textures, ~25 ALU ops/fragment.
const skidMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
  uniforms: {
    uOpacity: { value: 1.6 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    varying vec2 vWorld;
    void main() {
      vUv = uv;
      vWorld = position.xz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    varying vec2 vUv;
    varying vec2 vWorld;
    uniform float uOpacity;
    float h21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
    float vn(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
      return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x),
                 mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
    }
    void main() {
      // Side fade: soft Gaussian falloff at v=0 and v=1 so the
      // outside edges of the strip dissolve into the road.
      float vc = vUv.y - 0.5;
      float side = exp(-vc * vc * 8.0);
      // Twin contact-patch ribs: two darker bands centred at v=0.30
      // and v=0.70 — the shape a tyre's outer rib + inner rib leaves.
      // Wider Gaussians so the ribs overlap the centre and the strip
      // reads as one solid mark with two darker grooves.
      float ribA = exp(-pow((vUv.y - 0.30) * 4.5, 2.0));
      float ribB = exp(-pow((vUv.y - 0.70) * 4.5, 2.0));
      // Solid backbone (1.0) modulated by the ribs so the centre stays
      // dark instead of fading out to zero between them.
      float rib  = clamp(0.55 + 0.55 * (ribA + ribB), 0.0, 1.4);
      // World-space noise along the length so density varies organically.
      // Two octaves: low for big patchy variation, high for grain.
      float coarse = vn(vWorld * 0.6);
      float fine   = vn(vWorld * 4.0);
      // Streaks along U: subtle lengthwise variation so the mark has
      // "ridges" of darkness rather than uniform fill. Sampled in
      // world space so consecutive quads tile seamlessly.
      float lengthwise = 0.80 + 0.20 * vn(vec2(vWorld.x * 2.5 + vWorld.y * 0.1, vUv.y * 6.0));
      // Combine: rib backbone modulated by both noise terms, with a
      // generous floor so the mark is always visible.
      float density = rib * (0.70 + 0.30 * coarse) * lengthwise;
      // Subtle dark/light grain variation in colour so the mark isn't
      // pure black — reads as burnt rubber on grey tarmac.
      vec3 base = mix(vec3(0.02, 0.02, 0.02), vec3(0.10, 0.09, 0.08), fine);
      float a   = density * side * uOpacity;
      gl_FragColor = vec4(base, a);
    }
  `,
});
const skidMesh = new THREE.Mesh(skidGeo, skidMat);
skidMesh.renderOrder = 1;
skidMesh.frustumCulled = false; // ring buffer wraps the world; bbox stale by design
scene.add(skidMesh);

// ── GLO burnout skid trail ────────────────────────────────────
// A second ring-buffered skid mesh that renders bright, additively-blended
// tyre marks tinted with the player's selected GLO colour. Triggered by
// holding space + W (rear-wheel burnout charge) and *releasing* space
// while still holding throttle: the kart launches forward and the rear
// wheels lay down a glowing trail for ~0.7 s.
//
// Same architecture as the dark skidMesh — a single dynamic
// BufferGeometry and one material — so total cost stays well under a
// millisecond even when both ring buffers are full.
const GLO_SKID_QUADS_PER_WHEEL = 220; // rear wheels only — longer pool so trails persist for several seconds before recycling
const GLO_SKID_QUAD_COUNT = 2 * GLO_SKID_QUADS_PER_WHEEL;
const GLO_SKID_WIDTH = M(0.95);      // wider "flame ribbon" — the BTTF look needs the trail noticeably broader than the dark mark
const gloSkidGeo = new THREE.BufferGeometry();
const gloSkidPositions = new Float32Array(GLO_SKID_QUAD_COUNT * 4 * 3);
const gloSkidLife      = new Float32Array(GLO_SKID_QUAD_COUNT * 4);
// Per-vertex UV (u along quad length, v across width). Same one-time
// fill pattern as the dark skid mesh — used by the flame shader to
// place the hot core, tongues, and side falloff in quad-local space.
const gloSkidUVs = new Float32Array(GLO_SKID_QUAD_COUNT * 4 * 2);
const gloSkidIndices = new (GLO_SKID_QUAD_COUNT * 4 > 65535 ? Uint32Array : Uint16Array)(GLO_SKID_QUAD_COUNT * 6);
for (let q = 0; q < GLO_SKID_QUAD_COUNT; q++) {
  const v = q * 4;
  const i = q * 6;
  gloSkidIndices[i + 0] = v;
  gloSkidIndices[i + 1] = v + 1;
  gloSkidIndices[i + 2] = v + 2;
  gloSkidIndices[i + 3] = v;
  gloSkidIndices[i + 4] = v + 2;
  gloSkidIndices[i + 5] = v + 3;
  // Quad winding (see emitGloSkidQuad): prev-L, prev-R, curr-R, curr-L.
  const u = q * 8;
  gloSkidUVs[u +  0] = 0; gloSkidUVs[u +  1] = 0; // prev-L
  gloSkidUVs[u +  2] = 0; gloSkidUVs[u +  3] = 1; // prev-R
  gloSkidUVs[u +  4] = 1; gloSkidUVs[u +  5] = 1; // curr-R
  gloSkidUVs[u +  6] = 1; gloSkidUVs[u +  7] = 0; // curr-L
}
gloSkidGeo.setAttribute('position', new THREE.BufferAttribute(gloSkidPositions, 3));
gloSkidGeo.setAttribute('aLife',    new THREE.BufferAttribute(gloSkidLife, 1));
gloSkidGeo.setAttribute('uv',       new THREE.BufferAttribute(gloSkidUVs, 2));
gloSkidGeo.setIndex(new THREE.BufferAttribute(gloSkidIndices, 1));
gloSkidGeo.setDrawRange(0, 0);
// BTTF-style flaming tyre trail. Procedurally renders a fire ribbon
// out of two layers stacked into a single fragment:
//   • White-hot core stripe down the centre line of the strip.
//   • GLO-coloured flame tongues licking outward from the core,
//     animated by scrolling world-space FBM noise so the trail
//     CONSTANTLY combusts instead of being a static ribbon.
//   • Soft chromatic outer halo that fades into nothing.
// All sampling in CARTESIAN noise space (no polar wedges) and the
// noise sample point is offset by aLife so freshly-laid quads burn
// hotter & wider than the trailing tail.
const gloSkidMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -3,
  polygonOffsetUnits: -3,
  uniforms: {
    uColor: { value: new THREE.Color(0xff3aa1) },
    uTime:  { value: 0 },
  },
  vertexShader: /* glsl */`
    attribute float aLife;
    varying float vLife;
    varying vec2  vUv;
    varying vec2  vWorld;
    void main() {
      vLife = aLife;
      vUv   = uv;
      vWorld = position.xz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    varying float vLife;
    varying vec2  vUv;
    varying vec2  vWorld;
    uniform vec3  uColor;
    uniform float uTime;
    float h21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
    float vn(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
      return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x),
                 mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
    }
    // 2-octave fbm in Cartesian space.
    float fbm(vec2 p) {
      return vn(p) * 0.65 + vn(p * 2.3) * 0.35;
    }
    void main() {
      // Distance from the centreline of the strip (0 at centre, 1 at edge).
      float vc = abs(vUv.y - 0.5) * 2.0;
      // "Flame-out" lifecycle. vLife runs 1→0 across GLO_SKID_LIFE_S.
      // We split the curve so the head burns hot for the first ~30%
      // of life, then settles into a long-burning ember tail that
      // smolders out instead of pop-fading.
      //   blaze   = 1 while fresh, drops to 0 over the first 30% of life
      //   ember   = stays near 1 through the middle, fades over the last 60%
      //   alive   = blaze + ember, drives overall brightness
      float lifeT = 1.0 - vLife;                          // 0 fresh, 1 dead
      float blaze = smoothstep(0.30, 0.00, lifeT);        // hot phase
      float ember = smoothstep(1.00, 0.20, lifeT);        // long smolder
      float alive = clamp(blaze + ember * 0.70, 0.0, 1.0);
      // World-space noise scrolling along the kart's direction of
      // travel so the flames roar away from the wheel. As the trail
      // ages we slow the scroll — dying flames flicker rather than
      // race — and add a per-quad time offset so each section
      // flickers on its own rhythm.
      float scroll = mix(2.0, 6.0, blaze);
      vec2  nuv = vec2(vWorld.x * 1.4 + vWorld.y * 0.7 - uTime * scroll,
                       (vUv.y - 0.5) * 4.0 + vWorld.y * 0.6);
      float n   = fbm(nuv);
      // Domain warp for a second turbulent pass so flame tongues
      // swirl rather than just scrolling in straight bands.
      float n2  = fbm(nuv + vec2(n * 1.6, -n * 0.8));
      // Flame tongues. Width tapers as the trail ages so a fresh
      // quad has wide licking flames and an old one has just a
      // thin smoldering line. "erode" eats inward over life so the
      // tongues break up into discontinuous ember patches at the end.
      float tongueWidth = mix(0.55, 1.10, alive);
      float erode       = mix(0.85, 0.45, lifeT);
      float tongue = smoothstep(tongueWidth, 0.0,
                                vc + (0.5 - n2) * (0.6 + 0.55 * alive));
      tongue *= step(erode, n2 * 0.5 + 0.5 + blaze * 0.5);
      // Hot white core: a thin centreline that's near-white while
      // fresh, narrows to an ember thread as life drains away.
      float coreFalloff = mix(48.0, 22.0, alive);
      float core = exp(-vc * vc * coreFalloff) * (0.35 + 0.65 * alive);
      // BTTF-style fire colour ramp. White-hot → yellow → GLO colour
      // → deep burn at the edges. Drives the chromatic gradient
      // anchored on the player's selected GLO hue.
      // Palette anchored ENTIRELY on the player's GLO uColor. We use
      // the same hue for the white-hot core, mid flame, and edges \u2014
      // the only variation is brightness. This is critical because
      // gloSkidMat uses AdditiveBlending and stationary burnouts
      // stack many stamps at the exact same footprint. Any non-zero
      // contribution to channels OUTSIDE uColor (e.g. a "white kicker"
      // in the core) would saturate those channels to 1.0 after a few
      // overlaps and turn the visible streak white/yellow regardless
      // of the player's selected GLO. Keeping every term proportional
      // to uColor means stacks can only saturate the GLO channels —
      // the player's hue is preserved no matter how many stamps land.
      vec3 hot    = uColor * 1.45;             // bright inner ring (still pure GLO)
      vec3 mid    = uColor;                    // saturated GLO core of flame
      vec3 edge   = uColor * 0.85;             // slightly dimmer GLO at tip
      // Position in the flame: 0 = core, 1 = tip.
      float t = clamp(vc + (1.0 - n2) * 0.25, 0.0, 1.0);
      vec3 col = mix(hot, mid, smoothstep(0.00, 0.45, t));
      col      = mix(col, edge, smoothstep(0.45, 1.0, t));
      // As the trail ages, slide the colour toward orange/ember and
      // then a deep red glow so the "flame out" reads as cooling
      // metal rather than the GLO neon simply dimming.
      // Ember phase: cooled tone is pure GLO at reduced brightness.
      // No red/orange bias \u2014 those would inject R into the additive
      // stack and re-introduce the yellow drift fault.
      vec3 emberCol = uColor * 0.55;
      col = mix(emberCol, col, alive);
      // Flicker frequency rises as the trail dies — sells the
      // "sputtering out" beat without any per-vertex animation.
      float flickerHz = mix(38.0, 22.0, alive);
      float pulse     = 0.80 + 0.20 * sin(uTime * flickerHz + vWorld.x * 0.6 + vWorld.y * 0.6 + lifeT * 12.0);
      // Embers: noise-gated sparks scattered along the dying trail.
      // Cheap (uses the n2 sample we already have) and only contribute
      // once the flame has cooled enough that they read against the
      // dimmer base.
      float sparkMask = step(0.86, fract(n2 * 7.3 + uTime * 2.5)) * (1.0 - alive);
      float a = (tongue * 0.7 + core * 1.2) * alive * pulse
              + sparkMask * 0.9 * ember;
      // Edge feather. Only feather the SIDES of the strip — feathering
      // the U (along-travel) ends would create a dark notch at every
      // seam between consecutive quads, which itself reads as a
      // bounding-box outline. Adjacent quads share their U=0/U=1 edges
      // so leaving them at full alpha gives a seamless continuous trail.
      // The side mask uses a wide quintic falloff so the strip never
      // hits a hard rectangular edge against the road.
      float sideMask = 1.0 - smoothstep(0.55, 1.0, vc);
      // Soft global opacity so the trail composites against the road
      // surface instead of stamping on top of it. Additive blending
      // means we want the contribution to read like heat haze /
      // light spill rather than a decal.
      a *= sideMask * 0.55;
      // Brightness boost on the core so the centre near-overexposes
      // through additive blending while fresh — sells the BTTF "too
      // hot to touch" look without any post pass. Cools off with life.
      vec3 outCol = col * (1.0 + core * 1.8 * blaze);
      // Sparks render as bright pinpricks of pure GLO colour so they
      // never reintroduce a non-GLO channel into the cooled trail
      // (any white-kicker would saturate-to-white under additive
      // stacking, see the palette comment above). Mask them with the
      // same side feather so they can never spawn on the long edges.
      outCol += uColor * 1.6 * sparkMask * ember * sideMask;
      gl_FragColor = vec4(outCol, a);
    }
  `,
});
const gloSkidMesh = new THREE.Mesh(gloSkidGeo, gloSkidMat);
gloSkidMesh.renderOrder = 2;
gloSkidMesh.frustumCulled = false;
scene.add(gloSkidMesh);

const gloSkidPrev = [null, null]; // rear wheels only (0,1)
const gloSkidStampNextAt = [0, 0]; // performance.now() ms gate per rear wheel for emitGloSkidStamp
const GLO_SKID_STAMP_INTERVAL_MS = 90; // throttle stationary-burnout stamps so they don't pile up additively at the same footprint and saturate to yellow
let gloSkidWriteIdx = 0;
let gloSkidFilled = 0;
const GLO_SKID_LIFE_S = 6.0;          // seconds before a freshly-laid quad fully fades — long persistence so the trail "flames out" gradually rather than vanishing
const GLO_SKID_MIN_STEP = M(0.10);
const GLO_SKID_MAX_STEP_SQ = M(20) * M(20); // any per-frame jump beyond 20m → teleport (respawn), skip emit. 20m is generous enough that even a 5fps frame at peak drift speed (~M(50)/s) still produces normal quads instead of false-positive teleport skips.

// Burnout charge state — driven by the keyboard input loop in updateSkidTrails().
// ── Kart audio rig ──────────────────────────────────────────────
// Loaded once at startup (CC0 K_Std bank by default). Web Audio
// context starts suspended and resumes on the first user gesture
// (autoplay policy); see kart-audio.js. We feed it kart state every
// tick and trigger one-shots at the relevant edges below.
// V8 engine kit selector. Default is the Thunderbolt bank (V8 muscle-car
// samples scraped + converted from the Vigilante2Unity asset dump). Switch
// banks at load time via:
//   • URL param  ?engine=tbolt|stinger|corsair|std
//   • sessionStorage.setItem('engineKit', '<name>')
// 'std' falls back to the original CC0 K_Std bank.
const DEFAULT_ENGINE_KIT = 'tbolt';
function _resolveEngineKit() {
  try {
    const urlKit = new URLSearchParams(window.location.search).get('engine');
    const ssKit  = window.sessionStorage?.getItem('engineKit');
    const pick   = (urlKit || ssKit || DEFAULT_ENGINE_KIT).toLowerCase();
    if (pick === 'std') {
      console.log('[kart-audio] using K_Std kit');
      return undefined; // → kart-audio default
    }
    if (V8_KITS[pick]) {
      console.log('[kart-audio] using V8 kit:', pick);
      return V8_KITS[pick];
    }
  } catch (_) { /* ignore */ }
  return V8_KITS[DEFAULT_ENGINE_KIT];
}
const kartAudio = createKartAudio({ kit: _resolveEngineKit(), masterVolume: 0.65 });
let _prevBoosting = false;     // edge detector for the boost-end one-shot
let _prevBoostFromBurnout = false; // remembers whether the active boost was a burnout (suppresses dashStop sigh on end)
let _prevDriftTier = 0;        // edge detector for mini-turbo blips

let burnoutCharge = 0;          // seconds of accumulated space+W hold
let burnoutPrevSpace = false;
let gloBurnoutT = 0;            // remaining seconds of active "boost trail" emission
const BURNOUT_CHARGE_MIN_S = 0.18; // minimum hold before a release counts as a launch
const BURNOUT_BOOST_DURATION_S = 0.7;
// Progressive build-up: when the player holds space+W the visuals get
// stronger every second until the engine pops at BURNOUT_OVERHEAT_S.
// Stage normalises charge into 0..1 across the build-up window so all
// downstream scalars (puff count, smoke intensity, GLO spark cadence,
// boost duration awarded on release) can lerp cleanly off a single
// number.
const BURNOUT_OVERHEAT_S = 6.0;        // seconds of continuous hold before the engine blows
const BURNOUT_BOOST_DURATION_MAX_S = 2.2; // boost length awarded for a fully-charged release
let engineExplodedUntil = 0;           // performance.now() timestamp; controls steam + input lockout
let engineExplosionFiredAt = 0;        // timestamp the most recent explosion was triggered
let engineRestartTimer = 0;            // setTimeout handle for the post-lockout crank/restart SFX
const ENGINE_LOCKOUT_S = 3.0;          // input is suppressed while the engine recovers
const ENGINE_STEAM_S = 4.0;            // steam plume continues a touch longer than the lockout

// ── Burnout "feel" rig ────────────────────────────────────────
// Smoothed scalars driving the screen/camera/chassis polish for the
// burnout build-up + release. These are read in updateCamera, the
// render loop and the kart-suspension block. Cost is essentially zero
// — a handful of float maths per frame.
let _burnoutShakeAmp = 0;       // ramps with charge stage; powers cam + chassis rumble
let _burnoutShakeAmpSm = 0;     // smoothed (eased)
let _burnoutFlash = 0;          // 0..1 punch applied on release / explosion
let _burnoutFovKick = 0;        // -degrees (anticipation pull-in) → +degrees (release punch)
let _burnoutFovKickSm = 0;
let _burnoutGloBoost = 1;       // multiplier piped into underglow.setIntensityBoost
// Mario-Kart drift visual state (driven by physics-worker controlState).
let _driftLastTier = 0;         // edge detector for tier-up flashes
let _driftLastReleasedAt = 0;   // ms since the last awarded boost burst (debounce)
const TAU = Math.PI * 2;

function clearGloSkid() {
  for (let i = 0; i < gloSkidLife.length; i++) gloSkidLife[i] = 0;
  for (let i = 0; i < gloSkidPositions.length; i++) gloSkidPositions[i] = 0;
  gloSkidWriteIdx = 0;
  gloSkidFilled = 0;
  gloSkidGeo.setDrawRange(0, 0);
  gloSkidGeo.attributes.position.needsUpdate = true;
  gloSkidGeo.attributes.aLife.needsUpdate = true;
  gloSkidPrev[0] = null; gloSkidPrev[1] = null;
  gloSkidStampNextAt[0] = 0; gloSkidStampNextAt[1] = 0;
  burnoutCharge = 0;
  gloBurnoutT = 0;
}

function emitGloSkidQuad(rearI, contactX, contactY, contactZ) {
  // rearI is 0 or 1 (matching wheel indices 0,1 = rear).
  // ── Per-kart trail profile gating ────────────────────────────
  // Hovercraft / broom (centerOnlyGlow): collapse both rear lanes
  // into one centerline lane. Only emit on rearI === 0; project the
  // contact onto the chassis longitudinal axis (X-y stays, lateral
  // offset removed) and lift Y by glowFloatY so the ribbon hovers
  // slightly above the road instead of being scuffed into it.
  if (KART_TRAIL.centerOnlyGlow) {
    if (rearI !== 0) return;
    const cl = projectContactToCenterline(contactX, contactZ);
    contactX = cl.x;
    contactZ = cl.z;
    contactY += KART_TRAIL.glowFloatY || 0;
  }
  const prev = gloSkidPrev[rearI];
  if (!prev) {
    gloSkidPrev[rearI] = new THREE.Vector3(contactX, contactY, contactZ);
    return;
  }
  const dx = contactX - prev.x;
  const dz = contactZ - prev.z;
  const distSq = dx * dx + dz * dz;
  if (distSq < GLO_SKID_MIN_STEP * GLO_SKID_MIN_STEP) return;
  // Frame-rate gap protection. If the previous sample is way upstream
  // (e.g. drift toggled off-on between RAFs, or playwright headless
  // running at 5–10 fps), drawing a single huge quad spanning that
  // gap would produce a visible "lightning bolt" decal across the
  // road. Treat any > 5 m jump as a teleport: re-seed `prev` and skip
  // emission for this step. The next consecutive frame will produce a
  // normal short quad.
  if (distSq > GLO_SKID_MAX_STEP_SQ) {
    prev.set(contactX, contactY, contactZ);
    return;
  }
  const len = Math.sqrt(distSq);
  const px = (-dz / len) * GLO_SKID_WIDTH * 0.5;
  const pz = ( dx / len) * GLO_SKID_WIDTH * 0.5;
  const o = gloSkidWriteIdx * 12;
  const a = gloSkidWriteIdx * 4;
  gloSkidPositions[o +  0] = prev.x + px;
  gloSkidPositions[o +  1] = prev.y + SKID_Y_OFFSET;
  gloSkidPositions[o +  2] = prev.z + pz;
  gloSkidPositions[o +  3] = prev.x - px;
  gloSkidPositions[o +  4] = prev.y + SKID_Y_OFFSET;
  gloSkidPositions[o +  5] = prev.z - pz;
  gloSkidPositions[o +  6] = contactX - px;
  gloSkidPositions[o +  7] = contactY + SKID_Y_OFFSET;
  gloSkidPositions[o +  8] = contactZ - pz;
  gloSkidPositions[o +  9] = contactX + px;
  gloSkidPositions[o + 10] = contactY + SKID_Y_OFFSET;
  gloSkidPositions[o + 11] = contactZ + pz;
  gloSkidLife[a]     = 1.0;
  gloSkidLife[a + 1] = 1.0;
  gloSkidLife[a + 2] = 1.0;
  gloSkidLife[a + 3] = 1.0;
  prev.set(contactX, contactY, contactZ);
  gloSkidWriteIdx = (gloSkidWriteIdx + 1) % GLO_SKID_QUAD_COUNT;
  if (gloSkidFilled < GLO_SKID_QUAD_COUNT) {
    gloSkidFilled++;
    gloSkidGeo.setDrawRange(0, gloSkidFilled * 6);
  }
  gloSkidGeo.attributes.position.needsUpdate = true;
  gloSkidGeo.attributes.aLife.needsUpdate = true;
}

// Stationary GLO skid stamp \u2014 paints a small kart-aligned quad at the
// wheel contact patch regardless of motion. Used during a stationary
// burnout where `emitGloSkidQuad` (which needs prev\u2192current motion to
// build a ribbon) would otherwise produce no geometry. Each stamp is
// a ~tyre-footprint sized rectangle oriented along the kart's forward
// axis; consecutive stamps overlap exactly so the ground reads as a
// growing pool of GLO-colored heat under the spinning rear wheel.
function emitGloSkidStamp(rearI, contactX, contactY, contactZ, fwdX, fwdZ) {
  // ── Per-kart trail profile gating ────────────────────────────
  // Hovercraft / broom: single centerline stamp (only on rearI 0).
  if (KART_TRAIL.centerOnlyGlow) {
    if (rearI !== 0) return;
    const cl = projectContactToCenterline(contactX, contactZ);
    contactX = cl.x;
    contactZ = cl.z;
    contactY += KART_TRAIL.glowFloatY || 0;
  }
  // Throttle: with additive blending, repeatedly stamping the same
  // footprint every frame piles up R+G in the destination buffer and
  // collapses the visible colour to yellow regardless of uColor. Gate
  // emission to a fixed interval so each stamp gets its own visible
  // life cycle before being overpainted.
  const nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  if (nowMs < gloSkidStampNextAt[rearI]) return;
  gloSkidStampNextAt[rearI] = nowMs + GLO_SKID_STAMP_INTERVAL_MS;
  // Length along the kart's forward axis (tyre footprint) and width
  // perpendicular (slightly wider than the dark scuff so it haloes).
  const halfLen = M(0.32);
  const halfWid = GLO_SKID_WIDTH * 0.5;
  // Forward / right vectors. fwdX/fwdZ are normalised by the caller.
  const fx = fwdX, fz = fwdZ;
  const rx = fz, rz = -fx;
  const o = gloSkidWriteIdx * 12;
  const a = gloSkidWriteIdx * 4;
  // Quad winding matches emitGloSkidQuad: prev-L, prev-R, curr-R, curr-L
  // (i.e. back-left, back-right, front-right, front-left of the stamp).
  const y = contactY + SKID_Y_OFFSET;
  gloSkidPositions[o +  0] = contactX - fx * halfLen + rx * halfWid; gloSkidPositions[o +  1] = y; gloSkidPositions[o +  2] = contactZ - fz * halfLen + rz * halfWid;
  gloSkidPositions[o +  3] = contactX - fx * halfLen - rx * halfWid; gloSkidPositions[o +  4] = y; gloSkidPositions[o +  5] = contactZ - fz * halfLen - rz * halfWid;
  gloSkidPositions[o +  6] = contactX + fx * halfLen - rx * halfWid; gloSkidPositions[o +  7] = y; gloSkidPositions[o +  8] = contactZ + fz * halfLen - rz * halfWid;
  gloSkidPositions[o +  9] = contactX + fx * halfLen + rx * halfWid; gloSkidPositions[o + 10] = y; gloSkidPositions[o + 11] = contactZ + fz * halfLen + rz * halfWid;
  gloSkidLife[a]     = 1.0;
  gloSkidLife[a + 1] = 1.0;
  gloSkidLife[a + 2] = 1.0;
  gloSkidLife[a + 3] = 1.0;
  // Keep prev in sync so the first post-burnout movement frame doesn't
  // draw a giant ribbon spanning from a stale anchor.
  if (gloSkidPrev[rearI]) gloSkidPrev[rearI].set(contactX, contactY, contactZ);
  else gloSkidPrev[rearI] = new THREE.Vector3(contactX, contactY, contactZ);
  gloSkidWriteIdx = (gloSkidWriteIdx + 1) % GLO_SKID_QUAD_COUNT;
  if (gloSkidFilled < GLO_SKID_QUAD_COUNT) {
    gloSkidFilled++;
    gloSkidGeo.setDrawRange(0, gloSkidFilled * 6);
  }
  gloSkidGeo.attributes.position.needsUpdate = true;
  gloSkidGeo.attributes.aLife.needsUpdate = true;
}

function updateGloSkidLife(dt) {
  // Linear fade across the whole array. With 320 floats this is trivial.
  let dirty = false;
  const fadePerSec = 1 / GLO_SKID_LIFE_S;
  const step = fadePerSec * dt;
  for (let i = 0; i < gloSkidLife.length; i++) {
    if (gloSkidLife[i] > 0) {
      gloSkidLife[i] = Math.max(0, gloSkidLife[i] - step);
      dirty = true;
    }
  }
  if (dirty) gloSkidGeo.attributes.aLife.needsUpdate = true;
  gloSkidMat.uniforms.uTime.value += dt;
  // Live-tint from the underglow rig so the burnout marks always match
  // whatever effect is currently selected (Sunrise gradient, Strobe, …).
  if (typeof underglow !== 'undefined' && underglow && underglow.currentColor) {
    gloSkidMat.uniforms.uColor.value.copy(underglow.currentColor);
  }
}

const skidPrev = [null, null, null, null];
let skidWriteIdx = 0;
let skidFilled = 0;
const _skidContact = new THREE.Vector3();

function clearSkidTrails() {
  for (let i = 0; i < 4; i++) skidPrev[i] = null;
}

function emitSkidQuad(wheelI, contactX, contactY, contactZ) {
  // ── Per-kart trail profile gating ────────────────────────────
  // Hovercraft / broom: no rubber on the road at all.
  if (KART_TRAIL.skipDarkSkids) return;
  // Trike with single front wheel: collapse fronts (indices 2,3) into
  // a single centerline lane stored at slot 2; skip slot 3.
  if (KART_TRAIL.frontCenter && wheelI >= 2) {
    if (wheelI === 3) return;
    const cl = projectContactToCenterline(contactX, contactZ);
    contactX = cl.x;
    contactZ = cl.z;
  }
  // Trike with single rear wheel: collapse rears (indices 0,1) into a
  // single centerline lane at slot 0; skip slot 1.
  if (KART_TRAIL.rearCenter && wheelI < 2) {
    if (wheelI === 1) return;
    const cl = projectContactToCenterline(contactX, contactZ);
    contactX = cl.x;
    contactZ = cl.z;
  }
  const prev = skidPrev[wheelI];
  if (!prev) {
    skidPrev[wheelI] = new THREE.Vector3(contactX, contactY, contactZ);
    return;
  }
  const dx = contactX - prev.x;
  const dz = contactZ - prev.z;
  const distSq = dx * dx + dz * dz;
  if (distSq < SKID_MIN_STEP * SKID_MIN_STEP) return;
  const len = Math.sqrt(distSq);
  // Half-width perpendicular vector in XZ plane.
  const px = (-dz / len) * SKID_WIDTH * 0.5;
  const pz = ( dx / len) * SKID_WIDTH * 0.5;
  const o = skidWriteIdx * 12;
  // Quad winding: prev-L, prev-R, curr-R, curr-L (CCW from above).
  skidPositions[o +  0] = prev.x + px;
  skidPositions[o +  1] = prev.y + SKID_Y_OFFSET;
  skidPositions[o +  2] = prev.z + pz;
  skidPositions[o +  3] = prev.x - px;
  skidPositions[o +  4] = prev.y + SKID_Y_OFFSET;
  skidPositions[o +  5] = prev.z - pz;
  skidPositions[o +  6] = contactX - px;
  skidPositions[o +  7] = contactY + SKID_Y_OFFSET;
  skidPositions[o +  8] = contactZ - pz;
  skidPositions[o +  9] = contactX + px;
  skidPositions[o + 10] = contactY + SKID_Y_OFFSET;
  skidPositions[o + 11] = contactZ + pz;
  prev.set(contactX, contactY, contactZ);
  skidWriteIdx = (skidWriteIdx + 1) % SKID_QUAD_COUNT;
  if (skidFilled < SKID_QUAD_COUNT) {
    skidFilled++;
    skidGeo.setDrawRange(0, skidFilled * 6);
  }
  skidGeo.attributes.position.needsUpdate = true;
}

const _skidFwd = new THREE.Vector3();
const _skidVel = new THREE.Vector3();

function updateSkidTrails() {
  if (!chassisBody) return;
  // Chassis forward (yaw only) — use the smoothed camera yaw for
  // lateral computation? No: the camera yaw lags. Use the chassis
  // quaternion directly so we measure the kart's actual side-slip.
  const q = chassisBody.quaternion;
  const sinyCosp = 2 * (q.w * q.y + q.x * q.z);
  const cosyCosp = 1 - 2 * (q.y * q.y + q.x * q.x);
  const yaw = Math.atan2(sinyCosp, cosyCosp);
  _skidFwd.set(Math.sin(yaw), 0, Math.cos(yaw));
  _skidVel.set(chassisBody.velocity.x, 0, chassisBody.velocity.z);
  const speed = _skidVel.length();
  const fwdSpeed = _skidVel.dot(_skidFwd);
  // Lateral component magnitude (signed XZ cross with forward).
  const latSpeed = Math.abs(_skidVel.x * _skidFwd.z - _skidVel.z * _skidFwd.x);

  // ── Burnout charge: space + W held with the kart roughly stationary ──
  // The handbrake locks the rear wheels while throttle pours torque in,
  // so the rear tyres "spin against the ground" — we visualise that with
  // a thick smoke plume from each rear wheel and tally a `burnoutCharge`
  // timer. Releasing space after a long-enough charge triggers the GLO
  // burnout boost trail (handled below).
  const dtFrame = Math.max(0.001, performance.now() - (updateSkidTrails._lastT || performance.now())) / 1000;
  updateSkidTrails._lastT = performance.now();
  let grounded = false;
  for (let i = 0; i < 4; i++) {
    if (vehicle.wheelInfos[i] && vehicle.wheelInfos[i].isInContact) { grounded = true; break; }
  }
  const charging = keys.space && keys.w && grounded && Math.abs(fwdSpeed) < M(2.5);
  // 0..1 across the 6 s build-up window. Used everywhere below so a
  // single value drives smoke density, GLO sparks and the eventual
  // explosion threshold.
  const stage = Math.min(1, burnoutCharge / BURNOUT_OVERHEAT_S);
  // ── Drive the "feel" rig ──────────────────────────────────
  // Charge → progressive rumble + GLO overdrive + slight FOV pull-in
  // (anticipation). Boost window (post-release) → no rumble but bright
  // pulse holds. Numbers tuned empirically for satisfying readability
  // without obscuring the playfield.
  if (charging && performance.now() >= engineExplodedUntil) {
    // Cubic bias so the last second of the build-up feels much more
    // intense than the first — sells the "engine about to blow" beat.
    const bias = stage * stage;
    _burnoutShakeAmp = bias * 1.0;        // base 1.0 in shake-amplitude units
    // Modest boost ceiling so the player's selected GLO colour stays
    // recognisable through the build-up rather than washing out to
    // white from additive over-saturation. ~1.6× at peak (was 2.6×).
    _burnoutGloBoost = 1 + stage * 0.6;
    _burnoutFovKick = -stage * 4.5;       // pull in up to 4.5°
  } else if (gloBurnoutT > 0) {
    // Boost trail playback after a clean release. Hold a bright pulse
    // and a small positive FOV kick that decays naturally.
    const t = gloBurnoutT / BURNOUT_BOOST_DURATION_MAX_S;
    _burnoutShakeAmp = 0;
    _burnoutGloBoost = 1 + t * 0.5;
    _burnoutFovKick  = t * 5.0;
  } else if (performance.now() < engineExplodedUntil) {
    // Lockout period after the engine pops — heavy rumble, no FOV pull.
    const lockT = (engineExplodedUntil - performance.now()) / (ENGINE_LOCKOUT_S * 1000);
    _burnoutShakeAmp = 0.65 * lockT;
    _burnoutGloBoost = 1 + lockT * 0.3;
    _burnoutFovKick  = 0;
  } else {
    _burnoutShakeAmp = 0;
    _burnoutGloBoost = 1;
    _burnoutFovKick  = 0;
  }

  // ── Mario-Kart drift visuals ───────────────────────────────────
  // The committed-drift state machine lives in the physics worker;
  // we mirror its tier/active/release flags here and layer them on top
  // of the feel rig (Math.max so a burnout charge still wins). Three
  // beats drive the show:
  //   • Tier-up edge      → brief flash + GLO pulse + small FOV pull-in
  //   • While drifting    → continuous GLO skid emission + sparks at rear
  //   • Boost release     → hard FOV punch + shake spike + spark burst
  // The continuous flame trail is the existing gloSkid mesh, which
  // already has the BTTF-style flame-out shader; we just keep feeding
  // fresh quads while the drift is held.
  const cs = physicsBridge?.controlState;
  if (cs) {
    const dTier = cs.driftTier | 0;
    const dActive = !!cs.driftActive;
    const dDir = cs.driftDir | 0;
    const released = cs.driftJustReleasedTier | 0;

    if (dActive) {
      // Emit gated on the player-intent `driftActive` flag, NOT on
      // `wi.isInContact`. The drift's asymmetric grip + yaw torque
      // routinely chatter the rear wheels off the ground for a frame
      // or two; gating on isInContact (or even main-thread `grounded`)
      // produces a stuttering or completely empty trail because each
      // airborne frame would also reset `gloSkidPrev[i]` and force the
      // next emit to seed-and-skip. Using `dActive` keeps the trail
      // continuous for the whole committed slide.
      for (let i = 0; i < 2; i++) {
        const wi = vehicle.wheelInfos[i];
        if (!wi) continue;
        const wp = wi.worldTransform.position;
        emitGloSkidQuad(i, wp.x, wp.y - WHEEL_RADIUS, wp.z);
      }
      // Tier-coloured GLO sparks streaming off the inner rear wheel.
      if (typeof spawnGloExhPuff === 'function') {
        const sparkRate = 0.10 + 0.18 * dTier;
        if (Math.random() < sparkRate) {
          const innerWheel = dDir > 0 ? 0 : 1;
          const wi2 = vehicle.wheelInfos[innerWheel];
          if (wi2) spawnGloExhPuff(0.4 + 0.2 * dTier);
        }
      }
      // Boost the underglow as the tier climbs.
      _burnoutGloBoost = Math.max(_burnoutGloBoost, 1 + 0.18 + 0.22 * dTier);
      // Tier-up edge: punch flash + small inward FOV pull + spark burst.
      if (dTier > _driftLastTier) {
        _burnoutFlash = Math.max(_burnoutFlash, 0.18 + 0.18 * dTier);
        _burnoutFovKick = Math.min(_burnoutFovKick, -1.2 - 0.6 * dTier);
        _burnoutShakeAmp = Math.max(_burnoutShakeAmp, 0.20 + 0.10 * dTier);
        if (typeof spawnGloExhPuff === 'function') {
          for (let s = 0; s < 4 + 4 * dTier; s++) spawnGloExhPuff(0.5 + 0.15 * dTier);
        }
      }
      _driftLastTier = dTier;
    } else {
      _driftLastTier = 0;
      // Do NOT reset `gloSkidPrev` here. The MAX_STEP guard inside
      // emitGloSkidQuad already handles the "stale prev across drift
      // toggles" case by re-seeding without emission, and resetting
      // here would force every active frame to merely seed prev under
      // any RAF/worker rate disparity (e.g. headless playwright).
    }

    // Boost release one-shot. Latch via _driftLastReleasedAt so the
    // worker re-broadcasting the same tier on the next snapshot can't
    // double-fire the burst.
    if (released > 0 && performance.now() - _driftLastReleasedAt > 100) {
      _driftLastReleasedAt = performance.now();
      _burnoutFlash = Math.max(_burnoutFlash, 0.45 + 0.18 * released);
      _burnoutFovKick = Math.max(_burnoutFovKick, 3.0 + 1.6 * released);
      _burnoutShakeAmp = Math.max(_burnoutShakeAmp, 0.35 + 0.20 * released);
      if (typeof spawnGloExhPuff === 'function') {
        const burst = 14 + 10 * released;
        for (let s = 0; s < burst; s++) spawnGloExhPuff(0.7 + 0.15 * released);
      }
    }

    if (cs.boostTimer > 0) {
      const bt = cs.boostTier | 0;
      _burnoutGloBoost = Math.max(_burnoutGloBoost, 1 + 0.25 + 0.20 * bt);
    }
  }

  if (charging && performance.now() >= engineExplodedUntil) {
    burnoutCharge += dtFrame;
    // Realistic, low-impact tire smoke. Each frame we spawn:
    //   • A small dense plume RIGHT at each rear contact patch — the
    //     "source" wisps that read as the spinning tyre itself, with
    //     a fast upward kick.
    //   • A handful of trailing puffs scattered through a short
    //     ellipsoid behind the kart — the body of the cloud that
    //     accumulates over time.
    //
    // Both grow PROGRESSIVELY with `stage` (0..1 across the 6 s hold)
    // and `heldBonus` (also 0..1 over the hold) so a brief tap leaves
    // a quick wisp and a sustained burnout builds a thick volume.
    // Particle counts are deliberately modest (peak ~24 puffs/frame
    // total vs the previous ~200) — the smoke pool size, lifetimes,
    // and overdraw mean a steady stream of ~24/frame already settles
    // into a chunky cloud without overwhelming the GPU.
    const expRamp = stage * stage;                         // 0..1, smooth ramp
    const heldBonus = Math.min(1, burnoutCharge / BURNOUT_OVERHEAT_S);
    const baseIntensity = 0.7 + stage * 0.3;
    const cloudLife = 1.4 + stage * 2.4 + heldBonus * 1.2; // up to ~5 s at peak hold
    const cloudRise = 0.45 - stage * 0.20;                 // 0.45 → 0.25 (puffs barely lift at peak)
    const dark      = 0.30 + stage * 0.60;                 // 0.30 → 0.90 (sooty)
    const sizeMult  = 0.85 + stage * 0.55 + heldBonus * 0.30;
    // GLO tint strength climbs with stage so the cloud picks up more
    // of the player's colour the longer the burnout is held — reads
    // as the underglow heating the smoke from below.
    const bodyGlo   = 0.18 + stage * 0.32;                 // body wash
    const tyreGlo   = 0.45 + stage * 0.55;                 // brighter on the source

    // Resolve a yaw frame for "behind the kart" placement. Out of the
    // per-puff loop to avoid trig in the hot path.
    const q = chassisBody.quaternion;
    const sinyCosp = 2 * (q.w * q.y + q.x * q.z);
    const cosyCosp = 1 - 2 * (q.y * q.y + q.x * q.x);
    const yaw = Math.atan2(sinyCosp, cosyCosp);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const rx = fz, rz = -fx; // right vector (XZ)

    // ── Source wisps from each rear tyre ────────────────────────
    // 6..18 puffs/wheel/frame (was 2..6). Smaller particles read as
    // realistic tyre smoke when they're dense; per-puff size is also
    // capped lower below.
    const tyrePuffs = 6 + Math.round(stage * 12);          // 6 → 18 per wheel
    const tyreSize  = 0.85 + stage * 0.55;
    let anyRearGrounded = false;
    for (let i = 0; i < 2; i++) {
      const wi = vehicle.wheelInfos[i];
      if (!wi) continue;
      // Smoke even on a brief airborne flicker so the visual stays
      // continuous; just bias toward the contact patch when grounded.
      const inContact = !!wi.isInContact;
      if (inContact) anyRearGrounded = true;
      const wp = wi.worldTransform.position;
      for (let p = 0; p < tyrePuffs; p++) {
        spawnSmokePuff(
          wp.x + (Math.random() - 0.5) * M(0.20),
          wp.y - WHEEL_RADIUS * 0.4 + Math.random() * M(0.12),
          wp.z + (Math.random() - 0.5) * M(0.20),
          baseIntensity + 0.10,
          0.45 + stage * 0.55,                   // 0.45 s → 1.0 s (short)
          1.3 + stage * 0.5,                     // strong upward kick
          dark * 0.65,
          tyreSize * (0.85 + Math.random() * 0.4),
          tyreGlo * (0.85 + Math.random() * 0.3)
        );
      }
      // Lay down a dark scuff under the spinning rear tyre so the
      // static burnout still leaves a visual record on the ground.
      // Layer a kart-aligned GLO stamp on top so the burnout marks
      // pick up the player's selected underglow colour (gloSkidMat
      // reads its uColor live from underglow.currentColor each frame).
      // We use emitGloSkidStamp \u2014 not the ribbon emitter \u2014 because
      // a stationary burnout has no per-frame contact-point motion
      // for the ribbon's prev\u2192current span to span.
      if (inContact) {
        emitSkidQuad(i, wp.x, wp.y - WHEEL_RADIUS, wp.z);
        emitGloSkidStamp(i, wp.x, wp.y - WHEEL_RADIUS, wp.z, fx, fz);
      }
      // Mid-charge onward: spit a few GLO sparks out the back so the
      // player can SEE the boost charging up.
      if (stage > 0.35 && typeof spawnGloExhPuff === 'function') {
        const sparks = Math.floor(stage * 3);
        for (let s = 0; s < sparks; s++) spawnGloExhPuff(0.3 + stage * 0.7);
      }
    }

    // ── Trailing body of the cloud ──────────────────────────────
    // 12..36 puffs/frame (was 4..12) scattered in a short half-
    // ellipsoid behind the rear bumper. ALWAYS rearward (sb >= 0)
    // so the cloud cannot overlap the kart silhouette. Higher count
    // pairs with the smaller per-puff size to read as a thick volume
    // of fine tyre-smoke rather than a few oversized blobs.
    const bodyPuffs = 12 + Math.round(expRamp * 24);        // 12 → 36
    const cloudCenterX = chassisBody.position.x - fx * CHASSIS_HZ;
    const cloudCenterZ = chassisBody.position.z - fz * CHASSIS_HZ;
    const groundY      = chassisBody.position.y - CHASSIS_HY * 0.95;
    const radR = M(0.4)  + stage * M(0.9) + heldBonus * M(0.4);   // lateral
    const radU = M(0.30) + stage * M(0.6) + heldBonus * M(0.3);   // vertical
    const radB = M(0.5)  + stage * M(1.8) + heldBonus * M(0.8);   // back
    for (let p = 0; p < bodyPuffs; p++) {
      const ux = (Math.random() - 0.5) * 2;
      const uy = Math.random();             // upward bias only
      const uz = (Math.random() - 0.5) * 2;
      const lenSq = ux*ux + uy*uy + uz*uz || 1;
      const inv   = 1 / Math.sqrt(lenSq);
      const r     = Math.cbrt(Math.random()); // bias toward the surface
      const sx = ux * inv * r;
      const sy = uy * inv * r;
      const sb = Math.abs(uz * inv * r);     // strictly rearward
      const wx = cloudCenterX + rx * sx * radR + (-fx) * sb * radB;
      const wz = cloudCenterZ + rz * sx * radR + (-fz) * sb * radB;
      const wy = groundY + sy * radU;
      spawnSmokePuff(
        wx, wy, wz,
        baseIntensity + (Math.random() - 0.5) * 0.15,
        cloudLife * (0.85 + Math.random() * 0.4),
        cloudRise * (0.7 + Math.random() * 0.6),
        dark - Math.random() * 0.15,
        sizeMult * (0.85 + Math.random() * 0.5),
        bodyGlo * (0.7 + Math.random() * 0.6)
      );
    }

    // Suppress noisy `unused-variable` warnings — heldBonus already
    // factored into life/size above; anyRearGrounded reserved for
    // future "chassis-grounded vs airborne" tweaks.
    void heldBonus; void anyRearGrounded;

    // Engine overheat → fire the explosion exactly once per charge.
    if (burnoutCharge >= BURNOUT_OVERHEAT_S) {
      triggerEngineExplosion();
      burnoutCharge = 0;
    }
  } else if (burnoutCharge > 0 && !keys.space && burnoutPrevSpace) {
    // Just released space — promote the charge to a boost trail if it was
    // held long enough. Forward throttle (`keys.w`) is required so a plain
    // brake-tap doesn't fire the effect. Boost duration scales with the
    // charge, rewarding skilful holds that stop *just* shy of overheat.
    if (burnoutCharge >= BURNOUT_CHARGE_MIN_S && keys.w && performance.now() >= engineExplodedUntil) {
      const t = Math.min(1, burnoutCharge / BURNOUT_OVERHEAT_S);
      gloBurnoutT = BURNOUT_BOOST_DURATION_S + (BURNOUT_BOOST_DURATION_MAX_S - BURNOUT_BOOST_DURATION_S) * t;
      // Punchy release: a one-shot flash + FOV kick that decays fast.
      _burnoutFlash = Math.max(_burnoutFlash, 0.5 + 0.5 * t);
      _burnoutFovKick = 6.0 * t;
    }
    burnoutCharge = 0;
  } else if (!keys.space) {
    // Decay charge when space is up so brief taps don't accumulate.
    burnoutCharge = Math.max(0, burnoutCharge - dtFrame * 2);
  }
  burnoutPrevSpace = keys.space;

  // ── Engine-explosion aftermath plume ────────────────────────
  // Continues for ENGINE_STEAM_S after the pop. Anchors on the engine
  // bay (not chassis centre) and spreads radially so it reads as the
  // ruptured engine block venting, not generic chassis smoke. Also
  // dribbles a few residual sparks for the first ~half of the window.
  const sinceExplosion = (performance.now() - engineExplosionFiredAt) / 1000;
  if (engineExplosionFiredAt > 0 && sinceExplosion < ENGINE_STEAM_S) {
    const ep = getEnginePos();
    const t = sinceExplosion / ENGINE_STEAM_S;
    // Heavy black smoke early, fading to wisps. Per-puff intensity
    // also falls with t so the column lightens visually.
    const puffs = Math.max(1, Math.floor(5 * (1 - t)));
    for (let p = 0; p < puffs; p++) {
      const ang = Math.random() * Math.PI * 2;
      const r0  = M(0.05) + Math.random() * M(0.20);
      const dx = Math.cos(ang), dz = Math.sin(ang);
      // Outward speed is huge for the first 0.3 s, then collapses to a
      // gentle rise (engine stops venting under pressure).
      const burst = Math.max(0, 1 - t * 3);
      const speed = M(0.4) + burst * M(2.5);
      spawnRadialSmokePuff(
        ep.x + dx * r0,
        ep.y + (Math.random() - 0.2) * M(0.2),
        ep.z + dz * r0,
        dx, dz, speed,
        0.95 - t * 0.5
      );
    }
    // Trickle of secondary sparks for the first half of the steam life.
    if (t < 0.5 && Math.random() < 0.6) {
      spawnDebrisSpark(ep.x, ep.y, ep.z, M(2.5));
    }
  }

  // ── GLO burnout boost: emit glowing rear-tyre marks for a short window
  if (gloBurnoutT > 0) {
    gloBurnoutT = Math.max(0, gloBurnoutT - dtFrame);
    for (let i = 0; i < 2; i++) {
      const wi = vehicle.wheelInfos[i];
      if (!wi) continue;
      const wp = wi.worldTransform.position;
      emitGloSkidQuad(i, wp.x, wp.y - WHEEL_RADIUS, wp.z);
      // Also dump some bright smoke that picks up the underglow tint
      // automatically (the smoke shader uses a fixed grey colour, but the
      // GLO-tinted exhaust stream covers the colour story — so just bump
      // intensity here).
      spawnSmokePuff(wp.x, wp.y - WHEEL_RADIUS * 0.5, wp.z, 1.0);
    }
  }
  // Note: do NOT reset `gloSkidPrev` when `gloBurnoutT <= 0`. That
  // resets the drift-trail prev every non-burnout frame, blanking the
  // drift trail. The MAX_STEP guard inside emitGloSkidQuad is the
  // single source of truth for stale-prev handling.

  const handbrakeDrift = keys.drift && keys.space && Math.abs(fwdSpeed) > M(1);
  const hardBrake = keys.space && fwdSpeed > SKID_BRAKE_SPEED_THRESHOLD;
  const sideSlip = latSpeed > SKID_LATERAL_THRESHOLD;
  const skidding = handbrakeDrift || hardBrake || sideSlip;

  if (!skidding) {
    // Don't wipe rear-wheel `skidPrev` while a burnout is charging —
    // we want the dark scuff above to remain continuous.
    if (!charging) clearSkidTrails();
    return;
  }

  for (let i = 0; i < 4; i++) {
    const wi = vehicle.wheelInfos[i];
    if (!wi || !wi.isInContact) { skidPrev[i] = null; continue; }
    const wp = wi.worldTransform.position;
    // Contact patch sits ~WHEEL_RADIUS below the wheel mount.
    emitSkidQuad(i, wp.x, wp.y - WHEEL_RADIUS, wp.z);
    // Spawn a smoke puff. Intensity scales with how violently the kart
    // is skidding so light slides emit a wisp and full handbrake drifts
    // emit a chunky cloud.
    const intensity = Math.min(1, (latSpeed / M(8)) + (handbrakeDrift ? 0.5 : 0));
    spawnSmokePuff(wp.x, wp.y - WHEEL_RADIUS * 0.5, wp.z, intensity);
  }
}

// ── Tire smoke (cheap THREE.Points pool) ──────────────────────
// Helper: vertical pixel scale for THREE.Points perspective sizing.
// THREE's intended formula is `gl_PointSize = world_size * scale / -mv.z`
// with `scale = canvas.height / (2 · tan(fov/2))` so a sprite of WORLD
// radius `r` at view-space depth `d` projects to roughly `r·scale/d`
// pixels. Earlier code used `canvas.height * 0.5` as the scale AND
// treated `SMOKE_BASE_SIZE` as a pixel value — that was a tolerable
// approximation when world units were metres, but after the unit
// unification (1 world unit = 1 mm) `-mv.z` ballooned by ×1000 and
// every smoke puff collapsed to the `gl_PointSize >= 2.0` clamp,
// rendering as imperceptible 2-pixel grey dots. We now compute the
// proper focal-length scale and reinterpret the per-puff size
// constants below as WORLD-SPACE radii (in mm) so the formula is
// dimensionally consistent again.
function _focalPxScale() {
  const h = (canvas.clientHeight || window.innerHeight) || 1;
  const fovDeg = camera && camera.fov ? camera.fov : 70;
  return h / (2 * Math.tan((fovDeg * Math.PI) / 360));
}
// Single Points object backed by a fixed-size ring. Per particle:
//   - position (3 floats) updated each frame
//   - life     (1 float) drives size + alpha via vertex shader
// Cost: a Float32Array sweep over POOL_SIZE on every render frame.
// At POOL=160 that's ~3 \u00b5s. No texture lookups, no per-puff allocations.
// Smaller, denser smoke particles — tuned to read as realistic tyre
// smoke (lots of fine wisps) instead of a few large blob sprites.
// Pool size + per-frame puff counts upstream are scaled to compensate.
const SMOKE_POOL_SIZE = 1024;
const SMOKE_LIFE_S = 0.55;
const SMOKE_RISE_VY = M(0.9);
const SMOKE_DRIFT_RAND = M(0.6);
const SMOKE_BASE_SIZE = 38;     // px at the screen-Y reference (was 90)
const SMOKE_GROWTH_PX = 50;     // grows over its life (was 110)
const smokePositions = new Float32Array(SMOKE_POOL_SIZE * 3);
const smokeVelocities = new Float32Array(SMOKE_POOL_SIZE * 3);
const smokeLife = new Float32Array(SMOKE_POOL_SIZE);   // remaining seconds
const smokeMax  = new Float32Array(SMOKE_POOL_SIZE);   // initial life (for normalised t)
const smokeIntensity = new Float32Array(SMOKE_POOL_SIZE); // 0..1, controls size
// Per-puff style overrides used by the burnout cloud: darkness biases
// the colour from clean grey toward sooty dark grey; sizeScale lets a
// single puff render much larger than the skid default. Both default
// to 0 (= existing look) so untouched call sites are unaffected.
const smokeDark      = new Float32Array(SMOKE_POOL_SIZE); // 0..1
const smokeSizeScale = new Float32Array(SMOKE_POOL_SIZE); // multiplier baseline 1.0
// Per-puff rotation (radians) so the noise texture in the fragment
// shader doesn't repeat identically on every billboard.
const smokeRot       = new Float32Array(SMOKE_POOL_SIZE);
// Per-puff GLO tint strength (0 = pure grey smoke, 1 = fully tinted by
// the user's selected GLO colour). The colour itself is fed in via the
// uGloColor uniform (refreshed once per frame from underglow.currentColor)
// so we keep the shader cost to a single mix() per fragment.
const smokeGlo       = new Float32Array(SMOKE_POOL_SIZE);
for (let i = 0; i < SMOKE_POOL_SIZE; i++) smokeSizeScale[i] = 1.0;
let smokeWriteIdx = 0;
const smokeGeo = new THREE.BufferGeometry();
smokeGeo.setAttribute('position', new THREE.BufferAttribute(smokePositions, 3));
smokeGeo.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(SMOKE_POOL_SIZE), 1));
smokeGeo.setAttribute('aIntensity', new THREE.BufferAttribute(new Float32Array(SMOKE_POOL_SIZE), 1));
smokeGeo.setAttribute('aDark',      new THREE.BufferAttribute(new Float32Array(SMOKE_POOL_SIZE), 1));
smokeGeo.setAttribute('aSize',      new THREE.BufferAttribute(new Float32Array(SMOKE_POOL_SIZE).fill(1), 1));
smokeGeo.setAttribute('aRot',       new THREE.BufferAttribute(new Float32Array(SMOKE_POOL_SIZE), 1));
smokeGeo.setAttribute('aGlo',       new THREE.BufferAttribute(new Float32Array(SMOKE_POOL_SIZE), 1));
smokeGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
// Custom material: round soft puff via gl_PointCoord, alpha fades out,
// size grows with age. Additive-friendly grey \u2014 reads on dark and light
// roads. No texture sample = no bandwidth cost.
const smokeMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: {
    uBaseSize: { value: SMOKE_BASE_SIZE },
    uGrowth:   { value: SMOKE_GROWTH_PX },
    uPxScale:  { value: _focalPxScale() },
    // Player's selected GLO colour, refreshed once/frame by the main
    // update loop. Default cyan matches DEFAULT_GLO_COLOR2 so the
    // smoke renders correctly until the underglow has a value to push.
    uGloColor: { value: new THREE.Color(0x00e5ff) },
  },
  vertexShader: /* glsl */`
    attribute float aLife;
    attribute float aIntensity;
    attribute float aDark;
    attribute float aSize;
    attribute float aRot;
    attribute float aGlo;
    varying float vLife;
    varying float vDark;
    varying float vRot;
    varying float vSeed;
    varying float vGlo;
    uniform float uBaseSize;
    uniform float uGrowth;
    uniform float uPxScale;
    void main() {
      vLife = aLife;
      vDark = aDark;
      vRot  = aRot;
      vGlo  = aGlo;
      vSeed = fract(aRot * 0.15915 + aDark * 7.13);
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      // Perspective-scaled point size; grows as the puff ages.
      float age = 1.0 - aLife;
      float sz = (uBaseSize + uGrowth * age) * (0.6 + 0.4 * aIntensity) * aSize;
      gl_PointSize = max(2.0, sz * uPxScale / max(1.0, -mv.z));
    }
  `,
  fragmentShader: /* glsl */`
    varying float vLife;
    varying float vDark;
    varying float vRot;
    varying float vSeed;
    // vGlo / uGloColor were used below without being declared at the
    // top of this stage — that silently broke the smoke shader on
    // strict GLSL drivers, causing the entire ShaderMaterial to fail
    // to compile and every burnout puff to render as nothing. Adding
    // the declarations restores the GLO underlight tint AND fixes the
    // "tire smoke is missing" bug downstream.
    varying float vGlo;
    uniform vec3 uGloColor;
    // Cheap hash + value noise for wispy internal structure. Single
    // octave (was 2) — the second octave was a measurable cost given
    // the dozens of overdraw-stacked puffs/frame the burnout cloud
    // emits, for a barely visible quality bump.
    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      float a = hash21(i);
      float b = hash21(i + vec2(1.0, 0.0));
      float c = hash21(i + vec2(0.0, 1.0));
      float d = hash21(i + vec2(1.0, 1.0));
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }
    void main() {
      vec2 c = gl_PointCoord - vec2(0.5);
      float d = length(c) * 2.0;
      if (d > 1.0) discard;
      // Rotate UV per puff so the noise pattern doesn't tile.
      float cs = cos(vRot), sn = sin(vRot);
      vec2 ruv = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) + vSeed * 9.31;
      float n = vnoise(ruv * 6.5);
      // Silhouette is the soft round mask, eroded by noise so the
      // edges have tendrils rather than a clean disc.
      float mask = smoothstep(1.0, 0.15, d);
      float erode = smoothstep(0.25, 0.85, n);
      // Opacity climbs hard with vDark so charged-burnout puffs
      // render as DENSE smoke (~95% opaque at peak) while light skid
      // wisps stay airy (~55%).
      float a = mask * mix(0.55, 1.0, erode) * vLife * (0.55 + 0.45 * vDark);
      // Mid-bright noise modulates the colour so dense areas read
      // darker (sooty core) and edges read lighter (fresh wisp).
      float shade = 0.55 + 0.45 * n;
      vec3 light = vec3(0.82, 0.81, 0.80);
      vec3 dark  = vec3(0.16, 0.15, 0.14);
      vec3 col   = mix(light, dark, vDark) * shade;
      // GLO underlight: tint the brighter (rim/wisp) regions of the
      // puff with the player's selected GLO colour, leaving the dense
      // sooty cores grey. Reads as the kart's underglow lighting up
      // the smoke from below — cheap (one mix per fragment) but
      // visually anchors the cloud to the player's chosen palette.
      // Rim weight peaks where noise is bright AND the puff is near
      // its edge (1 - d) so the colour pops on the wispy outline.
      float rim   = (0.35 + 0.65 * n) * (0.4 + 0.6 * (1.0 - d));
      float gloK  = vGlo * rim;
      // Add (not replace) so the colour stacks ON TOP of the soot
      // gradient — keeps the smoke reading as smoke, not as flat
      // coloured plasma.
      col += uGloColor * gloK * (0.55 + 0.45 * vLife);
      gl_FragColor = vec4(col, a);
    }
  `,
});
const smokePoints = new THREE.Points(smokeGeo, smokeMat);
smokePoints.renderOrder = 2;
smokePoints.frustumCulled = false;
scene.add(smokePoints);

// Initialise all life=0 so the pool is hidden until particles spawn.
for (let i = 0; i < SMOKE_POOL_SIZE; i++) {
  // Push spawn position offscreen-down so dead slots don't render even
  // if the alpha math is ever skipped.
  smokePositions[i * 3 + 1] = -1e6;
}

const _smokeLifeAttr = smokeGeo.attributes.aLife;
const _smokeIntensityAttr = smokeGeo.attributes.aIntensity;
const _smokeDarkAttr = smokeGeo.attributes.aDark;
const _smokeSizeAttr = smokeGeo.attributes.aSize;
const _smokeRotAttr  = smokeGeo.attributes.aRot;
const _smokeGloAttr  = smokeGeo.attributes.aGlo;

function spawnSmokePuff(x, y, z, intensity, lifeSec, riseScale, dark, sizeMult, gloMix) {
  // Throttle: skip half of incoming spawn requests under low intensity
  // so light slides emit a sparse trail instead of saturating the pool.
  if (intensity < 0.25 && Math.random() > 0.4) return;
  const i = smokeWriteIdx;
  smokeWriteIdx = (smokeWriteIdx + 1) % SMOKE_POOL_SIZE;
  const o = i * 3;
  // Optional per-puff life/rise overrides let callers (e.g. the burnout
  // charge) lay down long-lived, slow-rising puffs that build into a
  // persistent cloud rather than the brief skid wisps used elsewhere.
  const life = (lifeSec && lifeSec > 0) ? lifeSec : SMOKE_LIFE_S;
  const rise = (riseScale != null) ? riseScale : 1.0;
  const drk  = (dark != null) ? Math.max(0, Math.min(1, dark)) : 0;
  const szM  = (sizeMult != null && sizeMult > 0) ? sizeMult : 1.0;
  const glo  = (gloMix != null) ? Math.max(0, Math.min(1.5, gloMix)) : 0;
  smokePositions[o    ] = x + (Math.random() - 0.5) * SMOKE_DRIFT_RAND * 0.3;
  smokePositions[o + 1] = y;
  smokePositions[o + 2] = z + (Math.random() - 0.5) * SMOKE_DRIFT_RAND * 0.3;
  smokeVelocities[o    ] = (Math.random() - 0.5) * SMOKE_DRIFT_RAND * (0.4 + 0.6 * rise);
  smokeVelocities[o + 1] = SMOKE_RISE_VY * (0.6 + 0.6 * Math.random()) * rise;
  smokeVelocities[o + 2] = (Math.random() - 0.5) * SMOKE_DRIFT_RAND * (0.4 + 0.6 * rise);
  smokeLife[i] = life;
  smokeMax[i]  = life;
  smokeIntensity[i] = Math.max(0.2, Math.min(1, intensity));
  smokeDark[i] = drk;
  smokeSizeScale[i] = szM;
  smokeRot[i] = Math.random() * Math.PI * 2;
  smokeGlo[i] = glo;
  _smokeIntensityAttr.array[i] = smokeIntensity[i];
  _smokeIntensityAttr.needsUpdate = true;
  _smokeDarkAttr.array[i] = drk;
  _smokeDarkAttr.needsUpdate = true;
  _smokeSizeAttr.array[i] = szM;
  _smokeSizeAttr.needsUpdate = true;
  _smokeRotAttr.array[i] = smokeRot[i];
  _smokeRotAttr.needsUpdate = true;
  _smokeGloAttr.array[i] = glo;
  _smokeGloAttr.needsUpdate = true;
}

function updateSmoke(dt) {
  const lifeArr = _smokeLifeAttr.array;
  let dirty = false;
  for (let i = 0; i < SMOKE_POOL_SIZE; i++) {
    if (smokeLife[i] <= 0) {
      if (lifeArr[i] !== 0) { lifeArr[i] = 0; dirty = true; }
      continue;
    }
    smokeLife[i] -= dt;
    const o = i * 3;
    smokePositions[o    ] += smokeVelocities[o    ] * dt;
    smokePositions[o + 1] += smokeVelocities[o + 1] * dt;
    smokePositions[o + 2] += smokeVelocities[o + 2] * dt;
    // Slow the rise / drift over time so puffs settle into a cloud.
    const drag = Math.exp(-1.5 * dt);
    smokeVelocities[o    ] *= drag;
    smokeVelocities[o + 1] *= drag;
    smokeVelocities[o + 2] *= drag;
    lifeArr[i] = Math.max(0, smokeLife[i] / smokeMax[i]);
    dirty = true;
  }
  if (dirty) {
    smokeGeo.attributes.position.needsUpdate = true;
    _smokeLifeAttr.needsUpdate = true;
  }
}

function clearSmoke() {
  for (let i = 0; i < SMOKE_POOL_SIZE; i++) {
    smokeLife[i] = 0;
    _smokeLifeAttr.array[i] = 0;
    smokePositions[i * 3 + 1] = -1e6;
  }
  smokeGeo.attributes.position.needsUpdate = true;
  _smokeLifeAttr.needsUpdate = true;
}

// ── Exhaust puffs (warm-tinted Points pool, throttle-driven) ──
// Same architecture as tire smoke but smaller pool, faster fade, warm
// orange-on-grey palette so it reads as combustion exhaust against the
// cool tire-smoke. Spawn rate scales with throttle intent and forward
// speed; a brief "burst" pulses on ignition (rest \u2192 throttle) for the
// satisfying Mario-Kart launch chuff.
// Exhaust particles — fine, dense puffs to read as realistic engine
// emissions (lots of small particles) instead of a few large blobs.
const EXHAUST_POOL_SIZE = 256;           // larger pool for higher spawn rate
const EXHAUST_LIFE_S = 0.42;
const EXHAUST_SPAWN_PER_S = 110;         // dense stream at full throttle (was 28)
const EXHAUST_BURST = 18;                // chunky ignition pulse (was 6)
const EXHAUST_BACK_OFFSET = M(1.0);      // metres behind chassis
const EXHAUST_HEIGHT = M(0.5);
const EXHAUST_BASE_SIZE = 22;            // px (was 55) — smaller, finer puffs
const EXHAUST_GROWTH_PX = 25;            // grows less over life (was 60)
const exhaustPositions = new Float32Array(EXHAUST_POOL_SIZE * 3);
const exhaustVelocities = new Float32Array(EXHAUST_POOL_SIZE * 3);
const exhaustLife = new Float32Array(EXHAUST_POOL_SIZE);
const exhaustMax  = new Float32Array(EXHAUST_POOL_SIZE);
const exhaustHue  = new Float32Array(EXHAUST_POOL_SIZE); // 0=cool grey, 1=warm orange
let exhaustWriteIdx = 0;
let exhaustSpawnAccum = 0;
let prevThrottleHeld = false;
const exhaustGeo = new THREE.BufferGeometry();
exhaustGeo.setAttribute('position', new THREE.BufferAttribute(exhaustPositions, 3));
exhaustGeo.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(EXHAUST_POOL_SIZE), 1));
exhaustGeo.setAttribute('aHue',  new THREE.BufferAttribute(new Float32Array(EXHAUST_POOL_SIZE), 1));
exhaustGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
const exhaustMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  // Additive read so warm puffs glow against the dark tire smoke without
  // a separate texture. Looks like brake-light shimmer at low intensity.
  blending: THREE.AdditiveBlending,
  uniforms: {
    uBaseSize: { value: EXHAUST_BASE_SIZE },
    uGrowth:   { value: EXHAUST_GROWTH_PX },
    uPxScale:  { value: window.innerHeight * 0.5 },
  },
  vertexShader: /* glsl */`
    attribute float aLife;
    attribute float aHue;
    varying float vLife;
    varying float vHue;
    uniform float uBaseSize;
    uniform float uGrowth;
    uniform float uPxScale;
    void main() {
      vLife = aLife;
      vHue = aHue;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      float age = 1.0 - aLife;
      float sz = (uBaseSize + uGrowth * age);
      gl_PointSize = max(2.0, sz * uPxScale / max(1.0, -mv.z));
    }
  `,
  fragmentShader: /* glsl */`
    varying float vLife;
    varying float vHue;
    void main() {
      vec2 c = gl_PointCoord - vec2(0.5);
      float d = length(c) * 2.0;
      if (d > 1.0) discard;
      float a = (1.0 - d * d) * vLife * 0.40;
      // Warm exhaust: hot orange core fading to grey through life.
      vec3 hot = mix(vec3(0.65, 0.65, 0.70), vec3(1.0, 0.55, 0.18), vHue * vLife);
      gl_FragColor = vec4(hot, a);
    }
  `,
});
const exhaustPoints = new THREE.Points(exhaustGeo, exhaustMat);
exhaustPoints.renderOrder = 2;
exhaustPoints.frustumCulled = false;
scene.add(exhaustPoints);

for (let i = 0; i < EXHAUST_POOL_SIZE; i++) exhaustPositions[i * 3 + 1] = -1e6;

const _exhaustLifeAttr = exhaustGeo.attributes.aLife;
const _exhaustHueAttr  = exhaustGeo.attributes.aHue;
const _exFwd = new THREE.Vector3();
const _exRight = new THREE.Vector3();

function spawnExhaustPuff(intensity, speedRatio) {
  if (!chassisBody) return;
  const i = exhaustWriteIdx;
  exhaustWriteIdx = (exhaustWriteIdx + 1) % EXHAUST_POOL_SIZE;
  // Anchor: a metre behind the chassis at half-height. Use chassis yaw
  // so the emit point follows the kart's facing, not the camera.
  const q = chassisBody.quaternion;
  const sinyCosp = 2 * (q.w * q.y + q.x * q.z);
  const cosyCosp = 1 - 2 * (q.y * q.y + q.x * q.x);
  const yaw = Math.atan2(sinyCosp, cosyCosp);
  _exFwd.set(Math.sin(yaw), 0, Math.cos(yaw));
  _exRight.set(_exFwd.z, 0, -_exFwd.x);
  const cp = chassisBody.position;
  const jitter = (Math.random() - 0.5) * M(0.25);
  const o = i * 3;
  exhaustPositions[o    ] = cp.x - _exFwd.x * EXHAUST_BACK_OFFSET + _exRight.x * jitter;
  exhaustPositions[o + 1] = cp.y - EXHAUST_HEIGHT + (Math.random() - 0.5) * M(0.1);
  exhaustPositions[o + 2] = cp.z - _exFwd.z * EXHAUST_BACK_OFFSET + _exRight.z * jitter;
  // Velocity: drift backward (behind the moving kart) + slow rise. Speed
  // adds to the backward drift so fast kart \u2192 longer trail tail.
  const back = M(1.5) + speedRatio * M(2.0);
  exhaustVelocities[o    ] = -_exFwd.x * back + (Math.random() - 0.5) * M(0.4);
  exhaustVelocities[o + 1] = M(0.6) + Math.random() * M(0.4);
  exhaustVelocities[o + 2] = -_exFwd.z * back + (Math.random() - 0.5) * M(0.4);
  exhaustLife[i] = EXHAUST_LIFE_S;
  exhaustMax[i]  = EXHAUST_LIFE_S;
  // Hot puffs (orange) on hard throttle / ignition; idle drift puffs grey.
  exhaustHue[i]  = Math.min(1, intensity);
  _exhaustHueAttr.array[i] = exhaustHue[i];
}

function updateExhaust(dt) {
  if (!chassisBody) return;
  // Spawn rate driven by throttle pedal + speed for the "purring engine"
  // baseline puff at idle.
  const throttle = Math.max(0, controlsThrottleHint());
  const speed = chassisBody.velocity.length();
  const speedRatio = Math.min(1, speed / M(52));
  const throttleHeld = keys.w;
  if (throttleHeld && !prevThrottleHeld) {
    // Ignition burst: a chunky pulse so launches read crisply.
    for (let b = 0; b < EXHAUST_BURST; b++) spawnExhaustPuff(0.9, speedRatio);
  }
  prevThrottleHeld = throttleHeld;

  const ratePerSec = EXHAUST_SPAWN_PER_S * (0.25 + 0.75 * throttle);
  exhaustSpawnAccum += dt * ratePerSec;
  while (exhaustSpawnAccum >= 1) {
    exhaustSpawnAccum -= 1;
    // Hue ramps with throttle pressure so cruising emits cool grey wisps
    // and full-throttle emits glowing orange.
    spawnExhaustPuff(throttle * 0.85 + 0.1, speedRatio);
  }
  _exhaustHueAttr.needsUpdate = true;

  const lifeArr = _exhaustLifeAttr.array;
  let dirty = false;
  for (let i = 0; i < EXHAUST_POOL_SIZE; i++) {
    if (exhaustLife[i] <= 0) {
      if (lifeArr[i] !== 0) { lifeArr[i] = 0; dirty = true; }
      continue;
    }
    exhaustLife[i] -= dt;
    const o = i * 3;
    exhaustPositions[o    ] += exhaustVelocities[o    ] * dt;
    exhaustPositions[o + 1] += exhaustVelocities[o + 1] * dt;
    exhaustPositions[o + 2] += exhaustVelocities[o + 2] * dt;
    const drag = Math.exp(-2.0 * dt);
    exhaustVelocities[o    ] *= drag;
    exhaustVelocities[o + 1] *= drag;
    exhaustVelocities[o + 2] *= drag;
    lifeArr[i] = Math.max(0, exhaustLife[i] / exhaustMax[i]);
    dirty = true;
  }
  if (dirty) {
    exhaustGeo.attributes.position.needsUpdate = true;
    _exhaustLifeAttr.needsUpdate = true;
  }
}

function clearExhaust() {
  for (let i = 0; i < EXHAUST_POOL_SIZE; i++) {
    exhaustLife[i] = 0;
    _exhaustLifeAttr.array[i] = 0;
    exhaustPositions[i * 3 + 1] = -1e6;
  }
  exhaustGeo.attributes.position.needsUpdate = true;
  _exhaustLifeAttr.needsUpdate = true;
}

// ── GLO-tinted exhaust trail ─────────────────────────────────
// A second, slightly slower-fading exhaust pool that takes its colour
// from the user's "Pick Your GLO" selection. This sits *behind* the
// kart and pulses with throttle just like the combustion exhaust, but
// the entire stream tints to whatever effect the player picked
// (Sunrise, Aurora, Fire, etc.). Same single-Points + ring-buffer
// architecture as the combustion exhaust so cost stays trivial; the
// only per-frame extra is a uniform `uColor` copy from the live
// `underglow.currentColor`.
const GLO_EXH_POOL = 320;
const GLO_EXH_LIFE = 0.75;
const GLO_EXH_RATE = 140;                  // puffs/sec at full throttle
const GLO_EXH_BACK_OFFSET = M(1.0);
const GLO_EXH_HEIGHT = M(0.45);
const GLO_EXH_BASE_SIZE = 65;
const GLO_EXH_GROWTH_PX = 80;
const gloExhPositions  = new Float32Array(GLO_EXH_POOL * 3);
const gloExhVelocities = new Float32Array(GLO_EXH_POOL * 3);
const gloExhLife       = new Float32Array(GLO_EXH_POOL);
const gloExhMax        = new Float32Array(GLO_EXH_POOL);
let gloExhWriteIdx = 0;
let gloExhSpawnAccum = 0;
const gloExhGeo = new THREE.BufferGeometry();
gloExhGeo.setAttribute('position', new THREE.BufferAttribute(gloExhPositions, 3));
gloExhGeo.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(GLO_EXH_POOL), 1));
gloExhGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
const gloExhMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  // Additive so the GLO colour glows against the dark scene and reads as
  // an emissive plume rather than a flat sprite stack.
  blending: THREE.AdditiveBlending,
  uniforms: {
    uBaseSize: { value: GLO_EXH_BASE_SIZE },
    uGrowth:   { value: GLO_EXH_GROWTH_PX },
    uPxScale:  { value: window.innerHeight * 0.5 },
    uColor:    { value: new THREE.Color(0xff3aa1) },
  },
  vertexShader: /* glsl */`
    attribute float aLife;
    varying float vLife;
    uniform float uBaseSize;
    uniform float uGrowth;
    uniform float uPxScale;
    void main() {
      vLife = aLife;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      float age = 1.0 - aLife;
      float sz = (uBaseSize + uGrowth * age);
      gl_PointSize = max(2.0, sz * uPxScale / max(1.0, -mv.z));
    }
  `,
  fragmentShader: /* glsl */`
    varying float vLife;
    uniform vec3 uColor;
    void main() {
      vec2 c = gl_PointCoord - vec2(0.5);
      float d = length(c) * 2.0;
      if (d > 1.0) discard;
      // Soft round falloff; alpha drops with age so trail dissipates.
      float a = (1.0 - d * d) * vLife * vLife * 0.55;
      gl_FragColor = vec4(uColor, a);
    }
  `,
});
const gloExhPoints = new THREE.Points(gloExhGeo, gloExhMat);
gloExhPoints.renderOrder = 2;
gloExhPoints.frustumCulled = false;
scene.add(gloExhPoints);

for (let i = 0; i < GLO_EXH_POOL; i++) gloExhPositions[i * 3 + 1] = -1e6;

const _gloExhLifeAttr = gloExhGeo.attributes.aLife;
const _gloExhFwd = new THREE.Vector3();
const _gloExhRight = new THREE.Vector3();

function spawnGloExhPuff(speedRatio) {
  if (!chassisBody) return;
  const i = gloExhWriteIdx;
  gloExhWriteIdx = (gloExhWriteIdx + 1) % GLO_EXH_POOL;
  // Yaw-derived emit point so the plume always trails the kart's facing,
  // not the camera (matches the combustion exhaust).
  const q = chassisBody.quaternion;
  const sinyCosp = 2 * (q.w * q.y + q.x * q.z);
  const cosyCosp = 1 - 2 * (q.y * q.y + q.x * q.x);
  const yaw = Math.atan2(sinyCosp, cosyCosp);
  _gloExhFwd.set(Math.sin(yaw), 0, Math.cos(yaw));
  _gloExhRight.set(_gloExhFwd.z, 0, -_gloExhFwd.x);
  const cp = chassisBody.position;
  const jitter = (Math.random() - 0.5) * M(0.30);
  const o = i * 3;
  gloExhPositions[o    ] = cp.x - _gloExhFwd.x * GLO_EXH_BACK_OFFSET + _gloExhRight.x * jitter;
  gloExhPositions[o + 1] = cp.y - GLO_EXH_HEIGHT + (Math.random() - 0.5) * M(0.08);
  gloExhPositions[o + 2] = cp.z - _gloExhFwd.z * GLO_EXH_BACK_OFFSET + _gloExhRight.z * jitter;
  // Push backward harder when going fast \u2192 elongated trail at top speed.
  const back = M(1.2) + speedRatio * M(2.6);
  gloExhVelocities[o    ] = -_gloExhFwd.x * back + (Math.random() - 0.5) * M(0.5);
  gloExhVelocities[o + 1] = M(0.4) + Math.random() * M(0.3);
  gloExhVelocities[o + 2] = -_gloExhFwd.z * back + (Math.random() - 0.5) * M(0.5);
  gloExhLife[i] = GLO_EXH_LIFE;
  gloExhMax[i]  = GLO_EXH_LIFE;
}

function updateGloExhaust(dt) {
  if (!chassisBody) return;
  // Pull the live GLO colour from the underglow rig so the trail tracks
  // every effect change (Sunrise gradient cycling, Strobe pulses, etc.)
  // for free \u2014 no extra computation, just a colour copy.
  if (underglow && underglow.currentColor) {
    gloExhMat.uniforms.uColor.value.copy(underglow.currentColor);
  }
  const throttle = Math.max(0, controlsThrottleHint());
  const speed = chassisBody.velocity.length();
  const speedRatio = Math.min(1, speed / M(52));

  // Idle baseline is intentionally tiny so the engine reads as 'off' at
  // rest; spawn rate ramps quadratically with throttle so light pedal
  // emits a thin trail and full pedal produces a thick, dense plume —
  // matches the feel of an engine working harder under load.
  const throttleCurve = throttle * throttle;
  const ratePerSec = GLO_EXH_RATE * (0.05 + 0.95 * throttleCurve);
  gloExhSpawnAccum += dt * ratePerSec;
  while (gloExhSpawnAccum >= 1) {
    gloExhSpawnAccum -= 1;
    spawnGloExhPuff(speedRatio);
  }

  const lifeArr = _gloExhLifeAttr.array;
  let dirty = false;
  for (let i = 0; i < GLO_EXH_POOL; i++) {
    if (gloExhLife[i] <= 0) {
      if (lifeArr[i] !== 0) { lifeArr[i] = 0; dirty = true; }
      continue;
    }
    gloExhLife[i] -= dt;
    const o = i * 3;
    gloExhPositions[o    ] += gloExhVelocities[o    ] * dt;
    gloExhPositions[o + 1] += gloExhVelocities[o + 1] * dt;
    gloExhPositions[o + 2] += gloExhVelocities[o + 2] * dt;
    const drag = Math.exp(-1.6 * dt);
    gloExhVelocities[o    ] *= drag;
    gloExhVelocities[o + 1] *= drag;
    gloExhVelocities[o + 2] *= drag;
    lifeArr[i] = Math.max(0, gloExhLife[i] / gloExhMax[i]);
    dirty = true;
  }
  if (dirty) {
    gloExhGeo.attributes.position.needsUpdate = true;
    _gloExhLifeAttr.needsUpdate = true;
  }
}

function clearGloExhaust() {
  for (let i = 0; i < GLO_EXH_POOL; i++) {
    gloExhLife[i] = 0;
    _gloExhLifeAttr.array[i] = 0;
    gloExhPositions[i * 3 + 1] = -1e6;
  }
  gloExhGeo.attributes.position.needsUpdate = true;
  _gloExhLifeAttr.needsUpdate = true;
}

// ── Catastrophic engine-failure VFX ───────────────────────────
// A blown engine deserves more than a smoke ball. This block adds:
//   • A bright fireball flash anchored to the engine bay (above the
//     rear axle, behind the cockpit) that scales up and fades in ~0.55s.
//   • An expanding shockwave ring on the ground beneath the kart.
//   • A pool of 80 hot-orange spark/debris particles with gravity +
//     drag, ejected radially with a strong upward bias.
// All meshes are pre-allocated; per-frame cost is one Float32Array
// sweep over the 80-spark pool plus four uniform updates.

// Engine bay world position — anchored above the rear axle, behind the
// cockpit, so the fireball reads as the engine block popping rather
// than the entire kart vapourising.
const _enginePosScratch = { x: 0, y: 0, z: 0, fx: 0, fz: 0 };
function getEnginePos(out) {
  out = out || _enginePosScratch;
  if (!chassisBody) return out;
  const cp = chassisBody.position;
  const q = chassisBody.quaternion;
  const sinyCosp = 2 * (q.w * q.y + q.x * q.z);
  const cosyCosp = 1 - 2 * (q.y * q.y + q.x * q.x);
  const yaw = Math.atan2(sinyCosp, cosyCosp);
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  // CHASSIS_HZ is front-to-back half-extent (1.0 m). 55% rearward puts
  // the source roughly over the rear axle; 0.7×CHASSIS_HY lifts it just
  // above the chassis top so the fireball bursts upward and outward.
  out.x = cp.x - fx * (CHASSIS_HZ * 0.55);
  out.y = cp.y + CHASSIS_HY * 0.7;
  out.z = cp.z - fz * (CHASSIS_HZ * 0.55);
  out.fx = fx; out.fz = fz;
  return out;
}

// --- Fireball: single billboard plane, additive radial-gradient shader.
const fireballGeo = new THREE.PlaneGeometry(1, 1);
const fireballMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  depthTest: false,
  blending: THREE.AdditiveBlending,
  uniforms: { uT: { value: 0 } },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    varying vec2 vUv;
    uniform float uT; // 0..1 over the fireball lifetime
    // Smooth value noise. Quintic interpolant (6t^5 - 15t^4 + 10t^3)
    // for C2 continuity — no faceting at cell boundaries.
    float h21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
    float vn(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
      return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x),
                 mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
    }
    // 3-octave fbm in CARTESIAN UV space (avoids the angular-wedge
    // seam that polar sampling produces around the atan(-π,+π) cut).
    float fbm(vec2 p) {
      float a = 0.5, s = 0.0, w = 0.0;
      for (int o = 0; o < 3; o++) {
        s += a * vn(p);
        w += a;
        p *= 2.07;
        a *= 0.55;
      }
      return s / w;
    }
    void main() {
      vec2 c = vUv - 0.5;
      float r = length(c) * 2.0;
      if (r > 1.0) discard;
      // Domain-warped fbm: scroll the noise outward over time and warp
      // its sample point so the interior swirls instead of pulsing in
      // straight rings. All sampling is in Cartesian space.
      vec2 base = c * 4.5;
      vec2 warp = vec2(fbm(base + vec2(uT * 1.3, 0.0)),
                       fbm(base + vec2(0.0, uT * 1.3)));
      float n = fbm(base + warp * 1.2 - vec2(0.0, uT * 0.9));
      // Double-pulse: bright initial blast, brief dim, secondary flare.
      float pulse = exp(-uT * 6.0) + 0.5 * exp(-pow((uT - 0.35) * 6.0, 2.0));
      // Hot core → yellow → orange → deep red as it ages.
      vec3 core = mix(vec3(1.0, 0.95, 0.75), vec3(1.0, 0.55, 0.10), uT);
      vec3 edge = mix(vec3(1.0, 0.40, 0.05), vec3(0.35, 0.03, 0.00), uT);
      // Noise pushes hotter spots outward for a roiling look (very
      // soft smoothstep so the colour transition reads as gradient,
      // not a hard band).
      vec3 col  = mix(core, edge, smoothstep(-0.1, 1.0, r - n * 0.25));
      // Bright bloom centre falls off past the silhouette edge.
      float bloom = 1.0 - smoothstep(0.0, 1.0, r);
      float life  = 1.0 - uT;
      // Soft noise-eroded silhouette — wide smoothstep so flame edges
      // dissolve into a fuzzy boundary instead of a jagged outline.
      float silhouette = smoothstep(1.05, 0.05, r + (n - 0.5) * 0.55);
      float a = silhouette * bloom * life * (1.4 + pulse * 0.8);
      gl_FragColor = vec4(col * (1.0 + 1.8 * life + pulse * 1.2), a);
    }
  `,
});
const fireballMesh = new THREE.Mesh(fireballGeo, fireballMat);
fireballMesh.renderOrder = 5;
fireballMesh.frustumCulled = false;
fireballMesh.visible = false;
scene.add(fireballMesh);
let fireballT = 0;
const FIREBALL_LIFE_S = 0.7;
const FIREBALL_PEAK = M(3.2);

// --- Volumetric shockwave (camera-facing billboard, NOT a ground ring).
// Replaces the old ground-plane ring. Reads as an expanding pressure
// sphere of compressed hot air around the blast — a thin chromatic
// rim with a soft inner heat haze. Single billboard plane, additive,
// no texture sample.
const shockGeo = new THREE.PlaneGeometry(1, 1);
const shockMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  depthTest: false,
  blending: THREE.AdditiveBlending,
  uniforms: { uT: { value: 0 } },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    varying vec2 vUv;
    uniform float uT;
    float h21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
    float vn(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0); // quintic
      return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x),
                 mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
    }
    void main() {
      vec2 c = vUv - 0.5;
      float r = length(c) * 2.0;
      if (r > 1.0) discard;
      // Cartesian-space noise sampling for the rim wobble — avoids
      // the angular wedge seam that polar (atan-based) noise produces
      // at the -π/+π cut.
      float wobble = (vn(c * 6.0 + uT * 2.0) - 0.5) * 0.05;
      float ringR  = 0.30 + 0.65 * uT + wobble;
      // Wider rim so the wavefront reads as soft compressed air, not a
      // hard outline; falls off as a smooth gaussian.
      float thick  = 0.07 + 0.10 * uT;
      float rim    = exp(-pow((r - ringR) / thick, 2.0));
      float inner  = smoothstep(ringR, 0.0, r) * (1.0 - uT);
      float lead   = smoothstep(ringR - 0.03, ringR + 0.06, r);
      vec3 hot     = mix(vec3(1.0, 0.85, 0.55), vec3(1.0, 0.30, 0.05), uT);
      vec3 cool    = vec3(0.65, 0.85, 1.00) * 0.8;
      vec3 col     = hot * (rim + inner * 0.45) + cool * lead * rim * 0.45;
      float life   = 1.0 - uT;
      float a      = (rim * 0.95 + inner * 0.35) * life * life;
      gl_FragColor = vec4(col, a);
    }
  `,
});
const shockMesh = new THREE.Mesh(shockGeo, shockMat);
shockMesh.renderOrder = 4;
shockMesh.frustumCulled = false;
shockMesh.visible = false;
scene.add(shockMesh);
let shockT = 0;
const SHOCK_LIFE_S = 0.55;
const SHOCK_PEAK = M(9.0);

// --- Heat-haze afterglow ring: a second, slower billboard sitting
// behind the fireball. Sells the lingering super-heated air for a
// beat after the initial flash. One extra draw call, no extra cost
// in the shader (re-uses the same single-quad geometry).
const hazeGeo = new THREE.PlaneGeometry(1, 1);
const hazeMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  depthTest: false,
  blending: THREE.AdditiveBlending,
  uniforms: { uT: { value: 0 } },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    varying vec2 vUv;
    uniform float uT;
    void main() {
      vec2 c = vUv - 0.5;
      float r = length(c) * 2.0;
      if (r > 1.0) discard;
      // Soft warm halo, no ring — just a glowing patch of hot air.
      float falloff = exp(-r * r * 3.0);
      float life    = 1.0 - uT;
      vec3 col = mix(vec3(1.0, 0.55, 0.20), vec3(0.85, 0.18, 0.05), uT);
      gl_FragColor = vec4(col * (0.9 + 0.6 * life), falloff * life * 0.55);
    }
  `,
});
const hazeMesh = new THREE.Mesh(hazeGeo, hazeMat);
hazeMesh.renderOrder = 3;
hazeMesh.frustumCulled = false;
hazeMesh.visible = false;
scene.add(hazeMesh);
let hazeT = 0;
const HAZE_LIFE_S = 0.95;
const HAZE_PEAK = M(4.2);

// --- Hot debris/spark pool (THREE.Points)
const DEBRIS_POOL = 80;
const DEBRIS_LIFE_S = 1.1;
const debrisPositions  = new Float32Array(DEBRIS_POOL * 3);
const debrisVelocities = new Float32Array(DEBRIS_POOL * 3);
const debrisLife       = new Float32Array(DEBRIS_POOL);
const debrisLifeAttr   = new Float32Array(DEBRIS_POOL);
let debrisWriteIdx = 0;
for (let i = 0; i < DEBRIS_POOL; i++) debrisPositions[i * 3 + 1] = -1e6;
const debrisGeo = new THREE.BufferGeometry();
debrisGeo.setAttribute('position', new THREE.BufferAttribute(debrisPositions, 3));
debrisGeo.setAttribute('aLife',    new THREE.BufferAttribute(debrisLifeAttr, 1));
debrisGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
const debrisMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: { uPxScale: { value: window.innerHeight * 0.5 } },
  vertexShader: /* glsl */`
    attribute float aLife;
    varying float vLife;
    uniform float uPxScale;
    void main() {
      vLife = aLife;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      float size = 22.0 * (0.4 + 0.6 * vLife);
      gl_PointSize = size * (uPxScale / max(1.0, -mv.z));
    }
  `,
  fragmentShader: /* glsl */`
    varying float vLife;
    void main() {
      vec2 c = gl_PointCoord - 0.5;
      float r = length(c) * 2.0;
      if (r > 1.0) discard;
      vec3 hot  = vec3(1.0, 0.95, 0.7);
      vec3 mid  = vec3(1.0, 0.55, 0.10);
      vec3 cool = vec3(0.7, 0.10, 0.02);
      vec3 col  = mix(cool, mid, smoothstep(0.0, 0.55, vLife));
      col       = mix(col, hot, smoothstep(0.55, 1.0, vLife));
      float alpha = (1.0 - r) * vLife;
      gl_FragColor = vec4(col, alpha);
    }
  `,
});
const debrisPoints = new THREE.Points(debrisGeo, debrisMat);
debrisPoints.renderOrder = 5;
debrisPoints.frustumCulled = false;
scene.add(debrisPoints);

function spawnDebrisSpark(x, y, z, ejectSpeed) {
  const i = debrisWriteIdx;
  debrisWriteIdx = (debrisWriteIdx + 1) % DEBRIS_POOL;
  const o = i * 3;
  debrisPositions[o]     = x;
  debrisPositions[o + 1] = y;
  debrisPositions[o + 2] = z;
  const ang = Math.random() * Math.PI * 2;
  const horiz = Math.cos(ang) * ejectSpeed * (0.5 + Math.random() * 0.8);
  const horizZ = Math.sin(ang) * ejectSpeed * (0.5 + Math.random() * 0.8);
  const upward = M(2.0) + Math.random() * M(4.5);
  debrisVelocities[o]     = horiz;
  debrisVelocities[o + 1] = upward;
  debrisVelocities[o + 2] = horizZ;
  debrisLife[i] = 1.0;
  debrisLifeAttr[i] = 1.0;
}

// Spawn a smoke puff with an explicit outward radial velocity. Uses
// the existing smoke pool so cost is zero — we just patch the velocity
// slot after the regular spawn writes its randomised one.
function spawnRadialSmokePuff(x, y, z, dirX, dirZ, speed, intensity) {
  const slot = smokeWriteIdx;
  spawnSmokePuff(x, y, z, intensity);
  const o = slot * 3;
  smokeVelocities[o]     = dirX * speed + (Math.random() - 0.5) * M(0.4);
  smokeVelocities[o + 1] = M(1.0) + Math.random() * M(2.5);
  smokeVelocities[o + 2] = dirZ * speed + (Math.random() - 0.5) * M(0.4);
}

function updateEngineExplosionFx(dt) {
  // Fireball
  if (fireballMesh.visible) {
    fireballT += dt / FIREBALL_LIFE_S;
    if (fireballT >= 1) {
      fireballMesh.visible = false;
    } else {
      fireballMat.uniforms.uT.value = fireballT;
      const ep = getEnginePos();
      fireballMesh.position.set(ep.x, ep.y, ep.z);
      // Billboard toward camera so it always reads as a volumetric blast.
      fireballMesh.quaternion.copy(camera.quaternion);
      // Square-root ramp = explosive expansion that quickly slows.
      const s = FIREBALL_PEAK * (0.25 + 1.5 * Math.sqrt(fireballT));
      fireballMesh.scale.set(s, s, 1);
    }
  }
  // Shockwave (3D billboard blast)
  if (shockMesh.visible) {
    shockT += dt / SHOCK_LIFE_S;
    if (shockT >= 1) {
      shockMesh.visible = false;
    } else {
      shockMat.uniforms.uT.value = shockT;
      const ep = getEnginePos();
      shockMesh.position.set(ep.x, ep.y, ep.z);
      // Camera-billboarded so the wavefront reads as a 3D pressure
      // sphere instead of a flat ground ring.
      shockMesh.quaternion.copy(camera.quaternion);
      // Cube-root ramp: explosive initial expansion that quickly slows.
      const s = SHOCK_PEAK * (0.15 + 1.2 * Math.cbrt(shockT));
      shockMesh.scale.set(s, s, 1);
    }
  }
  // Heat-haze afterglow (slower, larger, behind everything)
  if (hazeMesh.visible) {
    hazeT += dt / HAZE_LIFE_S;
    if (hazeT >= 1) {
      hazeMesh.visible = false;
    } else {
      hazeMat.uniforms.uT.value = hazeT;
      const ep = getEnginePos();
      hazeMesh.position.set(ep.x, ep.y, ep.z);
      hazeMesh.quaternion.copy(camera.quaternion);
      const s = HAZE_PEAK * (0.4 + 1.0 * Math.sqrt(hazeT));
      hazeMesh.scale.set(s, s, 1);
    }
  }
  // Sparks
  let dirty = false;
  for (let i = 0; i < DEBRIS_POOL; i++) {
    if (debrisLife[i] <= 0) {
      if (debrisLifeAttr[i] !== 0) { debrisLifeAttr[i] = 0; dirty = true; }
      continue;
    }
    debrisLife[i] -= dt / DEBRIS_LIFE_S;
    if (debrisLife[i] < 0) debrisLife[i] = 0;
    debrisLifeAttr[i] = debrisLife[i];
    const o = i * 3;
    debrisPositions[o]     += debrisVelocities[o]     * dt;
    debrisPositions[o + 1] += debrisVelocities[o + 1] * dt;
    debrisPositions[o + 2] += debrisVelocities[o + 2] * dt;
    debrisVelocities[o + 1] -= M(9.8) * dt; // gravity
    const drag = Math.exp(-1.4 * dt);
    debrisVelocities[o]     *= drag;
    debrisVelocities[o + 2] *= drag;
    dirty = true;
  }
  if (dirty) {
    debrisGeo.attributes.position.needsUpdate = true;
    debrisGeo.attributes.aLife.needsUpdate = true;
  }
}

function clearEngineExplosionFx() {
  fireballMesh.visible = false;
  shockMesh.visible = false;
  hazeMesh.visible = false;
  fireballT = 0; shockT = 0; hazeT = 0;
  for (let i = 0; i < DEBRIS_POOL; i++) {
    debrisLife[i] = 0;
    debrisLifeAttr[i] = 0;
    debrisPositions[i * 3 + 1] = -1e6;
  }
  debrisGeo.attributes.position.needsUpdate = true;
  debrisGeo.attributes.aLife.needsUpdate = true;
}

// Exposes the worker's internal smoothed throttle (bridged via the
// last snapshot). Falls back to the raw key state so the visual
// reacts even before the first snapshot arrives.
function controlsThrottleHint() {
  const cs = physicsBridge?.controlState;
  if (cs && Number.isFinite(cs.throttle)) return cs.throttle;
  return keys.w ? 1 : 0;
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
  // R = 10-second rewind (jump back to the chassis pose+velocity from
  // ~10s ago — cheap ring buffer in the physics worker); T = hard reset
  // to spawn (loses progress, used to escape a stuck state). If no
  // rewind history exists yet, falls back to last-safe → spawn.
  if (e.code === 'KeyR') rewindTenSeconds();
  if (e.code === 'KeyT') respawn();
  if (e.code === 'KeyC') cycleCameraMode();
  if (e.code === 'KeyH') kartAudio.playOneShot('horn', { gain: 0.9 });
  if (e.code === 'Escape') togglePause();
});
window.addEventListener('keyup', (e) => {
  if (KEYMAP[e.code]) { keys[KEYMAP[e.code]] = false; e.preventDefault(); }
});

// Recovery / respawn — both run on the worker (it owns the physics
// state). The 'recover' message now triggers a 10-second rewind to the
// oldest entry in the worker-side ring buffer (replaces the old
// last-safe-pose recovery). Main just sends the command; the next
// snapshot will reflect the moved chassis.
function rewindTenSeconds() { physicsBridge.recover(); clearSkidTrails(); clearGloSkid(); clearSmoke(); clearExhaust(); clearGloExhaust(); clearEngineExplosionFx(); burnoutCharge = 0; gloBurnoutT = 0; engineExplodedUntil = 0; engineExplosionFiredAt = 0; if (engineRestartTimer) { clearTimeout(engineRestartTimer); engineRestartTimer = 0; } _burnoutShakeAmp = 0; _burnoutShakeAmpSm = 0; _burnoutFlash = 0; _burnoutFovKick = 0; _burnoutFovKickSm = 0; _burnoutGloBoost = 1; }
function respawn() { physicsBridge.respawn(); clearSkidTrails(); clearGloSkid(); clearSmoke(); clearExhaust(); clearGloExhaust(); clearEngineExplosionFx(); burnoutCharge = 0; gloBurnoutT = 0; engineExplodedUntil = 0; engineExplosionFiredAt = 0; if (engineRestartTimer) { clearTimeout(engineRestartTimer); engineRestartTimer = 0; } _burnoutShakeAmp = 0; _burnoutShakeAmpSm = 0; _burnoutFlash = 0; _burnoutFovKick = 0; _burnoutFovKickSm = 0; _burnoutGloBoost = 1; }

// One-shot engine pop when the player holds space+W past
// BURNOUT_OVERHEAT_S. The engine block ruptures behind the cockpit:
// fireball + shockwave + flying debris + an outward-radial smoke
// burst. Then arms the input lockout so the kart coasts powerless for
// a beat (handled by shipKeysIfChanged below).
function triggerEngineExplosion() {
  const now = performance.now();
  engineExplodedUntil = now + ENGINE_LOCKOUT_S * 1000;
  engineExplosionFiredAt = now;
  // Engine overload SFX — layer two clips from /audio/sfx/ instead of
  // the K_Std EngineExplosion synth-y rupture clip (which the player
  // found glitchy). `overloadBlast` (explosion.ogg) carries the low
  // boom; `overloadCrash` (crash.ogg) layered slightly quieter and
  // pitched down adds a metallic shrapnel tail. Both fire once per
  // overload via the per-name 1.5 s cooldown in kart-audio.
  kartAudio.playOneShot('overloadBlast', { gain: 0.95 });
  kartAudio.playOneShot('overloadCrash', { gain: 0.55, rate: 0.85 });
  if (!chassisBody) return;
  const ep = getEnginePos();

  // Fireball + shockwave + haze (one-shot animations driven by uT).
  fireballT = 0; shockT = 0; hazeT = 0;
  fireballMesh.visible = true;
  shockMesh.visible = true;
  hazeMesh.visible = true;

  // Outward radial dirty-smoke burst at the engine bay. Velocities are
  // patched after spawn so the cloud expands like an actual blast
  // instead of drifting straight up.
  for (let p = 0; p < 24; p++) {
    const ang = Math.random() * Math.PI * 2;
    const r0  = M(0.05) + Math.random() * M(0.25);
    const dx  = Math.cos(ang), dz = Math.sin(ang);
    const x = ep.x + dx * r0;
    const z = ep.z + dz * r0;
    const y = ep.y + (Math.random() - 0.3) * M(0.25);
    const speed = M(2.5) + Math.random() * M(2.5);
    spawnRadialSmokePuff(x, y, z, dx, dz, speed, 1.0);
  }
  // A few directly-upward column puffs sell the "engine block venting"
  // beat after the initial spherical burst.
  for (let p = 0; p < 8; p++) {
    const slot = smokeWriteIdx;
    spawnSmokePuff(ep.x + (Math.random() - 0.5) * M(0.4), ep.y + M(0.1), ep.z + (Math.random() - 0.5) * M(0.4), 1.0);
    const o = slot * 3;
    smokeVelocities[o]     = (Math.random() - 0.5) * M(0.6);
    smokeVelocities[o + 1] = M(3.5) + Math.random() * M(2.5);
    smokeVelocities[o + 2] = (Math.random() - 0.5) * M(0.6);
  }

  // Hot debris: 64 sparks ejected radially with strong upward bias.
  // Two ejection-speed bands so the cloud has near + far reaches.
  for (let p = 0; p < 48; p++) spawnDebrisSpark(ep.x, ep.y, ep.z, M(4.5));
  for (let p = 0; p < 16; p++) spawnDebrisSpark(ep.x, ep.y, ep.z, M(8.0));

  // GLO-tinted afterglow sparks blowing out the back (bonus colour
  // accent so the player's GLO theme still gets a moment in the chaos).
  if (typeof spawnGloExhPuff === 'function') {
    for (let p = 0; p < 24; p++) spawnGloExhPuff(1.0);
  }
  // Final fat GLO scorch under each rear wheel.
  for (let i = 0; i < 2; i++) {
    const wi = vehicle.wheelInfos[i];
    if (!wi || !wi.isInContact) continue;
    const wp = wi.worldTransform.position;
    emitGloSkidQuad(i, wp.x, wp.y - WHEEL_RADIUS, wp.z);
  }
  // Brief GLO trail kick so the moment of the pop reads as a release
  // (consistent visual language with the normal burnout boost).
  gloBurnoutT = Math.max(gloBurnoutT, 0.45);
  // Big one-shot flash + heavy shake spike for the explosion.
  _burnoutFlash = 1.0;
  _burnoutShakeAmp = 1.4;
}

// ── Combat-multiplier ship-down ──────────────────────────────
// Worker resolves engine force from `boostMult * slowMult` and the
// `oilNow` flag. Main is the source of truth for the timestamps
// (combat events fire here), so we resolve the multipliers per frame
// and post them along with the keys.
function resolveCombatScalars(now) {
  let boostMult = 1, slowMult = 1;
  if (now < playerCombat.boostUntil) boostMult = 1 + (playerCombat.boostStrength || 0);
  if (now < playerCombat.slowUntil) slowMult = 1 - (playerCombat.slowStrength || 0);
  const oilNow = now < playerCombat.oilUntil;
  return { boostMult, slowMult, oilNow };
}

// Per-frame change-detection so we don't postMessage 60×/s of
// identical key state. Worker only needs deltas.
const _prevKeysSent = { w: false, a: false, s: false, d: false, space: false, drift: false };
function shipKeysIfChanged() {
  // Engine explosion lockout: while the recovery timer is active we
  // force every drive input to false before the worker sees it. Visual
  // smoke continues to billow (handled in updateSkidTrails). The kart
  // keeps its momentum but loses throttle/steer until the timer
  // expires, selling the "blown engine" beat.
  const locked = performance.now() < engineExplodedUntil;
  let changed = false;
  for (const k of ['w', 'a', 's', 'd', 'space', 'drift']) {
    const v = locked ? false : keys[k];
    if (_prevKeysSent[k] !== v) { changed = true; _prevKeysSent[k] = v; }
  }
  if (changed) physicsBridge.sendKeys({ ..._prevKeysSent });
}
const _prevCombatSent = { boostMult: 1, slowMult: 1, oilNow: false };
function shipCombatIfChanged(now) {
  const c = resolveCombatScalars(now);
  if (c.boostMult !== _prevCombatSent.boostMult
      || c.slowMult !== _prevCombatSent.slowMult
      || c.oilNow !== _prevCombatSent.oilNow) {
    Object.assign(_prevCombatSent, c);
    physicsBridge.sendCombat(c);
  }
}

// Visual-only suspension rest length (was wheelOptions.suspensionRestLength).
const SUSP_REST = SUSPENSION_REST_LENGTH;

// ── Camera follow (Mario-Kart-style) ──────────────────────────
// Key principles:
//   1. Camera tracks a SMOOTHED yaw, not the raw chassis quaternion. The
//      chassis can wobble within the suspension; the camera shouldn't.
//   2. Pitch + roll are NEVER copied from the chassis — camera always
//      stays roughly horizontal regardless of slopes/jumps.
//   3. Look-ahead extends with forward speed so fast cornering feels
//      readable instead of "behind the action".
//   4. Position lerp uses a critically-damped spring, frame-rate
//      independent (1 - exp(-k·dt)), not a fixed alpha.
//   5. FOV stretches mildly with speed for the arcade speed sensation.
//
// Multiple camera modes share the same smoothing/look-ahead pipeline;
// each mode just supplies its own offset preset. Cycle with the C key.
// Selected mode is persisted to localStorage so it survives reloads.
const CAM_FOV_BASE = 70;
const CAM_FOV_BOOST = 14;               // +14° at top speed
const CAM_FOV_BOOST_BONUS = 6;          // extra +6° while a boost pad is active

/**
 * Camera mode presets. All distances/heights are in metres (converted via
 * M() since play-main runs in world units). `lookAheadBase` and
 * `lookAheadPerMs` shape how far in front of the kart the camera "looks"
 * at idle / per m/s of speed. `posSpring` / `yawSpring` / `lookSpring`
 * are critical-damping rates (higher = snappier).
 */
const CAMERA_MODES = [
  {
    id: 'chase',
    label: 'Chase',
    dist: M(11), height: M(5.0), lookHeight: M(1.4),
    lookAheadBase: M(4), lookAheadPerMs: 0.18,
    posSpring: 6.5, yawSpring: 5.5, lookSpring: 9.0,
    fovBase: 70, fovBoost: 14,
  },
  {
    // Close chase — sits tighter and lower behind the kart than the
    // default Chase mode, with a slightly slower yaw spring so the
    // kart's tail visibly swings into view through corners. Snappier
    // position spring keeps the kart from ever drifting out of frame
    // at the shorter distance.
    id: 'close',
    label: 'Close Chase',
    dist: M(4.2), height: M(1.7), lookHeight: M(0.9),
    lookAheadBase: M(2.5), lookAheadPerMs: 0.14,
    posSpring: 11.0, yawSpring: 5.0, lookSpring: 11.0,
    fovBase: 78, fovBoost: 14,
  },
  {
    id: 'far',
    label: 'Far Chase',
    dist: M(18), height: M(8.5), lookHeight: M(1.8),
    lookAheadBase: M(5), lookAheadPerMs: 0.20,
    posSpring: 5.0, yawSpring: 4.5, lookSpring: 8.0,
    fovBase: 66, fovBoost: 10,
  },
  {
    id: 'near',
    label: 'Cinematic',
    dist: M(7), height: M(3.2), lookHeight: M(1.2),
    lookAheadBase: M(3), lookAheadPerMs: 0.22,
    posSpring: 8.0, yawSpring: 7.0, lookSpring: 10.0,
    fovBase: 76, fovBoost: 16,
  },
  {
    id: 'driver',
    label: 'Driver POV',
    // Driver POV pulled back so the camera sits fully BEHIND the
    // driver's seat, looking forward over their shoulders. Physics
    // chassis spans local Z = ±1.0 m; driver sits roughly at chassis
    // centre, so a positive `dist` of 0.85 m places the camera near
    // the rear edge of the chassis (behind the driver model). Height
    // is raised to 0.85 m above chassis centre (~1.55 m above the
    // ground) so the eyeline clears the driver's head and the kart's
    // bodywork at any pitch.
    // Look target stays slightly below the camera so the road ahead
    // dominates the frame rather than the sky.
    dist: M(0.85), height: M(0.85), lookHeight: M(-0.10),
    lookAheadBase: M(6.0), lookAheadPerMs: 0.22,
    posSpring: 14.0, yawSpring: 12.0, lookSpring: 14.0,
    fovBase: 80, fovBoost: 16,
    // Mount the camera offset to the full chassis quaternion (pitch +
    // roll + yaw) instead of yaw-only. With yaw-only mounting the
    // chassis pitch under hard accel / brake makes the visual kart
    // model dip and rise in frame ("bobbing in place") while the
    // camera stays level. Following pitch keeps the kart geometry
    // rigid relative to the camera — the horizon tilts instead, which
    // is the canonical cockpit feel.
    followChassisPitch: true,
  },
  {
    id: 'topdown',
    label: 'Top-Down',
    // Mostly height; small back-offset keeps the kart in the lower-centre
    // of the screen so upcoming track is visible.
    dist: M(4), height: M(22), lookHeight: M(0),
    lookAheadBase: M(6), lookAheadPerMs: 0.10,
    posSpring: 5.0, yawSpring: 4.0, lookSpring: 6.0,
    fovBase: 60, fovBoost: 6,
  },
];

const CAMERA_MODE_STORAGE_KEY = 'gloKartsStudio.play.cameraMode';
// Default camera mode for first-load and any unrecognised saved value.
// "Close Chase" is the canonical play view going forward — sits
// tighter and lower than the default Chase preset so the kart fills
// more of the frame and corner G-forces read more strongly.
const DEFAULT_CAMERA_MODE_ID = 'close';
let cameraModeIndex = (() => {
  try {
    const saved = localStorage.getItem(CAMERA_MODE_STORAGE_KEY);
    const idx = CAMERA_MODES.findIndex(m => m.id === saved);
    if (idx >= 0) return idx;
  } catch {}
  const def = CAMERA_MODES.findIndex(m => m.id === DEFAULT_CAMERA_MODE_ID);
  return def >= 0 ? def : 0;
})();
let cameraMode = CAMERA_MODES[cameraModeIndex];

camera.fov = cameraMode.fovBase;

const camSmoothed = {
  yaw: 0,                               // smoothed chassis yaw (radians)
  initialised: false,
};
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
// Low-passed follow origin. The raw chassis interpolatedPosition
// oscillates along the kart's longitudinal/vertical axes as the
// suspension squats under accel and dives under brake. The camera
// uses this smoothed origin (instead of the raw position) as the
// anchor for offset + look-target math so those high-frequency
// suspension sways don't leak into the camera and read as bobbing.
// The origin is *not* used for the camera's actual position lerp
// (which still uses posSpring); it just removes the input wobble.
const camFollowOrigin = new THREE.Vector3();

const _camTmp = new THREE.Vector3();
const _camOrigin = new THREE.Vector3();
const _camForward = new THREE.Vector3();

const cameraModeEl = document.getElementById('cameraMode');
function refreshCameraModeHUD() {
  if (cameraModeEl) cameraModeEl.textContent = cameraMode.label;
}
function cycleCameraMode() {
  cameraModeIndex = (cameraModeIndex + 1) % CAMERA_MODES.length;
  cameraMode = CAMERA_MODES[cameraModeIndex];
  // Reset smoothing so the camera snaps to the new offset rather than
  // sliding through walls during the transition.
  camSmoothed.initialised = false;
  refreshCameraModeHUD();
  try { localStorage.setItem(CAMERA_MODE_STORAGE_KEY, cameraMode.id); } catch {}
}
refreshCameraModeHUD();

function shortestAngleDelta(a, b) {
  // Returns shortest signed angle from a → b in [-π, π].
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function updateCamera(dt) {
  // Use the interpolated pose so the camera "sees" the same sub-frame
  // position the kart is rendered at — mismatched samples here are a
  // significant jitter source even at high FPS.
  const chassisPos = chassisBody.interpolatedPosition;
  const q = chassisBody.interpolatedQuaternion;
  // Extract chassis yaw from quaternion (rotation around world-Y).
  const sinyCosp = 2 * (q.w * q.y + q.x * q.z);
  const cosyCosp = 1 - 2 * (q.y * q.y + q.x * q.x);
  const chassisYaw = Math.atan2(sinyCosp, cosyCosp);

  // Lazy-init: snap on first frame so we don't fly in from origin.
  if (!camSmoothed.initialised) {
    camSmoothed.yaw = chassisYaw;
    camSmoothed.initialised = true;
    camFollowOrigin.set(chassisPos.x, chassisPos.y, chassisPos.z);
    // Also snap pos/look so the mode swap is instantaneous instead of
    // springing through geometry.
    _camOrigin.set(chassisPos.x, chassisPos.y, chassisPos.z);
    _camForward.set(Math.sin(chassisYaw), 0, Math.cos(chassisYaw));
    _camTmp.copy(_camForward).multiplyScalar(-cameraMode.dist);
    _camTmp.y += cameraMode.height;
    camPos.copy(_camOrigin).add(_camTmp);
    camLook.copy(_camOrigin)
      .add(_camForward.clone().multiplyScalar(cameraMode.lookAheadBase));
    camLook.y += cameraMode.lookHeight;
  }

  // Low-pass the follow origin so suspension squat/dive doesn't leak
  // into the camera. Critically-damped spring, frame-rate independent.
  // Tuned to ~12 rad/s (≈ 80 ms time-constant): fast enough to track
  // genuine motion, slow enough to wash out the ±5–10 cm chassis
  // bounce from the wheel raycasts. Driver POV uses a tighter spring
  // since the cockpit needs to feel locked to the kart.
  const originSpring = cameraMode.followChassisPitch ? 22.0 : 12.0;
  const originAlpha = 1 - Math.exp(-originSpring * dt);
  camFollowOrigin.x += (chassisPos.x - camFollowOrigin.x) * originAlpha;
  camFollowOrigin.y += (chassisPos.y - camFollowOrigin.y) * originAlpha;
  camFollowOrigin.z += (chassisPos.z - camFollowOrigin.z) * originAlpha;

  // Velocity-aware yaw smoothing: when nearly stopped, freeze the camera
  // yaw so spinning the wheels in place doesn't whip the camera around.
  const speedAbs = chassisBody.velocity.length();
  const yawAuthority = Math.min(1, speedAbs / M(2));
  const yawDelta = shortestAngleDelta(camSmoothed.yaw, chassisYaw);
  const yawAlpha = 1 - Math.exp(-cameraMode.yawSpring * yawAuthority * dt);
  camSmoothed.yaw += yawDelta * yawAlpha;

  // Build desired camera position from smoothed yaw only (no roll/pitch).
  // Forward vector (yaw only) = (sin(yaw), 0, cos(yaw)). Behind = -forward.
  // For hood-cam, dist is negative so we sit IN FRONT of the kart.
  //
  // Driver POV (followChassisPitch) uses the FULL chassis quaternion
  // for the offset + look-ahead so the camera tilts with the kart on
  // accel-squat / brake-dive. With yaw-only mounting the kart model
  // visibly bobs in frame because its mesh inherits chassis pitch
  // while the camera stays world-level. Following pitch keeps the
  // model rigid relative to the camera (the horizon tilts instead).
  _camOrigin.copy(camFollowOrigin);
  if (cameraMode.followChassisPitch) {
    // Offset (right, up, back) in chassis-local space:
    //   local.x = 0           (centred between front wheels laterally)
    //   local.y = height
    //   local.z = -dist       (negative dist puts us ahead of chassis;
    //                          local +Z is the kart's BACK in the
    //                          standard CANNON forward = -Z convention,
    //                          so flip sign to keep current `dist`
    //                          semantics)
    _camTmp.set(0, cameraMode.height, -cameraMode.dist);
    _camTmp.applyQuaternion(q);
  } else {
    _camForward.set(Math.sin(camSmoothed.yaw), 0, Math.cos(camSmoothed.yaw));
    _camTmp.copy(_camForward).multiplyScalar(-cameraMode.dist);
    _camTmp.y += cameraMode.height;
  }
  const desired = _camOrigin.clone().add(_camTmp);

  const posAlpha = 1 - Math.exp(-cameraMode.posSpring * dt);
  camPos.lerp(desired, posAlpha);
  camera.position.copy(camPos);

  // Look target: in front of the kart, height-locked, with speed-based
  // look-ahead so fast cornering shows the upcoming track.
  const lookAhead = cameraMode.lookAheadBase + cameraMode.lookAheadPerMs * speedAbs;
  let desiredLook;
  if (cameraMode.followChassisPitch) {
    // Look-ahead anchored in chassis-local space too so pitch carries
    // the look target with the kart (otherwise pitch would tilt the
    // camera but the target would stay world-horizontal, fighting it).
    // Local forward in this codebase is +Z (matches the yaw-only
    // branch above, which uses _camForward = (sin yaw, 0, cos yaw)
    // and a positive multiplier on `lookAhead`). The camera-position
    // branch uses `-dist` to keep the existing dist-sign convention
    // ("negative dist sits ahead"); the look target uses a plain
    // `+lookAhead` because lookAhead is always positive.
    _camTmp.set(0, cameraMode.lookHeight, lookAhead);
    _camTmp.applyQuaternion(q);
    desiredLook = _camOrigin.clone().add(_camTmp);
  } else {
    desiredLook = _camOrigin.clone()
      .add(_camForward.clone().multiplyScalar(lookAhead));
    desiredLook.y += cameraMode.lookHeight;
  }
  const lookAlpha = 1 - Math.exp(-cameraMode.lookSpring * dt);
  camLook.lerp(desiredLook, lookAlpha);
  camera.lookAt(camLook);

  // FOV stretch with speed + extra kick during a boost pickup.
  // TOP_SPEED reference matches the worker tunable so the curve maps
  // 1:1 to actual speed.
  const TOP_SPEED_MS_LOCAL = M(52);
  const speedRatio = Math.min(1, speedAbs / TOP_SPEED_MS_LOCAL);
  let targetFov = cameraMode.fovBase + cameraMode.fovBoost * speedRatio;
  if (performance.now() < playerCombat.boostUntil) targetFov += CAM_FOV_BOOST_BONUS;
  // Burnout FOV kick (anticipation pull-in during charge, snap-out on
  // release / explosion). Eased separately so the punch reads sharper
  // than the underlying speed-based FOV drift.
  _burnoutFovKickSm += (_burnoutFovKick - _burnoutFovKickSm) * (1 - Math.exp(-12 * dt));
  targetFov += _burnoutFovKickSm;
  camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-4.0 * dt));
  camera.updateProjectionMatrix();

  // ── Burnout camera shake ──────────────────────────────────
  // Rumble grows quadratically with stage so the player physically
  // feels the engine straining. Three offset sines avoid a periodic
  // "wobble" pattern and stay perfectly cheap (6 trig ops/frame).
  _burnoutShakeAmpSm += (_burnoutShakeAmp - _burnoutShakeAmpSm) * (1 - Math.exp(-14 * dt));
  // Decay any direct write to _burnoutShakeAmp so explosion spikes ease
  // back to the steady-state target naturally.
  _burnoutShakeAmp = Math.max(0, _burnoutShakeAmp - dt * 1.6);
  if (_burnoutShakeAmpSm > 0.005) {
    const t = performance.now() * 0.001;
    const amp = _burnoutShakeAmpSm * M(0.07); // peaks at ~7 cm at full charge
    const sx = Math.sin(t * 47.3) * Math.cos(t * 31.7);
    const sy = Math.sin(t * 53.9) * Math.cos(t * 29.1);
    const sz = Math.sin(t * 41.1) * Math.cos(t * 37.5);
    camera.position.x += sx * amp;
    camera.position.y += sy * amp * 0.5;
    camera.position.z += sz * amp;
    // Slight roll twist so the horizon kicks too — sells the rumble as
    // a felt event instead of a translation jitter. Apply via rotateZ()
    // (post-multiplies the lookAt() quaternion) instead of writing
    // camera.rotation.z directly, which would overwrite the orientation
    // built by lookAt and flip the view.
    camera.rotateZ(sx * _burnoutShakeAmpSm * 0.04);
  }
}

// ── Render loop ───────────────────────────────────────────────
let lastTime = performance.now();
const speedEl = document.getElementById('speed');
const lapEl = document.getElementById('lap');
// Cached so we skip the textContent assignment (forces synchronous
// style/layout invalidation) when the displayed value hasn't changed.
let lastDisplayedSpeed = -1;

// Render-on-pause throttle. While paused we still need to paint so the
// pause overlay/menu blends correctly, but at full 60 fps the GPU is
// completely idle work — drop to ~12 fps.
const PAUSED_FRAME_MS = 80;
let lastPausedRenderAt = 0;

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
  const tickStart = performance.now();
  const now = tickStart;
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  let tPhys = 0, tVisual = 0, tCam = 0, tHud = 0, tCombat = 0, tRender = 0;
  let _t0;

  if (!paused) {
    _t0 = performance.now();
    // Physics is now off-thread. Each frame we just (a) ship any input
    // deltas to the worker and (b) trust that the proxy mirrors the
    // newest snapshot the worker has posted. The worker steps cannon
    // at a steady 60 Hz on its own setInterval and posts back a small
    // pose payload after each step. Render-thread tPhys is therefore
    // measuring postMessage cost only — typically <0.05 ms.
    shipKeysIfChanged();
    shipCombatIfChanged(now);
    tPhys = performance.now() - _t0;
  }

  _t0 = performance.now();

  // Resample the worker's pose stream at the current render time.
  // The bridge keeps two snapshots (prev/curr) and lerps the chassis
  // + wheel transforms into chassisBody.interpolated{Position,
  // Quaternion} based on (now - prevSnapAt) / (currSnapAt - prevSnapAt).
  // This decouples render rate from the 60 Hz physics tick — at 144+
  // Hz the visual no longer holds a stale pose for 2-3 frames between
  // snapshots, eliminating the worker-induced judder.
  physicsBridge.interpolate(now);

  // Sync chassis visual using the interpolated pose. Cannon's
  // interpolated{Position,Quaternion} blend between the previous and
  // current substep based on the leftover accumulator time, so render
  // frames between physics substeps still see smoothly advancing
  // motion at any monitor refresh rate.
  kartGroup.position.copy(chassisBody.interpolatedPosition);
  kartGroup.quaternion.copy(chassisBody.interpolatedQuaternion);

  // Sync wheel visuals
  for (let i = 0; i < vehicle.wheelInfos.length; i++) {
    vehicle.updateWheelTransform(i);
    const t = vehicle.wheelInfos[i].worldTransform;
    wheelMeshes[i].position.copy(t.position);
    wheelMeshes[i].quaternion.copy(t.quaternion);
  }

  // ── Animate the GLB kart's named wheel pivots ───────────────────
  // The cannon-es vehicle owns four debug wheel cylinders that we
  // already pose above, but those are hidden whenever the kart GLB
  // ships with its own wheels (almost every model). Without this
  // block the in-mesh wheels would sit perfectly still while the
  // kart slides forward — reading as a "broken" kart.
  //
  // Strategy: the rolling rate (rad/s) is forward-velocity / radius,
  // integrated each frame into a shared accumulator. Steering is the
  // smoothed `controlState.steer` (∈[-1,1]) scaled by the visual
  // steer-lock approximation (matches the worker's STEER_LOCK_LOW
  // band most of the time). We restore each wheel's authored base
  // quaternion before applying steer + roll so the rotations
  // accumulate from a clean reference frame instead of drifting.
  if (kartWheels) {
    // Forward speed in world units (mm). Use the chassis velocity
    // projected onto its forward axis so reverse spins the wheels
    // backwards and pure-sideways slip doesn't cause phantom roll.
    const q = chassisBody.quaternion;
    const sinyCosp = 2 * (q.w * q.y + q.x * q.z);
    const cosyCosp = 1 - 2 * (q.y * q.y + q.x * q.x);
    const _wYaw = Math.atan2(sinyCosp, cosyCosp);
    const _wFx = Math.sin(_wYaw), _wFz = Math.cos(_wYaw);
    const _wVx = chassisBody.velocity.x, _wVz = chassisBody.velocity.z;
    const fwdWorld = _wVx * _wFx + _wVz * _wFz; // mm/s along forward
    // omega in rad/s — same units numerator & denominator (mm/s, mm).
    const omega = fwdWorld / WHEEL_RADIUS;
    _wheelRollAngle += omega * dt;
    // Steering angle for the front pair. controlState.steer is ∈[-1,1]
    // post-smoothing in the worker; the worker scales it by a speed-
    // dependent steer lock (0.20..0.58 rad). Use 0.45 rad here as a
    // visual approximation — matches mid-speed turn-in well enough
    // that the wheel angle reads as truthful without piping the live
    // lock value across the worker boundary.
    const steerAngle = (physicsBridge?.controlState?.steer || 0) * 0.45;
    const apply = (w, isFront, sideSign) => {
      // Restore base quaternion → apply steer (Y) → apply roll (X).
      // YXZ Euler order ensures roll is performed about the post-
      // steered axle, not the chassis-aligned X axis.
      w.quaternion.copy(w.userData.baseQuat);
      if (isFront) w.rotateY(steerAngle);
      // Some authoring pipelines mirror left-side wheels so their
      // local X points the opposite way; sideSign lets us flip the
      // roll direction for one side if the visual wheels appear to
      // counter-rotate. The +X (right) side rolls the natural way.
      w.rotateX(_wheelRollAngle * sideSign);
    };
    apply(kartWheels.fl, true,  +1);
    apply(kartWheels.fr, true,  +1);
    apply(kartWheels.rl, false, +1);
    apply(kartWheels.rr, false, +1);
  }

  // Drop the visible kart model so its wheel-contact line (template
  // origin y=0) sits exactly on the road. The chassis Box centre is
  // CHASSIS_HY above the wheel-mount plane; the actual rest height
  // depends on per-frame suspension compression. We derive the local-Y
  // offset from the average current suspension length so the kart
  // doesn't visually hover when the suspension settles or compresses
  // over bumps.
  if (kartModel) {
    let susSum = 0; let susN = 0;
    for (let i = 0; i < vehicle.wheelInfos.length; i++) {
      const wi = vehicle.wheelInfos[i];
      // suspensionLength is the current extended length along directionLocal.
      if (Number.isFinite(wi.suspensionLength)) { susSum += wi.suspensionLength; susN++; }
    }
    const avgSusp = susN ? (susSum / susN) : SUSP_REST;
    // Wheel-contact in chassis-local Y = WHEEL_Y - avgSusp - WHEEL_RADIUS.
    // Smooth the offset so suspension hash from per-substep raycast
    // results doesn't translate into visible Y micro-bounce on the
    // kart model. Frame-rate-independent exponential smoothing.
    const susTargetY = WHEEL_Y - avgSusp - WHEEL_RADIUS;
    const susAlpha = 1 - Math.exp(-18 * dt);
    kartModel.position.y += (susTargetY - kartModel.position.y) * susAlpha;
    // ── Burnout chassis rumble ──────────────────────────────
    // Tiny high-frequency offset on the model itself (not the kart
    // group, so the physics body and wheel contacts stay correct).
    // Sells the engine straining + the post-pop death-rattle.
    if (_burnoutShakeAmpSm > 0.005) {
      const tt = performance.now() * 0.001;
      const a = _burnoutShakeAmpSm * M(0.025);
      kartModel.position.x += Math.sin(tt * 73.1) * a;
      kartModel.position.y += Math.sin(tt * 91.7) * a * 0.7;
      kartModel.position.z += Math.cos(tt * 67.3) * a;
      // Roll twist via rotateZ so we post-multiply onto the model's
      // existing orientation instead of overwriting it.
      kartModel.rotateZ(Math.sin(tt * 83.5) * _burnoutShakeAmpSm * 0.025 * dt * 4);
    }
  }

  // Skid trails — appends to a single shared mesh; cheap when not skidding.
  if (!paused) updateSkidTrails();
  if (!paused) updateGloSkidLife(dt);
  if (!paused) updateSmoke(dt);
  if (!paused) updateExhaust(dt);
  if (!paused) updateGloExhaust(dt);
  // Engine-explosion VFX (fireball / shockwave / sparks). Cheap and
  // self-gates on visibility — this call is essentially free when no
  // pop is active.
  if (!paused) updateEngineExplosionFx(dt);
  // Underglow follows the kart even while paused so the effect keeps animating
  // for the menu/screenshot — purely visual so it's safe to advance time here.
  underglow.setIntensityBoost(_burnoutGloBoost);
  underglow.update(dt, kartGroup);
  // Pipe the live GLO colour into the smoke material so any tinted
  // puffs (burnout cloud) automatically pick up the player's selected
  // palette / hot-swap when the lobby fires gloChanged.
  if (underglow.currentColor) smokeMat.uniforms.uGloColor.value.copy(underglow.currentColor);

  // ── Burnout exposure flash ────────────────────────────────
  // One-shot screen punch on release/explosion. Uses the renderer's
  // toneMappingExposure so it costs literally nothing — no extra draw,
  // no post pass, just a uniform tweak. Decays exponentially so the
  // baseline restores naturally (no need to remember the original
  // value beyond restoring 1.0 at rest).
  if (_burnoutFlash > 0.001) {
    _burnoutFlash = Math.max(0, _burnoutFlash - dt * 3.5);
    renderer.toneMappingExposure = 1 + _burnoutFlash * 0.7;
  } else if (renderer.toneMappingExposure !== 1) {
    renderer.toneMappingExposure = 1;
  }

  tVisual = performance.now() - _t0;

  _t0 = performance.now();
  updateCamera(dt);
  tCam = performance.now() - _t0;

  // HUD
  // velocity is in world units (mm) per second; convert mm/s → km/h.
  _t0 = performance.now();
  const speed = Math.round(chassisBody.velocity.length() * 3.6 / WORLD_UNITS_PER_M);
  // Avoid the textContent assignment when the value hasn't changed —
  // every assignment forces a synchronous style/layout invalidation
  // even if the string is identical, which adds ~0.1 ms per frame.
  if (speed !== lastDisplayedSpeed) {
    speedEl.textContent = speed;
    lastDisplayedSpeed = speed;
  }
  if (!paused) updateLapTracking();
  tHud = performance.now() - _t0;

  // ── Audio update ────────────────────────────────────────────────
  // Mirror the current kart state into the audio rig so the engine
  // crossfade + skid loop track per-frame. Edge-triggered one-shots
  // (mini-turbo blip, dash-stop sigh) fire from the prev-state
  // detectors; the explosion one-shot fires inside triggerEngineExplosion.
  if (!paused) {
    const cs = physicsBridge?.controlState;
    const driftActive = !!(cs && cs.driftActive);
    const driftTier   = (cs && (cs.driftTier | 0)) || 0;
    const charging    = keys.space && keys.w && performance.now() >= engineExplodedUntil;
    const boosting    = gloBurnoutT > 0;
    const exploded    = performance.now() < engineExplodedUntil;
    // Convert mm/s → m/s for the audio model.
    const speedMs = chassisBody.velocity.length() / WORLD_UNITS_PER_M;
    const throttle = Math.max(0, controlsThrottleHint());
    // Recompute the "is the kart sliding sideways?" signal here so the
    // skid voice can swell with cornering scrub even when the player
    // isn't actively drifting. Mirrors the logic in updateSkidTrails().
    const _aq = chassisBody.quaternion;
    const _yaw = Math.atan2(
      2 * (_aq.w * _aq.y + _aq.x * _aq.z),
      1 - 2 * (_aq.y * _aq.y + _aq.x * _aq.x),
    );
    const _fx = Math.sin(_yaw), _fz = Math.cos(_yaw);
    const _vx = chassisBody.velocity.x, _vz = chassisBody.velocity.z;
    const _latMs = Math.abs(_vx * _fz - _vz * _fx) / WORLD_UNITS_PER_M;
    const _fwdMs = (_vx * _fx + _vz * _fz) / WORLD_UNITS_PER_M;
    let _grounded = false;
    for (let i = 0; i < 4; i++) {
      if (vehicle.wheelInfos[i] && vehicle.wheelInfos[i].isInContact) { _grounded = true; break; }
    }
    // "braking" = handbrake/space pressed while moving forward fast
    // enough that the player intends a deceleration scrub, not just
    // a parked handbrake.
    const _braking = !!keys.space && _fwdMs > 5;
    kartAudio.update({
      speed: speedMs, throttle,
      lateralSpeed: _latMs, braking: _braking, grounded: _grounded,
      drifting: driftActive, charging, boosting, exploded,
    });
    // Edge: drift tier increased → mini-turbo confirmation blip.
    if (driftTier > _prevDriftTier) {
      kartAudio.playOneShot('miniTurbo', { gain: 0.7 });
    }
    _prevDriftTier = driftTier;
    // Edge: boost just ended → dash-stop sigh. Skipped when the just-
    // ended boost was a burnout launch (gloBurnoutT-driven). The
    // K_Std DashEngineStop clip is a deceleration whoosh tuned for an
    // item-boost cut-out; layering it on top of a burnout's natural
    // RPM snap-down reads as a "strange overlapping sfx", so we only
    // fire it when the boost source was something other than a
    // burnout — leaving the hook in place for future item boosts.
    if (_prevBoosting && !boosting && !exploded && !_prevBoostFromBurnout) {
      kartAudio.playOneShot('dashStop', { gain: 0.6 });
    }
    _prevBoosting = boosting;
    // Track the boost source on every transition so the next end edge
    // knows whether to fire the dashStop sigh. `gloBurnoutT > 0` is
    // currently the only thing that flips boosting on, so this is
    // always true today; structured this way so adding a non-burnout
    // boost (item, drift release) later only requires updating the
    // line below to differentiate sources.
    if (boosting) _prevBoostFromBurnout = gloBurnoutT > 0;
    else _prevBoostFromBurnout = false;
  }
  _t0 = performance.now();
  if (!paused) tickCombat(now);
  tCombat = performance.now() - _t0;

  // Auto-respawn if fallen off the world
  if (chassisBody.position.y < -M(20)) respawn();

  // Render-on-pause throttle: paint at ~12 fps while paused so the
  // overlay still composites cleanly but the GPU/main thread stay cool
  // and ready to snap back to 60 fps on resume.
  let shouldRender = true;
  if (paused) {
    if (now - lastPausedRenderAt < PAUSED_FRAME_MS) shouldRender = false;
    else lastPausedRenderAt = now;
  }
  _t0 = performance.now();
  if (shouldRender) renderer.render(scene, camera);
  tRender = performance.now() - _t0;

  // Per-frame perf snapshot for the audit spec.
  if (window.__perfTick) {
    const total = performance.now() - tickStart;
    window.__perfTick({
      total, phys: tPhys, visual: tVisual, cam: tCam,
      hud: tHud, combat: tCombat, render: tRender,
    });
  }

  requestAnimationFrame(tick);
}

function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  // Keep tire-smoke puff size consistent across viewport heights.
  // Smoke uses a true focal-length scale so its world-space radii
  // project correctly; the warm exhaust + GLO sparks + debris pools
  // still use the legacy half-height approximation for now (their
  // size constants were never unit-rescaled and they read fine as
  // small bright sparks at the clamp).
  const pxFocal = _focalPxScale();
  if (smokeMat && smokeMat.uniforms && smokeMat.uniforms.uPxScale) {
    smokeMat.uniforms.uPxScale.value = pxFocal;
  }
  if (exhaustMat && exhaustMat.uniforms && exhaustMat.uniforms.uPxScale) {
    exhaustMat.uniforms.uPxScale.value = h * 0.5;
  }
  if (gloExhMat && gloExhMat.uniforms && gloExhMat.uniforms.uPxScale) {
    gloExhMat.uniforms.uPxScale.value = h * 0.5;
  }
  if (debrisMat && debrisMat.uniforms && debrisMat.uniforms.uPxScale) {
    debrisMat.uniforms.uPxScale.value = h * 0.5;
  }
}
window.addEventListener('resize', resize);
resize();

// Back-to-editor: if the player came in via the editor "Playtest"
// button (`?from=editor`), bounce them straight back into their draft
// instead of the studio landing chooser. Otherwise use the plain
// editor URL so a fresh visit / shared link still gets the chooser.
function _backToEditorHref() {
  const params = new URLSearchParams(window.location.search);
  return params.get('from') === 'editor' ? '/editor.html?resume=1' : '/editor.html';
}

document.getElementById('backBtn').addEventListener('click', () => {
  window.location.href = _backToEditorHref();
});

// ── Pause overlay ─────────────────────────────────────────────
let paused = false;
const pauseOverlay = document.getElementById('pauseOverlay');
function togglePause() {
  paused = !paused;
  if (pauseOverlay) pauseOverlay.classList.toggle('open', paused);
  // Drop inputs so the kart doesn't coast with held keys after resume.
  keys.w = keys.a = keys.s = keys.d = keys.space = false;
  // Mirror to the worker so it freezes the world.step loop too.
  physicsBridge.setPaused(paused);
  // Force-resync key state next frame.
  for (const k of Object.keys(_prevKeysSent)) _prevKeysSent[k] = !keys[k];
}
document.getElementById('resumeBtn')?.addEventListener('click', togglePause);
document.getElementById('respawnBtn')?.addEventListener('click', () => {
  respawn();
  togglePause();
});
document.getElementById('backBtn2')?.addEventListener('click', () => {
  window.location.href = _backToEditorHref();
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

window.__play = { vehicle, chassisBody, scene, camera, renderer, track, combatState, playerCombat, controlState: physicsBridge.controlState, keys, PERF, physicsBridge, gloSkidMesh, gloSkidMat, underglow };
