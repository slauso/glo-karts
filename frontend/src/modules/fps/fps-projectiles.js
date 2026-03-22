/**
 * fps-projectiles.js — Havok V2 physics projectiles for the Arena FPS mode.
 *
 * Each projectile is a PhysicsAggregate sphere with impulse-based firing.
 * Pool of reusable meshes to avoid GC spikes.
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PhysicsAggregate } from '@babylonjs/core/Physics/v2/physicsAggregate';
import { PhysicsShapeType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import { Ray } from '@babylonjs/core/Culling/ray';

// Collision layers for FPS mode
const FPS_LAYER = {
  GROUND:     0x0001,
  PLAYER:     0x0002,
  PROJECTILE: 0x0008,
  PROP:       0x0040,
  TARGET:     0x0080,
};

const MAX_PROJECTILES = 32;
const DEFAULT_LIFETIME = 4;

/**
 * @param {import("@babylonjs/core").Scene} scene
 * @param {import("@babylonjs/core").ShadowGenerator} shadowGen
 */
export function createProjectileSystem(scene, shadowGen) {
  const pool = [];
  const hitCallbacks = [];

  // Pre-create pool of projectile meshes (initially disabled)
  for (let i = 0; i < MAX_PROJECTILES; i++) {
    const mesh = MeshBuilder.CreateSphere('proj_' + i, { diameter: 0.2, segments: 8 }, scene);
    mesh.isVisible = false;
    mesh.isPickable = false;

    const mat = new StandardMaterial('projMat_' + i, scene);
    mat.emissiveColor = new Color3(1, 0.6, 0.1);
    mat.disableLighting = true;
    mesh.material = mat;

    pool.push({
      mesh,
      mat,
      aggregate: null,
      active: false,
      age: 0,
      lifetime: DEFAULT_LIFETIME,
      damage: 30,
      explosionRadius: 2,
      type: 'cannon',
      trailTimer: 0,
    });
  }

  function getInactive() {
    return pool.find(p => !p.active) || null;
  }

  function activateProjectile(proj, origin, direction, config) {
    const mesh = proj.mesh;

    // Resize mesh to match config
    const diam = (config.radius || 0.1) * 2;
    mesh.scaling.setAll(diam / 0.2); // Base diameter is 0.2

    // Position
    mesh.position.copyFrom(origin);
    mesh.isVisible = true;

    // Material color
    const [r, g, b] = config.color || [1, 0.6, 0.1];
    proj.mat.emissiveColor.set(r, g, b);
    proj.mat.diffuseColor.set(r * 0.5, g * 0.5, b * 0.5);

    // Create physics body
    if (proj.aggregate) {
      try { proj.aggregate.dispose(); } catch { /* already disposed */ }
    }
    proj.aggregate = new PhysicsAggregate(
      mesh,
      PhysicsShapeType.SPHERE,
      { mass: config.mass || 1, friction: 0.3, restitution: 0.4 },
      scene,
    );

    // Collision filter
    const shape = proj.aggregate.shape;
    shape.filterMembershipMask = FPS_LAYER.PROJECTILE;
    shape.filterCollideMask = FPS_LAYER.GROUND | FPS_LAYER.PROP | FPS_LAYER.TARGET;

    // Apply velocity as impulse
    const vel = direction.normalize().scale(config.speed || 40);
    proj.aggregate.body.setLinearVelocity(vel);

    // Add shadow caster if available
    if (shadowGen) {
      try { shadowGen.addShadowCaster(mesh); } catch { /* skip */ }
    }

    // Set metadata
    proj.active = true;
    proj.age = 0;
    proj.lifetime = config.lifetime || DEFAULT_LIFETIME;
    proj.damage = config.damage || 30;
    proj.explosionRadius = config.explosionRadius || 2;
    proj.type = config.type || 'cannon';
    proj.gravityMod = config.gravity || 0;
    proj.trailTimer = 0;
  }

  function deactivateProjectile(proj) {
    proj.active = false;
    proj.mesh.isVisible = false;
    if (proj.aggregate) {
      try { proj.aggregate.dispose(); } catch { /* ok */ }
      proj.aggregate = null;
    }
  }

  // Store scene reference for target checks
  let _targets = [];

  return {
    /**
     * Fire a projectile.
     * @param {Vector3} origin
     * @param {Vector3} direction
     * @param {object} config  Projectile config from weapon definition
     */
    fire(origin, direction, config) {
      const proj = getInactive();
      if (!proj) return null;
      activateProjectile(proj, origin, direction, config);
      return proj;
    },

    /**
     * Per-frame update: lifetime, collision checks, cleanup.
     * @param {number} dt  Delta time in seconds
     */
    update(dt) {
      for (const proj of pool) {
        if (!proj.active) continue;
        proj.age += dt;

        // Apply custom gravity modifier (for cannon arcs etc.)
        if (proj.gravityMod && proj.aggregate?.body) {
          const vel = proj.aggregate.body.getLinearVelocity();
          vel.y += proj.gravityMod * dt;
          proj.aggregate.body.setLinearVelocity(vel);
        }

        // Expire
        if (proj.age >= proj.lifetime) {
          _notifyHit(proj, proj.mesh.position, new Vector3(0, 1, 0), 'expire');
          deactivateProjectile(proj);
          continue;
        }

        // Check collision with targets via mesh intersection
        for (const target of _targets) {
          if (!target.active || !target.mesh) continue;
          if (proj.mesh.intersectsMesh(target.mesh, false)) {
            const point = proj.mesh.position.clone();
            const normal = target.mesh.position.subtract(point).normalize();
            _notifyHit(proj, point, normal, 'target', target);
            target.onHit(proj.damage, point);
            deactivateProjectile(proj);
            break;
          }
        }

        // Check if projectile hit the ground (y < -5 means out of bounds)
        if (proj.mesh.position.y < -5) {
          deactivateProjectile(proj);
          continue;
        }

        // Check ground/prop collision via a short forward ray
        if (proj.aggregate?.body) {
          const vel = proj.aggregate.body.getLinearVelocity();
          const speed = vel.length();
          if (speed > 0.5) {
            const ray = new Ray(
              proj.mesh.position,
              vel.normalize(),
              speed * dt + (proj.mesh.scaling.x * 0.15),
            );
            const hit = scene.pickWithRay(ray, (m) => {
              return m !== proj.mesh && m.isPickable && !m.name.startsWith('proj_');
            });
            if (hit?.hit && hit.pickedMesh) {
              // Check if it's a target
              const tgt = _targets.find(t => t.active && t.mesh === hit.pickedMesh);
              if (tgt) {
                tgt.onHit(proj.damage, hit.pickedPoint);
                _notifyHit(proj, hit.pickedPoint, hit.getNormal(true), 'target', tgt);
              } else {
                _notifyHit(proj, hit.pickedPoint, hit.getNormal(true), 'environment');
              }
              deactivateProjectile(proj);
            }
          }
        }
      }
    },

    /**
     * Register callback for projectile hits.
     * @param {(info: {point, normal, targetType, target?, damage}) => void} cb
     */
    onHit(cb) { hitCallbacks.push(cb); },

    /** Register target objects for collision checking. */
    setTargets(targets) { _targets = targets; },

    getActiveCount() { return pool.filter(p => p.active).length; },

    dispose() {
      for (const p of pool) {
        deactivateProjectile(p);
        p.mesh.dispose();
        p.mat.dispose();
      }
    },
  };

  function _notifyHit(proj, point, normal, targetType, target) {
    const info = {
      point: point?.clone() || Vector3.Zero(),
      normal: normal?.clone() || new Vector3(0, 1, 0),
      targetType,
      target: target || null,
      damage: proj.damage,
      projectileType: proj.type,
      points: targetType === 'target' ? (target?.points || 10) : 0,
    };
    for (const cb of hitCallbacks) {
      try { cb(info); } catch (e) { console.error('Hit callback error:', e); }
    }
  }
}
