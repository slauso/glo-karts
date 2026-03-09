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

  // New STK-style systems
  initSkidSystem(scene);
  initExhaustSystem(scene);
  initStunSystem(scene);
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

  // ── Skid marks (during drift) ────────────────────────────────────
  if (kartState && kartState.isDrifting && kartState.sparksLevel > 0) {
    emitSkidMarks(carModel);
  }

  // ── Exhaust smoke (idle / low speed) ─────────────────────────────
  const speed = kartState?.speed ?? 0;
  emitExhaustSmoke(carModel, speed);
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
 * Explosion ring burst — larger VFX for blast-radius weapons.
 * Emits a wide ring of particles plus an upward shockwave column.
 */
export function emitExplosionRing(worldPos, color = 0xff6600, radius = 4) {
  if (!isInitialized) return;
  const r = ((color >> 16) & 0xff) / 255;
  const g = ((color >> 8) & 0xff) / 255;
  const b = (color & 0xff) / 255;
  const pos = new Vector3(worldPos.x ?? 0, worldPos.y ?? 0, worldPos.z ?? 0);

  // Main ring burst (outward)
  hitSystem.color1 = new Color4(r, g, b, 0.9);
  hitSystem.color2 = new Color4(r * 0.6, g * 0.6, b * 0.6, 0.5);
  hitSystem.minSize = 0.15;
  hitSystem.maxSize = 0.35;
  const ringScatter = new Vector3(radius, 1, radius);
  emitBurst(hitSystem, pos, ringScatter, Math.min(HIT_CAPACITY, 30), 0.8);

  // Upward column (shockwave)
  sparkleSystem.color1 = new Color4(1, 0.9, 0.3, 0.85);
  sparkleSystem.color2 = new Color4(1, 0.5, 0.1, 0.5);
  const upScatter = new Vector3(0, radius * 2, 0);
  emitBurst(sparkleSystem, pos, upScatter, 15, 0.5);

  // Reset hit system sizes
  hitSystem.minSize = 0.1;
  hitSystem.maxSize = 0.25;
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

// ── Skid Mark System ────────────────────────────────────────────────────────

let skidSystem = null;
const SKID_CAPACITY = 120;

function initSkidSystem(scene) {
  skidSystem = new ParticleSystem('skidMarks', SKID_CAPACITY, scene);
  skidSystem.particleTexture = new Texture(PARTICLE_TEXTURE_URL, scene);
  skidSystem.emitRate = 0;
  skidSystem.minLifeTime = 2.0;
  skidSystem.maxLifeTime = 4.0;
  skidSystem.minSize = 0.15;
  skidSystem.maxSize = 0.3;
  skidSystem.color1 = new Color4(0.1, 0.1, 0.1, 0.6);
  skidSystem.color2 = new Color4(0.2, 0.2, 0.2, 0.4);
  skidSystem.colorDead = new Color4(0.1, 0.1, 0.1, 0);
  skidSystem.gravity = new Vector3(0, 0, 0); // skid marks stay on ground
  skidSystem.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  skidSystem.minEmitPower = 0;
  skidSystem.maxEmitPower = 0.1;
  skidSystem.direction1 = new Vector3(0, 0.01, 0);
  skidSystem.direction2 = new Vector3(0, 0.02, 0);
  skidSystem.start();
}

/**
 * Emit skid mark particles under the kart during drift.
 * Called every frame from updateParticles when drifting.
 */
function emitSkidMarks(carModel) {
  if (!skidSystem) return;
  const forward = carModel.forward || new Vector3(0, 0, 1);
  const back = forward.scale(-1.0);
  const right = Vector3.Cross(Vector3.Up(), forward).normalize();

  // Left wheel skid
  const leftPos = carModel.position.add(back).add(right.scale(-0.6)).add(new Vector3(0, 0.05, 0));
  skidSystem.emitter = leftPos;
  skidSystem.manualEmitCount = 2;

  // Right wheel skid
  const rightPos = carModel.position.add(back).add(right.scale(0.6)).add(new Vector3(0, 0.05, 0));
  skidSystem.emitter = rightPos;
  skidSystem.manualEmitCount = 2;
}

// ── Exhaust Smoke ───────────────────────────────────────────────────────────

let exhaustSystem = null;

function initExhaustSystem(scene) {
  exhaustSystem = new ParticleSystem('exhaust', 30, scene);
  exhaustSystem.particleTexture = new Texture(PARTICLE_TEXTURE_URL, scene);
  exhaustSystem.emitRate = 0;
  exhaustSystem.minLifeTime = 0.4;
  exhaustSystem.maxLifeTime = 1.0;
  exhaustSystem.minSize = 0.08;
  exhaustSystem.maxSize = 0.2;
  exhaustSystem.color1 = new Color4(0.5, 0.5, 0.5, 0.3);
  exhaustSystem.color2 = new Color4(0.4, 0.4, 0.4, 0.15);
  exhaustSystem.colorDead = new Color4(0.3, 0.3, 0.3, 0);
  exhaustSystem.gravity = new Vector3(0, 0.5, 0); // smoke rises
  exhaustSystem.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  exhaustSystem.minEmitPower = 0.3;
  exhaustSystem.maxEmitPower = 0.6;
  exhaustSystem.start();
}

/**
 * Emit exhaust smoke puffs behind the car at idle/low speed.
 */
function emitExhaustSmoke(carModel, speed) {
  if (!exhaustSystem) return;
  // Only emit at low speed (< 20 kph)
  if (speed > 20) return;
  const forward = carModel.forward || new Vector3(0, 0, 1);
  const exhaust = carModel.position.add(forward.scale(-1.4)).add(new Vector3(0, 0.25, 0));
  exhaustSystem.emitter = exhaust;
  exhaustSystem.direction1 = forward.scale(-0.5).add(new Vector3(-0.2, 0.3, -0.2));
  exhaustSystem.direction2 = forward.scale(-0.3).add(new Vector3(0.2, 0.6, 0.2));
  exhaustSystem.manualEmitCount = 1;
}

// ── Nitro Pad Activation Burst ──────────────────────────────────────────────

/**
 * Burst of particles when driving over a nitro pad.
 */
export function emitNitroActivation(worldPos) {
  if (!isInitialized) return;
  const pos = new Vector3(worldPos.x ?? 0, worldPos.y ?? 0, worldPos.z ?? 0);
  sparkleSystem.color1 = new Color4(0, 0.9, 1.0, 0.9);
  sparkleSystem.color2 = new Color4(0, 1.0, 0.5, 0.6);
  emitBurst(sparkleSystem, pos, new Vector3(0, 2, 0), 20, 0.4);
}

// ── Stun/Spinout Stars ──────────────────────────────────────────────────────

let stunSystem = null;

function initStunSystem(scene) {
  stunSystem = new ParticleSystem('stunStars', 20, scene);
  stunSystem.particleTexture = new Texture(PARTICLE_TEXTURE_URL, scene);
  stunSystem.emitRate = 0;
  stunSystem.minLifeTime = 0.5;
  stunSystem.maxLifeTime = 1.2;
  stunSystem.minSize = 0.12;
  stunSystem.maxSize = 0.25;
  stunSystem.color1 = new Color4(1.0, 1.0, 0.3, 0.9);
  stunSystem.color2 = new Color4(1.0, 0.9, 0.0, 0.6);
  stunSystem.colorDead = new Color4(1, 1, 0, 0);
  stunSystem.gravity = new Vector3(0, 1, 0);
  stunSystem.blendMode = ParticleSystem.BLENDMODE_ADD;
  stunSystem.minEmitPower = 0.5;
  stunSystem.maxEmitPower = 1.5;
  stunSystem.start();
}

/**
 * Emit dizzy stars above a kart (spinout / stunned).
 */
export function emitStunStars(worldPos) {
  if (!isInitialized || !stunSystem) return;
  const pos = new Vector3(worldPos.x ?? 0, (worldPos.y ?? 0) + 2, worldPos.z ?? 0);
  stunSystem.emitter = pos;
  stunSystem.direction1 = new Vector3(-1, 0.5, -1);
  stunSystem.direction2 = new Vector3(1, 1.5, 1);
  stunSystem.manualEmitCount = 8;
}

/**
 * Clean up all particle systems.
 */
export function disposeParticles() {
  if (!isInitialized) return;
  [sparkSystem, flameSystem, hitSystem, sparkleSystem, skidSystem, exhaustSystem, stunSystem].forEach(sys => {
    if (sys) sys.dispose();
  });
  sparkSystem = flameSystem = hitSystem = sparkleSystem = skidSystem = exhaustSystem = stunSystem = null;
  isInitialized = false;
  _scene = null;
}
