import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';

/*
 * GLO KARTS — Weapons System
 * All 8 STK-derived weapon types + pickup / projectile / loadout logic
 * Host is authoritative; guests receive sync packets.
 */

// ── Weapon catalogue ────────────────────────────────────────────────────────
export const WEAPON_TYPES = {
  bowling: {
    id: 'bowling', name: 'BOWLING BALL', icon: '/textures/items/bowling-icon.png',
    color: 0xaaddff, damage: 40, speed: 28, radius: 0.55, lifetime: 6, bounces: 3,
    desc: 'Rolls forward and bounces off walls',
  },
  bubblegum: {
    id: 'bubblegum', name: 'BUBBLE GUM', icon: '/textures/items/bubblegum-icon.png',
    color: 0xff66cc, damage: 20, speed: 0, radius: 0.4, lifetime: 12, bounces: 0,
    desc: 'Dropped behind — slows anyone who runs over it',
  },
  cake: {
    id: 'cake', name: 'CAKE', icon: '/textures/items/cake-icon.png',
    color: 0xffcc44, damage: 30, speed: 22, radius: 0.5, lifetime: 4, bounces: 0,
    desc: 'Lobbed in an arc',
  },
  plunger: {
    id: 'plunger', name: 'PLUNGER', icon: '/textures/items/plunger-icon.png',
    color: 0xff3300, damage: 15, speed: 35, radius: 0.35, lifetime: 3.5, bounces: 0,
    desc: 'Fast straight shot — sticks and blocks steering',
  },
  anchor: {
    id: 'anchor', name: 'ANCHOR', icon: '/textures/items/anchor-icon.png',
    color: 0x445566, damage: 50, speed: 0, radius: 0.6, lifetime: 0, bounces: 0,
    desc: 'Drops on yourself — destroys whoever collides',
  },
  swatter: {
    id: 'swatter', name: 'SWATTER', icon: '/textures/items/swatter-icon.png',
    color: 0x88ff44, damage: 35, speed: 18, radius: 0.7, lifetime: 3, bounces: 0,
    desc: 'Wide-arc close-range smash',
  },
  nitro: {
    id: 'nitro', name: 'NITRO', icon: '/textures/items/nitro.png',
    color: 0x00ffcc, damage: 25, speed: 20, radius: 0.4, lifetime: 5, bounces: 1,
    desc: 'Exploding nitro bottle thrown forward',
  },
  parachute: {
    id: 'parachute', name: 'PARACHUTE', icon: '/textures/items/parachute-icon.png',
    color: 0xffaa22, damage: 0, speed: 0, radius: 0, lifetime: 0, bounces: 0,
    desc: 'Deploys behind you — slows the chasing player',
  },
};

// ── Loadout presets ─────────────────────────────────────────────────────────
export const WEAPON_LOADOUTS = {
  'random-all': {
    id: 'random-all', name: 'Random (All)',
    desc: 'Any weapon can spawn',
    pool: Object.keys(WEAPON_TYPES),
  },
  'combat': {
    id: 'combat', name: 'Combat',
    desc: 'High-damage weapons only',
    pool: ['bowling', 'cake', 'anchor', 'swatter', 'nitro'],
  },
  'chaos': {
    id: 'chaos', name: 'Chaos',
    desc: 'Fast-spawn, every weapon, respawns quickly',
    pool: Object.keys(WEAPON_TYPES),
    spawnInterval: 4000,
    maxPickups: 8,
  },
  'sneaky': {
    id: 'sneaky', name: 'Sneaky',
    desc: 'Traps only — bubblegum, plunger, parachute',
    pool: ['bubblegum', 'plunger', 'parachute'],
  },
  'none': {
    id: 'none', name: 'No Weapons',
    desc: 'Pure collision damage',
    pool: [],
  },
};

// ── Config ──────────────────────────────────────────────────────────────────
const DEFAULT_SPAWN_INTERVAL = 7000;
const DEFAULT_MAX_PICKUPS    = 5;
const PICKUP_RADIUS          = 2.8;
const CAR_HIT_RADIUS         = 2.6;

// ── Internal state ──────────────────────────────────────────────────────────
const state = {
  isHost: false,
  scene: null,
  multiplayerState: null,
  arenaInfo: null,
  loadout: WEAPON_LOADOUTS['random-all'],
  pickups: [],
  lastSpawn: 0,
  projectiles: [],
};

let _idCtr = 0;
function gid(p) { return p + '_' + (_idCtr++); }

