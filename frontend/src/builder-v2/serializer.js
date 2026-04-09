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

const AUTOSAVE_KEY = 'builderV2_autosave';
const SAVES_KEY = 'builderV2_saves';
const VERSION = 1;
const PLAYTEST_SEGMENT_TYPE_MAP = Object.freeze({
  straight: 'straight',
  bend: 'bend',
  'bend-large': 'bend-large',
  'bump-up': 'bump-up',
  'bump-down': 'bump-down',
  'hill-beginning': 'hill-beginning',
  'hill-end': 'hill-end',
  'hill-complete': 'hill-complete',
  'hill-complete-half': 'hill-complete-half',
  'skew-left': 'skew-left',
  'skew-right': 'skew-right',
  'skew-left-side': 'skew-left-side',
  'skew-right-side': 'skew-right-side',
  'corner-small': 'corner-small',
  'corner-large': 'corner-large',
  curve: 'curve',
  'corner-small-ramp': 'corner-small-ramp',
  'corner-large-ramp': 'corner-large-ramp',
  wide: 'wide',
  'cap-front': 'cap-front',
  'cap-back': 'cap-back',
  end: 'end',
});

function roadCellKey(position) {
  return `${position.x}:${position.z}`;
}

function classifyTrackRoadCell(north, east, south, west) {
  const count = [north, east, south, west].filter(Boolean).length;

  if (count === 0) {
    return { type: 'wide', rotation: 0, connectionCount: 0 };
  }

  if (count === 1) {
    return {
      type: 'straight',
      rotation: (east || west) ? 90 : 0,
      connectionCount: 1,
    };
  }

  if (count === 2) {
    if ((north && south) || (east && west)) {
      return {
        type: 'straight',
        rotation: (east && west) ? 90 : 0,
        connectionCount: 2,
      };
    }

    let rotation = 270;
    if (north && east) rotation = 0;
    else if (east && south) rotation = 90;
    else if (south && west) rotation = 180;

    return { type: 'corner-small', rotation, connectionCount: 2 };
  }

  return { type: 'wide', rotation: 0, connectionCount: count };
}

function classifyArenaRoadCell(north, east, south, west) {
  const count = [north, east, south, west].filter(Boolean).length;

  if (count === 1) {
    return {
      type: 'straight',
      rotation: (east || west) ? 90 : 0,
      connectionCount: 1,
    };
  }

  if (count === 2) {
    if ((north && south) || (east && west)) {
      return {
        type: 'straight',
        rotation: (east && west) ? 90 : 0,
        connectionCount: 2,
      };
    }

    let rotation = 270;
    if (north && east) rotation = 0;
    else if (east && south) rotation = 90;
    else if (south && west) rotation = 180;

    return { type: 'corner-small', rotation, connectionCount: 2 };
  }

  return { type: 'wide', rotation: 0, connectionCount: count };
}

function deriveRoadSegments(roadCells = [], { preset = 'arena' } = {}) {
  const roadMap = new Map(roadCells.map((roadCell) => [roadCellKey(roadCell.position), roadCell]));
  return roadCells.map((roadCell) => {
    const x = roadCell.position.x;
    const z = roadCell.position.z;
    const north = roadMap.has(`${x}:${z - GRID_SIZE}`);
    const east = roadMap.has(`${x + GRID_SIZE}:${z}`);
    const south = roadMap.has(`${x}:${z + GRID_SIZE}`);
    const west = roadMap.has(`${x - GRID_SIZE}:${z}`);
    const classifier = preset === 'track' ? classifyTrackRoadCell : classifyArenaRoadCell;
    const { type, rotation, connectionCount } = classifier(north, east, south, west);

    return {
      id: roadCell.id,
      type,
      position: { ...roadCell.position },
      rotation,
      scale: 1,
      builderRole: 'road',
      connectionCount,
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
      y: Math.max(2, Number(endpoint.position?.y || 0) + 2),
      z: Number(endpoint.position?.z || 0),
    },
    heading: Number(endpoint.rotation || 0),
  }];
}

function toPlaytestSegment(segment) {
  const type = PLAYTEST_SEGMENT_TYPE_MAP[segment.type] || 'straight';
  return {
    id: segment.id,
    type,
    position: { ...segment.position, y: Number(segment.position?.y || 0) },
    rotation: Number(segment.rotation || 0),
    scale: Number(segment.scale || 1) || 1,
    builderRole: 'placed',
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
      .filter(e => e.category === 'obstacle')
      .map(e => ({
        id: e.id,
        type: e.type,
        position: { ...e.position },
      }));

    const startPositions = entities
      .filter(e => e.category === 'spawn')
      .map(e => ({
        id: e.id,
        position: { ...e.position },
        heading: e.heading || 0,
      }));

    const roadCells = this._road.serialize();

    // Auto-generate checkpoints along road 
    const checkpoints = this._generateCheckpoints(roadCells);

    // Compute bounds
    const bounds = this._computeBounds(segments, roadCells, obstacles);

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
    const roadSegments = deriveRoadSegments(data.roadCells, { preset });
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
    const obstacleTypeMap = {
      item_box: 'item_box',
      boost_pad: 'boost_pad',
      banana: 'banana',
      spawn: 'barrier',
      checkpoint: 'barrier',
    };
    const startPositions = deriveTrackSpawnPositions(playtestSegments, data.startPositions);

    return {
      ...data,
      builderPreset: preset,
      segments: playtestSegments,
      checkpoints: this._generateCheckpoints(
        playtestSegments.map((segment, index) => ({
          id: segment.id || index + 1,
          position: { ...segment.position },
        })),
      ),
      startPositions,
      obstacles: data.obstacles
        .filter((obstacle) => obstacle?.type !== 'spawn' && obstacle?.type !== 'checkpoint')
        .map((obstacle) => ({
        ...obstacle,
        type: obstacleTypeMap[obstacle.type] || 'barrier',
      })),
      playtestMode: preset === 'track' ? 'race' : 'battle',
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

  _computeBounds(segments, roadCells, obstacles) {
    const all = [
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
