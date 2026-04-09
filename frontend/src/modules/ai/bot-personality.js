/**
 * ai/bot-personality.js — AI personality profiles and decision-making for bots.
 *
 * Provides:
 *  - Personality profiles with tunable aggression, accuracy, risk tolerance
 *  - Item usage policy (when to fire, when to save, what to aim at)
 *  - Defensive vs aggressive strategy selection based on standings
 *  - Cornering intelligence (brake early/late, drift triggers)
 *  - Team coordination hints (soccer/CTF)
 */

// ═══════════════════════════════════════════════════════════════════════════
// ── Personality Profiles ───────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @typedef {object} BotPersonality
 * @property {string} name
 * @property {number} aggression    0-1 (0=defensive, 1=hyper-aggressive)
 * @property {number} accuracy      0-1 (aim skill)
 * @property {number} riskTolerance 0-1 (willingness to take risky shortcuts/drifts)
 * @property {number} itemGreed     0-1 (how quickly bot uses items vs hoarding)
 * @property {number} speedBias     0.7-1.1 (base speed multiplier)
 * @property {number} cornerBrake   0-1 (0=brake early, 1=brake late)
 * @property {string} strategy      'balanced' | 'aggressive' | 'defensive' | 'opportunist'
 */

export const PERSONALITIES = Object.freeze({
  cautious: {
    name: 'Cautious',
    aggression: 0.2, accuracy: 0.5, riskTolerance: 0.2,
    itemGreed: 0.3, speedBias: 0.85, cornerBrake: 0.3,
    strategy: 'defensive',
  },
  balanced: {
    name: 'Balanced',
    aggression: 0.5, accuracy: 0.6, riskTolerance: 0.5,
    itemGreed: 0.5, speedBias: 0.92, cornerBrake: 0.5,
    strategy: 'balanced',
  },
  aggressive: {
    name: 'Aggressive',
    aggression: 0.85, accuracy: 0.7, riskTolerance: 0.7,
    itemGreed: 0.8, speedBias: 0.97, cornerBrake: 0.7,
    strategy: 'aggressive',
  },
  expert: {
    name: 'Expert',
    aggression: 0.7, accuracy: 0.9, riskTolerance: 0.6,
    itemGreed: 0.6, speedBias: 1.02, cornerBrake: 0.8,
    strategy: 'balanced',
  },
  chaotic: {
    name: 'Chaotic',
    aggression: 0.95, accuracy: 0.45, riskTolerance: 0.95,
    itemGreed: 0.95, speedBias: 0.90, cornerBrake: 0.9,
    strategy: 'aggressive',
  },
  turtle: {
    name: 'Turtle',
    aggression: 0.1, accuracy: 0.4, riskTolerance: 0.1,
    itemGreed: 0.1, speedBias: 0.78, cornerBrake: 0.1,
    strategy: 'defensive',
  },
});

const PROFILE_KEYS = Object.keys(PERSONALITIES);

/**
 * Pick a random personality profile for a bot, optionally biased by difficulty tier.
 * @param {number} difficultyTier 0=easy 1=medium 2=hard 3=expert
 */
export function pickPersonality(difficultyTier = 1) {
  // Higher tiers more likely to get aggressive/expert profiles
  const weights = {
    0: ['turtle', 'cautious', 'cautious', 'balanced'],
    1: ['cautious', 'balanced', 'balanced', 'aggressive'],
    2: ['balanced', 'aggressive', 'aggressive', 'expert'],
    3: ['aggressive', 'expert', 'expert', 'chaotic'],
  };
  const pool = weights[Math.min(difficultyTier, 3)] || weights[1];
  const key = pool[Math.floor(Math.random() * pool.length)];
  return { ...PERSONALITIES[key] };
}

