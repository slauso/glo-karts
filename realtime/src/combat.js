/**
 * combat.js — Shared combat / pickup / effect system for RaceRoom & BattleRoom.
 *
 * Full STK-inspired weapon catalogue:
 *   PROJECTILES   — bowling_ball, cake, plunger, nitro, missile
 *   TRAPS         — bubblegum, banana (back-drops)
 *   MELEE         — swatter (close-range smash)
 *   DEBUFF        — parachute (slow leader), anchor (weight target)
 *   BUFF          — ludicrous_mode (100% top speed for 5s)
 *   DEFENCE       — shield (absorb one hit)
 *
 * Weighted item distribution is position-aware:
 *   Players further back get stronger offensive / recovery items.
 *   Players in front get more defensive / trap items.
 */

import { EntityState } from "./schema/EntityState.js";
import {
  computeDistanceSqToKart,
  getKartCenter,
  segmentIntersectsMovingKart,
} from "./kart-combat.js";

// ---------------------------------------------------------------------------
// Weapon catalogue
// ---------------------------------------------------------------------------
export const WEAPONS = {
  /* ─── Projectiles ─────────────────────────────────────────────────────── */
  bowling_ball: {
    category: "projectile",
    speed: 30,
    damage: 50,
    lifespan: 6000,
    cooldown: 700,
    ammo: 1,
    gravity: 0,
    bounces: 3,
    desc: "Heavy ball that rolls forward and bounces off walls",
  },
  cake: {
    category: "projectile",
    speed: 24,
    damage: 30,
    lifespan: 4000,
    cooldown: 500,
    ammo: 1,
    gravity: -12,
    bounces: 0,
    desc: "Lobbed in a high arc — splash on landing",
  },
  plunger: {
    category: "projectile",
    speed: 55,
    damage: 15,
    lifespan: 3500,
    cooldown: 400,
    ammo: 1,
    gravity: 0,
    bounces: 0,
    effect: "blind",
    effectDuration: 2500,
    desc: "Fast straight shot — sticks on face and blinds",
  },
  nitro: {
    category: "projectile",
    speed: 22,
    damage: 25,
    lifespan: 5000,
    cooldown: 600,
    ammo: 1,
    gravity: -9.8,
    bounces: 1,
    effect: "spinout",
    effectDuration: 1200,
    desc: "Explosive nitro bottle — spins out target",
  },
  missile: {
    category: "projectile",
    speed: 38,
    damage: 35,
    lifespan: 7600,
    cooldown: 600,
    ammo: 1,
    gravity: 0,
    bounces: 0,
    homing: true,
    homingTurnRate: 6.8,      // radians/sec — tighter fighter-jet lock curve
    homingDelay: 80,          // ms before homing kicks in (brief straight launch)
    lockOnRange: 96,
    lockOnMinDot: 0.34,
    leadScale: 0.92,
    maxLeadTime: 0.95,
    reacquireTarget: true,
    collisionRadius: 2.8,
    effect: "spinout",
    effectDuration: 1000,
    desc: "Homing missile — locks onto nearest rival and tracks them down",
  },
  cannon: {
    category: "projectile",
    speed: 52,
    damage: 40,
    lifespan: 4200,
    cooldown: 550,
    ammo: 8,
    gravity: -4,
    bounces: 0,
    reloadTimeMs: 2200,
    desc: "Heavy cannon round with premium recoil and a shallow ballistic arc.",
  },
  frostAxe: {
    category: "projectile",
    speed: 38,
    damage: 24,
    lifespan: 3000,
    cooldown: 240,
    ammo: 15,
    gravity: 0,
    bounces: 0,
    effect: "slow",
    effectDuration: 1200,
    slowFactor: 0.72,
    reloadTimeMs: 1500,
    desc: "Fast frost shard that chills movement on hit.",
  },
  moltenDagger: {
    category: "projectile",
    speed: 62,
    damage: 14,
    lifespan: 2200,
    cooldown: 110,
    ammo: 30,
    gravity: 0,
    bounces: 0,
    reloadTimeMs: 1000,
    desc: "High-velocity molten dart tuned for sustained fire.",
  },
  pirateleportation: {
    category: "utility",
    speed: 0,
    damage: 0,
    lifespan: 0,
    cooldown: 1200,
    ammo: 1,
    effect: "pirateleportation",
    effectDuration: 0,
    desc: "Teleport-steals a random opponent's held weapon and warps it to you.",
  },

  /* ─── Traps (drop behind) ────────────────────────────────────────────── */
  bubblegum: {
    category: "trap",
    speed: 0,
    damage: 10,
    lifespan: 15000,
    cooldown: 300,
    ammo: 1,
    gravity: 0,
    bounces: 0,
    effect: "stuck",
    effectDuration: 1800,
    desc: "Dropped behind — glues anyone who drives over it",
  },
  banana: {
    category: "trap",
    speed: 0,
    damage: 5,
    lifespan: 18000,
    cooldown: 300,
    ammo: 1,
    gravity: 0,
    bounces: 0,
    effect: "spinout",
    effectDuration: 1400,
    desc: "Classic banana peel — spins out whoever hits it",
  },

  /* ─── Melee (close range) ────────────────────────────────────────────── */
  swatter: {
    category: "melee",
    speed: 0,
    damage: 40,
    lifespan: 0,
    cooldown: 1200,
    ammo: 1,
    hitRadius: 6,
    effect: "squash",
    effectDuration: 1500,
    desc: "Giant fly-swatter slap — squishes nearby karts",
  },

  /* ─── Debuffs (target others at range, no projectile) ─────────────────── */
  parachute: {
    category: "debuff",
    speed: 0,
    damage: 0,
    lifespan: 0,
    cooldown: 0,
    ammo: 1,
    effect: "slow",
    effectDuration: 4000,
    slowFactor: 0.45,
    desc: "Attaches to the player directly ahead — drags them back",
  },
  anchor: {
    category: "debuff",
    speed: 0,
    damage: 0,
    lifespan: 0,
    cooldown: 0,
    ammo: 1,
    effect: "heavy",
    effectDuration: 5000,
    slowFactor: 0.35,
    steerFactor: 0.5,
    desc: "Heavy anchor on nearest rival — slows & hurts handling",
  },

  /* ─── Buff (self) ─────────────────────────────────────────────────────── */
  ludicrous_mode: {
    category: "buff",
    speed: 0,
    damage: 0,
    lifespan: 0,
    cooldown: 0,
    ammo: 1,
    effect: "ludicrous",
    effectDuration: 5000,
    boostFactor: 2.0,
    desc: "Ludicrous Mode — taps full battery power for 100% top speed boost for 5 seconds.",
  },

  /* ─── Defence ─────────────────────────────────────────────────────────── */
  shield: {
    category: "defence",
    speed: 0,
    damage: 0,
    lifespan: 0,
    cooldown: 0,
    ammo: 1,
    shieldHP: 100,
    desc: "Dynamic forcefield — absorbs damage like body armor, green→red as HP drains.",
  },
  mirror_realm: {
    category: "defence",
    speed: 0,
    damage: 0,
    lifespan: 6500,
    cooldown: 1500,
    ammo: 1,
    effect: "mirror",
    effectDuration: 6500,
    desc: "Reflects the next incoming projectile back at the attacker.",
  },
  phase_shift: {
    category: "defence",
    speed: 0,
    damage: 0,
    lifespan: 0,
    cooldown: 1600,
    ammo: 1,
    effect: "phase_shift_swap",
    effectDuration: 0,
    desc: "Swaps positions with another live rival in the arena.",
  },
  memory_leak: {
    category: "utility",
    speed: 0,
    damage: 0,
    lifespan: 0,
    cooldown: 1450,
    ammo: 1,
    effect: "memory_leak",
    effectDuration: 0,
    desc: "Steals the nearest rival's held weapon and ammo.",
  },
  gravity_well: {
    category: "zone",
    speed: 0,
    damage: 10,
    lifespan: 4200,
    cooldown: 1550,
    ammo: 1,
    spawnOffset: 5.5,
    radius: 12,
    singularityRadius: 12,
    pullStrength: 24,
    damageTickMs: 200,
    desc: "Creates a lingering singularity that drags nearby rivals inward.",
  },
  weather_dominion: {
    category: "utility",
    speed: 0,
    damage: 0,
    lifespan: 6500,
    cooldown: 1700,
    ammo: 1,
    effect: "arena_weather",
    effectDuration: 6500,
    desc: "Forces a temporary arena weather anomaly.",
  },

  /* ─── Wizard-Masters Elemental Weapons ────────────────────────────────── */
  fireball: {
    category: "projectile",
    speed: 36,
    damage: 42,
    lifespan: 4500,
    cooldown: 520,
    ammo: 1,
    gravity: 0,
    bounces: 0,
    collisionRadius: 3.0,
    effect: "burn",
    effectDuration: 2000,
    desc: "Blazing fireball with lingering burn damage",
  },
  toxic_spread: {
    category: "spread",
    speed: 26,
    damage: 22,
    lifespan: 3500,
    cooldown: 700,
    ammo: 1,
    gravity: 0,
    bounces: 0,
    spreadCount: 3,
    spreadAngle: 0.17,
    collisionRadius: 2.4,
    effect: "poison",
    effectDuration: 3000,
    desc: "Three toxic projectiles in a fan — leave poison puddles",
  },
  ice_lance: {
    category: "projectile",
    speed: 55,
    damage: 34,
    lifespan: 3000,
    cooldown: 430,
    ammo: 1,
    gravity: 0,
    bounces: 0,
    collisionRadius: 2.5,
    effect: "freeze",
    effectDuration: 2200,
    desc: "Fast ice shard that freezes on contact",
  },
  tornado: {
    category: "projectile",
    speed: 14,
    damage: 32,
    lifespan: 9000,
    cooldown: 950,
    ammo: 1,
    gravity: 0,
    bounces: 0,
    pullRadius: 16,
    pullStrength: 34,
    damageTickMs: 200,
    collisionRadius: 4.0,
    effect: "spinout",
    effectDuration: 2200,
    desc: "Massive slow-moving vortex that sucks in and devastates nearby karts",
  },
  super_nova: {
    category: "zone",
    speed: 0,
    damage: 62,
    lifespan: 3400,
    cooldown: 1250,
    ammo: 1,
    spawnOffset: 1.75,
    radius: 18,
    singularityRadius: 18,
    detonateAtMs: 3000,
    desc: "Final Fusion — drop a timed fusion bomb that detonates in a mushroom-cloud blast",
  },
  rock_barrage: {
    category: "spread",
    speed: 20,
    damage: 34,
    lifespan: 5500,
    cooldown: 700,
    ammo: 1,
    gravity: 0,
    bounces: 0,
    spreadCount: 1,
    spreadAngle: 0,
    collisionRadius: 3.0,
    floorAnchored: true,
    desc: "A single heavy boulder that hugs the arena floor and rolls until it shatters",
  },
  lightning_bolt: {
    category: "projectile",
    speed: 78,
    damage: 38,
    lifespan: 1200,
    cooldown: 850,
    ammo: 1,
    gravity: 0,
    bounces: 0,
    homing: true,
    homingTurnRate: 12.5,
    homingDelay: 0,
    lockOnRange: 42,
    lockOnMinDot: 0.12,
    leadScale: 0.38,
    maxLeadTime: 0.35,
    reacquireTarget: true,
    collisionRadius: 2.6,
    effect: "stun",
    effectDuration: 1800,
    desc: "Lock-on lightning arc that pins a nearby rival in place",
  },
  wind_slash: {
    category: "projectile",
    speed: 50,
    damage: 26,
    lifespan: 2000,
    cooldown: 320,
    ammo: 4,
    gravity: 0,
    bounces: 0,
    collisionRadius: 2.8,
    effect: "knockback",
    effectDuration: 600,
    knockbackForce: 14,
    reloadTimeMs: 800,
    desc: "Quick wind blade — pushes targets back on hit",
  },
  toxic_cloud: {
    category: "zone",
    speed: 0,
    damage: 12,
    lifespan: 7500,
    cooldown: 1000,
    ammo: 1,
    spawnOffset: 5,
    radius: 10,
    singularityRadius: 10,
    pullStrength: 0,
    damageTickMs: 220,
    effect: "poison",
    effectDuration: 2000,
    desc: "Lingers in place dealing damage over time to all inside",
  },

  /* ─── GLO Weapons (continuous fire) ───────────────────────────────────── */
  glow_thrower: {
    category: "stream",
    speed: 34,
    damage: 5,
    lifespan: 320,
    cooldown: 40,
    ammo: 10,
    gravity: 0,
    bounces: 0,
    collisionRadius: 3.4,
    continuous: true,
    streamLength: 18,
    streamSpread: 0.16,
    streamSpreadGrowth: 0.12,
    effect: "burn",
    effectDuration: 1200,
    desc: "Front-mounted napalm stream reaching roughly four kart lengths ahead.",
  },
  glo_burst: {
    category: "stream",
    speed: 110,
    damage: 2,
    lifespan: 240,
    cooldown: 32,
    ammo: 180,
    gravity: 0,
    bounces: 0,
    collisionRadius: 1.3,
    continuous: true,
    isDefaultWeapon: true,
    heatPerShot: 0.85,
    streamLength: 18,
    streamSpread: 0.08,
    streamSpreadGrowth: 0.22,
    desc: "Rapid-fire tracer stream with growing spread over distance.",
  },
};

