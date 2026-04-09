/**
 * grid-placement.js — Unified grid with auto-connect for track pieces.
 *
 * Each track piece has connection PORTS on its cell edges (N/E/S/W).
 * When a piece is placed the system finds the rotation that best
 * connects to existing neighbors.  Shared occupancy prevents
 * road-paint cells and manual segments from overlapping.
 */
import * as THREE from 'three';
import { GRID_SIZE, snapToGrid, cellKey } from '../modules/track-placement.js';

// ── Direction helpers ─────────────────────────────────────────
export const DIR = Object.freeze({ N: 0, E: 1, S: 2, W: 3 });

/** Grid-unit offset per direction. */
const DIR_DX = [0, 1, 0, -1];
const DIR_DZ = [-1, 0, 1, 0];

/** Opposite direction: N↔S, E↔W. */
export function oppositeDir(d) { return (d + 2) % 4; }

// ── Piece port definitions (at rotation 0°) ──────────────────
// ports: which edges of the cell have road (as DIR indices).
// When a piece is rotated r×90° each port index becomes (p+r)%4.

export const PIECE_DEFS = {
  // ── Basics (flat, common) ──
  'straight':          { ports: [DIR.N, DIR.S], category: 'basic' },
  'wide':              { ports: [DIR.N, DIR.E, DIR.S, DIR.W], category: 'basic' },

  // ── Corners & curves ──
  'corner-small':      { ports: [DIR.N, DIR.E], category: 'corner' },
  'corner-large':      { ports: [DIR.N, DIR.E], category: 'corner' },
  'curve':             { ports: [DIR.N, DIR.E], category: 'corner' },

  // ── Hills & ramps ──
  'bump-up':           { ports: [DIR.N, DIR.S], category: 'hill' },
  'bump-down':         { ports: [DIR.N, DIR.S], category: 'hill' },
  'hill-beginning':    { ports: [DIR.N, DIR.S], category: 'hill' },
  'hill-end':          { ports: [DIR.N, DIR.S], category: 'hill' },
  'hill-complete':     { ports: [DIR.N, DIR.S], category: 'hill' },
  'hill-complete-half':{ ports: [DIR.N, DIR.S], category: 'hill' },
  'corner-small-ramp': { ports: [DIR.N, DIR.E], category: 'hill' },
  'corner-large-ramp': { ports: [DIR.N, DIR.E], category: 'hill' },

  // ── Bends & skews ──
  'bend':              { ports: [DIR.N, DIR.S], category: 'bend' },
  'bend-large':        { ports: [DIR.N, DIR.S], category: 'bend' },
  'skew-left':         { ports: [DIR.N, DIR.S], category: 'bend' },
  'skew-right':        { ports: [DIR.N, DIR.S], category: 'bend' },
  'skew-left-side':    { ports: [DIR.N, DIR.S], category: 'bend' },
  'skew-right-side':   { ports: [DIR.N, DIR.S], category: 'bend' },

  // ── End caps ──
  'cap-front':         { ports: [DIR.S], category: 'cap' },
  'cap-back':          { ports: [DIR.N], category: 'cap' },
  'end':               { ports: [DIR.S], category: 'cap' },
};

/** Display categories in sidebar order. */
export const CATEGORIES = [
  { id: 'basic',  label: 'Road Basics',      icon: '━' },
  { id: 'corner', label: 'Corners & Curves',  icon: '╭' },
  { id: 'hill',   label: 'Hills & Ramps',     icon: '⟋' },
  { id: 'bend',   label: 'Bends & Offsets',   icon: '↝' },
  { id: 'cap',    label: 'End Pieces',         icon: '⊣' },
];

// ── Port rotation helpers ─────────────────────────────────────

/**
 * Get open port directions at a given rotation.
 * @param {string} pieceKey
 * @param {number} rotDeg  0 | 90 | 180 | 270
 * @returns {number[]} direction indices
 */
export function getPortsAtRotation(pieceKey, rotDeg) {
  const def = PIECE_DEFS[pieceKey];
  if (!def) return [];
  const steps = Math.round(((rotDeg % 360) + 360) % 360 / 90);
  return def.ports.map(d => (d + steps) % 4);
}

/** Does a piece at `rotDeg` have a port facing `dir`? */
export function hasPort(pieceKey, rotDeg, dir) {
  return getPortsAtRotation(pieceKey, rotDeg).includes(dir);
}

// ── GridState — shared occupancy map ──────────────────────────

export class GridState {
  constructor() {
    /**
     * @type {Map<string, {
     *   pieceKey: string,
     *   rotation: number,
     *   source: 'entity'|'road',
     *   entityId?: number
     * }>}
     */
    this.cells = new Map();

    // Visual indicators shown during placement preview
    this._indicatorGroup = new THREE.Group();
    this._indicatorGroup.name = '__connIndicators';
    this._dots = [];          // mesh refs for current preview dots
    this._dotPool = [];       // recycled sphere meshes
  }

  /** Add indicatorGroup to the scene once at startup. */
  get indicatorGroup() { return this._indicatorGroup; }

  // ── cell CRUD ───────────────────────────────────────────────

  isOccupied(gx, gz) { return this.cells.has(cellKey(gx, gz)); }

  get(gx, gz) { return this.cells.get(cellKey(gx, gz)) || null; }

