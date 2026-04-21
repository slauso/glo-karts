/**
 * serializer.js — Save / load / share arenas.
 *
 * Compatible with the existing track-editor.js TrackData schema.
 */
import {
  exportTrackCode,
  importTrackCode,
  saveCustomTrack,
  getSavedCustomTracks,
  removeCustomTrack,
  SEGMENT_TYPES,
  OBSTACLE_TYPES,
} from '../modules/track-editor.js';
import { GRID_SIZE } from '../modules/track-placement.js';
import {
  TRACK_CELLS, exportCells, importCells, clearAllCells,
  generateWallColliders, encodeCells, decodeCells,
} from './track-data.js';

const AUTOSAVE_KEY = 'builderV2_autosave';
const SAVES_KEY = 'builderV2_saves';
const VERSION = 1;
const PLAYTEST_WORLD_SCALE = 3;

function roadCellKey(position) {
  return `${position.x}:${position.z}`;
}

function deriveRoadSegments(roadCells = []) {
  return roadCells.map((roadCell) => {
    const x = roadCell.position.x;
    const z = roadCell.position.z;
    const tdKey = `${x}:${z}`;
    const td = TRACK_CELLS.get(tdKey);
    const type = td?.type || 'straight';
    const rotation = td?.rotation || 0;

    return {
      id: roadCell.id,
      type,
      position: { ...roadCell.position },
      rotation,
      scale: 1,
      builderRole: 'road',
    };
  });
}

function deriveTrackSpawnPositions(playtestSegments = [], existingStartPositions = []) {
  if (Array.isArray(existingStartPositions) && existingStartPositions.length) {
    return existingStartPositions.map((start) => ({
      id: Number(start.id || 0),
      position: { ...start.position, y: Number(start.position?.y || 2) },
      heading: Number(start.heading || 0),
    }));
  }

  if (!playtestSegments.length) return [];

  const endpoint = playtestSegments.find((segment) => Number(segment.connectionCount || 0) <= 1)
    || playtestSegments[0];

  return [{
    id: 1,
    position: {
      x: Number(endpoint.position?.x || 0),
      // Hint Y slightly above the authored segment so the runtime surface
      // probe has enough travel to find the deck. The probe itself adds the
      // required ground clearance; a large hardcoded offset here previously
      // caused a visible hover above flat arena decks.
      y: Number(endpoint.position?.y || 0) + 1,
      z: Number(endpoint.position?.z || 0),
    },
    heading: Number(endpoint.rotation || 0),
  }];
}

function degreesToRadians(value) {
  return (Number(value || 0) * Math.PI) / 180;
}

function scalePosition(position, scale = PLAYTEST_WORLD_SCALE) {
  return {
    x: Number(position?.x || 0) * scale,
    y: Number(position?.y || 0) * scale,
    z: Number(position?.z || 0) * scale,
  };
}

function scaleBounds(bounds, scale = PLAYTEST_WORLD_SCALE) {
  if (!bounds?.min || !bounds?.max) return bounds;
  return {
    min: scalePosition(bounds.min, scale),
    max: scalePosition(bounds.max, scale),
  };
}

function toPlaytestSegment(segment) {
  // Pass the builder type through as-is — the game engine's
  // resolveCustomArenaSegmentSpec() already resolves all types including
  // warped variants, bridges, and Pittsburgh bridges.  The old
  // PLAYTEST_SEGMENT_TYPE_MAP collapsed every unknown type to 'straight'.
  const type = String(segment.type || 'straight');
  return {
    id: segment.id,
    type,
    position: { ...segment.position, y: Number(segment.position?.y || 0) },
    rotation: Number(segment.rotation || 0),
    scale: Number(segment.scale || 1) || 1,
    builderRole: 'placed',
  };
}

function toCheckpointData(entity) {
  return {
    id: entity.id,
    position: { ...entity.position },
    width: Math.max(6, 12 * Number(entity.scale || 1)),
    rotation: Number(entity.rotation || 0),
    authored: true,
  };
}

export class Serializer {
  /**
   * @param {import('./scene-graph.js').SceneGraph} sceneGraph
   * @param {import('./road-panel.js').RoadPainter} roadPainter
   */
  constructor(sceneGraph, roadPainter) {
    this._graph = sceneGraph;
    this._road = roadPainter;
    this._autoSaveTimer = null;
  }

