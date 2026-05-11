/**
 * track-loader.js — Build a cannon-es world from an editor3 Track JSON.
 *
 * Accepts either:
 *   1) Wire format          : { v:1, name?, placements:[{k,x,z,r}, ...] }
 *   2) Backend envelope     : { track: { v:1, ... }, decor?, meta? }
 *   3) Raw placements array : [{k,x,z,r}, ...]
 *
 * Returns the same body list installed on the world plus a list of computed
 * spawn poses (world units = mm) for kart placement. Spawn poses are derived
 * from any placement whose segment def has `isSpawn: true`. If none exist we
 * fall back to the first placement at the standard kart hover height.
 */
import * as CANNON from 'cannon-es';
import { buildSegmentBody, getDrivableTopY, SEGMENT_SCALE } from '../../../frontend/src/editor3/segment-physics.js';
import { SEGMENTS, TILE } from '../../../frontend/src/editor3/segments.js';

const S = SEGMENT_SCALE;
const KART_HOVER_M = 1.5; // metres above drivable surface for spawn

/** Normalize any of the supported input shapes into a placements array. */
function extractPlacements(input) {
  if (Array.isArray(input)) return input;
  if (input?.placements && Array.isArray(input.placements)) return input.placements;
  if (input?.track?.placements && Array.isArray(input.track.placements)) return input.track.placements;
  return [];
}

/**
 * Build static collider bodies for every placement and add them to `world`.
 * @param {CANNON.World} world
 * @param {*} trackData See module doc for accepted shapes.
 * @returns {{
 *   bodies: CANNON.Body[],
 *   spawns: Array<{x:number,y:number,z:number,heading:number}>,
 *   finish: { x:number, y:number, z:number, heading:number }|null,
 *   pickups: Array<{ id:string, x:number, y:number, z:number, kind:string, radius:number, respawnMs:number, payload:string }>,
 * }}
 */
export function buildWorldFromTrackData(world, trackData) {
  const placements = extractPlacements(trackData);
  const bodies = [];
  const spawns = [];
  const pickups = [];
  let finish = null;

  // Phase A2: collect parity diagnostics (unknown / malformed placements).
  const unknownSegments = new Set();
  let skippedMalformed = 0;

  let pickupSeq = 0;
  for (const p of placements) {
    if (!p || typeof p.k !== 'string') { skippedMalformed += 1; continue; }
    const def = SEGMENTS[p.k];
    if (!def) { unknownSegments.add(p.k); continue; }
    const worldPos = {
      x: (p.x ?? 0) * TILE * S,
      y: 0,
      z: (p.z ?? 0) * TILE * S,
    };
    const worldRotY = ((p.r ?? 0) % 4) * (Math.PI / 2);
    const body = buildSegmentBody(p.k, worldPos, worldRotY);
    if (body) {
      // Apply the world's ground material so the wheel/ground contact pair
      // (defined by Editor3RaceRoom.makeWorld) is used for friction.
      if (world.__groundMat) body.material = world.__groundMat;
      world.addBody(body);
      bodies.push(body);
    }
    if (def.isSpawn) {
      spawns.push({
        x: worldPos.x,
        y: getDrivableTopY(p.k) + KART_HOVER_M * S,
        z: worldPos.z,
        heading: worldRotY,
      });
    }
    if (def.isFinish && !finish) {
      finish = { x: worldPos.x, y: worldPos.y, z: worldPos.z, heading: worldRotY };
    }
    // Combat overlays — item boxes / pickups defined in segments.js as
    // `runtime: { kind: 'pickup', payload, respawnMs, radius }`.
    if (def.runtime?.kind === 'pickup') {
      pickups.push({
        id: `pickup_${pickupSeq++}`,
        x: worldPos.x,
        y: getDrivableTopY(p.k) + 1.0 * S,
        z: worldPos.z,
        kind: p.k,
        payload: def.runtime.payload || 'weapon_random',
        radius: (def.runtime.radius || 14) * S,
        respawnMs: def.runtime.respawnMs || 5000,
      });
    }
  }

  // Fallback: no explicit spawn — drop karts on the first placement.
  if (spawns.length === 0 && placements.length > 0) {
    const first = placements[0];
    spawns.push({
      x: (first.x ?? 0) * TILE * S,
      y: getDrivableTopY(first.k) + KART_HOVER_M * S,
      z: (first.z ?? 0) * TILE * S,
      heading: ((first.r ?? 0) % 4) * (Math.PI / 2),
    });
  }

  return {
    bodies, spawns, finish, pickups,
    diagnostics: {
      placementsTotal: placements.length,
      placementsApplied: bodies.length,
      unknownSegments: [...unknownSegments],
      skippedMalformed,
      hasSpawn: spawns.length > 0,
      hasFinish: !!finish,
    },
  };
}

/**
 * Phase A3 — lightweight pre-flight validator. Walks the placements list
 * and reports whether the track is structurally raceable: at least one
 * known segment, at least one spawn (explicit or fallback), at least one
 * finish/lap-trigger. Returns { ok, errors:[], warnings:[] } so callers
 * can refuse to start a match with an explanatory matchError.
 */
export function validateTrackData(trackData) {
  const errors = [];
  const warnings = [];
  const placements = extractPlacements(trackData);
  if (!placements.length) {
    errors.push('Track has no placements.');
    return { ok: false, errors, warnings };
  }
  let known = 0;
  let hasSpawn = false;
  let hasFinish = false;
  const unknownSegments = new Set();
  for (const p of placements) {
    if (!p || typeof p.k !== 'string') continue;
    const def = SEGMENTS[p.k];
    if (!def) { unknownSegments.add(p.k); continue; }
    known += 1;
    if (def.isSpawn) hasSpawn = true;
    if (def.isFinish) hasFinish = true;
  }
  if (known === 0) errors.push('Track contains zero recognised segments.');
  if (!hasSpawn) warnings.push('No explicit spawn segment; falling back to first placement.');
  if (!hasFinish) warnings.push('No finish/lap-trigger segment; race cannot complete.');
  if (unknownSegments.size) {
    warnings.push(`Unknown segment keys: ${[...unknownSegments].join(', ')}`);
  }
  return { ok: errors.length === 0, errors, warnings, unknownSegments: [...unknownSegments] };
}

/**
 * Build a tiny default arena (used when no track is supplied). Mirrors the
 * spike's 6×6 tile floor so existing smoke clients keep working.
 */
export function buildDefaultArena(world) {
  const HALF = 3 * TILE * S; // 6×6 tiles, centred on origin
  const ground = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC });
  ground.addShape(new CANNON.Box(new CANNON.Vec3(HALF, 0.5 * S, HALF)));
  ground.position.set(0, -0.5 * S, 0);
  world.addBody(ground);
  return {
    bodies: [ground],
    spawns: [{ x: 0, y: 1.5 * S, z: 0, heading: 0 }],
    finish: null,
    pickups: [],
  };
}
