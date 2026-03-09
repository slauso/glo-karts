/**
 * battle-flow.js — Reusable battle state machine for all battle-family modes.
 *
 * States: LOADING → SPAWN → COUNTDOWN → BATTLE → MATCH_END → RESULTS
 *
 * Manages:
 *  - Arena spawn with invulnerability
 *  - Countdown sequence
 *  - Health/lives tracking per combatant
 *  - Weapon pickup cycle & cooldowns
 *  - Kill feed event log
 *  - Score tracking (kills, deaths, assists)
 *  - Match-end conditions (time limit, score limit, last man standing)
 *  - Return-to-lobby transition
 *
 * Sub-modes: 'deathmatch' | 'three_strikes' | 'soccer'
 */

// ── State enum ──────────────────────────────────────────────────────────────
export const BATTLE_STATE = Object.freeze({
  LOADING:   'LOADING',
  SPAWN:     'SPAWN',
  COUNTDOWN: 'COUNTDOWN',
  BATTLE:    'BATTLE',
  MATCH_END: 'MATCH_END',
  RESULTS:   'RESULTS',
});

// ── Match end reasons ───────────────────────────────────────────────────────
export const END_REASON = Object.freeze({
  TIME_LIMIT:    'TIME_LIMIT',
  SCORE_LIMIT:   'SCORE_LIMIT',
  LAST_STANDING: 'LAST_STANDING',
  MANUAL:        'MANUAL',
});

/**
 * Create a new battle-flow controller.
 *
 * @param {object} opts
 * @param {string} [opts.subMode='deathmatch']  'deathmatch' | 'three_strikes' | 'soccer'
 * @param {number} [opts.timeLimit=180]          Match time in seconds (0 = unlimited)
 * @param {number} [opts.scoreLimit=10]          Kills/goals to win (0 = unlimited)
 * @param {number} [opts.lives=3]                Lives for three_strikes mode
 * @param {number} [opts.maxHealth=100]
 * @param {number} [opts.respawnTime=3]          Seconds before respawn
 * @param {number} [opts.invulnTime=2]           Seconds of invulnerability after spawn
 * @param {number} [opts.countdownDuration=3]
 * @param {number} [opts.resultsDelay=5]
 * @param {number} [opts.weaponSpawnInterval=7]  Seconds between weapon spawns at pickup points
 * @returns {BattleFlow}
 */
export function createBattleFlow(opts = {}) {
  return {
    state:             BATTLE_STATE.LOADING,
    subMode:           opts.subMode ?? 'deathmatch',

    // ── Timing ──
    timeLimit:         opts.timeLimit ?? 180,
    matchElapsed:      0,
    matchStartTime:    0,
    countdownDuration: opts.countdownDuration ?? 3,
    countdownTimer:    opts.countdownDuration ?? 3,
    resultsDelay:      opts.resultsDelay ?? 5,
    resultsTimer:      0,

    // ── Combat config ──
    scoreLimit:        opts.scoreLimit ?? 10,
    maxHealth:         opts.maxHealth ?? 100,
    lives:             opts.lives ?? 3,
    respawnTime:       opts.respawnTime ?? 3,
    invulnTime:        opts.invulnTime ?? 2,
    weaponSpawnInterval: opts.weaponSpawnInterval ?? 7,

    // ── Per-combatant state ──
    /** @type {Map<string, CombatantState>} */
    combatants: new Map(),

    // ── Kill feed ──
    /** @type {Array<{time: number, killerId: string, victimId: string, weaponId: string}>} */
    killFeed: [],
    killFeedMax: 5,

    // ── Match end ──
    endReason: null,
    winnerId:  null,

    // ── Callbacks ──
    onCountdownTick: null,  // (remaining: number) => void
    onCountdownGo:   null,  // () => void
    onKill:          null,  // (killerId, victimId, weaponId) => void
    onRespawn:       null,  // (id) => void
    onMatchEnd:      null,  // (winnerId, reason, standings) => void
    onGoalScored:    null,  // (team: 'red'|'blue', scorerId) => void  (soccer)
  };
}

