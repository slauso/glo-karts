/**
 * multiplayer-editor3-main.js — Online race client (editor3 visuals + Colyseus state).
 *
 * Renders an editor3 track in Three.js, connects to `editor3_race_room`, and
 * displays every kart as a ghost driven by server snapshots. Local input
 * (WASD / arrows + Space + KeyE/Q) is sent at 30Hz; the server is
 * authoritative — there is no client-side prediction yet, so motion is
 * smoothed via lerp.
 *
 * Config priority:
 *   1. sessionStorage.gameConfig  (set by lobby.js on matchStart)
 *   2. URL params: ?trackId / ?room / ?backend / ?realtime
 *
 * Lobby gameConfig fields consumed:
 *   trackId, customTrackData, totalLaps, weaponPool, lobbyCode,
 *   players[] (for own identity by sessionId)
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Client } from 'colyseus.js';
import { buildSegmentMesh, buildSegmentBody, getDrivableTopY } from './editor3/segment-builder.js';
import { SEGMENTS, TILE } from './editor3/segments.js';
import { WORLD_UNITS_PER_M } from './editor3/units.js';
import { cloneKart, resolveKartWheels } from './editor3/kart-loader.js';
import { DEFAULT_KART_ID, KART_BY_ID } from './editor3/kart-catalog.js';
import { KartFxRig, spawnPickupBurst } from './editor3/kart-fx-rig.js';
import { createKartUnderglow, DEFAULT_GLO_EFFECT, DEFAULT_GLO_COLOR, DEFAULT_GLO_COLOR2 } from './kart-glo.js';
import { createPhysicsBridge } from './editor3/physics-bridge.js';

// Match the shared physics module so the visual offset for the cloned
// kart GLB places the wheels on the contact patch instead of leaving
// the chassis hovering above the road. Mirrors SP play-main.js.
const CHASSIS_HY_MM = 0.3 * WORLD_UNITS_PER_M;
// Cannon-es RaycastVehicle adds a suspension rest length on top of the
// chassis half-height (SP uses fixed-height wheels, MP server uses
// `suspensionRestLength: 0.3m` in realtime/src/physics/kart-physics.js).
// The broadcast kart.y is the chassis-center, so the visual GLB needs
// to drop CHASSIS_HY + SUSPENSION_REST_LENGTH so wheels visibly meet
// the road surface instead of hovering ~30 cm above it.
const SUSPENSION_REST_MM = 0.3 * WORLD_UNITS_PER_M;
const KART_VISUAL_DROP_MM = CHASSIS_HY_MM + SUSPENSION_REST_MM;
// Visual wheel radius (mirrors `WHEEL_RADIUS = M(0.4)` in the shared
// physics module). Used by the per-frame wheel-spin integrator so
// the rolling rate matches the kart's forward velocity.
const WHEEL_RADIUS_MM = 0.4 * WORLD_UNITS_PER_M;
// Visual steer lock approximation — mirrors play-main.js. The server
// scales steer by a speed-dependent lock (0.20–0.58 rad); 0.45 reads
// truthful at typical race speeds without piping the live lock value
// over the wire.
const VISUAL_STEER_LOCK_RAD = 0.45;
import { createKartAudio, STD_KIT } from './editor3/kart-audio.js';

const S = WORLD_UNITS_PER_M;
const SEND_HZ = 60;
const TUTORIAL_LOOP_ID = '11111111-1111-1111-1111-111111111111';

// ── B1 — Client-side physics prediction ─────────────────────────────
// Serializes a cannon-es CANNON.Body built on the main thread into the
// portable descriptor format that physics-worker.js rebuilds worker-side.
// Mirrors the identically-named function in play-main.js.
function _serializeCannonBody(body) {
  const shapes = [];
  for (let i = 0; i < body.shapes.length; i++) {
    const sh = body.shapes[i];
    const off = body.shapeOffsets[i];
    const oq  = body.shapeOrientations[i];
    if (sh instanceof CANNON.Box) {
      shapes.push({ type: 'box',
        halfExtents: [sh.halfExtents.x, sh.halfExtents.y, sh.halfExtents.z],
        offset: [off.x, off.y, off.z], quat: [oq.x, oq.y, oq.z, oq.w] });
    } else if (sh instanceof CANNON.Plane) {
      shapes.push({ type: 'plane',
        offset: [off.x, off.y, off.z], quat: [oq.x, oq.y, oq.z, oq.w] });
    } else if (sh instanceof CANNON.Trimesh) {
      shapes.push({ type: 'trimesh',
        vertices: Array.from(sh.vertices), indices: Array.from(sh.indices),
        offset: [off.x, off.y, off.z], quat: [oq.x, oq.y, oq.z, oq.w] });
    }
  }
  return {
    mass: body.mass,
    pos:  [body.position.x, body.position.y, body.position.z],
    quat: [body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w],
    shapes,
  };
}

// Build portable static-body descriptors + find spawn for the prediction worker.
function buildTrackPhysicsDescriptors(trackData) {
  const placements = trackData?.track?.placements || trackData?.placements || [];
  const staticBodies = [];
  let spawnPos = null;
  let spawnRot = 0;
  for (const p of placements) {
    const def = SEGMENTS[p.k];
    if (!def) continue;
    const wx   = (p.x || 0) * TILE * S;
    const wz   = (p.z || 0) * TILE * S;
    const rotY = -((p.r || 0) % 4) * (Math.PI / 2);
    const body = buildSegmentBody(p.k, { x: wx, y: 0, z: wz }, rotY);
    if (body) staticBodies.push(_serializeCannonBody(body));
    if (def.isSpawn || p.k === 'spawn') {
      spawnPos = { x: wx, y: getDrivableTopY(p.k) + S * 1.0, z: wz };
      spawnRot = rotY;
    }
  }
  if (!spawnPos) spawnPos = { x: 0, y: S * 1.5, z: 0 };
  return { staticBodies, spawnPos, spawnRot };
}

// Prediction bridge — null until connect() loads the track.
let _predBridge = null;
// Raw track physics descriptors stored until we know the kart spawn pos.
let _trackPhysDesc = null;
// Whether the bridge has been initialised with the server spawn pose.
let _predBridgeSeeded = false;
// Rolling input history keyed by seq — used for reconciliation replay.
// Holds { w, a, s, d, space, drift } in the worker 'keys' format.
const _inputHistory = new Map();
const _INPUT_HISTORY_MAX = 128;
// B5 reconcile diagnostics surface.
let _reconcileCount = 0;
let _reconcileMaxDeltaMm = 0;

const params = new URLSearchParams(window.location.search);

// Pull lobby gameConfig if present (set by lobby.js matchStart handler).
let GAME_CONFIG = null;
try {
  const raw = sessionStorage.getItem('gameConfig');
  if (raw) GAME_CONFIG = JSON.parse(raw);
} catch { /* ignore parse errors */ }

const TRACK_ID = (GAME_CONFIG && GAME_CONFIG.trackId) || params.get('trackId') || TUTORIAL_LOOP_ID;
const ROOM_CODE = (GAME_CONFIG && GAME_CONFIG.lobbyCode) || params.get('room') || '';
const PLAYER_NAME = (GAME_CONFIG && GAME_CONFIG.localPlayerName) || sessionStorage.getItem('playerName') || '';
const PLAYER_COLOR = (GAME_CONFIG && GAME_CONFIG.localPlayerColor) || sessionStorage.getItem('playerColor') || sessionStorage.getItem('carColor') || '';
const PLAYER_KART = (GAME_CONFIG && GAME_CONFIG.localPlayerKart)
  || sessionStorage.getItem('selectedKart')
  || sessionStorage.getItem('studioSelectedKart')
  || sessionStorage.getItem('playerKart')
  || DEFAULT_KART_ID;
const LOCAL_GLO_EFFECT = (GAME_CONFIG && GAME_CONFIG.localGloEffect) || sessionStorage.getItem('gloEffect') || DEFAULT_GLO_EFFECT;
const LOCAL_GLO_COLOR = (GAME_CONFIG && GAME_CONFIG.localGloColor) || sessionStorage.getItem('gloColor') || DEFAULT_GLO_COLOR;
const LOCAL_GLO_COLOR2 = (GAME_CONFIG && GAME_CONFIG.localGloColor2) || sessionStorage.getItem('gloColor2') || DEFAULT_GLO_COLOR2;
// Mirror the local player's lobby selection back into sessionStorage
// so any sub-system that reads it later (e.g. resolveSelectedKartId,
// getStoredGlo) sees the lobby choice rather than a stale default.
try {
  if (PLAYER_KART) {
    sessionStorage.setItem('selectedKart', PLAYER_KART);
    sessionStorage.setItem('studioSelectedKart', PLAYER_KART);
  }
  sessionStorage.setItem('gloEffect', LOCAL_GLO_EFFECT);
  sessionStorage.setItem('gloColor', LOCAL_GLO_COLOR);
  sessionStorage.setItem('gloColor2', LOCAL_GLO_COLOR2);
} catch { /* sessionStorage may be blocked */ }
const TOTAL_LAPS = (GAME_CONFIG && GAME_CONFIG.totalLaps) || 3;
const WEAPON_POOL = (GAME_CONFIG && Array.isArray(GAME_CONFIG.weaponPool)) ? GAME_CONFIG.weaponPool : null;
const CUSTOM_TRACK_DATA = (GAME_CONFIG && GAME_CONFIG.customTrackData) || '';
const BACKEND_URL = params.get('backend') || `${window.location.protocol}//${window.location.hostname}:8000`;
const REALTIME_URL = params.get('realtime') || (() => {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.hostname}:2567`;
})();

const hud = {
  track: document.getElementById('hud-track'),
  status: document.getElementById('hud-status'),
  players: document.getElementById('hud-players'),
  lap: document.getElementById('hud-lap'),
  weapon: document.getElementById('hud-weapon'),
  reserve: document.getElementById('hud-reserve'),
  ping: document.getElementById('hud-ping'),
  // Slice 2 — PvP battle HUD
  pvpTimer:       document.getElementById('hud-match-timer'),
  pvpScoreMe:     document.getElementById('hud-score-me'),
  pvpScoreOpp:    document.getElementById('hud-score-opp'),
  pvpLabelOpp:    document.getElementById('hud-score-label-opp'),
  pvpEffect:      document.getElementById('hud-active-effect'),
  hitFlash:       document.getElementById('hit-flash'),
  floaters:       document.getElementById('hud-floaters'),
  slotMain:       document.getElementById('hud-slot-main'),
  slotMainIcon:   document.getElementById('hud-slot-main-icon'),
  slotMainName:   document.getElementById('hud-slot-main-name'),
  slotMainCharge: document.getElementById('hud-slot-main-charge'),
  slotRes:        document.getElementById('hud-slot-reserve'),
  slotResIcon:    document.getElementById('hud-slot-reserve-icon'),
  slotResName:    document.getElementById('hud-slot-reserve-name'),
  results:        document.getElementById('overlay-results'),
  resultsTitle:   document.getElementById('results-title'),
  resultsScores:  document.getElementById('results-scores'),
  // Slice 3 — minimap + vitals
  minimap:        document.getElementById('hud-minimap'),
  hpFill:         document.getElementById('hud-hp-bar-fill'),
  hpVal:          document.getElementById('hud-hp-val'),
  coinCount:      document.getElementById('hud-coin-count'),
  // Slice 4 — speed-lines boost overlay
  speedLines:     document.getElementById('speed-lines-canvas'),
};
function setStatus(text, cls = 'warn') {
  if (!hud.status) return;
  hud.status.textContent = text;
  hud.status.className = cls;
}

// Phase E2 \u2014 client diagnostics overlay (toggle with backtick `).
// Shows live RTT, jitter, adaptive interp delay, snapshot buffer depth,
// and last reconcile correction. Off by default; persisted via localStorage.
const _diagOverlay = (() => {
  const el = document.createElement('div');
  el.id = 'net-diag-overlay';
  Object.assign(el.style, {
    position: 'fixed', top: '8px', right: '8px', zIndex: '9999',
    background: 'rgba(0,0,0,0.72)', color: '#9ff', padding: '8px 12px',
    font: '11px/1.45 ui-monospace, monospace', borderRadius: '6px',
    pointerEvents: 'none', minWidth: '210px', whiteSpace: 'pre',
    border: '1px solid rgba(0,229,255,0.4)', display: 'none',
  });
  if (typeof document !== 'undefined' && document.body) document.body.appendChild(el);
  let visible = false;
  try { visible = localStorage.getItem('glok.netDiag') === '1'; } catch { /* ignore */ }
  el.style.display = visible ? 'block' : 'none';
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => {
      if (e.key === '`' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        visible = !visible;
        el.style.display = visible ? 'block' : 'none';
        try { localStorage.setItem('glok.netDiag', visible ? '1' : '0'); } catch { /* ignore */ }
      }
    });
  }
  return {
    update(lines) {
      if (!visible) return;
      el.textContent = lines.join('\n');
    },
    isVisible() { return visible; },
  };
})();

