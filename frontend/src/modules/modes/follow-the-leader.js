/**
 * follow-the-leader.js — Follow-the-Leader game mode logic.
 *
 * Rules:
 *  - A pace-car bot leads the field at moderate speed.
 *  - Every ELIMINATION_INTERVAL seconds the racer in last place is eliminated.
 *  - Eliminated racers become spectators.
 *  - Last racer standing (besides the leader) wins.
 *
 * Integration:
 *   import { initFTL, updateFTL, isFTLActive, getFTLStatus, disposeFTL } from './modes/follow-the-leader.js';
 *   // In init():  initFTL(scene, bots, playerMesh);
 *   // In loop:    const status = updateFTL(dt, playerProgress, botProgressArray);
 *   // status.eliminated  → true when the player has been eliminated
 *   // status.winner      → true when the player is the last one standing
 */

// ── Config ──────────────────────────────────────────────────────────────────
const ELIMINATION_INTERVAL = 30;   // seconds between eliminations
const GRACE_PERIOD = 15;           // seconds before first elimination
const WARNING_TIME = 5;            // seconds remaining on timer to show warning

// ── State ───────────────────────────────────────────────────────────────────
let _active = false;
let _timer = 0;
let _graceRemaining = GRACE_PERIOD;
let _eliminatedIds = new Set();
let _botRefs = [];
let _playerMesh = null;
let _overlay = null;
let _timerEl = null;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Initialise Follow-the-Leader for a race.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {Array} bots — array from createRaceBots()
 * @param {import('@babylonjs/core').AbstractMesh} playerMesh
 */
export function initFTL(scene, bots, playerMesh) {
  _active = true;
  _timer = 0;
  _graceRemaining = GRACE_PERIOD;
  _eliminatedIds = new Set();
  _botRefs = bots || [];
  _playerMesh = playerMesh;

  // HUD overlay
  _overlay = document.createElement('div');
  _overlay.id = 'ftl-overlay';
  _overlay.style.cssText = `
    position:fixed; top:60px; left:50%; transform:translateX(-50%);
    color:#fff; font-family:'Poppins',sans-serif; font-size:18px;
    background:rgba(0,0,0,.55); padding:8px 20px; border-radius:8px;
    z-index:150; pointer-events:none; text-align:center;
  `;
  _timerEl = document.createElement('div');
  _timerEl.style.fontSize = '24px';
  _overlay.appendChild(_timerEl);
  document.body.appendChild(_overlay);
  _updateOverlay();
}

/**
 * Tick FTL logic each frame.
 * @param {number} dt - delta seconds
 * @param {number} playerProgress - player's driveline progress (0-1+)
 * @param {Array<{id: string, progress: number}>} standings — sorted by progress desc
 * @returns {{ eliminated: boolean, winner: boolean, lastPlaceId: string|null, remaining: number }}
 */
export function updateFTL(dt, playerProgress, standings) {
  if (!_active) return { eliminated: false, winner: false, lastPlaceId: null, remaining: 0 };

  // Grace period
  if (_graceRemaining > 0) {
    _graceRemaining -= dt;
    _updateOverlay();
    return { eliminated: false, winner: false, lastPlaceId: null, remaining: _aliveCount() };
  }

  _timer += dt;

  // Time to eliminate?
  if (_timer >= ELIMINATION_INTERVAL) {
    _timer -= ELIMINATION_INTERVAL;
    const lastId = _findLastPlace(standings, playerProgress);
    if (lastId) {
      _eliminatedIds.add(lastId);
      _hideBot(lastId);
    }
  }

  // Check player eliminated
  const playerEliminated = _eliminatedIds.has('player');

  // Check win condition — player is last racer alive (bots all eliminated)
  const alive = _aliveCount();
  const winner = alive <= 1 && !playerEliminated;

  if (playerEliminated || winner) _active = false;

  _updateOverlay();

  return {
    eliminated: playerEliminated,
    winner,
    lastPlaceId: null,
    remaining: alive,
  };
}

export function isFTLActive() { return _active; }

export function getFTLStatus() {
  return {
    active: _active,
    remaining: _aliveCount(),
    eliminatedIds: [..._eliminatedIds],
    graceRemaining: _graceRemaining,
    timer: _timer,
    nextElimIn: _graceRemaining > 0
      ? _graceRemaining + ELIMINATION_INTERVAL
      : ELIMINATION_INTERVAL - _timer,
  };
}

export function disposeFTL() {
  _active = false;
  _botRefs = [];
  _playerMesh = null;
  _eliminatedIds.clear();
  if (_overlay) { _overlay.remove(); _overlay = null; }
}

// ── Internals ───────────────────────────────────────────────────────────────

function _aliveCount() {
  // +1 for player if not eliminated, + non-eliminated bots
  let count = _eliminatedIds.has('player') ? 0 : 1;
  for (const b of _botRefs) {
    if (!_eliminatedIds.has(b.kartId || b.id)) count++;
  }
  return count;
}

function _findLastPlace(standings, playerProgress) {
  // Build combined standings list
  const all = [];
  all.push({ id: 'player', progress: playerProgress });
  for (const b of _botRefs) {
    const id = b.kartId || b.id;
    if (_eliminatedIds.has(id)) continue;
    const entry = standings.find(s => s.id === id);
    all.push({ id, progress: entry ? entry.progress : 0 });
  }
  if (all.length <= 1) return null;

  // Sort ascending by progress → last entry is first place, first is last
  all.sort((a, b) => a.progress - b.progress);
  const last = all[0];
  if (_eliminatedIds.has(last.id)) return null;
  return last.id;
}

function _hideBot(botId) {
  for (const b of _botRefs) {
    const id = b.kartId || b.id;
    if (id === botId && b.mesh) {
      b.mesh.setEnabled(false);
      b.eliminated = true;
    }
  }
}

function _updateOverlay() {
  if (!_timerEl) return;
  const alive = _aliveCount();

  if (_graceRemaining > 0) {
    _timerEl.textContent = `Follow the Leader — starts in ${Math.ceil(_graceRemaining)}s`;
  } else {
    const nextElim = ELIMINATION_INTERVAL - _timer;
    const warn = nextElim <= WARNING_TIME ? ' color:#ff5555;' : '';
    _timerEl.innerHTML = `<span>Racers left: ${alive}</span>` +
      `<br><span style="font-size:16px;${warn}">Next cut: ${Math.ceil(nextElim)}s</span>`;
  }
}
