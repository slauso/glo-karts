/**
 * procedural-vfx.js — Procedural GPU particle VFX system.
 *
 * All effects use Babylon.js ParticleSystem with a 1px white base texture
 * (no external asset downloads). Provides reusable effect factories for:
 *   - Weapon hit explosions (per-weapon themed)
 *   - Drift spark trails
 *   - Boost flames
 *   - Shield aura
 *   - Item collection burst
 *   - Finish-line confetti
 *   - Countdown flares
 *   - Extreme weapon impact VFX (shockwave, frost, lightning, etc.)
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';

// 1x1 white pixel PNG base64 — universal particle texture
const PIXEL_TEX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

const _activeSystems = [];
const MAX_ACTIVE_VFX = 64;

// ── Helpers ─────────────────────────────────────────────────────────────────

function _tex(scene) {
  return new Texture(PIXEL_TEX, scene, false, false);
}

/** Evict oldest particle systems when we exceed the global cap. */
function _enforceVFXCap() {
  while (_activeSystems.length > MAX_ACTIVE_VFX) {
    const oldest = _activeSystems.shift();
    oldest.stop();
    oldest.dispose();
  }
}

function _emit(scene, name, opts) {
  const ps = new ParticleSystem(name, opts.capacity || 200, scene);
  ps.particleTexture = _tex(scene);
  ps.emitter = opts.emitter || Vector3.Zero();

  ps.minLifeTime = opts.minLife || 0.3;
  ps.maxLifeTime = opts.maxLife || 1.0;
  ps.minSize = opts.minSize || 0.1;
  ps.maxSize = opts.maxSize || 0.4;
  ps.emitRate = opts.rate || 60;
  ps.minEmitPower = opts.minPower || 1;
  ps.maxEmitPower = opts.maxPower || 3;
  ps.updateSpeed = 0.01;
  ps.gravity = opts.gravity || new Vector3(0, -2, 0);

  ps.direction1 = opts.dir1 || new Vector3(-1, 1, -1);
  ps.direction2 = opts.dir2 || new Vector3(1, 3, 1);
  ps.minEmitBox = opts.minBox || new Vector3(-0.2, 0, -0.2);
  ps.maxEmitBox = opts.maxBox || new Vector3(0.2, 0, 0.2);

  ps.color1 = opts.color1 || new Color4(1, 1, 1, 1);
  ps.color2 = opts.color2 || new Color4(1, 1, 1, 0.8);
  ps.colorDead = opts.colorDead || new Color4(0.5, 0.5, 0.5, 0);
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;

  if (opts.duration) {
    ps.targetStopDuration = opts.duration;
    ps.disposeOnStop = true;
  }

  ps.start();
  _activeSystems.push(ps);
  _enforceVFXCap();
  return ps;
}

// ── Standard Effects ────────────────────────────────────────────────────────

/**
 * Generic weapon-hit explosion.
 */
export function vfxExplosion(scene, position, color = [1, 0.5, 0.1], radius = 3) {
  return _emit(scene, 'vfx-explosion', {
    capacity: 150,
    emitter: position.clone(),
    minLife: 0.2, maxLife: 0.6,
    minSize: 0.15, maxSize: radius * 0.25,
    rate: 0, // burst mode
    minPower: radius * 2, maxPower: radius * 4,
    gravity: new Vector3(0, -5, 0),
    dir1: new Vector3(-1, 0.5, -1),
    dir2: new Vector3(1, 2, 1),
    color1: new Color4(color[0], color[1], color[2], 1),
    color2: new Color4(color[0] * 0.8, color[1] * 0.6, color[2] * 0.3, 0.9),
    colorDead: new Color4(0.2, 0.2, 0.2, 0),
    duration: 0.5,
  });
}

/**
 * Drift spark trail (attached to kart mesh).
 */
export function vfxDriftSparks(scene, emitterMesh) {
  return _emit(scene, 'vfx-drift-sparks', {
    capacity: 80,
    emitter: emitterMesh,
    minLife: 0.1, maxLife: 0.3,
    minSize: 0.05, maxSize: 0.15,
    rate: 80,
    minPower: 0.5, maxPower: 2,
    gravity: new Vector3(0, -8, 0),
    dir1: new Vector3(-0.5, 0.2, -1),
    dir2: new Vector3(0.5, 0.5, 0),
    minBox: new Vector3(-0.5, -0.2, -0.8),
    maxBox: new Vector3(0.5, 0, -0.5),
    color1: new Color4(1.0, 0.8, 0.2, 1),
    color2: new Color4(1.0, 0.4, 0.1, 1),
    colorDead: new Color4(0.5, 0.2, 0.0, 0),
  });
}

