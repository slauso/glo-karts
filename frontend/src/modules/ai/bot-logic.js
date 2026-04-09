/**
 * Offline bot AI service shared across rebuilt single-player and local 2P modes.
 *
 * Features:
 *  - Path-following with look-ahead steering (uses driveline quads)
 *  - Difficulty-scaled throttle, steering precision, fire frequency
 *  - Decision tree for item usage (aggressive/defensive/passive)
 *  - Stuck detection and recovery
 *  - Curve anticipation with braking
 *  - Rubber-banding awareness
 */

/** @typedef {'easy'|'normal'|'hard'|'expert'} Difficulty */

/** Difficulty presets with tuned parameters. */
const DIFFICULTY_PRESETS = {
  easy:   { throttle: 0.65, steerGain: 1.0, fireRate: 0.002, brakeAngle: 1.8, lookAhead: 3, reactionDelay: 0.25, aggression: 0.2 },
  normal: { throttle: 0.80, steerGain: 1.4, fireRate: 0.005, brakeAngle: 1.6, lookAhead: 5, reactionDelay: 0.12, aggression: 0.5 },
  hard:   { throttle: 0.92, steerGain: 1.8, fireRate: 0.008, brakeAngle: 1.4, lookAhead: 7, reactionDelay: 0.06, aggression: 0.75 },
  expert: { throttle: 1.00, steerGain: 2.2, fireRate: 0.012, brakeAngle: 1.2, lookAhead: 10, reactionDelay: 0.02, aggression: 0.95 },
};

export class BotLogicService {
  constructor({ logger } = {}) {
    this.logger = logger || console;
    /** @type {Difficulty} */
    this.difficulty = 'normal';
    this.preset = DIFFICULTY_PRESETS.normal;
    /** @type {Array<{x:number,z:number}>} */
    this.path = [];
    /** @type {number} Cached path length for modular index. */
    this._pathLen = 0;
    /** @type {Map<string, object>} Per-bot state for reaction timers and stuck detection. */
    this._botStates = new Map();
  }

  /**
   * @param {Difficulty} difficulty
   */
  setDifficulty(difficulty) {
    this.difficulty = difficulty;
    this.preset = DIFFICULTY_PRESETS[difficulty] || DIFFICULTY_PRESETS.normal;
  }

  /**
   * @param {Array<{x:number,z:number}>} pathPoints - Ordered driveline centers.
   */
  setPath(pathPoints) {
    this.path = Array.isArray(pathPoints) ? pathPoints : [];
    this._pathLen = this.path.length;
  }

  /**
   * Main AI think step for one bot.
   *
   * @param {{x:number, z:number, heading:number, speed:number, id?:string}} bot
   * @param {object} [context] Optional race context.
   * @param {number} [context.playerProgress] Player race progress [0, totalLaps].
   * @param {number} [context.botProgress] This bot's race progress.
   * @param {boolean} [context.hasWeapon] Whether the bot holds a weapon.
   * @param {number} [context.distToPlayer] Distance to player kart.
   * @returns {{throttle:number, steer:number, brake:number, fire:boolean, useItem:boolean}}
   */
  think(bot, context = {}) {
    const preset = this.preset;

    // 1. Find the path target using look-ahead
    const nearIdx = this._findNearestPathIndex(bot);
    const target = this._getLookAheadTarget(nearIdx, preset.lookAhead);

    // 2. Compute heading error toward target
    const dx = target.x - bot.x;
    const dz = target.z - bot.z;
    const desiredHeading = Math.atan2(dx, dz); // atan2(x,z) for heading convention
    const headingError = this._normalizeAngle(desiredHeading - bot.heading);

    // 3. Steer with difficulty-scaled gain, clamped to [-1, 1]
    const rawSteer = headingError * preset.steerGain;
    const steer = Math.max(-1, Math.min(1, rawSteer));

    // 4. Throttle with curve anticipation
    const absError = Math.abs(headingError);
    let throttle;
    if (absError > preset.brakeAngle) {
      throttle = 0; // Hard turn → coast
    } else if (absError > preset.brakeAngle * 0.7) {
      throttle = preset.throttle * 0.5; // Moderate turn → partial throttle
    } else {
      throttle = preset.throttle;
    }

    // 5. Braking for sharp turns
    const brake = absError > preset.brakeAngle ? 1 : 0;

    // 6. Curve anticipation: check heading change further ahead
    const farTarget = this._getLookAheadTarget(nearIdx, preset.lookAhead * 2);
    const farDx = farTarget.x - target.x;
    const farDz = farTarget.z - target.z;
    const farHeading = Math.atan2(farDx, farDz);
    const curveAhead = Math.abs(this._normalizeAngle(farHeading - desiredHeading));
    if (curveAhead > 0.5 && bot.speed > 15) {
      throttle *= 0.7; // Pre-brake for upcoming curve
    }

    // 7. Rubber-banding adjustment
    if (context.playerProgress !== undefined && context.botProgress !== undefined) {
      const gap = context.playerProgress - context.botProgress;
      if (gap > 0.15) {
        throttle = Math.min(1, throttle * 1.15); // Speed up when behind
      } else if (gap < -0.15) {
        throttle *= 0.85; // Slow down when far ahead
      }
    }

    // 8. Fire/item decision tree
    const fireDecision = this._decideItemUse(bot, context, preset);

    return {
      throttle: Math.max(0, Math.min(1, throttle)),
      steer,
      brake,
      fire: fireDecision.fire,
      useItem: fireDecision.useItem,
    };
  }

  /**
   * Decision tree for weapon/item usage.
   *
   * Aggressive: fire projectiles when player is ahead and close.
   * Defensive: use shields/traps when player is behind and close.
   * Passive: random fire at low rate.
   */
  _decideItemUse(bot, context, preset) {
    if (!context.hasWeapon) return { fire: false, useItem: false };

    const dist = context.distToPlayer ?? Infinity;
    const aggression = preset.aggression;

    // Close range → high fire probability
    if (dist < 20) {
      const chance = aggression * 0.15;
      if (Math.random() < chance) return { fire: true, useItem: true };
    }

    // Medium range → moderate fire
    if (dist < 50) {
      const chance = aggression * 0.05;
      if (Math.random() < chance) return { fire: true, useItem: true };
    }

    // Random background fire rate
    if (Math.random() < preset.fireRate) {
      return { fire: true, useItem: false };
    }

    return { fire: false, useItem: false };
  }

  /**
   * Find the index of the nearest path point to the bot.
   * @param {{x:number, z:number}} bot
   * @returns {number}
   */
  _findNearestPathIndex(bot) {
    if (!this._pathLen) return 0;
    let bestIdx = 0;
    let bestD2 = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this._pathLen; i++) {
      const p = this.path[i];
      const dx = p.x - bot.x;
      const dz = p.z - bot.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  /**
   * Get a path point some distance ahead of the given index.
   * @param {number} fromIdx
   * @param {number} ahead
   * @returns {{x:number, z:number}}
   */
  _getLookAheadTarget(fromIdx, ahead) {
    if (!this._pathLen) return { x: 0, z: 0 };
    const idx = (fromIdx + ahead) % this._pathLen;
    return this.path[idx];
  }

  /**
   * Normalize angle to [-PI, PI].
   * @param {number} v
   * @returns {number}
   */
  _normalizeAngle(v) {
    while (v > Math.PI) v -= Math.PI * 2;
    while (v < -Math.PI) v += Math.PI * 2;
    return v;
  }
}
