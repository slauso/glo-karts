/**
 * weapon-inventory.js — Shared per-player weapon inventory & cooldown system.
 *
 * Manages weapon slots, pickup registration, firing logic, and cooldowns.
 * Used by both player input path and AI firing policy.
 */

// ── Weapon catalogue (mirrors race-items.js WEAPONS) ────────────────────────
export const WEAPON_DEFS = {
  bowling_ball: { name: 'Bowling Ball', icon: '🎳', category: 'projectile', speed: 30, damage: 50, lifetime: 6, bounces: 3, cooldown: 0.5 },
  cake:         { name: 'Cake',         icon: '🎂', category: 'projectile', speed: 24, damage: 30, lifetime: 4, bounces: 0, cooldown: 0.4 },
  plunger:      { name: 'Plunger',      icon: '🪠', category: 'projectile', speed: 55, damage: 15, lifetime: 3.5, bounces: 0, cooldown: 0.3 },
  missile:      { name: 'Missile',      icon: '🚀', category: 'homing',     speed: 48, damage: 35, lifetime: 4, bounces: 0, cooldown: 0.6 },
  banana:       { name: 'Banana',       icon: '🍌', category: 'trap',       speed: 0,  damage: 5,  lifetime: 18, bounces: 0, cooldown: 0.2 },
  bubblegum:    { name: 'Bubblegum',    icon: '🫧', category: 'trap',       speed: 0,  damage: 10, lifetime: 15, bounces: 0, cooldown: 0.2 },
  zipper:       { name: 'Zipper',       icon: '⚡', category: 'buff',       speed: 0,  damage: 0,  lifetime: 0, bounces: 0, cooldown: 0, boostFactor: 1.6, boostDuration: 3.0 },
  shield:       { name: 'Shield',       icon: '🛡️', category: 'defence',    speed: 0,  damage: 0,  lifetime: 10, bounces: 0, cooldown: 0 },
  swatter:      { name: 'Swatter',      icon: '🪰', category: 'melee',      speed: 0,  damage: 40, lifetime: 0, bounces: 0, cooldown: 1.0, hitRadius: 6 },
};

// Position-weighted draw tables (mirrors race-items.js)
const BACK_WEIGHTS  = { bowling_ball: 3, cake: 3, missile: 4, plunger: 2, banana: 1, bubblegum: 1, zipper: 5, shield: 2, swatter: 2 };
const MID_WEIGHTS   = { bowling_ball: 3, cake: 2, missile: 2, plunger: 2, banana: 3, bubblegum: 3, zipper: 2, shield: 3, swatter: 2 };
const FRONT_WEIGHTS = { bowling_ball: 1, cake: 1, missile: 1, plunger: 1, banana: 5, bubblegum: 4, zipper: 1, shield: 4, swatter: 1 };

/**
 * Draw a random weapon based on race position.
 * @param {number} positionRatio 0 = last place, 1 = first place
 * @returns {{ id: string, def: object }}
 */
export function drawWeapon(positionRatio) {
  let weights;
  if (positionRatio > 0.66) weights = FRONT_WEIGHTS;
  else if (positionRatio > 0.33) weights = MID_WEIGHTS;
  else weights = BACK_WEIGHTS;

  const entries = Object.entries(weights);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let roll = Math.random() * total;
  for (const [id, w] of entries) {
    roll -= w;
    if (roll <= 0) return { id, def: WEAPON_DEFS[id] };
  }
  return { id: 'banana', def: WEAPON_DEFS.banana };
}

/**
 * Per-entity weapon inventory with cooldown tracking.
 */
export class WeaponSlot {
  constructor(ownerId) {
    this.ownerId = ownerId;
    /** @type {string|null} */
    this.weaponId = null;
    /** @type {object|null} */
    this.def = null;
    this.cooldownRemaining = 0;
    /** @type {object|null} Active buff (shield/boost) */
    this.activeBuff = null;
    this.buffTimer = 0;
  }

