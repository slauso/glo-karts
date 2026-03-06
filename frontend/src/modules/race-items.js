/**
 * race-items.js — Item box / pickup system for race mode.
 *
 * Places item boxes at positions from track-data.json, handles collection,
 * equips a random weapon, and manages active effects (boost, traps, projectiles).
 *
 * Item types from track-data.json:
 *   "item"        → Item box that gives a random weapon
 *   "banana"      → Pre-placed banana trap
 *   "small-nitro" → Small speed boost pad
 *   "big-nitro"   → Large speed boost pad
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Mesh } from '@babylonjs/core/Meshes/mesh';

// ── Weapon catalogue (client-side, matching server combat.js) ───────────────

const WEAPONS = {
  bowling_ball: { name: 'Bowling Ball', icon: '🎳', category: 'projectile', speed: 30, damage: 50, lifetime: 6, bounces: 3, gravity: 0 },
  cake:         { name: 'Cake',         icon: '🎂', category: 'projectile', speed: 24, damage: 30, lifetime: 4, bounces: 0, gravity: -12 },
  plunger:      { name: 'Plunger',      icon: '🪠', category: 'projectile', speed: 55, damage: 15, lifetime: 3.5, bounces: 0, gravity: 0 },
  missile:      { name: 'Missile',      icon: '🚀', category: 'projectile', speed: 48, damage: 35, lifetime: 4, bounces: 0, gravity: 0 },
  banana:       { name: 'Banana',       icon: '🍌', category: 'trap',       speed: 0,  damage: 5,  lifetime: 18, bounces: 0, gravity: 0 },
  bubblegum:    { name: 'Bubblegum',    icon: '🫧', category: 'trap',       speed: 0,  damage: 10, lifetime: 15, bounces: 0, gravity: 0 },
  zipper:       { name: 'Zipper',       icon: '⚡', category: 'buff',       speed: 0,  damage: 0,  lifetime: 0, bounces: 0, gravity: 0, boostFactor: 1.6, boostDuration: 3.0 },
  shield:       { name: 'Shield',       icon: '🛡️', category: 'defence',    speed: 0,  damage: 0,  lifetime: 10, bounces: 0, gravity: 0 },
  swatter:      { name: 'Swatter',      icon: '🪰', category: 'melee',      speed: 0,  damage: 40, lifetime: 0, bounces: 0, gravity: 0, hitRadius: 6 },
};

// Position-aware weighted draw tables
const BACK_WEIGHTS  = { bowling_ball: 3, cake: 3, missile: 4, plunger: 2, banana: 1, bubblegum: 1, zipper: 5, shield: 2, swatter: 2 };
const MID_WEIGHTS   = { bowling_ball: 3, cake: 2, missile: 2, plunger: 2, banana: 3, bubblegum: 3, zipper: 2, shield: 3, swatter: 2 };
const FRONT_WEIGHTS = { bowling_ball: 1, cake: 1, missile: 1, plunger: 1, banana: 5, bubblegum: 4, zipper: 1, shield: 4, swatter: 1 };

function drawWeapon(positionRatio) {
  // positionRatio: 0 = last place, 1 = first place
  let weights;
  if (positionRatio > 0.66) weights = FRONT_WEIGHTS;
  else if (positionRatio > 0.33) weights = MID_WEIGHTS;
  else weights = BACK_WEIGHTS;

  const entries = Object.entries(weights);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let roll = Math.random() * total;
  for (const [id, w] of entries) {
    roll -= w;
    if (roll <= 0) return { id, ...WEAPONS[id] };
  }
  return { id: 'banana', ...WEAPONS.banana };
}

// ── Constants ───────────────────────────────────────────────────────────────

const ITEM_BOX_PICKUP_RADIUS = 3.5;
const ITEM_BOX_RESPAWN_TIME  = 8.0;  // seconds
const NITRO_PICKUP_RADIUS    = 3.0;
const NITRO_SMALL_BOOST      = 1.3;
const NITRO_BIG_BOOST        = 1.6;
const NITRO_BOOST_DURATION   = 1.5;
const BANANA_HIT_RADIUS      = 2.0;
const PROJECTILE_HIT_RADIUS  = 2.5;

// ── State ───────────────────────────────────────────────────────────────────

let _scene = null;
let _itemBoxes = [];      // { mesh, position, active, respawnTimer }
let _nitroPads = [];      // { mesh, position, type, active, respawnTimer }
let _droppedTraps = [];   // { mesh, position, type, lifetime }
let _projectiles = [];    // { mesh, velocity, type, lifetime, birth }
let _prePlacedBananas = []; // from track-data

// Player item state
let _currentItem = null;  // { id, ...weapon def } or null
let _activeEffect = null; // { type, timer } — boost, shield, etc.

// ── Initialization ──────────────────────────────────────────────────────────

/**
 * Set up item boxes and nitro pads from track-data items array.
 */