const WEAPON_KEYS = Object.keys(WEAPONS);
export const BATTLE_WEAPON_POOL = [
  "ludicrous_mode", "shield",
  "pirateleportation", "mirror_realm", "phase_shift", "memory_leak", "gravity_well", "weather_dominion",
  "missile", "missile",
  "fireball", "fireball",
  "toxic_spread", "toxic_spread",
  "ice_lance", "ice_lance",
  "tornado", "tornado", "tornado",
  "super_nova",
  "rock_barrage", "rock_barrage",
  "lightning_bolt", "lightning_bolt",
  "wind_slash", "wind_slash",
  "toxic_cloud",
  "glow_thrower", "glow_thrower",
];
export const RACE_WEAPON_POOL = [
  "bowling_ball", "cake", "plunger", "nitro", "missile",
  "bubblegum", "banana", "swatter", "parachute", "anchor",
  "ludicrous_mode", "shield",
];

// ---------------------------------------------------------------------------
// Position-aware weighted item draw
// ---------------------------------------------------------------------------
const BACK_WEIGHTS = {
  bowling_ball: 3, cake: 3, missile: 4, nitro: 3, plunger: 2,
  bubblegum: 1, banana: 1, swatter: 2, parachute: 1, anchor: 2,
  ludicrous_mode: 4, shield: 2,
  pirateleportation: 2, mirror_realm: 1, phase_shift: 1, memory_leak: 1, gravity_well: 1, weather_dominion: 1,
  fireball: 3, toxic_spread: 2, ice_lance: 3, tornado: 2,
  super_nova: 2, rock_barrage: 3, lightning_bolt: 2, wind_slash: 2, toxic_cloud: 1,
  glow_thrower: 3, glo_burst: 0,
};
const MID_WEIGHTS = {
  bowling_ball: 3, cake: 2, missile: 2, nitro: 2, plunger: 2,
  bubblegum: 3, banana: 3, swatter: 2, parachute: 2, anchor: 2,
  ludicrous_mode: 1, shield: 2,
  pirateleportation: 2, mirror_realm: 0.35, phase_shift: 0.45, memory_leak: 0.35, gravity_well: 0.35, weather_dominion: 0.35,
  fireball: 4, toxic_spread: 3, ice_lance: 4, tornado: 3,
  super_nova: 2, rock_barrage: 3, lightning_bolt: 3, wind_slash: 4, toxic_cloud: 1,
  glow_thrower: 3, glo_burst: 0,
};
const FRONT_WEIGHTS = {
  bowling_ball: 1, cake: 1, missile: 1, nitro: 1, plunger: 1,
  bubblegum: 4, banana: 5, swatter: 1, parachute: 3, anchor: 3,
  ludicrous_mode: 1, shield: 4,
  pirateleportation: 1, mirror_realm: 2, phase_shift: 2, memory_leak: 1, gravity_well: 1, weather_dominion: 1,
  fireball: 1, toxic_spread: 1, ice_lance: 1, tornado: 1,
  super_nova: 1, rock_barrage: 1, lightning_bolt: 1, wind_slash: 1, toxic_cloud: 2,
  glow_thrower: 1, glo_burst: 0,
};
const BATTLE_POOL_SET = new Set(BATTLE_WEAPON_POOL);
const BATTLE_PICKUP_WEIGHTS = {
  ludicrous_mode: 0.4,
  shield: 0.7,
  pirateleportation: 1.4,
  mirror_realm: 0.2,
  phase_shift: 0.2,
  memory_leak: 0.35,
  gravity_well: 0.35,
  weather_dominion: 0.35,
  missile: 3.0,
  fireball: 3.8,
  toxic_spread: 1.2,
  ice_lance: 4.2,
  tornado: 3.6,
  super_nova: 1.8,
  rock_barrage: 3.6,
  lightning_bolt: 4.4,
  wind_slash: 3.4,
  toxic_cloud: 0.8,
  glow_thrower: 2.4,
};

