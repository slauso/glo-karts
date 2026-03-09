/**
 * track-data-loader.js — Runtime loader for extracted STK track auxiliary data.
 *
 * Loads the track-data.json bundles produced by stk_extract_track_data.py.
 * Provides access to driveline, checkpoints, start grid, navmesh, and items.
 */

import { getAddonParams, getTrackInfo } from './track-data.js';
import { generateTrackDataOnly } from './procedural-track-gen.js';
import { generateArenaDataOnly } from './procedural-arena-gen.js';
import { generateDemoCourseDataOnly, generateDemoArenaDataOnly } from './procedural-demo-course.js';

const cache = {};

function buildLoopPoints(mapId, type) {
  const info = getTrackInfo(mapId);
  const params = getAddonParams(mapId) || {};
  const halfSize = params.halfSize || 60;
  const roadWidth = params.roadWidth || (type === 'arena' ? 18 : 14);
  const samples = type === 'arena' ? 24 : 48;
  const shape = params.shape || (type === 'arena' ? 'circle' : 'oval');
  const points = [];

  for (let index = 0; index < samples; index += 1) {
    const t = (index / samples) * Math.PI * 2;
    let x = 0;
    let z = 0;

    switch (shape) {
      case 'diamond':
        x = Math.sin(t) * halfSize;
        z = Math.sin(t + Math.PI / 2) * halfSize;
        break;
      case 'figure8':
        x = Math.sin(t) * halfSize;
        z = Math.sin(t * 2) * (halfSize * 0.6);
        break;
      case 'lshape':
        x = Math.sign(Math.cos(t)) * halfSize * 0.7 + Math.cos(t) * halfSize * 0.35;
        z = Math.sign(Math.sin(t)) * halfSize * 0.7 + Math.sin(t) * halfSize * 0.35;
        break;
      case 'rect':
      case 'square':
      case 'cross':
      case 'circle':
      case 'oval':
      default:
        x = Math.cos(t) * halfSize;
        z = Math.sin(t) * (shape === 'circle' || shape === 'square' ? halfSize : halfSize * 0.75);
        break;
    }

    points.push({
      center: [x, info.start.y - 1, z],
      width: roadWidth,
    });
  }

  return points;
}

function buildRaceFallback(mapId) {
  const info = getTrackInfo(mapId);
  const driveline = buildLoopPoints(mapId, 'track');
  const checkpoints = [0, 12, 24, 36]
    .filter((index) => index < driveline.length)
    .map((quadIndex, checkpointIndex) => ({
      quadIndex,
      isLapLine: checkpointIndex === 0,
      center: driveline[quadIndex].center,
      width: driveline[quadIndex].width,
    }));
  const startPositions = Array.from({ length: 8 }, (_, slot) => ({
    position: [info.start.x - (slot % 2) * 3, info.start.y, info.start.z + Math.floor(slot / 2) * 4],
    heading: info.startHeading || 0,
  }));
  const items = [4, 10, 16, 22, 28, 34, 40, 46]
    .filter((index) => index < driveline.length)
    .map((quadIndex, idx) => ({
      type: idx % 3 === 0 ? 'nitro' : 'item',
      position: driveline[quadIndex].center,
      heading: 0,
    }));

  return {
    driveline,
    checkpoints,
    startPositions,
    items,
    laps: 3,
    graph: {
      mainLoop: [0, driveline.length],
      shortcuts: [],
    },
  };
}

function buildArenaFallback(mapId) {
  const info = getTrackInfo(mapId);
  const params = getAddonParams(mapId) || {};
  const halfSize = params.halfSize || 60;
  const y = info.start.y - 1;
  const vertices = [
    [-halfSize, y, -halfSize],
    [halfSize, y, -halfSize],
    [halfSize, y, halfSize],
    [-halfSize, y, halfSize],
  ];
  const faces = [
    [0, 1, 2],
    [0, 2, 3],
  ];

  const spawnPositions = Array.from({ length: 8 }, (_, slot) => {
    const t = (slot / 8) * Math.PI * 2;
    const radius = Math.max(18, halfSize * 0.55);
    return {
      position: [Math.cos(t) * radius, info.start.y, Math.sin(t) * radius],
      heading: -t + Math.PI / 2,
    };
  });

  return {
    navmesh: {
      vertices,
      faces,
      adjacency: {
        0: [1],
        1: [0],
      },
    },
    spawnPositions,
    startPositions: spawnPositions,
    items: spawnPositions.slice(0, 4).map((spawn, index) => ({
      type: index % 2 === 0 ? 'item' : 'nitro',
      position: spawn.position,
      heading: 0,
    })),
    laps: 1,
  };
}

function buildFallbackTrackData(mapId, type) {
  // Demo course generators (procedural-demo-course.js) for the primary tracks
  try {
    if (mapId === 'glo_circuit') {
      return generateDemoCourseDataOnly(3);
    }
    if (mapId === 'glo_arena') {
      return generateDemoArenaDataOnly();
    }
  } catch (e) {
    console.warn(`[track-data] Demo course gen failed for "${mapId}":`, e.message);
  }

  // Try older procedural generators as secondary fallback
  try {
    if (type === 'arena') {
      const data = generateArenaDataOnly(mapId);
      if (data && data.spawnPositions?.length) {
        return {
          navmesh:        data.navmesh,
          spawnPositions:  data.spawnPositions.map(s => ({ position: [s.x, s.y, s.z], heading: s.heading || 0 })),
          startPositions:  data.spawnPositions.map(s => ({ position: [s.x, s.y, s.z], heading: s.heading || 0 })),
          items:          (data.itemSpawns || []).map(s => ({ type: 'item', position: [s.x, s.y, s.z], heading: 0 })),
          laps: 1,
        };
      }
    } else {
      const data = generateTrackDataOnly(mapId);
      if (data && data.driveline?.length) {
        return {
          driveline:      data.driveline,
          checkpoints:    data.checkpoints,
          startPositions: data.startPositions,
          items:          data.items || [],
          laps:           data.laps ?? 3,
          graph:          data.graph,
        };
      }
    }
  } catch (e) {
    console.warn(`[track-data] Procedural data gen failed for "${mapId}", using legacy fallback:`, e.message);
  }

  // Legacy fallback
  return type === 'arena' ? buildArenaFallback(mapId) : buildRaceFallback(mapId);
}

/**
 * Fetch and cache track-data.json for a given track or arena.
 * Returns null if the file doesn't exist (custom maps, etc).
 */
export async function loadTrackData(mapId, type = 'track') {
  const cacheKey = `${type}:${mapId}`;
  if (cache[cacheKey]) return cache[cacheKey];

  const basePath = type === 'arena'
    ? `/models/stk/arenas/${mapId}/track-data.json`
    : `/models/stk/tracks/${mapId}/track-data.json`;

  try {
    const resp = await fetch(basePath);
    if (!resp.ok) {
      const fallback = buildFallbackTrackData(mapId, type);
      cache[cacheKey] = fallback;
      return fallback;
    }
    const data = await resp.json();
    cache[cacheKey] = data;
    return data;
  } catch {
    const fallback = buildFallbackTrackData(mapId, type);
    cache[cacheKey] = fallback;
    return fallback;
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