export function initRaceItems(scene, trackItems) {
  _scene = scene;
  disposeRaceItems();

  if (!trackItems || trackItems.length === 0) return;

  for (const item of trackItems) {
    const pos = item.position;
    const type = item.type;

    if (type === 'item') {
      const mesh = createItemBoxMesh();
      mesh.position.copyFromFloats(pos[0], pos[1] + 1.2, pos[2]);
      _itemBoxes.push({
        mesh,
        position: new Vector3(pos[0], pos[1] + 1.2, pos[2]),
        active: true,
        respawnTimer: 0,
      });
    } else if (type === 'small-nitro' || type === 'big-nitro') {
      const isBig = type === 'big-nitro';
      const mesh = createNitroPadMesh(isBig);
      mesh.position.copyFromFloats(pos[0], pos[1] + 0.15, pos[2]);
      _nitroPads.push({
        mesh,
        position: new Vector3(pos[0], pos[1] + 0.15, pos[2]),
        type,
        active: true,
        respawnTimer: 0,
      });
    } else if (type === 'banana') {
      const mesh = createBananaMesh();
      mesh.position.copyFromFloats(pos[0], pos[1] + 0.3, pos[2]);
      _prePlacedBananas.push({
        mesh,
        position: new Vector3(pos[0], pos[1] + 0.3, pos[2]),
        active: true,
      });
    }
  }

  console.log(`Race items: ${_itemBoxes.length} boxes, ${_nitroPads.length} nitros, ${_prePlacedBananas.length} bananas`);
}

// ── Per-frame update ────────────────────────────────────────────────────────

/**
 * @param {number}  dt          Delta time
 * @param {THREE.Object3D} car  Player car mesh
 * @param {number}  positionRatio  0=last, 1=first (for weighted item draw)
 * @returns {{ boost: number, spinout: boolean, stuck: boolean }}
 */
export function updateRaceItems(dt, car, positionRatio = 0.5) {
  const result = { boost: 0, spinout: false, stuck: false };

  if (!car) return result;
  const carPos = car.position;

  // ── Item box collection ───────────────────────────────────────────────
  for (const box of _itemBoxes) {
    if (box.active) {
      // Animate rotation
      box.mesh.rotation.y += dt * 2.0;

      // Check pickup
      if (Vector3.Distance(carPos, box.position) < ITEM_BOX_PICKUP_RADIUS) {
        if (!_currentItem) {
          _currentItem = drawWeapon(positionRatio);
          box.active = false;
          box.mesh.setEnabled(false);
          box.respawnTimer = ITEM_BOX_RESPAWN_TIME;
        }
      }
    } else {
      // Respawn timer
      box.respawnTimer -= dt;
      if (box.respawnTimer <= 0) {
        box.active = true;
        box.mesh.setEnabled(true);
      }
    }
  }

  // ── Nitro pad collection ──────────────────────────────────────────────
  for (const pad of _nitroPads) {
    if (pad.active) {
      pad.mesh.rotation.y += dt * 1.5;
      if (Vector3.Distance(carPos, pad.position) < NITRO_PICKUP_RADIUS) {
        const isBig = pad.type === 'big-nitro';
        _activeEffect = {
          type: 'boost',
          timer: isBig ? 2.0 : NITRO_BOOST_DURATION,
          factor: isBig ? NITRO_BIG_BOOST : NITRO_SMALL_BOOST,
        };
        pad.active = false;
        pad.mesh.setEnabled(false);
        pad.respawnTimer = 12.0;
      }
    } else {
      pad.respawnTimer -= dt;
      if (pad.respawnTimer <= 0) {
        pad.active = true;
        pad.mesh.setEnabled(true);
      }
    }
  }

  // ── Pre-placed banana collision ───────────────────────────────────────
  for (const b of _prePlacedBananas) {
    if (!b.active) continue;
    if (Vector3.Distance(carPos, b.position) < BANANA_HIT_RADIUS) {
      result.spinout = true;
      b.active = false;
      b.mesh.setEnabled(false);
    }
  }

  // ── Dropped trap collision ────────────────────────────────────────────
  for (let i = _droppedTraps.length - 1; i >= 0; i--) {
    const trap = _droppedTraps[i];
    trap.lifetime -= dt;
    if (trap.lifetime <= 0) {
      removeTrap(i);
      continue;
    }
    if (Vector3.Distance(carPos, trap.position) < BANANA_HIT_RADIUS) {
      if (trap.type === 'banana') result.spinout = true;
      else if (trap.type === 'bubblegum') result.stuck = true;
      removeTrap(i);
    }
  }

  // ── Projectile updates ────────────────────────────────────────────────
  for (let i = _projectiles.length - 1; i >= 0; i--) {
    const proj = _projectiles[i];
    const def = WEAPONS[proj.type];
    if (!def) { removeProjectile(i); continue; }

    proj.lifetime -= dt;
    if (proj.lifetime <= 0) {
      removeProjectile(i);
      continue;
    }

    // Gravity
    if (def.gravity) {
      proj.velocity.y += def.gravity * dt;
    }

    // Move
    proj.mesh.position.x += proj.velocity.x * dt;
    proj.mesh.position.y += proj.velocity.y * dt;
    proj.mesh.position.z += proj.velocity.z * dt;

    // Bounce off ground
    if (proj.mesh.position.y < 0.3 && proj.bounces > 0) {
      proj.mesh.position.y = 0.3;
      proj.velocity.y = Math.abs(proj.velocity.y) * 0.55;
      proj.bounces--;
    } else if (proj.mesh.position.y < -5) {
      removeProjectile(i);
      continue;
    }

    // Rotate for visual
    proj.mesh.rotation.x += dt * 3;
    proj.mesh.rotation.z += dt * 2;
  }

  // ── Active effect countdown ───────────────────────────────────────────
  if (_activeEffect) {
    _activeEffect.timer -= dt;
    if (_activeEffect.type === 'boost') {
      result.boost = _activeEffect.factor;
    }
    if (_activeEffect.timer <= 0) {
      _activeEffect = null;
    }
  }

  return result;
}