function weightedRandom(weights) {
  let total = 0;
  for (const w of Object.values(weights)) total += w;
  let r = Math.random() * total;
  for (const [key, w] of Object.entries(weights)) {
    r -= w;
    if (r <= 0) return key;
  }
  return WEAPON_KEYS[0];
}

// Monotonically increasing id to guarantee uniqueness within a room
let _projectileCounter = 0;

// ---------------------------------------------------------------------------
// grantWeapon – called when a player picks up an item box
// positionRatio: 0 = first place, 1 = last place
// ---------------------------------------------------------------------------
export function grantWeapon(player, positionRatio = 0.5, options = {}) {
  let weights;
  if (Array.isArray(options.pool) && options.pool.length) {
    const requestedPool = new Set(options.pool);
    const isBattlePool = requestedPool.size === BATTLE_POOL_SET.size
      && Array.from(requestedPool).every((key) => BATTLE_POOL_SET.has(key));
    if (isBattlePool) {
      weights = BATTLE_PICKUP_WEIGHTS;
    }
  }
  if (!weights && positionRatio < 0.33) weights = FRONT_WEIGHTS;
  else if (!weights && positionRatio > 0.66) weights = BACK_WEIGHTS;
  else if (!weights) weights = MID_WEIGHTS;

  const pool = Array.isArray(options.pool) && options.pool.length ? new Set(options.pool) : null;
  const filteredWeights = pool
    ? Object.fromEntries(Object.entries(weights).filter(([key]) => pool.has(key)))
    : weights;

  const rolled = weightedRandom(filteredWeights);
  const def = WEAPONS[rolled];

  // MK-style dual pickup: if secondary is occupied, fill reserve (weapon3)
  if (player.weapon2 && player.ammo2 > 0) {
    player.weapon3 = rolled;
    player.ammo3 = def.ammo;
    return rolled;
  }

  // Pickups go to secondary slot (weapon2)
  player.weapon2 = rolled;
  player.ammo2 = def.ammo;
  player.fireCooldown2 = 0;

  return rolled;
}

export function swapSecondaryWeapon(player) {
  if (!player) return false;

  const hasActive = !!player.weapon2 && player.ammo2 > 0;
  const hasReserve = !!player.weapon3 && player.ammo3 > 0;
  if (!hasReserve) return false;

  if (!hasActive) {
    player.weapon2 = player.weapon3;
    player.ammo2 = player.ammo3;
    player.fireCooldown2 = 0;
    player.weapon3 = "";
    player.ammo3 = 0;
    return true;
  }

  const activeWeapon = player.weapon2;
  const activeAmmo = player.ammo2;
  player.weapon2 = player.weapon3;
  player.ammo2 = player.ammo3;
  player.fireCooldown2 = 0;
  player.weapon3 = activeWeapon;
  player.ammo3 = activeAmmo;
  return true;
}