// ── Scene ───────────────────────────────────────────────────────────
const canvas = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0d12);
scene.fog = new THREE.Fog(0x0a0d12, 80 * S, 200 * S);

const camera = new THREE.PerspectiveCamera(60, 1, 0.1 * S, 400 * S);
camera.position.set(0, 12 * S, 18 * S);
const CAM_FOV_BASE = 60;

// ── Per-frame scratch objects (never re-allocated to avoid GC pressure) ─
const _camTargetVec  = new THREE.Vector3();
const _camFwdVec     = new THREE.Vector3();
const _camUpOffset   = new THREE.Vector3(0, 8 * S, 0);
const _camLookAtVec  = new THREE.Vector3();

// ── Burnout camera punch (local kart only) ─────────────────────────
// Mirrors the SP playtest beats:
//   • While chargingBurnout is true, pull FOV inward (anticipation).
//   • On the rising edge of gloBurnoutT (release → boost), snap a
//     positive FOV kick + a brief white flash overlay. Both ease back
//     fast so the punch reads as a single "pop" rather than a sustained
//     change. Without this the player gets no proprioceptive cue that
//     the burnout actually fired, which reads as the move "glitching".
let _mpBurnoutFovKick = 0;        // current target offset (deg)
let _mpBurnoutFovKickSm = 0;      // smoothed to camera.fov
let _mpBurnoutFlash = 0;          // 0..1 white-overlay opacity target
let _mpPrevGloBurnoutT = 0;       // edge detector for release
let _mpPrevEngineExploded = false;// edge detector for explosion
const _mpBurnoutFlashEl = (() => {
  if (typeof document === 'undefined') return null;
  const el = document.createElement('div');
  el.id = 'mp-burnout-flash';
  el.style.cssText = 'position:fixed;inset:0;pointer-events:none;background:#fff;opacity:0;mix-blend-mode:screen;z-index:9998;transition:none;';
  document.body.appendChild(el);
  return el;
})();

// Lighting parity with single-player playtest (play-main.js): bright sun +
// ambient + hemi so the track surfaces aren't pitch-black.
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(60 * S, 120 * S, 40 * S);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -80 * S; sun.shadow.camera.right = 80 * S;
sun.shadow.camera.top = 80 * S; sun.shadow.camera.bottom = -80 * S;
sun.shadow.camera.near = 1 * S; sun.shadow.camera.far = 250 * S;
sun.shadow.bias = -0.0008;
scene.add(sun);
scene.add(new THREE.AmbientLight(0x6b7a92, 0.55));
scene.add(new THREE.HemisphereLight(0x88aaff, 0x222530, 0.85));

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ── Track loading ───────────────────────────────────────────────────
async function fetchTrackData(trackId) {
  try {
    const res = await fetch(`${BACKEND_URL}/api/tracks/${trackId}/`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json.track_data ?? json;
  } catch (err) {
    console.warn('[mp-editor3] track fetch failed; using empty fallback', err);
    return null;
  }
}

function buildTrackVisuals(trackData) {
  const placements = trackData?.track?.placements || trackData?.placements || [];
  const root = new THREE.Group();
  root.name = 'track-root';
  for (const p of placements) {
    const def = SEGMENTS[p.k];
    if (!def) continue;
    const mesh = buildSegmentMesh(p.k);
    mesh.position.set((p.x || 0) * TILE * S, 0, (p.z || 0) * TILE * S);
    // Match SP playtest convention (frontend/src/editor3/play-main.js):
    // `mesh.rotation.y = -p.rot * Math.PI / 2`. Without the negative sign
    // every corner placement was mirrored vs the editor preview, which
    // bent corners the wrong way relative to spawn heading and made
    // custom tracks ("oval" etc.) un-driveable in online mode.
    mesh.rotation.y = -((p.r || 0) % 4) * (Math.PI / 2);
    root.add(mesh);
  }
  scene.add(root);
  return { root, placementCount: placements.length };
}

// Async track mesh builder — yields to the browser event loop every
// CHUNK_SIZE segments so the page stays responsive while a large track
// is being assembled. Returns a Promise that resolves with the same
// { root, placementCount } shape as the synchronous version.
const TRACK_BUILD_CHUNK = 8;   // segments processed per yielded batch
function buildTrackVisualsAsync(trackData) {
  return new Promise((resolve) => {
    const placements = trackData?.track?.placements || trackData?.placements || [];
    const root = new THREE.Group();
    root.name = 'track-root';
    scene.add(root); // add immediately so the scene isn't empty during build
    let i = 0;
    function processChunk() {
      const end = Math.min(i + TRACK_BUILD_CHUNK, placements.length);
      for (; i < end; i++) {
        const p = placements[i];
        const def = SEGMENTS[p.k];
        if (!def) continue;
        const mesh = buildSegmentMesh(p.k);
        mesh.position.set((p.x || 0) * TILE * S, 0, (p.z || 0) * TILE * S);
        mesh.rotation.y = -((p.r || 0) % 4) * (Math.PI / 2);
        root.add(mesh);
      }
      if (i < placements.length) {
        setTimeout(processChunk, 0); // yield, then continue
      } else {
        resolve({ root, placementCount: placements.length });
      }
    }
    processChunk();
  });
}

// Disposes all Three.js geometries / materials in the track root to
// free GPU memory when disconnecting or loading a new track.
function disposeTrackVisuals(root) {
  if (!root) return;
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    if (obj.geometry) obj.geometry.dispose();
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (m && !m._shared) m.dispose(); // don't dispose shared cached materials
    }
  });
  scene.remove(root);
}

// ── Kart ghosts ─────────────────────────────────────────────────────
const ghosts = new Map(); // sessionId -> { group, target, color, kartId, fx, underglow }

const PEER_FALLBACK = ['#ff3aa1', '#00e5ff', '#ffd166', '#06d6a0', '#ff8c42', '#9d4edd', '#118ab2', '#ef476f'];
// Convert a colour name / hex / catalog token into a THREE-safe hex
// string. Falls back to a deterministic palette pick when unparseable
// so the kart never renders pure white.
function resolvePlayerColor(raw, idx) {
  if (raw && typeof raw === 'string' && raw.trim()) {
    try {
      const c = new THREE.Color(raw.trim());
      return `#${c.getHexString()}`;
    } catch { /* fall through */ }
  }
  return PEER_FALLBACK[idx % PEER_FALLBACK.length];
}
function resolveKartId(raw) {
  if (raw && KART_BY_ID[raw]) return raw;
  return DEFAULT_KART_ID;
}

function ensureGhost(sid, idx, kartState) {
  if (ghosts.has(sid)) return ghosts.get(sid);
  const colorHex = resolvePlayerColor(kartState?.color, idx);
  const kartId = resolveKartId(kartState?.kartId);
  const colorNum = new THREE.Color(colorHex).getHex();
  const group = new THREE.Group();
  // placeholder while GLB loads — sit at the same chassis offset as
  // the GLB so the swap doesn't pop visually.
  const placeholder = new THREE.Mesh(
    new THREE.BoxGeometry(1.2 * S, 0.6 * S, 2.0 * S),
    new THREE.MeshStandardMaterial({ color: colorNum, transparent: true, opacity: 0.55 }),
  );
  placeholder.castShadow = true;
  placeholder.position.y = -SUSPENSION_REST_MM; // chassis bottom drops by suspension extension
  group.add(placeholder);
  scene.add(group);
  cloneKart(kartId, colorNum).then((kart) => {
    // Drop the GLB so the kart's wheels sit on the contact patch.
    // Mirrors SP play-main offset. The loader already normalizes the model
    // so wheels are at y=0, so only drop by CHASSIS_HY_MM.
    kart.position.y = -CHASSIS_HY_MM;
    group.remove(placeholder);
    placeholder.geometry.dispose();
    placeholder.material.dispose();
    group.add(kart);
    // Cache the kart model + its wheel pivots so the per-frame visual
    // rig can spin the wheels, steer the front pair, and apply
    // suspension-style body roll/pitch. Without this every remote
    // kart slides forward with frozen wheels (reads as broken).
    const entry = ghosts.get(sid);
    if (entry) {
      entry.kartModel = kart;
      entry.kartBaseY = kart.position.y;
      entry.wheels = resolveKartWheels(kart) || null;
    }
  }).catch(() => { /* keep placeholder */ });
  // Per-kart FX rig: skid trails, drift smoke, drift sparks, boost
  // flames, burnout puffs. Tinted by the player's chosen GLO colour
  // so each remote ghost trails its own brand.
  const gloColorHex = (kartState?.gloColor && kartState.gloColor.trim()) || colorHex;
  const fx = new KartFxRig({ scene, gloColor: gloColorHex });
  // Per-kart underglow disc/halo — mirrors SP playtest "Pick Your GLO"
  // rig. initialState pins this instance to the broadcast values
  // instead of the global sessionStorage glo.
  const underglow = createKartUnderglow(THREE, scene, {
    innerRadius: 1.1 * S,
    haloRadius: 3.0 * S,
    // Underglow `groundOffsetY` is positive distance from the anchor
    // (group/chassis-center) DOWN to the road surface. Server chassis
    // sits CHASSIS_HY (0.3) + SUSPENSION_REST (0.3) + WHEEL_RADIUS (0.4)
    // = ~1.0m above ground. Lift slightly to avoid z-fight.
    groundOffsetY: (CHASSIS_HY_MM + SUSPENSION_REST_MM + 0.4 * S) * 0.95,
    lightRange: 5.0 * S,
    castLight: true,
    initialState: {
      gloEffect: kartState?.gloEffect || DEFAULT_GLO_EFFECT,
      gloColor: kartState?.gloColor || DEFAULT_GLO_COLOR,
      gloColor2: kartState?.gloColor2 || DEFAULT_GLO_COLOR2,
    },
  });
  const entry = {
    group,
    target: { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 },
    color: colorHex, kartId, fx, underglow,
    sid, // Phase B4: needed to identify the local kart in the FX loop.
    // Phase B3: rolling snapshot buffer for snapshot interpolation.
    // Each entry: { t, x, y, z, qx, qy, qz, qw, vx, vy, vz }.
    snapshots: [],
    interpDelayMs: 110, // adapted at runtime by the network stats; see tick()
    // Visual physics rig (populated when GLB resolves):
    kartModel: null,        // THREE.Group of the loaded kart GLB
    kartBaseY: -KART_VISUAL_DROP_MM,
    wheels: null,           // { fl, fr, rl, rr } pivots from resolveKartWheels
    wheelRollAngle: 0,      // accumulated rolling rotation (rad)
    smoothedSteer: 0,       // low-passed steering for visual lerp on front wheels
    smoothedRoll: 0,        // low-passed body roll (rad)
    smoothedPitch: 0,       // low-passed body pitch (rad)
    suspensionBob: 0,       // low-passed Y bob (mm) from vertical accel
    lastVx: 0, lastVy: 0, lastVz: 0, lastVelT: 0, // for accel finite-diff
  };
  ghosts.set(sid, entry);
  return entry;
}

function removeGhost(sid) {
  const g = ghosts.get(sid);
  if (!g) return;
  scene.remove(g.group);
  if (g.fx) g.fx.dispose();
  ghosts.delete(sid);
}

// ── Pickups (item boxes) ────────────────────────────────────────────
const pickupMeshes = new Map(); // id -> { mesh, active }
const PICKUP_GEO = new THREE.IcosahedronGeometry(0.6 * S, 0);
const PICKUP_MAT_ACTIVE = new THREE.MeshStandardMaterial({
  color: 0xffd166, emissive: 0xff8c42, emissiveIntensity: 0.7, metalness: 0.3, roughness: 0.4,
});
const PICKUP_MAT_INACTIVE = new THREE.MeshStandardMaterial({
  color: 0x444444, transparent: true, opacity: 0.25,
});
function ensurePickupMesh(id, x, y, z, active) {
  let entry = pickupMeshes.get(id);
  if (!entry) {
    const mesh = new THREE.Mesh(PICKUP_GEO, active ? PICKUP_MAT_ACTIVE : PICKUP_MAT_INACTIVE);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    scene.add(mesh);
    entry = { mesh, active };
    pickupMeshes.set(id, entry);
  } else {
    entry.mesh.position.set(x, y, z);
    if (entry.active !== active) {
      // Active→inactive transition = some kart just grabbed it. Fire a
      // GLO-tinted sparkle burst at its location for visual feedback.
      if (entry.active && !active) {
        const upd = spawnPickupBurst({
          scene, position: entry.mesh.position.clone(),
          color: 0xffd166, lifeS: 0.6,
        });
        if (upd) pickupBursts.push(upd);
      }
      // Inactive→active transition = item box respawning. Show a cool
      // cyan sparkle so it's obvious to both players that a new item is available.
      if (!entry.active && active) {
        const upd = spawnPickupBurst({
          scene, position: entry.mesh.position.clone(),
          color: 0x88ffdd, lifeS: 0.5,
        });
        if (upd) pickupBursts.push(upd);
      }
      entry.mesh.material = active ? PICKUP_MAT_ACTIVE : PICKUP_MAT_INACTIVE;
      entry.active = active;
    }
  }
  return entry;
}

