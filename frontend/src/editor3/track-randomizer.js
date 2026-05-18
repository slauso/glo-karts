/**
 * track-randomizer.js — Procedural closed-loop track generator v5.
 *
 * Builds fully-connected closed-loop circuits using all available segment
 * types. Segments are chained connector-to-connector so every joint is
 * physically valid. Multiple layout templates (rectangle, S-curve, hairpin,
 * stadium, L-shape) are selected at random, each with legs filled by rich
 * mixes of road, elevation, and feature segments.
 *
 * Connector convention (mirrors segments.js):
 *   SIDE_CW  = ['N','W','S','E']   — CW quarter-turn order
 *   N = +Z,  S = -Z,  E = +X,  W = -X
 *   rotateSide('S', rot) → SIDE_CW[(2 + rot) % 4]
 *   rotateCell(fx, fz, rot): per quarter-turn (fx,fz) → (−fz, fx)
 */

import { SEGMENTS, getConnectors } from './segments.js';

// ── Inline geometry helpers ───────────────────────────────────────

const SIDE_CW    = ['N', 'W', 'S', 'E'];
const OPP_SIDE   = { N: 'S', S: 'N', E: 'W', W: 'E' };
const SIDE_DELTA = { N: [0, 1], S: [0, -1], E: [1, 0], W: [-1, 0] };

function _nr(r)  { return ((r % 4) + 4) % 4; }

function rotateSide(side, rot) {
  const i = SIDE_CW.indexOf(side);
  return i < 0 ? side : SIDE_CW[(i + _nr(rot)) % 4];
}

function rotateCell(fx, fz, rot) {
  let ox = fx, oz = fz;
  for (let i = 0, r = _nr(rot); i < r; i++) { const nx = -oz; oz = ox; ox = nx; }
  return [ox, oz];
}

/**
 * The rotation that makes a segment's local-S entrance face `req` in world.
 * rotateSide('S', rot) = req  →  SIDE_CW[(2+rot)%4] = req  →  rot = (idx(req)−2+4)%4
 */
function rotForEntrance(req) {
  return _nr(SIDE_CW.indexOf(req) - 2 + 4);
}

/** All world-frame cells occupied by a placed segment. */
function worldFootprint(key, gx, gz, rot) {
  const span = SEGMENTS[key]?.span ?? { x: 1, z: 1 };
  const out = [];
  for (let fx = 0; fx < span.x; fx++) {
    for (let fz = 0; fz < span.z; fz++) {
      const [rx, rz] = rotateCell(fx, fz, rot);
      out.push([gx + rx, gz + rz]);
    }
  }
  return out;
}

/** Local exit connector {x,z,side} — CONNECTORS puts entrance first, exit second. */
function localExit(key) {
  const c = getConnectors(key);
  return c[1] ?? c[0];
}

// ── PRNG ──────────────────────────────────────────────────────────

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng, lo, hi) { return lo + Math.floor(rng() * (hi - lo + 1)); }
function randChoice(rng, arr)  { return arr[Math.floor(rng() * arr.length)]; }

function weightedPick(rng, table) {
  const entries = Object.entries(table);
  let roll = rng() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of entries) { roll -= w; if (roll < 0) return k; }
  return entries[0][0];
}

// ── Track name pool ───────────────────────────────────────────────

const TRACK_NAMES = [
  'Circuit Alpha',   'Grand Loop',      'Thunder Oval',    'Desert Rally',
  'Night Drift',     'Comet Circuit',   'Storm Loop',      'Velocity Park',
  'Apex Arena',      'Turbo Circuit',   'Galaxy Run',      'Blaze Track',
  'Neon Raceway',    'Iron Loop',       'Fusion Circuit',  'Rocket Ring',
  'Cosmic Circuit',  'Phantom Pass',    'Velocity Ridge',  'Turbo Springs',
  'Echo Valley',     'Nexus Loop',      'Aurora Track',    'Zenith Circuit',
  'Inferno Trail',   'Sonic Speedway',  'Vortex Valley',   'Prism Circuit',
];

// ── Segment knowledge ─────────────────────────────────────────────
//
// All segments that can fill a straight-through leg slot.
// They all share: local entrance = (0,0) S,  local exit = (0, last_z) N.
// Cell costs = number of grid cells they consume along the travel axis.

// 1-cell straight-through picks with weights
const FILL_1 = {
  straight:  5,
  bump_up:   3,
  jump_ramp: 2,
};

// 2-cell straight-through (span z=2): hill_complete is up-and-over — net zero elevation change.
// ramp_up / ramp_down are handled explicitly in the plateau-run sequence, NOT here.
const FILL_2 = {
  hill_complete: 4,
};