  /** Build the TrackData JSON from current scene state. */
  buildTrackData(name = 'Untitled Track', author = 'TinkerTracks', options = {}) {
    const preset = options?.preset === 'track' ? 'track' : 'arena';
    const entities = this._graph.getAll();
    const segments = entities
      .filter(e => e.category === 'segment')
      .map(e => ({
        id: e.id,
        type: e.type,
        position: { ...e.position },
        rotation: e.rotation || 0,
        scale: e.scale || 1,
      }));

    const obstacles = entities
      .filter((e) => e.category === 'obstacle' && e.type !== 'checkpoint')
      .map(e => ({
        id: e.id,
        type: e.type,
        position: { ...e.position },
        rotation: Number(e.rotation || 0),
        scale: Number(e.scale || 1),
      }));

    const startPositions = entities
      .filter(e => e.category === 'spawn')
      .map(e => ({
        id: e.id,
        position: { ...e.position },
        heading: Number(e.heading ?? e.rotation ?? 0),
      }));

    const roadCells = this._road.serialize();
    const authoredCheckpoints = entities
      .filter((e) => e.category === 'obstacle' && e.type === 'checkpoint')
      .map(toCheckpointData);

    // Preserve authored checkpoint gates when present, otherwise fall back
    // to generated race progression markers.
    const checkpoints = authoredCheckpoints.length
      ? authoredCheckpoints
      : this._generateCheckpoints(roadCells);

    // Compute bounds
    const bounds = this._computeBounds(checkpoints, segments, roadCells, obstacles);

    return {
      version: VERSION,
      name,
      author,
      builderPreset: preset,
      roadCells,
      segments,
      checkpoints,
      startPositions,
      obstacles,
      bounds,
    };
  }

  /** Build a runtime-safe payload for realtime playtests. */
  buildPlaytestTrackData(name = 'Untitled Track', author = 'TinkerTracks', options = {}) {
    const preset = options?.preset === 'track' ? 'track' : 'arena';
    const data = this.buildTrackData(name, author, { preset });
    const roadSegments = deriveRoadSegments(data.roadCells);
    const translatedPlacedSegments = data.segments.map(toPlaytestSegment);
    const segmentMap = new Map();

    roadSegments.forEach((segment, index) => {
      const key = roadCellKey(segment.position);
      if (!segmentMap.has(key)) {
        segmentMap.set(key, {
          ...segment,
          id: Number(segment.id || index + 1),
        });
      }
    });

    translatedPlacedSegments.forEach((segment, index) => {
      const key = roadCellKey(segment.position);
      segmentMap.set(key, {
        ...segment,
        id: Number(segment.id || roadSegments.length + index + 1),
      });
    });

    const playtestSegments = Array.from(segmentMap.values());
    const authoredCheckpoints = Array.isArray(data.checkpoints)
      ? data.checkpoints.filter((checkpoint) => checkpoint?.position && checkpoint.authored)
      : [];
    const startPositions = deriveTrackSpawnPositions(playtestSegments, data.startPositions);
    const scaledSegments = playtestSegments.map((segment) => ({
      ...segment,
      position: scalePosition(segment.position),
      scale: Number(segment.scale || 1) * PLAYTEST_WORLD_SCALE,
    }));
    const scaledCheckpoints = (authoredCheckpoints.length
      ? authoredCheckpoints
      : this._generateCheckpoints(
          playtestSegments.map((segment, index) => ({
            id: segment.id || index + 1,
            position: { ...segment.position },
          })),
        )
    ).map((checkpoint) => ({
      ...checkpoint,
      position: scalePosition(checkpoint.position),
      width: Number(checkpoint.width || 0) * PLAYTEST_WORLD_SCALE,
    }));

    return {
      ...data,
      builderPreset: preset,
      roadCells: data.roadCells.map((roadCell) => ({
        ...roadCell,
        position: scalePosition(roadCell.position),
      })),
      segments: scaledSegments,
      checkpoints: scaledCheckpoints,
      obstacles: data.obstacles.map((obstacle) => ({
        ...obstacle,
        type: String(obstacle?.type || 'barrier'),
        position: scalePosition(obstacle.position),
        scale: Number(obstacle?.scale || 1) * PLAYTEST_WORLD_SCALE,
      })),
      startPositions: startPositions.map((start) => ({
        ...start,
        position: scalePosition(start.position),
        heading: degreesToRadians(start.heading),
      })),
      bounds: scaleBounds(data.bounds),
      playtestMode: preset === 'track' ? 'race' : 'battle',
      wallColliders: generateWallColliders().map((w) => ({
        position: scalePosition(w.position),
        size: scalePosition(w.size),
        rotation: w.rotation,
      })),
    };
  }

  /** Export as JSON string. */
  exportJSON(name, author, options = {}) {
    return JSON.stringify(this.buildTrackData(name, author, options));
  }

  /** Export as share code. */
  exportShareCode(name, author, options = {}) {
    return exportTrackCode(this.exportJSON(name, author, options));
  }

