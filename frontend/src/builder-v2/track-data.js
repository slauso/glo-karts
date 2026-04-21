/**
 * track-data.js — Auto-tile engine for TinkerTracks.
 *
 * Ported from mrdoob/Starter-Kit-Racing Track.js with adaptations for
 * TinkerTracks' grid system (GRID_SIZE=10, more piece types).
 *
 * Uses 4-bit neighbor bitmask (N=8 S=4 E=2 W=1) for auto-tiling.
 * Resolves cells into piece type + rotation, cascading to neighbors.
 */
import { GRID_SIZE } from '../modules/track-placement.js';

/* ── Constants ───────────────────────────────────────────────── */

export const CELL_SIZE = GRID_SIZE; // world-space cell dimension

/** Bitmask directions */
export const N = 8;
export const S = 4;
export const E = 2;
export const W = 1;

/** Direction offsets in grid units */
const DIR_OFFSET = {
  [N]: { dx: 0, dz: -CELL_SIZE },
  [S]: { dx: 0, dz: +CELL_SIZE },
  [E]: { dx: +CELL_SIZE, dz: 0 },
  [W]: { dx: -CELL_SIZE, dz: 0 },
};

/** Opposite bitmask direction */
const OPPOSITE = { [N]: S, [S]: N, [E]: W, [W]: E };

/* ── Auto-tile lookup ────────────────────────────────────────── *
 * Maps a 4-bit neighbor bitmask → [pieceType, rotationDeg].
 *
 * The 16 entries cover every combination of N/S/E/W neighbors.
 * For 3 or 4 neighbors, pickBestPair reduces to 2 before lookup.
 */
const AUTOTILE = {
  0b0000: ['skr-straight', 0],    // isolated → straight pad
  0b1000: ['skr-straight', 0],    // N only
  0b0100: ['skr-straight', 0],    // S only
  0b0010: ['skr-straight',90],    // E only
  0b0001: ['skr-straight',90],    // W only
  0b1100: ['skr-straight', 0],    // N+S
  0b0011: ['skr-straight',90],    // E+W
  0b0101: ['skr-corner',   0],    // S+W
  0b0110: ['skr-corner',  90],    // S+E
  0b1010: ['skr-corner', 180],    // N+E
  0b1001: ['skr-corner', 270],    // N+W
  0b1110: ['skr-straight', 0],    // N+S+E → T (fallback to straight)
  0b1101: ['skr-straight', 0],    // N+S+W → T
  0b1011: ['skr-straight',90],    // N+E+W → T
  0b0111: ['skr-straight',90],    // S+E+W → T
  0b1111: ['skr-straight', 0],    // all 4 → crossroads
};

/* ── Cell data structure ─────────────────────────────────────── *
 * TRACK_CELLS holds the authoritative grid state for road painting.
 * Key: "gx:gz" string
 * Value: { gx, gz, type, rotation }
 */
export const TRACK_CELLS = new Map();

export function cellKey(gx, gz) {
  return `${gx}:${gz}`;
}

/* ── Neighbor queries ────────────────────────────────────────── */

/** 4-bit presence mask: which NSEW neighbors have any cell. */
export function getPresenceMask(gx, gz) {
  let mask = 0;
  if (TRACK_CELLS.has(cellKey(gx, gz - CELL_SIZE))) mask |= N;
  if (TRACK_CELLS.has(cellKey(gx, gz + CELL_SIZE))) mask |= S;
  if (TRACK_CELLS.has(cellKey(gx + CELL_SIZE, gz))) mask |= E;
  if (TRACK_CELLS.has(cellKey(gx - CELL_SIZE, gz))) mask |= W;
  return mask;
}

/** Which exits does a cell have, given its type and rotation? */
export function getCellExits(cell) {
  if (!cell) return 0;
  const entry = AUTOTILE_EXITS[cell.type];
  if (!entry) return 0b1111; // wide/unknown opens all

  const base = entry.exits;
  const steps = Math.round(((cell.rotation % 360) + 360) % 360 / 90);
  return rotateMask(base, steps);
}

