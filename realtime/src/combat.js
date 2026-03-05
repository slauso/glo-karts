/**
 * combat.js — Shared combat / pickup / effect system for RaceRoom & BattleRoom.
 *
 * Full STK-inspired weapon catalogue:
 *   PROJECTILES   — bowling_ball, cake, plunger, nitro, missile
 *   TRAPS         — bubblegum, banana (back-drops)
 *   MELEE         — swatter (close-range smash)
 *   DEBUFF        — parachute (slow leader), anchor (weight target)
 *   BUFF          — zipper (huge speed boost)
 *   DEFENCE       — shield (absorb one hit)
 *
 * Weighted item distribution is position-aware:
 *   Players further back get stronger offensive / recovery items.
 *   Players in front get more defensive / trap items.
 */

import { EntityState } from "./schema/EntityState.js";

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
    speed: 48,
    damage: 35,
    lifespan: 4000,
    cooldown: 500,
    ammo: 1,
    gravity: 0,
    bounces: 0,
    effect: "spinout",
    effectDuration: 1000,
    desc: "Fast missile — knock target sideways",
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
  zipper: {
    category: "buff",
    speed: 0,
    damage: 0,
    lifespan: 0,
    cooldown: 0,
    ammo: 1,
    effect: "boost",
    effectDuration: 3000,
    boostFactor: 1.65,
    desc: "Nitro zipper — massive speed boost for 3 seconds",
  },

  /* ─── Defence ─────────────────────────────────────────────────────────── */
  shield: {
    category: "defence",
    speed: 0,
    damage: 0,
    lifespan: 10000,
    cooldown: 0,
    ammo: 1,
    desc: "Force-field bubble — absorbs the next incoming hit",
  },
};

const WEAPON_KEYS = Object.keys(WEAPONS);

// ---------------------------------------------------------------------------
// Position-aware weighted item draw
// ---------------------------------------------------------------------------
const BACK_WEIGHTS = {
  bowling_ball: 3, cake: 3, missile: 4, nitro: 3, plunger: 2,
  bubblegum: 1, banana: 1, swatter: 2, parachute: 1, anchor: 2,
  zipper: 4, shield: 2,
};
const MID_WEIGHTS = {
  bowling_ball: 3, cake: 2, missile: 2, nitro: 2, plunger: 2,
  bubblegum: 3, banana: 3, swatter: 2, parachute: 2, anchor: 2,
  zipper: 2, shield: 3,
};
const FRONT_WEIGHTS = {
  bowling_ball: 1, cake: 1, missile: 1, nitro: 1, plunger: 1,
  bubblegum: 4, banana: 5, swatter: 1, parachute: 3, anchor: 3,
  zipper: 1, shield: 4,
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
export function grantWeapon(player, positionRatio = 0.5) {
  let weights;
  if (positionRatio < 0.33) weights = FRONT_WEIGHTS;
  else if (positionRatio > 0.66) weights = BACK_WEIGHTS;
  else weights = MID_WEIGHTS;

  const rolled = weightedRandom(weights);
  const def = WEAPONS[rolled];

  player.weapon = rolled;
  player.ammo = def.ammo;
  player.fireCooldown = 0;

  return rolled;
}

// ---------------------------------------------------------------------------
// handleFireWeapon – handles all weapon categories
// Returns { projectile, effectApplied } or null.
// ---------------------------------------------------------------------------
export function handleFireWeapon(player, entitiesMap, playersMap) {
  if (!player.weapon || player.ammo <= 0 || player.fireCooldown > 0) return null;

  const wepId = player.weapon;
  const def = WEAPONS[wepId];
  if (!def) return null;

  const result = { projectile: null, effectApplied: null };

  // ── Shield (defence) ─────────────────────────────────────────────────
  if (def.category === "defence") {
    player.shielded = true;
    player.effectType = "shielded";
    player.effectTimer = def.lifespan;
    consumeAmmo(player, def);
    result.effectApplied = { type: "shielded", target: player.id };
    return result;
  }

  // ── Buff (self-boost) ────────────────────────────────────────────────
  if (def.category === "buff") {
    player.speedMultiplier = def.boostFactor || 1.65;
    player.effectType = def.effect;
    player.effectTimer = def.effectDuration;
    consumeAmmo(player, def);
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
    consumeAmmo(player, def);
    return result;
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
        p.health = Math.max(0, p.health - def.damage);
        applyEffect(p, def);
        melee.push({ victimId: p.id, damage: def.damage });
      }
    });
    consumeAmmo(player, def);
    result.effectApplied = { type: "melee_swatter", hits: melee, attackerId: player.id };
    return result;
  }

  // ── Trap (drop behind player) ────────────────────────────────────────
  if (def.category === "trap") {
    const fwd = quatForward(player.rx, player.ry, player.rz, player.rw);
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
    ent.x = player.x - fwd.x * 3;
    ent.y = player.y + 0.3;
    ent.z = player.z - fwd.z * 3;

    ent.vx = 0;
    ent.vy = 0;
    ent.vz = 0;

    entitiesMap.set(id, ent);
    consumeAmmo(player, def);
    result.projectile = ent;
    return result;
  }

  // ── Projectile (forward-fired) ───────────────────────────────────────
  const fwd = quatForward(player.rx, player.ry, player.rz, player.rw);
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
  ent.x = player.x + fwd.x * SPAWN_OFFSET;
  ent.y = player.y + 1.0;
  ent.z = player.z + fwd.z * SPAWN_OFFSET;

  ent.vx = fwd.x * def.speed;
  ent.vy = def.gravity ? 8 : 0;   // initial upward arc for lobbed items
  ent.vz = fwd.z * def.speed;

  ent.rx = player.rx;
  ent.ry = player.ry;
  ent.rz = player.rz;
  ent.rw = player.rw;

  entitiesMap.set(id, ent);
  consumeAmmo(player, def);
  result.projectile = ent;
  return result;
}