  /** Import from share code. Returns parsed data or null. */
  importShareCode(code) {
    const json = importTrackCode(code);
    if (!json) return null;
    try { return JSON.parse(json); } catch { return null; }
  }

  /** Import from raw JSON string. */
  importJSON(jsonStr) {
    try {
      const data = JSON.parse(jsonStr);
      if (!data || data.version !== VERSION) return null;
      return data;
    } catch { return null; }
  }

  /** Export road cells as compact base64url string for URL sharing. */
  exportCompact() {
    return encodeCells();
  }

  /** Import road cells from compact base64url string. Returns cell array. */
  importCompact(encoded) {
    return decodeCells(encoded);
  }

  /** Save to localStorage named slot. */
  saveToSlot(name, author, options = {}) {
    const saves = this._getSaves();
    const data = this.buildTrackData(name, author, options);
    const key = `${name}__${author}`;
    saves[key] = { data, savedAt: Date.now() };
    localStorage.setItem(SAVES_KEY, JSON.stringify(saves));

    // Also save to runtime custom tracks for playtest
    saveCustomTrack(data);
    return true;
  }

  /** Load from localStorage named slot. */
  loadFromSlot(key) {
    const saves = this._getSaves();
    return saves[key]?.data || null;
  }

  /** List saved slots. */
  listSlots() {
    const saves = this._getSaves();
    return Object.entries(saves).map(([key, val]) => ({
      key,
      name: val.data?.name || 'Untitled',
      author: val.data?.author || 'Unknown',
      savedAt: val.savedAt,
      preset: val.data?.builderPreset === 'track' ? 'track' : 'arena',
      preview: {
        roadCells: (val.data?.roadCells || []).slice(0, 256).map((cell) => ({
          position: {
            x: Number(cell?.position?.x || 0),
            z: Number(cell?.position?.z || 0),
          },
        })),
        segments: (val.data?.segments || []).slice(0, 128).map((segment) => ({
          position: {
            x: Number(segment?.position?.x || 0),
            z: Number(segment?.position?.z || 0),
          },
        })),
        obstacles: (val.data?.obstacles || []).slice(0, 96).map((obstacle) => ({
          position: {
            x: Number(obstacle?.position?.x || 0),
            z: Number(obstacle?.position?.z || 0),
          },
        })),
        startPositions: (val.data?.startPositions || []).slice(0, 16).map((start) => ({
          position: {
            x: Number(start?.position?.x || 0),
            z: Number(start?.position?.z || 0),
          },
        })),
      },
    }));
  }

  /** Delete a saved slot. */
  deleteSlot(key) {
    const saves = this._getSaves();
    const data = saves[key]?.data;
    delete saves[key];
    localStorage.setItem(SAVES_KEY, JSON.stringify(saves));
    if (data) removeCustomTrack(data.name, data.author);
  }

  /** Auto-save (debounced). */
  autoSave(name, author, options = {}) {
    clearTimeout(this._autoSaveTimer);
    this._autoSaveTimer = setTimeout(() => {
      const data = this.buildTrackData(name, author, options);
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data));
    }, 2000);
  }

  /** Load auto-save. */
  loadAutoSave() {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  /** Clear the current auto-save payload. */
  clearAutoSave() {
    try {
      localStorage.removeItem(AUTOSAVE_KEY);
    } catch {
      // Ignore storage failures during recovery.
    }
  }

  /** Download arena as .json file. */
  downloadJSON(name, author, options = {}) {
    const json = this.exportJSON(name, author, options);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(name || 'arena').replace(/\s+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  _getSaves() {
    try {
      const raw = localStorage.getItem(SAVES_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  _computeBounds(checkpoints, segments, roadCells, obstacles) {
    const all = [
      ...checkpoints.map(c => c.position),
      ...segments.map(s => s.position),
      ...roadCells.map(r => r.position),
      ...obstacles.map(o => o.position),
    ];
    if (all.length === 0) return { min: { x: -50, y: 0, z: -50 }, max: { x: 50, y: 10, z: 50 } };

    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const p of all) {
      minX = Math.min(minX, p.x);
      minZ = Math.min(minZ, p.z);
      maxX = Math.max(maxX, p.x);
      maxZ = Math.max(maxZ, p.z);
    }
    const pad = 20;
    return {
      min: { x: minX - pad, y: 0, z: minZ - pad },
      max: { x: maxX + pad, y: 10, z: maxZ + pad },
    };
  }

  _generateCheckpoints(roadCells) {
    if (roadCells.length === 0) return [];
    // Simple: create a checkpoint for every 3rd road cell
    return roadCells
      .filter((_, i) => i % 3 === 0)
      .map(rc => ({
        position: { ...rc.position },
        width: 12,
      }));
  }
}
