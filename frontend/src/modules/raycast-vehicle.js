/**
 * raycast-vehicle.js — Force-based raycast vehicle suspension system.
 *
 * Adapted from https://github.com/RaggarDK/ArcadeRaycastVehicle
 * (Babylon.js Havok V2 arcade raycast vehicle by RaggarDK).
 *
 * Applies real physics forces via body.applyForce() at each wheel contact
 * point — suspension spring-damper, anti-roll bars, and predictive landing.
 *
 * This module handles PHYSICS ONLY (forces on the rigid body).
 * Visual wheel positioning remains in kart-entity.js / kart-physics.js.
 */

import { Vector3, Quaternion, PhysicsRaycastResult } from '@babylonjs/core';

// ── Shared temp vectors (avoids per-frame allocation) ───────────────────────
const _t1 = new Vector3();
const _t2 = new Vector3();

// ── Utility ─────────────────────────────────────────────────────────────────

function clampNumber(num, min, max) {
  return Math.max(Math.min(num, Math.max(min, max)), Math.min(min, max));
}

/**
 * Compute body velocity at a specific world point, accounting for angular
 * velocity contribution via cross product.
 */
function getBodyVelocityAtPoint(body, point) {
  const r = point.subtract(body.transformNode.position);
  const angVel = body.getAngularVelocity();
  const res = Vector3.Cross(angVel, r);
  res.addInPlace(body.getLinearVelocity());
  return res;
}

// ═══════════════════════════════════════════════════════════════════════════
//  RaycastWheel
// ═══════════════════════════════════════════════════════════════════════════

