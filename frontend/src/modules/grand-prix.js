/**
 * grand-prix.js — Grand Prix mode manager.
 *
 * Manages a sequence of races within a cup. After each race finishes,
 * shows intermediate standings and advances to the next track.
 *
 * Scoring: 1st=10, 2nd=8, 3rd=6, 4th=5, 5th=4, 6th=3, 7th=2, 8th=1
 */

import { SINGLE_PLAYER_CUPS } from './content-registry.js';

// STK Grand Prix scoring (like Mario Kart)
const POINTS_TABLE = [10, 8, 6, 5, 4, 3, 2, 1];

function getPoints(position) {
  return POINTS_TABLE[position] ?? 0;
}

// ── State ───────────────────────────────────────────────────────────────────

let _active  = false;
let _cup     = null;   // cup definition from SINGLE_PLAYER_CUPS
let _raceIdx = 0;      // 0-based index of current race
let _standings = [];    // [ { id, name, totalPoints, results: [pos,...] } ]
let _onTrackChange = null; // callback when next race should load

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Start a Grand Prix for the given cup.
 * @param {string}   cupId
 * @param {string[]} competitorNames  Array of names (index 0 = player)
 * @param {Function} onTrackChange    Called with (trackId, raceNumber, totalRaces) when the next race should start
 * @returns {{ cupLabel, trackId, raceNumber, totalRaces }} Initial race info
 */
export function startGrandPrix(cupId, competitorNames, onTrackChange) {
  _cup = SINGLE_PLAYER_CUPS[cupId];
  if (!_cup) {
    console.warn(`Grand Prix: unknown cup "${cupId}", falling back to starter`);
    _cup = SINGLE_PLAYER_CUPS.starter;
  }

  _raceIdx = 0;
  _onTrackChange = onTrackChange;
  _active = true;

  // Initialize standings for all competitors
  _standings = competitorNames.map((name, i) => ({
    id: i === 0 ? 'player' : `bot-${i - 1}`,
    name,
    totalPoints: 0,
    results: [],
  }));

  return {
    cupLabel: _cup.label,
    trackId: _cup.trackIds[0],
    raceNumber: 1,
    totalRaces: _cup.trackIds.length,
  };
}

/**
 * Report the result of the current race.
 * @param {Array<{id: string, name: string}>} finishOrder  Ordered by finishing position (0=winner)
 */
export function reportRaceResult(finishOrder) {
  if (!_active) return;

  for (let pos = 0; pos < finishOrder.length; pos++) {
    const entry = finishOrder[pos];
    const standing = _standings.find(s => s.id === entry.id);
    if (standing) {
      standing.results.push(pos + 1); // 1-based position
      standing.totalPoints += getPoints(pos);
    }
  }

  // Sort standings by total points (descending)
  _standings.sort((a, b) => b.totalPoints - a.totalPoints);
}

/**
 * Check if there are more races in the cup.
 */
export function hasNextRace() {
  if (!_active || !_cup) return false;
  return _raceIdx + 1 < _cup.trackIds.length;
}

/**
 * Advance to the next race in the cup.
 * @returns {{ trackId, raceNumber, totalRaces } | null}
 */
export function advanceToNextRace() {
  if (!hasNextRace()) return null;

  _raceIdx++;
  const trackId = _cup.trackIds[_raceIdx];
  const info = {
    trackId,
    raceNumber: _raceIdx + 1,
    totalRaces: _cup.trackIds.length,
  };

  if (_onTrackChange) {
    _onTrackChange(trackId, info.raceNumber, info.totalRaces);
  }

  return info;
}

/**
 * Get current standings.
 * @returns {Array<{id, name, totalPoints, results, rank}>}
 */
export function getStandings() {
  return _standings.map((s, i) => ({ ...s, rank: i + 1 }));
}

/**
 * Get current race info.
 */
export function getCurrentRaceInfo() {
  if (!_active || !_cup) return null;
  return {
    cupId: _cup.id,
    cupLabel: _cup.label,
    cupIcon: _cup.icon,
    trackId: _cup.trackIds[_raceIdx],
    raceNumber: _raceIdx + 1,
    totalRaces: _cup.trackIds.length,
  };
}

/**
 * Is GP mode active?
 */
export function isGrandPrixActive() {
  return _active;
}

/**
 * End the grand prix.
 */
export function endGrandPrix() {
  _active = false;
  _cup = null;
  _raceIdx = 0;
  _standings = [];
  _onTrackChange = null;
}

// ── UI helpers ──────────────────────────────────────────────────────────────

/**
 * Show intermediate standings overlay between races.
 * Returns a Promise that resolves when the user clicks to continue.
 */