// ── Item usage ──────────────────────────────────────────────────────────────

/**
 * Use the currently held item. Call when player presses fire.
 * @param {THREE.Object3D} car Player car mesh
 * @returns {boolean} Whether an item was used
 */
export function useCurrentItem(car) {
  if (!_currentItem || !car) return false;

  const item = _currentItem;
  _currentItem = null;

  const forward = getForward(car);

  if (item.category === 'projectile') {
    // Fire forward
    const start = car.position.add(forward.scale(2.5)).add(new Vector3(0, 1.0, 0));
    const velocity = forward.scale(item.speed);

    const mesh = createProjectileMesh(item.id);
    mesh.position.copyFrom(start);

    _projectiles.push({
      mesh,
      velocity,
      type: item.id,
      lifetime: item.lifetime,
      bounces: item.bounces || 0,
    });
  } else if (item.category === 'trap') {
    // Drop behind
    const behind = car.position.subtract(forward.scale(3)).add(new Vector3(0, 0.3, 0));

    const mesh = item.id === 'banana' ? createBananaMesh() : createBubblegumMesh();
    mesh.position.copyFrom(behind);

    _droppedTraps.push({
      mesh,
      position: behind.clone(),
      type: item.id,
      lifetime: item.lifetime,
    });
  } else if (item.category === 'buff') {
    // Zipper boost
    _activeEffect = {
      type: 'boost',
      timer: item.boostDuration || 3.0,
      factor: item.boostFactor || 1.6,
    };
  } else if (item.category === 'defence') {
    // Shield
    _activeEffect = {
      type: 'shield',
      timer: item.lifetime || 10.0,
      factor: 1,
    };
  } else if (item.category === 'melee') {
    // Swatter — instant hit in radius
    // Handled externally (damage bots in range)
  }

  return true;
}

// ── Queries ─────────────────────────────────────────────────────────────────

export function getCurrentItem() {
  return _currentItem;
}

export function getActiveEffect() {
  return _activeEffect;
}

export function hasShield() {
  return _activeEffect && _activeEffect.type === 'shield';
}

export function consumeShield() {
  if (_activeEffect && _activeEffect.type === 'shield') {
    _activeEffect = null;
    return true;
  }
  return false;
}

export function getProjectiles() {
  return _projectiles;
}

// ── Dispose ─────────────────────────────────────────────────────────────────

export function disposeRaceItems() {
  for (const box of _itemBoxes) box.mesh.dispose(false, true);
  for (const pad of _nitroPads) pad.mesh.dispose(false, true);
  for (const b of _prePlacedBananas) b.mesh.dispose(false, true);
  for (const t of _droppedTraps) t.mesh.dispose(false, true);
  for (const p of _projectiles) p.mesh.dispose(false, true);
  _itemBoxes = [];
  _nitroPads = [];
  _prePlacedBananas = [];
  _droppedTraps = [];
  _projectiles = [];
  _currentItem = null;
  _activeEffect = null;
}