// ═══════════════════════════════════════════════════════════════════════════
// ── Item Usage Decisions ───────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Decide whether a bot should use its held item this tick.
 *
 * @param {BotPersonality} personality
 * @param {object} ctx
 * @param {string} ctx.heldItemId  Currently held weapon ID
 * @param {string} ctx.heldCategory  Weapon category (projectile/trap/buff/defence/melee)
 * @param {number} ctx.distToNearest  Distance to nearest enemy
 * @param {boolean} ctx.enemyAhead  Is there an enemy in front?
 * @param {boolean} ctx.enemyBehind  Is there an enemy behind?
 * @param {number} ctx.healthPct  Current health fraction 0-1
 * @param {number} ctx.positionRatio  0=last, 1=first
 * @returns {{ shouldUse: boolean, targetForward: boolean }}
 */
export function shouldUseItem(personality, ctx) {
  const { heldCategory, distToNearest, enemyAhead, enemyBehind, healthPct, positionRatio } = ctx;

  // Random roll based on item greed (higher greed = use sooner)
  const greedRoll = Math.random() < personality.itemGreed * 0.15; // ~15% chance per tick at max greed

  // Defensive: use shield/buff when low health
  if (heldCategory === 'defence' && healthPct < 0.5) {
    return { shouldUse: true, targetForward: false };
  }
  if (heldCategory === 'buff') {
    // Use boosts when behind in race or aggressive
    if (positionRatio > 0.5 || personality.aggression > 0.6 || greedRoll) {
      return { shouldUse: true, targetForward: true };
    }
    return { shouldUse: false, targetForward: true };
  }

  // Projectile: fire when enemy is ahead and in range
  if (heldCategory === 'projectile' || heldCategory === 'homing' ||
      heldCategory === 'instant_beam' || heldCategory === 'targeted') {
    const fireRange = 20 + personality.accuracy * 30; // 20-50 range
    if (enemyAhead && distToNearest < fireRange) {
      // Accuracy check: better bots fire more reliably
      if (Math.random() < personality.accuracy) {
        return { shouldUse: true, targetForward: true };
      }
    }
    if (greedRoll && personality.aggression > 0.7) {
      return { shouldUse: true, targetForward: true };
    }
    return { shouldUse: false, targetForward: true };
  }

  // Traps: drop when enemy is behind
  if (heldCategory === 'trap' || heldCategory === 'trap_trail') {
    if (enemyBehind && distToNearest < 15) {
      return { shouldUse: true, targetForward: false };
    }
    // Aggressive bots spam traps
    if (personality.aggression > 0.8 && greedRoll) {
      return { shouldUse: true, targetForward: false };
    }
    return { shouldUse: false, targetForward: false };
  }

  // Melee: use when close
  if (heldCategory === 'melee') {
    if (distToNearest < 8) {
      return { shouldUse: true, targetForward: true };
    }
    return { shouldUse: false, targetForward: true };
  }

  // AOE / area denial: use when enemies nearby
  if (heldCategory === 'instant_aoe' || heldCategory === 'area_denial' || heldCategory === 'zone_strike') {
    if (distToNearest < 18 && (enemyAhead || personality.aggression > 0.6)) {
      return { shouldUse: true, targetForward: true };
    }
    return { shouldUse: false, targetForward: true };
  }

  // Default: use if greedy enough
  return { shouldUse: greedRoll, targetForward: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// ── Cornering Intelligence ─────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Determine braking intensity for an upcoming corner.
 *
 * @param {BotPersonality} personality
 * @param {number} curveAngle  Absolute angle of upcoming curve in radians
 * @param {number} currentSpeed  Current speed m/s
 * @param {number} maxSpeed  Max speed
 * @returns {number} Brake factor 0 (no brake) to 1 (full brake)
 */
export function cornerBrakeDecision(personality, curveAngle, currentSpeed, maxSpeed) {
  // Sharp corners need more braking
  const speedRatio = currentSpeed / maxSpeed;
  const sharpness = Math.min(curveAngle / Math.PI, 1);

  // Late-brakers (high cornerBrake) barely brake until the last moment
  const brakeThreshold = 0.2 + (1 - personality.cornerBrake) * 0.4; // 0.2 to 0.6 radians

  if (sharpness < brakeThreshold && speedRatio < 0.7) return 0;

  // More aggressive racers carry more speed through corners
  const aggReduction = personality.riskTolerance * 0.3;
  const brakeFactor = Math.max(0, sharpness * speedRatio - aggReduction);

  return Math.min(brakeFactor, 1);
}

/**
 * Decide whether to attempt a drift through a corner.
 *
 * @param {BotPersonality} personality
 * @param {number} curveAngle  Upcoming curve angle
 * @param {number} speedRatio  0-1 current/max speed
 * @returns {boolean}
 */
export function shouldDrift(personality, curveAngle, speedRatio) {
  // Only skilled bots attempt drifts, and only at speed on sharp corners
  if (personality.riskTolerance < 0.4) return false;
  if (curveAngle < 0.5) return false;
  if (speedRatio < 0.5) return false;

  return Math.random() < personality.riskTolerance * 0.6;
}

// ═══════════════════════════════════════════════════════════════════════════
// ── Strategy Adaptation ────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Adapt bot strategy based on current race/battle standings.
 * Call periodically (every ~2s) to update behaviour.
 *
 * @param {BotPersonality} personality  Mutable — may adjust aggression/speedBias
 * @param {object} ctx
 * @param {number} ctx.positionRatio   0=last, 1=first
 * @param {number} ctx.healthPct       0-1 (battle)
 * @param {number} ctx.matchTimeRemaining  seconds (battle)
 */
export function adaptStrategy(personality, ctx) {
  const { positionRatio = 0.5, healthPct = 1, matchTimeRemaining = Infinity } = ctx;

  // Losing badly → get more aggressive
  if (positionRatio > 0.75 && personality.strategy !== 'defensive') {
    personality.aggression = Math.min(1, personality.aggression + 0.1);
    personality.speedBias  = Math.min(1.05, personality.speedBias + 0.03);
  }

  // Winning → play it safe (unless chaotic)
  if (positionRatio < 0.25 && personality.strategy !== 'aggressive') {
    personality.aggression = Math.max(0.1, personality.aggression - 0.1);
    personality.itemGreed  = Math.max(0.1, personality.itemGreed - 0.1);
  }

  // Low health in battle → defensive
  if (healthPct < 0.3) {
    personality.riskTolerance = Math.max(0, personality.riskTolerance - 0.2);
  }

  // Last 30 seconds → everyone gets aggressive
  if (Number.isFinite(matchTimeRemaining) && matchTimeRemaining < 30) {
    personality.aggression = Math.min(1, personality.aggression + 0.15);
    personality.itemGreed  = Math.min(1, personality.itemGreed + 0.2);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ── Battle Target Selection ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Choose the best target for a battle bot to pursue.
 *
 * @param {BotPersonality} personality
 * @param {Vector3} myPos
 * @param {Array<{id: string, position: Vector3, health: number, score: number}>} enemies
 * @returns {{ id: string, position: Vector3 }|null}
 */
export function pickBattleTarget(personality, myPos, enemies) {
  if (!enemies.length) return null;

  // Aggressive: pick nearest
  if (personality.strategy === 'aggressive') {
    return _nearest(myPos, enemies);
  }

  // Defensive: pick weakest (lowest health)
  if (personality.strategy === 'defensive') {
    const sorted = [...enemies].sort((a, b) => a.health - b.health);
    return sorted[0];
  }

  // Opportunist / balanced: weighted by distance + health
  let best = null;
  let bestScore = -Infinity;
  for (const e of enemies) {
    const dist = _dist(myPos, e.position);
    const dScore = 1 / (dist + 5);          // closer is better
    const hScore = (100 - e.health) / 100;   // lower health is better
    const score = dScore * 0.6 + hScore * 0.4;
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

function _nearest(pos, arr) {
  let best = null, bestD = Infinity;
  for (const e of arr) {
    const d = _dist(pos, e.position);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

function _dist(a, b) {
  const dx = (a.x ?? a._x ?? 0) - (b.x ?? b._x ?? 0);
  const dz = (a.z ?? a._z ?? 0) - (b.z ?? b._z ?? 0);
  return Math.sqrt(dx * dx + dz * dz);
}
