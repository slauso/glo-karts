/**
 * track-data-loader.js — Runtime loader for extracted STK track auxiliary data.
 *
 * Loads the track-data.json bundles produced by stk_extract_track_data.py.
 * Provides access to driveline, checkpoints, start grid, navmesh, and items.
 */

const cache = {};

/**
 * Fetch and cache track-data.json for a given track or arena.
 * Returns null if the file doesn't exist (custom maps, etc).
 */
export async function loadTrackData(mapId, type = 'track') {
  if (cache[mapId]) return cache[mapId];

  const basePath = type === 'arena'
    ? `/models/stk/arenas/${mapId}/track-data.json`
    : `/models/stk/tracks/${mapId}/track-data.json`;

  try {
    const resp = await fetch(basePath);
    if (!resp.ok) return null;
    const data = await resp.json();
    cache[mapId] = data;
    return data;
  } catch {
    return null;
  }
}

/** Get the driveline (array of quad centers + widths) for a race track. */
export function getDriveline(trackData) {
  return trackData?.driveline || [];
}

/** Get the graph info (mainLoop, shortcuts). */
export function getGraph(trackData) {
  return trackData?.graph || null;
}

/** Get checkpoint array (quadIndex, isLapLine, center, width). */
export function getCheckpoints(trackData) {
  return trackData?.checkpoints || [];
}

/** Get the start grid positions [{position, heading}]. */
export function getStartGrid(trackData) {
  return trackData?.startPositions || [];
}

/** Get the navmesh data for an arena (vertices, faces, adjacency). */
export function getNavmesh(trackData) {
  return trackData?.navmesh || null;
}

/** Get item positions [{type, position, heading}]. */
export function getItems(trackData) {
  return trackData?.items || [];
}

/** Total number of laps for this track. */
export function getLapCount(trackData) {
  return trackData?.laps || 3;
}
