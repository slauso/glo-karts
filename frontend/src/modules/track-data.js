/**
 * track-data.js — Central track metadata registry
 *
 * Tracks may be procedural or backed by shipped Babylon-ready GLBs.
 */

import { resetKart } from './havok-physics.js';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const TRACK_REGISTRY = {
  // ── Default fallback ────────────────────────────────────────────────
  test_box: {
    type: 'procedural',
    scale: 1,
    name: 'Block Fort',
    start: { x: 0, y: 1, z: 0 },
    startHeading: 0,
    hasGates: false,
    hasDecorations: false,
    hasTrackOutline: false,
  },

  // ── Default battle arena ────────────────────────────────────────────
  glo_arena: {
    type: 'stk-arena',
    scale: 1,
    name: 'Glo Arena',
    arenaPath: '/models/stk/arenas/temple/arena.glb',
    start: { x: 54.568, y: 5.123, z: 5.124 },
    startHeading: 3.1416,
  },


};

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/** Get full registry object — used by content-registry.js to derive UI lists. */
export function getTrackRegistry() {
  return TRACK_REGISTRY;
}

/**
 * Look up registry entry. Falls back to test_box so the game never
 * crashes on an unknown id.
 */
export function getTrackInfo(mapId) {
  return TRACK_REGISTRY[mapId] || TRACK_REGISTRY.test_box;
}

export function isSTKTrack(mapId) {
  const info = getTrackInfo(mapId);
  return info.type === 'stk-track';
}
export function isSTKArena(mapId) {
  const info = getTrackInfo(mapId);
  return info.type === 'stk-arena';
}
export function isCustomMap() { return false; }
export function isAddonTrack() { return false; }

/** Get procedural generation parameters (retained for compatibility). */
export function getAddonParams(mapId) {
  const info = getTrackInfo(mapId);
  if (info.type === 'procedural-arena') {
    return {
      shape: info.shape || 'circle',
      halfSize: info.halfSize || 65,
      roadWidth: 14,
      elevationAmplitude: 0,
      wallHeight: info.wallHeight || 5,
      color: [0.3, 0.3, 0.35],
      accent: [0.5, 0.12, 0.12],
      obstacles: [],
      isArena: true,
    };
  }
  return null;
}

/** Return .glb model path for STK entries, null for procedural ones. */
export function getTrackModelPath(mapId) {
  const info = getTrackInfo(mapId);
  return info.arenaPath || info.trackPath || null;
}

/** Uniform scale to apply to the loaded .glb model. */
export function getTrackScale(mapId) {
  return getTrackInfo(mapId).scale;
}

/** Spawn position {x, y, z}. */
export function getStartPosition(mapId) {
  return { ...getTrackInfo(mapId).start };
}

/** Heading in radians around Y axis. */
export function getStartHeading(mapId) {
  return getTrackInfo(mapId).startHeading || 0;
}

/** Y coordinate below which the car is considered to have fallen off. */
export function getFallThreshold(mapId) {
  const info = getTrackInfo(mapId);
  return info.start.y - 80;
}

/** Whether this track has a gates.glb checkpoint file. */
export function hasGates(mapId) {
  return !!getTrackInfo(mapId).hasGates;
}

/** Whether this track has a decorations.glb. */
export function hasDecorations(mapId) {
  return !!getTrackInfo(mapId).hasDecorations;
}

/** Whether this track has a track-outline.glb for the minimap. */
export function hasTrackOutline(mapId) {
  return !!getTrackInfo(mapId).hasTrackOutline;
}

/**
 * Reposition the kart to the track's start position (Havok).
 * Call after the physics body has been created.
 */
export function applyStartPosition(mapId) {
  const pos = getStartPosition(mapId);
  const heading = getStartHeading(mapId);
  resetKart(pos, heading);
}