// Active pickup-burst lifecycle closures driven from tick().
const pickupBursts = [];

// ── Projectile FX (transient) ───────────────────────────────────────
const fxBodies = []; // { mesh, life }
function spawnProjectileFx(x, y, z, color) {
  const geo = new THREE.SphereGeometry(0.4 * S, 12, 12);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y + 0.5 * S, z);
  scene.add(m);
  fxBodies.push({ mesh: m, life: 0.8 });
}

// ── Slice 2: PvP projectile mesh + screen-effects helpers ────────────────
const projMeshes = new Map(); // projKey → { mesh, color }

const PROJ_COLORS = {
  green_shell:  0x22ff44, red_shell:  0xff2233, blue_shell: 0x00aaff,
  bobomb:       0x222222, bullet_bill: 0x444444, banana: 0xffdd00,
  missile: 0xff6600, rocket: 0x00ccff, mortar: 0x886644,
  // V8 series
  v8_missile: 0xff8800, v8_cannon: 0xcc4400, v8_rocket: 0x00ddff,
  v8_mortar: 0x997755, v8_mine: 0x111111, v8_dynamite: 0xff2200,
  v8_firethrower: 0xff5500,
  default: 0xffffff,
};
const PROJ_RADII = {
  green_shell: 0.22, red_shell: 0.22, blue_shell: 0.28,
  bobomb: 0.30, bullet_bill: 0.60, banana: 0.18,
  missile: 0.20, rocket: 0.22, mortar: 0.25,
  v8_missile: 0.22, v8_cannon: 0.28, v8_rocket: 0.22,
  v8_mortar: 0.28, v8_mine: 0.32, v8_dynamite: 0.30,
  v8_firethrower: 0.14,
  default: 0.20,
};

const WEAPON_ICONS = {
  mushroom: '🍄', golden_mushroom: '🌟', star: '⭐', green_shell: '🐢',
  red_shell: '🔴', blue_shell: '💙', banana: '🍌', bobomb: '💣',
  bullet_bill: '🚀', missile: '🎯', rocket: '⚡', mortar: '💥',
  mine: '🔲', dynamite: '🧨', firethrower: '🔥', shield: '🛡️',
  repair: '🔧', double_dmg: '⚔️', health_orb: '❤️', coin: '🪙',
  // V8 series
  v8_missile: '🎯', v8_cannon: '💥', v8_rocket: '🚀', v8_mortar: '☄️',
  v8_mine: '💀', v8_dynamite: '🧨', v8_firethrower: '🔥',
  v8_shield: '🛡', v8_repair: '💊', v8_double_dmg: '✖2',
  default: '❓',
};

function ensureProjMesh(key, subType) {
  if (projMeshes.has(key)) return projMeshes.get(key).mesh;
  const col = PROJ_COLORS[subType] ?? PROJ_COLORS.default;
  const r   = (PROJ_RADII[subType] ?? PROJ_RADII.default) * S;
  const geo = new THREE.SphereGeometry(r, 10, 8);
  const mat = new THREE.MeshBasicMaterial({ color: col });
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
  projMeshes.set(key, { mesh, color: col });
  return mesh;
}

function removeProjMesh(key) {
  const entry = projMeshes.get(key);
  if (!entry) return;
  scene.remove(entry.mesh);
  entry.mesh.geometry.dispose();
  entry.mesh.material.dispose();
  projMeshes.delete(key);
}

let _hitFlashTimer = 0;
let _shakeTimer    = 0;
let _shakeAmp      = 0;

function triggerHitFlash() {
  if (hud.hitFlash) hud.hitFlash.style.opacity = '1';
  _hitFlashTimer = 0.35;
}

function triggerScreenShake(amp = 0.8, dur = 0.4) {
  _shakeAmp   = amp * S;
  _shakeTimer = dur;
}

let _floaterIdCounter = 0;
function showFloater(text, color = '#fff') {
  if (!hud.floaters) return;
  const el = document.createElement('div');
  el.style.cssText = `font-family:var(--font-display,"Bungee",sans-serif);font-size:28px;font-weight:400;
    letter-spacing:0.06em;color:${color};text-shadow:0 0 12px ${color}80;
    pointer-events:none;animation:floaterUp 1.6s ease-out forwards;`;
  el.textContent = text;
  el.id = 'floater-' + (_floaterIdCounter++);
  // add keyframe once
  if (!document.getElementById('floater-keyframe')) {
    const s = document.createElement('style');
    s.id = 'floater-keyframe';
    s.textContent = '@keyframes floaterUp{0%{transform:translateY(0) scale(1);opacity:1}' +
                    '60%{transform:translateY(-40px) scale(1.1);opacity:1}' +
                    '100%{transform:translateY(-90px) scale(0.8);opacity:0}}';
    document.head.appendChild(s);
  }
  hud.floaters.appendChild(el);
  setTimeout(() => el.remove(), 1700);
}

function _updateWeaponSlot(slot, name, charge) {
  const isEmpty = !name;
  const slotEl   = slot === 'main' ? hud.slotMain : hud.slotRes;
  const iconEl   = slot === 'main' ? hud.slotMainIcon : hud.slotResIcon;
  const nameEl   = slot === 'main' ? hud.slotMainName : hud.slotResName;
  const chargeEl = slot === 'main' ? hud.slotMainCharge : null;
  if (!slotEl) return;
  if (isEmpty) {
    slotEl.classList.add('empty');
    if (iconEl)   iconEl.textContent = '—';
    if (nameEl)   nameEl.textContent = slot === 'main' ? 'No Weapon' : 'Reserve';
    if (chargeEl) chargeEl.textContent = '';
  } else {
    slotEl.classList.remove('empty');
    if (iconEl)   iconEl.textContent = WEAPON_ICONS[name] ?? WEAPON_ICONS.default;
    if (nameEl)   nameEl.textContent = name.replace('_', ' ').replace('pk ', '').replace('weapon:', '');
    if (chargeEl) chargeEl.textContent = (charge && charge > 1) ? '✕' + charge : '';
  }
}

// ── Render loop additions ───────────────────────────────────────────
// ── Slice 3: Minimap rendering ─────────────────────────────────────────────
const MINIMAP_RANGE_M  = 100;
const MINIMAP_RANGE_WU = MINIMAP_RANGE_M * S;
const blueShellRings = new Map(); // projKey → { mesh }
let _lastMinimapDrawMs = 0; // throttle minimap to 15Hz

function _drawMinimap(state, mySid) {
  const canvas = hud.minimap;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const CX = W / 2, CY = H / 2;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(10,10,24,0.82)';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(0, 0, W, H, 10);
  else { ctx.rect(0, 0, W, H); }
  ctx.fill();

  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(CX, CY, CX * 0.92, 0, Math.PI * 2);
  ctx.stroke();

  const toMM = (wx, wz) => ({
    px: CX + (wx / MINIMAP_RANGE_WU) * CX * 0.9,
    py: CY - (wz / MINIMAP_RANGE_WU) * CY * 0.9,
  });

  if (state && state.pickups) {
    state.pickups.forEach((pu) => {
      const p = toMM(pu.x, pu.z);
      ctx.beginPath();
      ctx.arc(p.px, p.py, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = pu.active ? '#ffd700' : 'rgba(255,215,0,0.25)';
      ctx.fill();
    });
  }

  for (const { mesh } of projMeshes.values()) {
    const p = toMM(mesh.position.x, mesh.position.z);
    ctx.beginPath();
    ctx.arc(p.px, p.py, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,120,0,0.85)';
    ctx.fill();
  }

  if (state && state.karts) {
    state.karts.forEach((ks, sid) => {
      const p = toMM(ks.x, ks.z);
      const isMe = sid === mySid;
      const yaw = Math.atan2(
        2 * ((ks.qw || 1) * (ks.qy || 0) + (ks.qx || 0) * (ks.qz || 0)),
        1 - 2 * ((ks.qy || 0) * (ks.qy || 0) + (ks.qx || 0) * (ks.qx || 0))
      );
      ctx.save();
      ctx.translate(p.px, p.py);
      ctx.rotate(-yaw);
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4.5, 5);
      ctx.lineTo(0, 2.5);
      ctx.lineTo(-4.5, 5);
      ctx.closePath();
      ctx.fillStyle = isMe ? '#00e5ff' : '#ff4da6';
      ctx.shadowColor = isMe ? '#00e5ff' : '#ff4da6';
      ctx.shadowBlur  = 6;
      ctx.fill();
      ctx.restore();
    });
  }
}

let roomRef = null; // populated once room joined
const PICKUP_PROXIMITY_MM = 16 * S; // client-side trigger to send pickupItem

// ── UI overlays (lobby + pause) ────────────────────────────────
const overlays = {
  lobby: document.getElementById('overlay-lobby'),
  pause: document.getElementById('overlay-pause'),
  countdown: document.getElementById('overlay-countdown'),
  countdownNum: document.getElementById('countdown-num'),
  lobbyTrack: document.getElementById('lobby-track'),
  lobbyCode: document.getElementById('lobby-code'),
  lobbyLaps: document.getElementById('lobby-laps'),
  lobbyNetStatus: document.getElementById('lobby-net-status'),
  lobbyPlayers: document.getElementById('lobby-players'),
  lobbyStartBtn: document.getElementById('lobby-start'),
  lobbyLeaveBtn: document.getElementById('lobby-leave'),
  pauseTrack: document.getElementById('pause-track'),
  pauseLap: document.getElementById('pause-lap'),
  pausePlayers: document.getElementById('pause-players'),
  pauseResumeBtn: document.getElementById('pause-resume'),
  pauseLeaveBtn: document.getElementById('pause-leave'),
};

// `inputLocked` is true while the lobby OR pause overlay is open. We
// still poll input so the network keeps a steady 30Hz stream, but we
// zero throttle/brake/steer/drift so the kart cannot be driven by an
// unattended player. The server is authoritative; this is just to
// prevent surprise inputs from leaking through.
let inputLocked = true;
let raceStarted = false;

function showLobby()  { overlays.lobby?.classList.remove('hidden'); inputLocked = true; }
function hideLobby()  { overlays.lobby?.classList.add('hidden'); }
function showPause()  { overlays.pause?.classList.remove('hidden'); inputLocked = true; }
function hidePause()  { overlays.pause?.classList.add('hidden'); inputLocked = false; }

function startCountdown(onDone) {
  let n = 3;
  overlays.countdown?.classList.remove('hidden');
  if (overlays.countdownNum) overlays.countdownNum.textContent = String(n);
  // Play countdown beep on the first tick.
  try { ensureKartAudio(); kartAudio.playOneShot('preStart', { gain: 0.85 }); } catch {}
  const tickN = () => {
    n--;
    if (n <= 0) {
      if (overlays.countdownNum) overlays.countdownNum.textContent = 'GO!';
      // Race-start horn fires on "GO!" — auditory confirmation for all players.
      try { ensureKartAudio(); kartAudio.playOneShot('startRaceHorn', { gain: 1.0 }); } catch {}
      setTimeout(() => {
        overlays.countdown?.classList.add('hidden');
        onDone && onDone();
      }, 600);
      return;
    }
    if (overlays.countdownNum) {
      // Trigger the CSS pulse animation by replacing the node.
      overlays.countdownNum.style.animation = 'none';
      overlays.countdownNum.textContent = String(n);
      // eslint-disable-next-line no-unused-expressions
      overlays.countdownNum.offsetHeight;
      overlays.countdownNum.style.animation = '';
    }
    try { ensureKartAudio(); kartAudio.playOneShot('preStart', { gain: 0.75 }); } catch {}
    setTimeout(tickN, 1000);
  };
  setTimeout(tickN, 1000);
}

function beginRace() {
  if (raceStarted) return;
  raceStarted = true;
  hideLobby();
  startCountdown(() => { inputLocked = false; });
}

function leaveMatch() {
  // Best-effort graceful leave; navigation kills the WebSocket either way.
  try { roomRef?.leave(true); } catch {}
  // Navigate to the main menu / index. Use lobby.html if present in
  // the deployment, else fall back to root.
  window.location.href = '/index.html';
}

