/**
 * babylon-particles.js — Babylon.js particle / VFX system.
 * Replaces the Three.js Points-based particles with Babylon.js GPU ParticleSystem.
 *
 * Provides:
 *   - Drift sparks (blue mini / orange super) behind rear wheels
 *   - Boost flames (on mini/super-turbo activation)
 *   - Weapon hit flash particles
 *   - Item pickup sparkle ring
 */

import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { GPUParticleSystem } from '@babylonjs/core/Particles/gpuParticleSystem';
import { Vector3, Color4 } from '@babylonjs/core/Maths/math';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';

// ── Pool size limits ──────────────────────────────────────────────────────
const SPARK_CAPACITY   = 80;
const FLAME_CAPACITY   = 40;
const HIT_CAPACITY     = 60;
const SPARKLE_CAPACITY = 30;

// ── Shared state ──────────────────────────────────────────────────────────
let sparkSystem   = null;
let flameSystem   = null;
let hitSystem     = null;
let sparkleSystem = null;

let isInitialized = false;
let _scene = null;

// ── Default particle texture (1×1 white pixel, data URL) ──────────────────
// Babylon particle systems require a texture; this is the simplest fallback.
const PARTICLE_TEXTURE_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

// ── Helper: create a Babylon particle system ──────────────────────────────
function createParticlePool(name, capacity, color1, color2, minSize, maxSize, scene) {
  const ps = new ParticleSystem(name, capacity, scene);
  ps.particleTexture = new Texture(PARTICLE_TEXTURE_URL, scene);

  // Emission — we'll emit manually so set rate to 0
  ps.emitRate = 0;
  ps.minLifeTime = 0.2;
  ps.maxLifeTime = 0.6;

  // Sizes
  ps.minSize = minSize;
  ps.maxSize = maxSize;

  // Colors
  ps.color1 = color1;
  ps.color2 = color2;
  ps.colorDead = new Color4(0, 0, 0, 0);

  // Gravity (sparks fall)
  ps.gravity = new Vector3(0, -9.8, 0);

  // Blending (additive for glow)
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;

  // Speed
  ps.minEmitPower = 1;
  ps.maxEmitPower = 3;

  ps.start();
  return ps;
}

// ── Manual burst emission helper ──────────────────────────────────────────
function emitBurst(system, worldPos, velocity, count, lifetime) {
  // Temporarily set emission params and trigger a manual burst
  system.emitter = worldPos.clone ? worldPos.clone() : new Vector3(worldPos.x, worldPos.y, worldPos.z);
  system.direction1 = velocity.add(new Vector3(-1, 0, -1));
  system.direction2 = velocity.add(new Vector3(1, 2, 1));
  system.minLifeTime = lifetime * 0.7;
  system.maxLifeTime = lifetime;
  system.manualEmitCount = count;
}

// ═══════════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Call once after the Babylon.js scene is created.
 */
export function initParticles(scene) {
  if (isInitialized) return;
  _scene = scene;
  isInitialized = true;

  sparkSystem = createParticlePool(
    'sparks', SPARK_CAPACITY,
    new Color4(0.3, 0.79, 1.0, 0.85),  // blue
    new Color4(0.3, 0.79, 1.0, 0.5),
    0.08, 0.18, scene,
  );

  flameSystem = createParticlePool(
    'flames', FLAME_CAPACITY,
    new Color4(1.0, 0.4, 0.0, 0.85),   // orange
    new Color4(1.0, 0.2, 0.0, 0.5),
    0.15, 0.35, scene,
  );

  hitSystem = createParticlePool(
    'hits', HIT_CAPACITY,
    new Color4(1.0, 0.13, 0.13, 0.85),  // red
    new Color4(1.0, 0.3, 0.1, 0.5),
    0.1, 0.25, scene,
  );

  sparkleSystem = createParticlePool(
    'sparkles', SPARKLE_CAPACITY,
    new Color4(1.0, 0.93, 0.27, 0.85),  // yellow
    new Color4(1.0, 0.93, 0.27, 0.5),
    0.08, 0.20, scene,
  );
}

/**
 * Call every frame from animate():
 *   updateParticles(deltaTime, carModel, kartState);
 */
export function updateParticles(dt, carModel, kartState) {
  if (!isInitialized || !carModel) return;

  // ── Drift sparks ──────────────────────────────────────────────────
  if (kartState && kartState.isDrifting && kartState.sparksLevel > 0) {
    const isSuper = kartState.sparksLevel >= 2;
    if (isSuper) {
      sparkSystem.color1 = new Color4(1.0, 0.53, 0.0, 0.85);
      sparkSystem.color2 = new Color4(1.0, 0.53, 0.0, 0.5);
    } else {
      sparkSystem.color1 = new Color4(0.3, 0.79, 1.0, 0.85);
      sparkSystem.color2 = new Color4(0.3, 0.79, 1.0, 0.5);
    }

    // Emit from behind the car (rear axle area)
    const forward = carModel.forward || new Vector3(0, 0, 1);
    const back = forward.scale(-1.2);
    const emitPos = carModel.position.add(back).add(new Vector3(0, 0.15, 0));

    const upVel = new Vector3(
      (Math.random() - 0.5) * 2,
      1.5 + Math.random(),
      (Math.random() - 0.5) * 2,
    );
    emitBurst(sparkSystem, emitPos, upVel, 3, 0.35);
  }

  // ── Boost flames ──────────────────────────────────────────────────
  if (kartState && kartState.isBoosting) {
    const forward = carModel.forward || new Vector3(0, 0, 1);
    const exhaust = carModel.position.add(forward.scale(-1.5)).add(new Vector3(0, 0.3, 0));
    const backward = forward.scale(-3);
    emitBurst(flameSystem, exhaust, backward, 2, 0.25);
  }
}

/**
 * Burst of particles at a world position (weapon hit, collision).
 */
export function emitHitBurst(worldPos, color = 0xff2222, count = 12) {
  if (!isInitialized) return;
  const r = ((color >> 16) & 0xff) / 255;
  const g = ((color >> 8) & 0xff) / 255;
  const b = (color & 0xff) / 255;
  hitSystem.color1 = new Color4(r, g, b, 0.85);
  hitSystem.color2 = new Color4(r, g, b, 0.5);

  const pos = new Vector3(worldPos.x ?? 0, worldPos.y ?? 0, worldPos.z ?? 0);
  const scatter = new Vector3(0, 3, 0);
  emitBurst(hitSystem, pos, scatter, count, 0.6);
}

/**
 * Sparkle ring at an item-box position when picked up.
 */
export function emitPickupSparkle(worldPos) {
  if (!isInitialized) return;
  const pos = new Vector3(worldPos.x ?? 0, worldPos.y ?? 0, worldPos.z ?? 0);
  const scatter = new Vector3(0, 1.5, 0);
  emitBurst(sparkleSystem, pos, scatter, SPARKLE_CAPACITY, 0.5);
}

/**
 * Clean up all particle systems.
 */
export function disposeParticles() {
  if (!isInitialized) return;
  [sparkSystem, flameSystem, hitSystem, sparkleSystem].forEach(sys => {
    if (sys) sys.dispose();
  });
  sparkSystem = flameSystem = hitSystem = sparkleSystem = null;
  isInitialized = false;
  _scene = null;
}
