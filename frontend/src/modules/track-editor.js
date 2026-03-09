/**
 * track-editor.js — Track Builder core module.
 *
 * Pure JS track editor engine: segment placement, validation,
 * serialization, and geometry generation for custom tracks.
 *
 * Replaces the planned stk-editor WASM port with a lightweight
 * native JS implementation that generates compatible TrackData.
 *
 * GPL v3 — derived from SuperTuxKart track editor concepts.
 */

// ── Segment type definitions ───────────────────────────────────
export const SEGMENT_TYPES = {
  straight:    { id: 'straight',    label: 'Straight',    icon: '━',  width: 10, length: 10, height: 0 },
  curve_left:  { id: 'curve_left',  label: 'Left Curve',  icon: '╭',  width: 10, length: 10, height: 0 },
  curve_right: { id: 'curve_right', label: 'Right Curve', icon: '╮',  width: 10, length: 10, height: 0 },
  ramp_up:     { id: 'ramp_up',     label: 'Ramp Up',     icon: '⟋',  width: 10, length: 10, height: 3 },
  ramp_down:   { id: 'ramp_down',   label: 'Ramp Down',   icon: '⟍',  width: 10, length: 10, height: -3 },
  flat_wide:   { id: 'flat_wide',   label: 'Arena Pad',   icon: '▣',  width: 20, length: 20, height: 0 },
};

export const OBSTACLE_TYPES = {
  barrier:   { id: 'barrier',   label: 'Barrier',   icon: '🧱' },
  boost_pad: { id: 'boost_pad', label: 'Boost Pad', icon: '⚡' },
  item_box:  { id: 'item_box',  label: 'Item Box',  icon: '❓' },
  banana:    { id: 'banana',    label: 'Banana',     icon: '🍌' },
};

// ── TrackData Schema ───────────────────────────────────────────
/** @typedef {{ x: number, y: number, z: number }} Vec3 */
/** @typedef {{ id: number, type: string, position: Vec3, rotation: number, scale: number }} Segment */
/** @typedef {{ position: Vec3, width: number }} Checkpoint */
/** @typedef {{ position: Vec3, heading: number }} StartPosition */
/** @typedef {{ type: string, position: Vec3 }} Obstacle */
/**
 * @typedef {Object} TrackData
 * @property {number} version
 * @property {string} name
 * @property {string} author
 * @property {Segment[]} segments
 * @property {Checkpoint[]} checkpoints
 * @property {StartPosition[]} startPositions
 * @property {Obstacle[]} obstacles
 * @property {{ min: Vec3, max: Vec3 }} bounds
 */

const GRID_SIZE = 10;
const TRACK_DATA_VERSION = 1;
const MAX_SEGMENTS = 200;
const MAX_OBSTACLES = 100;
const MAX_START_POSITIONS = 8;

// ── TrackEditor class ──────────────────────────────────────────
export class TrackEditor {
  constructor() {
    /** @type {Segment[]} */
    this.segments = [];
    /** @type {Checkpoint[]} */
    this.checkpoints = [];
    /** @type {StartPosition[]} */
    this.startPositions = [];
    /** @type {Obstacle[]} */
    this.obstacles = [];
    this.trackName = 'Untitled Track';
    this.trackAuthor = 'Anonymous';
    this._nextId = 1;
    /** @type {Array<{action: string, data: any}>} */
    this._undoStack = [];
    /** @type {Array<{action: string, data: any}>} */
    this._redoStack = [];
  }

  // ── Segment placement ──────────────────────────────────────
  /**
   * Place a track segment on the grid.
   * @param {string} type - Segment type from SEGMENT_TYPES
   * @param {number} x - Grid X
   * @param {number} y - Height
   * @param {number} z - Grid Z
   * @param {number} [rotation=0] - Rotation in degrees (0, 90, 180, 270)
   * @returns {Segment|null}
   */
  placeSegment(type, x, y, z, rotation = 0) {
    if (!SEGMENT_TYPES[type]) return null;
    if (this.segments.length >= MAX_SEGMENTS) return null;

    // Snap to grid
    const snappedX = Math.round(x / GRID_SIZE) * GRID_SIZE;
    const snappedZ = Math.round(z / GRID_SIZE) * GRID_SIZE;
    const snappedRot = Math.round(rotation / 90) * 90;

    // Check for overlapping segment at same grid position
    const overlap = this.segments.find(s =>
      Math.abs(s.position.x - snappedX) < 1 &&
      Math.abs(s.position.z - snappedZ) < 1
    );
    if (overlap) return null;

    const segment = {
      id: this._nextId++,
      type,
      position: { x: snappedX, y: y || 0, z: snappedZ },
      rotation: snappedRot,
      scale: 1,
    };

    this.segments.push(segment);
    this._pushUndo('placeSegment', segment);
    this._redoStack.length = 0;
    return segment;
  }

