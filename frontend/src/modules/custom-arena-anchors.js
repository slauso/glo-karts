import { GRID_SIZE } from './track-placement.js';
import { STRAIGHT_CONNECTOR_SPAN, resolveCustomArenaSegmentSpec, getCustomArenaBasePorts } from './custom-arena-segments.js';

const CONNECTOR_SAMPLE_EPSILON = 0.16;

export const CUSTOM_ARENA_UNIFORM_SCALE = GRID_SIZE / STRAIGHT_CONNECTOR_SPAN;

export function normalizeQuarterTurnSteps(rotationDeg = 0) {
  return Math.round((((Number(rotationDeg) % 360) + 360) % 360) / 90) % 4;
}

export function rotateXZ(x, z, rotationDeg = 0) {
  const steps = normalizeQuarterTurnSteps(rotationDeg);
  if (steps === 0) return { x, z };
  if (steps === 1) return { x: -z, z: x };
  if (steps === 2) return { x: -x, z: -z };
  return { x: z, z: -x };
}

export function computeCustomArenaPortAnchors(type, vertices, min, max) {
  const spec = resolveCustomArenaSegmentSpec(type);
  const key = spec?.canonicalKey || String(type || 'straight').trim();
  const ports = getCustomArenaBasePorts(key);
  if (!ports.length || !Array.isArray(vertices) || !vertices.length || !min || !max) return {};

  const out = {};
  for (const dir of ports) {
    let samples;
    if (dir === 0) samples = vertices.filter((vertex) => Math.abs(vertex.z - min.z) < CONNECTOR_SAMPLE_EPSILON);
    else if (dir === 2) samples = vertices.filter((vertex) => Math.abs(vertex.z - max.z) < CONNECTOR_SAMPLE_EPSILON);
    else if (dir === 1) samples = vertices.filter((vertex) => Math.abs(vertex.x - max.x) < CONNECTOR_SAMPLE_EPSILON);
    else samples = vertices.filter((vertex) => Math.abs(vertex.x - min.x) < CONNECTOR_SAMPLE_EPSILON);

    if (!samples.length) continue;
    const avg = samples.reduce((acc, vertex) => ({
      x: acc.x + vertex.x,
      y: acc.y + vertex.y,
      z: acc.z + vertex.z,
    }), { x: 0, y: 0, z: 0 });
    out[dir] = {
      x: avg.x / samples.length,
      y: avg.y / samples.length,
      z: avg.z / samples.length,
    };
  }

  return out;
}

export function createFallbackPortAnchors(type, width, length, y = 0) {
  const halfWidth = Number(width || 0) * 0.5;
  const halfLength = Number(length || 0) * 0.5;
  const out = {};
  for (const dir of getCustomArenaBasePorts(type)) {
    if (dir === 0) out[dir] = { x: 0, y, z: -halfLength };
    else if (dir === 2) out[dir] = { x: 0, y, z: halfLength };
    else if (dir === 1) out[dir] = { x: halfWidth, y, z: 0 };
    else out[dir] = { x: -halfWidth, y, z: 0 };
  }
  return out;
}

export function getSegmentAnchorVariants(type, rotationDeg, portAnchors, scale = 1) {
  if (!portAnchors) return [];
  const steps = normalizeQuarterTurnSteps(rotationDeg);
  return Object.entries(portAnchors).map(([baseDirStr, anchor]) => {
    const baseDir = Number(baseDirStr);
    const dir = (baseDir + steps) % 4;
    const rotated = rotateXZ((anchor?.x || 0) * scale, (anchor?.z || 0) * scale, rotationDeg);
    return {
      baseDir,
      dir,
      local: {
        x: rotated.x,
        y: (anchor?.y || 0) * scale,
        z: rotated.z,
      },
      raw: anchor,
    };
  });
}

export function getSegmentWorldConnectors({ entityId, type, rotationDeg = 0, position, portAnchors, scale = 1 }) {
  const origin = position || { x: 0, y: 0, z: 0 };
  return getSegmentAnchorVariants(type, rotationDeg, portAnchors, scale).map((anchor) => ({
    entityId,
    pieceKey: type,
    dir: anchor.dir,
    baseDir: anchor.baseDir,
    local: anchor.local,
    position: {
      x: Number(origin.x || 0) + anchor.local.x,
      y: Number(origin.y || 0) + anchor.local.y,
      z: Number(origin.z || 0) + anchor.local.z,
    },
  }));
}