  /** Pick up a weapon. */
  equip(weaponId) {
    const def = WEAPON_DEFS[weaponId];
    if (!def) return false;
    this.weaponId = weaponId;
    this.def = def;
    return true;
  }

  /** @returns {boolean} Whether a weapon is held and off cooldown. */
  canFire() {
    return this.weaponId !== null && this.cooldownRemaining <= 0;
  }

  /**
   * Use the current weapon. Returns fire spec or null.
   * @param {{ x:number, y:number, z:number, heading:number }} origin
   * @param {string} [targetId] — for homing weapons
   * @returns {object|null}
   */
  fire(origin, targetId) {
    if (!this.canFire()) return null;

    const def = this.def;
    const wId = this.weaponId;
    this.weaponId = null;
    this.def = null;
    this.cooldownRemaining = def.cooldown || 0;

    if (def.category === 'buff') {
      this.activeBuff = { type: wId, factor: def.boostFactor || 1, duration: def.boostDuration || 3 };
      this.buffTimer = this.activeBuff.duration;
      return { type: 'buff', weaponId: wId, ownerId: this.ownerId };
    }

    if (def.category === 'defence') {
      this.activeBuff = { type: wId, duration: def.lifetime || 10 };
      this.buffTimer = this.activeBuff.duration;
      return { type: 'shield', weaponId: wId, ownerId: this.ownerId };
    }

    if (def.category === 'trap') {
      return {
        type: 'trap',
        weaponId: wId,
        ownerId: this.ownerId,
        x: origin.x - Math.sin(origin.heading) * 3,
        y: origin.y,
        z: origin.z - Math.cos(origin.heading) * 3,
        lifetime: def.lifetime,
        damage: def.damage,
      };
    }

    if (def.category === 'melee') {
      return {
        type: 'melee',
        weaponId: wId,
        ownerId: this.ownerId,
        hitRadius: def.hitRadius || 6,
        damage: def.damage,
        x: origin.x,
        y: origin.y,
        z: origin.z,
      };
    }

    // Projectile or homing
    const vx = Math.sin(origin.heading) * def.speed;
    const vz = Math.cos(origin.heading) * def.speed;
    return {
      type: def.category === 'homing' ? 'homing' : 'ballistic',
      weaponId: wId,
      ownerId: this.ownerId,
      targetId: def.category === 'homing' ? targetId : null,
      x: origin.x,
      y: origin.y + 1,
      z: origin.z,
      vx,
      vy: 0,
      vz,
      speed: def.speed,
      damage: def.damage,
      lifetime: def.lifetime,
      bounces: def.bounces,
    };
  }

  /** Per-frame tick. */
  update(dt) {
    if (this.cooldownRemaining > 0) {
      this.cooldownRemaining = Math.max(0, this.cooldownRemaining - dt);
    }
    if (this.activeBuff) {
      this.buffTimer -= dt;
      if (this.buffTimer <= 0) {
        this.activeBuff = null;
        this.buffTimer = 0;
      }
    }
  }

  /** @returns {boolean} Whether a speed boost buff is active. */
  hasBoost() {
    return this.activeBuff?.type === 'zipper';
  }

  /** @returns {number} Boost multiplier (1.0 if none). */
  getBoostFactor() {
    return this.hasBoost() ? (this.activeBuff.factor || 1.6) : 1.0;
  }

  /** @returns {boolean} Whether a shield is active. */
  hasShield() {
    return this.activeBuff?.type === 'shield';
  }
}

/**
 * Manages all weapon slots across multiple entities (player + bots).
 */
export class WeaponInventory {
  constructor() {
    /** @type {Map<string, WeaponSlot>} */
    this.slots = new Map();
  }

  /** Get or create a slot for the entity. */
  getSlot(ownerId) {
    if (!this.slots.has(ownerId)) {
      this.slots.set(ownerId, new WeaponSlot(ownerId));
    }
    return this.slots.get(ownerId);
  }

  /** Tick all slots. */
  update(dt) {
    for (const slot of this.slots.values()) {
      slot.update(dt);
    }
  }

  /** Dispose all slots. */
  dispose() {
    this.slots.clear();
  }
}