// ── Combatant state factory ─────────────────────────────────────────────────
function _newCombatant(id, name, team = null, maxHealth = 100, lives = 3) {
  return {
    id,
    name,
    team,
    health:      maxHealth,
    maxHealth,
    lives,
    kills:       0,
    deaths:      0,
    score:       0,
    alive:       true,
    invulnTimer: 0,
    respawnTimer:0,
    eliminated:  false,  // three_strikes: out of lives
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ── State Transitions ──────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Register a combatant (player or bot).
 */
export function addCombatant(flow, id, name, team = null) {
  flow.combatants.set(id, _newCombatant(id, name, team, flow.maxHealth, flow.lives));
}

/** Transition to SPAWN (arena loaded, placing karts). */
export function startSpawn(flow) {
  flow.state = BATTLE_STATE.SPAWN;
  for (const c of flow.combatants.values()) {
    c.health = flow.maxHealth;
    c.lives  = flow.lives;
    c.alive  = true;
    c.eliminated = false;
    c.invulnTimer = flow.invulnTime;
  }
}

/** Begin countdown. */
export function startBattleCountdown(flow) {
  flow.state = BATTLE_STATE.COUNTDOWN;
  flow.countdownTimer = flow.countdownDuration;
}

/** Begin battle (called at GO). */
export function startBattle(flow) {
  flow.state = BATTLE_STATE.BATTLE;
  flow.matchStartTime = Date.now();
  flow.matchElapsed = 0;
  flow.killFeed = [];
  if (flow.onCountdownGo) flow.onCountdownGo();
}

/** End the match. */
export function endMatch(flow, reason) {
  flow.state = BATTLE_STATE.MATCH_END;
  flow.endReason = reason;
  flow.resultsTimer = flow.resultsDelay;

  // Determine winner
  const standings = getStandings(flow);
  flow.winnerId = standings.length > 0 ? standings[0].id : null;

  if (flow.onMatchEnd) flow.onMatchEnd(flow.winnerId, reason, standings);
}

/** Show final results. */
export function showBattleResults(flow) {
  flow.state = BATTLE_STATE.RESULTS;
}

// ═══════════════════════════════════════════════════════════════════════════
// ── Combat Events ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Apply damage to a combatant.
 * @returns {{ killed: boolean, health: number }}
 */
export function applyDamage(flow, targetId, amount, attackerId = null, weaponId = '') {
  const target = flow.combatants.get(targetId);
  if (!target || !target.alive || target.invulnTimer > 0 || target.eliminated) {
    return { killed: false, health: target?.health ?? 0 };
  }

  target.health = Math.max(0, target.health - amount);

  if (target.health <= 0) {
    // Kill
    target.alive = false;
    target.deaths++;
    target.respawnTimer = flow.respawnTime;

    // Three strikes: deduct life
    if (flow.subMode === 'three_strikes') {
      target.lives--;
      if (target.lives <= 0) target.eliminated = true;
    }

    // Credit attacker
    if (attackerId) {
      const attacker = flow.combatants.get(attackerId);
      if (attacker) {
        attacker.kills++;
        attacker.score++;
      }
    }

    // Kill feed
    flow.killFeed.push({
      time: flow.matchElapsed,
      killerId: attackerId || '',
      victimId: targetId,
      weaponId,
    });
    if (flow.killFeed.length > flow.killFeedMax) flow.killFeed.shift();

    if (flow.onKill) flow.onKill(attackerId, targetId, weaponId);

    return { killed: true, health: 0 };
  }

  return { killed: false, health: target.health };
}

/**
 * Heal a combatant.
 */
export function healCombatant(flow, id, amount) {
  const c = flow.combatants.get(id);
  if (!c) return;
  c.health = Math.min(c.maxHealth, c.health + amount);
}

/**
 * Record a goal (soccer mode).
 */
export function recordGoal(flow, team, scorerId = null) {
  if (flow.subMode !== 'soccer') return;
  // In soccer, score tracks goals for teams
  for (const c of flow.combatants.values()) {
    if (c.team === team) c.score++;
  }
  if (flow.onGoalScored) flow.onGoalScored(team, scorerId);
}

// ═══════════════════════════════════════════════════════════════════════════
// ── Per-Frame Tick ─────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tick the battle-flow state machine.
 *
 * @param {ReturnType<typeof createBattleFlow>} flow
 * @param {number} dt
 */
export function tickBattleFlow(flow, dt) {
  switch (flow.state) {
    case BATTLE_STATE.COUNTDOWN: {
      flow.countdownTimer -= dt;
      if (flow.onCountdownTick) flow.onCountdownTick(Math.ceil(flow.countdownTimer));
      if (flow.countdownTimer <= 0) startBattle(flow);
      break;
    }

    case BATTLE_STATE.BATTLE: {
      flow.matchElapsed = (Date.now() - flow.matchStartTime) / 1000;

      // ── Respawn timers ──
      for (const c of flow.combatants.values()) {
        if (c.invulnTimer > 0) c.invulnTimer -= dt;
        if (!c.alive && !c.eliminated) {
          c.respawnTimer -= dt;
          if (c.respawnTimer <= 0) {
            c.alive = true;
            c.health = c.maxHealth;
            c.invulnTimer = flow.invulnTime;
            if (flow.onRespawn) flow.onRespawn(c.id);
          }
        }
      }

      // ── Check end conditions ──
      // Time limit
      if (flow.timeLimit > 0 && flow.matchElapsed >= flow.timeLimit) {
        endMatch(flow, END_REASON.TIME_LIMIT);
        break;
      }

      // Score limit (deathmatch/soccer)
      if (flow.scoreLimit > 0) {
        for (const c of flow.combatants.values()) {
          if (c.score >= flow.scoreLimit) {
            endMatch(flow, END_REASON.SCORE_LIMIT);
            return;
          }
        }
      }

      // Last standing (three_strikes)
      if (flow.subMode === 'three_strikes') {
        const alive = [...flow.combatants.values()].filter(c => !c.eliminated);
        if (alive.length <= 1) {
          endMatch(flow, END_REASON.LAST_STANDING);
        }
      }
      break;
    }

    case BATTLE_STATE.MATCH_END: {
      flow.resultsTimer -= dt;
      if (flow.resultsTimer <= 0) showBattleResults(flow);
      break;
    }

    default:
      break;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ── Queries ────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

export function isBattleActive(flow) {
  return flow.state === BATTLE_STATE.BATTLE;
}

export function getTimeRemaining(flow) {
  if (flow.timeLimit <= 0) return Infinity;
  return Math.max(0, flow.timeLimit - flow.matchElapsed);
}

export function getFormattedTimeRemaining(flow) {
  const r = getTimeRemaining(flow);
  if (!Number.isFinite(r)) return '--:--';
  const m = Math.floor(r / 60);
  const s = Math.floor(r % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Get sorted standings (highest score first).
 */
export function getStandings(flow) {
  return [...flow.combatants.values()]
    .sort((a, b) => b.score - a.score || a.deaths - b.deaths)
    .map((c, i) => ({ rank: i + 1, ...c }));
}

export function getCombatant(flow, id) {
  return flow.combatants.get(id) || null;
}

export function getKillFeed(flow) {
  return flow.killFeed;
}