export class RaycastWheel {
  /**
   * @param {object} options
   * @param {Vector3} options.positionLocal        Local connection point on chassis
   * @param {number}  [options.suspensionRestLength=0.6]  Max suspension drop
   * @param {number}  [options.suspensionForce=12000]     Spring stiffness
   * @param {number}  [options.suspensionDamping=0.12]    Damping ratio [0–1]
   * @param {number}  [options.radius=0.2]                Visual wheel radius
   * @param {Vector3} [options.suspensionAxisLocal]       Spring direction (default: down)
   */
  constructor(options) {
    this.positionLocal = options.positionLocal.clone();
    this.positionWorld = new Vector3();

    this.suspensionAxisLocal = options.suspensionAxisLocal?.clone()
      || new Vector3(0, -1, 0);
    this.suspensionAxisWorld = new Vector3();

    this.suspensionRestLength = options.suspensionRestLength ?? 0.6;
    this.suspensionForce      = options.suspensionForce ?? 12000;
    this.suspensionDamping    = options.suspensionDamping ?? 0.12;
    this.prevSuspensionLength = 0;
    this.suspensionLength     = 0;

    this.radius = options.radius ?? 0.2;

    this.hitDistance = 0;
    this.hitNormal  = new Vector3();
    this.hitPoint   = new Vector3();
    this.inContact  = false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  RaycastVehicle
// ═══════════════════════════════════════════════════════════════════════════

export class RaycastVehicle {
  /**
   * @param {import('@babylonjs/core').PhysicsBody} body
   * @param {object} havokPlugin       HavokPlugin instance
   * @param {object} [opts]
   * @param {number} [opts.rayCollideWith]  Collision mask for raycasts (e.g. LAYER.TRACK)
   * @param {number} [opts.gravity=-20]     Game gravity magnitude (positive = downward)
   */
  constructor(body, havokPlugin, opts = {}) {
    this.body         = body;
    this.havokPlugin  = havokPlugin;
    this.wheels       = [];
    this.antiRollAxles = [];

    this.nWheelsOnGround = 0;

    // Predictive landing
    this.numberOfFramesToPredict = 60;
    this.predictionRatio         = 0.6;

    // Raycast collision filter (default: detect everything)
    this._rayCollideWith = opts.rayCollideWith ?? undefined;
    this._gravity        = opts.gravity ?? 20; // magnitude, applied as -Y

    // Reusable raycast result
    this._rayResult = new PhysicsRaycastResult();
  }

  addWheel(wheel) {
    this.wheels.push(wheel);
  }

  addAntiRollAxle(axle) {
    this.antiRollAxles.push(axle);
  }

  // ── Main per-frame update ───────────────────────────────────────────────

  update() {
    if (!this.body || !this.havokPlugin) return;

    this.body.transformNode.computeWorldMatrix(true);
    this.nWheelsOnGround = 0;

    for (const wheel of this.wheels) {
      this._updateWheelTransform(wheel);
      this._updateWheelRaycast(wheel);
      this._updateWheelSuspension(wheel);
    }

    this._updateAntiRoll();
    this._updatePredictiveLanding();
  }

  // ── Per-wheel pipeline ──────────────────────────────────────────────────

  /** Transform local wheel position to world space */
  _updateWheelTransform(wheel) {
    Vector3.TransformCoordinatesToRef(
      wheel.positionLocal,
      this.body.transformNode.getWorldMatrix(),
      wheel.positionWorld,
    );
    Vector3.TransformNormalToRef(
      wheel.suspensionAxisLocal,
      this.body.transformNode.getWorldMatrix(),
      wheel.suspensionAxisWorld,
    );
  }

  /** Cast ray from wheel position downward by suspensionRestLength */
  _updateWheelRaycast(wheel) {
    // Ray end = wheel world position + suspension axis * rest length
    _t1.copyFrom(wheel.suspensionAxisWorld)
      .scaleInPlace(wheel.suspensionRestLength)
      .addInPlace(wheel.positionWorld);

    try {
      const result = this._rayResult;
      const query = this._rayCollideWith != null
        ? { collideWith: this._rayCollideWith }
        : undefined;
      this.havokPlugin.raycast(wheel.positionWorld, _t1, result, query);

      if (!result.hasHit) {
        wheel.inContact = false;
        return;
      }

      wheel.hitPoint.copyFrom(result.hitPointWorld);
      wheel.hitNormal.copyFrom(result.hitNormalWorld);
      wheel.hitDistance = result.hitDistance;
      wheel.inContact = true;
      this.nWheelsOnGround++;
    } catch (_) {
      wheel.inContact = false;
    }
  }

  /** Compute & apply spring-damper suspension force at wheel contact point */
  _updateWheelSuspension(wheel) {
    if (!wheel.inContact) {
      wheel.prevSuspensionLength = wheel.suspensionLength;
      wheel.hitDistance = wheel.suspensionRestLength;
      return;
    }

    // Compression = how much the spring is compressed
    wheel.suspensionLength = wheel.suspensionRestLength - wheel.hitDistance;
    wheel.suspensionLength = clampNumber(wheel.suspensionLength, 0, wheel.suspensionRestLength);

    const compressionRatio = wheel.suspensionLength / wheel.suspensionRestLength;

    // Spring force proportional to compression
    let force = wheel.suspensionForce * compressionRatio;

    // Damping from rate of change of suspension length
    const timeStep = 1 / 60;
    const rate = (wheel.prevSuspensionLength - wheel.suspensionLength) / timeStep;
    wheel.prevSuspensionLength = wheel.suspensionLength;

    const dampingForce = rate * wheel.suspensionForce * wheel.suspensionDamping;
    force -= dampingForce;

    // Direction: opposite of suspension axis (upward)
    // negateToRef stores the negation of suspensionAxisLocal into _t1
    wheel.suspensionAxisLocal.negateToRef(_t1);
    // Transform the upward direction to world space and scale by force
    Vector3.TransformNormalToRef(
      _t1,
      this.body.transformNode.getWorldMatrix(),
      _t1,
    );
    _t1.scaleInPlace(force);

    // Apply force at the wheel's ground contact point
    this.body.applyForce(_t1, wheel.hitPoint);
  }

  // ── Anti-roll bars ────────────────────────────────────────────────────

  _updateAntiRoll() {
    for (const axle of this.antiRollAxles) {
      const wheelA = this.wheels[axle.wheelA];
      const wheelB = this.wheels[axle.wheelB];
      if (!wheelA || !wheelB) continue;
      if (!wheelA.inContact && !wheelB.inContact) continue;

      // Order: wheelOrder[0] = less compressed, wheelOrder[1] = more compressed
      const wheelOrder = wheelA.suspensionLength <= wheelB.suspensionLength
        ? [wheelA, wheelB]
        : [wheelB, wheelA];

      const avgRestLength = (wheelA.suspensionRestLength + wheelB.suspensionRestLength) / 2;
      const compressionDiff = wheelOrder[1].suspensionLength - wheelOrder[0].suspensionLength;
      const compressionRatio = Math.min(compressionDiff, avgRestLength) / avgRestLength;

      // Push down the less-compressed side (into its suspension axis direction)
      _t1.copyFrom(wheelOrder[0].suspensionAxisWorld)
        .scaleInPlace(axle.force * compressionRatio);
      this.body.applyForce(_t1, wheelOrder[0].positionWorld);

      // Push up the more-compressed side (opposite of suspension axis)
      _t1.copyFrom(wheelOrder[1].suspensionAxisWorld)
        .negateInPlace()
        .scaleInPlace(axle.force * compressionRatio);
      this.body.applyForce(_t1, wheelOrder[1].positionWorld);
    }
  }

  // ── Predictive landing (airborne orientation) ─────────────────────────

  _updatePredictiveLanding() {
    if (this.nWheelsOnGround > 0) return;

    const position = this.body.transformNode.position;
    const frameTime = 1 / 60;
    const predictTime = this.numberOfFramesToPredict * frameTime;

    // Predicted landing position using ballistic trajectory
    _t2.copyFrom(this.body.getLinearVelocity())
      .scaleInPlace(predictTime);
    // Add gravity contribution: 0.5 * g * t²
    _t2.y -= 0.5 * this._gravity * predictTime * predictTime;
    _t2.addInPlace(position);

    try {
      const result = this._rayResult;
      const query = this._rayCollideWith != null
        ? { collideWith: this._rayCollideWith }
        : undefined;
      this.havokPlugin.raycast(position, _t2, result, query);

      if (result.hasHit) {
        // Compute current up axis in world space
        const currentUp = Vector3.TransformNormal(
          Vector3.Up(),
          this.body.transformNode.getWorldMatrix(),
        );
        const targetUp = result.hitNormalWorld;

        // Rotation difference (cross product gives axis × sin(angle))
        const rotationDiff = Vector3.Cross(currentUp, targetUp);

        // Time until impact (rough estimate from distance/speed)
        const speed = this.body.getLinearVelocity().length();
        const nFrames = Math.max(1, result.hitDistance / Math.max(speed, 0.1));
        const timeStepDuration = frameTime * nFrames;

        // Target angular velocity to reach landing orientation
        const predictedAngVel = rotationDiff.scaleInPlace(1 / timeStepDuration);

        // Blend current angular velocity toward predicted
        const currentAngVel = this.body.getAngularVelocity();
        const blended = Vector3.Lerp(currentAngVel, predictedAngVel, this.predictionRatio);
        this.body.setAngularVelocity(blended);
      }
    } catch (_) {
      // Raycast failed — ignore
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Factory: create pre-configured kart vehicle
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a RaycastVehicle pre-configured for a kart.
 *
 * @param {import('@babylonjs/core').PhysicsBody} body
 * @param {object} havokPlugin
 * @param {object} [opts]
 * @param {Vector3[]} [opts.wheelOffsets]  Per-wheel local positions [FL, FR, RL, RR]
 * @param {number}    [opts.rayCollideWith]  Collision mask for raycasts
 * @returns {RaycastVehicle}
 */
export function createKartRaycastVehicle(body, havokPlugin, opts = {}) {
  const vehicle = new RaycastVehicle(body, havokPlugin, {
    rayCollideWith: opts.rayCollideWith,
  });

  const defaults = [
    new Vector3(-0.7,  0.3,  0.7),   // FL
    new Vector3( 0.7,  0.3,  0.7),   // FR
    new Vector3(-0.77, 0.3, -0.7),   // RL
    new Vector3( 0.77, 0.3, -0.7),   // RR
  ];

  const offsets = opts.wheelOffsets || defaults;

  for (let i = 0; i < 4; i++) {
    vehicle.addWheel(new RaycastWheel({
      positionLocal:        offsets[i],
      suspensionRestLength: 0.6,
      suspensionForce:      12000,
      suspensionDamping:    0.12,
      radius:               0.2,
    }));
  }

  // Anti-roll bars: front axle and rear axle
  vehicle.addAntiRollAxle({ wheelA: 0, wheelB: 1, force: 5000 }); // FL–FR
  vehicle.addAntiRollAxle({ wheelA: 2, wheelB: 3, force: 5000 }); // RL–RR

  return vehicle;
}