export function showStandingsOverlay() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = 'gp-standings-overlay';
    overlay.style.cssText = `
      position:fixed; top:0; left:0; width:100%; height:100%;
      background:rgba(0,0,0,0.85); z-index:2000;
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      font-family:Poppins,sans-serif; color:#fff;
    `;

    const info = getCurrentRaceInfo();
    const isLast = !hasNextRace();

    let html = `<div style="font-size:28px;font-weight:800;margin-bottom:4px">${info.cupIcon} ${info.cupLabel}</div>`;
    html += `<div style="font-size:16px;margin-bottom:20px;color:#aaa">Race ${info.raceNumber} of ${info.totalRaces} complete</div>`;

    // Standings table
    html += '<div style="background:rgba(255,255,255,0.08);border-radius:12px;padding:16px 32px;min-width:320px">';
    html += '<div style="display:flex;justify-content:space-between;font-weight:700;margin-bottom:8px;font-size:14px;color:#888"><span>RACER</span><span>PTS</span></div>';

    for (const s of _standings) {
      const isPlayer = s.id === 'player';
      const color = isPlayer ? '#4ade80' : '#ddd';
      const weight = isPlayer ? '700' : '400';
      const prevResults = s.results.map(r => ordinal(r)).join(', ');
      html += `<div style="display:flex;justify-content:space-between;color:${color};font-weight:${weight};font-size:15px;margin-bottom:4px">
        <span>${s.name} <span style="font-size:11px;color:#888">(${prevResults})</span></span>
        <span>${s.totalPoints}</span>
      </div>`;
    }
    html += '</div>';

    // Button
    const btnLabel = isLast ? '🏆 View Final Results' : '▶ Next Race';
    html += `<button id="gp-continue-btn" style="
      margin-top:24px; padding:12px 36px; font-size:18px; font-weight:700;
      background:linear-gradient(135deg,#ff6b00,#ff3c00); color:#fff;
      border:none; border-radius:10px; cursor:pointer;
      font-family:Poppins,sans-serif;
    ">${btnLabel}</button>`;

    overlay.innerHTML = html;
    document.body.appendChild(overlay);

    document.getElementById('gp-continue-btn').addEventListener('click', () => {
      overlay.remove();
      resolve(isLast ? 'final' : 'next');
    });
  });
}

/**
 * Show final championship results overlay.
 */
export function showFinalResultsOverlay() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = 'gp-final-overlay';
    overlay.style.cssText = `
      position:fixed; top:0; left:0; width:100%; height:100%;
      background:rgba(0,0,0,0.9); z-index:2000;
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      font-family:Poppins,sans-serif; color:#fff;
    `;

    const info = getCurrentRaceInfo();
    const winner = _standings[0];
    const playerStanding = _standings.find(s => s.id === 'player');
    const playerRank = _standings.indexOf(playerStanding) + 1;

    let html = `<div style="font-size:48px;margin-bottom:8px">🏆</div>`;
    html += `<div style="font-size:32px;font-weight:800;margin-bottom:4px">${info.cupIcon} ${info.cupLabel}</div>`;
    html += `<div style="font-size:18px;color:#aaa;margin-bottom:24px">GRAND PRIX COMPLETE</div>`;

    if (playerRank === 1) {
      html += `<div style="font-size:22px;color:#ffd700;font-weight:700;margin-bottom:16px">🥇 YOU WIN!</div>`;
    } else {
      html += `<div style="font-size:18px;color:#ccc;margin-bottom:16px">You finished ${ordinal(playerRank)}</div>`;
    }

    // Final standings
    html += '<div style="background:rgba(255,255,255,0.08);border-radius:12px;padding:16px 32px;min-width:340px">';
    const medals = ['🥇', '🥈', '🥉'];
    for (let i = 0; i < _standings.length; i++) {
      const s = _standings[i];
      const isPlayer = s.id === 'player';
      const color = isPlayer ? '#4ade80' : '#ddd';
      const medal = medals[i] || `${i + 1}.`;
      html += `<div style="display:flex;justify-content:space-between;color:${color};font-weight:${isPlayer ? 700 : 400};font-size:16px;margin-bottom:5px">
        <span>${medal} ${s.name}</span>
        <span>${s.totalPoints} pts</span>
      </div>`;
    }
    html += '</div>';

    html += `<button id="gp-done-btn" style="
      margin-top:24px; padding:12px 36px; font-size:18px; font-weight:700;
      background:linear-gradient(135deg,#4ade80,#22c55e); color:#fff;
      border:none; border-radius:10px; cursor:pointer;
      font-family:Poppins,sans-serif;
    ">Back to Lobby</button>`;

    overlay.innerHTML = html;
    document.body.appendChild(overlay);

    document.getElementById('gp-done-btn').addEventListener('click', () => {
      overlay.remove();
      resolve();
    });
  });
}

// ── Utilities ───────────────────────────────────────────────────────────────

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
