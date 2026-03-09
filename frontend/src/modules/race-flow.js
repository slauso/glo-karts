/**
 * race-flow.js — Reusable race state machine for all race-family modes.
 *
 * States: LOADING → PRE_RACE → COUNTDOWN → RACING → FINISHING → RESULTS
 *
 * Manages:
 *  - Starting grid placement
 *  - Countdown sequence (traffic light integration)
 *  - Lap tracking with split times
 *  - Position tracking across all racers
 *  - Finish sequence with result rankings
 *  - Grand Prix progression hooks
 *  - Time Trial ghost recording hooks
 *  - Follow-the-Leader elimination hooks
 */

// ── State enum ──────────────────────────────────────────────────────────────
export const RACE_STATE = Object.freeze({
  LOADING:   'LOADING',
  PRE_RACE:  'PRE_RACE',
  COUNTDOWN: 'COUNTDOWN',
  RACING:    'RACING',
  FINISHING: 'FINISHING',   // Player crossed finish but waiting for others / showing results
  RESULTS:   'RESULTS',     // Final results screen
});

/**
 * Create a new race-flow controller.
 *
 * @param {object} opts
 * @param {number} [opts.totalLaps=3]
 * @param {number} [opts.countdownDuration=3]  Seconds (3-2-1-GO)
 * @param {number} [opts.resultsDelay=5]       Seconds before auto-transition to RESULTS
 * @param {string} [opts.subMode='normal']     'normal' | 'time_trial' | 'grand_prix' | 'follow_the_leader' | 'free_roam'
 * @param {number} [opts.totalRacers=1]
 * @returns {RaceFlow}
 */
export function createRaceFlow(opts = {}) {
  const totalLaps        = opts.totalLaps ?? 3;
  const countdownDuration= opts.countdownDuration ?? 3;
  const resultsDelay     = opts.resultsDelay ?? 5;
  const subMode          = opts.subMode ?? 'normal';
  const totalRacers      = opts.totalRacers ?? 1;

  return {
    // ── Core state ──
    state:          RACE_STATE.LOADING,
    subMode,
    totalLaps,
    countdownDuration,
    resultsDelay,

    // ── Timing ──
    raceStartTime:  0,       // epoch ms when RACING began
    raceElapsed:    0,       // seconds since race start
    countdownTimer: countdownDuration,

    // ── Lap tracking ──
    currentLap:     0,
    lapTimes:       [],      // array of seconds per completed lap
    bestLapTime:    Infinity,
    lastLapStart:   0,       // elapsed time when current lap started

    // ── Positions ──
    totalRacers,
    /** @type {Array<{id: string, name: string, lap: number, progress: number, finished: boolean, finishTime: number}>} */
    standings:      [],

    // ── Finish ──
    playerFinished: false,
    finishTime:     0,       // seconds
    resultsTimer:   0,

    // ── Callbacks (set by consumer) ──
    onCountdownTick:  null,  // (remaining: number) => void
    onCountdownGo:    null,  // () => void
    onLapComplete:    null,  // (lap: number, lapTime: number, isBest: boolean) => void
    onRaceFinished:   null,  // (finishTime: number) => void
    onAllFinished:    null,  // (standings: Array) => void
    onEliminated:     null,  // (id: string) => void  (FTL)
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ── State Transitions ──────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

/** Transition to PRE_RACE (track loaded, karts at grid). */
export function startPreRace(flow) {
  flow.state = RACE_STATE.PRE_RACE;
  flow.currentLap = 0;
  flow.lapTimes = [];
  flow.bestLapTime = Infinity;
  flow.playerFinished = false;
  flow.finishTime = 0;
  flow.raceElapsed = 0;
  flow.standings = [];
}

/** Begin countdown sequence. */
export function startCountdownFlow(flow) {
  flow.state = RACE_STATE.COUNTDOWN;
  flow.countdownTimer = flow.countdownDuration;
}

/** Begin racing (called at GO). */
export function startRacing(flow) {
  flow.state = RACE_STATE.RACING;
  flow.raceStartTime = Date.now();
  flow.raceElapsed = 0;
  flow.lastLapStart = 0;
  flow.currentLap = 0;
  if (flow.onCountdownGo) flow.onCountdownGo();
}

/** Player crossed finish line — transition to FINISHING. */
export function playerFinish(flow) {
  flow.playerFinished = true;
  flow.finishTime = flow.raceElapsed;
  flow.state = RACE_STATE.FINISHING;
  flow.resultsTimer = flow.resultsDelay;
  if (flow.onRaceFinished) flow.onRaceFinished(flow.finishTime);
}

/** Show final results. */
export function showResults(flow) {
  flow.state = RACE_STATE.RESULTS;
  if (flow.onAllFinished) flow.onAllFinished(flow.standings);
}

// ═══════════════════════════════════════════════════════════════════════════
// ── Per-Frame Tick ─────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tick the race-flow state machine.
 *
 * @param {ReturnType<typeof createRaceFlow>} flow
 * @param {number} dt  Delta time (seconds)
 * @param {object} [events]
 * @param {boolean} [events.lapCrossed]     True when checkpoint system reports lap complete
 * @param {boolean} [events.raceFinished]   True when checkpoint system says final lap done
 * @param {Array}   [events.positions]      Current racer positions array from bot-controller
 */
export function tickRaceFlow(flow, dt, events = {}) {
  switch (flow.state) {
    case RACE_STATE.COUNTDOWN: {
      flow.countdownTimer -= dt;
      const remaining = Math.ceil(flow.countdownTimer);
      if (flow.onCountdownTick) flow.onCountdownTick(remaining);
      if (flow.countdownTimer <= 0) {
        startRacing(flow);
      }
      break;
    }

    case RACE_STATE.RACING: {
      flow.raceElapsed = (Date.now() - flow.raceStartTime) / 1000;

      // Lap completion
      if (events.lapCrossed) {
        const lapTime = flow.raceElapsed - flow.lastLapStart;
        flow.lapTimes.push(lapTime);
        flow.currentLap++;
        flow.lastLapStart = flow.raceElapsed;

        const isBest = lapTime < flow.bestLapTime;
        if (isBest) flow.bestLapTime = lapTime;

        if (flow.onLapComplete) flow.onLapComplete(flow.currentLap, lapTime, isBest);
      }

      // Race finished
      if (events.raceFinished && !flow.playerFinished) {
        playerFinish(flow);
      }

      // Update standings from external position tracker
      if (events.positions) {
        flow.standings = events.positions;
      }
      break;
    }

    case RACE_STATE.FINISHING: {
      flow.resultsTimer -= dt;
      flow.raceElapsed = (Date.now() - flow.raceStartTime) / 1000;

      // Auto-transition to results
      if (flow.resultsTimer <= 0) {
        showResults(flow);
      }
      break;
    }

    default:
      break;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ── Queries ────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

export function isRacing(flow) {
  return flow.state === RACE_STATE.RACING;
}

export function isCountdown(flow) {
  return flow.state === RACE_STATE.COUNTDOWN;
}

export function isFinished(flow) {
  return flow.state === RACE_STATE.FINISHING || flow.state === RACE_STATE.RESULTS;
}

export function getElapsedTime(flow) {
  return flow.raceElapsed;
}

export function getFormattedTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

export function getCurrentLapTime(flow) {
  if (flow.state !== RACE_STATE.RACING) return 0;
  return flow.raceElapsed - flow.lastLapStart;
}

export function getPlayerPosition(flow, playerId = 'player') {
  const idx = flow.standings.findIndex(s => s.id === playerId);
  return idx >= 0 ? idx + 1 : flow.totalRacers;
}
