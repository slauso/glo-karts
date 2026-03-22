/**
 * track-data-loader.js — Runtime loader for extracted STK track auxiliary data.
 *
 * Loads the track-data.json bundles produced by stk_extract_track_data.py.
 * Provides access to driveline, checkpoints, start grid, navmesh, and items.
 */

import { getAddonParams, getTrackInfo } from './track-data.js';
import { CUSTOM_TRACK_ID } from './content-registry.js';
import { generateTrackDataOnly } from './procedural-track-gen.js';
import { generateArenaDataOnly } from './procedural-arena-gen.js';
import { generateDemoArenaDataOnly } from './procedural-demo-course.js';
import { SEGMENT_TYPES } from './track-editor.js';
import { currentMapDefinition } from './babylon-track.js';

const cache = {};

function readImportedCustomTrack() {
  try {
    const raw = sessionStorage.getItem('customTrackData');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function toPointArray(source = []) {
  return source
    .map((entry) => entry?.position || entry)
    .filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.z));
}

function expandLoopPoints(points, defaultWidth = 12) {
  if (points.length === 0) return [];
  if (points.length === 1) {
    return [{ center: [points[0].x, points[0].y || 0, points[0].z], width: defaultWidth }];
  }

  const expanded = [];
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const subdivisions = 4;
    for (let step = 0; step < subdivisions; step += 1) {
      const t = step / subdivisions;
      expanded.push({
        center: [
          current.x + (next.x - current.x) * t,
          (current.y || 0) + ((next.y || 0) - (current.y || 0)) * t,
          current.z + (next.z - current.z) * t,
        ],
        width: current.width || defaultWidth,
      });
    }
  }
  return expanded;
}

function findNearestQuadIndex(driveline, point) {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < driveline.length; index += 1) {
    const center = driveline[index].center;
    const dx = center[0] - point.x;
    const dz = center[2] - point.z;
    const distance = dx * dx + dz * dz;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function convertCustomTrackData(customTrack) {
  const checkpointPoints = toPointArray(customTrack?.checkpoints);
  const segmentPoints = (customTrack?.segments || [])
    .filter((segment) => segment?.position)
    .map((segment) => ({
      x: segment.position.x,
      y: segment.position.y || 0,
      z: segment.position.z,
      width: SEGMENT_TYPES[segment.type]?.width || 12,
    }));
  const sourcePoints = checkpointPoints.length >= 3 ? checkpointPoints : segmentPoints;

  if (!sourcePoints.length) {
    return buildFallbackTrackData('test_box', 'track');
  }

  const averageWidth = segmentPoints.length
    ? segmentPoints.reduce((sum, point) => sum + (point.width || 12), 0) / segmentPoints.length
    : 12;
  const driveline = expandLoopPoints(sourcePoints, averageWidth);

  const checkpoints = (checkpointPoints.length ? checkpointPoints : sourcePoints.filter((_, index) => index % Math.max(1, Math.floor(sourcePoints.length / 4)) === 0))
    .map((point, checkpointIndex) => {
      const quadIndex = findNearestQuadIndex(driveline, point);
      return {
        quadIndex,
        isLapLine: checkpointIndex === 0,
        center: driveline[quadIndex].center,
        width: point.width || driveline[quadIndex].width || averageWidth,
      };
    });

  const startPositions = Array.isArray(customTrack?.startPositions) && customTrack.startPositions.length
    ? customTrack.startPositions.map((spawn) => ({
        position: [spawn.position.x, spawn.position.y, spawn.position.z],
        heading: spawn.heading || 0,
      }))
    : [{ position: [sourcePoints[0].x, (sourcePoints[0].y || 0) + 1, sourcePoints[0].z], heading: 0 }];

  const items = Array.isArray(customTrack?.obstacles)
    ? customTrack.obstacles
        .filter((obstacle) => obstacle?.position)
        .map((obstacle) => ({
          type: obstacle.type === 'boost_pad' ? 'nitro' : 'item',
          position: [obstacle.position.x, obstacle.position.y || 0.5, obstacle.position.z],
          heading: 0,
        }))
    : [];

  return {
    name: customTrack?.name || 'Imported Track',
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

  // Use the auto-generated map definition if available
  if (currentMapDefinition) {
    console.warn(`[track-data] Using auto-generated MapDefinition for "${mapId}"`);
    return currentMapDefinition;
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

  if (type === 'track' && mapId === CUSTOM_TRACK_ID) {
    const importedTrack = readImportedCustomTrack();
    const data = convertCustomTrackData(importedTrack);
    cache[cacheKey] = data;
    return data;
  }

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