  /**
   * Remove a segment by ID.
   * @param {number} id
   * @returns {boolean}
   */
  removeSegment(id) {
    const idx = this.segments.findIndex(s => s.id === id);
    if (idx === -1) return false;
    const removed = this.segments.splice(idx, 1)[0];
    this._pushUndo('removeSegment', removed);
    this._redoStack.length = 0;
    return true;
  }

  // ── Obstacle placement ─────────────────────────────────────
  placeObstacle(type, x, y, z) {
    if (!OBSTACLE_TYPES[type]) return null;
    if (this.obstacles.length >= MAX_OBSTACLES) return null;

    const obstacle = {
      type,
      position: { x, y: y || 0, z },
    };
    this.obstacles.push(obstacle);
    this._pushUndo('placeObstacle', obstacle);
    this._redoStack.length = 0;
    return obstacle;
  }

  removeObstacle(index) {
    if (index < 0 || index >= this.obstacles.length) return false;
    const removed = this.obstacles.splice(index, 1)[0];
    this._pushUndo('removeObstacle', { index, data: removed });
    this._redoStack.length = 0;
    return true;
  }

  // ── Checkpoint placement ───────────────────────────────────
  /**
   * Auto-generate checkpoints along the center-line of placed segments.
   * Creates one checkpoint per segment at the segment center.
   */
  autoGenerateCheckpoints() {
    this.checkpoints = this.segments.map(seg => ({
      position: { ...seg.position },
      width: SEGMENT_TYPES[seg.type]?.width || 10,
    }));
  }

  // ── Start position placement ───────────────────────────────
  addStartPosition(x, y, z, heading = 0) {
    if (this.startPositions.length >= MAX_START_POSITIONS) return null;
    const sp = { position: { x, y: y || 0, z }, heading };
    this.startPositions.push(sp);
    this._pushUndo('addStartPosition', sp);
    this._redoStack.length = 0;
    return sp;
  }

  removeStartPosition(index) {
    if (index < 0 || index >= this.startPositions.length) return false;
    const removed = this.startPositions.splice(index, 1)[0];
    this._pushUndo('removeStartPosition', { index, data: removed });
    this._redoStack.length = 0;
    return true;
  }

  // ── Undo / Redo ────────────────────────────────────────────
  _pushUndo(action, data) {
    this._undoStack.push({ action, data: JSON.parse(JSON.stringify(data)) });
    if (this._undoStack.length > 50) this._undoStack.shift();
  }

  undo() {
    const entry = this._undoStack.pop();
    if (!entry) return false;

    switch (entry.action) {
      case 'placeSegment':
        this.segments = this.segments.filter(s => s.id !== entry.data.id);
        break;
      case 'removeSegment':
        this.segments.push(entry.data);
        break;
      case 'placeObstacle':
        this.obstacles.pop();
        break;
      case 'removeObstacle':
        this.obstacles.splice(entry.data.index, 0, entry.data.data);
        break;
      case 'addStartPosition':
        this.startPositions.pop();
        break;
      case 'removeStartPosition':
        this.startPositions.splice(entry.data.index, 0, entry.data.data);
        break;
    }

    this._redoStack.push(entry);
    return true;
  }

  redo() {
    const entry = this._redoStack.pop();
    if (!entry) return false;

    switch (entry.action) {
      case 'placeSegment':
        this.segments.push(entry.data);
        break;
      case 'removeSegment':
        this.segments = this.segments.filter(s => s.id !== entry.data.id);
        break;
      case 'placeObstacle':
        this.obstacles.push(entry.data);
        break;
      case 'removeObstacle':
        this.obstacles.splice(entry.data.index, 1);
        break;
      case 'addStartPosition':
        this.startPositions.push(entry.data);
        break;
      case 'removeStartPosition':
        this.startPositions.splice(entry.data.index, 1);
        break;
    }

    this._undoStack.push(entry);
    return true;
  }

