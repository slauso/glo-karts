/**
 * targeting.js — Aiming, lock-on, and homing projectile guidance system.
 *
 * Provides:
 *  - Forward-cone target acquisition (lock-on reticle)
 *  - Nearest-enemy auto-target for homing weapons
 *  - Bezier-curved homing flight path for guided projectiles
 *  - Raycast-forward instant-hit for beam/railgun weapons
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';

// ── Lock-on config ──────────────────────────────────────────────────────────
const LOCK_CONE_HALF_ANGLE = Math.PI / 6;  // 30° half-cone
const LOCK_MAX_RANGE       = 80;
const LOCK_MIN_RANGE       = 5;
const LOCK_ACQUIRE_TIME    = 0.35;  // seconds to acquire lock
const LOCK_LOSE_TIME       = 0.6;   // seconds to lose lock when out of cone

// ── Homing flight config ────────────────────────────────────────────────────
const HOMING_TURN_RATE     = 6.0;   // radians/sec max steer
const HOMING_SPEED_MIN     = 20;
const HOMING_SPEED_MAX     = 55;
const HOMING_LIFT_ARC      = 4;     // bezier control-point lift

// ═══════════════════════════════════════════════════════════════════════════
// ── Lock-on Targeting ──────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a per-player lock-on tracker.
 */
export function createLockState() {
  return {
    targetId:     null,
    lockProgress: 0,     // 0→1, full lock at 1
    locked:       false,
    loseTimer:    0,
  };
}

/**
 * Tick lock-on state.
 *
 * @param {ReturnType<typeof createLockState>} state
 * @param {Vector3} myPos       Player kart world position
 * @param {Vector3} myForward   Player kart forward direction (normalized)
 * @param {Array<{id: string, position: Vector3}>} candidates  Visible enemy karts
 * @param {number}  dt
 * @returns {{ targetId: string|null, locked: boolean, lockProgress: number }}
 */
export function tickLockOn(state, myPos, myForward, candidates, dt) {
  // Find best candidate in cone
  let bestId   = null;
  let bestDist = Infinity;

  for (const c of candidates) {
    const toTarget = c.position.subtract(myPos);
    const dist = toTarget.length();
    if (dist < LOCK_MIN_RANGE || dist > LOCK_MAX_RANGE) continue;

    const dir = toTarget.normalize();
    const dot = Vector3.Dot(dir, myForward);
    const angle = Math.acos(Math.min(Math.max(dot, -1), 1));

    if (angle < LOCK_CONE_HALF_ANGLE && dist < bestDist) {
      bestDist = dist;
      bestId   = c.id;
    }
  }

  if (bestId) {
    state.loseTimer = 0;
    if (state.targetId === bestId) {
      state.lockProgress = Math.min(state.lockProgress + dt / LOCK_ACQUIRE_TIME, 1);
    } else {
      state.targetId     = bestId;
      state.lockProgress = dt / LOCK_ACQUIRE_TIME;
    }
  } else {
    state.loseTimer += dt;
    if (state.loseTimer > LOCK_LOSE_TIME) {
      state.targetId     = null;
      state.lockProgress = 0;
    }
  }

  state.locked = state.lockProgress >= 1;

  return {
    targetId:     state.targetId,
    locked:       state.locked,
    lockProgress: state.lockProgress,
  };
}

/**
 * Find the nearest enemy to a position (no cone required).
 * Used for auto-aim weapons (thunderstrike, homing missile).
 *
 * @param {Vector3} pos
 * @param {Array<{id: string, position: Vector3}>} enemies
 * @param {number} [maxRange=80]
 * @returns {{ id: string, position: Vector3, distance: number }|null}
 */
export function findNearestEnemy(pos, enemies, maxRange = 80) {
  let best = null;
  let bestDist = maxRange;

  for (const e of enemies) {
    const d = Vector3.Distance(pos, e.position);
    if (d < bestDist) {
      bestDist = d;
      best = { id: e.id, position: e.position.clone(), distance: d };
    }
  }
  return best;
}

// ═══════════════════════════════════════════════════════════════════════════
// ── Homing Guidance ────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a homing projectile flight controller.
 *
 * @param {Vector3} startPos
 * @param {Vector3} startVel  Initial velocity (direction * speed)
 * @param {number}  speed     Desired flight speed
 * @returns {object} Mutable flight state
 */
export function createHomingFlight(startPos, startVel, speed) {
  return {
    position:  startPos.clone(),
    velocity:  startVel.normalize().scale(Math.max(speed, HOMING_SPEED_MIN)),
    speed:     Math.min(Math.max(speed, HOMING_SPEED_MIN), HOMING_SPEED_MAX),
    age:       0,
  };
}

