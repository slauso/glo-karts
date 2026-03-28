/**
 * glo-flux-surge.js — Surge Meter & Apocalypse Burst system for gloFLUX.
 *
 * Surge Meter fills from:
 *   - Power-up chain synergies (largest contributor)
 *   - Kills and assists
 *   - Echo Shard near-miss events
 *
 * At 100% → Apocalypse Burst: arena-wide hybrid effect combining all families.
 * Tiered visuals escalate as meter fills (25%/50%/75%/100%).
 */

import { FAMILY, FAMILY_META, calculateSurgeGain, detectSynergies } from './glo-flux-powers.js';

// ── Constants ───────────────────────────────────────────────────────────────

const SURGE_MAX        = 100;
const KILL_SURGE       = 8;
const ASSIST_SURGE     = 3;
const ECHO_SHARD_SURGE = 1;   // per shard
const CHAIN_BASE_SURGE = 5;
const DECAY_RATE       = 0.5; // per second when no activity
const DECAY_GRACE      = 5;   // seconds after last gain before decay starts

export const SURGE_TIER = Object.freeze({
  DORMANT:   'dormant',    // 0-24%
  BUILDING:  'building',   // 25-49%
  RISING:    'rising',     // 50-74%
  CRITICAL:  'critical',   // 75-99%
  APOCALYPSE:'apocalypse', // 100%
});

// ── State Creation ──────────────────────────────────────────────────────────

/**
 * Create a surge meter state for a player.
 * @returns {object} Mutable surge state
 */
export function createSurgeState() {
  return {
    meter: 0,
    tier: SURGE_TIER.DORMANT,
    lastGainTime: 0,
    burstsTriggered: 0,
    familyContributions: {
      [FAMILY.PHANTOM_HORDE]: 0,
      [FAMILY.ENTROPIC_VOID]: 0,
      [FAMILY.BIOFRACTAL_AEGIS]: 0,
      [FAMILY.PSYCHE_APOTHEOSIS]: 0,
    },
    isBursting: false,
    burstTimer: 0,
    burstDuration: 4, // seconds of apocalypse burst
  };
}

// ── Tier Calculation ────────────────────────────────────────────────────────

function computeTier(meter) {
  if (meter >= SURGE_MAX)  return SURGE_TIER.APOCALYPSE;
  if (meter >= 75)         return SURGE_TIER.CRITICAL;
  if (meter >= 50)         return SURGE_TIER.RISING;
  if (meter >= 25)         return SURGE_TIER.BUILDING;
  return SURGE_TIER.DORMANT;
}

// ── Gain Functions ──────────────────────────────────────────────────────────

/**
 * Add surge from a power-up chain event.
 * @param {object} surgeState
 * @param {string[]} activePowerIds - Player's active power-ups
 * @param {number} now - Current time in seconds
 * @returns {{ gained: number, tier: string, triggered: boolean }}
 */
export function surgeFromChain(surgeState, activePowerIds, now) {
  const { totalSurge } = calculateSurgeGain(activePowerIds);
  const gained = Math.min(totalSurge, SURGE_MAX - surgeState.meter);
  surgeState.meter = Math.min(SURGE_MAX, surgeState.meter + gained);
  surgeState.lastGainTime = now;

  // Attribute to family
  const synergies = detectSynergies(activePowerIds);
  for (const syn of synergies) {
    if (syn.family) {
      surgeState.familyContributions[syn.family] += gained / synergies.length;
    }
  }

  surgeState.tier = computeTier(surgeState.meter);
  const triggered = surgeState.meter >= SURGE_MAX && !surgeState.isBursting;
  return { gained, tier: surgeState.tier, triggered };
}

/**
 * Add surge from a kill.
 */
export function surgeFromKill(surgeState, now) {
  const gained = Math.min(KILL_SURGE, SURGE_MAX - surgeState.meter);
  surgeState.meter = Math.min(SURGE_MAX, surgeState.meter + gained);
  surgeState.lastGainTime = now;
  surgeState.tier = computeTier(surgeState.meter);
  return { gained, tier: surgeState.tier, triggered: surgeState.meter >= SURGE_MAX && !surgeState.isBursting };
}

/**
 * Add surge from an assist.
 */
export function surgeFromAssist(surgeState, now) {
  const gained = Math.min(ASSIST_SURGE, SURGE_MAX - surgeState.meter);
  surgeState.meter = Math.min(SURGE_MAX, surgeState.meter + gained);
  surgeState.lastGainTime = now;
  surgeState.tier = computeTier(surgeState.meter);
  return { gained, tier: surgeState.tier, triggered: surgeState.meter >= SURGE_MAX && !surgeState.isBursting };
}