  // ── Validation ─────────────────────────────────────────────
  /**
   * Validate the current track state.
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validateTrack() {
    const errors = [];

    if (this.segments.length < 3) {
      errors.push('Track must have at least 3 segments.');
    }

    if (this.startPositions.length < 1) {
      errors.push('Track must have at least 1 start position.');
    }

    // Check for disconnected segments (simple adjacency check)
    if (this.segments.length >= 2) {
      const connected = this._checkConnectivity();
      if (!connected) {
        errors.push('Track has disconnected segments. All segments must form a connected path.');
      }
    }

    // Check for overlapping colliders
    for (let i = 0; i < this.segments.length; i++) {
      for (let j = i + 1; j < this.segments.length; j++) {
        const a = this.segments[i];
        const b = this.segments[j];
        if (Math.abs(a.position.x - b.position.x) < 1 &&
            Math.abs(a.position.z - b.position.z) < 1) {
          errors.push(`Segments ${a.id} and ${b.id} overlap at (${a.position.x}, ${a.position.z}).`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  _checkConnectivity() {
    if (this.segments.length <= 1) return true;

    const visited = new Set();
    const queue = [this.segments[0]];
    visited.add(this.segments[0].id);

    while (queue.length > 0) {
      const current = queue.shift();
      for (const seg of this.segments) {
        if (visited.has(seg.id)) continue;
        const dx = Math.abs(current.position.x - seg.position.x);
        const dz = Math.abs(current.position.z - seg.position.z);
        // Adjacent if within one grid cell
        if ((dx <= GRID_SIZE + 1 && dz < 1) || (dz <= GRID_SIZE + 1 && dx < 1) ||
            (dx <= GRID_SIZE + 1 && dz <= GRID_SIZE + 1)) {
          visited.add(seg.id);
          queue.push(seg);
        }
      }
    }

    return visited.size === this.segments.length;
  }

  // ── Bounds calculation ─────────────────────────────────────
  _computeBounds() {
    if (this.segments.length === 0) {
      return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
    }

    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };

    for (const seg of this.segments) {
      const st = SEGMENT_TYPES[seg.type];
      const hw = (st?.width || 10) / 2;
      const hl = (st?.length || 10) / 2;

      min.x = Math.min(min.x, seg.position.x - hw);
      min.y = Math.min(min.y, seg.position.y);
      min.z = Math.min(min.z, seg.position.z - hl);
      max.x = Math.max(max.x, seg.position.x + hw);
      max.y = Math.max(max.y, seg.position.y + (st?.height || 0));
      max.z = Math.max(max.z, seg.position.z + hl);
    }

    return { min, max };
  }

  // ── Export / Import ────────────────────────────────────────
  /**
   * Export track to JSON TrackData.
   * @returns {string} JSON string
   */
  exportTrack() {
    this.autoGenerateCheckpoints();

    /** @type {TrackData} */
    const trackData = {
      version: TRACK_DATA_VERSION,
      name: this.trackName,
      author: this.trackAuthor,
      segments: this.segments.map(s => ({ ...s })),
      checkpoints: this.checkpoints.map(c => ({ position: { ...c.position }, width: c.width })),
      startPositions: this.startPositions.map(sp => ({ position: { ...sp.position }, heading: sp.heading })),
      obstacles: this.obstacles.map(o => ({ type: o.type, position: { ...o.position } })),
      bounds: this._computeBounds(),
    };

    return JSON.stringify(trackData);
  }

