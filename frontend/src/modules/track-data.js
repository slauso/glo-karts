/**
 * track-data.js — Central track metadata registry
 *
 * Provides path resolution, scale, spawn positions and feature flags
 * for every selectable track and arena (custom maps, STK race tracks,
 * STK battle arenas).
 *
 * Start positions for STK tracks come from the SuperTuxKart SVN
 * scene.xml files (with a +3 Y offset so the car settles via physics).
 */

import { resetKart } from './havok-physics.js';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const TRACK_REGISTRY = {
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
};

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Look up registry entry. Falls back to a generic custom-map entry so
 * the game never crashes on an unknown id.
 */
export function getTrackInfo(mapId) {
  return TRACK_REGISTRY[mapId] || TRACK_REGISTRY.test_box;
}

export function isSTKTrack(mapId) {
  const info = TRACK_REGISTRY[mapId];
  return info?.type === 'stk-track';
}

export function isSTKArena(mapId) {
  const info = TRACK_REGISTRY[mapId];
  return info?.type === 'stk-arena';
}

export function isCustomMap(mapId) {
  const info = TRACK_REGISTRY[mapId];
  return info?.type === 'custom';
}

/** Returns the URL path to the main .glb model for this track/arena, or null for procedural. */
export function getTrackModelPath(mapId) {
  const info = getTrackInfo(mapId);
  if (info.type === 'procedural') return null;
  if (info.type === 'stk-track') return `/models/stk/tracks/${mapId}/track.glb`;
  if (info.type === 'stk-arena') return `/models/stk/arenas/${mapId}/arena.glb`;
  return `/models/maps/${mapId}/track.glb`;
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
