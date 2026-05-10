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

const S = WORLD_UNITS_PER_M;
const SEND_HZ = 30;
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
  // placeholder while GLB loads
  const placeholder = new THREE.Mesh(
    new THREE.BoxGeometry(1.2 * S, 0.6 * S, 2.0 * S),
    new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.55 }),
  );
  placeholder.castShadow = true;
  placeholder.position.y = 0.3 * S;
  group.add(placeholder);
  scene.add(group);
  cloneKart(DEFAULT_KART_ID, color).then((kart) => {
    // cloneKart already returns the model auto-scaled to mm-units
    // (KART_TARGET_LENGTH = 2000mm). Do NOT multiply by S again — that
    // produced a 2km-long kart that swallowed the camera.
    group.remove(placeholder);
    placeholder.geometry.dispose();
    placeholder.material.dispose();
    group.add(kart);
  }).catch(() => { /* keep placeholder */ });
  const entry = { group, target: { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 }, color };
  ghosts.set(sid, entry);
  return entry;
}

function removeGhost(sid) {
  const g = ghosts.get(sid);
  if (!g) return;
  scene.remove(g.group);
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
      entry.mesh.material = active ? PICKUP_MAT_ACTIVE : PICKUP_MAT_INACTIVE;
      entry.active = active;
    }
  }
  return entry;
}

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

const input = { throttle: 0, brake: 0, steer: 0, drift: false, seq: 0 };
const keys = new Set();
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyE' && roomRef) { try { roomRef.send('fireWeapon', { slot: 'secondary' }); } catch {} }
  if (e.code === 'KeyQ' && roomRef) { try { roomRef.send('swapSecondaryWeapon'); } catch {} }
});
window.addEventListener('keyup', (e) => { keys.delete(e.code); });

function pollInput() {
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
const LERP = 0.25; // per-frame interpolation factor

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
  }
  // Spin pickup boxes.
  for (const { mesh, active } of pickupMeshes.values()) {
    if (active) mesh.rotation.y += dt * 1.6;
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

  // Schema 3.x: use room.onStateChange (kart.onChange is not available client-side).
  let joinCount = 0;
  room.onStateChange((state) => {
    if (!state) return;
    // Karts: ensure ghosts + sync targets.
    state.karts.forEach((kart, sid) => {
      let entry = ghosts.get(sid);
      if (!entry) entry = ensureGhost(sid, joinCount++);
      entry.target.x = kart.x; entry.target.y = kart.y; entry.target.z = kart.z;
      entry.target.qx = kart.qx; entry.target.qy = kart.qy; entry.target.qz = kart.qz; entry.target.qw = kart.qw;
    });
    // Remove ghosts whose karts left.
    for (const sid of [...ghosts.keys()]) {
      if (!state.karts.get(sid)) removeGhost(sid);
    }
    if (hud.players) hud.players.textContent = String(state.karts.size);
    // Pickups.
    state.pickups.forEach((p, id) => { ensurePickupMesh(id, p.x, p.y, p.z, !!p.active); });
    // Local kart HUD (lap, weapon).
    const me = state.karts.get(mySid);
    if (me) {
      if (hud.lap) hud.lap.textContent = `${me.lap || 0} / ${state.totalLaps || TOTAL_LAPS}`;
      if (hud.weapon) hud.weapon.textContent = me.weapon2 ? `${me.weapon2} ×${me.ammo2}` : '—';
      if (hud.reserve) hud.reserve.textContent = me.weapon3 ? `${me.weapon3} ×${me.ammo3}` : '—';
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
