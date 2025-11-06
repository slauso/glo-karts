import * as THREE from 'three';

/*
 * Basic Weapons System (Phase 4 foundation)
 * Host authoritative:
 * - Host spawns pickups and broadcasts list periodically
 * - Host validates pickup claims and assigns weapon
 * - Host spawns and simulates projectiles; broadcasts spawn + hit events
 */

const WEAPON_TYPES = {
  rocket: {
    id: 'rocket',
    name: 'ROCKET',
    icon: '🚀',
    damage: 35,
    speed: 50, // m/s forward
    lifetime: 4.0 // seconds
  }
};

// Configuration
const PICKUP_RESPAWN_INTERVAL = 8000; // ms per spawn attempt
const MAX_ACTIVE_PICKUPS = 5;
const PICKUP_RADIUS = 2.5; // collection distance (horizontal)
const PROJECTILE_RADIUS = 0.8; // projectile sphere radius
const CAR_HIT_RADIUS = 2.6; // generous car hit radius for simple tests

// Internal state
const state = {
  isHost: false,
  scene: null,
  multiplayerState: null,
  arenaInfo: null,
  pickups: [], // { id, type, mesh }
  lastSpawnAttempt: 0,
  projectiles: [], // { id, type, mesh, velocity: THREE.Vector3, birth: ms }
  tempVec: new THREE.Vector3(),
};

let idCounter = 0;
function genId(prefix){ return prefix + '_' + (idCounter++); }

export function initWeapons(opts) {
  state.isHost = !!opts.isHost;
  state.scene = opts.scene;
  state.multiplayerState = opts.multiplayerState;
  state.arenaInfo = opts.arenaInfo;
  console.log('[Weapons] Initialized. Host:', state.isHost);
  return { 
    getState: () => state,
    fireWeapon: (playerCar, battleState) => fireWeapon(playerCar, battleState),
    update: (dt, playerCar, battleState) => update(dt, playerCar, battleState),
    requestFire: () => requestFire(),
    fireFromActor: (actorMesh, weaponId='rocket') => fireFromActor(actorMesh, weaponId),
  };
}

function requestFire() {
  // Guest requests host to fire (if host doesn't already handle locally)
  if (!state.multiplayerState) return;
  const ms = state.multiplayerState;
  if (!ms.peer) return;
  if (!ms.isHost && ms.playerConnections.length === 1) {
    // We are guest; send fire request to host
    try {
      const conn = ms.playerConnections[0];
      conn.send({ type: 'weaponFireRequest', timestamp: Date.now() });
    } catch(e){ console.error('Failed to send weaponFireRequest', e); }
  }
}

function spawnPickup(type) {
  const weaponDef = WEAPON_TYPES[type];
  if (!weaponDef) return;

  // Pick a random spawn point from arena or random inside bounds
  let pos;
  if (state.arenaInfo && Array.isArray(state.arenaInfo.spawnPoints) && state.arenaInfo.spawnPoints.length) {
    const sp = state.arenaInfo.spawnPoints[Math.floor(Math.random()*state.arenaInfo.spawnPoints.length)];
    pos = new THREE.Vector3(sp.x + (Math.random()-0.5)*6, (sp.y ?? 0) + 0.6, sp.z + (Math.random()-0.5)*6);
  } else {
    pos = new THREE.Vector3((Math.random()-0.5)*40, 0.6, (Math.random()-0.5)*40);
  }

  // Visual: simple rotating ring or box
  const geom = new THREE.TorusGeometry(0.7, 0.22, 12, 24);
  const mat = new THREE.MeshBasicMaterial({ color: 0xff8800 });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.copy(pos);
  mesh.rotation.x = Math.PI/2;
  mesh.userData.isPickup = true;
  state.scene.add(mesh);

  const pickup = { id: genId('pickup'), type, mesh };
  state.pickups.push(pickup);
  broadcastPickups();
}

function broadcastPickups() {
  if (!state.isHost || !state.multiplayerState) return;
  const ms = state.multiplayerState;
  if (!ms.playerConnections.length) return;
  const payload = state.pickups.map(p => ({ id: p.id, type: p.type, position: p.mesh.position.toArray() }));
  ms.playerConnections.forEach(conn => {
    try { if (conn.open) conn.send({ type: 'weaponPickups', pickups: payload }); } catch(e){ console.error('Broadcast pickups failed', e);} });
}

// Allow host to broadcast current pickups on demand (e.g., when players connect or request sync)
export function hostBroadcastPickups() {
  broadcastPickups();
}