// ---------------------------------------------------------------------------
// handleFireWeapon – handles all weapon categories
// context.slot: "primary" (glo_burst, Space) or "secondary" (pickup, E key)
// Returns { projectile, effectApplied } or null.
// ---------------------------------------------------------------------------
export function handleFireWeapon(player, entitiesMap, playersMap, context = {}) {
  const slot = context.slot || "primary";
  let wepId, ammo, cooldown;
  if (slot === "secondary") {
    wepId = player.weapon2;
    ammo = player.ammo2;
    cooldown = player.fireCooldown2;
  } else {
    // Primary slot — glo_burst with overheat
    wepId = player.weapon;
    ammo = player.ammo;
    cooldown = player.fireCooldown;
    if (player.overheated) return null;
  }
  if (!wepId || ammo <= 0 || cooldown > 0) return null;
  const def = WEAPONS[wepId];
  if (!def) return null;
  const fireInput = context.fireInput || null;

  const result = { projectile: null, effectApplied: null, instantHits: [] };

  // ── Shield (defence) ─────────────────────────────────────────────────
  if (def.category === "defence") {
    if (wepId === "shield") {
      player.shielded = true;
      player.shieldHP = def.shieldHP || 100;
      player.effectType = "shielded";
      player.effectTimer = 0; // no time limit — HP based
    } else if (wepId === "mirror_realm") {
      player.reflectProjectiles = true;
      player.effectType = "mirror";
      player.effectTimer = def.effectDuration;
    } else if (wepId === "phase_shift") {
      const swapTarget = findPhaseShiftTarget(player, playersMap, fireInput);
      if (!swapTarget) return null;

      const origin = snapshotPlayerTransform(player);
      const destination = snapshotPlayerTransform(swapTarget);
      applyTeleportTransform(player, destination, origin);
      applyTeleportTransform(swapTarget, origin, destination);

      player.effectType = "";
      player.effectTimer = 0;
      swapTarget.effectType = "";
      swapTarget.effectTimer = 0;
      consumeAmmo(player, def, slot);
      result.effectApplied = {
        type: "phase_shift_swap",
        target: player.id,
        attackerId: player.id,
        partnerId: swapTarget.id,
        sourceX: player.x,
        sourceY: player.y,
        sourceZ: player.z,
        partnerX: swapTarget.x,
        partnerY: swapTarget.y,
        partnerZ: swapTarget.z,
        duration: 0,
      };
      return result;
    }
    consumeAmmo(player, def, slot);
    result.effectApplied = { type: player.effectType || "shielded", target: player.id, duration: player.effectTimer };
    return result;
  }

  // ── Buff (self-boost) ────────────────────────────────────────────────
  if (def.category === "buff") {
    player.speedMultiplier = def.boostFactor || 1.65;
    player.effectType = def.effect;
    player.effectTimer = def.effectDuration;
    consumeAmmo(player, def, slot);
    result.effectApplied = { type: def.effect, target: player.id, duration: def.effectDuration };
    return result;
  }

  // ── Debuff (parachute / anchor — target nearest rival) ───────────────
  if (def.category === "debuff") {
    const victim = findNearestRival(player, playersMap);
    if (victim) {
      applyEffect(victim, def);
      result.effectApplied = {
        type: def.effect,
        target: victim.id,
        attackerId: player.id,
        duration: def.effectDuration,
      };
    }
    consumeAmmo(player, def, slot);
    return result;
  }

  if (def.category === "utility") {
    if (wepId === "pirateleportation") {
      // Steal a rival's held pickup rather than replacing the always-on primary.
      const candidates = [];
      playersMap.forEach((p) => {
        const heldPickup = p.id !== player.id ? getHeldPickupSlot(p) : null;
        if (heldPickup) candidates.push({ victim: p, heldPickup });
      });
      consumeAmmo(player, def, slot);
      if (candidates.length > 0) {
        const { victim, heldPickup } = candidates[Math.floor(Math.random() * candidates.length)];
        const stolenWeapon = heldPickup.weapon;
        const stolenAmmo = heldPickup.ammo;
        storeHeldPickupWeapon(player, stolenWeapon, stolenAmmo);
        clearHeldPickupSlot(victim, heldPickup.slot);
        result.effectApplied = {
          type: "pirateleportation",
          target: victim.id,
          attackerId: player.id,
          stolenWeapon,
        };
      }
      return result;
    }

    if (wepId === "memory_leak") {
      const victim = findNearestRival(player, playersMap, (candidate) => !!getHeldPickupSlot(candidate));
      const stolenPickup = victim ? getHeldPickupSlot(victim) : null;
      const stolenWeapon = stolenPickup?.weapon || "";
      const stolenAmmo = stolenPickup?.ammo || 0;
      consumeAmmo(player, def, slot);
      if (victim && stolenPickup) {
        storeHeldPickupWeapon(player, stolenWeapon, stolenAmmo);
        clearHeldPickupSlot(victim, stolenPickup.slot);
        result.effectApplied = {
          type: "memory_leak",
          target: victim.id,
          attackerId: player.id,
          stolenWeapon,
        };
      }
      return result;
    }

    if (wepId === "weather_dominion") {
      if (context.roomState) {
        const nextWeather = Math.random() > 0.5 ? "fog" : "rain";
        context.roomState.arenaEffectType = nextWeather;
        context.roomState.arenaEffectTimer = def.effectDuration;
        result.effectApplied = {
          type: `arena_${nextWeather}`,
          target: "arena",
          attackerId: player.id,
          duration: def.effectDuration,
        };
      }
      consumeAmmo(player, def, slot);
      return result;
    }
  }

  // ── Melee (swatter — AOE around player) ──────────────────────────────
  if (def.category === "melee") {
    const melee = [];
    const hitRadiusSq = (def.hitRadius || 6) * (def.hitRadius || 6);
    playersMap.forEach((p) => {
      if (p.id === player.id) return;
      const dx = p.x - player.x;
      const dy = p.y - player.y;
      const dz = p.z - player.z;
      if (dx * dx + dy * dy + dz * dz < hitRadiusSq) {
        const effectApplied = buildWeaponEffectPayload(def);
        if (effectApplied?.type) {
          applyEffect(p, def);
        }
        result.instantHits.push({
          projectileId: "",
          ownerId: player.id,
          subType: wepId,
          victimId: p.id,
          victim: p,
          damage: def.damage,
          effectApplied,
          hitPoint: getKartCenter(p),
        });
        melee.push({ victimId: p.id, damage: def.damage });
      }
    });
    consumeAmmo(player, def, slot);
    result.effectApplied = { type: "melee_swatter", hits: melee, attackerId: player.id };
    return result;
  }

  // ── Trap (drop behind player) ────────────────────────────────────────
  if (def.category === "trap") {
    const fwd = resolveFireVector(player, fireInput);
    const id = `trap_${player.id.slice(0, 4)}_${++_projectileCounter}`;

    const ent = new EntityState();
    ent.id = id;
    ent.type = "projectile";
    ent.subType = wepId;
    ent.ownerId = player.id;
    ent.active = true;
    ent.damage = def.damage;
    ent.lifespan = def.lifespan;

    // Drop 3m behind the kart
    const trapOrigin = resolveProjectileOrigin(player, fireInput, fwd, -3, 0.3);
    ent.x = trapOrigin.x;
    ent.y = trapOrigin.y;
    ent.z = trapOrigin.z;

    ent.vx = 0;
    ent.vy = 0;
    ent.vz = 0;

    entitiesMap.set(id, ent);
    consumeAmmo(player, def, slot);
    result.projectile = ent;
    return result;
  }

  if (def.category === "zone") {
    const fwd = resolveFireVector(player, fireInput);
    const spawnOffset = def.spawnOffset || 4.5;
    const id = `zone_${player.id.slice(0, 4)}_${++_projectileCounter}`;

    const ent = new EntityState();
    ent.id = id;
    ent.type = "projectile";
    ent.subType = wepId;
    ent.ownerId = player.id;
    ent.active = true;
    ent.damage = def.damage;
    ent.lifespan = def.lifespan;
    const zoneOrigin = resolveProjectileOrigin(player, fireInput, fwd, spawnOffset, 0.5);
    ent.x = zoneOrigin.x;
    ent.y = wepId === "super_nova" ? Math.max(0.9, player.y - 1.0) : Math.max(1.2, zoneOrigin.y);
    ent.z = zoneOrigin.z;
    ent.vx = 0;
    ent.vy = 0;
    ent.vz = 0;

    entitiesMap.set(id, ent);
    consumeAmmo(player, def, slot);
    result.projectile = ent;
    return result;
  }

  // ── Spread (multi-projectile fan — toxic_spread, rock_barrage) ─────
  if (def.category === "spread") {
    const fwd = resolveFireVector(player, fireInput);
    const count = def.spreadCount || 3;
    const halfAngle = def.spreadAngle || 0.17;
    const SPAWN_OFFSET = 3.5;
    const projectileOrigin = resolveProjectileOrigin(player, fireInput, fwd, SPAWN_OFFSET, 1.0);
    const projectiles = [];

    for (let i = 0; i < count; i++) {
      const angle = count === 1 ? 0 : -halfAngle + (halfAngle * 2 * i) / (count - 1);
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      // Rotate forward vector around Y axis by angle
      const dx = fwd.x * cosA + fwd.z * sinA;
      const dz = -fwd.x * sinA + fwd.z * cosA;

      const id = `spread_${player.id.slice(0, 4)}_${++_projectileCounter}`;
      const ent = new EntityState();
      ent.id = id;
      ent.type = "projectile";
      ent.subType = wepId;
      ent.ownerId = player.id;
      ent.active = true;
      ent.damage = def.damage;
      ent.lifespan = def.lifespan;
      ent.x = projectileOrigin.x;
      ent.y = def.floorAnchored ? Math.max(0.95, player.y - 1.0) : projectileOrigin.y;
      ent.z = projectileOrigin.z;
      ent.vx = dx * def.speed;
      ent.vy = def.floorAnchored ? 0 : (def.gravity ? Math.max(fwd.y * def.speed, 8) : fwd.y * def.speed);
      ent.vz = dz * def.speed;
      entitiesMap.set(id, ent);
      projectiles.push(ent);
    }
    consumeAmmo(player, def, slot);
    result.projectile = projectiles[0];
    result.extraProjectiles = projectiles.slice(1);
    return result;
  }

  // ── Stream (continuous fire — glow_thrower, glo_burst) ──────────────
  if (def.category === "stream") {
    const fwd = resolveFireVector(player, fireInput);
    const streamDir = applyStreamSpread(fwd, def);
    const id = `stream_${player.id.slice(0, 4)}_${++_projectileCounter}`;

    const ent = new EntityState();
    ent.id = id;
    ent.type = "projectile";
    ent.subType = wepId;
    ent.ownerId = player.id;
    ent.active = true;
    ent.damage = def.damage;
    ent.lifespan = def.lifespan;

    const SPAWN_OFFSET = 2.5;
    const projectileOrigin = resolveProjectileOrigin(player, fireInput, streamDir, SPAWN_OFFSET, 0.8);
    ent.x = projectileOrigin.x;
    ent.y = projectileOrigin.y;
    ent.z = projectileOrigin.z;
    ent.vx = streamDir.x * def.speed;
    ent.vy = streamDir.y * def.speed;
    ent.vz = streamDir.z * def.speed;
    ent.streamLength = def.streamLength || 10;
    ent.streamRadius = (def.collisionRadius || 1.8) + (streamDir._spreadAmount || 0) * 2.5;

    entitiesMap.set(id, ent);
    consumeAmmo(player, def, slot);
    result.projectile = ent;
    return result;
  }

  // ── Projectile (forward-fired) ───────────────────────────────────────
  const fwd = resolveFireVector(player, fireInput);
  const id = `proj_${player.id.slice(0, 4)}_${++_projectileCounter}`;

  const ent = new EntityState();
  ent.id = id;
  ent.type = "projectile";
  ent.subType = wepId;
  ent.ownerId = player.id;
  ent.active = true;
  ent.damage = def.damage;
  ent.lifespan = def.lifespan;

  const SPAWN_OFFSET = 3.5;
  const projectileOrigin = resolveProjectileOrigin(player, fireInput, fwd, SPAWN_OFFSET, 1.0);
  ent.x = projectileOrigin.x;
  ent.y = projectileOrigin.y;
  ent.z = projectileOrigin.z;

  ent.vx = fwd.x * def.speed;
  ent.vy = def.gravity ? Math.max(fwd.y * def.speed, 8) : fwd.y * def.speed;
  ent.vz = fwd.z * def.speed;

  ent.rx = player.rx;
  ent.ry = player.ry;
  ent.rz = player.rz;
  ent.rw = player.rw;

  // Homing — lock onto nearest rival at fire time
  if (def.homing) {
    const requestedTargetId = String(fireInput?.targetId || "");
    const requestedTarget = requestedTargetId ? playersMap.get(requestedTargetId) : null;
    const target = isValidGuidanceTarget(requestedTarget, player.id)
      ? requestedTarget
      : findBestGuidanceTarget(
        { x: ent.x, y: ent.y, z: ent.z },
        { x: fwd.x, y: fwd.y, z: fwd.z },
        player.id,
        playersMap,
        def,
      );
    if (target) ent.targetId = target.id;
  }

  entitiesMap.set(id, ent);
  consumeAmmo(player, def, slot);
  result.projectile = ent;
  return result;
}