/** Exit definition per piece type at rotation 0. */
const AUTOTILE_EXITS = {
  // SKR core pieces (base orientation matches SKR models)
  'skr-straight':  { exits: N | S },
  'skr-corner':    { exits: S | W },   // SKR corner at 0° connects South and West
  'skr-finish':    { exits: N | S },
  'skr-bump':      { exits: N | S | E | W },

  // Custom pieces (original orientation preserved)
  'straight':     { exits: N | S },
  'corner-small': { exits: N | E },
  'corner-large': { exits: N | E },
  'curve':        { exits: N | E },
  'bump-up':      { exits: N | S },
  'bump-down':    { exits: N | S },
  'wide':         { exits: N | S | E | W },
  'cap-front':    { exits: S },
  'cap-back':     { exits: N },
  'end':          { exits: S },
  'bend':         { exits: N | S },
  'bend-large':   { exits: N | S },
  'hill-beginning':    { exits: N | S },
  'hill-end':          { exits: N | S },
  'hill-complete':     { exits: N | S },
  'hill-complete-half':{ exits: N | S },
  'skew-left':         { exits: N | S },
  'skew-right':        { exits: N | S },
  'skew-left-side':    { exits: N | S },
  'skew-right-side':   { exits: N | S },
  'corner-small-ramp': { exits: N | E },
  'corner-large-ramp': { exits: N | E },
};

/** Rotate a 4-bit NSEW mask clockwise by `steps` × 90°. */
function rotateMask(mask, steps) {
  // bits: N(3) S(2) E(1) W(0) → clockwise: N→E, E→S, S→W, W→N
  for (let i = 0; i < (steps % 4); i++) {
    const n = (mask >> 3) & 1;
    const s = (mask >> 2) & 1;
    const e = (mask >> 1) & 1;
    const w = mask & 1;
    mask = (e << 3) | (w << 2) | (s << 1) | n; // N←E, S←W, E←S, W←N
  }
  return mask;
}

/** Which neighbors have an exit facing toward cell (gx,gz)? */
export function getConnectivityMask(gx, gz) {
  let mask = 0;
  for (const [bit, { dx, dz }] of Object.entries(DIR_OFFSET)) {
    const nb = TRACK_CELLS.get(cellKey(gx + dx, gz + dz));
    if (nb) {
      const nbExits = getCellExits(nb);
      if (nbExits & OPPOSITE[bit]) mask |= Number(bit);
    }
  }
  return mask;
}

/** Neighbors that either connect to us or could accept a connection. */
export function getAvailableMask(gx, gz) {
  return getPresenceMask(gx, gz); // simplified: any neighbor is available
}

/* ── Tile resolution ─────────────────────────────────────────── */

function bitCount(mask) {
  let n = 0;
  while (mask) { n += mask & 1; mask >>= 1; }
  return n;
}

/**
 * When 3+ neighbors exist, pick the best 2 to connect to.
 * Prefers corners over straights, breaks ties by connectivity count.
 */
export function pickBestPair(mask, gx, gz) {
  const bits = [];
  if (mask & N) bits.push(N);
  if (mask & S) bits.push(S);
  if (mask & E) bits.push(E);
  if (mask & W) bits.push(W);

  if (bits.length <= 2) return mask;

  // Score each pair: prefer corner pairs, then by neighbor connection count
  let bestPair = bits[0] | bits[1];
  let bestScore = -Infinity;

  for (let i = 0; i < bits.length; i++) {
    for (let j = i + 1; j < bits.length; j++) {
      const pair = bits[i] | bits[j];
      let score = 0;
      // Prefer corners (not straight pairs)
      const isStr = (pair === (N | S)) || (pair === (E | W));
      if (!isStr) score += 10;
      // Prefer neighbors that already have exits facing us
      for (const b of [bits[i], bits[j]]) {
        const { dx, dz } = DIR_OFFSET[b];
        const nb = TRACK_CELLS.get(cellKey(gx + dx, gz + dz));
        if (nb && (getCellExits(nb) & OPPOSITE[b])) score += 5;
      }
      if (score > bestScore) {
        bestScore = score;
        bestPair = pair;
      }
    }
  }
  return bestPair;
}

/** Resolve a tile type + rotation for a cell, given its neighbor mask. */
function resolveFromMask(mask) {
  const entry = AUTOTILE[mask];
  if (entry) return { type: entry[0], rotation: entry[1] };
  return { type: 'wide', rotation: 0 };
}

/** Auto-tile for a newly placed cell. */
export function resolveNewTile(gx, gz) {
  let mask = getPresenceMask(gx, gz);
  if (bitCount(mask) > 2) {
    mask = pickBestPair(mask, gx, gz);
  }
  return resolveFromMask(mask);
}