  set(gx, gz, pieceKey, rotation, source = 'entity', entityId = 0) {
    this.cells.set(cellKey(gx, gz), { pieceKey, rotation, source, entityId });
  }

  remove(gx, gz) { this.cells.delete(cellKey(gx, gz)); }

  clearBySource(source) {
    for (const [key, cell] of this.cells) {
      if (cell.source === source) this.cells.delete(key);
    }
  }

  clear() { this.cells.clear(); this.hideIndicators(); }

  // ── auto-connect ────────────────────────────────────────────

  /**
   * Return the rotation (0/90/180/270) for `pieceKey` at grid (gx,gz)
   * that **maximises** port connections to existing neighbors.
   */
  findBestRotation(pieceKey, gx, gz) {
    const def = PIECE_DEFS[pieceKey];
    if (!def) return 0;

    let bestRot = 0;
    let bestScore = -Infinity;

    for (let steps = 0; steps < 4; steps++) {
      const rotDeg = steps * 90;
      const ports = getPortsAtRotation(pieceKey, rotDeg);
      let score = 0;

      for (const dir of ports) {
        const nx = gx + DIR_DX[dir] * GRID_SIZE;
        const nz = gz + DIR_DZ[dir] * GRID_SIZE;
        const neighbor = this.get(nx, nz);
        if (neighbor) {
          const opp = oppositeDir(dir);
          if (hasPort(neighbor.pieceKey, neighbor.rotation, opp)) {
            score += 2;  // mutual connection
          } else {
            score -= 1;  // neighbor present but ports don't match
          }
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestRot = rotDeg;
      }
    }

    return bestRot;
  }

  /**
   * Return connection status for every PORT of the given piece / rotation.
   * Status: 'connected' | 'open' | 'blocked'
   *   connected — neighbor has matching port
   *   open      — no neighbor on that side (can extend later)
   *   blocked   — neighbor exists but has no matching port
   */
  getConnections(gx, gz, pieceKey, rotDeg) {
    const ports = getPortsAtRotation(pieceKey, rotDeg);
    const out = [];

    for (const dir of ports) {
      const nx = gx + DIR_DX[dir] * GRID_SIZE;
      const nz = gz + DIR_DZ[dir] * GRID_SIZE;
      const neighbor = this.get(nx, nz);

      if (!neighbor) {
        out.push({ dir, status: 'open' });
      } else {
        const opp = oppositeDir(dir);
        const ok = hasPort(neighbor.pieceKey, neighbor.rotation, opp);
        out.push({ dir, status: ok ? 'connected' : 'blocked' });
      }
    }
    return out;
  }

  // ── visual indicators ───────────────────────────────────────

  /** Show colored dots on the cell edges of the preview. */
  showIndicators(gx, gz, connections) {
    this.hideIndicators();

    for (const conn of connections) {
      const ox = DIR_DX[conn.dir] * (GRID_SIZE / 2);
      const oz = DIR_DZ[conn.dir] * (GRID_SIZE / 2);
      const color = conn.status === 'connected' ? 0x44ff88
                  : conn.status === 'open'      ? 0xffaa22
                  : 0xff4444;

      const dot = this._getDot();
      dot.material.color.setHex(color);
      dot.position.set(gx + ox, 1.5, gz + oz);
      dot.visible = true;
      this._dots.push(dot);
    }
  }

  hideIndicators() {
    for (const d of this._dots) { d.visible = false; this._dotPool.push(d); }
    this._dots.length = 0;
  }

  _getDot() {
    if (this._dotPool.length > 0) return this._dotPool.pop();
    const geo = new THREE.SphereGeometry(0.6, 8, 6);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85 });
    const m = new THREE.Mesh(geo, mat);
    this._indicatorGroup.add(m);
    return m;
  }
}

// ── Ghost helpers ─────────────────────────────────────────────

/** Make every mesh in `obj` semi-transparent. */
export function makeGhostMaterial(obj, opacity = 0.45) {
  obj.traverse(child => {
    if (!child.isMesh) return;
    const materials = Array.isArray(child.material)
      ? child.material.map((material) => material.clone())
      : [child.material.clone()];

    child.material = Array.isArray(child.material) ? materials : materials[0];
    child.userData._ghostMaterialBackup = materials.map((material) => ({
      color: material.color?.clone?.() ?? null,
      emissive: material.emissive?.clone?.() ?? null,
      emissiveIntensity: material.emissiveIntensity ?? 0,
    }));

    materials.forEach((material) => {
      material.transparent = true;
      material.opacity = opacity;
      material.depthWrite = false;
    });
  });
}

/** Tint a ghost green (valid placement) or red (blocked). */
export function tintGhost(obj, valid) {
  const color = valid ? new THREE.Color(0.3, 1, 0.5) : new THREE.Color(1, 0.3, 0.3);
  obj.traverse(child => {
    if (!child.isMesh) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const backup = child.userData._ghostMaterialBackup || [];

    materials.forEach((material, index) => {
      const original = backup[index] || {};
      if (material.emissive?.isColor) {
        if (original.emissive) material.emissive.copy(original.emissive);
        material.emissive.lerp(color, 0.85);
        material.emissiveIntensity = 0.3;
      } else if (material.color?.isColor) {
        if (original.color) material.color.copy(original.color);
        material.color.lerp(color, 0.55);
      }
    });
  });
}
