/**
 * grid-placement.js — Unified grid with auto-connect for track pieces.
 *
 * Each track piece has connection PORTS on its cell edges (N/E/S/W).
 * When a piece is placed the system finds the rotation that best
 * connects to existing neighbors.  Shared occupancy prevents
 * road-paint cells and manual segments from overlapping.
 *
 * Multi-layer support: pieces exist on layers (0 = ground, 1 = bridge).
 * Ground track can be placed under bridge decks because they occupy
 * different layers.  Bridge ramps block BOTH layers.
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

// ── Layered cell key ──────────────────────────────────────────
function layeredKey(gx, gz, layer) { return `${gx},${gz},${layer}`; }

// ── Piece port definitions (at rotation 0°) ──────────────────
// ports: which edges of the cell have road (as DIR indices).
// When a piece is rotated r×90° each port index becomes (p+r)%4.
//
// layer: 0 = ground, 1 = bridge  (default 0)
// layers: array override when a piece blocks multiple layers (e.g. ramps)
// portLayers: per-port layer  [port0Layer, port1Layer, ...]
//             omit when all ports share the piece's layer

export const PIECE_DEFS = {
  // ── SKR core tiles (auto-tiled) ──
  'skr-straight':      { ports: [DIR.N, DIR.S], category: 'basic' },
  'skr-corner':        { ports: [DIR.S, DIR.W], category: 'corner' },

  // ── SKR base tiles (manual) ──
  'skr-finish':        { ports: [DIR.N, DIR.S], category: 'basic' },
  'skr-bump':          { ports: [DIR.N, DIR.S], category: 'basic' },

  // ── Stretched straights (multi-cell) ──
  'straight-2x':       { ports: [DIR.N, DIR.S], category: 'basic', span: { x: 1, z: 2 } },
  'straight-3x':       { ports: [DIR.N, DIR.S], category: 'basic', span: { x: 1, z: 3 } },
  'straight-4x':       { ports: [DIR.N, DIR.S], category: 'basic', span: { x: 1, z: 4 } },

  // ── Elevation warps (single-cell) ──
  'ramp-up':           { ports: [DIR.N, DIR.S], category: 'hill' },
  'ramp-down':         { ports: [DIR.N, DIR.S], category: 'hill' },
  'jump-ramp':         { ports: [DIR.N, DIR.S], category: 'hill' },
  'landing-ramp':      { ports: [DIR.N, DIR.S], category: 'hill' },
  'hill':              { ports: [DIR.N, DIR.S], category: 'hill' },
  'dip':               { ports: [DIR.N, DIR.S], category: 'hill' },

  // ── Lateral warps (single-cell) ──
  's-curve':           { ports: [DIR.N, DIR.S], category: 'bend' },
  'bank-left':         { ports: [DIR.N, DIR.S], category: 'bend' },
  'bank-right':        { ports: [DIR.N, DIR.S], category: 'bend' },

  // ── Multi-cell curve warps ──
  'gentle-s':          { ports: [DIR.N, DIR.S], category: 'bend', span: { x: 1, z: 3 } },

  // ── Junctions (multi-port) ──
  'crossover':         { ports: [DIR.N, DIR.E, DIR.S, DIR.W], category: 'basic' },
  't-junction':        { ports: [DIR.N, DIR.E, DIR.S], category: 'basic' },

  // ── Bridge segments (layer 1 — ground track can pass underneath) ──
  'bridge-ramp-up':    { ports: [DIR.N, DIR.S], category: 'bridge', span: { x: 1, z: 2 },
                         layers: [0, 1], portLayers: [0, 1] },
  'bridge-ramp-down':  { ports: [DIR.N, DIR.S], category: 'bridge', span: { x: 1, z: 2 },
                         layers: [0, 1], portLayers: [1, 0] },
  'bridge-1x':         { ports: [DIR.N, DIR.S], category: 'bridge', layer: 1 },
  'bridge-2x':         { ports: [DIR.N, DIR.S], category: 'bridge', layer: 1, span: { x: 1, z: 2 } },
  'bridge-3x':         { ports: [DIR.N, DIR.S], category: 'bridge', layer: 1, span: { x: 1, z: 3 } },
  'bridge-4x':         { ports: [DIR.N, DIR.S], category: 'bridge', layer: 1, span: { x: 1, z: 4 } },

  // ── Pittsburgh-themed bridges (elevated deck, layer 1) ──
  'pgh-clemente':      { ports: [DIR.N, DIR.S], category: 'pgh-bridge', layer: 1, span: { x: 1, z: 2 } },
  'pgh-warhol':        { ports: [DIR.N, DIR.S], category: 'pgh-bridge', layer: 1, span: { x: 1, z: 2 } },
  'pgh-carson':        { ports: [DIR.N, DIR.S], category: 'pgh-bridge', layer: 1, span: { x: 1, z: 2 } },
  'pgh-fort-pitt':     { ports: [DIR.N, DIR.S], category: 'pgh-bridge', layer: 1, span: { x: 1, z: 3 } },
  'pgh-fort-duquesne': { ports: [DIR.N, DIR.S], category: 'pgh-bridge', layer: 1, span: { x: 1, z: 3 } },
  'pgh-west-end':      { ports: [DIR.N, DIR.S], category: 'pgh-bridge', layer: 1, span: { x: 1, z: 2 } },
  'pgh-veterans':      { ports: [DIR.N, DIR.S], category: 'pgh-bridge', layer: 1, span: { x: 1, z: 4 } },
  'pgh-16th-st':       { ports: [DIR.N, DIR.S], category: 'pgh-bridge', layer: 1, span: { x: 1, z: 4 } },
  'pgh-south-10th':    { ports: [DIR.N, DIR.S], category: 'pgh-bridge', layer: 1, span: { x: 1, z: 3 } },
  'pgh-31st-st':       { ports: [DIR.N, DIR.S], category: 'pgh-bridge', layer: 1, span: { x: 1, z: 4 } },
  'pgh-mckees-rocks':  { ports: [DIR.N, DIR.S], category: 'pgh-bridge', layer: 1, span: { x: 1, z: 5 } },
  'pgh-smithfield':    { ports: [DIR.N, DIR.S], category: 'pgh-bridge', layer: 1, span: { x: 1, z: 3 } },
  'pgh-liberty':       { ports: [DIR.N, DIR.S], category: 'pgh-bridge', layer: 1, span: { x: 1, z: 6 } },
  'pgh-62nd-st':       { ports: [DIR.N, DIR.S], category: 'pgh-bridge', layer: 1 },
  'pgh-birmingham':    { ports: [DIR.N, DIR.S], category: 'pgh-bridge', layer: 1, span: { x: 1, z: 5 } },
  'pgh-40th-st':       { ports: [DIR.N, DIR.S], category: 'pgh-bridge', layer: 1, span: { x: 1, z: 4 } },
  'pgh-hot-metal':     { ports: [DIR.N, DIR.S], category: 'pgh-bridge', layer: 1, span: { x: 1, z: 4 } },
  'pgh-glenwood':      { ports: [DIR.N, DIR.S], category: 'pgh-bridge', layer: 1, span: { x: 1, z: 3 } },
  'pgh-highland-park': { ports: [DIR.N, DIR.S], category: 'pgh-bridge', layer: 1, span: { x: 1, z: 3 } },
  'pgh-homestead':     { ports: [DIR.N, DIR.S], category: 'pgh-bridge', layer: 1, span: { x: 1, z: 3 } },

  // ── SKR decorations ──
  'skr-deco-empty':    { ports: [], category: 'decoration' },
  'skr-deco-forest':   { ports: [], category: 'decoration' },
  'skr-deco-tents':    { ports: [], category: 'decoration' },
  'skr-track-tents':   { ports: [], category: 'decoration' },
};

/** Display categories in sidebar order. */
export const CATEGORIES = [
  { id: 'basic',      label: 'Road Basics',       icon: '━' },
  { id: 'corner',     label: 'Corners & Curves',   icon: '╭' },
  { id: 'hill',       label: 'Hills & Ramps',      icon: '⟋' },
  { id: 'bend',       label: 'Bends & Offsets',    icon: '↝' },
  { id: 'bridge',     label: 'Bridges',             icon: '⌇' },
  { id: 'pgh-bridge', label: 'Pittsburgh Bridges',   icon: '🌉' },
  { id: 'decoration', label: 'Scenery',             icon: '🌲' },
];