/** Re-resolve an existing cell, trying to preserve current connection pattern. */
export function resolveTile(gx, gz) {
  const cell = TRACK_CELLS.get(cellKey(gx, gz));
  if (!cell) return null;

  let mask = getPresenceMask(gx, gz);
  if (bitCount(mask) > 2) {
    // Try to preserve existing exit directions
    const currentExits = getCellExits(cell);
    const preferred = mask & currentExits;
    if (bitCount(preferred) === 2) {
      mask = preferred;
    } else {
      mask = pickBestPair(mask, gx, gz);
    }
  }
  return resolveFromMask(mask);
}

/** Resolve cell + all 4 neighbors (cascade after paint/erase). */
export function resolveCellAndNeighbors(gx, gz) {
  const changes = [];

  // Resolve self
  const selfResult = TRACK_CELLS.has(cellKey(gx, gz))
    ? resolveTile(gx, gz)
    : null;

  if (selfResult) {
    const key = cellKey(gx, gz);
    const cell = TRACK_CELLS.get(key);
    if (cell.type !== selfResult.type || cell.rotation !== selfResult.rotation) {
      cell.type = selfResult.type;
      cell.rotation = selfResult.rotation;
      changes.push({ gx, gz, ...selfResult });
    }
  }

  // Resolve each neighbor
  for (const { dx, dz } of Object.values(DIR_OFFSET)) {
    const ngx = gx + dx;
    const ngz = gz + dz;
    const nkey = cellKey(ngx, ngz);
    const ncell = TRACK_CELLS.get(nkey);
    if (!ncell) continue;

    const result = resolveTile(ngx, ngz);
    if (result && (ncell.type !== result.type || ncell.rotation !== result.rotation)) {
      ncell.type = result.type;
      ncell.rotation = result.rotation;
      changes.push({ gx: ngx, gz: ngz, ...result });
    }
  }

  return changes;
}

/* ── CRUD operations ─────────────────────────────────────────── */

export function addCell(gx, gz) {
  const key = cellKey(gx, gz);
  if (TRACK_CELLS.has(key)) return null;

  const resolved = resolveNewTile(gx, gz);
  TRACK_CELLS.set(key, { gx, gz, type: resolved.type, rotation: resolved.rotation });

  // Cascade resolve to neighbors
  return resolveCellAndNeighbors(gx, gz);
}

export function removeCell(gx, gz) {
  const key = cellKey(gx, gz);
  if (!TRACK_CELLS.has(key)) return [];

  TRACK_CELLS.delete(key);

  // Re-resolve neighbors that lost a connection
  const changes = [];
  for (const { dx, dz } of Object.values(DIR_OFFSET)) {
    const ngx = gx + dx;
    const ngz = gz + dz;
    const nkey = cellKey(ngx, ngz);
    const ncell = TRACK_CELLS.get(nkey);
    if (!ncell) continue;

    const result = resolveTile(ngx, ngz);
    if (result && (ncell.type !== result.type || ncell.rotation !== result.rotation)) {
      ncell.type = result.type;
      ncell.rotation = result.rotation;
      changes.push({ gx: ngx, gz: ngz, ...result });
    }
  }
  return changes;
}

export function clearAllCells() {
  TRACK_CELLS.clear();
}

/* ── Ghost preview support ───────────────────────────────────── */

/**
 * Temporarily inserts a ghost cell, resolves self+neighbors,
 * returns the preview state, then removes the ghost.
 */
export function getGhostPreview(gx, gz) {
  const key = cellKey(gx, gz);
  if (TRACK_CELLS.has(key)) return null; // already occupied

  // Snapshot neighbor state
  const snapshots = new Map();
  for (const { dx, dz } of Object.values(DIR_OFFSET)) {
    const nk = cellKey(gx + dx, gz + dz);
    const nc = TRACK_CELLS.get(nk);
    if (nc) snapshots.set(nk, { ...nc });
  }

  // Temporarily add cell
  const resolved = resolveNewTile(gx, gz);
  TRACK_CELLS.set(key, { gx, gz, type: resolved.type, rotation: resolved.rotation });
  const changes = resolveCellAndNeighbors(gx, gz);
  const ghostCell = { ...TRACK_CELLS.get(key) };

  // Undo: remove ghost and restore neighbors
  TRACK_CELLS.delete(key);
  for (const [nk, snap] of snapshots) {
    const cell = TRACK_CELLS.get(nk);
    if (cell) {
      cell.type = snap.type;
      cell.rotation = snap.rotation;
    }
  }

  return {
    self: ghostCell,
    neighborChanges: changes.filter(c => !(c.gx === gx && c.gz === gz)),
  };
}