// 6-cell bridge ramp sequences: onramp OR offramp
// Each consumes 6 cells. We treat them as atomic "feature" chains.
const BRIDGE_RAMP_LEN = 6; // matches BRIDGE_RAMP_CELLS in segments.js

// curved_plateau is a 1-cell piece that turns (like corner/cornerR),
// so it goes in the TURN pool, not the fill pool.

// ── Chain builder helper ──────────────────────────────────────────

/**
 * Creates a stateful chain for placing segments along a connected path.
 * Returns { place(key), cx, cz, req, placements, used }.
 */
function makeChain(startX, startZ, startReq, initPlacements, initUsed) {
  const placements = initPlacements;
  const used = initUsed;
  let cx = startX, cz = startZ, req = startReq;

  function mark(cells) { for (const [x, z] of cells) used.add(`${x},${z}`); }
  function free(key, gx, gz, rot) {
    return !worldFootprint(key, gx, gz, rot).some(([x, z]) => used.has(`${x},${z}`));
  }

  function place(key) {
    const rot = rotForEntrance(req);
    // For segments whose entrance is NOT at local (0,0), offset the origin.
    // banked_turn entrance is at local (1,0) — subtract its rotated offset.
    const rawConns = getConnectors(key);
    const ent = rawConns[0]; // entrance connector
    const [entRx, entRz] = rotateCell(ent.x, ent.z, rot);
    const pgx = cx - entRx;
    const pgz = cz - entRz;
    if (!free(key, pgx, pgz, rot)) return false;
    placements.push({ key, gx: pgx, gz: pgz, rot });
    mark(worldFootprint(key, pgx, pgz, rot));
    const ex = rawConns[1] ?? rawConns[0];
    const [rx, rz] = rotateCell(ex.x, ex.z, rot);
    const es = rotateSide(ex.side, rot);
    const [dx, dz] = SIDE_DELTA[es];
    cx  = pgx + rx + dx;
    cz  = pgz + rz + dz;
    req = OPP_SIDE[es];
    return true;
  }

  // Place regardless (forced — used for corners where we trust the layout math)
  function placeForced(key) {
    const rot = rotForEntrance(req);
    const rawConns = getConnectors(key);
    const ent = rawConns[0];
    const [entRx, entRz] = rotateCell(ent.x, ent.z, rot);
    const pgx = cx - entRx;
    const pgz = cz - entRz;
    placements.push({ key, gx: pgx, gz: pgz, rot });
    mark(worldFootprint(key, pgx, pgz, rot));
    const ex = rawConns[1] ?? rawConns[0];
    const [rx, rz] = rotateCell(ex.x, ex.z, rot);
    const es = rotateSide(ex.side, rot);
    const [dx, dz] = SIDE_DELTA[es];
    cx  = pgx + rx + dx;
    cz  = pgz + rz + dz;
    req = OPP_SIDE[es];
  }

  return {
    get cx()  { return cx;  },
    get cz()  { return cz;  },
    get req() { return req; },
    place, placeForced,
  };
}

// ── Leg filler ────────────────────────────────────────────────────
//
// Fills exactly `cells` worth of straight-through segments, drawing
// from the full palette of interesting pieces.

/**
 * @param {object} chain  — chain object from makeChain
 * @param {function} rng
 * @param {number} cells  — number of 1-cell-equivalent slots to fill
 * @param {boolean} allowFeatures — whether to allow bridge ramp sequences
 */
function fillLeg(chain, rng, cells, allowFeatures = true) {
  let rem = cells;

  // ── Feature sequences (large, dramatic, high-cost) ────────────
  // Plateau run: ramp_up + 1-3 plateaus + ramp_down = 4-6 cells
  // Bridge run:  bridge_onramp(6) + bridge(2) + bridge_offramp(6) = 14 cells
  // We only attempt these when the leg is long enough.

  if (allowFeatures && rem >= 5 && rng() < 0.35) {
    // Plateau run: ramp_up + N plateaus + ramp_down
    const plateauCount = rem >= 6 ? randInt(rng, 1, 3) : 1;
    const cost = 4 + plateauCount; // ramp_up(2) + plateauCount(1 each) + ramp_down(2)
    if (rem >= cost) {
      if (chain.place('ramp_up')) {
        for (let p = 0; p < plateauCount; p++) {
          chain.placeForced('plateau');
        }
        chain.placeForced('ramp_down');
        rem -= cost;
      }
    }
  }

  if (allowFeatures && rem >= 14 && rng() < 0.25) {
    // Bridge sequence — place all pieces unconditionally (forced) if onramp fits
    if (chain.place('bridge_onramp')) {
      chain.placeForced('bridge');
      chain.placeForced('bridge');
      chain.placeForced('bridge_offramp');
      rem -= (BRIDGE_RAMP_LEN * 2 + 2 * 2); // 6 + 6 + 2 + 2 = 16
    }
  }

  // ── Standard mixed fill ────────────────────────────────────────
  while (rem > 0) {
    // Try a 2-cell piece ~35 % of the time when space allows
    if (rem >= 2 && rng() < 0.35) {
      const key = weightedPick(rng, FILL_2);
      if (chain.place(key)) { rem -= 2; continue; }
    }
    // 1-cell pick
    const key = weightedPick(rng, FILL_1);
    if (!chain.place(key)) chain.placeForced('straight');
    rem -= 1;
  }
}