// ── Layer helpers ─────────────────────────────────────────────

/** Get the layer(s) a piece occupies. */
export function getPieceLayers(pieceKey) {
  const def = PIECE_DEFS[pieceKey];
  if (!def) return [0];
  if (def.layers) return def.layers;
  return [def.layer ?? 0];
}

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

// ── Multi-cell footprint helpers ──────────────────────────────

/**
 * Get all grid cells occupied by a piece at anchor (gx, gz) with given rotation.
 * The anchor is the first cell; additional cells extend in the piece's local +Z
 * direction, which rotates with the piece.
 */
export function getFootprintCells(pieceKey, gx, gz, rotDeg) {
  const def = PIECE_DEFS[pieceKey];
  if (!def) return [[gx, gz]];
  const span = def.span || { x: 1, z: 1 };
  if (span.z <= 1 && span.x <= 1) return [[gx, gz]];

  const steps = Math.round(((rotDeg % 360) + 360) % 360 / 90);
  // At rotation 0, local +Z → world +Z → S direction
  const spanDir = (DIR.S + steps) % 4;
  const dx = DIR_DX[spanDir] * GRID_SIZE;
  const dz = DIR_DZ[spanDir] * GRID_SIZE;

  const cells = [];
  for (let i = 0; i < span.z; i++) {
    cells.push([gx + dx * i, gz + dz * i]);
  }
  return cells;
}