function resolveFireVector(player, fireInput) {
  const fallback = quatForward(player.rx, player.ry, player.rz, player.rw);
  const dx = Number(fireInput?.dirX);
  const dy = Number(fireInput?.dirY);
  const dz = Number(fireInput?.dirZ);

  if (![dx, dy, dz].every(Number.isFinite)) {
    return fallback;
  }

  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (length < 0.001) {
    return fallback;
  }

  const nx = dx / length;
  const ny = Math.max(-0.85, Math.min(0.85, dy / length));
  const nz = dz / length;
  const normalizedLength = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  return {
    x: nx / normalizedLength,
    y: ny / normalizedLength,
    z: nz / normalizedLength,
  };
}

function resolveProjectileOrigin(player, fireInput, forward, spawnOffset, defaultYOffset) {
  const ox = Number(fireInput?.originX);
  const oy = Number(fireInput?.originY);
  const oz = Number(fireInput?.originZ);
  const hasOrigin = [ox, oy, oz].every(Number.isFinite);

  const fallback = {
    x: player.x + forward.x * spawnOffset,
    y: player.y + defaultYOffset + Math.max(0, forward.y * spawnOffset),
    z: player.z + forward.z * spawnOffset,
  };

  if (!hasOrigin) {
    return fallback;
  }

  const dx = ox - player.x;
  const dy = oy - player.y;
  const dz = oz - player.z;
  const distSq = dx * dx + dy * dy + dz * dz;

  if (distSq > 36) {
    return fallback;
  }

  return {
    x: ox,
    y: oy,
    z: oz,
  };
}

// ---------------------------------------------------------------------------
// tickProjectiles – move projectiles, apply gravity, despawn, detect hits
// ---------------------------------------------------------------------------
function applyStreamSpread(forward, def = {}) {
  const spreadBase = Number(def.streamSpread || 0);
  const spreadGrowth = Number(def.streamSpreadGrowth || 0);
  const spreadAmount = spreadBase + Math.random() * spreadGrowth;
  if (spreadAmount <= 0) {
    return { ...forward, _spreadAmount: 0 };
  }

  const yaw = (Math.random() - 0.5) * spreadAmount;
  const pitch = (Math.random() - 0.5) * spreadAmount * 0.5;
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const dx = forward.x * cosYaw + forward.z * sinYaw;
  const dz = -forward.x * sinYaw + forward.z * cosYaw;
  const dy = Math.max(-0.55, Math.min(0.55, forward.y + pitch));
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;

  return {
    x: dx / length,
    y: dy / length,
    z: dz / length,
    _spreadAmount: spreadAmount,
  };
}