if (overlays.lobbyStartBtn) overlays.lobbyStartBtn.addEventListener('click', beginRace);
if (overlays.lobbyLeaveBtn) overlays.lobbyLeaveBtn.addEventListener('click', leaveMatch);
if (overlays.pauseResumeBtn) overlays.pauseResumeBtn.addEventListener('click', hidePause);
if (overlays.pauseLeaveBtn)  overlays.pauseLeaveBtn.addEventListener('click', leaveMatch);

function renderLobbyPlayers(state) {
  if (!overlays.lobbyPlayers) return;
  const items = [];
  state.karts.forEach((k, sid) => {
    const me = sid === mySid;
    const colorHex = (k.color && /^#?[0-9a-f]{6}$/i.test(String(k.color)))
      ? (String(k.color).startsWith('#') ? k.color : `#${k.color}`)
      : '#ff3aa1';
    const name = k.name || sid.slice(0, 6);
    items.push(`<div class="overlay-player ${me ? 'me' : ''}">
      <span class="swatch" style="background:${colorHex};color:${colorHex}"></span>
      <span>${name}${me ? ' (you)' : ''}</span>
    </div>`);
  });
  overlays.lobbyPlayers.innerHTML = items.join('') || '<div class="overlay-player">waiting for players…</div>';
}

// Esc toggles pause when in-race; ignored during pre-race lobby.
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape') return;
  if (!raceStarted) return;
  if (overlays.pause && overlays.pause.classList.contains('hidden')) showPause();
  else hidePause();
});

// ── Audio (local kart only) ────────────────────────────────────────
// The audio rig opens an AudioContext on first interaction; remote
// karts don't get their own engine voices to keep the mix sane.
let kartAudio = null;
let _prevDriftTier = 0;
function ensureKartAudio() {
  if (kartAudio) return kartAudio;
  try { kartAudio = createKartAudio({ kit: STD_KIT, masterVolume: 0.6 }); } catch { kartAudio = null; }
  return kartAudio;
}
window.addEventListener('pointerdown', ensureKartAudio, { once: true });
window.addEventListener('keydown',     ensureKartAudio, { once: true });

const input = { throttle: 0, brake: 0, steer: 0, drift: false, seq: 0 };
const keys = new Set();
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyE' && roomRef) { try { roomRef.send('fireWeapon', { slot: 'secondary' }); } catch {} }
  if (e.code === 'KeyQ' && roomRef) { try { roomRef.send('swapSecondaryWeapon'); } catch {} }
  // Phase F1 — manual respawn. Server rate-limits to 1 per 1.5s and
  // snaps the kart back to its nearest spawn pose with zero velocity.
  if (e.code === 'KeyR' && roomRef && !inputLocked) { try { roomRef.send('respawn'); } catch {} }
});
window.addEventListener('keyup', (e) => { keys.delete(e.code); });

// Gamepad fire-button state — prevent repeat fires per press.
let _gpFireHeld = false;
let _gpSwapHeld = false;

function pollInput() {
  if (inputLocked) {
    input.throttle = 0;
    input.brake = 0;
    input.steer = 0;
    input.drift = false;
    return;
  }
  const fwd = keys.has('KeyW') || keys.has('ArrowUp');
  const back = keys.has('KeyS') || keys.has('ArrowDown');
  const left = keys.has('KeyA') || keys.has('ArrowLeft');
  const right = keys.has('KeyD') || keys.has('ArrowRight');
  const brake = keys.has('Space');
  // Drift = Shift (ShiftLeft / ShiftRight). Mirrors SP playtest binding
  // so hop→commit→slide works identically online.
  const drift = keys.has('ShiftLeft') || keys.has('ShiftRight');
  // Send RAW digital intent. The server's shared physics core
  // (`applyKartControls`) already smooths binary keys into a 0..1
  // throttle ramp over ~167 ms — identical to SP playtest. A second
  // client-side ramp here was producing ~530 ms total throttle delay
  // vs SP, breaking SP↔MP feel parity. Visual smoothing for body roll /
  // wheel steer lives in `_updateKartVisuals` (entry.smoothedSteer
  // low-pass), so the wheels and chassis still look weighted even
  // though the wire-level intent is binary.
  input.steer = (left ? -1 : 0) + (right ? 1 : 0);
  input.throttle = fwd ? 1 : (back ? -1 : 0);
  input.brake = brake ? 1 : 0;
  input.drift = drift;

  // ── Gamepad overlay (standard mapping) ─────────────────────────────
  // Axes: 0=Left stick X, 1=Left stick Y. Buttons: 0=A/Cross, 1=B/Circle,
  // 2=X/Square, 3=Y/Triangle, 4=LB, 5=RB, 6=LT, 7=RT (as axis value 0–1).
  const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of gamepads) {
    if (!gp || !gp.connected) continue;
    const lx = gp.axes[0] || 0;
    const rt = gp.buttons[7]?.value ?? 0;  // right trigger → throttle
    const lt = gp.buttons[6]?.value ?? 0;  // left trigger  → brake
    const driftBtn = gp.buttons[4]?.pressed || gp.buttons[5]?.pressed; // LB/RB
    const fireBtn  = gp.buttons[0]?.pressed; // A / Cross = fire
    const swapBtn  = gp.buttons[2]?.pressed; // X / Square = swap

    if (Math.abs(lx) > 0.12) input.steer   = lx;
    if (rt > 0.08)            input.throttle = rt;
    if (lt > 0.08)            input.brake    = lt;
    if (driftBtn)             input.drift    = true;

    // Edge-triggered fire (one send per press cycle).
    if (fireBtn && !_gpFireHeld) {
      if (roomRef) try { roomRef.send('fireWeapon', { slot: 'secondary' }); } catch {}
      _gpFireHeld = true;
    } else if (!fireBtn) { _gpFireHeld = false; }

    if (swapBtn && !_gpSwapHeld) {
      if (roomRef) try { roomRef.send('swapSecondaryWeapon'); } catch {}
      _gpSwapHeld = true;
    } else if (!swapBtn) { _gpSwapHeld = false; }

    break; // first connected gamepad wins
  }
}

// ── Render loop ─────────────────────────────────────────────────────
let mySid = null;
let lastFrame = performance.now();
let lastPing = 0;
// Snappier interpolation so the local kart's response to control input
// feels closer to SP playtest. With the 30Hz snapshot stream, an LERP
// factor of 0.45 catches 95% in ~5 frames (≈83ms) instead of the
// previous 200ms. Matches roughly the network RTT for nearby peers.
const LERP = 0.45;

// Slice 4 — speed-lines canvas (lazy init on first boost frame).
let _speedLinesCtx = null;
let _speedLinesW = 0;
let _speedLinesH = 0;
let _speedLinesT = 0; // accumulated time for ray angle animation
function _drawSpeedLines(boostActive, dt2) {
  const canvas = hud.speedLines;
  if (!canvas) return;
  if (!_speedLinesCtx) _speedLinesCtx = canvas.getContext('2d');
  if (!_speedLinesCtx) return;
  const W = window.innerWidth, H = window.innerHeight;
  if (W !== _speedLinesW || H !== _speedLinesH) {
    canvas.width = W; canvas.height = H;
    _speedLinesW = W; _speedLinesH = H;
  }
  _speedLinesCtx.clearRect(0, 0, W, H);
  if (!boostActive) return;
  _speedLinesT = (_speedLinesT + dt2 * 2.2) % (Math.PI * 2);
  const cx = W / 2, cy = H / 2;
  const N = 20;
  for (let i = 0; i < N; i++) {
    const baseAngle = (i / N) * Math.PI * 2 + _speedLinesT * 0.18;
    const jitter = Math.sin(i * 7.3 + _speedLinesT * 3.1) * 0.12;
    const angle = baseAngle + jitter;
    const r1 = W * 0.30 + Math.sin(i * 2.7 + _speedLinesT * 2) * W * 0.04;
    const r2 = r1 + W * 0.06 + Math.sin(i * 3.1 + _speedLinesT) * W * 0.04;
    const alpha = 0.18 + 0.22 * Math.abs(Math.sin(i + _speedLinesT * 1.5));
    _speedLinesCtx.strokeStyle = `rgba(255,200,80,${alpha.toFixed(2)})`;
    _speedLinesCtx.lineWidth = 2 + Math.sin(i * 1.4) * 1;
    _speedLinesCtx.beginPath();
    _speedLinesCtx.moveTo(cx + Math.cos(angle) * r1, cy + Math.sin(angle) * r1);
    _speedLinesCtx.lineTo(cx + Math.cos(angle) * r2, cy + Math.sin(angle) * r2);
    _speedLinesCtx.stroke();
  }
}

// Phase B3 — snapshot interpolation tunables.
const SNAPSHOT_BUFFER_MAX = 6; // ~200ms at 30Hz; trims oldest beyond this
const INTERP_DELAY_MIN_MS = 60;
const INTERP_DELAY_MAX_MS = 200;
const EXTRAP_MAX_MS = 33; // cap at ≈1 frame ahead of the freshest snapshot
let _netRttMs = 50;
let _netJitterMs = 10;

function _adaptiveInterpDelayMs() {
  // Same shape as Phase B2 in the babylon client: rtt/2 + 2σjitter, clamped.
  const v = _netRttMs * 0.5 + _netJitterMs * 2;
  return Math.max(INTERP_DELAY_MIN_MS, Math.min(INTERP_DELAY_MAX_MS, v));
}

function _pushSnapshot(entry, kart, nowMs) {
  const buf = entry.snapshots;
  buf.push({
    t: nowMs,
    x: kart.x, y: kart.y, z: kart.z,
    qx: kart.qx, qy: kart.qy, qz: kart.qz, qw: kart.qw,
    vx: kart.vx || 0, vy: kart.vy || 0, vz: kart.vz || 0,
  });
  while (buf.length > SNAPSHOT_BUFFER_MAX) buf.shift();
}

const _tmpQuatA = new THREE.Quaternion();
const _tmpQuatB = new THREE.Quaternion();
function _sampleSnapshotBuffer(entry, renderTimeMs, dst) {
  const buf = entry.snapshots;
  if (buf.length === 0) return false;
  if (buf.length === 1) {
    const a = buf[0];
    dst.x = a.x; dst.y = a.y; dst.z = a.z;
    dst.qx = a.qx; dst.qy = a.qy; dst.qz = a.qz; dst.qw = a.qw;
    return true;
  }
  // Find first snapshot newer than renderTime (latest is at end).
  let hi = -1;
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i].t >= renderTimeMs) { hi = i; break; }
  }
  if (hi <= 0) {
    // Render time past the freshest sample — extrapolate using last sample's
    // velocity, capped at EXTRAP_MAX_MS.
    const a = buf[buf.length - 1];
    const ahead = Math.min(EXTRAP_MAX_MS, Math.max(0, renderTimeMs - a.t)) / 1000;
    dst.x = a.x + a.vx * ahead;
    dst.y = a.y + a.vy * ahead;
    dst.z = a.z + a.vz * ahead;
    dst.qx = a.qx; dst.qy = a.qy; dst.qz = a.qz; dst.qw = a.qw;
    return true;
  }
  const b = buf[hi];
  const a = buf[hi - 1];
  const span = Math.max(1e-3, b.t - a.t);
  const u = Math.max(0, Math.min(1, (renderTimeMs - a.t) / span));
  dst.x = a.x + (b.x - a.x) * u;
  dst.y = a.y + (b.y - a.y) * u;
  dst.z = a.z + (b.z - a.z) * u;
  _tmpQuatA.set(a.qx, a.qy, a.qz, a.qw);
  _tmpQuatB.set(b.qx, b.qy, b.qz, b.qw);
  _tmpQuatA.slerp(_tmpQuatB, u);
  dst.qx = _tmpQuatA.x; dst.qy = _tmpQuatA.y; dst.qz = _tmpQuatA.z; dst.qw = _tmpQuatA.w;
  return true;
}
const _sampleScratch = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };

// ── Kart visual feel rig ────────────────────────────────────────────
// Drives wheel spin, front-wheel steering, body roll/pitch, and a
// suspension-style Y bob for every visible kart (local + remote).
// Without this every remote kart slides forward with frozen wheels
// and a perfectly rigid chassis \u2014 reads as "broken" / "disconnected".
//
// Inputs per kart:
//   \u2022 group quaternion (smoothed render orientation)
//   \u2022 latest server velocity from the snapshot buffer / fxState
//   \u2022 steerIn (server-broadcast steering intent) for remote karts
//     OR the live `input.steer` for the local kart
//
// Outputs:
//   \u2022 wheels.fl/fr/rl/rr quaternions (steered + rolled)
//   \u2022 kartModel.position.y (suspension bob)
//   \u2022 kartModel.rotation (chassis roll on Z + pitch on X)
function _updateKartVisuals(entry, dt, nowMs) {
  if (!entry.kartModel) return;
  const g = entry.group;
  // Forward axis from render quaternion (Y-up world).
  const qx = g.quaternion.x, qy = g.quaternion.y, qz = g.quaternion.z, qw = g.quaternion.w;
  const sinyCosp = 2 * (qw * qy + qx * qz);
  const cosyCosp = 1 - 2 * (qy * qy + qx * qx);
  const yaw = Math.atan2(sinyCosp, cosyCosp);
  const fwdX = Math.sin(yaw), fwdZ = Math.cos(yaw);

  // Latest velocity \u2014 prefer the freshest snapshot (authoritative)
  // because fxState may be one frame stale.
  const buf = entry.snapshots;
  const last = buf.length ? buf[buf.length - 1] : null;
  const vx = last ? last.vx : (entry._fxState?.velocity.x || 0);
  const vy = last ? last.vy : (entry._fxState?.velocity.y || 0);
  const vz = last ? last.vz : (entry._fxState?.velocity.z || 0);

  // Forward + lateral speed (mm/s) in chassis frame.
  const fwdSpeed = vx * fwdX + vz * fwdZ;
  const latSpeed = vx * fwdZ - vz * fwdX;

  // Wheel roll integration: omega = fwd / radius. Same units (mm/s, mm).
  const omega = fwdSpeed / WHEEL_RADIUS_MM;
  entry.wheelRollAngle += omega * dt;

  // Steering target. For LOCAL kart use live input (zero-latency feel).
  // For remote karts use the server-broadcast steerIn.
  const targetSteer = entry.sid === mySid
    ? (input.steer || 0)
    : (entry._fxState?.steerIn || 0);
  // Critically-damped low-pass so the wheel angle doesn't snap on
  // every input edge.
  const steerAlpha = 1 - Math.exp(-22 * dt);
  entry.smoothedSteer += (targetSteer - entry.smoothedSteer) * steerAlpha;
  const steerAngle = -entry.smoothedSteer * VISUAL_STEER_LOCK_RAD;

  if (entry.wheels) {
    const apply = (w, isFront) => {
      // Restore base quat \u2192 steer (Y) \u2192 roll (X). YXZ Euler order so
      // the roll is performed about the post-steered axle.
      w.quaternion.copy(w.userData.baseQuat);
      if (isFront) w.rotateY(steerAngle);
      w.rotateX(entry.wheelRollAngle);
    };
    apply(entry.wheels.fl, true);
    apply(entry.wheels.fr, true);
    apply(entry.wheels.rl, false);
    apply(entry.wheels.rr, false);
  }

  // ── Chassis roll / pitch / suspension bob ─────────────────────
  // Derive longitudinal + lateral acceleration via finite-diff of the
  // raw server velocity (snapshot deltas). Then map to chassis tilt:
  //   roll  = -lateralAccel  \u2192 outside wheels compress in a turn
  //   pitch = +longitudinalAccel \u2192 squat under accel, dive under brake
  // Convert mm/s\u00b2 \u2192 m/s\u00b2 \u2192 fraction of g, then scale to a small
  // tilt angle (~6\u00b0 max). All values low-passed so the chassis
  // doesn't twitch on snapshot jitter.
  const dtAccel = Math.max(0.016, (nowMs - (entry.lastVelT || nowMs)) / 1000);
  const ax = (vx - (entry.lastVx || 0)) / dtAccel;
  const az = (vz - (entry.lastVz || 0)) / dtAccel;
  const ay = (vy - (entry.lastVy || 0)) / dtAccel;
  entry.lastVx = vx; entry.lastVy = vy; entry.lastVz = vz; entry.lastVelT = nowMs;
  // Project accel into chassis frame.
  const fwdAccel = (ax * fwdX + az * fwdZ) / WORLD_UNITS_PER_M; // m/s\u00b2
  const latAccel = (ax * fwdZ - az * fwdX) / WORLD_UNITS_PER_M; // m/s\u00b2
  const vertAccel = ay / WORLD_UNITS_PER_M;
  const G = 9.81;
  // Tilt scales: ~3\u00b0 / g cornering, ~5\u00b0 / g squat\u2011dive. Capped.
  const TILT_PER_G_LAT = 0.052;  // \u22483\u00b0
  const TILT_PER_G_LON = 0.087;  // \u22485\u00b0
  const TILT_CAP = 0.14;          // \u22488\u00b0
  const targetRoll  = Math.max(-TILT_CAP, Math.min(TILT_CAP, -latAccel / G * TILT_PER_G_LAT));
  const targetPitch = Math.max(-TILT_CAP, Math.min(TILT_CAP,  fwdAccel / G * TILT_PER_G_LON));
  const tiltAlpha = 1 - Math.exp(-10 * dt);
  entry.smoothedRoll  += (targetRoll  - entry.smoothedRoll)  * tiltAlpha;
  entry.smoothedPitch += (targetPitch - entry.smoothedPitch) * tiltAlpha;
  entry.kartModel.rotation.set(entry.smoothedPitch, 0, entry.smoothedRoll);

  // Suspension Y bob: vertical accel \u2192 small Y offset. Compresses
  // (negative offset) when chassis accelerates upward (landing),
  // extends (positive) when falling. Capped so jumps don't make
  // the model leave the chassis.
  const targetBob = Math.max(-30, Math.min(30, -vertAccel / G * 18)); // mm
  const bobAlpha = 1 - Math.exp(-14 * dt);
  entry.suspensionBob += (targetBob - entry.suspensionBob) * bobAlpha;
  entry.kartModel.position.y = entry.kartBaseY + entry.suspensionBob;
  // Silence unused-locals warning while keeping vars intentional.
  void fwdSpeed; void latSpeed;
}