/**
 * Boost flame trail (blue-orange flames behind kart).
 */
export function vfxBoostFlame(scene, emitterMesh) {
  return _emit(scene, 'vfx-boost-flame', {
    capacity: 120,
    emitter: emitterMesh,
    minLife: 0.15, maxLife: 0.4,
    minSize: 0.1, maxSize: 0.35,
    rate: 100,
    minPower: 2, maxPower: 5,
    gravity: new Vector3(0, 1, 0),
    dir1: new Vector3(-0.3, -0.1, -2),
    dir2: new Vector3(0.3, 0.3, -1),
    minBox: new Vector3(-0.3, -0.1, -1.0),
    maxBox: new Vector3(0.3, 0.1, -0.7),
    color1: new Color4(0.0, 0.6, 1.0, 1),
    color2: new Color4(1.0, 0.5, 0.0, 0.8),
    colorDead: new Color4(0.1, 0.1, 0.3, 0),
  });
}

/**
 * Shield aura (orbiting particles around kart).
 */
export function vfxShieldAura(scene, emitterMesh) {
  return _emit(scene, 'vfx-shield', {
    capacity: 60,
    emitter: emitterMesh,
    minLife: 0.5, maxLife: 1.0,
    minSize: 0.08, maxSize: 0.2,
    rate: 40,
    minPower: 0.3, maxPower: 1,
    gravity: new Vector3(0, 0.5, 0),
    dir1: new Vector3(-1, 0, -1),
    dir2: new Vector3(1, 1, 1),
    minBox: new Vector3(-1.5, -0.5, -1.5),
    maxBox: new Vector3(1.5, 1.5, 1.5),
    color1: new Color4(0.2, 0.5, 1.0, 0.7),
    color2: new Color4(0.4, 0.7, 1.0, 0.5),
    colorDead: new Color4(0.1, 0.2, 0.5, 0),
  });
}

/**
 * Item box collection burst.
 */
export function vfxItemCollect(scene, position) {
  return _emit(scene, 'vfx-item-collect', {
    capacity: 40,
    emitter: position.clone(),
    minLife: 0.2, maxLife: 0.5,
    minSize: 0.1, maxSize: 0.3,
    rate: 0,
    minPower: 3, maxPower: 6,
    gravity: new Vector3(0, -1, 0),
    dir1: new Vector3(-1, 1, -1),
    dir2: new Vector3(1, 3, 1),
    color1: new Color4(1.0, 0.9, 0.3, 1),
    color2: new Color4(1.0, 0.7, 0.1, 0.8),
    colorDead: new Color4(0.5, 0.3, 0.0, 0),
    duration: 0.4,
  });
}

/**
 * Finish-line confetti burst.
 */
export function vfxConfetti(scene, position) {
  return _emit(scene, 'vfx-confetti', {
    capacity: 300,
    emitter: position.clone(),
    minLife: 1.5, maxLife: 3.0,
    minSize: 0.1, maxSize: 0.3,
    rate: 0,
    minPower: 5, maxPower: 12,
    gravity: new Vector3(0, -3, 0),
    dir1: new Vector3(-3, 5, -3),
    dir2: new Vector3(3, 10, 3),
    color1: new Color4(1, 0, 0.5, 1),
    color2: new Color4(0, 1, 0.5, 1),
    colorDead: new Color4(0.5, 0.5, 0, 0),
    duration: 3.0,
  });
}

/**
 * Countdown flare (single burst for 3, 2, 1, GO).
 */
export function vfxCountdownFlare(scene, position, colorRGB = [1, 0.3, 0]) {
  return _emit(scene, 'vfx-countdown', {
    capacity: 50,
    emitter: position.clone(),
    minLife: 0.3, maxLife: 0.8,
    minSize: 0.1, maxSize: 0.25,
    rate: 0,
    minPower: 2, maxPower: 5,
    gravity: new Vector3(0, -4, 0),
    dir1: new Vector3(-1, 1, -1),
    dir2: new Vector3(1, 3, 1),
    color1: new Color4(colorRGB[0], colorRGB[1], colorRGB[2], 1),
    color2: new Color4(colorRGB[0], colorRGB[1] * 0.5, colorRGB[2] * 0.3, 0.7),
    colorDead: new Color4(0.1, 0.1, 0.1, 0),
    duration: 0.6,
  });
}

