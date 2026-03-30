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
import '@babylonjs/core/Shaders/particles.vertex';
import '@babylonjs/core/Shaders/particles.fragment';

// ── Pool size limits ──────────────────────────────────────────────────────
const SPARK_CAPACITY   = 80;
const FLAME_CAPACITY   = 40;
const HIT_CAPACITY     = 60;
const SPARKLE_CAPACITY = 30;

// ── (22.1) GPU particle support detection ─────────────────────────────────
// WM pattern: use GPUParticleSystem.IsSupported for heavy effects, CPU fallback.
let _gpuSupported = false;

// ── Combat particle budget ────────────────────────────────────────────────
// Caps total manual-emit particles per frame to keep GPU fill-rate in check
// during peak battle activity (4 karts + 8 projectiles + VFX).
const MAX_BURST_PER_FRAME = 40;
let _burstThisFrame = 0;

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

// ── (22.2) Procedural sprite sheet texture for explosions ─────────────────
// Generates a 4×4 (128px cells) sprite sheet at runtime using canvas.
// Each frame is a radial gradient with decreasing opacity — simulates
// smoke/fire dissipation without requiring external texture files.
let _spriteSheetTexture = null;

function _generateSpriteSheet(scene) {
  if (_spriteSheetTexture) return _spriteSheetTexture;
  const size = 512; // 4×4 grid of 128px cells
  const cellSize = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const frame = row * 4 + col;
      const cx = col * cellSize + cellSize / 2;
      const cy = row * cellSize + cellSize / 2;
      const progress = frame / 15; // 0→1 across 16 frames
      const radius = cellSize * 0.3 + cellSize * 0.2 * progress;
      const alpha = 1.0 - progress * 0.7;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0, `rgba(255,${Math.round(180 - 120 * progress)},${Math.round(60 - 60 * progress)},${alpha})`);
      grad.addColorStop(0.6, `rgba(200,${Math.round(100 - 80 * progress)},20,${alpha * 0.5})`);
      grad.addColorStop(1, 'rgba(80,40,10,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
    }
  }
  const dataUrl = canvas.toDataURL('image/png');
  _spriteSheetTexture = new Texture(dataUrl, scene);
  return _spriteSheetTexture;
}

/**
 * (22.2) Apply sprite sheet animation config to a particle system.
 * WM pattern: animationSheetEnabled + spriteCellWidth/Height for rich variety.
 */
function _applySpriteSheetConfig(ps) {
  ps.isAnimationSheetEnabled = true;
  ps.spriteCellWidth = 128;
  ps.spriteCellHeight = 128;
  ps.spriteCellLoop = false;
  ps.spriteRandomStartCell = true;
  ps.startSpriteCellID = 0;
  ps.endSpriteCellID = 15; // 4×4 = 16 frames
  ps.spriteCellChangeSpeed = 1;
}

// ── Helper: create a Babylon particle system ──────────────────────────────
// (22.1) Uses GPUParticleSystem when available for 2-4x capacity at lower CPU cost
function createParticlePool(name, capacity, color1, color2, minSize, maxSize, scene, useGpu = false) {
  const useGPU = useGpu && _gpuSupported;
  const ps = useGPU
    ? new GPUParticleSystem(name, { capacity }, scene)
    : new ParticleSystem(name, capacity, scene);
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
  // Enforce per-frame particle budget to maintain 60fps under load
  const remaining = MAX_BURST_PER_FRAME - _burstThisFrame;
  if (remaining <= 0) return;
  const capped = Math.min(count, remaining);
  _burstThisFrame += capped;

  // Temporarily set emission params and trigger a manual burst
  system.emitter = worldPos.clone ? worldPos.clone() : new Vector3(worldPos.x, worldPos.y, worldPos.z);
  system.direction1 = velocity.add(new Vector3(-1, 0, -1));
  system.direction2 = velocity.add(new Vector3(1, 2, 1));
  system.minLifeTime = lifetime * 0.7;
  system.maxLifeTime = lifetime;
  system.manualEmitCount = capped;
}

/**
 * Call once per frame (start of animate) to reset the particle emission budget.
 */
export function resetParticleBudget() { _burstThisFrame = 0; }

