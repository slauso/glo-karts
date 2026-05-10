/**
 * multiplayer-editor3-main.js — Online race client (editor3 visuals + Colyseus state).
 *
 * Renders an editor3 track in Three.js, connects to `editor3_race_room`, and
 * displays every kart as a ghost driven by server snapshots. Local input
 * (WASD / arrows + Space) is sent at 30Hz; the server is authoritative — there
 * is no client-side prediction yet, so motion is smoothed via lerp.
 *
 * URL params:
 *   ?trackId=<uuid>   — fetch that track from the backend (defaults to Tutorial Loop)
 *   ?room=<code>      — optional party code (filterBy on server)
 *   ?backend=<url>    — override backend base URL (default http://localhost:8000)
 *   ?realtime=<wsurl> — override realtime WS URL (default same host :2567)
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
const TRACK_ID = params.get('trackId') || TUTORIAL_LOOP_ID;
const ROOM_CODE = params.get('room') || '';
const BACKEND_URL = params.get('backend') || `${window.location.protocol}//${window.location.hostname}:8000`;
const REALTIME_URL = params.get('realtime') || (() => {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.hostname}:2567`;
})();

const hud = {
  track: document.getElementById('hud-track'),
  status: document.getElementById('hud-status'),
  players: document.getElementById('hud-players'),
  ping: document.getElementById('hud-ping'),
};
function setStatus(text, cls = 'warn') {
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

const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(40 * S, 80 * S, 30 * S);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -100 * S; sun.shadow.camera.right = 100 * S;
sun.shadow.camera.top = 100 * S; sun.shadow.camera.bottom = -100 * S;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0x88aaff, 0x202028, 0.45));

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
    kart.scale.setScalar(S);
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

// ── Input ───────────────────────────────────────────────────────────
const input = { throttle: 0, brake: 0, steer: 0, seq: 0 };
const keys = new Set();
window.addEventListener('keydown', (e) => { keys.add(e.code); });
window.addEventListener('keyup', (e) => { keys.delete(e.code); });

function pollInput() {
  const fwd = keys.has('KeyW') || keys.has('ArrowUp');
  const back = keys.has('KeyS') || keys.has('ArrowDown');
  const left = keys.has('KeyA') || keys.has('ArrowLeft');
  const right = keys.has('KeyD') || keys.has('ArrowRight');
  const brake = keys.has('Space');
  input.throttle = fwd ? 1 : 0;
  input.brake = brake ? 1 : (back ? 0.4 : 0);
  input.steer = (left ? -1 : 0) + (right ? 1 : 0);
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
  const trackData = await fetchTrackData(TRACK_ID);
  if (!trackData) {
    setStatus('track unavailable', 'err');
    hud.track.textContent = '(none)';
    return;
  }
  const { placementCount } = buildTrackVisuals(trackData);
  hud.track.textContent = `${trackData.track?.name || trackData.name || '(custom)'} (${placementCount} segs)`;

  setStatus('connecting…', 'warn');
  const client = new Client(REALTIME_URL);
  let room;
  try {
    const opts = { trackId: TRACK_ID };
    if (ROOM_CODE) opts.partyCode = ROOM_CODE;
    room = await client.joinOrCreate('editor3_race_room', opts);
  } catch (err) {
    console.error('[mp-editor3] join failed', err);
    setStatus('join failed', 'err');
    return;
  }
  mySid = room.sessionId;
  setStatus(`connected as ${mySid.slice(0, 6)}`, 'ok');

  let joinCount = 0;
  room.state.karts.onAdd((kart, sid) => {
    const entry = ensureGhost(sid, joinCount++);
    entry.target.x = kart.x; entry.target.y = kart.y; entry.target.z = kart.z;
    entry.target.qx = kart.qx; entry.target.qy = kart.qy; entry.target.qz = kart.qz; entry.target.qw = kart.qw;
    kart.onChange(() => {
      entry.target.x = kart.x; entry.target.y = kart.y; entry.target.z = kart.z;
      entry.target.qx = kart.qx; entry.target.qy = kart.qy; entry.target.qz = kart.qz; entry.target.qw = kart.qw;
    });
    hud.players.textContent = String(room.state.karts.size);
  });
  room.state.karts.onRemove((_kart, sid) => {
    removeGhost(sid);
    hud.players.textContent = String(room.state.karts.size);
  });

  // Input send loop (30Hz).
  setInterval(() => {
    pollInput();
    input.seq++;
    try {
      room.send('input', { seq: input.seq, throttle: input.throttle, brake: input.brake, steer: input.steer });
    } catch { /* dropped frame */ }
  }, 1000 / SEND_HZ);

  // Lightweight ping (round-trip via state — server stamps lastSeq).
  setInterval(() => {
    const me = mySid ? room.state.karts.get(mySid) : null;
    if (!me) return;
    const drift = input.seq - me.lastSeq;
    hud.ping.textContent = `${drift} seq behind`;
    lastPing = drift;
  }, 1000);

  room.onLeave(() => setStatus('disconnected', 'err'));
  room.onError((code, msg) => setStatus(`error ${code}: ${msg}`, 'err'));
}

connect();