// ── Visual mesh factories ───────────────────────────────────────────────────

function createItemBoxMesh() {
  const group = new TransformNode('itemBox', _scene);

  // Question-mark box (STK style)
  const box = MeshBuilder.CreateBox('itemBoxCube', { size: 1.6 }, _scene);
  const mat = new StandardMaterial('itemBoxMat', _scene);
  mat.diffuseColor = new Color3(1, 0.8, 0);
  mat.emissiveColor = new Color3(1, 0.53, 0).scale(0.3);
  box.material = mat;
  box.parent = group;

  // Question mark billboard
  const tex = new DynamicTexture('qMarkTex', 64, _scene, false);
  const texCtx = tex.getContext();
  texCtx.fillStyle = '#fff';
  texCtx.font = 'bold 48px Arial';
  texCtx.textAlign = 'center';
  texCtx.textBaseline = 'middle';
  texCtx.fillText('?', 32, 32);
  tex.update();

  const qMark = MeshBuilder.CreatePlane('qMark', { size: 1.0 }, _scene);
  const qMat = new StandardMaterial('qMarkMat', _scene);
  qMat.diffuseTexture = tex;
  qMat.useAlphaFromDiffuseTexture = true;
  qMat.backFaceCulling = false;
  qMat.emissiveColor = Color3.White();
  qMark.material = qMat;
  qMark.billboardMode = Mesh.BILLBOARDMODE_ALL;
  qMark.parent = group;

  return group;
}

function createNitroPadMesh(isBig) {
  const color = isBig ? new Color3(0, 1, 0.27) : new Color3(0.27, 0.67, 1);
  const size = isBig ? 2.0 : 1.4;

  const mesh = MeshBuilder.CreateCylinder('nitroPad', {
    diameterTop: size * 2, diameterBottom: size * 2, height: 0.3, tessellation: 12,
  }, _scene);
  const mat = new StandardMaterial('nitroMat', _scene);
  mat.diffuseColor = color;
  mat.emissiveColor = color.scale(0.5);
  mat.alpha = 0.7;
  mesh.material = mat;
  return mesh;
}

function createBananaMesh() {
  // Yellow capsule shape
  const mesh = MeshBuilder.CreateCapsule('banana', {
    radius: 0.15, height: 0.9, tessellation: 8, subdivisions: 4,
  }, _scene);
  const mat = new StandardMaterial('bananaMat', _scene);
  mat.diffuseColor = new Color3(1, 0.88, 0);
  mesh.material = mat;
  mesh.rotation.z = Math.PI * 0.5;
  return mesh;
}

function createBubblegumMesh() {
  const mesh = MeshBuilder.CreateSphere('bubblegum', { diameter: 1.0, segments: 10 }, _scene);
  const mat = new StandardMaterial('bubblegumMat', _scene);
  mat.diffuseColor = new Color3(1, 0.41, 0.71);
  mat.emissiveColor = new Color3(1, 0.41, 0.71).scale(0.2);
  mat.alpha = 0.7;
  mesh.material = mat;
  return mesh;
}

function createProjectileMesh(weaponId) {
  const colors = {
    bowling_ball: new Color3(0.2, 0.2, 0.2),
    cake: new Color3(1, 0.53, 0.67),
    plunger: new Color3(0.53, 0.27, 0),
    missile: new Color3(1, 0.13, 0),
  };
  const color = colors[weaponId] || new Color3(1, 0.27, 0);
  const mesh = MeshBuilder.CreateSphere('projectile', { diameter: 0.8, segments: 8 }, _scene);
  const mat = new StandardMaterial('projMat', _scene);
  mat.diffuseColor = color;
  mat.emissiveColor = color.scale(0.3);
  mesh.material = mat;
  return mesh;
}

// ── Internal helpers ────────────────────────────────────────────────────────

/** Compute forward direction from mesh quaternion (Babylon has no getWorldDirection). */
function getForward(mesh) {
  const q = mesh.rotationQuaternion;
  if (!q) return new Vector3(0, 0, 1);
  const fx = 2 * (q.x * q.z + q.w * q.y);
  const fy = 2 * (q.y * q.z - q.w * q.x);
  const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
  return new Vector3(fx, fy, fz);
}

function removeTrap(index) {
  const trap = _droppedTraps[index];
  if (trap.mesh) trap.mesh.dispose();
  _droppedTraps.splice(index, 1);
}

function removeProjectile(index) {
  const proj = _projectiles[index];
  if (proj.mesh) proj.mesh.dispose();
  _projectiles.splice(index, 1);
}
