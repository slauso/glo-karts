/**
 * track-data.js — In-memory track model + (de)serialization.
 *
 * A track is just an ordered list of placements:
 *   { key, gx, gz, rot }   (rot in 0/1/2/3 → 0/90/180/270 degrees)
 *
 * Serialized to compact JSON, then base64url-encoded for URL sharing.
 */

import { TILE as TILE_M, SEGMENTS, getFootprint } from './segments.js';
import { WORLD_UNITS_PER_M } from './units.js';

// Re-export TILE in WORLD units so any consumer (playtest, tests) gets the
// same value used by the rendering / physics pipeline.
const TILE = TILE_M * WORLD_UNITS_PER_M;

let _nextId = 1;

export class Track {
  constructor() {
    this.name = 'Untitled Track';
    /** @type {Map<number, {id:number, key:string, gx:number, gz:number, rot:number}>} */
    this.placements = new Map();
    /** @type {Map<string, number>}  cellKey → placementId  (footprint occupancy) */
    this.cells = new Map();
  }

  cellKey(gx, gz) { return `${gx},${gz}`; }

  /** Compute world cell coords occupied by a placement (after rotation). */
  occupiedCells(key, gx, gz, rot) {
    const cells = getFootprint(key);
    return cells.map(([fx, fz]) => {
      // rotate footprint offset around (0,0)
      const r = ((rot % 4) + 4) % 4;
      let ox = fx, oz = fz;
      for (let i = 0; i < r; i++) {
        const nx = oz; const nz = -ox;
        ox = nx; oz = nz;
      }
      return [gx + ox, gz + oz];
    });
  }

  /**
   * Spawn (and any future overlay segments) sits on top of road pieces.
   * It does not claim grid cells, so it is never blocked by — and does not
   * block — other placements.
   */
  isOverlay(key) {
    return !!SEGMENTS[key]?.isSpawn;
  }

  isClear(key, gx, gz, rot, ignoreId = null) {
    if (this.isOverlay(key)) return true;
    for (const [cx, cz] of this.occupiedCells(key, gx, gz, rot)) {
      const occ = this.cells.get(this.cellKey(cx, cz));
      if (occ != null && occ !== ignoreId) return false;
    }
    return true;
  }

  place(key, gx, gz, rot) {
    if (!SEGMENTS[key]) return null;
    const overlay = this.isOverlay(key);
    if (!overlay && !this.isClear(key, gx, gz, rot)) return null;
    // Single-spawn rule: dropping a new spawn replaces the previous one.
    if (SEGMENTS[key]?.isSpawn) {
      for (const existing of Array.from(this.placements.values())) {
        if (SEGMENTS[existing.key]?.isSpawn) this.remove(existing.id);
      }
    }
    const id = _nextId++;
    const placement = { id, key, gx, gz, rot: ((rot % 4) + 4) % 4 };
    this.placements.set(id, placement);
    if (!overlay) {
      for (const [cx, cz] of this.occupiedCells(key, gx, gz, rot)) {
        this.cells.set(this.cellKey(cx, cz), id);
      }
    }
    return placement;
  }

  remove(id) {
    const p = this.placements.get(id);
    if (!p) return false;
    if (!this.isOverlay(p.key)) {
      for (const [cx, cz] of this.occupiedCells(p.key, p.gx, p.gz, p.rot)) {
        // Defensive: only clear the cell if it still belongs to this id.
        if (this.cells.get(this.cellKey(cx, cz)) === id) {
          this.cells.delete(this.cellKey(cx, cz));
        }
      }
    }
    this.placements.delete(id);
    return true;
  }

  getById(id) { return this.placements.get(id) || null; }

  getAt(gx, gz) {
    const id = this.cells.get(this.cellKey(gx, gz));
    return id != null ? this.placements.get(id) : null;
  }

  all() { return Array.from(this.placements.values()); }

  clear() {
    this.placements.clear();
    this.cells.clear();
  }

  bounds() {
    if (this.placements.size === 0) return null;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of this.placements.values()) {
      for (const [cx, cz] of this.occupiedCells(p.key, p.gx, p.gz, p.rot)) {
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cz < minZ) minZ = cz;
        if (cz > maxZ) maxZ = cz;
      }
    }
    return { minX, maxX, minZ, maxZ };
  }

  spawn() {
    for (const p of this.placements.values()) {
      if (SEGMENTS[p.key]?.isSpawn) return p;
    }
    // fallback to first placement
    return this.placements.values().next().value || null;
  }

  toJSON() {
    return {
      v: 1,
      name: this.name,
      placements: Array.from(this.placements.values()).map(p => ({
        k: p.key, x: p.gx, z: p.gz, r: p.rot,
      })),
    };
  }

  static fromJSON(json) {
    const t = new Track();
    if (!json) return t;
    t.name = json.name || 'Untitled Track';
    const list = Array.isArray(json.placements) ? json.placements : [];
    for (const item of list) {
      t.place(item.k, item.x | 0, item.z | 0, item.r | 0);
    }
    return t;
  }
}

// ── share-code encoding (URL-safe base64) ────────────────────────

function utf8ToBytes(str) { return new TextEncoder().encode(str); }
function bytesToUtf8(bytes) { return new TextDecoder().decode(bytes); }

function bytesToBase64Url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const std = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(std);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeTrack(track) {
  const json = JSON.stringify(track.toJSON());
  return bytesToBase64Url(utf8ToBytes(json));
}

export function decodeTrack(code) {
  try {
    const json = bytesToUtf8(base64UrlToBytes(code));
    return Track.fromJSON(JSON.parse(json));
  } catch (err) {
    console.error('[track-data] decode failed', err);
    return null;
  }
}

export { TILE };