/** (22.1) Returns true if GPU particles are in use on this hardware. */
export function isGPUParticlesActive() { return _gpuSupported && isInitialized; }

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

  // (22.1) Detect GPU particle support (WM pattern)
  _gpuSupported = GPUParticleSystem.IsSupported;

  sparkSystem = createParticlePool(
    'sparks', SPARK_CAPACITY,
    new Color4(0.3, 0.79, 1.0, 0.85),  // blue
    new Color4(0.3, 0.79, 1.0, 0.5),
    0.08, 0.18, scene, true,  // GPU for drift sparks (high frequency)
  );

  flameSystem = createParticlePool(
    'flames', FLAME_CAPACITY,
    new Color4(1.0, 0.4, 0.0, 0.85),   // orange
    new Color4(1.0, 0.2, 0.0, 0.5),
    0.15, 0.35, scene, true,  // GPU for boost/fire effects
  );

  hitSystem = createParticlePool(
    'hits', HIT_CAPACITY,
    new Color4(1.0, 0.13, 0.13, 0.85),  // red
    new Color4(1.0, 0.3, 0.1, 0.5),
    0.1, 0.25, scene, true,  // GPU for combat hit bursts
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
  // (22.7) Pre-warm explosion pool
  _prewarmExplosionPool();
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

/**
 * Enhanced item box collection burst — rainbow-colored multi-phase explosion.
 * Phase 1: Expanding ring of colored sparkles
 * Phase 2: Upward shower of golden particles
 * Phase 3: Flash pulse via hit system
 */
export function emitItemBoxCollectionBurst(worldPos) {
  if (!isInitialized) return;
  const pos = new Vector3(worldPos.x ?? 0, worldPos.y ?? 0, worldPos.z ?? 0);

  // Phase 1: Wide horizontal ring burst (sparkle system)
  sparkleSystem.color1 = new Color4(0.3, 0.8, 1.0, 0.95);
  sparkleSystem.color2 = new Color4(1.0, 0.9, 0.2, 0.85);
  sparkleSystem.minSize = 0.12;
  sparkleSystem.maxSize = 0.28;
  sparkleSystem.minLifeTime = 0.5;
  sparkleSystem.maxLifeTime = 1.0;
  sparkleSystem.gravity = new Vector3(0, -2, 0);
  emitBurst(sparkleSystem, pos, new Vector3(0, 3, 0), SPARKLE_CAPACITY, 0.8);

  // Phase 2: Golden upward shower (flame system, repurposed briefly)
  const savedF1 = flameSystem.color1;
  const savedF2 = flameSystem.color2;
  const savedFMin = flameSystem.minSize;
  const savedFMax = flameSystem.maxSize;
  flameSystem.color1 = new Color4(1.0, 0.85, 0.2, 0.9);
  flameSystem.color2 = new Color4(1.0, 0.6, 0.0, 0.7);
  flameSystem.minSize = 0.08;
  flameSystem.maxSize = 0.2;
  emitBurst(flameSystem, pos, new Vector3(0, 4, 0), 20, 0.7);
  // Restore flame system colors after a tick
  setTimeout(() => {
    flameSystem.color1 = savedF1;
    flameSystem.color2 = savedF2;
    flameSystem.minSize = savedFMin;
    flameSystem.maxSize = savedFMax;
  }, 50);

  // Phase 3: White flash burst (hit system)
  const savedH1 = hitSystem.color1;
  const savedH2 = hitSystem.color2;
  hitSystem.color1 = new Color4(1, 1, 1, 0.95);
  hitSystem.color2 = new Color4(0.8, 0.9, 1.0, 0.8);
  hitSystem.minSize = 0.15;
  hitSystem.maxSize = 0.35;
  emitBurst(hitSystem, pos, new Vector3(0, 2, 0), 15, 0.4);
  setTimeout(() => {
    hitSystem.color1 = savedH1;
    hitSystem.color2 = savedH2;
    hitSystem.minSize = 0.1;
    hitSystem.maxSize = 0.25;
  }, 50);

  // Reset sparkle system
  setTimeout(() => {
    sparkleSystem.color1 = new Color4(1.0, 0.93, 0.27, 0.85);
    sparkleSystem.color2 = new Color4(1.0, 0.93, 0.27, 0.5);
    sparkleSystem.minSize = 0.08;
    sparkleSystem.maxSize = 0.18;
    sparkleSystem.minLifeTime = 0.2;
    sparkleSystem.maxLifeTime = 0.6;
    sparkleSystem.gravity = new Vector3(0, -9.8, 0);
  }, 100);
}

/**
 * Item box shatter / destruction effect — glass-break visual when a box is
 * collected. Creates a brief one-shot particle system that emits shard-like
 * particles outward in all directions with strong initial velocity, plus a
 * bright flash. The system auto-disposes after particles die off.
 *
 * Performance: allocates a small one-shot ParticleSystem (40 particles) that
 * self-destructs in ~1.2s. No per-frame cost once disposed.
 */
export function emitItemBoxShatter(worldPos) {
  if (!isInitialized || !_scene) return;
  const pos = new Vector3(worldPos.x ?? 0, worldPos.y ?? 0, worldPos.z ?? 0);

  // ── Shard burst (one-shot system, auto-disposes) ──────────────────────
  const shardPS = new ParticleSystem('itemBoxShatter', 40, _scene);
  shardPS.particleTexture = new Texture(PARTICLE_TEXTURE_URL, _scene);
  shardPS.emitter = pos;
  shardPS.minEmitBox = new Vector3(-0.3, -0.3, -0.3);
  shardPS.maxEmitBox = new Vector3(0.3, 0.3, 0.3);

  // Angular shard look: elongated flat particles
  shardPS.minScaleX = 0.08;
  shardPS.maxScaleX = 0.25;
  shardPS.minScaleY = 0.04;
  shardPS.maxScaleY = 0.12;
  shardPS.minSize = 0.15;
  shardPS.maxSize = 0.35;

  // Colors: bright cyan → blue → transparent
  shardPS.color1 = new Color4(0.5, 0.85, 1.0, 0.95);
  shardPS.color2 = new Color4(0.3, 0.6, 1.0, 0.85);
  shardPS.colorDead = new Color4(0.1, 0.2, 0.6, 0);
  shardPS.blendMode = ParticleSystem.BLENDMODE_ADD;

  // Strong outward velocity for explosion feel
  shardPS.minEmitPower = 4;
  shardPS.maxEmitPower = 9;
  shardPS.direction1 = new Vector3(-1, -0.5, -1);
  shardPS.direction2 = new Vector3(1, 1.5, 1);

  // Gravity pulls shards downward for realism
  shardPS.gravity = new Vector3(0, -6, 0);
  shardPS.minLifeTime = 0.3;
  shardPS.maxLifeTime = 0.8;

  // Slight angular velocity for tumble
  shardPS.minAngularSpeed = -4;
  shardPS.maxAngularSpeed = 4;

  // Size fades out
  shardPS.addSizeGradient(0, 1.0);
  shardPS.addSizeGradient(0.6, 0.7);
  shardPS.addSizeGradient(1.0, 0);

  // One-shot: emit all 40 immediately then stop
  shardPS.manualEmitCount = 40;
  shardPS.emitRate = 0;
  shardPS.targetStopDuration = 1.0;
  shardPS.disposeOnStop = true;
  shardPS.start();

  // ── Bright flash pulse using existing hit system ──────────────────────
  const savedH1 = hitSystem.color1;
  const savedH2 = hitSystem.color2;
  const savedHMin = hitSystem.minSize;
  const savedHMax = hitSystem.maxSize;
  hitSystem.color1 = new Color4(0.6, 0.9, 1.0, 0.95);
  hitSystem.color2 = new Color4(1, 1, 1, 0.9);
  hitSystem.minSize = 0.2;
  hitSystem.maxSize = 0.5;
  emitBurst(hitSystem, pos, new Vector3(0, 1.5, 0), 12, 0.35);
  setTimeout(() => {
    hitSystem.color1 = savedH1;
    hitSystem.color2 = savedH2;
    hitSystem.minSize = savedHMin;
    hitSystem.maxSize = savedHMax;
  }, 50);
}

/**
 * Item box respawn coalesce effect — particles converge inward to the position
 * then flash white when the box materializes.
 */
export function emitItemBoxRespawn(worldPos) {
  if (!isInitialized) return;
  const pos = new Vector3(worldPos.x ?? 0, worldPos.y ?? 0, worldPos.z ?? 0);

  // Converging sparkles from wide area toward center
  sparkleSystem.color1 = new Color4(0.3, 0.7, 1.0, 0.8);
  sparkleSystem.color2 = new Color4(0.6, 0.9, 1.0, 0.6);
  sparkleSystem.minLifeTime = 0.3;
  sparkleSystem.maxLifeTime = 0.6;
  sparkleSystem.gravity = new Vector3(0, 2, 0);
  emitBurst(sparkleSystem, pos, new Vector3(0, 1, 0), 12, 0.4);

  setTimeout(() => {
    sparkleSystem.color1 = new Color4(1.0, 0.93, 0.27, 0.85);
    sparkleSystem.color2 = new Color4(1.0, 0.93, 0.27, 0.5);
    sparkleSystem.minLifeTime = 0.2;
    sparkleSystem.maxLifeTime = 0.6;
    sparkleSystem.gravity = new Vector3(0, -9.8, 0);
  }, 100);
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
 * Emit ice crystal particles around a frozen kart. (21.28)
 */
export function emitFrozenCrystals(worldPos) {
  if (!isInitialized || !sparkleSystem) return;
  const pos = new Vector3(worldPos.x ?? 0, (worldPos.y ?? 0) + 0.5, worldPos.z ?? 0);
  sparkleSystem.color1 = new Color4(0.6, 0.85, 1.0, 0.9);
  sparkleSystem.color2 = new Color4(0.8, 0.95, 1.0, 0.5);
  sparkleSystem.minSize = 0.06;
  sparkleSystem.maxSize = 0.15;
  emitBurst(sparkleSystem, pos, new Vector3(1, 1.5, 1), 6, 0.7);
  sparkleSystem.minSize = 0.08;
  sparkleSystem.maxSize = 0.2;
}

/**
 * Emit fire particles around a burning kart. (21.28)
 */
export function emitBurningFlames(worldPos) {
  if (!isInitialized || !flameSystem) return;
  const pos = new Vector3(worldPos.x ?? 0, (worldPos.y ?? 0) + 0.3, worldPos.z ?? 0);
  flameSystem.color1 = new Color4(1.0, 0.3, 0.0, 0.9);
  flameSystem.color2 = new Color4(1.0, 0.6, 0.1, 0.5);
  emitBurst(flameSystem, pos, new Vector3(0.5, 2, 0.5), 4, 0.4);
}

/**
 * Emit boost trail flames (blue for start boost, orange for drift). (21.28)
 */
export function emitBoostTrail(carModel, boostType) {
  if (!isInitialized || !flameSystem || !carModel) return;
  const forward = carModel.forward || new Vector3(0, 0, 1);
  const exhaust = carModel.position.add(forward.scale(-1.5)).add(new Vector3(0, 0.3, 0));
  const backward = forward.scale(-4);
  if (boostType === 'start') {
    flameSystem.color1 = new Color4(0.2, 0.6, 1.0, 0.9);
    flameSystem.color2 = new Color4(0.1, 0.3, 1.0, 0.5);
  } else {
    flameSystem.color1 = new Color4(1.0, 0.5, 0.0, 0.9);
    flameSystem.color2 = new Color4(1.0, 0.2, 0.0, 0.5);
  }
  emitBurst(flameSystem, exhaust, backward, 4, 0.3);
}

// ── Projectile Trail System (21.7) ──────────────────────────────────────────

const TRAIL_CONFIGS = {
  bowling_ball: { color: [0.9, 0.1, 0.1], size: 0.22, rate: 18, life: 0.7 },
  cake:         { color: [1.0, 0.6, 0.8], size: 0.20, rate: 14, life: 0.6 },
  plunger:      { color: [0.6, 0.4, 0.2], size: 0.16, rate: 16, life: 0.5 },
  missile:      { color: [1.0, 0.58, 0.12], size: 0.34, rate: 34, life: 1.0, gravity: [0, -0.4, 0], power: [0.7, 1.8], direction1: [-0.15, -0.1, -1.3], direction2: [0.15, 0.18, -0.65] },
  crimson_hydra:{ color: [1.0, 0.32, 0.18], size: 0.24, rate: 28, life: 0.85, gravity: [0, -0.3, 0], power: [0.55, 1.45], direction1: [-0.12, -0.08, -1.1], direction2: [0.12, 0.16, -0.55] },
  fireball:     { color: [1.0, 0.45, 0.1], size: 0.35, rate: 30, life: 0.7 },
  toxic_spread: { color: [0.45, 0.95, 0.2], size: 0.24, rate: 20, life: 0.6 },
  ice_lance:    { color: [0.65, 0.9, 1.0], size: 0.22, rate: 22, life: 0.5 },
  tornado:      { color: [0.6, 0.95, 0.85], size: 0.55, rate: 50, life: 1.2 },
  rock_barrage: { color: [0.72, 0.58, 0.42], size: 0.32, rate: 24, life: 0.75, gravity: [0, -2.2, 0], power: [0.4, 1.2], direction1: [-0.5, -0.25, -0.5], direction2: [0.5, 0.1, 0.5], blendMode: ParticleSystem.BLENDMODE_STANDARD },
  lightning_bolt: { color: [0.85, 0.9, 1.0], size: 0.20, rate: 28, life: 0.3 },
  wind_slash:   { color: [0.75, 1.0, 0.9], size: 0.24, rate: 22, life: 0.45 },
  toxic_cloud:  { color: [0.35, 0.8, 0.2], size: 0.32, rate: 20, life: 1.0 },
  shockwave_cannon: { color: [0.3, 0.6, 1.0], size: 0.28, rate: 22, life: 0.6 },
  plasma_railgun:   { color: [0.2, 1.0, 0.5], size: 0.30, rate: 28, life: 0.4 },
  black_hole:       { color: [0.4, 0.0, 0.8], size: 0.35, rate: 20, life: 1.0 },
  meteor_swarm:     { color: [1.0, 0.3, 0.0], size: 0.28, rate: 24, life: 0.7 },
  vortex_tornado:   { color: [0.6, 0.9, 1.0], size: 0.30, rate: 26, life: 0.8 },
  nitro:        { color: [0.0, 1.0, 0.7], size: 0.24, rate: 18, life: 0.6 },
  super_nova:   { color: [1.0, 0.6, 0.1], size: 0.40, rate: 30, life: 1.0 },
  // Stream weapons
  glow_thrower: { color: [1.0, 0.52, 0.05], size: 0.34, rate: 60, life: 0.22, gravity: [0, 0.25, 0], power: [0.2, 0.8], direction1: [-0.18, -0.05, -0.9], direction2: [0.18, 0.28, -0.25] },
  glo_burst:    { color: [1.0, 0.84, 0.22], size: 0.09, rate: 42, life: 0.16, gravity: [0, 0, 0], power: [0.9, 1.7], direction1: [-0.04, -0.02, -1.6], direction2: [0.04, 0.02, -0.9] },
};

const _activeTrails = new Map();
// ── Trail pool recycling (21.39) — reuse stopped systems instead of dispose ──
const _trailPool = [];
const MAX_TRAIL_POOL = 12;

/**
 * Create a trail particle system attached to a projectile mesh.
 * Recycles stopped systems from a pool when available.
 * @param {string} weaponId
 * @param {import('@babylonjs/core').AbstractMesh} mesh  The projectile mesh to follow
 * @returns {string} trailId for later disposal
 */
export function createProjectileTrail(weaponId, mesh) {
  if (!isInitialized || !_scene) return null;
  if (weaponId === 'lightning_bolt' || weaponId === 'glo_burst' || weaponId === 'glow_thrower') return null;
  const cfg = TRAIL_CONFIGS[weaponId] || { color: [1, 0.7, 0.2], size: 0.08, rate: 6, life: 0.5 };

  // Try to recycle a pooled system instead of allocating a new one
  let ps = _trailPool.pop() || null;
  if (ps) {
    ps.name = `trail_${weaponId}_${Date.now()}`;
    try { ps.reset(); } catch (_) {}
  } else {
    ps = new ParticleSystem(`trail_${weaponId}_${Date.now()}`, 120, _scene);
    ps.particleTexture = new Texture(PARTICLE_TEXTURE_URL, _scene);
  }
  ps.emitter = mesh;
  ps.emitRate = cfg.rate;
  ps.minLifeTime = cfg.life * 0.6;
  ps.maxLifeTime = cfg.life;
  ps.minSize = cfg.size * 0.5;
  ps.maxSize = cfg.size;
  ps.color1 = new Color4(cfg.color[0], cfg.color[1], cfg.color[2], 0.9);
  ps.color2 = new Color4(cfg.color[0] * 0.7, cfg.color[1] * 0.7, cfg.color[2] * 0.7, 0.5);
  ps.colorDead = new Color4(cfg.color[0] * 0.1, cfg.color[1] * 0.1, cfg.color[2] * 0.1, 0);
  ps.gravity = cfg.gravity ? new Vector3(cfg.gravity[0], cfg.gravity[1], cfg.gravity[2]) : new Vector3(0, -1.5, 0);
  ps.blendMode = cfg.blendMode ?? ParticleSystem.BLENDMODE_ADD;
  ps.minEmitPower = cfg.power ? cfg.power[0] : 0.5;
  ps.maxEmitPower = cfg.power ? cfg.power[1] : 1.5;
  ps.direction1 = cfg.direction1 ? new Vector3(cfg.direction1[0], cfg.direction1[1], cfg.direction1[2]) : new Vector3(-0.4, -0.2, -0.4);
  ps.direction2 = cfg.direction2 ? new Vector3(cfg.direction2[0], cfg.direction2[1], cfg.direction2[2]) : new Vector3(0.4, 0.5, 0.4);
  ps.start();

  const trailId = `trail_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  _activeTrails.set(trailId, ps);
  return trailId;
}

/**
 * Dispose a projectile trail by id.
 * Recycles the system into the pool for reuse when under MAX_TRAIL_POOL.
 */
export function disposeProjectileTrail(trailId) {
  const ps = _activeTrails.get(trailId);
  if (ps) {
    ps.stop();
    ps.emitRate = 0;
    ps.emitter = null;
    ps.targetStopDuration = 0.05;
    try { ps.reset(); } catch (_) {}
    _activeTrails.delete(trailId);
    if (_trailPool.length < MAX_TRAIL_POOL) {
      _trailPool.push(ps);
    } else {
      ps.dispose();
    }
  }
}

// ── (22.7) Explosion Particle Pool — 3rd layer of WM-style 3-layer pool ────
// Layer 1: Trail pool (above — MAX_TRAIL_POOL=12)
// Layer 2: Explosion pool (below — pre-warmed, auto-return after 1s)
// Layer 3: Mesh pool handled in colyseus-babylon-client.js
const _explosionPool = [];
const MAX_EXPLOSION_POOL = 8;

function _createExplosionSystem() {
  if (!_scene) return null;
  const ps = new ParticleSystem('explosion_pool', 40, _scene);
  const spriteSheet = _generateSpriteSheet(_scene);
  ps.particleTexture = spriteSheet || new Texture(PARTICLE_TEXTURE_URL, _scene);
  if (spriteSheet) _applySpriteSheetConfig(ps);
  ps.emitRate = 0;
  ps.minLifeTime = 0.3;
  ps.maxLifeTime = 0.8;
  ps.minSize = 0.15;
  ps.maxSize = 0.4;
  ps.color1 = new Color4(1, 0.5, 0.1, 0.9);
  ps.color2 = new Color4(1, 0.2, 0.0, 0.5);
  ps.colorDead = new Color4(0, 0, 0, 0);
  ps.gravity = new Vector3(0, 2, 0);
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.minEmitPower = 2;
  ps.maxEmitPower = 5;
  ps.start();
  return ps;
}

/**
 * (22.7) Pop an explosion system from pool, emit burst, auto-return after 1s.
 * Falls back to emitExplosionRing if pool empty and can't allocate.
 */
export function emitPooledExplosion(worldPos, color = 0xff4400) {
  if (!isInitialized) return;
  let ps = _explosionPool.pop();
  if (!ps) ps = _createExplosionSystem();
  if (!ps) { emitExplosionRing(worldPos, color, 3); return; }

  const r = ((color >> 16) & 0xff) / 255;
  const g = ((color >> 8) & 0xff) / 255;
  const b = (color & 0xff) / 255;
  ps.color1 = new Color4(r, g, b, 0.9);
  ps.color2 = new Color4(r * 0.6, g * 0.6, b * 0.6, 0.5);
  const pos = new Vector3(worldPos.x ?? 0, worldPos.y ?? 0, worldPos.z ?? 0);
  ps.emitter = pos;
  ps.direction1 = new Vector3(-3, 1, -3);
  ps.direction2 = new Vector3(3, 5, 3);
  ps.manualEmitCount = 30;

  // Auto-return to pool after 1s (WM pattern)
  setTimeout(() => {
    ps.emitRate = 0;
    if (_explosionPool.length < MAX_EXPLOSION_POOL) {
      _explosionPool.push(ps);
    } else {
      ps.dispose();
    }
  }, 1000);
}

// Pre-warm 2 explosion systems on init
function _prewarmExplosionPool() {
  for (let i = 0; i < 2; i++) {
    const ps = _createExplosionSystem();
    if (ps) _explosionPool.push(ps);
  }
}

// ── Shield Break Effect (21.10) ─────────────────────────────────────────────

/**
 * Burst of shattered shield fragments at kart position.
 */
export function emitShieldBreak(worldPos) {
  if (!isInitialized) return;
  const pos = new Vector3(worldPos.x ?? 0, (worldPos.y ?? 0) + 1, worldPos.z ?? 0);

  // Cyan/white shatter burst
  sparkleSystem.color1 = new Color4(0.3, 0.9, 1.0, 0.9);
  sparkleSystem.color2 = new Color4(0.8, 0.95, 1.0, 0.6);
  sparkleSystem.minSize = 0.12;
  sparkleSystem.maxSize = 0.3;
  emitBurst(sparkleSystem, pos, new Vector3(3, 3, 3), 25, 0.7);

  // Reset
  sparkleSystem.minSize = 0.08;
  sparkleSystem.maxSize = 0.2;
}

// ── Weapon Impact Explosion (21.8) ──────────────────────────────────────────

/**
 * Emit a damage-scaled explosion at the hit point.
 * (22.2) Uses sprite sheet texture for richer smoke/fire variety.
 * @param {object} worldPos { x, y, z }
 * @param {number} damage  Scales the explosion size (5=small poof, 60=big boom)
 * @param {number} [color=0xff4400]
 */
export function emitWeaponExplosion(worldPos, damage, color = 0xff4400) {
  if (!isInitialized) return;
  const scale = Math.max(0.3, Math.min(damage / 40, 2.0));
  const count = Math.round(8 + scale * 12);
  const radius = 1.5 + scale * 2;

  // (22.2) Apply sprite sheet to hit system for this burst
  const spriteSheet = _generateSpriteSheet(_scene);
  if (spriteSheet && hitSystem && !hitSystem._spriteSheetApplied) {
    hitSystem.particleTexture = spriteSheet;
    _applySpriteSheetConfig(hitSystem);
    hitSystem._spriteSheetApplied = true;
  }

  emitExplosionRing(worldPos, color, radius);
  emitHitBurst(worldPos, color, count);
}

/**
 * Clean up all particle systems.
 */
export function disposeParticles() {
  if (!isInitialized) return;
  [sparkSystem, flameSystem, hitSystem, sparkleSystem, skidSystem, exhaustSystem, stunSystem].forEach(sys => {
    if (sys) sys.dispose();
  });
  for (const [id, ps] of _activeTrails) { ps.dispose(); }
  _activeTrails.clear();
  for (const ps of _trailPool) ps.dispose();
  _trailPool.length = 0;
  // (22.2) Dispose sprite sheet texture
  if (_spriteSheetTexture) { _spriteSheetTexture.dispose(); _spriteSheetTexture = null; }
  // (22.7) Dispose explosion pool
  for (const ps of _explosionPool) ps.dispose();
  _explosionPool.length = 0;
  sparkSystem = flameSystem = hitSystem = sparkleSystem = skidSystem = exhaustSystem = stunSystem = null;
  isInitialized = false;
  _scene = null;
}
