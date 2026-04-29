/**
 * combat-runtime.js — Pure, dependency-free runtime helpers for the
 * Phase 1 combat overlays (pickups + surface modifiers).
 *
 * This module is consumed by:
 *   - play-main.js              (single-player playtest in the studio)
 *   - StudioRoom.js (server)    (authoritative 8-player runtime)
 *   - smoke tests               (node-only validation)
 *
 * Design tenets:
 *   - No three.js / cannon-es / colyseus imports. Plain JS only.
 *   - All distances in *world units* — the caller decides which unit
 *     system that is (mm in client / studio, server uses same encoding).
 *   - Pickup state is { id, ready, respawnAt }. A respawned pickup at
 *     time T satisfies `T >= respawnAt && ready`.
 *   - Active effects are short-lived per-kart: { kind, until }.
 */

import { TILE, buildRuntimeRegistry } from './segments.js';
import { WORLD_UNITS_PER_M } from './units.js';

// World tile = segment metres × world conversion.
const WORLD_TILE = TILE * WORLD_UNITS_PER_M;

/** Build a per-overlay state map from a list of placements.
 *  Each entry: { id, key, kind, payload, effect, worldX, worldZ, rot,
 *                ready, respawnAt, radius }
 *  Pickups start ready; modifiers/hazards have no respawn (they tick on
 *  every kart contact). Coords + radii in WORLD UNITS (mm).
 */
export function buildCombatState(placements) {
  const reg = buildRuntimeRegistry(placements, WORLD_TILE);
  const state = new Map();
  for (const r of reg) {
    // Runtime radius is authored in segment metres (e.g. TILE * 0.45);
    // convert to world units. Effect overlays default to half-cell.
    const authoredRadius = typeof r.radius === 'number'
      ? r.radius * WORLD_UNITS_PER_M
      : (r.kind === 'effect' ? WORLD_TILE * 0.5 : WORLD_TILE * 0.4);
    state.set(r.id, {
      id: r.id,
      key: r.key,
      kind: r.kind,
      payload: r.payload,
      effect: r.effect,
      strength: r.strength,
      durationMs: r.durationMs,
      amount: r.amount,
      amountPerSec: r.amountPerSec,
      respawnMs: r.respawnMs,
      worldX: r.worldX,
      worldZ: r.worldZ,
      rot: r.rot,
      radius: authoredRadius,
      ready: true,
      respawnAt: 0,
    });
  }
  return state;
}

/** Test whether a kart at (kx, kz) overlaps a circular trigger of radius
 *  `radius` centred on (cx, cz). Cheap squared-distance check. */
export function withinTrigger(kx, kz, cx, cz, radius) {
  const dx = kx - cx, dz = kz - cz;
  return (dx * dx + dz * dz) <= radius * radius;
}

/**
 * Sweep all overlays once for a single kart at (kx, kz) at time `nowMs`.
 * Returns a list of events fired this tick:
 *   { type: 'pickup', id, key, payload, amount }
 *   { type: 'effect', id, key, effect, strength, durationMs, amount, amountPerSec }
 *
 * Pickup state is mutated in-place (consumed → respawnAt set). Effects
 * never mutate state — the caller is responsible for stacking timers
 * onto the kart's own active-effect list to avoid double-counting per
 * frame.
 */
export function sweepKart(state, kx, kz, nowMs) {
  const events = [];
  for (const e of state.values()) {
    if (!withinTrigger(kx, kz, e.worldX, e.worldZ, e.radius)) continue;
    if (e.kind === 'pickup') {
      if (!e.ready) continue;
      if (nowMs < e.respawnAt) continue;
      e.ready = false;
      e.respawnAt = nowMs + (e.respawnMs || 4000);
      events.push({
        type: 'pickup', id: e.id, key: e.key,
        payload: e.payload, amount: e.amount,
      });
    } else if (e.kind === 'effect') {
      events.push({
        type: 'effect', id: e.id, key: e.key,
        effect: e.effect, strength: e.strength,
        durationMs: e.durationMs, amount: e.amount,
        amountPerSec: e.amountPerSec,
      });
    }
  }
  return events;
}

/** Re-arm any pickups whose respawn cooldown has elapsed.
 *  Returns a list of { id } that just respawned (so callers can refresh
 *  visuals or broadcast a "ready" event). */
export function tickRespawns(state, nowMs) {
  const ready = [];
  for (const e of state.values()) {
    if (e.kind !== 'pickup') continue;
    if (e.ready) continue;
    if (nowMs >= e.respawnAt) {
      e.ready = true;
      ready.push({ id: e.id, key: e.key });
    }
  }
  return ready;
}

/** Convenience snapshot for diff/serialisation: bytes-per-pickup ≈ 9. */
export function snapshotPickups(state) {
  const out = [];
  for (const e of state.values()) {
    if (e.kind !== 'pickup') continue;
    out.push({ id: e.id, ready: e.ready, respawnAt: e.respawnAt });
  }
  return out;
}
