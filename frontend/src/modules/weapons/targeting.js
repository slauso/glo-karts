/**
 * targeting.js - Aiming, lock-on, and homing projectile guidance helpers.
 *
 * Provides:
 *  - Forward-cone target acquisition with sticky target scoring
 *  - Generic lock state progression for HUD reticles
 *  - Predictive intercept helpers for guided projectiles
 *  - Homing flight helpers for client-side visual controllers
 *  - Arc and raycast helpers used by other weapon archetypes
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';

const LOCK_CONE_HALF_ANGLE = Math.PI / 6;
const LOCK_MAX_RANGE = 80;
const LOCK_MIN_RANGE = 5;
const LOCK_ACQUIRE_TIME = 0.35;
const LOCK_LOSE_TIME = 0.6;
const LOCK_STICKY_BONUS = 0.2;

const HOMING_TURN_RATE = 6.0;
const HOMING_SPEED_MIN = 20;
const HOMING_SPEED_MAX = 55;
const HOMING_LIFT_ARC = 4;

export const DEFAULT_LOCK_ON_CONFIG = Object.freeze({
  halfAngle: LOCK_CONE_HALF_ANGLE,
  maxRange: LOCK_MAX_RANGE,
  minRange: LOCK_MIN_RANGE,
  acquireTime: LOCK_ACQUIRE_TIME,
  loseTime: LOCK_LOSE_TIME,
  stickyBonus: LOCK_STICKY_BONUS,
  maxScreenOffsetNorm: 0.56,
  centerBias: 0.82,
  edgePenalty: 1.15,
  minAcquireScale: 0.36,
});

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function normalizeOrFallback(vector, fallback) {
  if (!vector || vector.lengthSquared() < 1e-6) {
    return fallback.clone();
  }
  return vector.normalize();
}

function candidateScore(candidate, myPos, myForward, config, currentTargetId = null) {
  const toTarget = candidate.position.subtract(myPos);
  const distance = toTarget.length();
  if (distance < config.minRange || distance > config.maxRange) {
    return -Infinity;
  }

  const direction = normalizeOrFallback(toTarget, myForward);
  const dot = Vector3.Dot(direction, myForward);
  const angle = Math.acos(Math.min(Math.max(dot, -1), 1));
  if (angle > config.halfAngle) {
    return -Infinity;
  }

  const maxScreenOffsetNorm = Math.max(0.05, Number(config.maxScreenOffsetNorm || 1));
  const screenOffsetNorm = Math.max(0, Number(candidate.screenOffsetNorm || 0));
  if (screenOffsetNorm > maxScreenOffsetNorm) {
    return -Infinity;
  }

  const screenOffsetRatio = clamp01(screenOffsetNorm / maxScreenOffsetNorm);
  const centerWeight = 1 - screenOffsetRatio;
  const acquireScale = Math.max(
    Math.max(0.1, Number(config.minAcquireScale || 0.34)),
    centerWeight * centerWeight,
  );

  let score = dot * 2.7 - distance * 0.026;
  score += centerWeight * Number(config.centerBias || 0.7);
  score -= screenOffsetRatio * Number(config.edgePenalty || 1.35);
  if (candidate.id === currentTargetId) {
    score += config.stickyBonus;
  }
  if (typeof candidate.scoreBias === 'number') {
    score += candidate.scoreBias;
  }
  candidate.screenOffsetRatio = screenOffsetRatio;
  candidate.centerWeight = centerWeight;
  candidate.acquireScale = acquireScale;
  return score;
}

export function createLockState(config = {}) {
  return {
    config: { ...DEFAULT_LOCK_ON_CONFIG, ...config },
    targetId: null,
    lockProgress: 0,
    locked: false,
    loseTimer: 0,
  };
}

export function selectLockOnTarget(myPos, myForward, candidates, config = DEFAULT_LOCK_ON_CONFIG, currentTargetId = null) {
  const resolvedConfig = { ...DEFAULT_LOCK_ON_CONFIG, ...config };
  const forward = normalizeOrFallback(myForward, Vector3.Forward());

  let bestCandidate = null;
  let bestScore = -Infinity;

  for (const candidate of candidates) {
    if (!candidate?.id || !candidate?.position) {
      continue;
    }
    const score = candidateScore(candidate, myPos, forward, resolvedConfig, currentTargetId);
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = { ...candidate, score };
    }
  }

  return bestCandidate;
}

export function tickLockOn(state, myPos, myForward, candidates, dt) {
  const config = { ...DEFAULT_LOCK_ON_CONFIG, ...(state?.config || {}) };
  const forward = normalizeOrFallback(myForward, Vector3.Forward());
  const bestCandidate = selectLockOnTarget(myPos, forward, candidates, config, state.targetId);
  const bestId = bestCandidate?.id || null;

  if (bestId) {
    state.loseTimer = 0;
    const acquireScale = Math.max(0.1, Number(bestCandidate?.acquireScale || 1));
    if (state.targetId === bestId) {
      state.lockProgress = clamp01(state.lockProgress + (dt / Math.max(config.acquireTime, 0.001)) * acquireScale);
    } else {
      state.targetId = bestId;
      state.lockProgress = clamp01(
        Math.max(0, state.lockProgress * 0.3)
        + (dt / Math.max(config.acquireTime, 0.001)) * Math.max(0.2, acquireScale * 0.75),
      );
    }
  } else {
    state.loseTimer += dt;
    state.lockProgress = clamp01(state.lockProgress - dt / Math.max(config.loseTime * 0.62, 0.001));
    if (state.loseTimer > config.loseTime) {
      state.targetId = null;
      state.lockProgress = 0;
    }
  }

  state.locked = state.lockProgress >= 1;

  return {
    candidate: bestCandidate,
    targetId: state.targetId,
    locked: state.locked,
    lockProgress: state.lockProgress,
  };
}

export function findNearestEnemy(pos, enemies, maxRange = 80) {
  let best = null;
  let bestDistance = maxRange;

  for (const enemy of enemies) {
    const distance = Vector3.Distance(pos, enemy.position);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { id: enemy.id, position: enemy.position.clone(), distance };
    }
  }

  return best;
}

export function createHomingFlight(startPos, startVel, speed) {
  const safeSpeed = Math.min(Math.max(speed, HOMING_SPEED_MIN), HOMING_SPEED_MAX);
  const velocity = startVel.lengthSquared() > 1e-6
    ? startVel.normalize().scale(safeSpeed)
    : Vector3.Forward().scale(safeSpeed);

  return {
    position: startPos.clone(),
    velocity,
    speed: safeSpeed,
    age: 0,
  };
}

export function predictInterceptPosition(origin, targetPos, targetVelocity = Vector3.Zero(), projectileSpeed = HOMING_SPEED_MIN, leadScale = 1) {
  const toTarget = targetPos.subtract(origin);
  const distance = toTarget.length();
  const safeSpeed = Math.max(projectileSpeed, 1);
  const leadTime = Math.min(0.85, (distance / safeSpeed) * Math.max(0, leadScale));
  return targetPos.add(targetVelocity.scale(leadTime));
}

export function tickHomingFlight(flight, targetPos, dt) {
  flight.age += dt;

  if (targetPos) {
    const toTarget = targetPos.subtract(flight.position);
    const distance = toTarget.length();

    if (distance > 1) {
      const desiredVelocity = toTarget.normalize().scale(flight.speed);
      const steer = desiredVelocity.subtract(flight.velocity);
      const maxDelta = HOMING_TURN_RATE * flight.speed * dt;

      if (steer.length() > maxDelta) {
        steer.normalize().scaleInPlace(maxDelta);
      }

      flight.velocity.addInPlace(steer);

      const currentSpeed = flight.velocity.length();
      if (currentSpeed > 0.1) {
        flight.velocity.scaleInPlace(flight.speed / currentSpeed);
      }
    }
  }

  flight.position.addInPlace(flight.velocity.scale(dt));
  return flight.position;
}

function quadBezier(p0, p1, p2, t) {
  const invT = 1 - t;
  return p0.scale(invT * invT).add(p1.scale(2 * invT * t)).add(p2.scale(t * t));
}

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

export function tickArcFlight(arc, dt) {
  arc.elapsed += dt;
  const t = Math.min(arc.elapsed / arc.duration, 1);
  const position = quadBezier(arc.p0, arc.p1, arc.p2, t);
  return t >= 1 ? null : position;
}

export function raycastHit(origin, direction, targets, maxRange = 120) {
  let bestHit = null;
  let bestDistance = maxRange;

  for (const target of targets) {
    const toTarget = target.position.subtract(origin);
    const distanceAlongRay = Vector3.Dot(toTarget, direction);
    if (distanceAlongRay < 0 || distanceAlongRay > maxRange) {
      continue;
    }

    const closest = origin.add(direction.scale(distanceAlongRay));
    const offset = Vector3.Distance(closest, target.position);
    const hitRadius = target.radius || 2.5;

    if (offset < hitRadius && distanceAlongRay < bestDistance) {
      bestDistance = distanceAlongRay;
      bestHit = { id: target.id, position: closest.clone(), distance: distanceAlongRay };
    }
  }

  return bestHit;
}