  /**
   * Import track from JSON string.
   * @param {string} json
   * @returns {boolean}
   */
  importTrack(json) {
    try {
      const data = JSON.parse(json);
      if (!data || data.version !== TRACK_DATA_VERSION) return false;

      this.trackName = String(data.name || 'Imported Track');
      this.trackAuthor = String(data.author || 'Unknown');
      this.segments = Array.isArray(data.segments) ? data.segments : [];
      this.checkpoints = Array.isArray(data.checkpoints) ? data.checkpoints : [];
      this.startPositions = Array.isArray(data.startPositions) ? data.startPositions : [];
      this.obstacles = Array.isArray(data.obstacles) ? data.obstacles : [];
      this._nextId = Math.max(0, ...this.segments.map(s => s.id || 0)) + 1;
      this._undoStack.length = 0;
      this._redoStack.length = 0;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get geometry data for 3D preview rendering.
   * Returns arrays of vertices and indices for each segment type.
   * @returns {Array<{ type: string, position: Vec3, rotation: number, vertices: Float32Array, indices: Uint16Array }>}
   */
  getPreviewGeometry() {
    return this.segments.map(seg => {
      const st = SEGMENT_TYPES[seg.type];
      const { vertices, indices } = generateSegmentGeometry(seg.type, st);
      return {
        type: seg.type,
        position: seg.position,
        rotation: seg.rotation,
        vertices,
        indices,
      };
    });
  }

  /** Clear all track data. */
  clear() {
    this.segments = [];
    this.checkpoints = [];
    this.startPositions = [];
    this.obstacles = [];
    this._nextId = 1;
    this._undoStack.length = 0;
    this._redoStack.length = 0;
  }
}

// ── Geometry generation ────────────────────────────────────────
/**
 * Generate simple box/ramp geometry for a segment type.
 * @param {string} type
 * @param {{ width: number, length: number, height: number }} segDef
 * @returns {{ vertices: Float32Array, indices: Uint16Array }}
 */
export function generateSegmentGeometry(type, segDef) {
  const w = (segDef?.width || 10) / 2;
  const l = (segDef?.length || 10) / 2;
  const h = segDef?.height || 0;

  // For straight/flat segments: a flat quad
  if (type === 'straight' || type === 'flat_wide') {
    const vertices = new Float32Array([
      -w, 0, -l,
       w, 0, -l,
       w, 0,  l,
      -w, 0,  l,
    ]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
    return { vertices, indices };
  }

  // Ramp up: front edge elevated
  if (type === 'ramp_up') {
    const vertices = new Float32Array([
      -w, 0, -l,
       w, 0, -l,
       w, h,  l,
      -w, h,  l,
    ]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
    return { vertices, indices };
  }

  // Ramp down: front edge lowered
  if (type === 'ramp_down') {
    const vertices = new Float32Array([
      -w, 0, -l,
       w, 0, -l,
       w, -Math.abs(h),  l,
      -w, -Math.abs(h),  l,
    ]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
    return { vertices, indices };
  }

  // Curves: approximate with 8-segment arc
  if (type === 'curve_left' || type === 'curve_right') {
    const steps = 8;
    const verts = [];
    const idxs = [];
    const dir = type === 'curve_left' ? 1 : -1;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const angle = (Math.PI / 2) * t * dir;
      const cx = Math.sin(angle) * l;
      const cz = Math.cos(angle) * l - l;

      // Inner and outer edge
      const nx = -Math.cos(angle) * dir;
      const nz = Math.sin(angle);
      verts.push(cx - nx * w, 0, cz - nz * w); // inner
      verts.push(cx + nx * w, 0, cz + nz * w); // outer
    }

    for (let i = 0; i < steps; i++) {
      const a = i * 2;
      idxs.push(a, a + 1, a + 3);
      idxs.push(a, a + 3, a + 2);
    }

    return {
      vertices: new Float32Array(verts),
      indices: new Uint16Array(idxs),
    };
  }

  // Fallback flat quad
  const vertices = new Float32Array([
    -w, 0, -l, w, 0, -l, w, 0, l, -w, 0, l,
  ]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  return { vertices, indices };
}

// ── Share code utilities ───────────────────────────────────────
/**
 * Compress TrackData JSON into a shareable code string.
 * Uses simple base64 encoding (pako compression can be added later).
 * @param {string} json - TrackData JSON string
 * @returns {string} Share code
 */
export function exportTrackCode(json) {
  try {
    // Validate it's valid JSON
    JSON.parse(json);
    return 'TK1:' + btoa(unescape(encodeURIComponent(json)));
  } catch {
    return '';
  }
}

/**
 * Decode a share code back into TrackData JSON.
 * @param {string} code - Share code string
 * @returns {string|null} JSON string or null if invalid
 */
export function importTrackCode(code) {
  try {
    if (!code || !code.startsWith('TK1:')) return null;
    const b64 = code.slice(4);
    const json = decodeURIComponent(escape(atob(b64)));
    // Validate structure
    const data = JSON.parse(json);
    if (!data || data.version !== TRACK_DATA_VERSION) return null;
    return json;
  } catch {
    return null;
  }
}

// ── localStorage persistence for imported tracks ───────────────
const CUSTOM_TRACKS_KEY = 'customTracks';

export function getSavedCustomTracks() {
  try {
    const raw = localStorage.getItem(CUSTOM_TRACKS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveCustomTrack(trackData) {
  const tracks = getSavedCustomTracks();
  // Avoid duplicates by name+author
  const existing = tracks.findIndex(t => t.name === trackData.name && t.author === trackData.author);
  if (existing >= 0) {
    tracks[existing] = trackData;
  } else {
    tracks.push(trackData);
  }
  localStorage.setItem(CUSTOM_TRACKS_KEY, JSON.stringify(tracks));
}

export function removeCustomTrack(name, author) {
  const tracks = getSavedCustomTracks().filter(t => !(t.name === name && t.author === author));
  localStorage.setItem(CUSTOM_TRACKS_KEY, JSON.stringify(tracks));
}
