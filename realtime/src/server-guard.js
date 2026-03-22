/**
 * server-guard.js — Shared server-side anti-abuse utilities (Tasks 2.1–2.4)
 *
 * Provides:
 * - Per-client message rate limiting
 * - Movement sanity checks (max teleport distance per tick)
 * - Pickup proximity validation
 * - Projectile spawn origin validation
 */

import { log } from "./logger.js";

// ── Task 2.2: Message Rate Limiting ──────────────────────────────────────

/** Rolling-window rate limiter per client per message type. */
export class RateLimiter {
  /**
   * @param {Object} limits — { messageType: { max: number, windowMs: number } }
   * Default: 70 messages per 1000ms for "input" (generous for 60Hz),
   *          5 per 1000ms for actions like fireWeapon / pickupItem / hit.
   */
  constructor(limits = {}) {
    this.limits = {
      input:       { max: 70,  windowMs: 1000 },
      fireWeapon:  { max: 5,   windowMs: 1000 },
      pickupItem:  { max: 5,   windowMs: 1000 },
      swapSecondaryWeapon: { max: 8, windowMs: 1000 },
      hit:         { max: 5,   windowMs: 1000 },
      checkpoint:  { max: 3,   windowMs: 5000 },
      ...limits,
    };
    /** Map<sessionId, Map<messageType, number[]>> */
    this._windows = new Map();
    /** Map<sessionId, number> — tracks how many rate-limit violations have been logged per client */
    this._violations = new Map();
  }

  /** Record a message and return true if ALLOWED, false if RATE-LIMITED. */
  allow(sessionId, messageType) {
    const cfg = this.limits[messageType];
    if (!cfg) return true; // no limit defined → allow

    if (!this._windows.has(sessionId)) {
      this._windows.set(sessionId, new Map());
    }
    const client = this._windows.get(sessionId);
    if (!client.has(messageType)) {
      client.set(messageType, []);
    }

    const now = Date.now();
    const window = client.get(messageType);
    // Prune timestamps outside the current window
    const cutoff = now - cfg.windowMs;
    while (window.length > 0 && window[0] < cutoff) window.shift();

    if (window.length >= cfg.max) {
      // Task 2.4.1: Log abnormal message rates (throttled to avoid log spam)
      const count = (this._violations.get(sessionId) || 0) + 1;
      this._violations.set(sessionId, count);
      if (count <= 5 || count % 50 === 0) {
        log('warn', 'rate_limited', { sessionId, messageType, violations: count });
      }
      return false; // rate-limited
    }
    window.push(now);
    return true;
  }

  /** Clean up when a client disconnects. */
  removeClient(sessionId) {
    this._windows.delete(sessionId);
    this._violations.delete(sessionId);
  }
}

// ── Task 2.1: Movement Sanity Checks ────────────────────────────────────

/** Maximum allowed position change per server tick (~16ms at 60Hz). */
const MAX_DELTA_PER_TICK = 25;          // units (~40 m/s at 60Hz)
const MAX_Y_VALUE        = 200;         // reasonable ceiling
const MIN_Y_VALUE        = -50;         // reasonable floor
const MAX_COORD          = 75;          // default arena boundary guard

/**
 * Clamp a client-reported position to sane bounds and reject teleportation.
 * Returns the clamped position { x, y, z } or null if the input is rejected.
 * @param {{ x: number, y: number, z: number }} prev — last accepted position
 * @param {{ x: number, y: number, z: number }} next — client-reported position
 */
export function sanitizePosition(prev, next, maxCoord = MAX_COORD) {
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const dz = next.z - prev.z;
  const distSq = dx * dx + dy * dy + dz * dz;

  // Reject clear teleportation
  if (distSq > MAX_DELTA_PER_TICK * MAX_DELTA_PER_TICK) {
    return null; // caller should keep previous position
  }

  // Clamp to arena bounds
  return {
    x: Math.max(-maxCoord, Math.min(maxCoord, next.x)),
    y: Math.max(MIN_Y_VALUE, Math.min(MAX_Y_VALUE, next.y)),
    z: Math.max(-maxCoord, Math.min(maxCoord, next.z)),
  };
}

// ── Task 2.3: Pickup Proximity Validation ───────────────────────────────

const PICKUP_RANGE_SQ = 64; // 8 units squared — generous to account for client prediction

function _isWithinPickupRangePoint(position, entity) {
  const dx = position.x - entity.x;
  const dy = position.y - entity.y;
  const dz = position.z - entity.z;
  return (dx * dx + dy * dy + dz * dz) < PICKUP_RANGE_SQ;
}

/**
 * Return true if the player is close enough to an entity to pick it up.
 */
export function isWithinPickupRange(player, entity) {
  return _isWithinPickupRangePoint(player, entity);
}

export function isWithinPickupRangeWithClientPosition(player, entity, nextPosition) {
  if (isWithinPickupRange(player, entity)) return true;
  if (!nextPosition) return false;

  const sanitized = sanitizePosition(player, nextPosition);
  if (!sanitized) return false;
  return _isWithinPickupRangePoint(sanitized, entity);
}

// ── Task 2.3.4: Projectile Spawn Origin Validation ─────────────────────

const MAX_SPAWN_OFFSET = 8; // covers active zone/projectile spawn offsets in combat.js while keeping an authoritative bound

/**
 * Return true if a projectile spawn position is within the expected offset
 * from the owning player's authoritative position.
 */
export function isValidProjectileOrigin(player, projectile) {
  const dx = projectile.x - player.x;
  const dy = projectile.y - player.y;
  const dz = projectile.z - player.z;
  return (dx * dx + dy * dy + dz * dz) <= MAX_SPAWN_OFFSET * MAX_SPAWN_OFFSET;
}