// ── Extreme Weapon VFX ──────────────────────────────────────────────────────

/**
 * Shockwave expanding ring particles.
 */
export function vfxShockwave(scene, position) {
  return _emit(scene, 'vfx-shockwave', {
    capacity: 250,
    emitter: position.clone(),
    minLife: 0.4, maxLife: 1.0,
    minSize: 0.15, maxSize: 0.5,
    rate: 0,
    minPower: 8, maxPower: 18,
    gravity: new Vector3(0, -1, 0),
    dir1: new Vector3(-1, 0.1, -1),
    dir2: new Vector3(1, 0.5, 1),
    minBox: new Vector3(-0.5, 0, -0.5),
    maxBox: new Vector3(0.5, 0.3, 0.5),
    color1: new Color4(0.3, 0.6, 1.0, 1),
    color2: new Color4(0.5, 0.8, 1.0, 0.7),
    colorDead: new Color4(0.1, 0.2, 0.5, 0),
    duration: 0.8,
  });
}

/**
 * Lightning strike spark shower.
 */
export function vfxLightningStrike(scene, position) {
  return _emit(scene, 'vfx-lightning', {
    capacity: 180,
    emitter: position.clone(),
    minLife: 0.1, maxLife: 0.4,
    minSize: 0.05, maxSize: 0.2,
    rate: 0,
    minPower: 3, maxPower: 10,
    gravity: new Vector3(0, -15, 0),
    dir1: new Vector3(-2, -1, -2),
    dir2: new Vector3(2, 8, 2),
    color1: new Color4(0.9, 0.95, 1.0, 1),
    color2: new Color4(0.6, 0.8, 1.0, 0.9),
    colorDead: new Color4(0.3, 0.4, 0.8, 0),
    duration: 0.5,
  });
}

/**
 * Black hole vortex pull particles.
 */
export function vfxBlackHoleVortex(scene, emitterMesh) {
  return _emit(scene, 'vfx-blackhole', {
    capacity: 200,
    emitter: emitterMesh,
    minLife: 0.5, maxLife: 1.5,
    minSize: 0.05, maxSize: 0.2,
    rate: 120,
    minPower: 0.5, maxPower: 2,
    gravity: new Vector3(0, 0, 0),
    dir1: new Vector3(-2, -1, -2),
    dir2: new Vector3(2, 1, 2),
    minBox: new Vector3(-5, -1, -5),
    maxBox: new Vector3(5, 1, 5),
    color1: new Color4(0.4, 0.1, 0.8, 0.8),
    color2: new Color4(0.6, 0.2, 1.0, 0.5),
    colorDead: new Color4(0.1, 0.0, 0.2, 0),
  });
}

/**
 * Meteor impact crater dust ring.
 */
export function vfxMeteorImpact(scene, position) {
  return _emit(scene, 'vfx-meteor-impact', {
    capacity: 120,
    emitter: position.clone(),
    minLife: 0.3, maxLife: 0.8,
    minSize: 0.2, maxSize: 0.6,
    rate: 0,
    minPower: 5, maxPower: 12,
    gravity: new Vector3(0, -8, 0),
    dir1: new Vector3(-2, 1, -2),
    dir2: new Vector3(2, 4, 2),
    color1: new Color4(1.0, 0.5, 0.1, 1),
    color2: new Color4(0.6, 0.3, 0.1, 0.8),
    colorDead: new Color4(0.2, 0.1, 0.05, 0),
    duration: 0.6,
  });
}

/**
 * Frost nova ice crystal particles.
 */
export function vfxFrostNova(scene, position) {
  return _emit(scene, 'vfx-frost', {
    capacity: 200,
    emitter: position.clone(),
    minLife: 0.5, maxLife: 1.5,
    minSize: 0.1, maxSize: 0.4,
    rate: 0,
    minPower: 5, maxPower: 12,
    gravity: new Vector3(0, 2, 0),
    dir1: new Vector3(-2, 0, -2),
    dir2: new Vector3(2, 3, 2),
    color1: new Color4(0.5, 0.9, 1.0, 1),
    color2: new Color4(0.7, 0.95, 1.0, 0.8),
    colorDead: new Color4(0.3, 0.5, 0.7, 0),
    duration: 1.0,
  });
}

