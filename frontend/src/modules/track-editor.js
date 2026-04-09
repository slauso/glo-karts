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

import {
  GRID_SIZE,
  canPlaceObstacle,
  canPlaceStart,
  canPlaceSurface,
  cellKey,
  createOccupancyIndex,
  snapToGrid,
} from './track-placement.js';

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
/** @typedef {{ id: number, position: Vec3 }} RoadCell */
/** @typedef {{ position: Vec3, width: number }} Checkpoint */
/** @typedef {{ id: number, position: Vec3, heading: number }} StartPosition */
/** @typedef {{ id: number, type: string, position: Vec3 }} Obstacle */
/**
 * @typedef {Object} TrackData
 * @property {number} version
 * @property {string} name
 * @property {string} author
 * @property {RoadCell[]} roadCells
 * @property {Segment[]} segments
 * @property {Checkpoint[]} checkpoints
 * @property {StartPosition[]} startPositions
 * @property {Obstacle[]} obstacles
 * @property {{ min: Vec3, max: Vec3 }} bounds
 */

const TRACK_DATA_VERSION = 1;
const MAX_SEGMENTS = 200;
const MAX_ROAD_CELLS = 400;
const MAX_OBSTACLES = 100;
const MAX_START_POSITIONS = 8;
const ROAD_SEGMENT_TYPES = new Set(['straight', 'curve_left', 'curve_right', 'flat_wide']);

// ── TrackEditor class ──────────────────────────────────────────
export class TrackEditor {
  constructor() {
    /** @type {RoadCell[]} */
    this.roadCells = [];
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
    this._nextIds = {
      roadCell: 1,
      segment: 1,
      obstacle: 1,
      start: 1,
    };
    /** @type {Array<{label: string, before: any, after: any}>} */
    this._undoStack = [];
    /** @type {Array<{label: string, before: any, after: any}>} */
    this._redoStack = [];
    this._occupancyIndex = createOccupancyIndex();
  }

  // ── Public queries ─────────────────────────────────────────
  getSurfaceSegments() {
    return [...this._deriveRoadSegments(), ...this.segments.map((segment) => this._clone(segment))];
  }

  getRoadCellAt(x, z) {
    const key = cellKey(x, z);
    return this.roadCells.find((roadCell) => cellKey(roadCell.position.x, roadCell.position.z) === key) || null;
  }

  findSegment(id) {
    return this.segments.find((segment) => segment.id === id) || null;
  }

  findObstacle(id) {
    return this.obstacles.find((obstacle) => obstacle.id === id) || null;
  }

  findStartPosition(id) {
    return this.startPositions.find((start) => start.id === id) || null;
  }

  hasSurfaceAt(x, z, ignore = null) {
    return !canPlaceSurface(this._occupancyIndex, x, z, ignore);
  }

  hasObstacleAt(x, z, ignore = null) {
    return !canPlaceObstacle(this._occupancyIndex, x, z, ignore);
  }

  hasStartAt(x, z, ignore = null) {
    return !canPlaceStart(this._occupancyIndex, x, z, ignore);
  }

  canPlaceEntity(kind, x, z, ignore = null) {
    if (kind === 'surface') return canPlaceSurface(this._occupancyIndex, x, z, ignore);
    if (kind === 'obstacle') return canPlaceObstacle(this._occupancyIndex, x, z, ignore);
    if (kind === 'start') return canPlaceStart(this._occupancyIndex, x, z, ignore);
    return false;
  }

  createHistoryCheckpoint() {
    return this._captureState();
  }

  commitHistoryCheckpoint(label, beforeState) {
    return this._commitCheckpoint(label, beforeState);
  }

  // ── Placement + updates ────────────────────────────────────
  addRoadCell(x, y, z) {
    const cell = typeof x === 'object' ? x : { x, y, z };
    return this._runCommand('Add road cell', () => this._createRoadCell(cell.x, cell.z));
  }

  addRoadStroke(cells) {
    if (!Array.isArray(cells) || !cells.length) return [];
    return this._runCommand('Add road stroke', () => {
      const created = [];
      cells.forEach((cell) => {
        const roadCell = this._createRoadCell(cell.x, cell.z);
        if (roadCell) created.push(roadCell);
      });
      return created;
    }) || [];
  }

