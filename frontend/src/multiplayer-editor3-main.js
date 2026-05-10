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
import { cloneKart } from './editor3/kart-loader.js';
import { DEFAULT_KART_ID } from './editor3/kart-catalog.js';
import { KartFxRig, spawnPickupBurst } from './editor3/kart-fx-rig.js';

// Match the shared physics module so the visual offset for the cloned
// kart GLB places the wheels on the contact patch instead of leaving
// the chassis hovering above the road. Mirrors SP play-main.js.
const CHASSIS_HY_MM = 0.3 * WORLD_UNITS_PER_M;
import { createKartAudio, STD_KIT } from './editor3/kart-audio.js';

const S = WORLD_UNITS_PER_M;
const SEND_HZ = 60;
const TUTORIAL_LOOP_ID = '11111111-1111-1111-1111-111111111111';
const PEER_COLORS = [0xff3aa1, 0x00e5ff, 0xffd166, 0x06d6a0, 0xff8c42, 0x9d4edd, 0x118ab2, 0xef476f];

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
const PLAYER_COLOR = (GAME_CONFIG && GAME_CONFIG.localPlayerColor) || sessionStorage.getItem('playerColor') || '';
const PLAYER_KART = (GAME_CONFIG && GAME_CONFIG.localPlayerKart) || sessionStorage.getItem('playerKart') || DEFAULT_KART_ID;
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
    mesh.rotation.y = ((p.r || 0) % 4) * (Math.PI / 2);
    root.add(mesh);
  }
  scene.add(root);
  return { root, placementCount: placements.length };
}

// ── Kart ghosts ─────────────────────────────────────────────────────
const ghosts = new Map(); // sessionId -> { group, target:{x,y,z,qx,qy,qz,qw}, color }

function pickColor(idx) { return PEER_COLORS[idx % PEER_COLORS.length]; }

function ensureGhost(sid, idx) {
  if (ghosts.has(sid)) return ghosts.get(sid);
  const color = pickColor(idx);
  const group = new THREE.Group();
  // placeholder while GLB loads — sit at chassis center (y = 0 in
  // group-local) so the swap to the GLB model doesn't pop visually.
  const placeholder = new THREE.Mesh(
    new THREE.BoxGeometry(1.2 * S, 0.6 * S, 2.0 * S),
    new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.55 }),
  );
  placeholder.castShadow = true;
  placeholder.position.y = 0;
  group.add(placeholder);
  scene.add(group);
  cloneKart(DEFAULT_KART_ID, color).then((kart) => {
    // Drop the GLB so the kart's wheels sit on the contact patch.
    // The kart template has y = 0 at the chassis bottom, so shifting
    // by -CHASSIS_HY puts the chassis bottom at the cannon body's
    // bottom (where the wheel rays originate). Without this offset
    // the kart visually floats ~30 cm above the road. Mirrors SP.
    kart.position.y = -CHASSIS_HY_MM;
    group.remove(placeholder);
    placeholder.geometry.dispose();
    placeholder.material.dispose();
    group.add(kart);
  }).catch(() => { /* keep placeholder */ });
  // Per-kart FX rig: skid trails, drift smoke, drift sparks, boost
  // flames, burnout puffs. Driven by broadcast schema fields each
  // frame so remote ghosts visibly drift / boost / charge identically
  // to the SP playtest experience.
  const fx = new KartFxRig({ scene, gloColor: color });
  const entry = {
    group,
    target: { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 },
    color, fx,
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
  input.throttle = fwd ? 1 : 0;
  input.brake = brake ? 1 : (back ? 0.4 : 0);
  input.steer = (left ? -1 : 0) + (right ? 1 : 0);
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

function tick(now) {
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  // Smooth all ghosts toward server target.
  for (const entry of ghosts.values()) {
    const g = entry.group;
    const t = entry.target;
    g.position.x += (t.x - g.position.x) * LERP;
    g.position.y += (t.y - g.position.y) * LERP;
    g.position.z += (t.z - g.position.z) * LERP;
    g.quaternion.slerp(new THREE.Quaternion(t.qx, t.qy, t.qz, t.qw), LERP);
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
      entry.fx.update(entry._fxState, dt);
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
      if (!entry) entry = ensureGhost(sid, joinCount++);
      entry.target.x = kart.x; entry.target.y = kart.y; entry.target.z = kart.z;
      entry.target.qx = kart.qx; entry.target.qy = kart.qy; entry.target.qz = kart.qz; entry.target.qw = kart.qw;
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
  }, 1000);

  room.onLeave(() => setStatus('disconnected', 'err'));
  room.onError((code, msg) => setStatus(`error ${code}: ${msg}`, 'err'));
}

connect();
