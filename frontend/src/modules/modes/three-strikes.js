/**
 * three-strikes.js — 3-Strikes Battle mode logic.
 *
 * Rules:
 *  - Each racer starts with 3 lives (balloons).
 *  - Getting hit by a weapon costs one life.
 *  - At 0 lives the racer is eliminated.
 *  - Last racer standing wins.
 *
 * Integration (in battle-main.js):
 *   import { initThreeStrikes, onStrikeDamage, isPlayerAlive,
 *            getStrikesStatus, disposeThreeStrikes } from './modes/three-strikes.js';
 *   // initThreeStrikes(botCount) at start
 *   // onStrikeDamage(id) when a hit lands → returns { eliminated, livesLeft }
 */

// ── Config ──────────────────────────────────────────────────────────────────
const MAX_LIVES = 3;

// ── State ───────────────────────────────────────────────────────────────────
let _active = false;
/** @type {Map<string, number>} id → lives remaining */
let _lives = new Map();
let _eliminated = new Set();
let _hudEl = null;
let _balloonsEl = null;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Initialise 3-Strikes mode.
 * @param {string[]} participantIds — array of IDs (include 'player')
 */
export function initThreeStrikes(participantIds) {
  _active = true;
  _lives = new Map();
  _eliminated = new Set();

  for (const id of participantIds) {
    _lives.set(id, MAX_LIVES);
  }

  // HUD — balloon indicators for the player
  _hudEl = document.createElement('div');
  _hudEl.id = 'three-strikes-hud';
  _hudEl.style.cssText = `
    position:fixed; top:60px; right:20px;
    color:#fff; font-family:'Poppins',sans-serif; font-size:32px;
    z-index:160; pointer-events:none; text-align:right;
  `;
  _balloonsEl = document.createElement('div');
  _hudEl.appendChild(_balloonsEl);
  document.body.appendChild(_hudEl);
  _updateHUD();
}

/**
 * Record a hit against a participant.
 * @param {string} id - participant who was hit
 * @returns {{ eliminated: boolean, livesLeft: number }}
 */
export function onStrikeDamage(id) {
  if (!_active || _eliminated.has(id)) return { eliminated: true, livesLeft: 0 };
  let lives = (_lives.get(id) ?? 0) - 1;
  if (lives < 0) lives = 0;
  _lives.set(id, lives);

  if (lives === 0) {
    _eliminated.add(id);
  }

  if (id === 'player') _updateHUD();

  // Auto-end when one or fewer alive
  const aliveCount = _aliveCount();
  if (aliveCount <= 1) {
    _active = false;
  }

  return { eliminated: lives === 0, livesLeft: lives };
}

/** @returns {boolean} whether the player is still alive */
export function isPlayerAlive() {
  return !_eliminated.has('player');
}

export function isThreeStrikesActive() { return _active; }

/**
 * @returns {{ active: boolean, lives: Record<string,number>, eliminated: string[], winner: string|null }}
 */
export function getStrikesStatus() {
  const livesObj = Object.fromEntries(_lives);
  const alive = [..._lives.entries()].filter(([id, l]) => l > 0).map(([id]) => id);
  return {
    active: _active,
    lives: livesObj,
    eliminated: [..._eliminated],
    winner: alive.length === 1 ? alive[0] : null,
  };
}

export function disposeThreeStrikes() {
  _active = false;
  _lives.clear();
  _eliminated.clear();
  if (_hudEl) { _hudEl.remove(); _hudEl = null; }
}

// ── Internals ───────────────────────────────────────────────────────────────

function _aliveCount() {
  let c = 0;
  for (const [, lives] of _lives) { if (lives > 0) c++; }
  return c;
}

function _updateHUD() {
  if (!_balloonsEl) return;
  const playerLives = _lives.get('player') ?? 0;
  // Show balloon emojis for remaining lives
  _balloonsEl.textContent = '🎈'.repeat(playerLives) + '💥'.repeat(MAX_LIVES - playerLives);
}