function tick(now) {
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  // Phase B3: render-time used for snapshot interpolation = now - adaptiveDelay
  const interpDelayMs = _adaptiveInterpDelayMs();
  const renderTimeMs = now - interpDelayMs;
  // Smooth all ghosts toward server target.
  for (const entry of ghosts.values()) {
    const g = entry.group;
    const t = entry.target;
    // Phase B3: prefer snapshot-buffer interpolation for ghosts; fall back
    // to the legacy single-target LERP if the buffer hasn't filled yet.
    // Local kart still uses the LERP path \u2014 client-side prediction (B1)
    // will replace this entirely.
    let usedBuffer = false;
    if (entry.sid !== mySid && entry.snapshots.length >= 2) {
      if (_sampleSnapshotBuffer(entry, renderTimeMs, _sampleScratch)) {
        g.position.x = _sampleScratch.x;
        g.position.y = _sampleScratch.y;
        g.position.z = _sampleScratch.z;
        g.quaternion.set(_sampleScratch.qx, _sampleScratch.qy, _sampleScratch.qz, _sampleScratch.qw);
        usedBuffer = true;
      }
    }
    if (!usedBuffer) {
      // Phase B1b \u2014 stable client-side prediction for the LOCAL kart.
      //
      // The previous implementation LERPed to the last server target
      // and then ADDED `velocity * RTT/2` ON TOP every render frame.
      // Because the lookahead was re-applied each frame (not folded
      // into the LERP target), it produced a per-frame additive bias
      // that visibly jittered \u2014 the kart's render position oscillated
      // between (target + bias) and (smoothed target + new bias)
      // every snapshot delivery.
      //
      // Fix: integrate the freshest snapshot's velocity from the
      // snapshot timestamp through "now + RTT/2", set THAT as the
      // LERP target, and exponentially smooth the visual position
      // toward it. The kart still leads the server by RTT/2 (so
      // controls feel instant), but the prediction is computed once
      // per frame relative to a STABLE anchor instead of stacking on
      // top of the previous frame.
      let tx = t.x, ty = t.y, tz = t.z;
      let tqx = t.qx, tqy = t.qy, tqz = t.qz, tqw = t.qw;
      if (entry.sid === mySid) {
        // B1 full — Use physics-worker prediction bridge for the local kart.
        // Falls back to B1b velocity extrapolation if the bridge hasn't
        // received its first snap yet (first few frames after connect).
        if (_predBridge && _predBridge.snapCount > 0) {
          _predBridge.interpolate(now);
          const ip = _predBridge.chassisBody.interpolatedPosition;
          const iq = _predBridge.chassisBody.interpolatedQuaternion;
          g.position.set(ip.x, ip.y, ip.z);
          g.quaternion.set(iq.x, iq.y, iq.z, iq.w);
        } else {
          // B1b fallback: simple velocity extrapolation until bridge is ready.
          const buf = entry.snapshots;
          const last = buf.length ? buf[buf.length - 1] : null;
          if (last) {
            const ageSec = Math.max(0, (now - last.t) / 1000);
            const halfRttSec = Math.min(0.12, (_netRttMs * 0.5) / 1000);
            const leadSec = Math.min(0.18, ageSec + halfRttSec);
            tx = last.x + last.vx * leadSec;
            ty = last.y + last.vy * leadSec;
            tz = last.z + last.vz * leadSec;
            tqx = last.qx; tqy = last.qy; tqz = last.qz; tqw = last.qw;
            const POS_RATE = 12;
            const ROT_RATE = 18;
            const aPos = 1 - Math.exp(-POS_RATE * dt);
            const aRot = 1 - Math.exp(-ROT_RATE * dt);
            g.position.x += (tx - g.position.x) * aPos;
            g.position.y += (ty - g.position.y) * aPos;
            g.position.z += (tz - g.position.z) * aPos;
            _tmpQuatA.set(tqx, tqy, tqz, tqw);
            g.quaternion.slerp(_tmpQuatA, aRot);
          }
        }
      } else {
        // Remote kart (buffer miss): smooth toward the latest server target.
        const POS_RATE = 12;
        const ROT_RATE = 18;
        const aPos = 1 - Math.exp(-POS_RATE * dt);
        const aRot = 1 - Math.exp(-ROT_RATE * dt);
        g.position.x += (tx - g.position.x) * aPos;
        g.position.y += (ty - g.position.y) * aPos;
        g.position.z += (tz - g.position.z) * aPos;
        _tmpQuatA.set(tqx, tqy, tqz, tqw);
        g.quaternion.slerp(_tmpQuatA, aRot);
      }
    }   // end if (!usedBuffer)
    // Visual feel rig: spin wheels, steer the front pair, apply
    // body roll/pitch + suspension bob. Runs for every kart, local
    // and remote, using the smoothed render quaternion + the latest
    // server velocity. See _updateKartVisuals() comments for detail.
    _updateKartVisuals(entry, dt, now);
    // Per-kart FX driven by latest schema state captured below in
    // onStateChange (entry._fxState is refreshed there each snapshot).
    if (entry.fx && entry._fxState) {
      entry._fxState.position.x = g.position.x;
      entry._fxState.position.y = g.position.y;
      entry._fxState.position.z = g.position.z;
      entry._fxState.quaternion.x = g.quaternion.x;
      entry._fxState.quaternion.y = g.quaternion.y;
      entry._fxState.quaternion.z = g.quaternion.z;
      entry._fxState.quaternion.w = g.quaternion.w;
      // Phase B4: for the LOCAL kart, override the input-driven FX
      // fields (throttle / brake / steer / drift intent) with the
      // freshest local input so wheels / exhaust / drift sparks react
      // instantly instead of lagging the server snapshot by RTT+interp
      // (~190\u2013300ms). Physics-derived fields (boostTimer, gloBurnoutT,
      // wheelGrounded, driftTier/Dir) keep their server values \u2014
      // those are computed by the authoritative simulation.
      if (entry.sid === mySid) {
        entry._fxState.throttleIn = input.throttle;
        entry._fxState.brakeIn = input.brake;
        entry._fxState.steerIn = input.steer;
        // driftActive stays a physics flag (server may reject if not grounded);
        // but bias it toward the user's intent so the visual responds on press.
        entry._fxState.driftActive = entry._fxState.driftActive || !!input.drift;
      }
      entry.fx.update(entry._fxState, dt);
    }
    if (entry.underglow) entry.underglow.update(dt, g);

    // Slice 4 — Star aura: pulsing rainbow torus spun around the kart.
    const efx = entry._effectState;
    if (efx) {
      const nowMs4 = Date.now();
      const starOn = (efx.starUntilMs || 0) > nowMs4;
      if (starOn && !entry.starAura) {
        const aura = new THREE.Mesh(
          new THREE.TorusGeometry(2.0 * S, 0.35 * S, 8, 32),
          new THREE.MeshStandardMaterial({
            color: 0xffd700, emissive: 0xffd700, emissiveIntensity: 2.0,
            transparent: true, opacity: 0.88, depthWrite: false,
          }),
        );
        entry.group.add(aura);
        entry.starAura = aura;
        entry.starAuraHue = 0;
      } else if (!starOn && entry.starAura) {
        entry.group.remove(entry.starAura);
        entry.starAura.geometry.dispose();
        entry.starAura.material.dispose();
        entry.starAura = null;
      }
      if (entry.starAura) {
        entry.starAuraHue = ((entry.starAuraHue || 0) + dt * 0.9) % 1;
        entry.starAura.material.color.setHSL(entry.starAuraHue, 1.0, 0.6);
        entry.starAura.material.emissive.setHSL(entry.starAuraHue, 1.0, 0.5);
        const pulse = 1 + 0.14 * Math.sin(Date.now() * 0.009);
        entry.starAura.scale.setScalar(pulse);
        entry.starAura.rotation.y += dt * 2.8;
        entry.starAura.rotation.z = Math.PI * 0.15;
      }
    }
  }
  // Spin pickup boxes.
  for (const { mesh, active } of pickupMeshes.values()) {
    if (active) mesh.rotation.y += dt * 1.6;
  }
  // Drive pickup-burst closures; they self-dispose by returning true.
  for (let i = pickupBursts.length - 1; i >= 0; i--) {
    if (pickupBursts[i](dt)) pickupBursts.splice(i, 1);
  }
  // Fade projectile FX.
  for (let i = fxBodies.length - 1; i >= 0; i--) {
    const fx = fxBodies[i];
    fx.life -= dt;
    fx.mesh.material.opacity = Math.max(0, fx.life);
    if (fx.life <= 0) {
      scene.remove(fx.mesh);
      fx.mesh.geometry.dispose();
      fx.mesh.material.dispose();
      fxBodies.splice(i, 1);
    }
  }
  // Slice 2 — spin active projectile meshes so they visually stand out.
  for (const { mesh } of projMeshes.values()) {
    mesh.rotation.y += dt * 3.8;
    mesh.rotation.x += dt * 1.6;
  }
  // Slice 3 — pulse + track blue-shell floor rings.
  for (const entry of blueShellRings.values()) {
    const tgt = ghosts.get(entry.targetId);
    if (tgt) {
      entry.mesh.position.x = tgt.group.position.x;
      entry.mesh.position.z = tgt.group.position.z;
    }
    const pulse = 0.88 + 0.24 * Math.sin(Date.now() * 0.009);
    entry.mesh.scale.setScalar(pulse);
    entry.mesh.material.opacity = 0.45 + 0.4 * Math.abs(Math.sin(Date.now() * 0.006));
  }
  // Slice 2 — decay hit-flash overlay.
  if (_hitFlashTimer > 0) {
    _hitFlashTimer -= dt;
    if (hud.hitFlash) {
      const t = Math.max(0, _hitFlashTimer / 0.35);
      hud.hitFlash.style.opacity = String(t);
    }
    if (_hitFlashTimer <= 0 && hud.hitFlash) hud.hitFlash.style.opacity = '0';
  }
  // Slice 2 — screen shake: offset camera target by random amount.
  if (_shakeTimer > 0) {
    _shakeTimer -= dt;
    if (_shakeTimer <= 0) { _shakeAmp = 0; }
  }
  // Slice 3 — update minimap at 15 Hz max (every ~66 ms) to cut canvas
  // 2D draw cost: minimap doesn't need 60 Hz refresh.
  if (roomRef && roomRef.state && (now - _lastMinimapDrawMs) >= 66) {
    _lastMinimapDrawMs = now;
    _drawMinimap(roomRef.state, mySid);
  }
  // Client-side proximity check → request pickup (server validates).
  const meEntry = mySid ? ghosts.get(mySid) : null;
  if (meEntry && roomRef) {
    const px = meEntry.group.position.x, pz = meEntry.group.position.z;
    for (const [id, p] of pickupMeshes.entries()) {
      if (!p.active) continue;
      const dx = p.mesh.position.x - px, dz = p.mesh.position.z - pz;
      if (dx * dx + dz * dz < PICKUP_PROXIMITY_MM * PICKUP_PROXIMITY_MM) {
        try { roomRef.send('pickupItem', { id }); } catch {}
      }
    }
  }
  // Camera follow: track our own ghost if known, else look at scene origin.
  const me = mySid ? ghosts.get(mySid) : null;
  if (me) {
    // Reuse pre-allocated vectors — no per-frame GC allocation.
    _camFwdVec.set(0, 0, 1).applyQuaternion(me.group.quaternion);
    _camTargetVec.copy(me.group.position)
      .addScaledVector(_camFwdVec, -14 * S)
      .add(_camUpOffset);
    camera.position.lerp(_camTargetVec, 0.12);
    // Slice 2 — apply screen shake offset to camera look-at point.
    const shakeX = _shakeAmp > 0 ? (Math.random() - 0.5) * 2 * _shakeAmp : 0;
    const shakeY = _shakeAmp > 0 ? (Math.random() - 0.5) * 2 * _shakeAmp : 0;
    _camLookAtVec.set(
      me.group.position.x + shakeX,
      me.group.position.y + 1 * S + shakeY,
      me.group.position.z,
    );
    camera.lookAt(_camLookAtVec);

    // ── Burnout camera punch ────────────────────────────────────
    // Drive off the LOCAL kart's broadcast burnout state. Edge-detect
    // gloBurnoutT 0 → positive (release) and engineExploded false →
    // true (overheat) for one-shot flash + FOV punch. While charging,
    // pull FOV in slightly so the release "snap" reads as a contrast.
    const fxs = me._fxState;
    if (fxs) {
      const gloT = +fxs.gloBurnoutT || 0;
      const exploded = !!fxs.engineExploded;
      const charging = !!fxs.chargingBurnout;
      // Rising edge: release boost just fired.
      if (gloT > 0 && _mpPrevGloBurnoutT <= 0) {
        // Charge magnitude is approximated by the initial gloT value:
        // gloT0 = 0.7 + 1.5 * (charge/6). t01 = (gloT0-0.7)/1.5 ∈ [0,1].
        const t01 = Math.max(0, Math.min(1, (gloT - 0.7) / 1.5));
        _mpBurnoutFlash = Math.max(_mpBurnoutFlash, 0.5 + 0.5 * t01);
        _mpBurnoutFovKick = Math.max(_mpBurnoutFovKick, 6.0 * t01);
      }
      // Engine overheat: bigger flash.
      if (exploded && !_mpPrevEngineExploded) {
        _mpBurnoutFlash = Math.max(_mpBurnoutFlash, 0.85);
        _mpBurnoutFovKick = Math.max(_mpBurnoutFovKick, 4.0);
      }
      // Charging anticipation: pull in FOV up to ~4° at full charge
      // (mirrors SP _burnoutFovKick = -stage * 4.5).
      if (charging && gloT <= 0 && !exploded) {
        const stage = 0.6; // can't read burnoutCharge from schema; use a steady target
        if (_mpBurnoutFovKick > -stage * 4.0) {
          _mpBurnoutFovKick = -stage * 4.0;
        }
      }
      _mpPrevGloBurnoutT = gloT;
      _mpPrevEngineExploded = exploded;
    }
    // Decay kick + flash toward 0; smooth FOV onto camera.
    _mpBurnoutFovKick *= Math.exp(-3.5 * dt);
    if (Math.abs(_mpBurnoutFovKick) < 0.02) _mpBurnoutFovKick = 0;
    _mpBurnoutFlash = Math.max(0, _mpBurnoutFlash - dt * 4.0);
    _mpBurnoutFovKickSm += (_mpBurnoutFovKick - _mpBurnoutFovKickSm) * (1 - Math.exp(-12 * dt));
    const targetFov = CAM_FOV_BASE + _mpBurnoutFovKickSm;
    camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-4.0 * dt));
    camera.updateProjectionMatrix();
    if (_mpBurnoutFlashEl) _mpBurnoutFlashEl.style.opacity = String(_mpBurnoutFlash);
  } else {
    camera.lookAt(0, 0, 0);
  }
  // Slice 4 — draw speed-lines overlay when local kart has an active boost.
  const _slMe = mySid && roomRef?.state?.karts?.get(mySid);
  const _slNow = Date.now();
  const _slBoost = !!_slMe && (
    (_slMe.boostUntilMs || 0) > _slNow ||
    (_slMe.bulletBillUntilMs || 0) > _slNow ||
    (_slMe.starUntilMs || 0) > _slNow
  );
  _drawSpeedLines(_slBoost, dt);
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ── Network ─────────────────────────────────────────────────────────
async function connect() {
  setStatus('loading track…', 'warn');
  // Prefer customTrackData from gameConfig; else fetch by trackId.
  let trackData = null;
  if (CUSTOM_TRACK_DATA) {
    try { trackData = JSON.parse(CUSTOM_TRACK_DATA); } catch { /* fall through */ }
  }
  if (!trackData) trackData = await fetchTrackData(TRACK_ID);
  if (!trackData) {
    setStatus('track unavailable', 'err');
    hud.track.textContent = '(none)';
    return;
  }
  // Use the async chunked builder — yields every 8 segments so the page
  // stays interactive while the track mesh is assembled. Also kicks off
  // the server join in parallel (join can proceed while meshes build;
  // the track is visible once joining is done in either order).
  const trackBuildPromise = buildTrackVisualsAsync(trackData);

  // B1 — Build physics descriptors OFF the critical path: start the
  // network join immediately, then build physics descriptors async so
  // the UI doesn't freeze waiting for physics setup before connecting.
  // Descriptors are ready before onStateChange needs them (first state
  // change arrives after network round-trip which is slower than the CPU work).
  setStatus('connecting…', 'warn');
  const client = new Client(REALTIME_URL);
  let room;
  try {
    const opts = {
      trackId: TRACK_ID,
      totalLaps: TOTAL_LAPS,
      playerName: PLAYER_NAME || undefined,
      playerColor: PLAYER_COLOR || undefined,
      playerKart: PLAYER_KART || undefined,
      gloEffect: LOCAL_GLO_EFFECT,
      gloColor: LOCAL_GLO_COLOR,
      gloColor2: LOCAL_GLO_COLOR2,
    };
    if (CUSTOM_TRACK_DATA) opts.customTrackData = CUSTOM_TRACK_DATA;
    if (WEAPON_POOL) opts.weaponPool = WEAPON_POOL;
    if (ROOM_CODE) { opts.lobbyCode = ROOM_CODE; opts.partyCode = ROOM_CODE; }
    room = await client.joinOrCreate('editor3_race_room', opts);
  } catch (err) {
    console.error('[mp-editor3] join failed', err);
    setStatus('join failed', 'err');
    return;
  }
  roomRef = room;
  mySid = room.sessionId;
  // Debug hooks for Playwright probes / browser devtools.
  if (typeof window !== 'undefined') {
    window.__roomRef = room;
    window.__mySid = mySid;
  }
  setStatus(`connected as ${mySid.slice(0, 6)}`, 'ok');

  // Await the chunked track-mesh build (already in progress) and then
  // build physics descriptors using idle time so the initial frames are
  // smooth. Both operations are off the hot path now.
  const { placementCount } = await trackBuildPromise;
  hud.track.textContent = `${trackData.track?.name || trackData.name || '(custom)'} (${placementCount} segs)`;
  if (hud.lap) hud.lap.textContent = `0 / ${TOTAL_LAPS}`;
  // B1 physics descriptors — run after visuals are built (CPU is idle).
  setTimeout(() => { _trackPhysDesc = buildTrackPhysicsDescriptors(trackData); }, 0);
  // Surface lobby code and laps the moment we know our session id.
  if (overlays.lobbyCode) overlays.lobbyCode.textContent = ROOM_CODE || '— OPEN —';
  if (overlays.lobbyLaps) overlays.lobbyLaps.textContent = String(TOTAL_LAPS);
  if (overlays.lobbyNetStatus) overlays.lobbyNetStatus.textContent = 'connected';
  if (overlays.lobbyTrack)
    overlays.lobbyTrack.textContent = hud.track ? hud.track.textContent : '—';
  if (overlays.pauseTrack && hud.track)
    overlays.pauseTrack.textContent = hud.track.textContent;
  if (overlays.lobbyStartBtn) overlays.lobbyStartBtn.disabled = false;

  // Auto-start support for Playwright probes / headless smoke tests.
  // The probe sets ?autostart=1 (or runs under webdriver); we click
  // the lobby Start button on its behalf so the lobby overlay isn't
  // a regression-blocker for existing 2p drive probes.
  const autostart = params.get('autostart') === '1'
    || (typeof navigator !== 'undefined' && navigator.webdriver);
  if (autostart) {
    setTimeout(() => beginRace(), 250);
  }

  // Schema 3.x: use room.onStateChange (kart.onChange is not available client-side).
  let joinCount = 0;
  room.onStateChange((state) => {
    if (!state) return;
    // Karts: ensure ghosts + sync targets + fx state.
    state.karts.forEach((kart, sid) => {
      let entry = ghosts.get(sid);
      if (!entry) entry = ensureGhost(sid, joinCount++, kart);
      entry.target.x = kart.x; entry.target.y = kart.y; entry.target.z = kart.z;
      entry.target.qx = kart.qx; entry.target.qy = kart.qy; entry.target.qz = kart.qz; entry.target.qw = kart.qw;
      // Phase B3: feed the snapshot buffer used by tick() for proper
      // snapshot interpolation. We push on every state delivery; tick()
      // samples at (now - interpDelay) and lerps between two snapshots.
      _pushSnapshot(entry, kart, performance.now());
      // Capture the broadcast effect-driving state for this kart so
      // the render-loop fx update reflects the latest tick. Allocate
      // once and reuse to avoid GC pressure.
      if (!entry._fxState) {
        entry._fxState = {
          position: { x: 0, y: 0, z: 0 },
          quaternion: { x: 0, y: 0, z: 0, w: 1 },
          velocity: { x: 0, y: 0, z: 0 },
          driftActive: false, driftTier: 0, driftDir: 0,
          boostTimer: 0, gloBurnoutT: 0, chargingBurnout: false,
          wheelGrounded: 0, throttleIn: 0, brakeIn: 0, steerIn: 0,
        };
      }
      const fs = entry._fxState;
      fs.velocity.x = kart.vx || 0; fs.velocity.y = kart.vy || 0; fs.velocity.z = kart.vz || 0;
      fs.driftActive = !!kart.driftActive;
      fs.driftTier = kart.driftTier | 0;
      fs.driftDir = kart.driftDir | 0;
      fs.boostTimer = +kart.boostTimer || 0;
      fs.gloBurnoutT = +kart.gloBurnoutT || 0;
      fs.chargingBurnout = !!kart.chargingBurnout;
      fs.wheelGrounded = kart.wheelGrounded | 0;
      fs.throttleIn = +kart.throttleIn || 0;
      fs.brakeIn = +kart.brakeIn || 0;
      fs.steerIn = +kart.steerIn || 0;
      // Slice 4 — cache combat effect timestamps for star/boost VFX in tick().
      if (!entry._effectState) entry._effectState = { starUntilMs: 0, bulletBillUntilMs: 0, boostUntilMs: 0 };
      entry._effectState.starUntilMs       = kart.starUntilMs       || 0;
      entry._effectState.bulletBillUntilMs = kart.bulletBillUntilMs || 0;
      entry._effectState.boostUntilMs      = kart.boostUntilMs      || 0;
    });
    // Remove ghosts whose karts left.
    for (const sid of [...ghosts.keys()]) {
      if (!state.karts.get(sid)) removeGhost(sid);
    }
    if (hud.players) hud.players.textContent = String(state.karts.size);
    if (overlays.pausePlayers) overlays.pausePlayers.textContent = String(state.karts.size);
    // Refresh lobby roster while pre-race overlay is up.
    if (!raceStarted) renderLobbyPlayers(state);
    // Pickups.
    state.pickups.forEach((p, id) => { ensurePickupMesh(id, p.x, p.y, p.z, !!p.active); });
    // Slice 2 — projectile mesh sync.
    if (state.projectiles) {
      const liveKeys = new Set();
      state.projectiles.forEach((proj, key) => {
        liveKeys.add(key);
        const mesh = ensureProjMesh(key, proj.subType || 'default');
        mesh.position.set(proj.px || 0, proj.py || 0, proj.pz || 0);
      });
      // Remove stale projectile meshes.
      for (const k of projMeshes.keys()) {
        if (!liveKeys.has(k)) removeProjMesh(k);
      }
    }
    // Local kart HUD (lap, weapon) + audio.
    const me = state.karts.get(mySid);
    if (me) {
      if (hud.lap) hud.lap.textContent = `${me.lap || 0} / ${state.totalLaps || TOTAL_LAPS}`;
      if (overlays.pauseLap) overlays.pauseLap.textContent = `${me.lap || 0} / ${state.totalLaps || TOTAL_LAPS}`;
      if (hud.weapon) hud.weapon.textContent = me.weapon2 ? `${me.weapon2} ×${me.ammo2}` : '—';
      if (hud.reserve) hud.reserve.textContent = me.weapon3 ? `${me.weapon3} ×${me.ammo3}` : '—';
      // Slice 2 — weapon slot panel.
      _updateWeaponSlot('main',    me.weapon2 || null, me.ammo2 || 0);
      _updateWeaponSlot('reserve', me.weapon3 || null, me.ammo3 || 0);
      // Drive audio rig from the local kart's authoritative state so
      // engine pitch / skid loop / boost SFX track exactly what the
      // server-side physics computed.
      if (kartAudio) {
        const speedMs = Math.hypot(me.vx || 0, me.vy || 0, me.vz || 0) / WORLD_UNITS_PER_M;
        const grounded = (me.wheelGrounded | 0) !== 0;
        // Lateral component of velocity in m/s (chassis-frame).
        const fx2 = 2 * ((me.qw || 1) * (me.qy || 0) + (me.qx || 0) * (me.qz || 0));
        const fz2 = 1 - 2 * ((me.qy || 0) * (me.qy || 0) + (me.qx || 0) * (me.qx || 0));
        const _ang = Math.atan2(fx2, fz2);
        const fwdX = Math.sin(_ang), fwdZ = Math.cos(_ang);
        const lat = Math.abs((me.vx || 0) * fwdZ - (me.vz || 0) * fwdX) / WORLD_UNITS_PER_M;
        const fwdMs = ((me.vx || 0) * fwdX + (me.vz || 0) * fwdZ) / WORLD_UNITS_PER_M;
        const braking = (me.brakeIn || 0) > 0.5 && fwdMs > 5;
        kartAudio.update({
          speed: speedMs,
          throttle: me.throttleIn || 0,
          lateralSpeed: lat,
          braking,
          grounded,
          drifting: !!me.driftActive,
          charging: !!me.chargingBurnout,
          boosting: (me.boostTimer || 0) > 0 || (me.gloBurnoutT || 0) > 0,
          exploded: !!me.engineExploded,
        });
        const tier = me.driftTier | 0;
        if (tier > _prevDriftTier) {
          try { kartAudio.playOneShot('miniTurbo', { gain: 0.7 }); } catch {}
        }
        _prevDriftTier = tier;
      }
    }
    // Slice 2 — PvP scores (top corners) + match timer.
    if (hud.pvpScoreMe || hud.pvpScoreOpp) {
      let myScore = 0, oppScore = 0, oppName = 'Opp';
      state.karts.forEach((ks, sid) => {
        if (sid === mySid)  { myScore = ks.score || 0; }
        else                { oppScore = ks.score || 0; oppName = sid.slice(0, 6); }
      });
      if (hud.pvpScoreMe)  hud.pvpScoreMe.textContent  = myScore;
      if (hud.pvpScoreOpp) hud.pvpScoreOpp.textContent = oppScore;
      if (hud.pvpLabelOpp) hud.pvpLabelOpp.textContent = oppName;
    }
    if (hud.pvpTimer && state.matchSecondsLeft !== undefined) {
      const s = state.matchSecondsLeft || 0;
      const mm = Math.floor(s / 60).toString().padStart(1, '0');
      const ss = (s % 60).toString().padStart(2, '0');
      hud.pvpTimer.textContent = `${mm}:${ss}`;
      hud.pvpTimer.classList.toggle('danger', s <= 30);
    }
    // Slice 3 — HP bar + coin counter from local kart state.
    if (me) {
      const hp = Math.max(0, Math.min(100, me.hp !== undefined ? me.hp : 100));
      const coins = me.coins || 0;
      if (hud.hpFill) {
        hud.hpFill.style.width = hp + '%';
        hud.hpFill.style.background = hp > 50
          ? 'linear-gradient(90deg,#22ff88,#00e5ff)'
          : hp > 20
          ? 'linear-gradient(90deg,#ffcc00,#ff8800)'
          : 'linear-gradient(90deg,#ff3333,#ff6600)';
      }
      if (hud.hpVal)    hud.hpVal.textContent = hp;
      if (hud.coinCount) hud.coinCount.textContent = coins;
      // Active-effect readout: include V8 buffs.
      if (hud.pvpEffect) {
        const nowMs2 = Date.now();
        let effectText2 = '';
        if      ((me.starUntilMs || 0) > nowMs2)          effectText2 = '⭐ STAR';
        else if ((me.bulletBillUntilMs || 0) > nowMs2)    effectText2 = '🚀 BULLET BILL';
        else if ((me.doubleDmgUntilMs || 0) > nowMs2)     effectText2 = '✖2 DOUBLE DMG';
        else if (me.shieldActive)                          effectText2 = '🛡 SHIELD';
        else if ((me.boostUntilMs || 0) > nowMs2)         effectText2 = '🍄 BOOST';
        hud.pvpEffect.textContent = effectText2;
      }
    }

    // ── B1 full client-side physics prediction ───────────────────────
    // 1) Seed the prediction bridge on the very first local-kart state.
    // 2) Every subsequent update: compare server position vs prediction;
    //    reconcile (server-correct + replay un-acked inputs) if diverged.
    if (me && _trackPhysDesc) {
      if (!_predBridgeSeeded) {
        _predBridgeSeeded = true;
        // Derive spawn yaw from the server quaternion.
        const spawnYaw = Math.atan2(
          2 * ((me.qw || 1) * (me.qy || 0) + (me.qx || 0) * (me.qz || 0)),
          1 - 2 * ((me.qy || 0) ** 2 + (me.qx || 0) ** 2)
        );
        _predBridge = createPhysicsBridge({
          staticBodies: _trackPhysDesc.staticBodies,
          drivableCells: new Set(),
          tile: TILE * S,
          spawnPos: { x: me.x, y: me.y, z: me.z },
          spawnRot: spawnYaw,
        });
      } else if (_predBridge && _predBridge.snapCount > 0) {
        // Gather the current prediction position for divergence test.
        _predBridge.interpolate(performance.now());
        const pp = _predBridge.chassisBody.interpolatedPosition;
        const dx = me.x - pp.x;
        const dy = me.y - pp.y;
        const dz = me.z - pp.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        // Reconcile when server and prediction are more than 0.5 m apart.
        if (dist > 500) {
          _reconcileCount++;
          if (dist > _reconcileMaxDeltaMm) _reconcileMaxDeltaMm = dist;
          // Collect all inputs the server has not acknowledged yet.
          const ackedSeq = me.lastSeq || 0;
          const replayInputs = [];
          for (const [seq, ikeys] of _inputHistory) {
            if (seq > ackedSeq) replayInputs.push({ seq, keys: ikeys });
          }
          replayInputs.sort((a, b) => a.seq - b.seq);
          _predBridge.reconcile({
            x: me.x, y: me.y, z: me.z,
            qx: me.qx || 0, qy: me.qy || 0, qz: me.qz || 0, qw: me.qw || 1,
            vx: me.vx || 0, vy: me.vy || 0, vz: me.vz || 0,
            wx: 0, wy: 0, wz: 0,
            replayInputs,
          });
        }
      }
    }
  });

  room.onMessage('itemReceived', (msg) => {
    console.log('[mp-editor3] item', msg);
    try { ensureKartAudio(); kartAudio.playOneShot('itemGet', { gain: 0.9 }); } catch {}
  });
  room.onMessage('secondaryWeaponSwapped', (msg) => {
    console.log('[mp-editor3] swap', msg);
  });
  room.onMessage('projectileFired', (msg) => {
    spawnProjectileFx(msg.x, msg.y, msg.z, msg.ownerId === mySid ? 0x00e5ff : 0xff4d6d);
  });
  room.onMessage('lapComplete', (msg) => {
    if (msg.sessionId === mySid) setStatus(`lap ${msg.lap} / ${msg.totalLaps}`, 'ok');
  });
  room.onMessage('kartFinished', (msg) => {
    if (msg.sessionId === mySid) setStatus(`finished — place ${msg.place}`, 'ok');
  });
  room.onMessage('raceComplete', () => {
    setStatus('race complete', 'ok');
  });
  // Phase F1 — server respawned this kart (manual R or fall-through).
  // Snap the local visual immediately so the player doesn't see a 100ms
  // teleport-trail; clear the snapshot buffer so the interpolator
  // doesn't try to LERP across the discontinuity.
  room.onMessage('kartRespawned', (msg) => {
    const entry = ghosts.get(msg.sessionId);
    if (entry) {
      entry.snapshots.length = 0;
      if (entry.group) {
        entry.group.position.set(msg.x, msg.y, msg.z);
      }
      entry.target.x = msg.x; entry.target.y = msg.y; entry.target.z = msg.z;
      // Reset visual rig state so the kart doesn't carry roll/pitch
      // or velocity-derived bob into the respawn pose. Without this
      // a respawn from a wreck mid-air leaves the model tilted for
      // ~half a second after the chassis snaps upright.
      entry.smoothedRoll = 0;
      entry.smoothedPitch = 0;
      entry.suspensionBob = 0;
      entry.lastVx = 0; entry.lastVy = 0; entry.lastVz = 0;
      entry.lastVelT = performance.now();
      if (entry.kartModel) {
        entry.kartModel.position.y = entry.kartBaseY;
        entry.kartModel.rotation.set(0, 0, 0);
      }
    }
    if (msg.sessionId === mySid) {
      const reason = msg.reason === 'fellOff' ? 'Fell off — respawning' : 'Respawn';
      setStatus(reason, 'ok');
    }
  });

  // ── Slice 2: weapon + combat message handlers ──────────────────────────
  room.onMessage('projectileSpawned', (msg) => {
    // `msg.key` matches the ProjectileState MapSchema key.
    // Pre-warm the mesh so it's ready before the first onStateChange arrives.
    if (msg.key) ensureProjMesh(msg.key, msg.subType || 'default');
    try { ensureKartAudio(); kartAudio.playOneShot('shoot', { gain: 0.7 }); } catch {}
  });

  room.onMessage('projectileExploded', (msg) => {
    // Remove mesh + spawn burst VFX.
    if (msg.key) removeProjMesh(msg.key);
    // Remove blue shell floor ring if present
    if (msg.key && blueShellRings.has(msg.key)) {
      const entry = blueShellRings.get(msg.key);
      scene.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      entry.mesh.material.dispose();
      blueShellRings.delete(msg.key);
    }
    const col = PROJ_COLORS[msg.subType] ?? PROJ_COLORS.default;
    spawnProjectileFx(msg.x || 0, msg.y || 0, msg.z || 0, col);
    if (msg.subType === 'bobomb' || msg.subType === 'blue_shell') {
      spawnProjectileFx((msg.x || 0) + 0.5 * S, msg.y || 0, (msg.z || 0) + 0.5 * S, 0xffaa00);
      spawnProjectileFx((msg.x || 0) - 0.5 * S, msg.y || 0, (msg.z || 0) - 0.5 * S, 0xff6600);
    }
    try { ensureKartAudio(); kartAudio.playOneShot('explode_item', { gain: 0.9 }); } catch {}
  });

  room.onMessage('shellBounced', () => {
    try { ensureKartAudio(); kartAudio.playOneShot('shellBounce', { gain: 0.65 }); } catch {}
  });

  room.onMessage('kartImpact', (msg) => {
    // msg: { targetId, sourceId, subType, x, y, z }
    if (msg.targetId === mySid) {
      triggerHitFlash();
      triggerScreenShake(msg.subType === 'blue_shell' ? 1.2 : 0.8,
                         msg.subType === 'blue_shell' ? 0.6 : 0.4);
      showFloater('💥 HIT!', '#ff4d6d');
      try { ensureKartAudio(); kartAudio.playOneShot('hitTaken', { gain: 1.0 }); } catch {}
    } else if (msg.sourceId === mySid) {
      showFloater('+1', '#00e5ff');
    }
    if (msg.subType === 'banana' && msg.targetId === mySid) {
      try { ensureKartAudio(); kartAudio.playOneShot('spinout', { gain: 0.9 }); } catch {}
    }
  });

  room.onMessage('effectApplied', (msg) => {
    if (msg.sessionId !== mySid) return;
    const icons = {
      star: '⭐ STAR!', boost: '🍄 BOOST!', bullet_bill: '🚀 BULLET BILL!',
      mushroom: '🍄 BOOST!', golden_mushroom: '🍄🍄 SHROOM!',
      v8_shield: '🛡 SHIELD!', shield_broken: '💔 SHIELD BROKEN',
      v8_repair: '💊 REPAIRED!', v8_double_dmg: '✖2 POWER UP!',
    };
    const col = {
      star: '#ffd166', boost: '#ff6b35', bullet_bill: '#00e5ff',
      mushroom: '#ff6b35', golden_mushroom: '#ffaa00',
      v8_shield: '#88ccff', shield_broken: '#ff4d4d',
      v8_repair: '#22ff88', v8_double_dmg: '#ff3333',
    };
    showFloater(icons[msg.effect] || msg.effect, col[msg.effect] || '#fff');
    if (msg.effect === 'star')        try { ensureKartAudio(); kartAudio.playOneShot('starLoop',  { gain: 0.8, loop: false }); } catch {}
    if (msg.effect === 'bullet_bill') try { ensureKartAudio(); kartAudio.playOneShot('billLoop',  { gain: 0.8, loop: false }); } catch {}
    if (msg.effect === 'v8_shield')   try { ensureKartAudio(); kartAudio.playOneShot('shoot',     { gain: 0.5 }); } catch {}
    if (msg.effect === 'v8_repair')   try { ensureKartAudio(); kartAudio.playOneShot('itemGet',   { gain: 0.9 }); } catch {}
  });

  room.onMessage('blueShellWarning', (msg) => {
    // Show warning floater to target
    if (msg.targetId === mySid) {
      showFloater('🔵 INCOMING!', '#00aaff');
      try { ensureKartAudio(); kartAudio.playOneShot('warningBlue', { gain: 1.0 }); } catch {}
    }
    // Spawn a pulsing floor ring at the target kart's position
    const targetGhost = ghosts.get(msg.targetId);
    if (targetGhost && !blueShellRings.has(msg.projKey)) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(1.8 * S, 2.4 * S, 32),
        new THREE.MeshBasicMaterial({
          color: 0x00aaff, side: THREE.DoubleSide,
          transparent: true, opacity: 0.7, depthWrite: false,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(targetGhost.group.position);
      ring.position.y += 0.05 * S;
      scene.add(ring);
      blueShellRings.set(msg.projKey, { mesh: ring, targetId: msg.targetId });
    }
  });

  room.onMessage('matchOver', (msg) => {
    // Freeze input.
    inputLocked = true;
    // Build results overlay.
    const scores = msg.scores || {};
    let winnerSid = null, highScore = -1;
    for (const [sid, sc] of Object.entries(scores)) {
      if (sc > highScore) { highScore = sc; winnerSid = sid; }
    }
    if (hud.resultsTitle) hud.resultsTitle.textContent = winnerSid === mySid ? '🏆 VICTORY!' : '💀 DEFEAT';
    if (hud.resultsScores) {
      hud.resultsScores.innerHTML = '';
      for (const [sid, sc] of Object.entries(scores)) {
        const block = document.createElement('div');
        const isWinner = sid === winnerSid;
        const isMe = sid === mySid;
        block.className = 'results-score-block' + (isWinner ? ' winner' : '');
        block.innerHTML = `
          <div class="rs-crown">${isWinner ? '👑' : ''}</div>
          <div class="rs-label">${isMe ? 'You' : 'Opponent'}</div>
          <div class="rs-num">${sc}</div>
          <div class="rs-name">${sid.slice(0, 8)}</div>`;
        hud.resultsScores.appendChild(block);
      }
    }
    if (hud.results) hud.results.classList.remove('hidden');
    // SFX: victory fanfare for winner, consolation for loser.
    if (winnerSid === mySid) {
      try { ensureKartAudio(); kartAudio.playOneShot('raceFinish',     { gain: 1.0 }); } catch {}
    } else {
      try { ensureKartAudio(); kartAudio.playOneShot('raceFinishLoss', { gain: 0.85 }); } catch {}
    }
    // Rematch / Exit buttons.
    const rematch = document.getElementById('results-rematch');
    const exit    = document.getElementById('results-exit');
    if (rematch) rematch.onclick = () => {
      if (hud.results) hud.results.classList.add('hidden');
      // Tell the server to reset the match for everyone.
      if (roomRef) try { roomRef.send('rematch'); } catch {}
    };
    if (exit)    exit.onclick    = () => { window.location.href = '/'; };
  });

  // Slice 4 — match reset: server reset all state, restart countdown for all clients.
  room.onMessage('matchReset', () => {
    if (hud.pvpTimer) { hud.pvpTimer.textContent = '3:00'; hud.pvpTimer.classList.remove('danger'); }
    if (hud.pvpScoreMe)  hud.pvpScoreMe.textContent  = '0';
    if (hud.pvpScoreOpp) hud.pvpScoreOpp.textContent = '0';
    raceStarted = false;
    inputLocked = true;
    startCountdown(() => { inputLocked = false; });
  });

  // Slice 4 — pit-fall penalty notification.
  room.onMessage('penaltyApplied', (msg) => {
    if (msg.sessionId === mySid && msg.reason === 'fellOff') {
      showFloater('💀 -1 FELL OFF!', '#ff4d4d');
    }
  });

  // Input send loop (30Hz).
  setInterval(() => {
    pollInput();
    input.seq++;
    try {
      room.send('input', { seq: input.seq, throttle: input.throttle, brake: input.brake, steer: input.steer, drift: input.drift });
    } catch { /* dropped frame */ }

    // B1 — also drive the local prediction bridge and store in history.
    if (_predBridge && _predBridgeSeeded) {
      const ikeys = {
        w:     input.throttle > 0.5,
        s:     input.throttle < -0.5,
        a:     input.steer    < -0.3,
        d:     input.steer    >  0.3,
        space: input.brake    > 0.5,
        drift: !!input.drift,
      };
      _predBridge.sendKeys(ikeys);
      _inputHistory.set(input.seq, ikeys);
      // Evict oldest entry if ring buffer is full.
      if (_inputHistory.size > _INPUT_HISTORY_MAX) {
        _inputHistory.delete(_inputHistory.keys().next().value);
      }
    }
  }, 1000 / SEND_HZ);

  // Lightweight ping (round-trip via state — server stamps lastSeq).
  setInterval(() => {
    const me = mySid ? room.state.karts.get(mySid) : null;
    if (!me) return;
    const drift = input.seq - me.lastSeq;
    if (hud.ping) hud.ping.textContent = `${drift} seq behind`;
    lastPing = drift;
    // Phase B3: feed the adaptive interp delay. drift is in input frames at
    // SEND_HZ, convert to ms and treat as a coarse RTT proxy. Maintain an
    // EWMA so jitter spikes don't yank the ghost interp window.
    const sampleMs = Math.max(0, drift) * (1000 / SEND_HZ);
    const prev = _netRttMs;
    _netRttMs = prev * 0.8 + sampleMs * 0.2;
    _netJitterMs = _netJitterMs * 0.8 + Math.abs(sampleMs - prev) * 0.2;
    // Phase B5: publish a compact network snapshot on window.__gloDebug
    // so the online-feel-probe Playwright harness can assert latency,
    // ghost teleport count, and reconcile correction without scraping
    // the diag overlay.
    try {
      const ghostCount = ghosts.size;
      let snapDepth = 0;
      for (const g of ghosts.values()) snapDepth += g.snapshots?.length || 0;
      window.__gloDebug = window.__gloDebug || {};
      window.__gloDebug.network = {
        rttMs: _netRttMs,
        jitterMs: _netJitterMs,
        interpDelayMs: _adaptiveInterpDelayMs(),
        sendHz: SEND_HZ,
        seqBehind: drift,
        ghostCount,
        avgSnapDepth: ghostCount ? (snapDepth / ghostCount) : 0,
        // B1 reconcile diagnostics — assertions in the B5 probe harness.
        reconcileCount: _reconcileCount,
        reconcileMaxDeltaMm: _reconcileMaxDeltaMm,
        predBridgeReady: _predBridgeSeeded && !!_predBridge,
        ts: Date.now(),
      };
    } catch { /* probe-only diagnostics */ }
    // Phase E2: surface the live network state on the diagnostics overlay.
    if (_diagOverlay.isVisible()) {
      const ghostCount = ghosts.size;
      let snapDepth = 0;
      for (const g of ghosts.values()) snapDepth += g.snapshots?.length || 0;
      _diagOverlay.update([
        `\u25b6 GLO-KARTS NET DIAG  [\\\` to toggle]`,
        `RTT (proxy)     ${_netRttMs.toFixed(1).padStart(6)} ms`,
        `Jitter (EWMA)   ${_netJitterMs.toFixed(1).padStart(6)} ms`,
        `Interp delay    ${_adaptiveInterpDelayMs().toFixed(0).padStart(6)} ms`,
        `Snapshot depth  ${(ghostCount ? (snapDepth / ghostCount) : 0).toFixed(1).padStart(6)} (\u00d7${ghostCount})`,
        `Send rate       ${SEND_HZ.toString().padStart(6)} Hz`,
        `Seq behind      ${drift.toString().padStart(6)}`,
        `B1 pred bridge  ${_predBridgeSeeded ? 'READY' : 'INIT  '}`,
        `Reconciles      ${_reconcileCount.toString().padStart(6)}`,
        `Max delta       ${(_reconcileMaxDeltaMm / 1000).toFixed(2).padStart(6)} m`,
      ]);
    }
  }, 1000);

  room.onLeave(() => setStatus('disconnected', 'err'));
  room.onError((code, msg) => setStatus(`error ${code}: ${msg}`, 'err'));
}

connect();