export function tickProjectiles(entitiesMap, playersMap, deltaTime, floorY = 0.35) {
  const dt = deltaTime / 1000;
  const hits = [];
  const toDelete = [];
  const arenaBoundary = 49.5;

  entitiesMap.forEach((e, id) => {
    if (e.type !== "projectile" || !e.active) return;

    const def = WEAPONS[e.subType];
    const previousPosition = { x: e.x, y: e.y, z: e.z };
    e._elapsedMs = Number(e._elapsedMs || 0) + deltaTime;

    // Tornado — moves forward and pulls nearby karts
    if (e.subType === "tornado") {
      const pullR = def?.pullRadius || 10;
      const pullRSq = pullR * pullR;
      playersMap.forEach((p) => {
        if (p.id === e.ownerId) return;
        const dx = e.x - p.x;
        const dz = e.z - p.z;
        const distSq = dx * dx + dz * dz;
        if (distSq > pullRSq || distSq < 0.5) return;
        const dist = Math.sqrt(distSq);
        const pull = (def?.pullStrength || 18) * dt * (1 - dist / pullR);
        p.vx += (dx / dist) * pull;
        p.vz += (dz / dist) * pull;
        if (computeDistanceSqToKart(e, p, 3.5) <= 1e-6) {
          emitPeriodicProjectileHit(hits, e, p, def, { hitPoint: getKartCenter(p) });
        }
      });
    }

    // Toxic cloud — lingers and damages all inside (zone-like but moves through tick)
    if (e.subType === "toxic_cloud") {
      const cloudR = def?.radius || 10;
      playersMap.forEach((p) => {
        if (p.id === e.ownerId) return;
        const distSq = computeDistanceSqToKart(e, p, cloudR);
        if (distSq > 1e-6) return;
        emitPeriodicProjectileHit(hits, e, p, def, { hitPoint: getKartCenter(p) });
      });
    }

    if (e.subType === "gravity_well") {
      const pullR = def?.radius || def?.singularityRadius || 12;
      const pullRSq = pullR * pullR;
      playersMap.forEach((p) => {
        if (p.id === e.ownerId) return;
        const dx = e.x - p.x;
        const dz = e.z - p.z;
        const distSq = dx * dx + dz * dz;
        if (distSq > pullRSq || distSq < 0.16) return;
        const dist = Math.sqrt(distSq);
        const pull = (def?.pullStrength || 24) * dt * (1 - dist / pullR);
        p.vx += (dx / dist) * pull;
        p.vz += (dz / dist) * pull;
        if (computeDistanceSqToKart(e, p, 3.1) <= 1e-6) {
          emitPeriodicProjectileHit(hits, e, p, def, { hitPoint: getKartCenter(p) });
        }
      });
    }

    if (e.subType === "super_nova" && !e._detonated) {
      const detonationThreshold = Math.max(350, def.lifespan - (def.detonateAtMs || 3000));
      if (e.lifespan <= detonationThreshold) {
        e._detonated = true;
        e.lifespan = Math.min(e.lifespan, 360);
        const fusionRadius = def?.radius || def?.singularityRadius || 18;
        playersMap.forEach((p) => {
          const distSq = computeDistanceSqToKart(e, p, fusionRadius);
          if (distSq > 1e-6) return;
          emitProjectileHit(hits, e, p, def?.damage || 0, def, {
            hitPoint: getKartCenter(p),
            effectApplied: null,
          });
        });
      }
    }

    // Homing steering — smoothly curve velocity toward target
    if (def && def.homing) {
      const elapsed = (def.lifespan - e.lifespan);
      if (elapsed > (def.homingDelay || 300)) {
        let target = playersMap.get(e.targetId);
        if (!isValidGuidanceTarget(target, e.ownerId) && def.reacquireTarget) {
          target = findBestGuidanceTarget(
            e,
            getVelocityDirection(e.vx, e.vy, e.vz),
            e.ownerId,
            playersMap,
            def,
          );
          e.targetId = target?.id || "";
        }
        if (isValidGuidanceTarget(target, e.ownerId)) {
          steerProjectileTowardTarget(e, target, def, dt);
        } else if (e.targetId) {
          // Target dead or gone — clear homing, fly straight
          e.targetId = "";
        }
      }
    }

    // 1. Move
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.z += e.vz * dt;

    if (e.subType === "rock_barrage") {
      e.y = floorY + 0.65;
      e.vy = 0;
      e.vx *= 0.998;
      e.vz *= 0.998;
      if (Math.abs(e.x) >= arenaBoundary || Math.abs(e.z) >= arenaBoundary) {
        toDelete.push(id);
        return;
      }
    }

    if (Math.abs(e.x) >= arenaBoundary || Math.abs(e.z) >= arenaBoundary) {
      toDelete.push(id);
      return;
    }

    // 2. Gravity (arced weapons like cake & nitro)
    if (def && def.gravity && e.subType !== "rock_barrage") {
      e.vy += def.gravity * dt;
      if (e.y <= floorY) {
        e.y = floorY;
        if (def.category === "trap") {
          e.vy = 0;
        } else {
          toDelete.push(id);
          return;
        }
      }
    }

    // 3. Lifespan countdown
    e.lifespan -= deltaTime;
    if (e.lifespan <= 0) {
      toDelete.push(id);
      return;
    }

    if (e.subType === "super_nova") {
      return;
    }

    if (e.subType === "tornado" || e.subType === "gravity_well" || e.subType === "toxic_cloud") {
      return;
    }

    // 4. Hit detection
    let hitStart = previousPosition;
    let hitEnd = e;
    let hitRadius = getHitRadius(def, e.subType);
    if (def?.category === "stream") {
      const streamDir = getVelocityDirection(e.vx, e.vy, e.vz);
      const streamLength = e.streamLength || def.streamLength || 10;
      hitStart = {
        x: e.x - streamDir.x * streamLength,
        y: e.y - streamDir.y * streamLength,
        z: e.z - streamDir.z * streamLength,
      };
      hitRadius = Math.max(hitRadius, Number(e.streamRadius || 0));
    }
    let resolvedHit = false;
    playersMap.forEach((p) => {
      if (resolvedHit) return;
      if (p.id === e.ownerId) return;
      if (!segmentIntersectsMovingKart(hitStart, hitEnd, p, deltaTime, hitRadius)) return;

      if (p.phased) return;

      if (p.reflectProjectiles) {
        const attacker = playersMap.get(e.ownerId);
        const reflectedProjectile = cloneReflectedProjectile(e, p, playersMap) || {
          ...e,
          ownerId: p.id,
          x: p.x,
          y: p.y + 1.0,
          z: p.z,
        };
        reflectedProjectile.ownerId = p.id;

        if (attacker && attacker.id !== p.id && !attacker.phased) {
          if (attacker.shielded) {
            const projDamage = def ? def.damage : 30;
            attacker.shieldHP = (attacker.shieldHP || 0) - projDamage;
            if (attacker.shieldHP <= 0) {
              attacker.shielded = false;
              attacker.shieldHP = 0;
              attacker.effectType = "";
              attacker.effectTimer = 0;
            }
            hits.push({
              projectile: reflectedProjectile,
              victim: attacker,
              shieldAbsorbed: true,
              shieldHP: Math.max(0, attacker.shieldHP || 0),
              hitPoint: getKartCenter(attacker),
            });
          } else {
            const appliedEffect = def && def.effect && def.effectDuration
              ? { type: def.effect, duration: def.effectDuration }
              : null;
            if (def && def.effect && def.effectDuration) {
              applyEffect(attacker, def);
            }
            hits.push({
              projectile: reflectedProjectile,
              victim: attacker,
              shieldAbsorbed: false,
              effectApplied: appliedEffect,
              hitPoint: getKartCenter(attacker),
            });
          }
        }
        p.reflectProjectiles = false;
        if (p.effectType === "mirror") {
          p.effectType = "";
          p.effectTimer = 0;
        }
        toDelete.push(id);
        resolvedHit = true;
        return;
      }

      emitProjectileHit(hits, e, p, Number(e.damage ?? def?.damage ?? 0), def, {
        hitPoint: getKartCenter(p),
      });
      toDelete.push(id);
      resolvedHit = true;
    });
  });

  // Cleanup
  for (const id of toDelete) {
    entitiesMap.delete(id);
  }

  // Tick player cooldowns + effects + overheat
  playersMap.forEach((p) => {
    if (p.fireCooldown > 0) {
      p.fireCooldown = Math.max(0, p.fireCooldown - deltaTime);
    }
    if (p.fireCooldown2 > 0) {
      p.fireCooldown2 = Math.max(0, p.fireCooldown2 - deltaTime);
    }
    tickOverheat(p, deltaTime);
    if (p.effectTimer > 0) {
      p.effectTimer -= deltaTime;
      if (p.effectTimer <= 0) {
        clearEffect(p);
      }
    }
  });

  return hits;
}

function buildWeaponEffectPayload(def) {
  if (!def?.effect || !def?.effectDuration) return null;
  return { type: def.effect, duration: def.effectDuration };
}

function clearShieldState(player) {
  player.shielded = false;
  player.shieldHP = 0;
  player.effectType = "";
  player.effectTimer = 0;
}