/**
 * EMP spark burst.
 */
export function vfxEMPBurst(scene, position) {
  return _emit(scene, 'vfx-emp', {
    capacity: 150,
    emitter: position.clone(),
    minLife: 0.15, maxLife: 0.5,
    minSize: 0.05, maxSize: 0.15,
    rate: 0,
    minPower: 6, maxPower: 14,
    gravity: new Vector3(0, -3, 0),
    dir1: new Vector3(-2, -0.5, -2),
    dir2: new Vector3(2, 2, 2),
    color1: new Color4(0.0, 0.9, 1.0, 1),
    color2: new Color4(0.2, 0.7, 0.9, 0.8),
    colorDead: new Color4(0.0, 0.2, 0.3, 0),
    duration: 0.5,
  });
}

/**
 * Inferno flame trail particles.
 */
export function vfxInfernoTrail(scene, emitterMesh) {
  return _emit(scene, 'vfx-inferno', {
    capacity: 150,
    emitter: emitterMesh,
    minLife: 0.3, maxLife: 0.8,
    minSize: 0.15, maxSize: 0.5,
    rate: 80,
    minPower: 1, maxPower: 3,
    gravity: new Vector3(0, 3, 0),
    dir1: new Vector3(-0.5, 0.5, -0.5),
    dir2: new Vector3(0.5, 2, 0.5),
    minBox: new Vector3(-1.5, 0, -0.5),
    maxBox: new Vector3(1.5, 0.3, 0.5),
    color1: new Color4(1.0, 0.4, 0.0, 1),
    color2: new Color4(1.0, 0.7, 0.1, 0.8),
    colorDead: new Color4(0.3, 0.1, 0.0, 0),
  });
}

/**
 * Plasma beam flash.
 */
export function vfxPlasmaBeam(scene, position) {
  return _emit(scene, 'vfx-plasma', {
    capacity: 80,
    emitter: position.clone(),
    minLife: 0.1, maxLife: 0.3,
    minSize: 0.05, maxSize: 0.12,
    rate: 0,
    minPower: 10, maxPower: 25,
    gravity: new Vector3(0, 0, 0),
    dir1: new Vector3(-0.2, -0.2, -1),
    dir2: new Vector3(0.2, 0.2, 1),
    color1: new Color4(0.0, 1.0, 0.8, 1),
    color2: new Color4(0.2, 1.0, 0.9, 0.8),
    colorDead: new Color4(0.0, 0.3, 0.2, 0),
    duration: 0.3,
  });
}

/**
 * Vortex tornado debris spiral.
 */
export function vfxTornadoSpiral(scene, emitterMesh) {
  return _emit(scene, 'vfx-tornado', {
    capacity: 180,
    emitter: emitterMesh,
    minLife: 0.5, maxLife: 1.2,
    minSize: 0.08, maxSize: 0.25,
    rate: 100,
    minPower: 1, maxPower: 4,
    gravity: new Vector3(0, 3, 0),
    dir1: new Vector3(-2, 1, -2),
    dir2: new Vector3(2, 5, 2),
    minBox: new Vector3(-2, 0, -2),
    maxBox: new Vector3(2, 6, 2),
    color1: new Color4(0.5, 0.6, 0.7, 0.8),
    color2: new Color4(0.6, 0.5, 0.4, 0.6),
    colorDead: new Color4(0.3, 0.3, 0.3, 0),
  });
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

/**
 * Stop and dispose a specific particle system.
 */
export function stopVFX(ps) {
  if (!ps) return;
  ps.stop();
  ps.dispose();
  const idx = _activeSystems.indexOf(ps);
  if (idx !== -1) _activeSystems.splice(idx, 1);
}

/**
 * Dispose all active VFX particle systems.
 */
export function disposeAllVFX() {
  for (const ps of _activeSystems) {
    try { ps.stop(); ps.dispose(); } catch { /* already disposed */ }
  }
  _activeSystems.length = 0;
}

/**
 * Get count of active particle systems (for perf monitoring).
 */
export function getActiveVFXCount() {
  return _activeSystems.length;
}
