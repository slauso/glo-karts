/**
 * mp-client.js — Studio multiplayer hookup (Colyseus).
 *
 * Joins/creates a `studio_room` keyed by share code, broadcasts our kart
 * transform at ~30Hz, and renders ghost karts for every other player in
 * the room. State is best-effort: no rollback, no auth — fine for casual
 * playtest and showing-off-your-build sessions.
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Client } from 'colyseus.js';
import { cloneKart } from './kart-loader.js';
import { DEFAULT_KART_ID } from './kart-catalog.js';

const SEND_HZ = 30;
const REALTIME_URL = (() => {
  // Default: same host, port 2567. Override via window.__REALTIME_URL.
  if (typeof window !== 'undefined' && window.__REALTIME_URL) return window.__REALTIME_URL;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.hostname}:2567`;
})();

function makeGhost(scene, color, kartId = DEFAULT_KART_ID) {
  const group = new THREE.Group();
  // Immediate placeholder — a translucent box tinted to the peer color
  // so the ghost is visible at spawn even before the GLB arrives.
  const placeholder = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.6, 2.0),
    new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.6 }),
  );
  placeholder.castShadow = true;
  placeholder.position.y = 0.3;
  group.add(placeholder);
  scene.add(group);

  // Swap in the real kart asynchronously.
  cloneKart(kartId, color).then((kart) => {
    group.remove(placeholder);
    placeholder.geometry.dispose();
    placeholder.material.dispose();
    group.add(kart);
  }).catch(() => { /* keep placeholder on failure */ });

  return group;
}

function disposeGhost(scene, ghost) {
  scene.remove(ghost);
  // Note: we intentionally do NOT dispose geometries/materials — kart
  // clones share them with the cached template, and disposing here
  // would break subsequent clones.
}

export async function joinRoom({ roomCode, track, chassisBody, scene, camera }) {
  const banner = document.getElementById('roomBanner');
  banner.textContent = `Connecting to room ${roomCode}…`;

  const client = new Client(REALTIME_URL);

  // Pull the host's track payload off the URL (we already loaded it locally)
  const myName = sessionStorage.getItem('playerName') || 'Racer';
  const myColor = sessionStorage.getItem('playerColor') || '#ff3aa1';

  let room;
  try {
    room = await client.joinOrCreate('studio_room', {
      code: roomCode,
      name: myName,
      color: myColor,
      track: new URLSearchParams(window.location.search).get('track') || '',
    });
  } catch (err) {
    console.error('[mp-client] join failed', err);
    banner.textContent = `Solo (room unreachable)`;
    return;
  }

  banner.textContent = `Room ${roomCode} · 1 player`;

  // We already have the track locally (loaded from URL); accept any
  // host-broadcast updates silently to avoid colyseus' "no handler" warning.
  room.onMessage('trackData', () => {});

  /** @type {Map<string, {group: THREE.Group, target: THREE.Vector3, targetQuat: THREE.Quaternion}>} */
  const ghosts = new Map();

  function refreshBanner() {
    banner.textContent = `Room ${roomCode} · ${ghosts.size + 1} players`;
  }

  room.onMessage('peerJoin', ({ id, color }) => {
    if (id === room.sessionId) return;
    if (ghosts.has(id)) return;
    const group = makeGhost(scene, new THREE.Color(color || '#00e5ff'));
    ghosts.set(id, {
      group,
      target: new THREE.Vector3(),
      targetQuat: new THREE.Quaternion(),
    });
    refreshBanner();
  });

  room.onMessage('peerLeave', ({ id }) => {
    const g = ghosts.get(id);
    if (g) {
      disposeGhost(scene, g.group);
      ghosts.delete(id);
      refreshBanner();
    }
  });

  room.onMessage('transforms', (transforms) => {
    for (const [id, t] of Object.entries(transforms)) {
      if (id === room.sessionId) continue;
      let g = ghosts.get(id);
      if (!g) {
        const group = makeGhost(scene, new THREE.Color('#00e5ff'));
        g = {
          group,
          target: new THREE.Vector3(),
          targetQuat: new THREE.Quaternion(),
        };
        ghosts.set(id, g);
        refreshBanner();
      }
      g.target.set(t.x, t.y, t.z);
      g.targetQuat.set(t.qx, t.qy, t.qz, t.qw);
    }
  });

  // Smooth-follow loop for ghosts
  let raf;
  function smooth() {
    for (const g of ghosts.values()) {
      g.group.position.lerp(g.target, 0.25);
      g.group.quaternion.slerp(g.targetQuat, 0.25);
    }
    raf = requestAnimationFrame(smooth);
  }
  smooth();

  // Send our transform on a fixed cadence
  setInterval(() => {
    if (!room || !chassisBody) return;
    room.send('transform', {
      x: chassisBody.position.x,
      y: chassisBody.position.y,
      z: chassisBody.position.z,
      qx: chassisBody.quaternion.x,
      qy: chassisBody.quaternion.y,
      qz: chassisBody.quaternion.z,
      qw: chassisBody.quaternion.w,
      vx: chassisBody.velocity.x,
      vy: chassisBody.velocity.y,
      vz: chassisBody.velocity.z,
    });
  }, Math.round(1000 / SEND_HZ));

  window.__mp = { client, room, ghosts };
}