// ── Public API ─────────────────────────────────────────────────────────────
export function initWeapons(opts) {
  state.isHost           = !!opts.isHost;
  state.scene            = opts.scene;
  state.multiplayerState = opts.multiplayerState || null;
  state.arenaInfo        = opts.arenaInfo  || null;
  // Accept loadout id from gameConfig
  const loadoutId = opts.loadoutId || 'random-all';
  state.loadout = WEAPON_LOADOUTS[loadoutId] || WEAPON_LOADOUTS['random-all'];
  console.log('[Weapons] Init. host:', state.isHost, 'loadout:', state.loadout.name);
  return {
    getState: ()             => state,
    update:   (dt, car, bs) => update(dt, car, bs),
    attemptFire: (car, bs)  => attemptFire(car, bs),
    fireFromActor: (mesh, id) => fireFromActor(mesh, id),
    requestFire: ()          => requestFire(),
  };
}

export function hostBroadcastPickups() { broadcastPickups(); }

export function applyRemotePickups(list, scene) {
  state.pickups.forEach(p => { if (p.mesh) p.mesh.dispose(); });
  state.pickups = [];
  list.forEach(item => {
    const mesh = makePickupMesh(item.type || 'bowling');
    const arr = item.position;
    mesh.position.copyFromFloats(arr[0], arr[1], arr[2]);
    state.pickups.push({ id: item.id, type: item.type, mesh });
  });
}

export function addRemoteProjectile(data, scene) {
  const mesh = makeProjMesh(data.type);
  const arr = data.position;
  mesh.position.copyFromFloats(arr[0], arr[1], arr[2]);
  const vel = Vector3.FromArray(data.velocity);
  state.projectiles.push({ id: data.id, type: data.type, mesh, velocity: vel, birth: data.birth, damage: data.damage, remote: true });
}

export function handleProjectileHit(id) {
  const idx = state.projectiles.findIndex(p => p.id === id);
  if (idx >= 0) destroyProj(idx);
}

export function hostHandlePickupClaim(pickupId, playerId) {
  if (!state.isHost) return null;
  const ms  = state.multiplayerState;
  const opp = ms?.opponentCars?.[playerId];
  if (!opp?.model) return null;
  const idx = state.pickups.findIndex(p => p.id === pickupId);
  if (idx < 0) return null;
  const p = state.pickups[idx];
  const dx = p.mesh.position.x - opp.model.position.x;
  const dz = p.mesh.position.z - opp.model.position.z;
  if (Math.hypot(dx, dz) > PICKUP_RADIUS) return null;
  if (p.mesh) p.mesh.dispose();
  state.pickups.splice(idx, 1);
  broadcastPickups();
  return p.type;
}

export function getWeaponDef(id) { return WEAPON_TYPES[id] || null; }

export function attemptFire(playerCar, battleState) {
  if (!battleState.currentWeapon) return false;
  fireWeapon(playerCar, battleState);
  return true;
}

// ── Pickup mesh factory ────────────────────────────────────────────────────
function makePickupMesh(type) {
  const def   = WEAPON_TYPES[type] || WEAPON_TYPES.bowling;
  const scene = state.scene;
  const group = new TransformNode('pickup_' + type, scene);

  const torus = MeshBuilder.CreateTorus('pickupTorus', { diameter: 1.44, thickness: 0.36, tessellation: 28 }, scene);
  const mat = new StandardMaterial('pickupMat', scene);
  const c3 = Color3.FromHexString('#' + def.color.toString(16).padStart(6, '0'));
  mat.diffuseColor = c3;
  mat.emissiveColor = c3.scale(0.6);
  torus.material = mat;
  torus.parent = group;

  group.metadata = { isPickup: true };
  return group;
}

// ── Projectile mesh factory ────────────────────────────────────────────────
function makeProjMesh(type) {
  const def  = WEAPON_TYPES[type] || WEAPON_TYPES.bowling;
  const scene = state.scene;
  const mesh = MeshBuilder.CreateSphere('proj_' + type, { diameter: (def.radius || 0.5) * 2, segments: 14 }, scene);
  const mat = new StandardMaterial('projMat', scene);
  const c3 = Color3.FromHexString('#' + (def.color || 0xaaddff).toString(16).padStart(6, '0'));
  mat.diffuseColor = c3;
  mat.emissiveColor = c3.scale(0.8);
  mat.alpha = 0.92;
  mesh.material = mat;
  return mesh;
}