/**
 * Add surge from Echo Shards.
 */
export function surgeFromEchoShards(surgeState, shardCount, now) {
  const gained = Math.min(shardCount * ECHO_SHARD_SURGE, SURGE_MAX - surgeState.meter);
  surgeState.meter = Math.min(SURGE_MAX, surgeState.meter + gained);
  surgeState.lastGainTime = now;
  surgeState.tier = computeTier(surgeState.meter);
  return { gained, tier: surgeState.tier, triggered: surgeState.meter >= SURGE_MAX && !surgeState.isBursting };
}

// ── Apocalypse Burst ────────────────────────────────────────────────────────

/**
 * Trigger the Apocalypse Burst.
 * @param {object} surgeState
 * @returns {object|null} Burst configuration or null if can't trigger
 */
export function triggerApocalypseBurst(surgeState) {
  if (surgeState.meter < SURGE_MAX || surgeState.isBursting) return null;

  surgeState.isBursting = true;
  surgeState.burstTimer = surgeState.burstDuration;
  surgeState.burstsTriggered++;

  // Determine dominant family for burst flavor
  let dominantFamily = FAMILY.PHANTOM_HORDE;
  let maxContrib = 0;
  for (const [fam, contrib] of Object.entries(surgeState.familyContributions)) {
    if (contrib > maxContrib) {
      maxContrib = contrib;
      dominantFamily = fam;
    }
  }

  const meta = FAMILY_META[dominantFamily];

  return {
    dominantFamily,
    color: meta.color,
    label: `${meta.label} Apocalypse`,
    duration: surgeState.burstDuration,
    tier: surgeState.burstsTriggered, // escalates each burst
    effects: {
      radialForce: 25 + surgeState.burstsTriggered * 5,
      gravityChaosFactor: 0.5 + surgeState.burstsTriggered * 0.1,
      linearDamping: 0.7,
      angularDamping: 0.7,
      phantomGhosts: dominantFamily === FAMILY.PHANTOM_HORDE ? 8 : 2,
      voidRifts: dominantFamily === FAMILY.ENTROPIC_VOID ? 4 : 1,
      fractalMinis: dominantFamily === FAMILY.BIOFRACTAL_AEGIS ? 6 : 1,
      hallucinationIntensity: dominantFamily === FAMILY.PSYCHE_APOTHEOSIS ? 1.0 : 0.3,
    },
  };
}

// ── Tick ─────────────────────────────────────────────────────────────────────

/**
 * Tick the surge meter — handles decay and burst timer.
 * @param {object} surgeState
 * @param {number} dt - Delta time
 * @param {number} now - Current time
 * @returns {{ tier: string, isBursting: boolean, burstComplete: boolean }}
 */
export function tickSurge(surgeState, dt, now) {
  let burstComplete = false;

  // Handle active burst countdown
  if (surgeState.isBursting) {
    surgeState.burstTimer -= dt;
    if (surgeState.burstTimer <= 0) {
      surgeState.isBursting = false;
      surgeState.burstTimer = 0;
      surgeState.meter = 0;
      // Reset family contributions for next cycle
      for (const fam of Object.keys(surgeState.familyContributions)) {
        surgeState.familyContributions[fam] = 0;
      }
      burstComplete = true;
    }
  } else {
    // Decay when idle
    const idleTime = now - surgeState.lastGainTime;
    if (idleTime > DECAY_GRACE && surgeState.meter > 0) {
      surgeState.meter = Math.max(0, surgeState.meter - DECAY_RATE * dt);
    }
  }

  surgeState.tier = computeTier(surgeState.meter);
  return { tier: surgeState.tier, isBursting: surgeState.isBursting, burstComplete };
}

// ── Accessors ───────────────────────────────────────────────────────────────

export function getSurgePercent(surgeState) {
  return Math.min(100, (surgeState.meter / SURGE_MAX) * 100);
}

export function getSurgeTier(surgeState) {
  return surgeState.tier;
}

export function isBursting(surgeState) {
  return surgeState.isBursting;
}

export function getBurstProgress(surgeState) {
  if (!surgeState.isBursting) return 0;
  return 1 - (surgeState.burstTimer / surgeState.burstDuration);
}

export function getDominantContributorFamily(surgeState) {
  let max = 0, dom = FAMILY.PHANTOM_HORDE;
  for (const [fam, c] of Object.entries(surgeState.familyContributions)) {
    if (c > max) { max = c; dom = fam; }
  }
  return dom;
}