/* ── Serialization ───────────────────────────────────────────── */

/** Compact base64url encoding: 3 bytes per cell. */
export function encodeCells() {
  const cells = Array.from(TRACK_CELLS.values());
  if (cells.length === 0) return '';

  const bytes = new Uint8Array(cells.length * 3);
  cells.forEach((cell, i) => {
    bytes[i * 3] = Math.round(cell.gx / CELL_SIZE) + 128;
    bytes[i * 3 + 1] = Math.round(cell.gz / CELL_SIZE) + 128;
    // Pack type index (0-15) in high nibble, rotation index (0-3) in low nibble
    const typeIdx = TYPE_TO_INDEX[cell.type] ?? 0;
    const rotIdx = Math.round(((cell.rotation % 360) + 360) % 360 / 90) & 3;
    bytes[i * 3 + 2] = (typeIdx << 4) | rotIdx;
  });

  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function decodeCells(encoded) {
  if (!encoded) return [];

  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const cells = [];
  for (let i = 0; i + 2 < bytes.length; i += 3) {
    const gridX = (bytes[i] - 128) * CELL_SIZE;
    const gridZ = (bytes[i + 1] - 128) * CELL_SIZE;
    const packed = bytes[i + 2];
    const typeIdx = (packed >> 4) & 0xF;
    const rotIdx = packed & 0x3;
    cells.push({
      gx: gridX,
      gz: gridZ,
      type: INDEX_TO_TYPE[typeIdx] || 'straight',
      rotation: rotIdx * 90,
    });
  }
  return cells;
}

/** Piece type ↔ index maps for serialization. */
const PIECE_TYPES = [
  'straight', 'corner-small', 'corner-large', 'curve', 'wide',
  'bump-up', 'bump-down', 'cap-front', 'cap-back', 'end',
  'bend', 'bend-large', 'hill-beginning', 'hill-end',
  'hill-complete', 'hill-complete-half',
];

const TYPE_TO_INDEX = Object.fromEntries(PIECE_TYPES.map((t, i) => [t, i]));
const INDEX_TO_TYPE = Object.fromEntries(PIECE_TYPES.map((t, i) => [i, t]));

/* ── Bulk import (for loading saved tracks) ──────────────────── */

export function importCells(cellArray) {
  clearAllCells();
  for (const c of cellArray) {
    const gx = c.gx ?? c.position?.x ?? 0;
    const gz = c.gz ?? c.position?.z ?? 0;
    TRACK_CELLS.set(cellKey(gx, gz), {
      gx,
      gz,
      type: c.type || 'straight',
      rotation: c.rotation || 0,
    });
  }
  // Re-resolve all cells
  for (const cell of TRACK_CELLS.values()) {
    const result = resolveTile(cell.gx, cell.gz);
    if (result) {
      cell.type = result.type;
      cell.rotation = result.rotation;
    }
  }
}

/** Export all cells as a plain array. */
export function exportCells() {
  return Array.from(TRACK_CELLS.values()).map(c => ({
    gx: c.gx,
    gz: c.gz,
    type: c.type,
    rotation: c.rotation,
  }));
}

/* ── Wall collider data generation ───────────────────────────── */

const WALL_HALF_WIDTH = CELL_SIZE * 0.475;
const WALL_HEIGHT = 1.4;
const WALL_THICKNESS = 0.3;

/**
 * Generate wall collider descriptors from cell data.
 * Walls only appear on outer edges — never between connected segments.
 *
 * Returns array of { position: {x,y,z}, size: {x,y,z}, rotation: number }
 */
export function generateWallColliders() {
  const walls = [];

  for (const cell of TRACK_CELLS.values()) {
    const exits = getCellExits(cell);
    const cx = cell.gx;
    const cz = cell.gz;

    // For each direction, if this cell has NO exit there, add a wall
    if (!(exits & N)) {
      walls.push({
        position: { x: cx, y: WALL_HEIGHT / 2, z: cz - CELL_SIZE / 2 },
        size: { x: CELL_SIZE, y: WALL_HEIGHT, z: WALL_THICKNESS },
        rotation: 0,
      });
    }
    if (!(exits & S)) {
      walls.push({
        position: { x: cx, y: WALL_HEIGHT / 2, z: cz + CELL_SIZE / 2 },
        size: { x: CELL_SIZE, y: WALL_HEIGHT, z: WALL_THICKNESS },
        rotation: 0,
      });
    }
    if (!(exits & E)) {
      walls.push({
        position: { x: cx + CELL_SIZE / 2, y: WALL_HEIGHT / 2, z: cz },
        size: { x: WALL_THICKNESS, y: WALL_HEIGHT, z: CELL_SIZE },
        rotation: 0,
      });
    }
    if (!(exits & W)) {
      walls.push({
        position: { x: cx - CELL_SIZE / 2, y: WALL_HEIGHT / 2, z: cz },
        size: { x: WALL_THICKNESS, y: WALL_HEIGHT, z: CELL_SIZE },
        rotation: 0,
      });
    }

    // For exit edges: only add wall if neighbor doesn't exist (edge of track)
    if ((exits & N) && !TRACK_CELLS.has(cellKey(cx, cz - CELL_SIZE))) {
      // Side walls for the road edge
      walls.push({
        position: { x: cx - WALL_HALF_WIDTH, y: WALL_HEIGHT / 2, z: cz - CELL_SIZE / 4 },
        size: { x: WALL_THICKNESS, y: WALL_HEIGHT, z: CELL_SIZE / 2 },
        rotation: 0,
      });
      walls.push({
        position: { x: cx + WALL_HALF_WIDTH, y: WALL_HEIGHT / 2, z: cz - CELL_SIZE / 4 },
        size: { x: WALL_THICKNESS, y: WALL_HEIGHT, z: CELL_SIZE / 2 },
        rotation: 0,
      });
    }
    if ((exits & S) && !TRACK_CELLS.has(cellKey(cx, cz + CELL_SIZE))) {
      walls.push({
        position: { x: cx - WALL_HALF_WIDTH, y: WALL_HEIGHT / 2, z: cz + CELL_SIZE / 4 },
        size: { x: WALL_THICKNESS, y: WALL_HEIGHT, z: CELL_SIZE / 2 },
        rotation: 0,
      });
      walls.push({
        position: { x: cx + WALL_HALF_WIDTH, y: WALL_HEIGHT / 2, z: cz + CELL_SIZE / 4 },
        size: { x: WALL_THICKNESS, y: WALL_HEIGHT, z: CELL_SIZE / 2 },
        rotation: 0,
      });
    }
    if ((exits & E) && !TRACK_CELLS.has(cellKey(cx + CELL_SIZE, cz))) {
      walls.push({
        position: { x: cx + CELL_SIZE / 4, y: WALL_HEIGHT / 2, z: cz - WALL_HALF_WIDTH },
        size: { x: CELL_SIZE / 2, y: WALL_HEIGHT, z: WALL_THICKNESS },
        rotation: 0,
      });
      walls.push({
        position: { x: cx + CELL_SIZE / 4, y: WALL_HEIGHT / 2, z: cz + WALL_HALF_WIDTH },
        size: { x: CELL_SIZE / 2, y: WALL_HEIGHT, z: WALL_THICKNESS },
        rotation: 0,
      });
    }
    if ((exits & W) && !TRACK_CELLS.has(cellKey(cx - CELL_SIZE, cz))) {
      walls.push({
        position: { x: cx - CELL_SIZE / 4, y: WALL_HEIGHT / 2, z: cz - WALL_HALF_WIDTH },
        size: { x: CELL_SIZE / 2, y: WALL_HEIGHT, z: WALL_THICKNESS },
        rotation: 0,
      });
      walls.push({
        position: { x: cx - CELL_SIZE / 4, y: WALL_HEIGHT / 2, z: cz + WALL_HALF_WIDTH },
        size: { x: CELL_SIZE / 2, y: WALL_HEIGHT, z: WALL_THICKNESS },
        rotation: 0,
      });
    }
  }

  return walls;
}

/* ── Preset track templates ──────────────────────────────────── */

export const PRESET_TRACKS = {
  oval: 'hICCAYKCAoKBAgGBggIBgYMC',
  figure8: 'hICCAYKCAoKBAgGBggIBgYMCgoMCgYQCgoQC',
  tutorial: 'hICCAYKCAoKBAgGBggI',
};