/**
 * For multi-cell pieces, determine which cell each port actually exits from.
 * Returns [{dir, cx, cz, layer}] for each port.
 */
function getPortCells(pieceKey, gx, gz, rotDeg) {
  const def = PIECE_DEFS[pieceKey];
  if (!def) return [];
  const ports = getPortsAtRotation(pieceKey, rotDeg);
  const span = def.span || { x: 1, z: 1 };
  const defaultLayer = def.layer ?? 0;
  const portLayers = def.portLayers;

  if (span.z <= 1) {
    return ports.map((dir, idx) => ({
      dir, cx: gx, cz: gz,
      layer: portLayers ? portLayers[idx] : defaultLayer,
    }));
  }

  const cells = getFootprintCells(pieceKey, gx, gz, rotDeg);
  const steps = Math.round(((rotDeg % 360) + 360) % 360 / 90);
  const spanDir = (DIR.S + steps) % 4;

  return ports.map((dir, idx) => {
    let cx = gx, cz = gz;
    if (dir === spanDir) {
      const last = cells[cells.length - 1];
      cx = last[0]; cz = last[1];
    }
    return {
      dir, cx, cz,
      layer: portLayers ? portLayers[idx] : defaultLayer,
    };
  });
}

// ── GridState — shared occupancy map (multi-layer) ────────────

