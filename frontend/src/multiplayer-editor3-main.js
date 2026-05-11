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
import { Client } from 'colyseus.js';
import { buildSegmentMesh } from './editor3/segment-builder.js';
import { SEGMENTS, TILE } from './editor3/segments.js';
import { WORLD_UNITS_PER_M } from './editor3/units.js';
import { cloneKart, resolveKartWheels } from './editor3/kart-loader.js';
import { DEFAULT_KART_ID, KART_BY_ID } from './editor3/kart-catalog.js';
import { KartFxRig, spawnPickupBurst } from './editor3/kart-fx-rig.js';
import { createKartUnderglow, DEFAULT_GLO_EFFECT, DEFAULT_GLO_COLOR, DEFAULT_GLO_COLOR2 } from './kart-glo.js';

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
    // Mirrors SP play-main offset, plus the cannon-es suspension rest
    // length (MP physics has compressible wheels; SP does not).
    kart.position.y = -KART_VISUAL_DROP_MM;
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

// ── Render loop additions ───────────────────────────────────────────
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
  const tickN = () => {
    n--;
    if (n <= 0) {
      if (overlays.countdownNum) overlays.countdownNum.textContent = 'GO!';
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
  // throttle ramp over ~167 ms \u2014 identical to SP playtest. A second
  // client-side ramp here was producing ~530 ms total throttle delay
  // vs SP, breaking SP\u2194MP feel parity. Visual smoothing for body roll /
  // wheel steer lives in `_updateKartVisuals` (entry.smoothedSteer
  // low-pass), so the wheels and chassis still look weighted even
  // though the wire-level intent is binary.
  input.steer = (left ? -1 : 0) + (right ? 1 : 0);
  input.throttle = fwd ? 1 : (back ? -1 : 0);
  input.brake = brake ? 1 : 0;
  input.drift = drift;
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
  const steerAngle = entry.smoothedSteer * VISUAL_STEER_LOCK_RAD;

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
        }
      }
      // Frame-rate-independent exponential smoothing toward the
      // (predicted) target. ALPHA picks ~LERP at 60 fps but stays
      // well-behaved at 30 / 144 / 240 fps (no over-shoot).
      const POS_RATE = 12; // 1/s; e^(-12*0.0167) \u2248 0.82, i.e. ~18% per 60 fps frame
      const ROT_RATE = 18;
      const aPos = 1 - Math.exp(-POS_RATE * dt);
      const aRot = 1 - Math.exp(-ROT_RATE * dt);
      g.position.x += (tx - g.position.x) * aPos;
      g.position.y += (ty - g.position.y) * aPos;
      g.position.z += (tz - g.position.z) * aPos;
      _tmpQuatA.set(tqx, tqy, tqz, tqw);
      g.quaternion.slerp(_tmpQuatA, aRot);
    }
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
    const targetCam = new THREE.Vector3(
      me.group.position.x - 14 * S * Math.sin(0),
      me.group.position.y + 8 * S,
      me.group.position.z - 14 * S * Math.cos(0),
    );
    // Behind-the-kart: derive heading from quaternion.
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(me.group.quaternion);
    targetCam.copy(me.group.position).addScaledVector(fwd, -14 * S).add(new THREE.Vector3(0, 8 * S, 0));
    camera.position.lerp(targetCam, 0.12);
    camera.lookAt(me.group.position.x, me.group.position.y + 1 * S, me.group.position.z);

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
  const { placementCount } = buildTrackVisuals(trackData);
  hud.track.textContent = `${trackData.track?.name || trackData.name || '(custom)'} (${placementCount} segs)`;
  if (hud.lap) hud.lap.textContent = `0 / ${TOTAL_LAPS}`;

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
    // Local kart HUD (lap, weapon) + audio.
    const me = state.karts.get(mySid);
    if (me) {
      if (hud.lap) hud.lap.textContent = `${me.lap || 0} / ${state.totalLaps || TOTAL_LAPS}`;
      if (overlays.pauseLap) overlays.pauseLap.textContent = `${me.lap || 0} / ${state.totalLaps || TOTAL_LAPS}`;
      if (hud.weapon) hud.weapon.textContent = me.weapon2 ? `${me.weapon2} ×${me.ammo2}` : '—';
      if (hud.reserve) hud.reserve.textContent = me.weapon3 ? `${me.weapon3} ×${me.ammo3}` : '—';
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
  });

  room.onMessage('itemReceived', (msg) => {
    console.log('[mp-editor3] item', msg);
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

  // Input send loop (30Hz).
  setInterval(() => {
    pollInput();
    input.seq++;
    try {
      room.send('input', { seq: input.seq, throttle: input.throttle, brake: input.brake, steer: input.steer, drift: input.drift });
    } catch { /* dropped frame */ }
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
      ]);
    }
  }, 1000);

  room.onLeave(() => setStatus('disconnected', 'err'));
  room.onError((code, msg) => setStatus(`error ${code}: ${msg}`, 'err'));
}

connect();
