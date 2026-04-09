/**
 * checkpoints.js — Quad-based checkpoint & lap system for STK race tracks.
 *
 * Uses the driveline quads from track-data.json instead of gates.glb.
 * Tracks which quad the kart is nearest to → detects lap-line crossings
 * → increments lap count → signals race finish.
 */

import { getDriveline, getCheckpoints, getLapCount, getGraph } from './track-data-loader.js';

// ── State ───────────────────────────────────────────────────────────────────

let _driveline = [];
let _checkpoints = [];
let _graph = null;
let _totalLaps = 3;
let _currentLap = 0;
let _currentQuadIndex = 0;
let _lastQuadIndex = 0;
let _checkpointsPassed = new Set();
let _raceFinished = false;
let _lapLineQuad = 0;

// The minimum number of quads that must be traversed before a lap-line
// crossing is counted (prevents instant lap on spawn).
let _minQuadsForLap = 0;
let _quadsTraversed = 0;

// ── Setup ───────────────────────────────────────────────────────────────────

/**
 * Initialize the checkpoint system with loaded track data.
 * Call once after track-data.json is loaded.
 */
export function initCheckpoints(trackData) {
  _driveline = getDriveline(trackData);
  _checkpoints = getCheckpoints(trackData);
  _graph = getGraph(trackData);
  _totalLaps = getLapCount(trackData);
  _currentLap = 0;
  _currentQuadIndex = 0;
  _lastQuadIndex = 0;
  _checkpointsPassed = new Set();
  _raceFinished = false;
  _quadsTraversed = 0;

  // Lap line is checkpoint 0 (quad index 0)
  _lapLineQuad = _checkpoints.length > 0 ? _checkpoints[0].quadIndex : 0;

  // Require at least 60% of the main loop to be traversed before a lap counts
  const mainLoopSize = _graph?.mainLoop ? _graph.mainLoop[1] : _driveline.length;
  _minQuadsForLap = Math.floor(mainLoopSize * 0.6);

  console.log(`Checkpoints: ${_checkpoints.length} checkpoints, ${_totalLaps} laps, ${_driveline.length} quads, min ${_minQuadsForLap} for lap`);
}

// ── Per-frame update ────────────────────────────────────────────────────────

/**
 * Call every frame with the kart's world position {x, y, z}.
 * Returns an object: { lapCompleted: bool, raceFinished: bool, currentLap, currentQuad }
 */
export function updateCheckpoints(kartPos) {
  if (!_driveline.length || _raceFinished) {
    return { lapCompleted: false, raceFinished: _raceFinished, currentLap: _currentLap, currentQuad: _currentQuadIndex };
  }

  // Find the nearest quad to the kart
  const nearestQuad = findNearestQuad(kartPos);

  // Track forward progress (detect direction via quad index delta)
  if (nearestQuad !== _currentQuadIndex) {
    _lastQuadIndex = _currentQuadIndex;
    _currentQuadIndex = nearestQuad;
    _quadsTraversed++;
  }

  // Mark checkpoints as passed when near them
  for (let i = 0; i < _checkpoints.length; i++) {
    const cp = _checkpoints[i];
    if (cp.isLapLine) continue; // Lap line handled separately
    const qi = cp.quadIndex;
    // Consider ±3 quads as "near"
    if (Math.abs(nearestQuad - qi) <= 3 || Math.abs(nearestQuad - qi) >= _driveline.length - 3) {
      _checkpointsPassed.add(i);
    }
  }

  // Check lap-line crossing
  let lapCompleted = false;
  const mainLoopSize = _graph?.mainLoop ? _graph.mainLoop[1] : _driveline.length;

  // Detect crossing quad 0 in the forward direction
  const nearLapLine = Math.abs(nearestQuad - _lapLineQuad) <= 3
    || Math.abs(nearestQuad - _lapLineQuad) >= mainLoopSize - 3;

  if (nearLapLine && _quadsTraversed >= _minQuadsForLap) {
    _currentLap++;
    _quadsTraversed = 0;
    _checkpointsPassed.clear();
    lapCompleted = true;

    console.log(`Lap ${_currentLap}/${_totalLaps} completed!`);

    if (_currentLap >= _totalLaps) {
      _raceFinished = true;
      console.log('Race finished!');
    }
  }

  return {
    lapCompleted,
    raceFinished: _raceFinished,
    currentLap: _currentLap,
    totalLaps: _totalLaps,
    currentQuad: _currentQuadIndex,
    checkpointsPassed: _checkpointsPassed.size,
    totalCheckpoints: _checkpoints.length - 1, // exclude lap line
  };
}

// ── Accessors ───────────────────────────────────────────────────────────────

export function getCurrentLap() { return _currentLap; }
export function getTotalLaps() { return _totalLaps; }
export function isRaceFinished() { return _raceFinished; }
export function getCurrentQuadIndex() { return _currentQuadIndex; }

/** Get the center position of the current nearest quad (for respawn). */
export function getCurrentQuadCenter() {
  if (_currentQuadIndex < _driveline.length) {
    return _driveline[_currentQuadIndex].center;
  }
  return _driveline.length > 0 ? _driveline[0].center : [0, 0, 0];
}

/** Get the heading at the current quad (direction toward next quad). */
export function getCurrentQuadHeading() {
  const idx = _currentQuadIndex;
  const next = (idx + 1) % _driveline.length;
  if (idx < _driveline.length && next < _driveline.length) {
    const c = _driveline[idx].center;
    const n = _driveline[next].center;
    return Math.atan2(n[0] - c[0], n[2] - c[2]);
  }
  return 0;
}

/**
 * Race progress as a fraction [0, 1] across all laps.
 * Useful for position ranking.
 */
export function getRaceProgress() {
  if (_totalLaps <= 0) return 0;
  const mainLoopSize = _graph?.mainLoop ? _graph.mainLoop[1] : _driveline.length;
  const lapFraction = mainLoopSize > 0 ? _currentQuadIndex / mainLoopSize : 0;
  return (_currentLap + Math.min(lapFraction, 0.999)) / _totalLaps;
}

// ── Internals ───────────────────────────────────────────────────────────────

/**
 * Find the nearest driveline quad index to a world position.
 * Uses a sliding-window search around the last known quad for performance.
 */
function findNearestQuad(pos) {
  const n = _driveline.length;
  if (n === 0) return 0;

  let bestDist = Infinity;
  let bestIdx = _currentQuadIndex;

  // Search ±30 quads around current position (handles normal driving speed)
  const searchRange = 30;
  for (let offset = -searchRange; offset <= searchRange; offset++) {
    const idx = ((_currentQuadIndex + offset) % n + n) % n;
    const c = _driveline[idx].center;
    const dx = pos.x - c[0];
    const dz = pos.z - c[2];
    const dist = dx * dx + dz * dz; // 2D distance (ignore Y for track curve tolerance)
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = idx;
    }
  }

  return bestIdx;
}