// ── Spawn logic ─────────────────────────────────────────────────────────────
function maybeSpawn() {
  if (!state.isHost) return;
  const lo = state.loadout;
  if (!lo || lo.pool.length === 0) return;
  const maxP = lo.maxPickups || DEFAULT_MAX_PICKUPS;
  const interval = lo.spawnInterval || DEFAULT_SPAWN_INTERVAL;
  if (state.pickups.length >= maxP) return;
  const now = performance.now();
  if (now - state.lastSpawn < interval) return;
  state.lastSpawn = now;
  const type = lo.pool[Math.floor(Math.random() * lo.pool.length)];
  spawnPickup(type);
}

function spawnPickup(type) {
  let pos;
  if (state.arenaInfo?.spawnPoints?.length) {
    const sp = state.arenaInfo.spawnPoints[Math.floor(Math.random() * state.arenaInfo.spawnPoints.length)];
    pos = new Vector3(sp.x + (Math.random()-0.5)*8, (sp.y ?? 0)+0.8, sp.z + (Math.random()-0.5)*8);
  } else {
    pos = new Vector3((Math.random()-0.5)*40, 0.8, (Math.random()-0.5)*40);
  }
  const mesh = makePickupMesh(type);
  mesh.position.copyFrom(pos);
  state.pickups.push({ id: gid('pu'), type, mesh });
  broadcastPickups();
}

function broadcastPickups() {
  if (!state.isHost || !state.multiplayerState) return;
  const payload = state.pickups.map(p => ({ id: p.id, type: p.type, position: p.mesh.position.asArray() }));
  state.multiplayerState.playerConnections?.forEach(conn => {
    try { if (conn.open) conn.send({ type: 'weaponPickups', pickups: payload }); } catch(e) {}
  });
}

// ── Collection ──────────────────────────────────────────────────────────────
const claimCooldown = new Map();
function collectPickups(playerCar, battleState) {
  if (!playerCar) return;
  const pos = playerCar.position;
  for (let i = state.pickups.length - 1; i >= 0; i--) {
    const p = state.pickups[i];
    if (!p.mesh) continue;
    const dx = p.mesh.position.x - pos.x;
    const dz = p.mesh.position.z - pos.z;
    if (Math.hypot(dx, dz) > PICKUP_RADIUS) continue;
    if (state.isHost) {
      if (!battleState.currentWeapon) {
        battleState.currentWeapon = WEAPON_TYPES[p.type];
        playSfx('/audio/sfx/grab_collectable.ogg');
        updateWeaponHUD(battleState.currentWeapon);
      }
      if (p.mesh) p.mesh.dispose();
      state.pickups.splice(i, 1);
      broadcastPickups();
    } else {
      const now = performance.now();
      if ((now - (claimCooldown.get(p.id)||0)) > 800) {
        claimCooldown.set(p.id, now);
        try { state.multiplayerState?.playerConnections?.[0]?.send({ type: 'pickupClaim', id: p.id }); } catch(e){}
      }
    }
  }
}

// ── Firing ──────────────────────────────────────────────────────────────────
function fireWeapon(playerCar, battleState) {
  if (!battleState.currentWeapon) return;
  const w = battleState.currentWeapon;
  if (w.id === 'anchor') {
    spawnProjectileAt(playerCar.position.clone().addInPlace(new Vector3(0,-0.5,0)), new Vector3(0,-1,0), w);
  } else if (w.id === 'bubblegum' || w.id === 'parachute') {
    const fwd = getForward(playerCar);
    spawnProjectileAt(playerCar.position.clone().addInPlace(fwd.scale(-2)), new Vector3(0,0,0), w);
  } else {
    spawnProjectile(playerCar, w);
  }
  playSfx('/audio/sfx/shoot.ogg');
  battleState.currentWeapon = null;
  updateWeaponHUD(null);
}

function fireFromActor(actorMesh, weaponId = 'bowling') {
  const w = WEAPON_TYPES[weaponId];
  if (!w) return;
  spawnProjectile(actorMesh, w);
}

function requestFire() {
  const ms = state.multiplayerState;
  if (!ms) return;
  try { ms.playerConnections?.[0]?.send({ type: 'weaponFireRequest', t: Date.now() }); } catch(e){}
}

function spawnProjectile(actorMesh, weapon) {
  const fwd = getForward(actorMesh);
  const start = actorMesh.position.clone().addInPlace(fwd.scale(2)).addInPlace(new Vector3(0,0.8,0));
  const vel = fwd.normalize().scale(weapon.speed);
  spawnProjectileAt(start, vel, weapon);
}

function spawnProjectileAt(pos, vel, weapon) {
  const mesh = makeProjMesh(weapon.id);
  mesh.position.copyFrom(pos);
  const proj = { id: gid('pr'), type: weapon.id, mesh, velocity: vel.clone(), birth: performance.now(), damage: weapon.damage, bounces: weapon.bounces || 0 };
  state.projectiles.push(proj);
  broadcastProjSpawn(proj);
}