// ---------------------------------------------------------------------------
// tickProjectiles – move projectiles, apply gravity, despawn, detect hits
// ---------------------------------------------------------------------------
export function tickProjectiles(entitiesMap, playersMap, deltaTime) {
  const dt = deltaTime / 1000;
  const hits = [];
  const toDelete = [];

  entitiesMap.forEach((e, id) => {
    if (e.type !== "projectile" || !e.active) return;

    const def = WEAPONS[e.subType];

    // 1. Move
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.z += e.vz * dt;

    // 2. Gravity (arced weapons like cake & nitro)
    if (def && def.gravity) {
      e.vy += def.gravity * dt;
      if (e.y < 0.3) {
        e.y = 0.3;
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

    // 4. Hit detection
    const HIT_RADIUS_SQ = def?.category === "trap" ? 6.25 : 9;
    playersMap.forEach((p) => {
      if (p.id === e.ownerId) return;
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const dz = p.z - e.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq >= HIT_RADIUS_SQ) return;

      // Shielded players absorb hit
      if (p.shielded) {
        p.shielded = false;
        p.effectType = "";
        p.effectTimer = 0;
        toDelete.push(id);
        hits.push({ projectile: e, victim: p, shieldAbsorbed: true });
        return;
      }

      // Apply on-hit effect
      if (def && def.effect && def.effectDuration) {
        applyEffect(p, def);
      }
      hits.push({ projectile: e, victim: p, shieldAbsorbed: false });
      toDelete.push(id);
    });
  });

  // Cleanup
  for (const id of toDelete) {
    entitiesMap.delete(id);
  }

  // Tick player cooldowns + effects
  playersMap.forEach((p) => {
    if (p.fireCooldown > 0) {
      p.fireCooldown = Math.max(0, p.fireCooldown - deltaTime);
    }
    if (p.effectTimer > 0) {
      p.effectTimer -= deltaTime;
      if (p.effectTimer <= 0) {
        clearEffect(p);
      }
    }
  });

  return hits;
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
    case "blind":
      break;
    case "squash":
      player.speedMultiplier = 0;
      player.steerMultiplier = 0;
      break;
    case "boost":
      break;
  }
}

function clearEffect(player) {
  player.effectType = "";
  player.effectTimer = 0;
  player.speedMultiplier = 1.0;
  player.steerMultiplier = 1.0;
  if (player.shielded) {
    player.shielded = false;
  }
}

function consumeAmmo(player, def) {
  player.ammo -= 1;
  player.fireCooldown = def.cooldown;
  if (player.ammo <= 0) player.weapon = "";
}

// ---------------------------------------------------------------------------
// findNearestRival — used by debuff items (parachute, anchor)
// ---------------------------------------------------------------------------
function findNearestRival(player, playersMap) {
  let best = null;
  let bestDist = Infinity;
  playersMap.forEach((p) => {
    if (p.id === player.id) return;
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