export function applyRemotePickups(list, scene) {
  // Remove existing remote copies (only for guests)
  // We'll keep local authoritative list for host
  // Simplistic sync: clear and re-add
  state.pickups.forEach(p => { if (p.mesh && p.mesh.parent) p.mesh.parent.remove(p.mesh); });
  state.pickups = [];
  list.forEach(item => {
    const geom = new THREE.TorusGeometry(1, 0.3, 12, 32);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff8800 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.rotation.x = Math.PI/2;
    mesh.position.fromArray(item.position);
    mesh.userData.isPickup = true;
    scene.add(mesh);
    state.pickups.push({ id: item.id, type: item.type, mesh });
  });
}

const claimCooldownByPickup = new Map();

function collectPickups(playerCar, battleState) {
  if (!playerCar) return;
  const pos = playerCar.position;
  for (let i=state.pickups.length-1;i>=0;i--) {
    const p = state.pickups[i];
    if (!p.mesh) continue;
    // Horizontal distance only
    const dx = p.mesh.position.x - pos.x;
    const dz = p.mesh.position.z - pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= PICKUP_RADIUS) {
      if (state.isHost) {
        // Assign weapon if empty slot
        if (!battleState.currentWeapon) battleState.currentWeapon = WEAPON_TYPES[p.type];
        // Remove pickup and broadcast
        if (p.mesh.parent) p.mesh.parent.remove(p.mesh);
        state.pickups.splice(i,1);
        broadcastPickups();
      } else {
        // Guest: request claim from host, avoid spamming
        const now = performance.now();
        const last = claimCooldownByPickup.get(p.id) || 0;
        if (now - last > 800) {
          claimCooldownByPickup.set(p.id, now);
          try {
            const ms = state.multiplayerState;
            if (ms && ms.playerConnections && ms.playerConnections[0]) {
              ms.playerConnections[0].send({ type: 'pickupClaim', id: p.id, timestamp: Date.now() });
            }
          } catch(e){ console.error('Failed to send pickupClaim', e); }
        }
      }
    }
  }
}

function fireWeapon(playerCar, battleState) {
  if (!battleState.currentWeapon) return;
  const weapon = battleState.currentWeapon;
  if (weapon.id === 'rocket') {
    spawnProjectile(playerCar, weapon);
    // Single-use for now
    battleState.currentWeapon = null;
  }
}

function spawnProjectile(playerCar, weapon) {
  if (!playerCar) return;
  const projGeom = new THREE.SphereGeometry(0.5, 16, 16);
  const projMat = new THREE.MeshBasicMaterial({ color: 0xff3333 });
  const mesh = new THREE.Mesh(projGeom, projMat);
  // Start slightly ahead of car
  const forward = new THREE.Vector3();
  playerCar.getWorldDirection(forward);
  const startPos = playerCar.position.clone().add(forward.clone().multiplyScalar(2)).add(new THREE.Vector3(0,1,0));
  mesh.position.copy(startPos);
  mesh.userData.isProjectile = true;
  state.scene.add(mesh);
  const velocity = forward.clone().multiplyScalar(weapon.speed);
  const proj = { id: genId('proj'), type: weapon.id, mesh, velocity, birth: performance.now(), damage: weapon.damage };
  state.projectiles.push(proj);
  broadcastProjectileSpawn(proj);
}

function fireFromActor(actorMesh, weaponId='rocket') {
  const weapon = WEAPON_TYPES[weaponId];
  if (!weapon) return;
  // Reuse spawn logic but with provided actor
  const forward = new THREE.Vector3();
  if (actorMesh.getWorldDirection) actorMesh.getWorldDirection(forward); else forward.set(0,0,1).applyQuaternion(actorMesh.quaternion).normalize();
  const startPos = actorMesh.position.clone().add(forward.clone().multiplyScalar(2)).add(new THREE.Vector3(0,1,0));
  const projGeom = new THREE.SphereGeometry(0.5, 16, 16);
  const projMat = new THREE.MeshBasicMaterial({ color: 0xff3333 });
  const mesh = new THREE.Mesh(projGeom, projMat);
  mesh.position.copy(startPos);
  mesh.userData.isProjectile = true;
  state.scene.add(mesh);
  const velocity = forward.clone().multiplyScalar(weapon.speed);
  const proj = { id: genId('proj'), type: weapon.id, mesh, velocity, birth: performance.now(), damage: weapon.damage };
  state.projectiles.push(proj);
  broadcastProjectileSpawn(proj);
}

function broadcastProjectileSpawn(proj) {
  if (!state.isHost || !state.multiplayerState) return;
  const ms = state.multiplayerState;
  ms.playerConnections.forEach(conn => {
    try { if (conn.open) conn.send({ type: 'projectileSpawn', proj: serializeProjectile(proj) }); } catch(e){ console.error('Failed projectileSpawn', e);} });
}

function serializeProjectile(p) {
  return {
    id: p.id,
    type: p.type,
    position: p.mesh.position.toArray(),
    velocity: p.velocity.toArray(),
    birth: p.birth,
    damage: p.damage
  };
}