function emitProjectileHit(hits, projectile, victim, damage, def, options = {}) {
  const amount = Math.max(0, Number(damage) || 0);
  if (!victim || amount <= 0 || victim.phased) return false;

  const hitPoint = options.hitPoint || getKartCenter(victim);
  if (victim.shielded) {
    victim.shieldHP = (victim.shieldHP || 0) - amount;
    if (victim.shieldHP <= 0) {
      clearShieldState(victim);
    }
    hits.push({
      projectile,
      victim,
      shieldAbsorbed: true,
      shieldHP: Math.max(0, victim.shieldHP || 0),
      hitPoint,
      damage: amount,
    });
    return true;
  }

  const effectApplied = options.effectApplied === undefined
    ? buildWeaponEffectPayload(def)
    : options.effectApplied;
  if (effectApplied?.type && options.applyEffect !== false) {
    applyEffect(victim, def);
  }
  hits.push({
    projectile,
    victim,
    shieldAbsorbed: false,
    effectApplied,
    hitPoint,
    damage: amount,
  });
  return true;
}

function emitPeriodicProjectileHit(hits, projectile, victim, def, options = {}) {
  if (!projectile || !victim || !def) return false;
  const tickMs = Math.max(80, Number(options.damageTickMs ?? def.damageTickMs ?? 200));
  projectile._damageTickAtByVictim ||= new Map();
  const elapsedMs = Number(projectile._elapsedMs || 0);
  const nextTickAt = Number(projectile._damageTickAtByVictim.get(victim.id) || 0);
  if (elapsedMs < nextTickAt) return false;

  projectile._damageTickAtByVictim.set(victim.id, elapsedMs + tickMs);
  const damage = Math.max(0, Number(def.damage || projectile.damage || 0)) * (tickMs / 1000);
  return emitProjectileHit(hits, projectile, victim, damage, def, options);
}

// ---------------------------------------------------------------------------
// Effect helpers
// ---------------------------------------------------------------------------
function applyEffect(player, def) {
  player.effectType = def.effect;
  player.effectTimer = def.effectDuration || 0;

  switch (def.effect) {
    case "slow":
    case "heavy":
      player.speedMultiplier = def.slowFactor || 0.45;
      player.steerMultiplier = def.steerFactor || 1.0;
      break;
    case "stuck":
      player.speedMultiplier = 0;
      player.steerMultiplier = 0;
      break;
    case "spinout":
      player.speedMultiplier = 0.3;
      player.steerMultiplier = 0;
      break;
    case "burn":
      player.speedMultiplier = 0.82;
      player.steerMultiplier = 0.92;
      break;
    case "freeze":
      player.speedMultiplier = 0.18;
      player.steerMultiplier = 0.1;
      break;
    case "stun":
      player.speedMultiplier = 0.25;
      player.steerMultiplier = 0;
      break;
    case "poison":
      player.speedMultiplier = 0.88;
      player.steerMultiplier = 0.9;
      break;
    case "knockback":
      player.speedMultiplier = 0.7;
      player.steerMultiplier = 0.75;
      break;
    case "blind":
      break;
    case "mirror":
      player.reflectProjectiles = true;
      break;
    case "phase_shift_swap":
      break;
    case "squash":
      player.speedMultiplier = 0;
      player.steerMultiplier = 0;
      break;
    case "boost":
    case "ludicrous":
      break;
  }
}

function clearEffect(player) {
  player.effectType = "";
  player.effectTimer = 0;
  player.speedMultiplier = 1.0;
  player.steerMultiplier = 1.0;
  player.reflectProjectiles = false;
  player.phased = false;
  // Shield is HP-based — don't clear on effect timeout
}

function getHitRadius(def, subType) {
  if (!def) return 2.5;
  if (def.category === "trap") return 2.4;
  if (typeof def.collisionRadius === "number") {
    return def.collisionRadius;
  }
  if (subType === "lightning_bolt") return 2.2;
  if (subType === "bowling_ball" || subType === "rock_barrage") return 2.8;
  return 2.5;
}

function consumeAmmo(player, def, slot = "primary") {
  if (slot === "secondary") {
    player.ammo2 -= 1;
    player.fireCooldown2 = def.cooldown;
    if (player.ammo2 <= 0) {
      if (player.weapon3 && player.ammo3 > 0) {
        player.weapon2 = "";
        player.ammo2 = 0;
        player.fireCooldown2 = 0;
        swapSecondaryWeapon(player);
      } else {
        player.weapon2 = "";
        player.ammo2 = 0;
        player.fireCooldown2 = 0;
      }
    }
  } else {
    // Primary glo_burst — overheat instead of ammo depletion
    player.ammo -= 1;
    player.fireCooldown = def.cooldown;
    // Add heat per shot (100 ammo → each shot adds ~1.4 heat)
    player.overheat = Math.min(100, (player.overheat || 0) + Number(def.heatPerShot || 1.4));
    if (player.overheat >= 100) {
      player.overheated = true;
    }
    // Auto-replenish ammo to keep primary always active
    if (player.ammo <= 0) {
      const gloBurst = WEAPONS.glo_burst;
      player.ammo = gloBurst.ammo;
      player.fireCooldown = 0;
    }
  }
}

// Overheat cooldown — call from room tick loop (dt in ms)
const OVERHEAT_COOL_RATE = 25; // heat units per second
export function tickOverheat(player, dtMs) {
  if (!player.overheat && !player.overheated) return;
  if (player.overheated) {
    // Cool down faster when locked out
    player.overheat = Math.max(0, player.overheat - (OVERHEAT_COOL_RATE * 1.5 * dtMs / 1000));
    if (player.overheat <= 0) {
      player.overheated = false;
      player.overheat = 0;
    }
  } else {
    // Passive cooling
    player.overheat = Math.max(0, player.overheat - (OVERHEAT_COOL_RATE * dtMs / 1000));
  }
}

// ---------------------------------------------------------------------------
// Guidance helpers — shared by missiles and future guided projectiles
// ---------------------------------------------------------------------------
function isValidGuidanceTarget(target, sourceId) {
  return !!target && target.id !== sourceId && target.health > 0;
}

function getVelocityDirection(vx, vy, vz) {
  const length = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
  return {
    x: vx / length,
    y: vy / length,
    z: vz / length,
  };
}

function findBestGuidanceTarget(origin, forward, sourceId, playersMap, config = {}) {
  const maxRange = config.lockOnRange || 80;
  const minDot = config.lockOnMinDot ?? -1;
  const safeForward = forward && Number.isFinite(forward.x) && Number.isFinite(forward.z)
    ? forward
    : { x: 0, y: 0, z: 1 };

  let best = null;
  let bestScore = -Infinity;

  playersMap.forEach((candidate) => {
    if (!isValidGuidanceTarget(candidate, sourceId)) return;

    const dx = candidate.x - origin.x;
    const dy = (candidate.y + 1.0) - (origin.y + 0.5);
    const dz = candidate.z - origin.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq > maxRange * maxRange || distSq < 1e-4) return;

    const dist = Math.sqrt(distSq);
    const dirX = dx / dist;
    const dirZ = dz / dist;
    const dot = dirX * safeForward.x + dirZ * safeForward.z;
    if (dot < minDot) return;

    const score = dot * 2.4 - dist * 0.022;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  });

  return best;
}

function predictGuidanceAimPoint(projectile, target, projectileSpeed, config = {}) {
  const dx = target.x - projectile.x;
  const dy = (target.y + 1.0) - projectile.y;
  const dz = target.z - projectile.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const leadScale = config.leadScale ?? 0.6;
  const maxLeadTime = config.maxLeadTime ?? 0.75;
  const leadTime = Math.min(maxLeadTime, (distance / Math.max(projectileSpeed, 1)) * Math.max(0, leadScale));

  return {
    x: target.x + (target.vx || 0) * leadTime,
    y: target.y + 1.0 + (target.vy || 0) * leadTime,
    z: target.z + (target.vz || 0) * leadTime,
  };
}