export class GridState {
  constructor() {
    /**
     * Keyed by layeredKey(gx, gz, layer).
     * @type {Map<string, {
     *   pieceKey: string,
     *   rotation: number,
     *   source: 'entity'|'road',
     *   entityId?: number,
     *   anchor: {x:number, z:number},
     *   layer: number
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

  isOccupied(gx, gz, layer = null) {
    if (layer !== null) return this.cells.has(layeredKey(gx, gz, layer));
    return this.cells.has(layeredKey(gx, gz, 0)) || this.cells.has(layeredKey(gx, gz, 1));
  }

  get(gx, gz, layer = null) {
    if (layer !== null) return this.cells.get(layeredKey(gx, gz, layer)) || null;
    return this.cells.get(layeredKey(gx, gz, 0))
        || this.cells.get(layeredKey(gx, gz, 1))
        || null;
  }

  /**
   * Register a piece at anchor (gx, gz).
   * For multi-cell pieces, all footprint cells × all layers are marked.
   */
  set(gx, gz, pieceKey, rotation, source = 'entity', entityId = 0) {
    const cells = getFootprintCells(pieceKey, gx, gz, rotation);
    const layers = getPieceLayers(pieceKey);
    const anchor = { x: gx, z: gz };
    for (const [cx, cz] of cells) {
      for (const layer of layers) {
        this.cells.set(layeredKey(cx, cz, layer), {
          pieceKey, rotation, source, entityId, anchor, layer,
        });
      }
    }
  }

  /**
   * Remove the piece at (gx, gz).
   * Pass pieceKey for precision when ground + bridge coexist at same XZ.
   * For multi-cell pieces, finds the anchor and removes ALL footprint cells.
   */
  remove(gx, gz, pieceKey = null) {
    const searchLayers = pieceKey ? getPieceLayers(pieceKey) : [0, 1];
    for (const layer of searchLayers) {
      const cell = this.cells.get(layeredKey(gx, gz, layer));
      if (!cell) continue;
      const ax = cell.anchor ? cell.anchor.x : gx;
      const az = cell.anchor ? cell.anchor.z : gz;
      const footprint = getFootprintCells(cell.pieceKey, ax, az, cell.rotation);
      const removeLayers = getPieceLayers(cell.pieceKey);
      for (const [cx, cz] of footprint) {
        for (const l of removeLayers) {
          this.cells.delete(layeredKey(cx, cz, l));
        }
      }
      return;
    }
  }

  /**
   * Check whether placing `pieceKey` at anchor (gx, gz) with `rotDeg` is free.
   * Only checks the layers that the piece actually occupies.
   */
  isFootprintClear(pieceKey, gx, gz, rotDeg, excludeEntityId = null) {
    const cells = getFootprintCells(pieceKey, gx, gz, rotDeg);
    const layers = getPieceLayers(pieceKey);
    for (const [cx, cz] of cells) {
      for (const layer of layers) {
        const occ = this.cells.get(layeredKey(cx, cz, layer));
        if (occ) {
          if (excludeEntityId !== null && occ.entityId === excludeEntityId) continue;
          return false;
        }
      }
    }
    return true;
  }

  clearBySource(source) {
    for (const [key, cell] of this.cells) {
      if (cell.source === source) this.cells.delete(key);
    }
  }

  clear() { this.cells.clear(); this.hideIndicators(); }

  // ── auto-connect (layer-aware) ──────────────────────────────

  /**
   * Return the rotation (0/90/180/270) for `pieceKey` at grid (gx,gz)
   * that **maximises** port connections to existing neighbors.
   * Checks full footprint clearance and evaluates ports at their
   * correct exit cells and layers.
   */
  findBestRotation(pieceKey, gx, gz) {
    const def = PIECE_DEFS[pieceKey];
    if (!def) return 0;

    let bestRot = 0;
    let bestScore = -Infinity;

    for (let steps = 0; steps < 4; steps++) {
      const rotDeg = steps * 90;

      // Skip rotations where the footprint is blocked
      if (!this.isFootprintClear(pieceKey, gx, gz, rotDeg)) continue;

      const portCells = getPortCells(pieceKey, gx, gz, rotDeg);
      let score = 0;

      for (const { dir, cx, cz, layer: portLayer } of portCells) {
        const nx = cx + DIR_DX[dir] * GRID_SIZE;
        const nz = cz + DIR_DZ[dir] * GRID_SIZE;
        const neighbor = this.get(nx, nz, portLayer);
        if (neighbor) {
          const opp = oppositeDir(dir);
          const nAnchorX = neighbor.anchor?.x ?? nx;
          const nAnchorZ = neighbor.anchor?.z ?? nz;
          const nPorts = getPortCells(neighbor.pieceKey, nAnchorX, nAnchorZ, neighbor.rotation);
          const match = nPorts.some(p =>
            p.dir === opp && p.layer === portLayer && p.cx === nx && p.cz === nz
          );
          score += match ? 2 : -1;
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
   * Layer-aware: only checks neighbors on the same layer as each port.
   */
  getConnections(gx, gz, pieceKey, rotDeg) {
    const portCells = getPortCells(pieceKey, gx, gz, rotDeg);
    const out = [];

    for (const { dir, cx, cz, layer: portLayer } of portCells) {
      const nx = cx + DIR_DX[dir] * GRID_SIZE;
      const nz = cz + DIR_DZ[dir] * GRID_SIZE;
      const neighbor = this.get(nx, nz, portLayer);

      if (!neighbor) {
        out.push({ dir, status: 'open', cx, cz, layer: portLayer });
      } else {
        const opp = oppositeDir(dir);
        const nAnchorX = neighbor.anchor?.x ?? nx;
        const nAnchorZ = neighbor.anchor?.z ?? nz;
        const nPorts = getPortCells(neighbor.pieceKey, nAnchorX, nAnchorZ, neighbor.rotation);
        const match = nPorts.some(p =>
          p.dir === opp && p.layer === portLayer && p.cx === nx && p.cz === nz
        );
        out.push({ dir, status: match ? 'connected' : 'blocked', cx, cz, layer: portLayer });
      }
    }
    return out;
  }

  // ── visual indicators ───────────────────────────────────────

  /** Show colored dots on the cell edges of the preview. */
  showIndicators(gx, gz, connections) {
    this.hideIndicators();

    for (const conn of connections) {
      const pcx = conn.cx ?? gx;
      const pcz = conn.cz ?? gz;
      const ox = DIR_DX[conn.dir] * (GRID_SIZE / 2);
      const oz = DIR_DZ[conn.dir] * (GRID_SIZE / 2);
      // Raise indicators for bridge-layer ports
      const dotY = 1.5 + (conn.layer || 0) * 5.0;
      const color = conn.status === 'connected' ? 0x44ff88
                  : conn.status === 'open'      ? 0xffaa22
                  : 0xff4444;

      const dot = this._getDot();
      dot.material.color.setHex(color);
      dot.position.set(pcx + ox, dotY, pcz + oz);
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