// ── Layout templates ──────────────────────────────────────────────
//
// All layouts use exactly 4 left turns (corner or banked_turn) which
// guarantees a 360° closed loop. Shape variety comes from different
// leg length ratios and corner types.
//
// Closure invariant:
//   Start at (0,1) req='S' (one cell N of spawn at (0,0)).
//   After 4 L-turns and legs [A, B, C, D]:
//     legs go: A cells N, B cells W, C cells S, D cells E → finish at (0,-1) req='S'
//   For this to hold: C = A + 2  (the +2 bridges spawn row 0 and finish row -1)
//                     B = D  (symmetric widths)

/**
 * Classic rectangle — equal-width legs.
 */
function layoutRect(rng) {
  const h = randInt(rng, 3, 7);
  const w = randInt(rng, 3, 6);
  return { legs: [h, w, h + 2, w], corners: ['corner', 'corner', 'corner', 'corner'] };
}

/**
 * Oval — long main straights, short connector legs.
 */
function layoutOval(rng) {
  const h = randInt(rng, 5, 9);
  const w = randInt(rng, 2, 3);
  return { legs: [h, w, h + 2, w], corners: ['corner', 'corner', 'corner', 'corner'] };
}

/**
 * Hairpin — short wide legs (lots of features per leg).
 */
function layoutHairpin(rng) {
  const h = randInt(rng, 2, 4);
  const w = randInt(rng, 5, 8);
  return { legs: [h, w, h + 2, w], corners: ['corner', 'corner', 'corner', 'corner'] };
}

/**
 * Asymmetric — different N/S vs E/W balance.
 */
function layoutAsymmetric(rng) {
  const h = randInt(rng, 3, 6);
  const w = randInt(rng, 4, 7);
  return { legs: [h, w, h + 2, w], corners: ['corner', 'corner', 'corner', 'corner'] };
}

/**
 * Banked oval — uses banked_turn (2×2 bowl) on all four corners.
 * banked_turn has entrance at local (1,0)S — handled by the entrance-offset logic in place().
 */
function layoutBanked(rng) {
  const h = randInt(rng, 3, 6);
  const w = randInt(rng, 3, 5);
  return { legs: [h, w, h + 2, w], corners: ['banked_turn', 'banked_turn', 'banked_turn', 'banked_turn'] };
}

/**
 * Mixed corners — banked turns on N and S ends, sharp on E and W.
 */
function layoutMixed(rng) {
  const h = randInt(rng, 3, 6);
  const w = randInt(rng, 3, 5);
  return { legs: [h, w, h + 2, w], corners: ['banked_turn', 'corner', 'banked_turn', 'corner'] };
}

// ── Main builder ──────────────────────────────────────────────────

function buildTrack(rng) {
  const placements = [];
  const used       = new Set();

  // Fixed spawn
  placements.push({ key: 'spawn', gx: 0, gz: 0, rot: 0 });
  used.add('0,0');

  // Pick a layout template at random
  const templates = [layoutRect, layoutOval, layoutHairpin, layoutAsymmetric, layoutBanked, layoutMixed];
  const tmpl = randChoice(rng, templates)(rng);

  // Build chain starting one cell north of spawn, entering from South
  const chain = makeChain(0, 1, 'S', placements, used);

  const { legs, corners } = tmpl;

  for (let i = 0; i < 4; i++) {
    const legLen = legs[i];
    fillLeg(chain, rng, legLen, true);
    chain.placeForced(corners[i]);
  }

  // Finish — the chain's chain state is now (0,−1) req='S' by layout math
  placements.push({ key: 'finish', gx: chain.cx, gz: chain.cz, rot: rotForEntrance(chain.req) });

  return placements;
}

// ── Public export ─────────────────────────────────────────────────

/**
 * Generate a random valid closed-loop track.
 * Returns { track: { name, placements: [{k,x,z,r}] }, decor: [] }
 * as expected by loadFromJSON() in editor-main.js.
 */
export function generateRandomTrack() {
  const rng  = mulberry32(Date.now() >>> 0);
  const name = randChoice(rng, TRACK_NAMES);
  const raw  = buildTrack(rng);

  return {
    track: {
      name,
      placements: raw.map(p => ({ k: p.key, x: p.gx, z: p.gz, r: p.rot })),
    },
    decor: [],
  };
}
