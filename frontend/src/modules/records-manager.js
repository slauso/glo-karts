/**
 * records-manager.js — localStorage-based personal best records per track/mode.
 *
 * Stores:
 *  - Race times (total race, best lap)
 *  - Battle scores (kills, best streak)
 *  - Grand Prix standings
 *
 * Records are keyed by `trackId:mode:subMode` for uniqueness.
 */

const STORAGE_KEY = 'twistedkart_records';

/**
 * @typedef {object} RaceRecord
 * @property {number} raceTime     Total race time in seconds
 * @property {number} bestLap      Best lap time in seconds
 * @property {number[]} lapTimes   Per-lap times
 * @property {number} position     Finish position (1-indexed)
 * @property {string} date         ISO date string
 */

/**
 * @typedef {object} BattleRecord
 * @property {number} kills
 * @property {number} deaths
 * @property {number} score
 * @property {string} date
 */

// ── Internal storage ────────────────────────────────────────────────────────

function _load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function _save(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage full — silently fail
  }
}

function _key(trackId, mode, subMode) {
  return `${trackId}:${mode}:${subMode || 'default'}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// ── Race Records ───────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Save a race result. Updates personal bests if improved.
 *
 * @param {string} trackId
 * @param {string} subMode  'normal' | 'time_trial' | 'grand_prix'
 * @param {RaceRecord} result
 * @returns {{ newPBRace: boolean, newPBLap: boolean }}
 */
export function saveRaceRecord(trackId, subMode, result) {
  const data = _load();
  const key  = _key(trackId, 'race', subMode);
  const existing = data[key];

  let newPBRace = false;
  let newPBLap  = false;

  if (!existing) {
    data[key] = {
      bestRaceTime: result.raceTime,
      bestLapTime:  result.bestLap,
      bestPosition: result.position,
      history:      [{ ...result, date: new Date().toISOString() }],
    };
    newPBRace = true;
    newPBLap  = true;
  } else {
    if (result.raceTime < existing.bestRaceTime) {
      existing.bestRaceTime = result.raceTime;
      newPBRace = true;
    }
    if (result.bestLap < existing.bestLapTime) {
      existing.bestLapTime = result.bestLap;
      newPBLap = true;
    }
    if (result.position < existing.bestPosition) {
      existing.bestPosition = result.position;
    }
    // Keep last 20 races
    existing.history = existing.history || [];
    existing.history.push({ ...result, date: new Date().toISOString() });
    if (existing.history.length > 20) existing.history.shift();
  }

  _save(data);
  return { newPBRace, newPBLap };
}

/**
 * Get best race record for a track/mode.
 * @returns {{ bestRaceTime: number, bestLapTime: number, bestPosition: number }|null}
 */
export function getRaceRecord(trackId, subMode = 'normal') {
  const data = _load();
  return data[_key(trackId, 'race', subMode)] || null;
}

// ═══════════════════════════════════════════════════════════════════════════
// ── Battle Records ─────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Save a battle result.
 *
 * @param {string} arenaId
 * @param {string} subMode  'deathmatch' | 'three_strikes' | 'soccer'
 * @param {BattleRecord} result
 * @returns {{ newBestKills: boolean }}
 */
export function saveBattleRecord(arenaId, subMode, result) {
  const data = _load();
  const key  = _key(arenaId, 'battle', subMode);
  const existing = data[key];

  let newBestKills = false;

  if (!existing) {
    data[key] = {
      bestKills:  result.kills,
      bestScore:  result.score,
      history:    [{ ...result, date: new Date().toISOString() }],
    };
    newBestKills = true;
  } else {
    if (result.kills > existing.bestKills) {
      existing.bestKills = result.kills;
      newBestKills = true;
    }
    if (result.score > existing.bestScore) {
      existing.bestScore = result.score;
    }
    existing.history = existing.history || [];
    existing.history.push({ ...result, date: new Date().toISOString() });
    if (existing.history.length > 20) existing.history.shift();
  }

  _save(data);
  return { newBestKills };
}

export function getBattleRecord(arenaId, subMode = 'deathmatch') {
  const data = _load();
  return data[_key(arenaId, 'battle', subMode)] || null;
}

// ═══════════════════════════════════════════════════════════════════════════
// ── Queries ────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get all records (for lobby display).
 */
export function getAllRecords() {
  return _load();
}

/**
 * Format seconds to MM:SS.mmm display string.
 */
export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--.---';
  const m  = Math.floor(seconds / 60);
  const s  = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/**
 * Clear all records (debug / settings).
 */
export function clearAllRecords() {
  localStorage.removeItem(STORAGE_KEY);
}
