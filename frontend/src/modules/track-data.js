/**
 * track-data.js — Central track metadata registry
 *
 * All courses are 100% procedurally generated at runtime. No static
 * STK/addon assets remain. Only kart GLTFs are imported assets.
 */

import { resetKart } from './havok-physics.js';

// ---------------------------------------------------------------------------
// Registry — procedural courses only
// ---------------------------------------------------------------------------

const TRACK_REGISTRY = {
  // ── Default fallback ────────────────────────────────────────────────
  test_box: {
    type: 'procedural',
    scale: 1,
    name: 'Test Box',
    start: { x: 0, y: 2, z: 0 },
    startHeading: 0,
    hasGates: false,
    hasDecorations: false,
    hasTrackOutline: false,
  },

  // ── Procedural Demo Race Track ──────────────────────────────────────
  glo_circuit: {
    type: 'procedural',
    scale: 1,
    name: 'Glo Circuit',
    start: { x: 0, y: 2, z: 0 },
    startHeading: 0,
    hasGates: false,
    hasDecorations: true,
    hasTrackOutline: false,
  },

  // ── Procedural Demo Battle Arena ────────────────────────────────────
  glo_arena: {
    type: 'procedural-arena',
    scale: 1,
    name: 'Glo Arena',
    start: { x: 0, y: 2, z: 0 },
    startHeading: 0,
    halfSize: 65,
    wallHeight: 5,
    shape: 'circle',
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

export function isSTKTrack() { return false; }
export function isSTKArena() { return false; }
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

/** All courses are procedural — no model downloads. */
export function getTrackModelPath() {
  return null;
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