  removeRoadCell(idOrPosition) {
    return this._runCommand('Remove road cell', () => this._removeRoadCell(idOrPosition));
  }

  updateRoadCell(id, updates, { recordHistory = true, label = 'Update road cell' } = {}) {
    const before = recordHistory ? this._captureState() : null;
    const roadCell = this.roadCells.find((entry) => entry.id === id);
    if (!roadCell || !updates) return false;

    const nextPosition = updates.position ? { ...roadCell.position, ...updates.position } : { ...roadCell.position };
    const snappedX = snapToGrid(nextPosition.x);
    const snappedZ = snapToGrid(nextPosition.z);
    if (!canPlaceSurface(this._occupancyIndex, snappedX, snappedZ, { type: 'road', id })) return false;

    roadCell.position.x = snappedX;
    roadCell.position.y = 0;
    roadCell.position.z = snappedZ;
    this._rebuildOccupancy();
    if (recordHistory) this._commitCheckpoint(label, before);
    return true;
  }

  placeSegment(type, x, y, z, rotation = 0) {
    return this._runCommand('Place segment', () => this._createSegment(type, x, y, z, rotation));
  }

  updateSegment(id, updates, { recordHistory = true, label = 'Update segment' } = {}) {
    return this._applyEntityUpdate('segment', id, updates, { recordHistory, label });
  }

  removeSegment(id) {
    return this._runCommand('Remove segment', () => this._removeById(this.segments, id));
  }

  convertSegmentToRoad(id) {
    return this._runCommand('Convert segment to road', () => {
      const segment = this.findSegment(id);
      if (!segment) return false;
      if (!canPlaceSurface(this._occupancyIndex, segment.position.x, segment.position.z, { type: 'segment', id })) return false;
      const position = { ...segment.position };
      if (!this._removeById(this.segments, id)) return false;
      return this._createRoadCell(position.x, position.z);
    });
  }

  convertRoadToSegment(id, type, rotation = 0, y = 0) {
    return this._runCommand('Convert road to segment', () => {
      const roadCell = this.roadCells.find((entry) => entry.id === id);
      if (!roadCell || !SEGMENT_TYPES[type]) return false;
      const position = { ...roadCell.position };
      if (!this._removeRoadCell(id)) return false;
      return this._createSegment(type, position.x, y, position.z, rotation);
    });
  }

  placeObstacle(type, x, y, z) {
    return this._runCommand('Place obstacle', () => this._createObstacle(type, x, y, z));
  }

  updateObstacle(id, updates, { recordHistory = true, label = 'Update obstacle' } = {}) {
    return this._applyEntityUpdate('obstacle', id, updates, { recordHistory, label });
  }

  removeObstacle(idOrIndex) {
    return this._runCommand('Remove obstacle', () => this._removeObstacle(idOrIndex));
  }

  // ── Checkpoint placement ───────────────────────────────────
  /**
   * Auto-generate checkpoints along the center-line of placed segments.
   * Creates one checkpoint per segment at the segment center.
   */
  autoGenerateCheckpoints() {
    this.checkpoints = this.getSurfaceSegments().map(seg => ({
      position: { ...seg.position },
      width: SEGMENT_TYPES[seg.type]?.width || 10,
    }));
  }

  // ── Start position placement ───────────────────────────────
  addStartPosition(x, y, z, heading = 0) {
    return this._runCommand('Add start position', () => this._createStartPosition(x, y, z, heading));
  }

  updateStartPosition(id, updates, { recordHistory = true, label = 'Update start position' } = {}) {
    return this._applyEntityUpdate('start', id, updates, { recordHistory, label });
  }

  removeStartPosition(idOrIndex) {
    return this._runCommand('Remove start position', () => this._removeStartPosition(idOrIndex));
  }

