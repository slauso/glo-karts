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

const AUTOSAVE_KEY = 'builderV2_autosave';
const SAVES_KEY = 'builderV2_saves';
const VERSION = 1;

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
  buildTrackData(name = 'Untitled Arena', author = 'Builder v2') {
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
      roadCells,
      segments,
      checkpoints,
      startPositions,
      obstacles,
      bounds,
    };
  }

  /** Export as JSON string. */
  exportJSON(name, author) {
    return JSON.stringify(this.buildTrackData(name, author));
  }

  /** Export as share code. */
  exportShareCode(name, author) {
    return exportTrackCode(this.exportJSON(name, author));
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
  saveToSlot(name, author) {
    const saves = this._getSaves();
    const data = this.buildTrackData(name, author);
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
  autoSave(name, author) {
    clearTimeout(this._autoSaveTimer);
    this._autoSaveTimer = setTimeout(() => {
      const data = this.buildTrackData(name, author);
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

  /** Download arena as .json file. */
  downloadJSON(name, author) {
    const json = this.exportJSON(name, author);
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
