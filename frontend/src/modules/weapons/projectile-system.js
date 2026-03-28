/**
 * Projectile system for offline modes with pooling, homing/ballistic types,
 * collision callbacks, and VFX lifecycle hooks.
 *
 * Features:
 *  - Object pool of configurable size (default 128)
 *  - Homing with tunable aggressiveness
 *  - Ballistic arc with gravity
 *  - Bouncing projectiles (bowling ball)
 *  - Per-projectile VFX callback hooks (onSpawn, onUpdate, onHit, onExpire)
 *  - Deterministic collision via radius checks
 */

/** @typedef {'ballistic'|'homing'|'bounce'} ProjectileType */

const DEFAULT_GRAVITY = 18;
const HOMING_ACCEL = 24;
const BOUNCE_RESTITUTION = 0.7;
const FLOOR_Y = 0.5;

export class ProjectileSystem {
  /**
   * @param {object} opts
   * @param {number} [opts.maxProjectiles=128]
   * @param {Function} [opts.onSpawnVFX] Called with projectile on spawn.
   * @param {Function} [opts.onHitVFX] Called with projectile + target info on hit.
   * @param {Function} [opts.onExpireVFX] Called with projectile on expire.
   * @param {object} [opts.logger]
   */
  constructor({ maxProjectiles = 128, onSpawnVFX, onHitVFX, onExpireVFX, logger } = {}) {
    this.logger = logger || console;
    this.maxProjectiles = maxProjectiles;
    this.pool = Array.from({ length: maxProjectiles }, () => this._newProjectile());
    this.onSpawnVFX = onSpawnVFX || null;
    this.onHitVFX = onHitVFX || null;
    this.onExpireVFX = onExpireVFX || null;
    this._hitCallbacks = [];
  }

  /**
   * Register a hit callback.
   * @param {(proj: object, targetId: string) => void} cb
   */
  onHit(cb) {
    this._hitCallbacks.push(cb);
  }

  /**
   * Spawn a projectile from the pool.
   * @param {object} spec
   * @param {number} spec.x
   * @param {number} spec.y
   * @param {number} spec.z
   * @param {number} spec.vx
   * @param {number} spec.vy
   * @param {number} spec.vz
   * @param {ProjectileType} spec.type
   * @param {string} spec.ownerId
   * @param {string} [spec.targetId]
   * @param {string} [spec.weaponId]
   * @param {number} [spec.damage]
   * @param {number} [spec.bounces]
   * @param {number} [spec.life]
   * @returns {object|null}
   */
  spawn(spec) {
    const p = this.pool.find((item) => !item.active);
    if (!p) return null;

    Object.assign(p, {
      active: true,
      x: spec.x,
      y: spec.y,
      z: spec.z,
      vx: spec.vx,
      vy: spec.vy,
      vz: spec.vz,
      type: spec.type || 'ballistic',
      ownerId: spec.ownerId,
      targetId: spec.targetId || null,
      weaponId: spec.weaponId || '',
      damage: spec.damage || 30,
      bouncesLeft: spec.bounces || 0,
      life: spec.life || 4,
      age: 0,
    });

    if (this.onSpawnVFX) this.onSpawnVFX(p);
    return p;
  }

  /**
   * Per-frame update.
   * @param {number} dt
   * @param {(targetId: string|null) => ({x:number,y:number,z:number}|null)} resolveTarget
   */
  update(dt, resolveTarget) {
    for (const p of this.pool) {
      if (!p.active) continue;

      p.age += dt;

      // Physics by type
      if (p.type === 'homing') {
        const target = resolveTarget(p.targetId);
        if (target) {
          const dx = target.x - p.x;
          const dy = target.y - p.y;
          const dz = target.z - p.z;
          const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
          p.vx += (dx / len) * HOMING_ACCEL * dt;
          p.vy += (dy / len) * HOMING_ACCEL * dt;
          p.vz += (dz / len) * HOMING_ACCEL * dt;
          // Cap homing speed
          const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
          if (speed > 60) {
            const scale = 60 / speed;
            p.vx *= scale;
            p.vy *= scale;
            p.vz *= scale;
          }
        }
      } else if (p.type === 'bounce') {
        // Bounce on floor
        p.vy -= DEFAULT_GRAVITY * dt;
        if (p.y <= FLOOR_Y && p.vy < 0) {
          if (p.bouncesLeft > 0) {
            p.vy = -p.vy * BOUNCE_RESTITUTION;
            p.y = FLOOR_Y;
            p.bouncesLeft--;
          } else {
            this._expireProjectile(p);
            continue;
          }
        }
      } else {
        // Standard ballistic arc
        p.vy -= DEFAULT_GRAVITY * dt;
      }

      // Integrate position
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      // Lifetime
      p.life -= dt;
      if (p.life <= 0 || p.y < -40) {
        this._expireProjectile(p);
      }
    }
  }

  /**
   * Check collisions against a set of targets.
   * @param {Array<{id:string, x:number, y:number, z:number}>} targets
   * @param {number} [hitRadius=2.5]
   * @returns {Array<{projectile: object, targetId: string}>}
   */
  checkCollisions(targets, hitRadius = 2.5) {
    const hits = [];
    const r2 = hitRadius * hitRadius;

    for (const p of this.pool) {
      if (!p.active) continue;

      for (const t of targets) {
        if (t.id === p.ownerId) continue; // No self-hits
        const dx = p.x - t.x, dy = p.y - t.y, dz = p.z - t.z;
        if (dx * dx + dy * dy + dz * dz < r2) {
          hits.push({ projectile: p, targetId: t.id });
          for (const cb of this._hitCallbacks) cb(p, t.id);
          if (this.onHitVFX) this.onHitVFX(p, t.id);
          p.active = false;
          break;
        }
      }
    }

    return hits;
  }

  /** Get all currently active projectiles. */
  getActive() {
    return this.pool.filter((p) => p.active);
  }

  /** Get count of active projectiles. */
  getActiveCount() {
    let count = 0;
    for (const p of this.pool) if (p.active) count++;
    return count;
  }

  /** Deactivate all projectiles. */
  clear() {
    for (const p of this.pool) p.active = false;
  }

  /** @private */
  _expireProjectile(p) {
    if (this.onExpireVFX) this.onExpireVFX(p);
    p.active = false;
  }

  /** @private */
  _newProjectile() {
    return {
      active: false,
      x: 0, y: 0, z: 0,
      vx: 0, vy: 0, vz: 0,
      type: 'ballistic',
      ownerId: '',
      targetId: null,
      weaponId: '',
      damage: 0,
      bouncesLeft: 0,
      life: 0,
      age: 0,
    };
  }
}
