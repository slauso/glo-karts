import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { createWeaponModel, createPickupRingModel } from './weapon-models.js';
import { EXTREME_WEAPONS } from '../procedural-models.js';
import { attachProjectileRotation, applyEnhancedTrail, initHavokPhysics, getHavokPlugin } from './weapon-fx-enhance.js';
import { poolScale, scaleParticles, scaleTrail, maxPhysicsBodies, maxProjectiles } from '../perf-tier.js';

/*
 * GLO KARTS — Weapons System (Enhanced PvP)
 * All weapon types + pickup / projectile / loadout logic
 * Host is authoritative; guests receive sync packets.
 *
 * Enhancements:
 *  - Projectile pooling (avoids GC spikes from mesh create/dispose)
 *  - Per-weapon drag, gravity, blast radius, homing
 *  - Homing/seeking projectiles with smooth pursuit
 *  - Lead-target prediction for bot aiming
 *  - Explosion radial force on impact
 *  - Trail particles on active projectiles
 *  - New weapons: guided_missile, grenade
 */

// ── Weapon catalogue ────────────────────────────────────────────────────────
export const WEAPON_TYPES = {
  // Expose for dev/test menus
  if (typeof window !== 'undefined') {
    window.WEAPON_TYPES = WEAPON_TYPES;
  }
  bowling: {
    id: 'bowling', name: 'BOWLING BALL', icon: '/textures/items/bowling-icon.png',
    color: 0xaaddff, damage: 40, speed: 28, radius: 0.55, lifetime: 6, bounces: 3,
    drag: 0.998, gravity: 0, blastRadius: 0, blastForce: 0,
    homing: false, seekForce: 0, seekCone: 0,
    desc: 'Rolls forward and bounces off walls',
  },
  bubblegum: {
    id: 'bubblegum', name: 'BUBBLE GUM', icon: '/textures/items/bubblegum-icon.png',
    color: 0xff66cc, damage: 20, speed: 0, radius: 0.4, lifetime: 12, bounces: 0,
    drag: 1, gravity: 0, blastRadius: 0, blastForce: 0,
    homing: false, seekForce: 0, seekCone: 0,
    desc: 'Dropped behind — slows anyone who runs over it',
  },
  cake: {
    id: 'cake', name: 'CAKE', icon: '/textures/items/cake-icon.png',
    color: 0xffcc44, damage: 30, speed: 22, radius: 0.5, lifetime: 4, bounces: 0,
    drag: 0.995, gravity: -9.8, blastRadius: 4, blastForce: 8,
    homing: false, seekForce: 0, seekCone: 0,
    desc: 'Lobbed in an arc — explodes on impact',
  },
  plunger: {
    id: 'plunger', name: 'PLUNGER', icon: '/textures/items/plunger-icon.png',
    color: 0xff3300, damage: 15, speed: 35, radius: 0.35, lifetime: 3.5, bounces: 0,
    drag: 0.999, gravity: 0, blastRadius: 0, blastForce: 0,
    homing: false, seekForce: 0, seekCone: 0,
    desc: 'Fast straight shot — sticks and blocks steering',
  },
  anchor: {
    id: 'anchor', name: 'ANCHOR', icon: '/textures/items/anchor-icon.png',
    color: 0x445566, damage: 50, speed: 0, radius: 0.6, lifetime: 0, bounces: 0,
    drag: 1, gravity: 0, blastRadius: 3, blastForce: 12,
    homing: false, seekForce: 0, seekCone: 0,
    desc: 'Drops on yourself — destroys whoever collides',
  },
  swatter: {
    id: 'swatter', name: 'SWATTER', icon: '/textures/items/swatter-icon.png',
    color: 0x88ff44, damage: 35, speed: 18, radius: 0.7, lifetime: 3, bounces: 0,
    drag: 0.99, gravity: -2, blastRadius: 0, blastForce: 0,
    homing: false, seekForce: 0, seekCone: 0,
    desc: 'Wide-arc close-range smash',
  },
  nitro: {
    id: 'nitro', name: 'NITRO', icon: '/textures/items/nitro.png',
    color: 0x00ffcc, damage: 25, speed: 20, radius: 0.4, lifetime: 5, bounces: 1,
    drag: 0.996, gravity: -9.8, blastRadius: 5, blastForce: 10,
    homing: false, seekForce: 0, seekCone: 0,
    desc: 'Exploding nitro bottle thrown forward',
  },
  parachute: {
    id: 'parachute', name: 'PARACHUTE', icon: '/textures/items/parachute-icon.png',
    color: 0xffaa22, damage: 0, speed: 0, radius: 0, lifetime: 0, bounces: 0,
    drag: 1, gravity: 0, blastRadius: 0, blastForce: 0,
    homing: false, seekForce: 0, seekCone: 0,
    desc: 'Deploys behind you — slows the chasing player',
  },
  guided_missile: {
    id: 'guided_missile', name: 'GUIDED MISSILE', icon: '/textures/items/bowling-icon.png',
    color: 0xff0066, damage: 35, speed: 24, radius: 0.45, lifetime: 5, bounces: 0,
    drag: 0.999, gravity: 0, blastRadius: 5, blastForce: 14,
    homing: true, seekForce: 12, seekCone: 0.5,
    desc: 'Locks on and chases the nearest enemy',
  },
  grenade: {
    id: 'grenade', name: 'GRENADE', icon: '/textures/items/nitro.png',
    color: 0x556b2f, damage: 45, speed: 16, radius: 0.35, lifetime: 2.5, bounces: 2,
    drag: 0.99, gravity: -12, blastRadius: 6, blastForce: 16,
    homing: false, seekForce: 0, seekCone: 0,
    desc: 'Arced throw — large AoE explosion on detonation',
  },
  // ── EXTREME tier weapons ───────────────────────────────────────────────
  shockwave_cannon: {
    id: 'shockwave_cannon', name: 'SHOCKWAVE CANNON', icon: '/textures/items/bowling-icon.png',
    color: 0x4488ff, damage: 55, speed: 0, radius: 1.0, lifetime: 1.5, bounces: 0,
    drag: 1, gravity: 0, blastRadius: 15, blastForce: 20,
    homing: false, seekForce: 0, seekCone: 0,
    desc: 'Expanding energy ring flattens all karts in range', extreme: true,
  },
  thunderstrike: {
    id: 'thunderstrike', name: 'THUNDERSTRIKE', icon: '/textures/items/bowling-icon.png',
    color: 0xccddff, damage: 45, speed: 999, radius: 0.5, lifetime: 2.0, bounces: 0,
    drag: 1, gravity: 0, blastRadius: 3, blastForce: 10,
    homing: true, seekForce: 999, seekCone: 1.0,
    desc: 'Lightning bolt pins target with sparks', extreme: true,
  },
  black_hole: {
    id: 'black_hole', name: 'BLACK HOLE ORB', icon: '/textures/items/bowling-icon.png',
    color: 0x5500aa, damage: 35, speed: 8, radius: 0.9, lifetime: 5.0, bounces: 0,
    drag: 0.99, gravity: 0, blastRadius: 12, blastForce: 25,
    homing: false, seekForce: 0, seekCone: 0,
    desc: 'Slow vortex pulls, crushes, and expels karts', extreme: true,
  },
  meteor_swarm: {
    id: 'meteor_swarm', name: 'METEOR SWARM', icon: '/textures/items/nitro.png',
    color: 0xff6600, damage: 40, speed: 30, radius: 0.6, lifetime: 4.0, bounces: 0,
    drag: 0.99, gravity: -15, blastRadius: 4, blastForce: 14,
    homing: false, seekForce: 0, seekCone: 0,
    desc: 'Rains burning rocks onto a target zone', extreme: true,
  },
  frost_nova: {
    id: 'frost_nova', name: 'FROST NOVA', icon: '/textures/items/bowling-icon.png',
    color: 0x66ccff, damage: 20, speed: 0, radius: 1.0, lifetime: 2.5, bounces: 0,
    drag: 1, gravity: 0, blastRadius: 15, blastForce: 5,
    homing: false, seekForce: 0, seekCone: 0,
    desc: 'Instant AOE freeze with ice crystals', extreme: true,
  },
  emp_pulse: {
    id: 'emp_pulse', name: 'EMP PULSE', icon: '/textures/items/bowling-icon.png',
    color: 0x00ccff, damage: 10, speed: 0, radius: 1.0, lifetime: 1.5, bounces: 0,
    drag: 1, gravity: 0, blastRadius: 18, blastForce: 3,
    homing: false, seekForce: 0, seekCone: 0,
    desc: 'Disables steering and boost for all nearby karts', extreme: true,
  },
  gravity_flip: {
    id: 'gravity_flip', name: 'GRAVITY FLIP', icon: '/textures/items/bowling-icon.png',
    color: 0xaa44ff, damage: 15, speed: 0, radius: 1.0, lifetime: 3.0, bounces: 0,
    drag: 1, gravity: 0, blastRadius: 12, blastForce: 18,
    homing: false, seekForce: 0, seekCone: 0,
    desc: 'Reverses gravity for caught karts', extreme: true,
  },
  inferno_trail: {
    id: 'inferno_trail', name: 'INFERNO TRAIL', icon: '/textures/items/nitro.png',
    color: 0xff4400, damage: 30, speed: 0, radius: 0.5, lifetime: 5.0, bounces: 0,
    drag: 1, gravity: 0, blastRadius: 3, blastForce: 8,
    homing: false, seekForce: 0, seekCone: 0,
    desc: 'Drops persistent fire wall behind kart', extreme: true,
  },
  plasma_railgun: {
    id: 'plasma_railgun', name: 'PLASMA RAILGUN', icon: '/textures/items/bowling-icon.png',
    color: 0x00ffcc, damage: 60, speed: 999, radius: 0.3, lifetime: 0.5, bounces: 0,
    drag: 1, gravity: 0, blastRadius: 1, blastForce: 30,
    homing: false, seekForce: 0, seekCone: 0,
    desc: 'Instant-hit beam piercing multiple targets', extreme: true,
  },
  vortex_tornado: {
    id: 'vortex_tornado', name: 'VORTEX TORNADO', icon: '/textures/items/bowling-icon.png',
    color: 0x8899aa, damage: 25, speed: 12, radius: 3.0, lifetime: 6.0, bounces: 0,
    drag: 0.995, gravity: 0, blastRadius: 6, blastForce: 18,
    homing: false, seekForce: 0, seekCone: 0,
    pullRadius: 18, pullForce: 9.0, spinForce: 3.5,
    desc: 'Wandering tornado scoops up karts', extreme: true,
  },

  // ── Wizard-Masters Elemental Weapons ────────────────────────────────
  fireball: {
    id: 'fireball', name: 'FIREBALL', icon: '/textures/battle/icons/skill_fire.png',
    color: 0xff6600, damage: 35, speed: 32, radius: 0.6, lifetime: 4.5, bounces: 0,
    drag: 0.999, gravity: 0, blastRadius: 4, blastForce: 10,
    homing: false, seekForce: 0, seekCone: 0,
    desc: 'Blazing fireball with lingering burn damage', element: 'fire',
  },
  toxic_spread: {
    id: 'toxic_spread', name: 'TOXIC SPREAD', icon: '/textures/battle/icons/skill_toxic.png',
    color: 0x44ff22, damage: 18, speed: 26, radius: 0.4, lifetime: 3.5, bounces: 0,
    drag: 0.998, gravity: 0, blastRadius: 3, blastForce: 4,
    homing: false, seekForce: 0, seekCone: 0,
    desc: 'Three toxic projectiles in a fan — leave poison puddles', element: 'toxic',
    spreadCount: 3, spreadAngle: 0.17,
  },
  ice_lance: {
    id: 'ice_lance', name: 'ICE LANCE', icon: '/textures/battle/icons/skill_ice_arrow.png',
    color: 0x66ccff, damage: 28, speed: 55, radius: 0.35, lifetime: 3.0, bounces: 0,
    ammo: 3,
    drag: 1, gravity: 0, blastRadius: 2, blastForce: 6,
    homing: false, seekForce: 0, seekCone: 0,
    desc: 'Fast ice shard that freezes on contact', element: 'ice',
  },
  tornado: {
    id: 'tornado', name: 'TORNADO', icon: '/textures/battle/icons/skill_wind_tornado.png',
    color: 0x88ccdd, damage: 22, speed: 14, radius: 2.5, lifetime: 6.0, bounces: 0,
    drag: 0.998, gravity: 0, blastRadius: 6, blastForce: 18,
    homing: false, seekForce: 0, seekCone: 0,
    pullRadius: 15, pullForce: 7.0, spinForce: 2.8,
    desc: 'Slow-moving tornado that pulls and spins out karts', element: 'wind',
  },
  super_nova: {
    id: 'super_nova', name: 'SUPER NOVA', icon: '/textures/battle/icons/skill_super_nova.png',
    color: 0xff8800, damage: 45, speed: 0, radius: 1.5, lifetime: 3.5, bounces: 0,
    drag: 1, gravity: 0, blastRadius: 15, blastForce: 20,
    homing: false, seekForce: 0, seekCone: 0,
    desc: 'Expanding ring of fire that scorches everyone in range', element: 'fire',
  },
  rock_barrage: {
    id: 'rock_barrage', name: 'ROCK BARRAGE', icon: '/textures/battle/icons/skill_rock.png',
    color: 0x886644, damage: 30, speed: 22, radius: 0.55, lifetime: 4.0, bounces: 1,
    drag: 0.99, gravity: -8, blastRadius: 4, blastForce: 12,
    homing: false, seekForce: 0, seekCone: 0,
    desc: 'Two heavy rocks lobbed in a dual arc', element: 'earth',
    spreadCount: 2, spreadAngle: 0.08,
  },
  lightning_bolt: {
    id: 'lightning_bolt', name: 'LIGHTNING BOLT', icon: '/textures/battle/icons/skill_light_strike.png',
    color: 0xeeeeff, damage: 42, speed: 200, radius: 0.5, lifetime: 0.8, bounces: 0,
    drag: 1, gravity: 0, blastRadius: 3, blastForce: 10,
    homing: false, seekForce: 0, seekCone: 0,
    desc: 'Near-instant lightning strike — stuns on hit', element: 'light',
  },
  wind_slash: {
    id: 'wind_slash', name: 'WIND SLASH', icon: '/textures/battle/icons/skill_wind_slash.png',
    color: 0xaaddbb, damage: 20, speed: 42, radius: 0.8, lifetime: 2.0, bounces: 0,
    drag: 0.99, gravity: 0, blastRadius: 2, blastForce: 14,
    homing: false, seekForce: 0, seekCone: 0,
    desc: 'Quick wind blade — pushes targets back on hit', element: 'wind',
  },
  toxic_cloud: {
    id: 'toxic_cloud', name: 'TOXIC CLOUD', icon: '/textures/battle/icons/skill_toxic_cloud.png',
    color: 0x33aa11, damage: 8, speed: 0, radius: 1.0, lifetime: 7.5, bounces: 0,
    drag: 1, gravity: 0, blastRadius: 10, blastForce: 0,
    homing: false, seekForce: 0, seekCone: 0,
    desc: 'Lingers in place dealing damage over time to all inside', element: 'toxic',
  },
  final_fission: {
    id: 'final_fission', name: 'FINAL FISSION', icon: '/textures/battle/icons/skill_super_nova.png',
    color: 0xffeedd, damage: 80, speed: 0, radius: 2.0, lifetime: 5.0, bounces: 0,
    drag: 1, gravity: 0, blastRadius: 25, blastForce: 40,
    homing: false, seekForce: 0, seekCone: 0,
    desc: 'Nuclear fission detonation — obliterates everything in range', element: 'fire',
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
    pool: ['bowling', 'cake', 'anchor', 'swatter', 'nitro', 'guided_missile', 'grenade'],
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
  'explosive': {
    id: 'explosive', name: 'Explosive',
    desc: 'Blast-radius weapons — explosions everywhere',
    pool: ['cake', 'nitro', 'anchor', 'guided_missile', 'grenade'],
    spawnInterval: 5000,
  },
  'extreme': {
    id: 'extreme', name: 'Extreme',
    desc: 'Rare devastating weapons with awe-inspiring effects',
    pool: ['shockwave_cannon', 'thunderstrike', 'black_hole', 'meteor_swarm',
           'frost_nova', 'emp_pulse', 'gravity_flip', 'inferno_trail',
           'plasma_railgun', 'vortex_tornado', 'final_fission'],
    spawnInterval: 10000,
    maxPickups: 3,
  },
  'all-extreme': {
    id: 'all-extreme', name: 'All + Extreme',
    desc: 'Standard weapons plus rare extreme drops',
    pool: [...Object.keys(WEAPON_TYPES)],
    spawnInterval: 6000,
    maxPickups: 6,
  },
  'elemental': {
    id: 'elemental', name: 'Elemental',
    desc: 'Wizard-Masters elemental spells only',
    pool: ['fireball', 'toxic_spread', 'ice_lance', 'tornado', 'super_nova',
           'rock_barrage', 'lightning_bolt', 'wind_slash', 'toxic_cloud'],
    spawnInterval: 5000,
    maxPickups: 6,
  },
  'fire-and-ice': {
    id: 'fire-and-ice', name: 'Fire & Ice',
    desc: 'Elemental duel — fire vs ice weapons',
    pool: ['fireball', 'super_nova', 'ice_lance', 'frost_nova'],
    spawnInterval: 5000,
    maxPickups: 5,
  },
  'full-arsenal': {
    id: 'full-arsenal', name: 'Full Arsenal',
    desc: 'Every weapon from kart classics to wizard spells',
    pool: [...Object.keys(WEAPON_TYPES)],
    spawnInterval: 5000,
    maxPickups: 7,
  },
};

// ── Config ──────────────────────────────────────────────────────────────────
const DEFAULT_SPAWN_INTERVAL = 7000;
const DEFAULT_MAX_PICKUPS    = 5;
const PICKUP_RADIUS          = 2.8;
const CAR_HIT_RADIUS         = 2.6;
const POOL_SIZE              = 40;       // pre-allocated projectile meshes (base)
const TRAIL_POOL_SIZE        = 30;       // pooled trail particle emitters (base)
const PARTICLE_TEXTURE_URL   = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
const CLAIM_COOLDOWN_TTL     = 5000;
const PICKUP_SYNC_SOFT_CAP_MULTIPLIER = 2;

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

// Physics body tracking
let _physicsBodyCount = 0;
let _PhysicsAggregate = null;  // lazy-loaded
let _PhysicsShapeType = null;  // lazy-loaded

async function _loadPhysicsModules() {
  if (_PhysicsAggregate) return;
  try {
    const [aggMod, shapeMod] = await Promise.all([
      import('@babylonjs/core/Physics/v2/physicsAggregate'),
      import('@babylonjs/core/Physics/v2/IPhysicsEnginePlugin'),
    ]);
    _PhysicsAggregate = aggMod.PhysicsAggregate;
    _PhysicsShapeType = shapeMod.PhysicsShapeType;
  } catch (e) {
    console.warn('[Weapons] Physics modules unavailable:', e.message);
  }
}

// ── Projectile mesh pool ────────────────────────────────────────────────────
const meshPool = [];          // dormant meshes available for reuse
const meshPoolActive = [];    // currently-in-use meshes (for tracking)
const _modelTemplates = {};   // per-weaponType template meshes (cloned on acquire)

function initMeshPool(scene) {
  // Pre-create one template per weapon type via weapon-models.js
  for (const typeId of Object.keys(WEAPON_TYPES)) {
    const template = createWeaponModel(typeId, scene);
    template.setEnabled(false);
    template.name = 'tpl_' + typeId;
    _modelTemplates[typeId] = template;
  }
  // Pre-fill pool with generic spheres that will be swapped at acquire time
  for (let i = 0; i < Math.round(POOL_SIZE * poolScale()); i++) {
    const mesh = MeshBuilder.CreateSphere('poolProj_' + i, { diameter: 1, segments: 10 }, scene);
    const mat = new StandardMaterial('poolProjMat_' + i, scene);
    mat.alpha = 0.92;
    mesh.material = mat;
    mesh.setEnabled(false);
    meshPool.push(mesh);
  }
}

function acquirePoolMesh(type) {
  const def = WEAPON_TYPES[type] || WEAPON_TYPES.bowling;
  // If we have a detailed template, clone it instead of using a pool sphere
  if (_modelTemplates[type]) {
    const clone = _modelTemplates[type].clone('proj_' + type + '_' + (_idCtr++), null);
    if (clone.getChildMeshes) {
      clone.getChildMeshes().forEach(m => m.setEnabled(true));
    }
    clone.setEnabled(true);
    const r = (def.radius || 0.5) * 2;
    clone.scaling.setAll(r);
    meshPoolActive.push(clone);
    return clone;
  }
  // Fallback to pool sphere (shouldn't normally happen)
  const c3 = Color3.FromHexString('#' + (def.color || 0xaaddff).toString(16).padStart(6, '0'));
  let mesh;
  if (meshPool.length > 0) {
    mesh = meshPool.pop();
  } else {
    mesh = MeshBuilder.CreateSphere('poolProj_overflow', { diameter: 1, segments: 10 }, state.scene);
    const mat = new StandardMaterial('poolProjMat_overflow', state.scene);
    mat.alpha = 0.92;
    mesh.material = mat;
  }
  const r = (def.radius || 0.5) * 2;
  mesh.scaling.setAll(r);
  mesh.material.diffuseColor = c3;
  mesh.material.emissiveColor = c3.scale(0.8);
  mesh.setEnabled(true);
  meshPoolActive.push(mesh);
  return mesh;
}

function releasePoolMesh(mesh) {
  const idx = meshPoolActive.indexOf(mesh);
  if (idx >= 0) meshPoolActive.splice(idx, 1);
  // Cloned weapon models get disposed; pool spheres go back to pool
  if (mesh.name && mesh.name.startsWith('proj_')) {
    mesh.dispose(false, true);
  } else {
    mesh.setEnabled(false);
    mesh.position.setAll(0);
    meshPool.push(mesh);
  }
}

// ── Trail particle pool ────────────────────────────────────────────────────
const trailPool = [];       // dormant trail emitters
const trailActive = [];     // active trail emitters

function initTrailPool(scene) {
  for (let i = 0; i < Math.round(TRAIL_POOL_SIZE * poolScale()); i++) {
    const ps = new ParticleSystem('trail_' + i, scaleParticles(30), scene);
    ps.particleTexture = new Texture(PARTICLE_TEXTURE_URL, scene);
    ps.emitRate = 0;
    ps.minLifeTime = 0.15;
    ps.maxLifeTime = 0.4;
    ps.minSize = 0.06;
    ps.maxSize = 0.15;
    ps.gravity = new Vector3(0, -2, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.minEmitPower = 0.3;
    ps.maxEmitPower = 0.8;
    ps.direction1 = new Vector3(-0.3, 0.3, -0.3);
    ps.direction2 = new Vector3(0.3, 0.8, 0.3);
    ps.start();
    trailPool.push(ps);
  }
}

function acquireTrail(color, emitter) {
  if (trailPool.length === 0) return null;
  const ps = trailPool.pop();
  const r = ((color >> 16) & 0xff) / 255;
  const g = ((color >> 8) & 0xff) / 255;
  const b = (color & 0xff) / 255;
  ps.color1 = new Color4(r, g, b, 0.8);
  ps.color2 = new Color4(r, g, b, 0.4);
  ps.colorDead = new Color4(r * 0.3, g * 0.3, b * 0.3, 0);
  ps.emitter = emitter;
  ps.emitRate = scaleTrail(25);
  trailActive.push(ps);
  return ps;
}

function releaseTrail(ps) {
  if (!ps) return;
  ps.emitRate = 0;
  ps.emitter = Vector3.Zero();
  const idx = trailActive.indexOf(ps);
  if (idx >= 0) trailActive.splice(idx, 1);
  trailPool.push(ps);
}

let _idCtr = 0;
function gid(p) { return p + '_' + (_idCtr++); }

// ── Lead-target prediction ─────────────────────────────────────────────────
/**
 * Predict where a moving target will be when a projectile can reach it.
 * Returns an aim point (Vector3) the projectile should be fired toward.
 */
export function predictIntercept(shooterPos, targetPos, targetVel, projSpeed) {
  if (projSpeed <= 0) return targetPos.clone();
  const toTarget = targetPos.subtract(shooterPos);
  const dist = toTarget.length();
  // Simple first-order: t = dist / projSpeed, aimAt = targetPos + targetVel * t
  const t = dist / projSpeed;
  return targetPos.add(targetVel.scale(Math.min(t, 2.0))); // cap at 2s of prediction
}

// ── Public API ─────────────────────────────────────────────────────────────
export function initWeapons(opts) {
  state.isHost           = !!opts.isHost;
  state.scene            = opts.scene;
  state.multiplayerState = opts.multiplayerState || null;
  state.arenaInfo        = opts.arenaInfo  || null;
  // Accept loadout id from gameConfig
  const loadoutId = opts.loadoutId || 'random-all';
  state.loadout = WEAPON_LOADOUTS[loadoutId] || WEAPON_LOADOUTS['random-all'];

  // Initialize pools
  initMeshPool(state.scene);
  initTrailPool(state.scene);

  // Reset physics state for new session
  _physicsBodyCount = 0;

  // Initialize Havok physics + preload PhysicsAggregate (non-blocking)
  initHavokPhysics(state.scene).catch(() => {});
  _loadPhysicsModules().catch(() => {});

  console.log('[Weapons] Init. host:', state.isHost, 'loadout:', state.loadout.name, 'pool:', POOL_SIZE);
  return {
    getState: ()             => state,
    getProjectiles: ()       => state.projectiles,
    update:   (dt, car, bs) => update(dt, car, bs),
    attemptFire: (car, bs)  => attemptFire(car, bs),
    fireFromActor: (mesh, id) => fireFromActor(mesh, id),
    requestFire: ()          => requestFire(),
    predictIntercept,
  };
}

export function hostBroadcastPickups() { broadcastPickups(); }

export function applyRemotePickups(list, scene) {
  const existing = new Map(state.pickups.map((pickup) => [pickup.id, pickup]));
  const next = [];
  const softCap = Math.max(
    DEFAULT_MAX_PICKUPS,
    Math.ceil((state.loadout?.maxPickups || DEFAULT_MAX_PICKUPS) * PICKUP_SYNC_SOFT_CAP_MULTIPLIER),
  );

  list.slice(0, softCap).forEach((item) => {
    const arr = item.position || [0, 0.8, 0];
    let entry = existing.get(item.id);
    if (!entry || entry.type !== item.type || !entry.mesh || entry.mesh.isDisposed?.()) {
      entry?.mesh?.dispose();
      entry = { id: item.id, type: item.type, mesh: makePickupMesh(item.type || 'bowling') };
    }
    entry.type = item.type;
    entry.mesh.position.copyFromFloats(arr[0], arr[1], arr[2]);
    next.push(entry);
    existing.delete(item.id);
  });

  existing.forEach((pickup) => {
    try { pickup.mesh?.dispose(); } catch (_) {}
  });
  state.pickups = next;
}

export function addRemoteProjectile(data, scene) {
  if (state.projectiles.length >= maxProjectiles()) {
    const oldestRemoteIdx = state.projectiles.findIndex((projectile) => projectile.remote);
    if (oldestRemoteIdx >= 0) {
      destroyProj(oldestRemoteIdx);
    } else {
      return;
    }
  }
  const mesh = makeProjMesh(data.type);
  const arr = data.position;
  mesh.position.copyFromFloats(arr[0], arr[1], arr[2]);
  const vel = Vector3.FromArray(data.velocity);
  const def = WEAPON_TYPES[data.type] || {};
  let trail = null;
  if ((def.speed || 0) > 0) {
    trail = acquireTrail(def.color || 0xffffff, mesh);
  }
  state.projectiles.push({ id: data.id, type: data.type, mesh, velocity: vel, birth: data.birth, damage: data.damage, remote: true, trail });
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
  const c3 = Color3.FromHexString('#' + (def.color || 0xaaddff).toString(16).padStart(6, '0'));
  return createPickupRingModel(scene, c3);
}

// ── Projectile mesh factory (uses pool) ─────────────────────────────────────
function makeProjMesh(type) {
  return acquirePoolMesh(type);
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
function pruneClaimCooldown(now) {
  for (const [pickupId, claimTime] of claimCooldown) {
    if ((now - claimTime) > CLAIM_COOLDOWN_TTL) claimCooldown.delete(pickupId);
  }
}

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
        battleState.currentWeapon = { ...WEAPON_TYPES[p.type] };
        battleState.currentWeapon.ammo = Math.max(1, Number(WEAPON_TYPES[p.type]?.ammo || 1));
        playSfx('/audio/sfx/grab_collectable.ogg');
        updateWeaponHUD(battleState.currentWeapon);
      }
      if (p.mesh) p.mesh.dispose();
      state.pickups.splice(i, 1);
      broadcastPickups();
    } else {
      const now = performance.now();
      pruneClaimCooldown(now);
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
  const remainingAmmo = Math.max(0, Number(w.ammo || 1) - 1);
  if (remainingAmmo > 0) {
    battleState.currentWeapon = { ...w, ammo: remainingAmmo };
    updateWeaponHUD(battleState.currentWeapon);
  } else {
    battleState.currentWeapon = null;
    updateWeaponHUD(null);
  }
}

function fireFromActor(actorMesh, weaponId = 'bowling') {
  const w = WEAPON_TYPES[weaponId];
  if (!w) return;
  // Support pre-computed aim direction (e.g. from bot lead-target prediction)
  if (actorMesh._aimDir) {
    const start = actorMesh.position.clone().addInPlace(new Vector3(0, 0.8, 0));
    const vel = actorMesh._aimDir.normalize().scale(w.speed);
    spawnProjectileAt(start, vel, w);
  } else {
    spawnProjectile(actorMesh, w);
  }
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
  // Enforce hard projectile cap to prevent runaway accumulation
  if (state.projectiles.length >= maxProjectiles()) {
    // Destroy oldest projectile to make room
    destroyProj(0);
  }
  const mesh = makeProjMesh(weapon.id);
  mesh.position.copyFrom(pos);
  const def = WEAPON_TYPES[weapon.id] || {};
  // Attach trail particle emitter (only for moving projectiles)
  let trail = null;
  if (weapon.speed > 0) {
    trail = acquireTrail(def.color || 0xffffff, mesh);
    if (trail) applyEnhancedTrail(trail, weapon.id);
  }
  // Attach per-weapon rotation animation (batch system — returns unregister callback)
  const disposeRotation = attachProjectileRotation(mesh, weapon.id);

  // Attach physics body if Havok is available and within budget
  let physicsBody = null;
  if (_PhysicsAggregate && _PhysicsShapeType && getHavokPlugin()
      && _physicsBodyCount < maxPhysicsBodies() && weapon.speed > 0) {
    try {
      const aggregate = new _PhysicsAggregate(
        mesh, _PhysicsShapeType.SPHERE,
        { mass: 1.0, restitution: 0.3, friction: 0.2 },
        state.scene,
      );
      // Apply initial velocity as linear impulse
      const body = aggregate.body;
      body.setLinearVelocity(vel);
      // Disable gravity for weapons that don't use it
      if (!def.gravity) {
        body.setGravityFactor(0);
      }
      physicsBody = aggregate;
      _physicsBodyCount++;
    } catch {
      // Physics attach failed — fallback to manual movement
    }
  }

  const proj = {
    id: gid('pr'), type: weapon.id, mesh, velocity: vel.clone(),
    birth: performance.now(), damage: weapon.damage,
    bounces: weapon.bounces || 0, trail, physicsBody,
    _disposeRotation: disposeRotation,
  };
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

// ── Projectile update (enhanced) ────────────────────────────────────────────
let _homingFrame = 0; // throttle homing search to every 3rd frame
const _tmpSeekDir = new Vector3();
const _tmpCurrentDir = new Vector3();
const _tmpBlastDir = new Vector3();

function updateProjectiles(dt, playerCar, battleState) {
  const now = performance.now();
  _homingFrame++;
  const doHoming = (_homingFrame % 3) === 0; // only search every 3 frames
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const p = state.projectiles[i];
    const def = WEAPON_TYPES[p.type] || {};

    // ── Homing / seeking (throttled to every 3 frames) ──────────────────
    if (doHoming && def.homing && def.seekForce > 0 && !p.remote) {
      const target = findNearestEnemy(p.mesh.position);
      if (target) {
        target.subtractToRef(p.mesh.position, _tmpSeekDir);
        if (_tmpSeekDir.lengthSquared() <= 0.0001) continue;
        _tmpSeekDir.normalize();
        p.velocity.normalizeToRef(_tmpCurrentDir);
        // Only seek if target is within the seek cone (dot product check)
        const dot = Vector3.Dot(_tmpCurrentDir, _tmpSeekDir);
        if (dot > def.seekCone) {
          const seekStrength = def.seekForce * dt * 3;
          if (p.physicsBody && p.physicsBody.body) {
            // Apply seeking as impulse (scaled by 3 to compensate for throttle)
            p.physicsBody.body.applyImpulse(_tmpSeekDir.scale(seekStrength), p.mesh.position);
          } else {
            // Smooth pursuit: lerp velocity direction toward target
            p.velocity.x += _tmpSeekDir.x * seekStrength;
            p.velocity.y += _tmpSeekDir.y * seekStrength;
            p.velocity.z += _tmpSeekDir.z * seekStrength;
            // Maintain speed (re-normalize to original magnitude)
            const currentSpeed = p.velocity.length();
            if (currentSpeed > 0) {
              p.velocity.normalize().scaleInPlace(Math.min(currentSpeed, def.speed * 1.2));
            }
          }
        }
      }
    }

    // ── Per-weapon gravity ──────────────────────────────────────────────
    if (def.gravity && !p.physicsBody) {
      p.velocity.y += def.gravity * dt;
    }

    // ── Per-weapon drag ─────────────────────────────────────────────────
    if (def.drag && def.drag < 1 && !p.physicsBody) {
      p.velocity.scaleInPlace(Math.pow(def.drag, dt * 60));
    }

    // ── Tornado gravitational pull — continuous suction on nearby karts ──
    if (def.pullRadius > 0 && def.pullForce > 0) {
      _applyTornadoPull(p.mesh.position, def.pullRadius, def.pullForce, def.spinForce || 0, dt, playerCar);
    }

    // ── Position update — physics-driven or manual ───────────────────────
    if (p.physicsBody && p.physicsBody.body) {
      // Read velocity from physics engine for sync
      const physVel = p.physicsBody.body.getLinearVelocity();
      if (physVel) {
        p.velocity.copyFrom(physVel);
      }
      // Position is updated by the physics engine automatically
    } else {
      p.mesh.position.x += p.velocity.x * dt;
      p.mesh.position.y += p.velocity.y * dt;
      p.mesh.position.z += p.velocity.z * dt;
    }

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

// ── Find nearest enemy for homing ───────────────────────────────────────────
function findNearestEnemy(fromPos) {
  const ms = state.multiplayerState;
  const opps = ms?.opponentCars || {};
  let nearest = null;
  let minDistSq = Infinity;
  Object.values(opps).forEach(opp => {
    if (!opp.model?.visible) return;
    const dx = opp.model.position.x - fromPos.x;
    const dy = opp.model.position.y - fromPos.y;
    const dz = opp.model.position.z - fromPos.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq < minDistSq) { minDistSq = distSq; nearest = opp.model.position; }
  });
  return nearest;
}

// ── Hit detection with blast radius ─────────────────────────────────────────
function checkHits(proj, projIdx) {
  const ms = state.multiplayerState;
  const opps = ms?.opponentCars || {};
  const pp = proj.mesh.position;
  const def = WEAPON_TYPES[proj.type] || {};
  const hitRadius = (def.radius || 0.5) + CAR_HIT_RADIUS;
  const victims = [];

  Object.entries(opps).forEach(([pid, opp]) => {
    if (!opp.model?.visible) return;
    const dx = opp.model.position.x - pp.x;
    const dy = opp.model.position.y - pp.y;
    const dz = opp.model.position.z - pp.z;
    if ((dx * dx + dy * dy + dz * dz) <= (hitRadius * hitRadius))
      victims.push(pid);
  });

  if (victims.length) {
    // Direct hit damage
    if (typeof ms.broadcastDamageEvent === 'function') ms.broadcastDamageEvent(victims, proj.damage, 'weapon:' + proj.type);

    // ── Explosion / blast radius ──────────────────────────────────────
    if (def.blastRadius > 0) {
      applyBlastForce(pp, def.blastRadius, def.blastForce, victims);
    }

    broadcastProjHit(proj, victims);
    destroyProj(projIdx);
  }
}

// ── Tornado gravitational pull — continuous suction on nearby karts ──────────
const _tmpPull = new Vector3();
const _tmpTangent = new Vector3();
function _applyTornadoPull(center, radius, force, spinForce, dt, playerCar) {
  const ms = state.multiplayerState;
  const opps = ms?.opponentCars || {};
  const scaledDt = Math.min(dt, 0.033); // cap to avoid tunneling on lag spikes

  // Helper: apply pull + tangential spin to a position
  const _pullTarget = (pos) => {
    const dx = center.x - pos.x;
    const dz = center.z - pos.z;
    const distSq = dx * dx + dz * dz;
    const dist = Math.sqrt(distSq);
    if (dist < 0.5 || dist > radius) return null;

    // Inverse-distance falloff (clamped near center to avoid singularity)
    const falloff = 1.0 - (dist / radius);
    const strength = force * falloff * falloff; // quadratic for natural tornado feel

    // Radial pull toward center
    _tmpPull.set(dx / dist, 0, dz / dist);
    _tmpPull.scaleInPlace(strength * scaledDt);

    // Tangential spin component (perpendicular to radial, counter-clockwise)
    if (spinForce > 0) {
      _tmpTangent.set(-dz / dist, 0, dx / dist);
      _tmpTangent.scaleInPlace(spinForce * falloff * scaledDt);
      _tmpPull.addInPlace(_tmpTangent);
    }

    // Slight upward lift near center
    if (dist < radius * 0.35) {
      _tmpPull.y += 1.5 * falloff * scaledDt;
    }

    return _tmpPull;
  };

  // Pull opponents
  Object.values(opps).forEach(opp => {
    if (!opp.model?.visible) return;
    const pull = _pullTarget(opp.model.position);
    if (!pull) return;
    if (opp.model.physicsBody && typeof opp.model.physicsBody.applyImpulse === 'function') {
      opp.model.physicsBody.applyImpulse(pull.scale(0.6), opp.model.position);
    } else {
      opp.model.position.addInPlace(pull.scale(0.12));
    }
  });

  // Pull local player (if not the shooter — check if projectile is not remote)
  if (playerCar) {
    const pull = _pullTarget(playerCar.position);
    if (pull) {
      if (playerCar.physicsBody && typeof playerCar.physicsBody.applyImpulse === 'function') {
        playerCar.physicsBody.applyImpulse(pull.scale(0.4), playerCar.position);
      } else {
        playerCar.position.addInPlace(pull.scale(0.08));
      }
    }
  }
}

// ── Explosion radial force ──────────────────────────────────────────────────
function applyBlastForce(center, radius, force, alreadyHitIds) {
  const ms = state.multiplayerState;
  const opps = ms?.opponentCars || {};
  const radiusSq = radius * radius;

  // Apply to all cars in blast radius (including those not directly hit for splash damage)
  Object.entries(opps).forEach(([pid, opp]) => {
    if (!opp.model?.visible) return;
    const dx = opp.model.position.x - center.x;
    const dy = opp.model.position.y - center.y;
    const dz = opp.model.position.z - center.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq > radiusSq) return;
    const dist = Math.sqrt(distSq);

    // Falloff: force decreases linearly with distance
    const falloff = 1 - (dist / radius);
    if (dist > 0.0001) {
      _tmpBlastDir.set(dx / dist, dy / dist, dz / dist);
    } else {
      _tmpBlastDir.set(0, 1, 0);
    }
    const impulse = _tmpBlastDir.scale(force * falloff);

    // Apply impulse to physics body if available
    if (opp.model.physicsBody && typeof opp.model.physicsBody.applyImpulse === 'function') {
      opp.model.physicsBody.applyImpulse(impulse, opp.model.position);
    } else {
      // Fallback: directly nudge position (for non-physics cars)
      opp.model.position.addInPlace(impulse.scale(0.1));
    }

    // Splash damage to cars in blast but not directly hit
    if (!alreadyHitIds.includes(pid) && typeof ms.broadcastDamageEvent === 'function') {
      const splashDmg = Math.max(5, Math.round(falloff * 15));
      ms.broadcastDamageEvent([pid], splashDmg, 'blast');
    }
  });
}

function destroyProj(i) {
  if (i < 0 || i >= state.projectiles.length) return;
  const p = state.projectiles[i];
  // Release trail particle emitter back to pool
  if (p.trail) releaseTrail(p.trail);
  // Dispose model-owned particle systems (fireball trail, glow_thrower streams, etc.)
  if (p.mesh?.metadata) {
    const md = p.mesh.metadata;
    for (const key of ['trailPS', 'sparksPS', 'dripsPS']) {
      if (md[key]) { try { md[key].stop(); md[key].dispose(); } catch {} }
    }
    // Remove super_nova expand observer
    if (md.expandObserver && state.scene) {
      try { state.scene.onBeforeRenderObservable.remove(md.expandObserver); } catch {}
    }
  }
  // Unregister rotation batch entry
  if (p._disposeRotation) { try { p._disposeRotation(); } catch {} }
  // Dispose physics aggregate if present
  if (p.physicsBody) {
    try { p.physicsBody.dispose(); } catch {}
    _physicsBodyCount = Math.max(0, _physicsBodyCount - 1);
  }
  // Release mesh back to pool instead of disposing
  if (p.mesh) releasePoolMesh(p.mesh);
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