function broadcastProjSpawn(proj) {
  if (!state.isHost || !state.multiplayerState) return;
  const data = { type: 'projectileSpawn', proj: { id: proj.id, type: proj.type, position: proj.mesh.position.asArray(), velocity: proj.velocity.asArray(), birth: proj.birth, damage: proj.damage }};
  state.multiplayerState.playerConnections?.forEach(c => { try { if(c.open) c.send(data); } catch(e){} });
}

function broadcastProjHit(proj, victims) {
  if (!state.isHost || !state.multiplayerState) return;
  state.multiplayerState.playerConnections?.forEach(c => { try { if(c.open) c.send({ type: 'projectileHit', id: proj.id, victims }); } catch(e){} });
}

// Helper: get forward direction from mesh (Babylon.js)
function getForward(mesh) {
  const fwd = new Vector3(0, 0, 1);
  const q = mesh.rotationQuaternion;
  if (q) {
    const ix = q.w * fwd.x + q.y * fwd.z - q.z * fwd.y;
    const iy = q.w * fwd.y + q.z * fwd.x - q.x * fwd.z;
    const iz = q.w * fwd.z + q.x * fwd.y - q.y * fwd.x;
    const iw = -q.x * fwd.x - q.y * fwd.y - q.z * fwd.z;
    fwd.x = ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y;
    fwd.y = iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z;
    fwd.z = iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x;
    fwd.normalize();
  }
  return fwd;
}

// ── Projectile update ───────────────────────────────────────────────────────
function updateProjectiles(dt, playerCar, battleState) {
  const now = performance.now();
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const p = state.projectiles[i];
    const def = WEAPON_TYPES[p.type] || {};
    // Gravity for arced weapons
    if (p.type === 'cake' || p.type === 'nitro') p.velocity.y -= 9.8 * dt;
    p.mesh.position.x += p.velocity.x * dt;
    p.mesh.position.y += p.velocity.y * dt;
    p.mesh.position.z += p.velocity.z * dt;
    // Ground bounce
    if (p.mesh.position.y < 0.3 && p.bounces > 0) {
      p.mesh.position.y = 0.3; p.velocity.y = Math.abs(p.velocity.y) * 0.55; p.bounces--;
    }
    // Lifetime
    if (def.lifetime && (now - p.birth) / 1000 > def.lifetime) { destroyProj(i); continue; }
    // Hit detection (host only, non-remote)
    if (state.isHost && !p.remote) checkHits(p, i);
  }
}

function checkHits(proj, projIdx) {
  const ms = state.multiplayerState;
  const opps = ms?.opponentCars || {};
  const pp = proj.mesh.position;
  const victims = [];
  Object.entries(opps).forEach(([pid, opp]) => {
    if (!opp.model?.visible) return;
    if (Vector3.Distance(opp.model.position, pp) <= (WEAPON_TYPES[proj.type]?.radius||0.5) + CAR_HIT_RADIUS)
      victims.push(pid);
  });
  if (victims.length) {
    if (typeof ms.broadcastDamageEvent === 'function') ms.broadcastDamageEvent(victims, proj.damage, 'weapon:'+proj.type);
    broadcastProjHit(proj, victims);
    destroyProj(projIdx);
  }
}

function destroyProj(i) {
  const p = state.projectiles[i];
  if (p.mesh) p.mesh.dispose();
  state.projectiles.splice(i, 1);
}

// ── HUD helper ──────────────────────────────────────────────────────────────
function updateWeaponHUD(weapon) {
  const el = document.getElementById('weapon-hud');
  if (!el) return;
  if (!weapon) { el.textContent = ''; el.style.backgroundImage = ''; return; }
  el.textContent = weapon.name;
  el.style.backgroundImage = `url("${weapon.icon}")`;
}

// ── Sound helper ────────────────────────────────────────────────────────────
function playSfx(src) {
  try { const a = new Audio(src); a.volume = 0.55; a.play().catch(()=>{}); } catch(e){}
}

// ── Main update ─────────────────────────────────────────────────────────────
function update(dt, playerCar, battleState) {
  maybeSpawn();
  collectPickups(playerCar, battleState);
  updateProjectiles(dt, playerCar, battleState);
  state.pickups.forEach(p => { if (p.mesh) { p.mesh.rotation.y += dt * 1.8; p.mesh.position.y = 0.8 + 0.18 * Math.sin(performance.now() * 0.002); } });
}