/**
 * Tick the homing flight toward a target position.
 *
 * @param {ReturnType<typeof createHomingFlight>} flight
 * @param {Vector3|null} targetPos  Current target world position (null = fly straight)
 * @param {number} dt
 * @returns {Vector3} Updated world position
 */
export function tickHomingFlight(flight, targetPos, dt) {
  flight.age += dt;

  if (targetPos) {
    const toTarget = targetPos.subtract(flight.position);
    const dist = toTarget.length();

    if (dist > 1) {
      const desired = toTarget.normalize().scale(flight.speed);
      const steer   = desired.subtract(flight.velocity);
      const maxDelta = HOMING_TURN_RATE * flight.speed * dt;

      if (steer.length() > maxDelta) {
        steer.normalize().scaleInPlace(maxDelta);
      }

      flight.velocity.addInPlace(steer);

      // Maintain constant speed
      const curSpeed = flight.velocity.length();
      if (curSpeed > 0.1) {
        flight.velocity.scaleInPlace(flight.speed / curSpeed);
      }
    }
  }

  flight.position.addInPlace(flight.velocity.scale(dt));
  return flight.position;
}

// ═══════════════════════════════════════════════════════════════════════════
// ── Bezier Arc (Meteor, Thunderstrike drop) ────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute a quadratic Bezier point.
 * @param {Vector3} p0 Start
 * @param {Vector3} p1 Control
 * @param {Vector3} p2 End
 * @param {number}  t  0→1
 */
function quadBezier(p0, p1, p2, t) {
  const it = 1 - t;
  return p0.scale(it * it).add(p1.scale(2 * it * t)).add(p2.scale(t * t));
}

/**
 * Create a Bezier arc flight from a spawn point to a target on the ground.
 * Used for meteor/thunderstrike drop-from-sky animations.
 *
 * @param {Vector3} start   Launch position
 * @param {Vector3} target  Impact position on ground
 * @param {number}  arcHeight  Peak height above midpoint
 * @param {number}  duration   Seconds to traverse
 */
export function createArcFlight(start, target, arcHeight = 30, duration = 1.0) {
  const mid = Vector3.Lerp(start, target, 0.5);
  mid.y += arcHeight + HOMING_LIFT_ARC;

  return {
    p0: start.clone(),
    p1: mid,
    p2: target.clone(),
    duration,
    elapsed: 0,
  };
}

/**
 * Tick the arc and return current position.  Returns null when arc is complete.
 *
 * @param {ReturnType<typeof createArcFlight>} arc
 * @param {number} dt
 * @returns {Vector3|null}
 */
export function tickArcFlight(arc, dt) {
  arc.elapsed += dt;
  const t = Math.min(arc.elapsed / arc.duration, 1);
  const pos = quadBezier(arc.p0, arc.p1, arc.p2, t);
  return t >= 1 ? null : pos;
}

// ═══════════════════════════════════════════════════════════════════════════
// ── Instant Raycast Hit (Plasma Railgun, etc.) ─────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Perform a forward raycast to find the first enemy hit in a straight line.
 *
 * @param {Vector3} origin     Fire position
 * @param {Vector3} direction  Normalized fire direction
 * @param {Array<{id: string, position: Vector3, radius?: number}>} targets
 * @param {number}  [maxRange=120]
 * @returns {{ id: string, position: Vector3, distance: number }|null}
 */
export function raycastHit(origin, direction, targets, maxRange = 120) {
  let bestHit  = null;
  let bestDist = maxRange;

  for (const t of targets) {
    const toTarget = t.position.subtract(origin);
    const dot = Vector3.Dot(toTarget, direction);
    if (dot < 0 || dot > maxRange) continue;

    // Closest point on ray to target centre
    const closest = origin.add(direction.scale(dot));
    const offset  = Vector3.Distance(closest, t.position);
    const hitRadius = t.radius || 2.5;

    if (offset < hitRadius && dot < bestDist) {
      bestDist = dot;
      bestHit  = { id: t.id, position: closest.clone(), distance: dot };
    }
  }
  return bestHit;
}

/**
 * Find all enemies within an AOE radius (shockwave, frost nova, EMP).
 *
 * @param {Vector3} centre
 * @param {number}  radius
 * @param {Array<{id: string, position: Vector3}>} targets
 * @returns {Array<{id: string, position: Vector3, distance: number}>}
 */
export function aoeTargets(centre, radius, targets) {
  const hits = [];
  for (const t of targets) {
    const d = Vector3.Distance(centre, t.position);
    if (d <= radius) {
      hits.push({ id: t.id, position: t.position.clone(), distance: d });
    }
  }
  return hits;
}