  deleteEntities(entities) {
    if (!Array.isArray(entities) || !entities.length) return false;
    return this._runCommand('Delete selection batch', () => {
      let removed = false;
      entities.forEach((entity) => {
        if (!entity) return;
        if (entity.type === 'road') removed = this._removeRoadCell(entity.id) || removed;
        if (entity.type === 'segment') removed = this._removeById(this.segments, entity.id) || removed;
        if (entity.type === 'obstacle') removed = this._removeObstacle(entity.id) || removed;
        if (entity.type === 'start') removed = this._removeStartPosition(entity.id) || removed;
      });
      return removed;
    });
  }

  // ── Undo / Redo ────────────────────────────────────────────
  undo() {
    const entry = this._undoStack.pop();
    if (!entry) return false;
    this._restoreState(entry.before);
    this._redoStack.push(entry);
    return true;
  }

  redo() {
    const entry = this._redoStack.pop();
    if (!entry) return false;

    this._restoreState(entry.after);
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
    const surfaceSegments = this.getSurfaceSegments();

    if (surfaceSegments.length < 1) {
      errors.push('Arena must have at least 1 segment.');
    }

    if (this.startPositions.length < 1) {
      errors.push('Track must have at least 1 start position.');
    }

    // Check for disconnected segments (simple adjacency check)
    if (surfaceSegments.length >= 2) {
      const connected = this._checkConnectivity(surfaceSegments);
      if (!connected) {
        errors.push('Track has disconnected segments. All segments must form a connected path.');
      }
    }

    // Check for overlapping colliders
    for (let i = 0; i < surfaceSegments.length; i++) {
      for (let j = i + 1; j < surfaceSegments.length; j++) {
        const a = surfaceSegments[i];
        const b = surfaceSegments[j];
        if (Math.abs(a.position.x - b.position.x) < 1 &&
            Math.abs(a.position.z - b.position.z) < 1) {
          errors.push(`Segments ${a.id} and ${b.id} overlap at (${a.position.x}, ${a.position.z}).`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  _checkConnectivity(segments = this.getSurfaceSegments()) {
    if (segments.length <= 1) return true;

    const visited = new Set();
    const queue = [segments[0]];
    const segmentKey = (segment) => `${segment.source || 'segment'}:${segment.id}`;
    visited.add(segmentKey(segments[0]));

    while (queue.length > 0) {
      const current = queue.shift();
      for (const seg of segments) {
        const key = segmentKey(seg);
        if (visited.has(key)) continue;
        const dx = Math.abs(current.position.x - seg.position.x);
        const dz = Math.abs(current.position.z - seg.position.z);
        // Adjacent if within one grid cell
        if ((dx <= GRID_SIZE + 1 && dz < 1) || (dz <= GRID_SIZE + 1 && dx < 1) ||
            (dx <= GRID_SIZE + 1 && dz <= GRID_SIZE + 1)) {
          visited.add(key);
          queue.push(seg);
        }
      }
    }

    return visited.size === segments.length;
  }

  // ── Bounds calculation ─────────────────────────────────────
  _computeBounds() {
    const surfaceSegments = this.getSurfaceSegments();
    if (surfaceSegments.length === 0) {
      return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
    }

    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };

    for (const seg of surfaceSegments) {
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
    const segments = this.getSurfaceSegments();

    /** @type {TrackData} */
    const trackData = {
      version: TRACK_DATA_VERSION,
      name: this.trackName,
      author: this.trackAuthor,
      roadCells: this.roadCells.map((roadCell) => this._clone(roadCell)),
      segments: segments.map((segment) => this._clone(segment)),
      checkpoints: this.checkpoints.map(c => ({ position: { ...c.position }, width: c.width })),
      startPositions: this.startPositions.map(sp => ({ id: sp.id, position: { ...sp.position }, heading: sp.heading })),
      obstacles: this.obstacles.map(o => ({ id: o.id, type: o.type, position: { ...o.position } })),
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
      this.roadCells = [];
      this.segments = [];
      this.checkpoints = Array.isArray(data.checkpoints) ? data.checkpoints : [];
      this.startPositions = [];
      this.obstacles = [];

      if (Array.isArray(data.roadCells) && data.roadCells.length) {
        this.roadCells = data.roadCells
          .filter((roadCell) => roadCell?.position)
          .map((roadCell) => ({
            id: Number(roadCell.id || 0),
            position: {
              x: snapToGrid(roadCell.position.x),
              y: 0,
              z: snapToGrid(roadCell.position.z),
            },
          }));
      }

      (Array.isArray(data.segments) ? data.segments : []).forEach((segment) => {
        if (!segment?.position || !SEGMENT_TYPES[segment.type]) return;
        const isRoad = segment.builderRole === 'road'
          || (!data.roadCells?.length && (segment.builderRole === 'road' || ROAD_SEGMENT_TYPES.has(segment.type) && !segment.builderRole));

        if (isRoad) {
          if (!this.getRoadCellAt(segment.position.x, segment.position.z)) {
            this.roadCells.push({
              id: Number(segment.id || 0),
              position: { x: snapToGrid(segment.position.x), y: 0, z: snapToGrid(segment.position.z) },
            });
          }
          return;
        }

        this.segments.push({
          id: Number(segment.id || 0),
          type: segment.type,
          position: {
            x: snapToGrid(segment.position.x),
            y: Number(segment.position.y || 0),
            z: snapToGrid(segment.position.z),
          },
          rotation: this._normalizeRotation(segment.rotation || 0),
          scale: Number(segment.scale || 1),
        });
      });

      this.startPositions = (Array.isArray(data.startPositions) ? data.startPositions : [])
        .filter((start) => start?.position)
        .map((start) => ({
          id: Number(start.id || 0),
          position: {
            x: snapToGrid(start.position.x),
            y: Number(start.position.y || 0),
            z: snapToGrid(start.position.z),
          },
          heading: Number(start.heading || 0),
        }));

      this.obstacles = (Array.isArray(data.obstacles) ? data.obstacles : [])
        .filter((obstacle) => obstacle?.position && OBSTACLE_TYPES[obstacle.type])
        .map((obstacle) => ({
          id: Number(obstacle.id || 0),
          type: obstacle.type,
          position: {
            x: snapToGrid(obstacle.position.x),
            y: Number(obstacle.position.y || 0),
            z: snapToGrid(obstacle.position.z),
          },
        }));

      this._syncNextIds();
      this._undoStack.length = 0;
      this._redoStack.length = 0;
      this._rebuildOccupancy();
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
    return this.getSurfaceSegments().map(seg => {
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
    this.roadCells = [];
    this.segments = [];
    this.checkpoints = [];
    this.startPositions = [];
    this.obstacles = [];
    this._nextIds = { roadCell: 1, segment: 1, obstacle: 1, start: 1 };
    this._undoStack.length = 0;
    this._redoStack.length = 0;
    this._rebuildOccupancy();
  }

  // ── Internal helpers ───────────────────────────────────────
  _runCommand(label, operation) {
    const before = this._captureState();
    const result = operation();
    if (result === false || result == null) return result;
    this._commitCheckpoint(label, before);
    return result;
  }

  _commitCheckpoint(label, before) {
    if (!before) return false;
    const after = this._captureState();
    if (JSON.stringify(before) === JSON.stringify(after)) return false;
    this._undoStack.push({ label, before, after });
    if (this._undoStack.length > 100) this._undoStack.shift();
    this._redoStack.length = 0;
    return true;
  }

  _captureState() {
    return {
      roadCells: this._clone(this.roadCells),
      segments: this._clone(this.segments),
      checkpoints: this._clone(this.checkpoints),
      startPositions: this._clone(this.startPositions),
      obstacles: this._clone(this.obstacles),
      trackName: this.trackName,
      trackAuthor: this.trackAuthor,
      nextIds: this._clone(this._nextIds),
    };
  }

  _restoreState(state) {
    this.roadCells = this._clone(state.roadCells || []);
    this.segments = this._clone(state.segments || []);
    this.checkpoints = this._clone(state.checkpoints || []);
    this.startPositions = this._clone(state.startPositions || []);
    this.obstacles = this._clone(state.obstacles || []);
    this.trackName = state.trackName || 'Untitled Track';
    this.trackAuthor = state.trackAuthor || 'Anonymous';
    this._nextIds = this._clone(state.nextIds || { roadCell: 1, segment: 1, obstacle: 1, start: 1 });
    this._rebuildOccupancy();
  }

  _clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  _normalizeRotation(value) {
    const snapped = Math.round(Number(value || 0) / 90) * 90;
    return ((snapped % 360) + 360) % 360;
  }

  _rebuildOccupancy() {
    this._occupancyIndex = createOccupancyIndex({
      roadCells: this.roadCells,
      segments: this.segments,
      obstacles: this.obstacles,
      startPositions: this.startPositions,
    });
  }

  _syncNextIds() {
    this._nextIds.roadCell = Math.max(0, ...this.roadCells.map((roadCell) => roadCell.id || 0)) + 1;
    this._nextIds.segment = Math.max(0, ...this.segments.map((segment) => segment.id || 0)) + 1;
    this._nextIds.obstacle = Math.max(0, ...this.obstacles.map((obstacle) => obstacle.id || 0)) + 1;
    this._nextIds.start = Math.max(0, ...this.startPositions.map((start) => start.id || 0)) + 1;
  }

  _createRoadCell(x, z) {
    if (this.roadCells.length >= MAX_ROAD_CELLS) return null;
    const snappedX = snapToGrid(x);
    const snappedZ = snapToGrid(z);
    if (!canPlaceSurface(this._occupancyIndex, snappedX, snappedZ)) return null;

    const roadCell = {
      id: this._nextIds.roadCell++,
      position: { x: snappedX, y: 0, z: snappedZ },
    };
    this.roadCells.push(roadCell);
    this._rebuildOccupancy();
    return roadCell;
  }

  _createSegment(type, x, y, z, rotation = 0) {
    if (!SEGMENT_TYPES[type]) return null;
    if (this.segments.length >= MAX_SEGMENTS) return null;

    const snappedX = snapToGrid(x);
    const snappedZ = snapToGrid(z);
    if (!canPlaceSurface(this._occupancyIndex, snappedX, snappedZ)) return null;

    const segment = {
      id: this._nextIds.segment++,
      type,
      position: { x: snappedX, y: Number(y || 0), z: snappedZ },
      rotation: this._normalizeRotation(rotation),
      scale: 1,
    };

    this.segments.push(segment);
    this._rebuildOccupancy();
    return segment;
  }

  _createObstacle(type, x, y, z) {
    if (!OBSTACLE_TYPES[type]) return null;
    if (this.obstacles.length >= MAX_OBSTACLES) return null;

    const snappedX = snapToGrid(x);
    const snappedZ = snapToGrid(z);
    if (!canPlaceObstacle(this._occupancyIndex, snappedX, snappedZ)) return null;

    const obstacle = {
      id: this._nextIds.obstacle++,
      type,
      position: { x: snappedX, y: Number(y || 0), z: snappedZ },
    };
    this.obstacles.push(obstacle);
    this._rebuildOccupancy();
    return obstacle;
  }

  _createStartPosition(x, y, z, heading = 0) {
    if (this.startPositions.length >= MAX_START_POSITIONS) return null;

    const snappedX = snapToGrid(x);
    const snappedZ = snapToGrid(z);
    if (!canPlaceStart(this._occupancyIndex, snappedX, snappedZ)) return null;

    const startPosition = {
      id: this._nextIds.start++,
      position: { x: snappedX, y: Number(y || 0), z: snappedZ },
      heading: Number(heading || 0),
    };
    this.startPositions.push(startPosition);
    this._rebuildOccupancy();
    return startPosition;
  }

  _removeRoadCell(idOrPosition) {
    const index = typeof idOrPosition === 'number'
      ? this.roadCells.findIndex((roadCell) => roadCell.id === idOrPosition)
      : this.roadCells.findIndex((roadCell) => cellKey(roadCell.position.x, roadCell.position.z) === cellKey(idOrPosition?.x, idOrPosition?.z));
    if (index === -1) return false;
    this.roadCells.splice(index, 1);
    this._rebuildOccupancy();
    return true;
  }

  _removeObstacle(idOrIndex) {
    const index = this._resolveIndex(this.obstacles, idOrIndex);
    if (index === -1) return false;
    this.obstacles.splice(index, 1);
    this._rebuildOccupancy();
    return true;
  }

  _removeStartPosition(idOrIndex) {
    const index = this._resolveIndex(this.startPositions, idOrIndex);
    if (index === -1) return false;
    this.startPositions.splice(index, 1);
    this._rebuildOccupancy();
    return true;
  }

  _removeById(collection, id) {
    const index = collection.findIndex((entry) => entry.id === id);
    if (index === -1) return false;
    collection.splice(index, 1);
    this._rebuildOccupancy();
    return true;
  }

  _resolveIndex(collection, idOrIndex) {
    if (typeof idOrIndex !== 'number') return -1;
    const byId = collection.findIndex((entry) => entry.id === idOrIndex);
    if (byId !== -1) return byId;
    return idOrIndex >= 0 && idOrIndex < collection.length ? idOrIndex : -1;
  }

  _applyEntityUpdate(kind, id, updates, { recordHistory = true, label } = {}) {
    const before = recordHistory ? this._captureState() : null;
    let entity = null;

    if (kind === 'segment') entity = this.findSegment(id);
    if (kind === 'obstacle') entity = this.findObstacle(id);
    if (kind === 'start') entity = this.findStartPosition(id);
    if (!entity || !updates) return false;

    const nextPosition = updates.position
      ? { ...entity.position, ...updates.position }
      : { ...entity.position };
    const snappedX = snapToGrid(nextPosition.x);
    const snappedZ = snapToGrid(nextPosition.z);

    if (kind === 'segment' && !canPlaceSurface(this._occupancyIndex, snappedX, snappedZ, { type: 'segment', id })) return false;
    if (kind === 'obstacle' && !canPlaceObstacle(this._occupancyIndex, snappedX, snappedZ, { type: 'obstacle', id })) return false;
    if (kind === 'start' && !canPlaceStart(this._occupancyIndex, snappedX, snappedZ, { type: 'start', id })) return false;

    entity.position.x = snappedX;
    entity.position.y = Number(nextPosition.y ?? entity.position.y ?? 0);
    entity.position.z = snappedZ;

    if (kind === 'segment') {
      if (updates.type && SEGMENT_TYPES[updates.type]) entity.type = updates.type;
      if (Object.prototype.hasOwnProperty.call(updates, 'rotation')) entity.rotation = this._normalizeRotation(updates.rotation);
      if (Object.prototype.hasOwnProperty.call(updates, 'scale')) entity.scale = Number(updates.scale || entity.scale || 1);
    }

    if (kind === 'obstacle') {
      if (updates.type && OBSTACLE_TYPES[updates.type]) entity.type = updates.type;
    }

    if (kind === 'start' && Object.prototype.hasOwnProperty.call(updates, 'heading')) {
      entity.heading = Number(updates.heading || 0);
    }

    this._rebuildOccupancy();
    if (recordHistory) this._commitCheckpoint(label, before);
    return true;
  }

  _deriveRoadSegments() {
    const roadMap = new Map(this.roadCells.map((roadCell) => [cellKey(roadCell.position.x, roadCell.position.z), roadCell]));
    return this.roadCells.map((roadCell) => {
      const x = roadCell.position.x;
      const z = roadCell.position.z;
      const north = roadMap.has(cellKey(x, z - GRID_SIZE));
      const east = roadMap.has(cellKey(x + GRID_SIZE, z));
      const south = roadMap.has(cellKey(x, z + GRID_SIZE));
      const west = roadMap.has(cellKey(x - GRID_SIZE, z));
      const count = [north, east, south, west].filter(Boolean).length;

      let type = 'flat_wide';
      let rotation = 0;

      if (count === 1) {
        type = 'straight';
        rotation = (east || west) ? 90 : 0;
      } else if (count === 2) {
        if ((north && south) || (east && west)) {
          type = 'straight';
          rotation = (east && west) ? 90 : 0;
        } else {
          type = 'curve_right';
          if (north && east) rotation = 0;
          else if (east && south) rotation = 90;
          else if (south && west) rotation = 180;
          else rotation = 270;
        }
      } else if (count === 0 || count >= 3) {
        type = 'flat_wide';
        rotation = 0;
      }

      return {
        id: roadCell.id,
        type,
        position: { x, y: 0, z },
        rotation,
        scale: 1,
        source: 'road',
      };
    });
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