export function addRemoteProjectile(data, scene) {
  const geom = new THREE.SphereGeometry(0.5, 16, 16);
  const mat = new THREE.MeshBasicMaterial({ color: 0xff3333 });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.fromArray(data.position);
  scene.add(mesh);
  const velocity = new THREE.Vector3().fromArray(data.velocity);
  state.projectiles.push({ id: data.id, type: data.type, mesh, velocity, birth: data.birth, damage: data.damage, remote: true });
}

function updateProjectiles(dt, playerCar, battleState) {
  const now = performance.now();
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const p = state.projectiles[i];
    // Move
    p.mesh.position.addScaledVector(p.velocity, dt);
    // Lifetime
    if ((now - p.birth) / 1000 > WEAPON_TYPES[p.type].lifetime) {
      destroyProjectileIndex(i);
      continue;
    }
    // Host-only collision detection against opponents
    if (state.isHost && !p.remote) {
      checkProjectileHits(p);
    }
  }
}

function destroyProjectileIndex(i) {
  const p = state.projectiles[i];
  if (p.mesh && p.mesh.parent) p.mesh.parent.remove(p.mesh);
  state.projectiles.splice(i,1);
}

function checkProjectileHits(proj) {
  if (!state.multiplayerState) return;
  const ms = state.multiplayerState;
  const opponents = ms.opponentCars || {};
  const projPos = proj.mesh.position;
  const victims = [];
  Object.entries(opponents).forEach(([playerId, opp]) => {
    if (!opp.model || !opp.model.visible) return;
    const d = opp.model.position.distanceTo(projPos);
    if (d <= PROJECTILE_RADIUS + CAR_HIT_RADIUS) { // simple radius threshold
      victims.push(playerId);
    }
  });
  if (victims.length) {
    // Damage event
    if (typeof ms.broadcastDamageEvent === 'function') {
      ms.broadcastDamageEvent(victims, proj.damage, 'weapon:'+proj.type);
    }
    broadcastProjectileHit(proj, victims);
    // Destroy projectile
    const idx = state.projectiles.findIndex(p => p.id === proj.id);
    if (idx >= 0) destroyProjectileIndex(idx);
  }
}

function broadcastProjectileHit(proj, victims) {
  if (!state.isHost || !state.multiplayerState) return;
  const ms = state.multiplayerState;
  ms.playerConnections.forEach(conn => {
    try { if (conn.open) conn.send({ type: 'projectileHit', id: proj.id, victims }); } catch(e){ console.error('Failed projectileHit', e);} });
}

export function handleProjectileHit(id) {
  const idx = state.projectiles.findIndex(p => p.id === id);
  if (idx >= 0) destroyProjectileIndex(idx);
}

function maybeSpawnPickups() {
  if (!state.isHost) return;
  const now = performance.now();
  if (state.pickups.length >= MAX_ACTIVE_PICKUPS) return;
  if (now - state.lastSpawnAttempt < PICKUP_RESPAWN_INTERVAL) return;
  state.lastSpawnAttempt = now;
  spawnPickup('rocket');
}

function update(dt, playerCar, battleState) {
  // Host spawns pickups
  maybeSpawnPickups();
  // Collect pickups (host and guest both run for local feedback; host authoritative removal)
  collectPickups(playerCar, battleState);
  // Update projectile movement
  updateProjectiles(dt, playerCar, battleState);
  // Rotate pickups for visual flair
  state.pickups.forEach(p => { if (p.mesh) p.mesh.rotation.z += dt * 2; });
}

// Utility to hook firing from battle-main
export function attemptFire(playerCar, battleState) {
  if (!battleState.currentWeapon) return false;
  fireWeapon(playerCar, battleState);
  return true;
}

// Host validation for pickup claim
export function hostHandlePickupClaim(pickupId, playerId) {
  if (!state.isHost) return null;
  const ms = state.multiplayerState;
  const opp = ms?.opponentCars?.[playerId];
  if (!opp || !opp.model) return null;
  const oppPos = opp.model.position;
  const idx = state.pickups.findIndex(p => p.id === pickupId);
  if (idx < 0) return null;
  const p = state.pickups[idx];
  const dx = p.mesh.position.x - oppPos.x;
  const dz = p.mesh.position.z - oppPos.z;
  const dist = Math.hypot(dx, dz);
  if (dist > PICKUP_RADIUS) return null;
  // Valid: remove and broadcast; return weapon id
  if (p.mesh.parent) p.mesh.parent.remove(p.mesh);
  state.pickups.splice(idx,1);
  broadcastPickups();
  return p.type;
}

export function getWeaponDef(id) {
  return WEAPON_TYPES[id] || null;
}