function steerProjectileTowardTarget(projectile, target, config, dt) {
  const speed = Math.sqrt(
    projectile.vx * projectile.vx
    + projectile.vy * projectile.vy
    + projectile.vz * projectile.vz,
  ) || config.speed || 28;
  const aimPoint = predictGuidanceAimPoint(projectile, target, speed, config);
  const dx = aimPoint.x - projectile.x;
  const dy = aimPoint.y - projectile.y;
  const dz = aimPoint.z - projectile.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (distance < 0.001) return;

  const desiredX = dx / distance;
  const desiredY = dy / distance;
  const desiredZ = dz / distance;
  const currentDir = getVelocityDirection(projectile.vx, projectile.vy, projectile.vz);
  const steerAlpha = Math.min(1, (config.homingTurnRate || 3.2) * dt);

  let nextX = currentDir.x + (desiredX - currentDir.x) * steerAlpha;
  let nextY = currentDir.y + (desiredY - currentDir.y) * steerAlpha;
  let nextZ = currentDir.z + (desiredZ - currentDir.z) * steerAlpha;
  const nextLength = Math.sqrt(nextX * nextX + nextY * nextY + nextZ * nextZ) || 1;
  nextX /= nextLength;
  nextY /= nextLength;
  nextZ /= nextLength;

  projectile.vx = nextX * speed;
  projectile.vy = nextY * speed;
  projectile.vz = nextZ * speed;
}

// ---------------------------------------------------------------------------
// findNearestRival — used by debuff items (parachute, anchor)
// ---------------------------------------------------------------------------
function findNearestRival(player, playersMap, predicate = null) {
  let best = null;
  let bestDist = Infinity;
  playersMap.forEach((p) => {
    if (p.id === player.id) return;
    if (predicate && !predicate(p)) return;
    const dx = p.x - player.x;
    const dz = p.z - player.z;
    const dist = dx * dx + dz * dz;
    if (dist < bestDist) {
      bestDist = dist;
      best = p;
    }
  });
  return best;
}

function findPhaseShiftTarget(player, playersMap, fireInput = null) {
  const requestedTargetId = String(fireInput?.targetId || "");
  const requestedTarget = requestedTargetId ? playersMap.get(requestedTargetId) : null;
  if (isValidGuidanceTarget(requestedTarget, player.id)) {
    return requestedTarget;
  }

  return findNearestRival(player, playersMap, (candidate) => Number(candidate?.health || 0) > 0);
}

function snapshotPlayerTransform(player) {
  return {
    x: Number(player?.x || 0),
    y: Number(player?.y || 0),
    z: Number(player?.z || 0),
    rx: Number(player?.rx || 0),
    ry: Number(player?.ry || 0),
    rz: Number(player?.rz || 0),
    rw: Number(player?.rw || 1),
    heading: Number(player?.heading || 0),
  };
}

function applyTeleportTransform(player, snapshot, orientation = snapshot) {
  player.x = snapshot.x;
  player.y = snapshot.y;
  player.z = snapshot.z;
  player.vx = 0;
  player.vy = 0;
  player.vz = 0;
  player.heading = Number(orientation?.heading || 0);
  player.rx = Number(orientation?.rx || 0);
  player.ry = Number(orientation?.ry || 0);
  player.rz = Number(orientation?.rz || 0);
  player.rw = Number.isFinite(Number(orientation?.rw)) ? Number(orientation.rw) : 1;
  player.speedMultiplier = 1.0;
  player.steerMultiplier = 1.0;
  player.phased = false;
}

function getHeldPickupSlot(player) {
  if (player?.weapon2 && player.ammo2 > 0) {
    return { slot: "secondary", weapon: player.weapon2, ammo: player.ammo2 };
  }
  if (player?.weapon3 && player.ammo3 > 0) {
    return { slot: "reserve", weapon: player.weapon3, ammo: player.ammo3 };
  }
  return null;
}

function clearHeldPickupSlot(player, slot) {
  if (slot === "secondary") {
    player.weapon2 = "";
    player.ammo2 = 0;
    player.fireCooldown2 = 0;
    if (player.weapon3 && player.ammo3 > 0) {
      swapSecondaryWeapon(player);
    }
    return;
  }
  if (slot === "reserve") {
    player.weapon3 = "";
    player.ammo3 = 0;
  }
}

function storeHeldPickupWeapon(player, weaponId, ammo) {
  if (!weaponId || ammo <= 0) return;
  if (!player.weapon2 || player.ammo2 <= 0) {
    player.weapon2 = weaponId;
    player.ammo2 = ammo;
    player.fireCooldown2 = 0;
    return;
  }
  if (!player.weapon3 || player.ammo3 <= 0) {
    player.weapon3 = weaponId;
    player.ammo3 = ammo;
    return;
  }
  player.weapon2 = weaponId;
  player.ammo2 = ammo;
  player.fireCooldown2 = 0;
}

function cloneReflectedProjectile(projectile, reflector, playersMap) {
  const def = WEAPONS[projectile.subType];
  if (!def) return null;
  const attacker = playersMap?.get(projectile.ownerId);
  const speed = def.speed || Math.sqrt(
    (projectile.vx || 0) * (projectile.vx || 0)
    + (projectile.vy || 0) * (projectile.vy || 0)
    + (projectile.vz || 0) * (projectile.vz || 0),
  ) || 28;
  let dirX = -(projectile.vx || 0);
  let dirY = Math.max(0, projectile.vy || 0);
  let dirZ = -(projectile.vz || 0);

  if (attacker) {
    const dx = attacker.x - reflector.x;
    const dy = (attacker.y + 1.0) - (reflector.y + 1.0);
    const dz = attacker.z - reflector.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dirX = dx / len;
    dirY = dy / len;
    dirZ = dz / len;
  } else {
    const len = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ) || 1;
    dirX /= len;
    dirY /= len;
    dirZ /= len;
  }

  const reflected = new EntityState();
  reflected.id = `refl_${reflector.id.slice(0, 4)}_${++_projectileCounter}`;
  reflected.type = "projectile";
  reflected.subType = projectile.subType;
  reflected.ownerId = reflector.id;
  reflected.active = true;
  reflected.damage = projectile.damage;
  reflected.lifespan = Math.max(500, projectile.lifespan);
  reflected.x = reflector.x;
  reflected.y = reflector.y + 1.0;
  reflected.z = reflector.z;
  reflected.vx = dirX * speed;
  reflected.vy = dirY * speed;
  reflected.vz = dirZ * speed;
  reflected.rx = reflector.rx;
  reflected.ry = reflector.ry;
  reflected.rz = reflector.rz;
  reflected.rw = reflector.rw;
  if (def.homing && attacker) {
    reflected.targetId = attacker.id;
  }
  return reflected;
}

export function tickArenaEffects(state, playersMap, deltaTime) {
  if (!state?.arenaEffectType || state.arenaEffectTimer <= 0) return null;
  state.arenaEffectTimer = Math.max(0, state.arenaEffectTimer - deltaTime);
  if (state.arenaEffectType === "rain") {
    playersMap.forEach((player) => {
      player.vx *= 0.985;
      player.vz *= 0.985;
    });
  }
  if (state.arenaEffectTimer <= 0) {
    const endedType = state.arenaEffectType;
    state.arenaEffectType = "";
    return endedType;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Quaternion → forward direction (unit-length XZ plane, Y=0)
// ---------------------------------------------------------------------------
function quatForward(rx, ry, rz, rw) {
  const z2 = 1 - 2 * (rx * rx + ry * ry);
  const x2 = 2 * (ry * rz - rw * rx);

  let fx = x2;
  let fz = z2;

  const len = Math.sqrt(fx * fx + fz * fz);
  if (len > 0.0001) {
    fx /= len;
    fz /= len;
  } else {
    fx = 0;
    fz = 1;
  }
  return { x: fx, y: 0, z: fz };
}
