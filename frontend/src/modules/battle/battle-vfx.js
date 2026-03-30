/**
 * battle-vfx.js — Enhanced battle-mode visual effects system.
 *
 * Provides spectacular weapon-specific VFX including:
 *  - GPU-accelerated particle explosions with per-weapon color palettes
 *  - Muzzle flash with point-light pulse on fire
 *  - Weapon-specific impact VFX (frost shatter, fire burst, electric arcs)
 *  - Screen-space damage feedback (vignette, chromatic aberration)
 *  - Kill celebration effects (confetti burst, slow-mo flash)
 *  - Shockwave ring mesh for AOE weapons
 *  - Persistent fire/ice ground decals
 *
 * Adapted patterns:
 *  - Particle burst sizing from Babylon.js particle playground patterns
 *  - Shockwave ring expansion from wizard-masters impact VFX
 *  - Point light flash timing from projectile-fire feedback patterns
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import { getBattleTexture } from './battle-assets.js';
import {
  pulseBloom, pulseChromatic, stampImpactDecal, enhancedShake,
  addClusteredLight, removeClusteredLight,
  createAdaptiveParticleSystem,
} from './weapon-fx-enhance.js';
import {
  scaleParticles, scaleBurst, maxImpactLights, getTier, TIER,
  clusteredLightsEnabled, gpuParticlesEnabled, runtimeFXBudget, runtimePressure,
} from '../perf-tier.js';

// 1x1 white pixel fallback for particle texture
const PIXEL_TEX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

// Live-tunable fission VFX controls for height, density, linger, and sky contamination.
export const FINAL_FISSION_TUNING = Object.seal({
  heightScale: 1.0,
  darkness: 1.0,
  lingerScale: 1.0,
  skyContamination: 1.0,
});

if (typeof globalThis !== 'undefined') {
  globalThis.__gloDebug = globalThis.__gloDebug || {};
  globalThis.__gloDebug.finalFissionTuning = FINAL_FISSION_TUNING;
}

// ── Impact PointLight pool ─────────────────────────────────────────────────
// Instead of creating/disposing a PointLight per impact (expensive on mobile),
// we pool a fixed number and reuse them.
let _lightPool = [];
let _lightPoolInUse = 0;

function _acquireLight(name, position) {
  if (!_scene) return null;
  // When clustered lighting is active, bypass pool limits
  const useClustered = clusteredLightsEnabled();
  if (!useClustered && _lightPoolInUse >= maxImpactLights()) return null;
  let light;
  if (_lightPool.length > 0) {
    light = _lightPool.pop();
    light.position.copyFrom(position);
    light.setEnabled(true);
  } else {
    const { PointLight: PL } = { PointLight };
    light = new PL(name, position.clone(), _scene);
  }
  _lightPoolInUse++;
  // Register with clustered container for efficient batching
  if (useClustered) addClusteredLight(light);
  return light;
}

function _releaseLight(light) {
  if (!light) return;
  // Unregister from clustered container
  if (clusteredLightsEnabled()) removeClusteredLight(light);
  light.setEnabled(false);
  light.intensity = 0;
  _lightPool.push(light);
  _lightPoolInUse = Math.max(0, _lightPoolInUse - 1);
}

// ── Per-weapon color palettes ──────────────────────────────────────────────
const WEAPON_COLORS = {
  bowling_ball: { primary: [0.67, 0.87, 1.0], secondary: [0.4, 0.6, 1.0] },
  cake:         { primary: [1.0, 0.8, 0.27], secondary: [1.0, 0.5, 0.1] },
  plunger:      { primary: [1.0, 0.2, 0.0], secondary: [0.8, 0.1, 0.0] },
  nitro:        { primary: [0.0, 1.0, 0.8], secondary: [0.0, 0.7, 0.5] },
  missile:      { primary: [1.0, 0.0, 0.4], secondary: [1.0, 0.5, 0.0] },
  crimson_hydra:{ primary: [1.0, 0.08, 0.24], secondary: [1.0, 0.42, 0.12] },
  cannon:       { primary: [1.0, 0.85, 0.3], secondary: [0.9, 0.5, 0.1] },
  frostAxe:     { primary: [0.4, 0.8, 1.0], secondary: [0.2, 0.5, 1.0] },
  moltenDagger: { primary: [1.0, 0.4, 0.0], secondary: [1.0, 0.2, 0.0] },
  grenade:      { primary: [0.33, 0.42, 0.18], secondary: [0.8, 0.6, 0.0] },
  guided_missile: { primary: [1.0, 0.0, 0.4], secondary: [1.0, 0.3, 0.7] },
  shockwave_cannon: { primary: [0.27, 0.53, 1.0], secondary: [0.6, 0.8, 1.0] },
  thunderstrike:    { primary: [0.8, 0.87, 1.0], secondary: [1.0, 1.0, 0.6] },
  black_hole:       { primary: [0.33, 0.0, 0.67], secondary: [0.1, 0.0, 0.2] },
  frost_nova:       { primary: [0.4, 0.8, 1.0], secondary: [0.8, 0.95, 1.0] },
  plasma_railgun:   { primary: [0.0, 1.0, 0.8], secondary: [0.0, 0.8, 1.0] },
  // Wizard-Masters elemental weapons
  fireball:         { primary: [1.0, 0.5, 0.0], secondary: [1.0, 0.2, 0.0] },
  toxic_spread:     { primary: [0.2, 0.8, 0.1], secondary: [0.1, 0.5, 0.0] },
  ice_lance:        { primary: [0.5, 0.9, 1.0], secondary: [0.3, 0.6, 0.9] },
  tornado:          { primary: [0.6, 0.9, 0.7], secondary: [0.4, 0.7, 0.5] },
  super_nova:       { primary: [1.0, 0.7, 0.0], secondary: [1.0, 0.3, 0.0] },
  rock_barrage:     { primary: [0.5, 0.4, 0.3], secondary: [0.6, 0.45, 0.3] },
  lightning_bolt:   { primary: [0.9, 0.9, 1.0], secondary: [0.6, 0.6, 1.0] },
  wind_slash:       { primary: [0.6, 0.9, 0.7], secondary: [0.3, 0.6, 0.4] },
  toxic_cloud:      { primary: [0.15, 0.6, 0.1], secondary: [0.1, 0.4, 0.05] },
  // Stream weapons (glo-themed — bright neon defaults)
  glow_thrower:     { primary: [1.0, 0.45, 0.0], secondary: [1.0, 0.2, 0.0] },
  glo_burst:        { primary: [1.0, 0.85, 0.1], secondary: [1.0, 0.6, 0.0] },
  // Renamed weapons
  pirateleportation: { primary: [0.6, 0.2, 0.9], secondary: [0.8, 0.4, 1.0] },
  ludicrous_mode:    { primary: [1.0, 0.0, 1.0], secondary: [0.5, 0.0, 1.0] },
  default:          { primary: [1.0, 0.3, 0.0], secondary: [1.0, 0.6, 0.0] },
};

function getWeaponPalette(subType) {
  return WEAPON_COLORS[subType] || WEAPON_COLORS.default;
}

let _scene = null;
let _pixelTexture = null;
let _flameTexture = null;
let _sparkTexture = null;
let _smokeTexture = null;
let _flareTexture = null;
let _activeFissionCleanup = null;
let _observers = [];

// ── Initialization ─────────────────────────────────────────────────────────
export function initBattleVFX(scene) {
  _scene = scene;
  _pixelTexture = new Texture(PIXEL_TEX, scene);
  // Try to grab real textures from battle-assets (loaded async, may be null initially)
  _flameTexture = getBattleTexture('flame_03');
  _sparkTexture = getBattleTexture('spark_05');
  _smokeTexture = getBattleTexture('smoke_04');
  _flareTexture = getBattleTexture('flare');
}

/** Get the best available texture for a given effect type. */
function _tex(preferred) {
  return preferred || _flameTexture || _pixelTexture;
}

export function disposeBattleVFX() {
  _observers.forEach(o => {
    try { _scene?.onBeforeRenderObservable?.remove(o); } catch (_) {}
  });
  _observers = [];
  _lightPool.forEach(l => { try { l.dispose(); } catch (_) {} });
  _lightPool = [];
  _lightPoolInUse = 0;
  _pixelTexture?.dispose();
  _pixelTexture = null;
  _scene = null;
}

// ── Muzzle Flash ───────────────────────────────────────────────────────────
/**
 * Emit a brief point-light + particle burst at the weapon muzzle.
 * Adapted from wizard-masters projectile spawn flash pattern.
 */
export function emitMuzzleFlash(position, subType) {
  if (!_scene) return;
  const palette = getWeaponPalette(subType);
  const c = palette.primary;
  const isGloBurst = subType === 'glo_burst';
  const lightPeak = isGloBurst ? 11 : 8;
  const lightRange = isGloBurst ? 14 : 12;
  const flashDurationMs = isGloBurst ? 78 : 100;
  const particleCount = isGloBurst ? scaleBurst(18) : scaleBurst(12);
  const minLife = isGloBurst ? 0.035 : 0.05;
  const maxLife = isGloBurst ? 0.09 : 0.15;
  const minSize = isGloBurst ? 0.08 : 0.15;
  const maxSize = isGloBurst ? 0.26 : 0.4;
  const minPower = isGloBurst ? 5 : 3;
  const maxPower = isGloBurst ? 13 : 8;

  // Point light flash — 80ms pulse
  const light = _acquireLight('muzzle_flash', position);
  if (light) {
    light.diffuse = new Color3(c[0], c[1], c[2]);
    light.specular = new Color3(c[0] * 0.5, c[1] * 0.5, c[2] * 0.5);
    light.intensity = lightPeak;
    light.range = lightRange;
  }

  // Quick particle burst (12 particles, short life)
  const ps = new ParticleSystem('muzzle_ps', scaleBurst(isGloBurst ? 22 : 16), _scene);
  ps.particleTexture = _tex(isGloBurst ? _flareTexture : _sparkTexture);
  ps.emitter = position.clone();
  ps.minLifeTime = minLife;
  ps.maxLifeTime = maxLife;
  ps.minSize = minSize;
  ps.maxSize = maxSize;
  ps.emitRate = 0;
  ps.manualEmitCount = particleCount;
  ps.color1 = new Color4(c[0], c[1], c[2], 1.0);
  ps.color2 = new Color4(c[0] * 0.5, c[1] * 0.5, c[2] * 0.5, 0.8);
  ps.colorDead = new Color4(0, 0, 0, 0);
  ps.minEmitPower = minPower;
  ps.maxEmitPower = maxPower;
  ps.direction1 = isGloBurst ? new Vector3(-0.55, -0.2, -1.2) : new Vector3(-1, -0.5, -1);
  ps.direction2 = isGloBurst ? new Vector3(0.55, 0.8, 1.6) : new Vector3(1, 1.5, 1);
  ps.gravity = isGloBurst ? new Vector3(0, -1.5, 0) : new Vector3(0, -4, 0);
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.start();

  let flashPlane = null;
  let flashMat = null;
  if (isGloBurst) {
    flashPlane = MeshBuilder.CreatePlane('muzzle_flash_plane', { width: 0.72, height: 0.26 }, _scene);
    flashMat = new StandardMaterial('muzzle_flash_plane_mat', _scene);
    flashMat.emissiveColor = new Color3(c[0], c[1], c[2]);
    flashMat.diffuseColor = new Color3(c[0] * 0.08, c[1] * 0.08, c[2] * 0.08);
    flashMat.alpha = 0.42;
    flashMat.backFaceCulling = false;
    flashPlane.material = flashMat;
    flashPlane.billboardMode = 7;
    flashPlane.position.copyFrom(position);
  }

  // Fade and clean up
  let elapsed = 0;
  const obs = _scene.onBeforeRenderObservable.add(() => {
    elapsed += _scene.getEngine().getDeltaTime();
    const t = elapsed / flashDurationMs;
    const fade = Math.max(0, 1 - t);
    if (light) light.intensity = lightPeak * fade;
    if (flashPlane && flashMat) {
      flashMat.alpha = 0.42 * fade;
      flashPlane.scaling.x = 1 + (1 - fade) * 0.85;
      flashPlane.scaling.y = 1 + (1 - fade) * 0.22;
      flashPlane.rotation.z += _scene.getEngine().getDeltaTime() * 0.001 * 14;
    }
    if (elapsed > (flashDurationMs + 20)) {
      _releaseLight(light);
      ps.dispose();
      flashPlane?.dispose();
      flashMat?.dispose();
      _scene.onBeforeRenderObservable.remove(obs);
      const idx = _observers.indexOf(obs);
      if (idx >= 0) _observers.splice(idx, 1);
    }
  });
  _observers.push(obs);
}

// ── Weapon Impact Explosion ────────────────────────────────────────────────
/**
 * Spectacular weapon-specific impact explosion with debris, ring, and light.
 * Much more dramatic than the base emitWeaponExplosion.
 */
export function emitBattleExplosion(position, subType, damage = 30) {
  if (!_scene) return;
  const palette = getWeaponPalette(subType);
  const c = palette.primary;
  const c2 = palette.secondary;
  const scale = Math.min(2.0, 0.8 + (damage / 60));
  const useGPU = gpuParticlesEnabled();

  // ── Central burst (high particle count — GPU when available) ──────────
  const coreCount = useGPU ? 800 : 80;
  const { ps } = useGPU
    ? createAdaptiveParticleSystem('explosion_core', coreCount, _scene)
    : { ps: new ParticleSystem('explosion_core', scaleBurst(80), _scene) };
  ps.particleTexture = _tex(_flameTexture);
  ps.emitter = position.clone();
  ps.minLifeTime = 0.25;
  ps.maxLifeTime = 0.8;
  ps.minSize = 0.15 * scale;
  ps.maxSize = 0.7 * scale;
  ps.emitRate = 0;
  ps.manualEmitCount = useGPU ? coreCount : scaleBurst(80);
  ps.color1 = new Color4(c[0], c[1], c[2], 1.0);
  ps.color2 = new Color4(c2[0], c2[1], c2[2], 0.9);
  ps.colorDead = new Color4(c[0] * 0.2, c[1] * 0.2, c[2] * 0.2, 0);
  ps.minEmitPower = 8 * scale;
  ps.maxEmitPower = 22 * scale;
  ps.direction1 = new Vector3(-1.2, -0.5, -1.2);
  ps.direction2 = new Vector3(1.2, 3, 1.2);
  ps.gravity = new Vector3(0, -10, 0);
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  if (useGPU) ps.maxActiveParticleCount = coreCount;
  ps.start();

  // ── Smoke ring (secondary emitter, slower, larger) ───────────────────
  const smoke = new ParticleSystem('explosion_smoke', scaleBurst(60), _scene);
  smoke.particleTexture = _tex(_smokeTexture);
  smoke.emitter = position.clone();
  smoke.minLifeTime = 0.5;
  smoke.maxLifeTime = 1.4;
  smoke.minSize = 0.4 * scale;
  smoke.maxSize = 1.2 * scale;
  smoke.emitRate = 0;
  smoke.manualEmitCount = scaleBurst(40);
  smoke.color1 = new Color4(0.35, 0.3, 0.25, 0.6);
  smoke.color2 = new Color4(0.15, 0.15, 0.15, 0.3);
  smoke.colorDead = new Color4(0, 0, 0, 0);
  smoke.minEmitPower = 3;
  smoke.maxEmitPower = 8;
  smoke.direction1 = new Vector3(-1.2, 0, -1.2);
  smoke.direction2 = new Vector3(1.2, 1, 1.2);
  smoke.gravity = new Vector3(0, 3, 0); // smoke rises
  smoke.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  smoke.start();

  // ── Spark debris (hot sparks flying outward) ─────────────────────────
  const sparks = new ParticleSystem('explosion_sparks', scaleBurst(30), _scene);
  sparks.particleTexture = _tex(_sparkTexture);
  sparks.emitter = position.clone();
  sparks.minLifeTime = 0.3;
  sparks.maxLifeTime = 0.9;
  sparks.minSize = 0.03;
  sparks.maxSize = 0.08;
  sparks.emitRate = 0;
  sparks.manualEmitCount = scaleBurst(25);
  sparks.color1 = new Color4(1.0, 0.9, 0.5, 1.0);
  sparks.color2 = new Color4(1.0, 0.6, 0.2, 0.8);
  sparks.colorDead = new Color4(0.5, 0.2, 0, 0);
  sparks.minEmitPower = 12;
  sparks.maxEmitPower = 28;
  sparks.direction1 = new Vector3(-1, 0, -1);
  sparks.direction2 = new Vector3(1, 3, 1);
  sparks.gravity = new Vector3(0, -15, 0);
  sparks.blendMode = ParticleSystem.BLENDMODE_ADD;
  sparks.start();

  // ── Expanding shockwave ring mesh ────────────────────────────────────
  const ring = MeshBuilder.CreateTorus('shockring', {
    diameter: 0.5, thickness: 0.12, tessellation: 32,
  }, _scene);
  ring.position.copyFrom(position);
  ring.position.y += 0.3;
  const ringMat = new StandardMaterial('shockringMat', _scene);
  ringMat.diffuseColor = new Color3(c[0], c[1], c[2]);
  ringMat.emissiveColor = new Color3(c[0], c[1], c[2]);
  ringMat.alpha = 0.9;
  ringMat.disableLighting = true;
  ring.material = ringMat;

  // ── Flash light (pooled) ─────────────────────────────────────────────
  const light = _acquireLight('explo_light', position);
  if (light) {
    light.diffuse = new Color3(c[0], c[1], c[2]);
    light.intensity = 18 * scale;
    light.range = 28 * scale;
  }

  let elapsed = 0;
  const ringDuration = 500; // ms
  const obs = _scene.onBeforeRenderObservable.add(() => {
    elapsed += _scene.getEngine().getDeltaTime();
    const t = elapsed / ringDuration;

    // Expand ring
    const ringScale = 1 + t * 10 * scale;
    ring.scaling.setAll(ringScale);
    ringMat.alpha = Math.max(0, 0.9 * (1 - t));

    // Fade light
    if (light) light.intensity = 18 * scale * Math.max(0, 1 - t * 1.3);

    if (elapsed > ringDuration + 300) {
      ring.dispose();
      ringMat.dispose();
      _releaseLight(light);
      ps.dispose();
      smoke.dispose();
      sparks.dispose();
      _scene.onBeforeRenderObservable.remove(obs);
      const idx = _observers.indexOf(obs);
      if (idx >= 0) _observers.splice(idx, 1);
    }
  });
  _observers.push(obs);
}

// ── Frost Impact ───────────────────────────────────────────────────────────
export function emitFrostImpact(position) {
  if (!_scene) return;
  const ps = new ParticleSystem('frost_impact', scaleBurst(60), _scene);
  ps.particleTexture = _tex(_sparkTexture);
  ps.emitter = position.clone();
  ps.minLifeTime = 0.3;
  ps.maxLifeTime = 0.8;
  ps.minSize = 0.1;
  ps.maxSize = 0.35;
  ps.emitRate = 0;
  ps.manualEmitCount = scaleBurst(40);
  ps.color1 = new Color4(0.4, 0.85, 1.0, 1.0);
  ps.color2 = new Color4(0.8, 0.95, 1.0, 0.9);
  ps.colorDead = new Color4(0.6, 0.8, 1.0, 0);
  ps.minEmitPower = 4;
  ps.maxEmitPower = 10;
  ps.direction1 = new Vector3(-1, 0.5, -1);
  ps.direction2 = new Vector3(1, 2, 1);
  ps.gravity = new Vector3(0, -2, 0);
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.start();
  setTimeout(() => ps.dispose(), 1200);
}

// ── Lightning Strike ───────────────────────────────────────────────────────
export function emitLightningStrike(position) {
  if (!_scene) return;
  // Flash column of light meshes
  const segments = 6;
  const meshes = [];
  for (let i = 0; i < segments; i++) {
    const seg = MeshBuilder.CreateCylinder('lseg' + i, {
      height: 3, diameter: 0.15 + Math.random() * 0.1, tessellation: 6,
    }, _scene);
    seg.position.copyFrom(position);
    seg.position.y += i * 2.8 + 1;
    seg.position.x += (Math.random() - 0.5) * 0.6;
    seg.position.z += (Math.random() - 0.5) * 0.6;
    const mat = new StandardMaterial('lmat' + i, _scene);
    mat.emissiveColor = new Color3(0.8, 0.9, 1.0);
    mat.disableLighting = true;
    mat.alpha = 0.9;
    seg.material = mat;
    meshes.push(seg);
  }

  // Bright flash (pooled)
  const light = _acquireLight('lightning_light', position.clone().addInPlace(new Vector3(0, 5, 0)));
  if (light) {
    light.diffuse = new Color3(0.8, 0.9, 1.0);
    light.intensity = 20;
    light.range = 30;
  }

  let elapsed = 0;
  const obs = _scene.onBeforeRenderObservable.add(() => {
    elapsed += _scene.getEngine().getDeltaTime();
    const t = elapsed / 300;
    const flicker = Math.random() > 0.3 ? 1 : 0.2;
    meshes.forEach(m => { if (m.material) m.material.alpha = Math.max(0, (1 - t) * flicker); });
    if (light) light.intensity = 20 * Math.max(0, 1 - t) * flicker;
    if (elapsed > 350) {
      meshes.forEach(m => m.dispose());
      _releaseLight(light);
      _scene.onBeforeRenderObservable.remove(obs);
      const idx = _observers.indexOf(obs);
      if (idx >= 0) _observers.splice(idx, 1);
    }
  });
  _observers.push(obs);
}

// ── Black Hole Vortex ──────────────────────────────────────────────────────
export function emitBlackHoleVortex(position, duration = 3000) {
  if (!_scene) return;
  const sphere = MeshBuilder.CreateSphere('bh_core', { diameter: 1, segments: 16 }, _scene);
  sphere.position.copyFrom(position);
  const mat = new StandardMaterial('bh_mat', _scene);
  mat.diffuseColor = new Color3(0.1, 0, 0.15);
  mat.emissiveColor = new Color3(0.3, 0, 0.5);
  mat.alpha = 0.85;
  sphere.material = mat;

  // Swirling ring
  const ring = MeshBuilder.CreateTorus('bh_ring', {
    diameter: 3, thickness: 0.1, tessellation: 32,
  }, _scene);
  ring.position.copyFrom(position);
  const ringMat = new StandardMaterial('bh_ringMat', _scene);
  ringMat.emissiveColor = new Color3(0.6, 0, 1.0);
  ringMat.disableLighting = true;
  ringMat.alpha = 0.6;
  ring.material = ringMat;

  // Inward-pulling particles
  const ps = new ParticleSystem('bh_pull', scaleParticles(60), _scene);
  ps.particleTexture = _tex(_flareTexture);
  ps.emitter = position.clone();
  ps.createSphereEmitter(6);
  ps.minLifeTime = 0.5;
  ps.maxLifeTime = 1.2;
  ps.minSize = 0.05;
  ps.maxSize = 0.15;
  ps.emitRate = scaleParticles(40);
  ps.color1 = new Color4(0.5, 0, 0.8, 0.8);
  ps.color2 = new Color4(0.8, 0, 1.0, 0.4);
  ps.colorDead = new Color4(0, 0, 0, 0);
  ps.minEmitPower = -4; // Pull inward
  ps.maxEmitPower = -1;
  ps.gravity = Vector3.Zero();
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.start();

  let elapsed = 0;
  const obs = _scene.onBeforeRenderObservable.add(() => {
    elapsed += _scene.getEngine().getDeltaTime();
    const t = elapsed / duration;
    ring.rotation.y += 0.08;
    ring.rotation.x = Math.sin(elapsed * 0.003) * 0.3;
    sphere.scaling.setAll(1 + Math.sin(elapsed * 0.01) * 0.1);
    if (t > 0.8) {
      const fade = 1 - (t - 0.8) / 0.2;
      mat.alpha = 0.85 * fade;
      ringMat.alpha = 0.6 * fade;
    }
    if (elapsed > duration) {
      sphere.dispose();
      ring.dispose();
      mat.dispose();
      ringMat.dispose();
      ps.dispose();
      _scene.onBeforeRenderObservable.remove(obs);
      const idx = _observers.indexOf(obs);
      if (idx >= 0) _observers.splice(idx, 1);
    }
  });
  _observers.push(obs);
}

// ── Kill Celebration (confetti burst) ──────────────────────────────────────
export function emitKillCelebration(position) {
  if (!_scene) return;
  const colors = [
    [1, 0, 0], [0, 1, 0], [0, 0.5, 1], [1, 1, 0], [1, 0, 1], [0, 1, 1],
  ];
  const ps = new ParticleSystem('kill_confetti', scaleBurst(100), _scene);
  ps.particleTexture = _tex(_sparkTexture);
  ps.emitter = position.clone().addInPlace(new Vector3(0, 2, 0));
  ps.minLifeTime = 0.8;
  ps.maxLifeTime = 2.0;
  ps.minSize = 0.08;
  ps.maxSize = 0.2;
  ps.emitRate = 0;
  ps.manualEmitCount = scaleBurst(80);
  const pick = colors[Math.floor(Math.random() * colors.length)];
  const pick2 = colors[Math.floor(Math.random() * colors.length)];
  ps.color1 = new Color4(pick[0], pick[1], pick[2], 1);
  ps.color2 = new Color4(pick2[0], pick2[1], pick2[2], 1);
  ps.colorDead = new Color4(0.5, 0.5, 0.5, 0);
  ps.minEmitPower = 5;
  ps.maxEmitPower = 14;
  ps.direction1 = new Vector3(-1, 1, -1);
  ps.direction2 = new Vector3(1, 3, 1);
  ps.gravity = new Vector3(0, -12, 0);
  ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  ps.start();
  setTimeout(() => ps.dispose(), 3000);
}

// ── Shockwave Ring (AOE weapons) ───────────────────────────────────────────
export function emitShockwaveRing(position, radius = 15, color = [0.27, 0.53, 1.0]) {
  if (!_scene) return;
  const ring = MeshBuilder.CreateTorus('aoe_ring', {
    diameter: 1, thickness: 0.15, tessellation: 48,
  }, _scene);
  ring.position.copyFrom(position);
  ring.position.y += 0.5;
  const mat = new StandardMaterial('aoe_ring_mat', _scene);
  mat.emissiveColor = new Color3(color[0], color[1], color[2]);
  mat.disableLighting = true;
  mat.alpha = 0.7;
  ring.material = mat;

  const expandDuration = 500;
  let elapsed = 0;
  const obs = _scene.onBeforeRenderObservable.add(() => {
    elapsed += _scene.getEngine().getDeltaTime();
    const t = elapsed / expandDuration;
    const scale = 1 + t * radius;
    ring.scaling.set(scale, 1, scale);
    mat.alpha = Math.max(0, 0.7 * (1 - t));
    if (elapsed > expandDuration + 100) {
      ring.dispose();
      mat.dispose();
      _scene.onBeforeRenderObservable.remove(obs);
      const idx = _observers.indexOf(obs);
      if (idx >= 0) _observers.splice(idx, 1);
    }
  });
  _observers.push(obs);
}

// ── Fire Burst (for fire-type weapons) ─────────────────────────────────────
export function emitFireBurst(position) {
  if (!_scene) return;
  const ps = new ParticleSystem('fire_burst', scaleBurst(60), _scene);
  ps.particleTexture = _tex(_flameTexture);
  ps.emitter = position.clone();
  ps.minLifeTime = 0.15;
  ps.maxLifeTime = 0.5;
  ps.minSize = 0.15;
  ps.maxSize = 0.5;
  ps.emitRate = 0;
  ps.manualEmitCount = scaleBurst(40);
  ps.color1 = new Color4(1.0, 0.6, 0.0, 1.0);
  ps.color2 = new Color4(1.0, 0.2, 0.0, 0.8);
  ps.colorDead = new Color4(0.3, 0.1, 0.0, 0);
  ps.minEmitPower = 5;
  ps.maxEmitPower = 12;
  ps.direction1 = new Vector3(-0.5, 0.5, -0.5);
  ps.direction2 = new Vector3(0.5, 3, 0.5);
  ps.gravity = new Vector3(0, 3, 0); // fire rises
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.start();
  setTimeout(() => ps.dispose(), 800);
}

// ── Camera Shake ───────────────────────────────────────────────────────────
/**
 * Shake the camera with configurable intensity and duration.
 * Adapted from wizard-masters camera feedback on heavy hit.
 */
let _shakeObserver = null;
export function shakeCamera(camera, intensity = 0.3, durationMs = 300) {
  if (!camera || !_scene) return;
  if (_shakeObserver) {
    try { _scene.onBeforeRenderObservable.remove(_shakeObserver); } catch (_) {}
  }
  const originalRadius = camera.radius;
  const originalHeight = camera.heightOffset;
  let elapsed = 0;
  _shakeObserver = _scene.onBeforeRenderObservable.add(() => {
    elapsed += _scene.getEngine().getDeltaTime();
    const t = elapsed / durationMs;
    const decay = Math.max(0, 1 - t);
    const shake = intensity * decay;
    camera.heightOffset = originalHeight + (Math.random() - 0.5) * shake * 2;
    camera.radius = originalRadius + (Math.random() - 0.5) * shake;
    if (elapsed > durationMs) {
      camera.heightOffset = originalHeight;
      camera.radius = originalRadius;
      _scene.onBeforeRenderObservable.remove(_shakeObserver);
      _shakeObserver = null;
    }
  });
}

// ── Hit Marker Flash ───────────────────────────────────────────────────────
/**
 * Create a brief screen-space hit marker when the player confirms a hit.
 */
export function showHitMarkerVFX() {
  const marker = document.createElement('div');
  marker.className = 'battle-hit-marker';
  marker.innerHTML = `
    <svg width="40" height="40" viewBox="0 0 40 40">
      <line x1="12" y1="12" x2="18" y2="18" stroke="white" stroke-width="2.5"/>
      <line x1="28" y1="12" x2="22" y2="18" stroke="white" stroke-width="2.5"/>
      <line x1="12" y1="28" x2="18" y2="22" stroke="white" stroke-width="2.5"/>
      <line x1="28" y1="28" x2="22" y2="22" stroke="white" stroke-width="2.5"/>
    </svg>
  `;
  Object.assign(marker.style, {
    position: 'fixed', top: '50%', left: '50%',
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'none', zIndex: '9999',
    opacity: '1', transition: 'opacity 0.25s, transform 0.25s',
  });
  document.body.appendChild(marker);
  requestAnimationFrame(() => {
    marker.style.opacity = '0';
    marker.style.transform = 'translate(-50%, -50%) scale(1.5)';
    setTimeout(() => marker.remove(), 300);
  });
}

// ── Multi-Kill Banner ──────────────────────────────────────────────────────
const MULTI_KILL_LABELS = ['', '', 'DOUBLE KILL', 'TRIPLE KILL', 'QUAD KILL', 'MEGA KILL', 'ULTRA KILL'];

export function showMultiKillBanner(count) {
  if (count < 2) return;
  const label = MULTI_KILL_LABELS[Math.min(count, MULTI_KILL_LABELS.length - 1)] || `${count}x KILL`;
  const banner = document.createElement('div');
  banner.className = 'battle-multikill-banner';
  banner.textContent = label;
  Object.assign(banner.style, {
    position: 'fixed', top: '25%', left: '50%',
    transform: 'translate(-50%, -50%) scale(0.5)',
    color: '#ffcc00', fontSize: '2.5rem', fontWeight: 'bold',
    textShadow: '0 0 10px #ff6600, 0 0 20px #ff3300',
    fontFamily: '"Orbitron", "Exo 2", sans-serif',
    letterSpacing: '3px', pointerEvents: 'none', zIndex: '10001',
    opacity: '0', transition: 'opacity 0.2s, transform 0.4s cubic-bezier(0.2,1.5,0.4,1)',
  });
  document.body.appendChild(banner);
  requestAnimationFrame(() => {
    banner.style.opacity = '1';
    banner.style.transform = 'translate(-50%, -50%) scale(1)';
    setTimeout(() => {
      banner.style.opacity = '0';
      banner.style.transform = 'translate(-50%, -50%) scale(1.3)';
      setTimeout(() => banner.remove(), 500);
    }, 1800);
  });
}

// ── Damage Vignette ────────────────────────────────────────────────────────
/**
 * Flash a red vignette border on damage intake.
 */
export function flashDamageVignette(damage = 30) {
  const intensity = Math.min(0.5, damage / 100);
  const el = document.createElement('div');
  el.className = 'battle-damage-vignette';
  Object.assign(el.style, {
    position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '9998',
    background: `radial-gradient(ellipse at center, transparent 50%, rgba(255,0,0,${intensity}) 100%)`,
    opacity: '1', transition: 'opacity 0.4s',
  });
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 450);
  });
}

// ── Dispatch the right VFX for a weapon impact ─────────────────────────────
export function emitStreamImpactVFX(position, subType = 'glo_burst') {
  if (!_scene || !position) return;
  const palette = getWeaponPalette(subType);
  const emitter = position.clone ? position.clone() : new Vector3(position.x, position.y, position.z);

  const ps = new ParticleSystem(`streamImpact_${subType}`, scaleBurst(subType === 'glow_thrower' ? 24 : 14), _scene);
  ps.particleTexture = _tex(_sparkTexture || _flareTexture);
  ps.emitter = emitter;
  ps.color1 = new Color4(palette.primary[0], palette.primary[1], palette.primary[2], 0.95);
  ps.color2 = new Color4(
    Math.min(1, palette.secondary[0] + 0.15),
    Math.min(1, palette.secondary[1] + 0.15),
    Math.min(1, palette.secondary[2] + 0.15),
    0.55,
  );
  ps.colorDead = new Color4(palette.primary[0] * 0.35, palette.primary[1] * 0.35, palette.primary[2] * 0.35, 0);
  ps.minLifeTime = 0.05;
  ps.maxLifeTime = subType === 'glow_thrower' ? 0.18 : 0.12;
  ps.minSize = 0.08;
  ps.maxSize = subType === 'glow_thrower' ? 0.26 : 0.18;
  ps.emitRate = 0;
  ps.manualEmitCount = scaleBurst(subType === 'glow_thrower' ? 18 : 10);
  ps.minEmitPower = 1.5;
  ps.maxEmitPower = subType === 'glow_thrower' ? 5.5 : 4.0;
  ps.direction1 = new Vector3(-0.6, 0.1, -0.6);
  ps.direction2 = new Vector3(0.6, 0.9, 0.6);
  ps.gravity = new Vector3(0, -2.2, 0);
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.disposeOnStop = true;
  ps.targetStopDuration = 0.08;
  ps.start();

  const light = _acquireLight(`streamImpactLight_${subType}`, emitter);
  if (light) {
    light.diffuse = new Color3(palette.primary[0], palette.primary[1], palette.primary[2]);
    light.specular = new Color3(palette.secondary[0], palette.secondary[1], palette.secondary[2]);
    light.intensity = subType === 'glow_thrower' ? 1.5 : 1.0;
    setTimeout(() => _releaseLight(light), 90);
  }
}

export function emitWeaponImpactVFX(position, subType, damage) {
  if (!position) return;

  // Always emit the main explosion
  emitBattleExplosion(position, subType, damage);

  // Weapon-specific extras
  switch (subType) {
    case 'missile':
    case 'crimson_hydra':
      emitFireBurst(position);
      emitShockwaveRing(position, 10, [1, 0.42, 0.08]);
      break;
    case 'frostAxe':
    case 'frost_nova':
      emitFrostImpact(position);
      break;
    case 'thunderstrike':
      emitLightningStrike(position);
      break;
    case 'black_hole':
      emitBlackHoleVortex(position, 3000);
      break;
    case 'shockwave_cannon':
    case 'emp_pulse':
      emitShockwaveRing(position, 15, getWeaponPalette(subType).primary);
      break;
    case 'inferno_trail':
    case 'moltenDagger':
      emitFireBurst(position);
      break;
    case 'plasma_railgun':
      emitShockwaveRing(position, 8, [0, 1, 0.8]);
      break;
    case 'meteor_swarm':
      emitFireBurst(position);
      emitBattleExplosion(position, subType, damage * 0.5);
      break;
    // ── Wizard-Masters elemental impacts ──────────────────────────────
    case 'fireball':
      emitFireBurst(position);
      emitFireNovaRing(position);
      emitPersistentFireGround(position);
      emitBattleExplosion(position, subType, (damage || 40) * 0.75);
      break;
    case 'toxic_spread':
      emitToxicSplash(position);
      break;
    case 'ice_lance':
      emitFrostImpact(position);
      emitIceShatter(position);
      emitIceGroundFrost(position);
      break;
    case 'tornado':
      emitWindBurst(position);
      break;
    case 'super_nova':
      emitFireNovaRing(position);
      emitShockwaveRing(position, 16, [1.0, 0.68, 0.16]);
      emitPersistentFireGround(position);
      break;
    case 'final_fission':
      emitNuclearFissionDetonation(position);
      break;
    case 'rock_barrage':
      emitRockDebris(position);
      break;
    case 'lightning_bolt':
      emitLightningStrike(position);
      emitLightBurst(position);
      break;
    case 'wind_slash':
      emitWindBurst(position);
      break;
    case 'toxic_cloud':
      emitToxicSplash(position);
      break;
    // ── Missing weapon impacts ───────────────────────────────────────
    case 'gravity_well':
      emitBlackHoleVortex(position, 2500);
      emitGravityWellPulse(position);
      break;
    case 'glow_thrower':
      emitFireBurst(position);
      emitPersistentFireGround(position);
      break;
    case 'shield':
      emitShieldReflectFlash(position);
      break;
    case 'pirateleportation':
      emitWarpDistortion(position);
      break;
    case 'weather_machine':
      emitWindBurst(position);
      emitLightningStrike(position);
      break;
    case 'mirror_shield':
      emitShieldReflectFlash(position);
      emitShockwaveRing(position, 8, [0.7, 0.7, 1.0]);
      break;
    case 'phase_swap':
      emitPhaseSwapBurst(position);
      break;
    case 'banana':
      emitShockwaveRing(position, 4, [1, 0.85, 0.2]);
      break;
    default:
      break;
  }

  // ── Post-processing enhancements (bloom/chromatic/decal) ───────────
  const dmg = damage || 30;
  stampImpactDecal(position, subType);
  if (dmg >= 40) {
    pulseBloom(0.15 + dmg * 0.003, 350);
    pulseChromatic(0.3 + dmg * 0.005, 200);
  } else if (dmg >= 20) {
    pulseBloom(0.08, 200);
  }
}

export function emitPhaseSwapBurst(position) {
  if (!_scene || !position) return;
  emitShockwaveRing(position, 7, [0.62, 1.0, 0.86]);

  const ps = new ParticleSystem('phase_swap_burst', 48, _scene);
  ps.particleTexture = _tex(_flareTexture);
  ps.emitter = position.clone();
  ps.minLifeTime = 0.12;
  ps.maxLifeTime = 0.38;
  ps.minSize = 0.16;
  ps.maxSize = 0.42;
  ps.emitRate = 0;
  ps.manualEmitCount = scaleBurst(36);
  ps.color2 = new Color4(0.34, 0.82, 0.75, 0.6);
  ps.colorDead = new Color4(0.1, 0.3, 0.28, 0);
  ps.minEmitPower = 6;
  ps.maxEmitPower = 14;
  ps.direction1 = new Vector3(-1.2, -0.2, -1.2);
  ps.direction2 = new Vector3(1.2, 2.2, 1.2);
  ps.gravity = new Vector3(0, 1.5, 0);
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.start();

  const light = _acquireLight('phase_swap_light', position);
  if (light) {
    light.diffuse = new Color3(0.72, 1.0, 0.88);
    light.intensity = 14;
    light.range = 18;
  }

  let elapsed = 0;
  const obs = _scene.onBeforeRenderObservable.add(() => {
    elapsed += _scene.getEngine().getDeltaTime();
    const t = elapsed / 260;
    if (light) light.intensity = 14 * Math.max(0, 1 - t);
    if (elapsed > 280) {
      ps.dispose();
      _releaseLight(light);
      _scene.onBeforeRenderObservable.remove(obs);
      const idx = _observers.indexOf(obs);
      if (idx >= 0) _observers.splice(idx, 1);
    }
  });
  _observers.push(obs);
}

export function emitTeslaArcBetween(startPos, endPos, intensity = 1) {
  if (!_scene || !startPos || !endPos) return;
  const start = startPos.clone ? startPos.clone() : new Vector3(startPos.x, startPos.y, startPos.z);
  const end = endPos.clone ? endPos.clone() : new Vector3(endPos.x, endPos.y, endPos.z);
  const dir = end.subtract(start);
  const distance = dir.length();
  if (distance < 0.001) return;
  dir.normalize();

  const branches = [];
  for (let layer = 0; layer < 3; layer += 1) {
    const path = [];
    const steps = 8;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const point = Vector3.Lerp(start, end, t);
      if (i !== 0 && i !== steps) {
        point.x += (Math.random() - 0.5) * 0.9 * intensity;
        point.y += (Math.random() - 0.5) * 0.7 * intensity;
        point.z += (Math.random() - 0.5) * 0.9 * intensity;
      }
      path.push(point);
    }
    const tube = MeshBuilder.CreateTube(`tesla_arc_${layer}`, {
      path,
      radius: (0.05 + layer * 0.02) * intensity,
      tessellation: 8,
      updatable: false,
    }, _scene);
    const mat = new StandardMaterial(`tesla_arc_mat_${layer}`, _scene);
    mat.emissiveColor = new Color3(0.75 + layer * 0.08, 0.88, 1.0);
    mat.diffuseColor = new Color3(0.08, 0.12, 0.22);
    mat.alpha = 0.9 - layer * 0.18;
    mat.disableLighting = true;
    tube.material = mat;
    branches.push({ tube, mat });
  }

  const lightA = _acquireLight('tesla_arc_a', start);
  const lightB = _acquireLight('tesla_arc_b', end);
  if (lightA) {
    lightA.diffuse = new Color3(0.62, 0.84, 1.0);
    lightA.intensity = 16 * intensity;
    lightA.range = Math.max(12, distance * 0.8);
  }
  if (lightB) {
    lightB.diffuse = new Color3(0.72, 0.9, 1.0);
    lightB.intensity = 12 * intensity;
    lightB.range = Math.max(10, distance * 0.7);
  }

  let elapsed = 0;
  const obs = _scene.onBeforeRenderObservable.add(() => {
    elapsed += _scene.getEngine().getDeltaTime();
    const t = elapsed / 180;
    branches.forEach(({ mat }, index) => {
      mat.alpha = Math.max(0, (0.92 - index * 0.16) * (1 - t) * (0.7 + Math.random() * 0.35));
    });
    if (lightA) lightA.intensity = 16 * intensity * Math.max(0, 1 - t);
    if (lightB) lightB.intensity = 12 * intensity * Math.max(0, 1 - t);
    if (elapsed > 200) {
      branches.forEach(({ tube, mat }) => { tube.dispose(); mat.dispose(); });
      _releaseLight(lightA);
      _releaseLight(lightB);
      _scene.onBeforeRenderObservable.remove(obs);
      const idx = _observers.indexOf(obs);
      if (idx >= 0) _observers.splice(idx, 1);
    }
  });
  _observers.push(obs);
}

export function emitFinalFusionBurst(position) {
  if (!_scene || !position) return;
  emitFireBurst(position);
  emitShockwaveRing(position, 18, [1.0, 0.78, 0.18]);

  const stem = new ParticleSystem('final_fusion_stem', scaleBurst(90), _scene);
  stem.particleTexture = _tex(_smokeTexture);
  stem.emitter = position.clone();
  stem.minLifeTime = 0.6;
  stem.maxLifeTime = 1.8;
  stem.minSize = 0.4;
  stem.maxSize = 1.4;
  stem.emitRate = 0;
  stem.manualEmitCount = scaleBurst(80);
  stem.color1 = new Color4(0.95, 0.62, 0.18, 0.8);
  stem.color2 = new Color4(0.22, 0.2, 0.18, 0.42);
  stem.colorDead = new Color4(0.08, 0.08, 0.08, 0);
  stem.minEmitPower = 4;
  stem.maxEmitPower = 10;
  stem.direction1 = new Vector3(-0.8, 4.2, -0.8);
  stem.direction2 = new Vector3(0.8, 9.5, 0.8);
  stem.gravity = new Vector3(0, 2.4, 0);
  stem.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  stem.start();

  const cap = new ParticleSystem('final_fusion_cap', scaleBurst(110), _scene);
  cap.particleTexture = _tex(_flameTexture);
  cap.emitter = position.clone().add(new Vector3(0, 5.5, 0));
  cap.createSphereEmitter(1.6);
  cap.minLifeTime = 0.35;
  cap.maxLifeTime = 1.2;
  cap.minSize = 0.32;
  cap.maxSize = 1.1;
  cap.emitRate = 0;
  cap.manualEmitCount = scaleBurst(90);
  cap.color1 = new Color4(1.0, 0.86, 0.35, 1.0);
  cap.color2 = new Color4(1.0, 0.38, 0.08, 0.72);
  cap.colorDead = new Color4(0.16, 0.08, 0.04, 0);
  cap.minEmitPower = 3;
  cap.maxEmitPower = 9;
  cap.direction1 = new Vector3(-2.5, -0.2, -2.5);
  cap.direction2 = new Vector3(2.5, 1.6, 2.5);
  cap.gravity = new Vector3(0, 1.6, 0);
  cap.blendMode = ParticleSystem.BLENDMODE_ADD;
  cap.start();

  const flash = _acquireLight('final_fusion_flash', position.clone().add(new Vector3(0, 4, 0)));
  if (flash) {
    flash.diffuse = new Color3(1.0, 0.82, 0.26);
    flash.intensity = 24;
    flash.range = 34;
  }

  let elapsed = 0;
  const obs = _scene.onBeforeRenderObservable.add(() => {
    elapsed += _scene.getEngine().getDeltaTime();
    const t = elapsed / 1200;
    if (flash) flash.intensity = 24 * Math.max(0, 1 - t);
    if (elapsed > 1300) {
      stem.dispose();
      cap.dispose();
      _releaseLight(flash);
      _scene.onBeforeRenderObservable.remove(obs);
      const idx = _observers.indexOf(obs);
      if (idx >= 0) _observers.splice(idx, 1);
    }
  });
  _observers.push(obs);
}

// ═════════════════════════════════════════════════════════════════════════════
//  NUCLEAR FISSION DETONATION — multi-phase mushroom cloud sequence
//
//  Simulates the visual signature of a nuclear fission detonation:
//    Phase 0  (0-60ms)    Prompt critical flash — blinding white-blue screen wash
//    Phase 1  (60-500ms)  Fireball — expanding plasma sphere (white → orange → red)
//    Phase 2  (100-700ms) Shockwave ring / Wilson cloud — visible compression ring
//    Phase 3  (200-2500ms) Mushroom stem — vertical column of hot gas & debris
//    Phase 4  (500-3500ms) Mushroom cap — toroidal vortex rolling outward at top
//    Phase 5  (200-1500ms) Ground dust ring — Mach stem debris at surface level
//    Phase 6  (2500-5000ms) Dissipation — cooling, graying, drift
// ═════════════════════════════════════════════════════════════════════════════
//  NUCLEAR FISSION DETONATION — Cinematic mushroom cloud
//
//  4 layered GPU particle systems (fireball core, rising stem, mushroom cap,
//  sparks/debris) + expanding mesh fireball + shockwave ring + ground dust.
//  Uses continuous emitRate for persistent cloud volume rather than one-shot
//  manualEmitCount bursts.  Size/color gradients provide realistic evolution.
// ═════════════════════════════════════════════════════════════════════════════

export function emitNuclearFissionDetonation(position) {
  if (!_scene || !position) return;
  if (typeof _activeFissionCleanup === 'function') {
    try { _activeFissionCleanup(); } catch {}
  }
  const pos = position.clone();
  const tier = getTier();
  const isLowTier = tier === TIER.LOW;
  const isMediumTier = tier === TIER.MEDIUM;
  const tune = FINAL_FISSION_TUNING;
  const heightScale = Math.max(0.7, Math.min(2.2, Number(tune.heightScale) || 1));
  const darkness = Math.max(0.65, Math.min(1.8, Number(tune.darkness) || 1));
  const lingerScale = Math.max(0.7, Math.min(2.0, Number(tune.lingerScale) || 1));
  const skyContamination = Math.max(0, Math.min(2.0, Number(tune.skyContamination) || 1));
  const liveBudget = Math.max(0.3, runtimeFXBudget());
  const loadPressure = runtimePressure();
  const impactScale = 0.58;
  const densityBoost = 1.34 * liveBudget;
  const smokeShade = 1 / darkness;
  const smokeDensity = 1 + (darkness - 1) * 0.28;
  const TOTAL_DURATION = Math.round((isLowTier ? 3800 : (isMediumTier ? 4600 : 5200)) * lingerScale * (loadPressure > 0.55 ? 0.82 : 1));
  const STEM_HEIGHT = (isLowTier ? 8.5 : (isMediumTier ? 10.5 : 12.5)) * heightScale;
  const CAP_HEIGHT = STEM_HEIGHT + (isLowTier ? 1.8 : (isMediumTier ? 2.1 : 2.4));
  const STEM_EMIT_END = Math.round((isLowTier ? 2100 : 2600) * lingerScale);
  const CAP_EMIT_END = Math.round((isLowTier ? 2800 : 3400) * lingerScale);
  const SOOT_EMIT_END = Math.round((isLowTier ? 3200 : 3800) * lingerScale);
  const fireballCapacity = isLowTier ? 240 : (isMediumTier ? 320 : 420);
  const stemCapacity = isLowTier ? 180 : (isMediumTier ? 240 : 320);
  const capCapacity = isLowTier ? 220 : (isMediumTier ? 300 : 380);
  const sparkCapacity = isLowTier ? 72 : (isMediumTier ? 120 : 168);
  const sootCapacity = isLowTier ? 32 : (isMediumTier ? 44 : 60);
  const falloutCapacity = isLowTier ? 42 : (isMediumTier ? 64 : 88);
  const fireballEmitRate = Math.round((isLowTier ? 80 : (isMediumTier ? 110 : 140)) * densityBoost);
  const stemEmitRate = Math.round((isLowTier ? 42 : (isMediumTier ? 58 : 72)) * densityBoost);
  const capEmitRate = Math.round((isLowTier ? 52 : (isMediumTier ? 68 : 84)) * densityBoost);
  const sparkEmitRate = Math.round((isLowTier ? 40 : (isMediumTier ? 56 : 72)) * 1.15);
  const sootEmitRate = Math.round((isLowTier ? 8 : (isMediumTier ? 12 : 16)) * 1.1);
  const falloutEmitRate = Math.round((isLowTier ? 10 : (isMediumTier ? 14 : 18)) * 0.9 * Math.max(0.45, liveBudget));
  const disposables = [];
  let obs = null;
  let cleanedUp = false;
  const imageProcessing = _scene.imageProcessingConfiguration || null;
  const baseAmbientColor = _scene.ambientColor?.clone?.() || new Color3(0, 0, 0);
  const baseFogColor = _scene.fogColor?.clone?.() || new Color3(0, 0, 0);
  const baseClearColor = _scene.clearColor?.clone?.() || new Color4(0, 0, 0, 1);
  const baseExposure = imageProcessing?.exposure ?? 1;

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (_scene && obs) {
      try { _scene.onBeforeRenderObservable.remove(obs); } catch {}
    }
    disposables.forEach((d) => { try { d?.dispose?.(); } catch {} });
    _releaseLight(flashLight);
    if (_scene && !_scene.isDisposed) {
      _scene.ambientColor = baseAmbientColor.clone();
      _scene.fogColor = baseFogColor.clone();
      _scene.clearColor = baseClearColor.clone();
      if (imageProcessing) imageProcessing.exposure = baseExposure;
    }
    if (obs) {
      const idx = _observers.indexOf(obs);
      if (idx >= 0) _observers.splice(idx, 1);
    }
    if (_activeFissionCleanup === cleanup) {
      _activeFissionCleanup = null;
    }
  };
  _activeFissionCleanup = cleanup;
  stampImpactDecal(pos, 'final_fission');

  pulseBloom(isLowTier ? 0.45 : (isMediumTier ? 0.65 : 0.8), isLowTier ? 360 : 480);
  pulseChromatic(isLowTier ? 0.25 : (isMediumTier ? 0.4 : 0.55), isLowTier ? 220 : 320);

  const flashLight = _acquireLight('ff_flash', pos.clone().add(new Vector3(0, 3, 0)));
  if (flashLight) {
    flashLight.diffuse = new Color3(0.9, 0.92, 1.0);
    flashLight.intensity = isLowTier ? 18 : (isMediumTier ? 24 : 30);
    flashLight.range = (isLowTier ? 24 : (isMediumTier ? 30 : 36)) * 0.72;
  }

  const fireball = MeshBuilder.CreateSphere('ff_fireball', { diameter: 1, segments: 8 }, _scene);
  fireball.position.copyFrom(pos);
  fireball.position.y += 1.25;
  fireball.isVisible = false;
  disposables.push(fireball);

  const { ps: fbPS } = createAdaptiveParticleSystem('ff_fb_ps', fireballCapacity, _scene);
  fbPS.particleTexture = _tex(_flameTexture);
  fbPS.emitter = fireball;
  fbPS.createSphereEmitter((isLowTier ? 0.7 : 0.9) * impactScale);
  fbPS.emitRate = fireballEmitRate;
  fbPS.minLifeTime = 0.35;
  fbPS.maxLifeTime = isLowTier ? 0.9 : 1.1;
  fbPS.minSize = 0.7;
  fbPS.maxSize = (isLowTier ? 2.0 : 2.6) * 0.74;
  fbPS.addSizeGradient(0, 0.8, 1.6);
  fbPS.addSizeGradient(1, 2.6, 4.2);
  fbPS.addColorGradient(0, new Color4(1, 0.95, 0.7, 1));
  fbPS.addColorGradient(0.4, new Color4(1, 0.5, 0.05, 0.9));
  fbPS.addColorGradient(1, new Color4(0.7, 0.15, 0, 0));
  fbPS.minEmitPower = 2;
  fbPS.maxEmitPower = (isLowTier ? 5 : 6) * 1.15;
  fbPS.gravity = new Vector3(0, 1.1, 0);
  fbPS.blendMode = ParticleSystem.BLENDMODE_ADD;
  fbPS.start();
  disposables.push(fbPS);

  const shockRing = MeshBuilder.CreateTorus('ff_shockwave', {
    diameter: 1, thickness: 0.18, tessellation: isLowTier ? 14 : 18,
  }, _scene);
  shockRing.position.copyFrom(pos);
  shockRing.position.y += 0.5;
  shockRing.isVisible = false;
  disposables.push(shockRing);

  const stemCloud = MeshBuilder.CreateCylinder('ff_stemMesh', {
    height: 1,
    diameterTop: 0.52,
    diameterBottom: 0.88,
    tessellation: isLowTier ? 6 : 8,
  }, _scene);
  stemCloud.position.copyFrom(pos);
  stemCloud.position.y += 1.4;
  stemCloud.isVisible = false;
  disposables.push(stemCloud);

  const capCloud = MeshBuilder.CreateSphere('ff_capMesh', {
    diameter: 0.95,
    segments: isLowTier ? 8 : 10,
  }, _scene);
  capCloud.position.copyFrom(pos);
  capCloud.position.y += CAP_HEIGHT - 1.8;
  capCloud.isVisible = false;
  disposables.push(capCloud);

  const capShelf = MeshBuilder.CreateSphere('ff_capShelf', {
    diameter: 0.68,
    segments: isLowTier ? 8 : 10,
  }, _scene);
  capShelf.position.copyFrom(pos);
  capShelf.position.y += CAP_HEIGHT - 1.1;
  capShelf.isVisible = false;
  disposables.push(capShelf);

  const ashVeil = MeshBuilder.CreateSphere('ff_ashVeil', {
    diameter: 1.05,
    segments: isLowTier ? 6 : 8,
  }, _scene);
  ashVeil.position.copyFrom(pos);
  ashVeil.position.y += CAP_HEIGHT - 1.1;
  ashVeil.isVisible = false;
  disposables.push(ashVeil);

  const groundHaze = MeshBuilder.CreateDisc('ff_groundHaze', {
    radius: 1.0,
    tessellation: isLowTier ? 18 : 24,
  }, _scene);
  groundHaze.position.copyFrom(pos);
  groundHaze.position.y += 0.08;
  groundHaze.rotation.x = Math.PI / 2;
  groundHaze.isVisible = false;
  disposables.push(groundHaze);

  const shadowRing = MeshBuilder.CreateDisc('ff_shadowRing', {
    radius: 1.18,
    tessellation: isLowTier ? 20 : 28,
  }, _scene);
  shadowRing.position.copyFrom(pos);
  shadowRing.position.y += 0.05;
  shadowRing.rotation.x = Math.PI / 2;
  shadowRing.isVisible = false;
  disposables.push(shadowRing);

  const shadowSleeve = MeshBuilder.CreateCylinder('ff_shadowSleeve', {
    height: 2.8,
    diameterTop: 1.0,
    diameterBottom: 1.5,
    tessellation: isLowTier ? 10 : 14,
  }, _scene);
  shadowSleeve.position.copyFrom(pos);
  shadowSleeve.position.y += 1.2;
  shadowSleeve.isVisible = false;
  disposables.push(shadowSleeve);

  const stemEmitter = MeshBuilder.CreateCylinder('ff_stemE', {
    height: 0.5, diameter: 1.05, tessellation: 8,
  }, _scene);
  stemEmitter.position.copyFrom(pos);
  stemEmitter.position.y += 2;
  stemEmitter.isVisible = false;
  disposables.push(stemEmitter);

  const { ps: stemPS } = createAdaptiveParticleSystem('ff_stem', stemCapacity, _scene);
  stemPS.particleTexture = _tex(_smokeTexture);
  stemPS.emitter = stemEmitter;
  stemPS.emitRate = 0;
  stemPS.minLifeTime = 1.5;
  stemPS.maxLifeTime = isLowTier ? 2.9 : 3.6;
  stemPS.minSize = 1.2;
  stemPS.maxSize = (isLowTier ? 3.2 : 4.1) * 0.82;
  stemPS.direction1 = new Vector3(-0.55, 5.9, -0.55);
  stemPS.direction2 = new Vector3(0.55, 10.8, 0.55);
  stemPS.gravity = new Vector3(0, 1.5, 0);
  stemPS.minEmitPower = 3;
  stemPS.maxEmitPower = 8.5;
  stemPS.addSizeGradient(0, 1.1, 2.2);
  stemPS.addSizeGradient(0.5, 2.4, 3.8);
  stemPS.addSizeGradient(1, 4.2, 6.2);
  stemPS.addColorGradient(0, new Color4(0.98, 0.56, 0.16, 0.86));
  stemPS.addColorGradient(0.28, new Color4(0.42 * smokeShade, 0.31 * smokeShade, 0.24 * smokeShade, 0.62));
  stemPS.addColorGradient(0.72, new Color4(0.14 * smokeShade, 0.12 * smokeShade, 0.11 * smokeShade, 0.34 * smokeDensity));
  stemPS.addColorGradient(1, new Color4(0.05, 0.05, 0.05, 0));
  stemPS.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  disposables.push(stemPS);

  const { ps: coreFillPS } = createAdaptiveParticleSystem('ff_core_fill', isLowTier ? 120 : (isMediumTier ? 160 : 220), _scene);
  coreFillPS.particleTexture = _tex(_flameTexture);
  coreFillPS.emitter = fireball;
  coreFillPS.createSphereEmitter((isLowTier ? 0.45 : 0.58) * impactScale);
  coreFillPS.emitRate = fireballEmitRate;
  coreFillPS.minLifeTime = 0.2;
  coreFillPS.maxLifeTime = isLowTier ? 0.45 : 0.55;
  coreFillPS.minSize = 0.34;
  coreFillPS.maxSize = isLowTier ? 1.0 : 1.25;
  coreFillPS.addColorGradient(0, new Color4(1, 0.95, 0.8, 0.88));
  coreFillPS.addColorGradient(0.45, new Color4(1, 0.52, 0.08, 0.74));
  coreFillPS.addColorGradient(1, new Color4(0.55, 0.08, 0, 0));
  coreFillPS.minEmitPower = 0.8;
  coreFillPS.maxEmitPower = isLowTier ? 2.6 : 3.4;
  coreFillPS.gravity = new Vector3(0, 0.9, 0);
  coreFillPS.blendMode = ParticleSystem.BLENDMODE_ADD;
  coreFillPS.start();
  disposables.push(coreFillPS);

  const capEmitter = pos.clone().add(new Vector3(0, CAP_HEIGHT, 0));
  const { ps: capPS } = createAdaptiveParticleSystem('ff_cap', capCapacity, _scene);
  capPS.particleTexture = _tex(_smokeTexture);
  capPS.emitter = capEmitter;
  capPS.minEmitBox = new Vector3(-1.72, -0.6, -1.72);
  capPS.maxEmitBox = new Vector3(1.72, 0.6, 1.72);
  capPS.emitRate = 0;
  capPS.minLifeTime = 1.9;
  capPS.maxLifeTime = isLowTier ? 3.0 : 3.7;
  capPS.minSize = 1.8;
  capPS.maxSize = (isLowTier ? 4.4 : 5.8) * 0.72;
  capPS.minEmitPower = 2;
  capPS.maxEmitPower = 5.8;
  capPS.direction1 = new Vector3(-2.0, 0.95, -2.0);
  capPS.direction2 = new Vector3(2.0, 3.0, 2.0);
  capPS.gravity = new Vector3(0, 0.85, 0);
  capPS.addSizeGradient(0, 1.8, 2.8);
  capPS.addSizeGradient(0.5, 4.2, 5.8);
  capPS.addSizeGradient(1, 6.6, 8.8);
  capPS.addColorGradient(0, new Color4(0.96, 0.46, 0.1, 0.95));
  capPS.addColorGradient(0.36, new Color4(0.48 * smokeShade, 0.34 * smokeShade, 0.26 * smokeShade, 0.68));
  capPS.addColorGradient(0.78, new Color4(0.14 * smokeShade, 0.13 * smokeShade, 0.13 * smokeShade, 0.28 * smokeDensity));
  capPS.addColorGradient(1, new Color4(0.06, 0.06, 0.06, 0));
  capPS.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  disposables.push(capPS);

  const { ps: capVeilPS } = createAdaptiveParticleSystem('ff_cap_veil', isLowTier ? 90 : (isMediumTier ? 130 : 170), _scene);
  capVeilPS.particleTexture = _tex(_smokeTexture);
  capVeilPS.emitter = capEmitter;
  capVeilPS.minEmitBox = new Vector3(-1.2, -0.4, -1.2);
  capVeilPS.maxEmitBox = new Vector3(1.2, 0.4, 1.2);
  capVeilPS.emitRate = 0;
  capVeilPS.minLifeTime = 1.5;
  capVeilPS.maxLifeTime = isLowTier ? 2.6 : 3.1;
  capVeilPS.minSize = 1.1;
  capVeilPS.maxSize = isLowTier ? 2.8 : 3.6;
  capVeilPS.minEmitPower = 0.45;
  capVeilPS.maxEmitPower = 1.6;
  capVeilPS.direction1 = new Vector3(-1.0, 0.3, -1.0);
  capVeilPS.direction2 = new Vector3(1.0, 1.2, 1.0);
  capVeilPS.gravity = new Vector3(0, 0.25, 0);
  capVeilPS.addColorGradient(0, new Color4(0.2 * smokeShade, 0.16 * smokeShade, 0.12 * smokeShade, 0.26 * smokeDensity));
  capVeilPS.addColorGradient(0.7, new Color4(0.1 * smokeShade, 0.09 * smokeShade, 0.08 * smokeShade, 0.16 * smokeDensity));
  capVeilPS.addColorGradient(1, new Color4(0.05, 0.05, 0.05, 0));
  capVeilPS.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  disposables.push(capVeilPS);

  const { ps: shelfVeilPS } = createAdaptiveParticleSystem('ff_shelf_veil', isLowTier ? 80 : (isMediumTier ? 110 : 150), _scene);
  shelfVeilPS.particleTexture = _tex(_smokeTexture);
  shelfVeilPS.emitter = capEmitter;
  shelfVeilPS.minEmitBox = new Vector3(-1.4, -0.14, -1.4);
  shelfVeilPS.maxEmitBox = new Vector3(1.4, 0.18, 1.4);
  shelfVeilPS.emitRate = 0;
  shelfVeilPS.minLifeTime = 1.6;
  shelfVeilPS.maxLifeTime = isLowTier ? 2.8 : 3.2;
  shelfVeilPS.minSize = 1.0;
  shelfVeilPS.maxSize = isLowTier ? 2.4 : 3.2;
  shelfVeilPS.minEmitPower = 0.2;
  shelfVeilPS.maxEmitPower = 1.25;
  shelfVeilPS.direction1 = new Vector3(-1.8, 0.1, -1.8);
  shelfVeilPS.direction2 = new Vector3(1.8, 0.8, 1.8);
  shelfVeilPS.gravity = new Vector3(0, -0.05, 0);
  shelfVeilPS.addColorGradient(0, new Color4(0.14 * smokeShade, 0.12 * smokeShade, 0.11 * smokeShade, 0.18 * smokeDensity));
  shelfVeilPS.addColorGradient(0.72, new Color4(0.08 * smokeShade, 0.075 * smokeShade, 0.07 * smokeShade, 0.12 * smokeDensity));
  shelfVeilPS.addColorGradient(1, new Color4(0.04, 0.04, 0.04, 0));
  shelfVeilPS.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  disposables.push(shelfVeilPS);

  const { ps: sparkPS } = createAdaptiveParticleSystem('ff_sparks', sparkCapacity, _scene);
  sparkPS.particleTexture = _tex(_sparkTexture);
  sparkPS.emitter = pos.clone().add(new Vector3(0, 1.7, 0));
  sparkPS.createSphereEmitter(0.95);
  sparkPS.emitRate = 0;
  sparkPS.minLifeTime = 0.45;
  sparkPS.maxLifeTime = 1.1;
  sparkPS.minSize = 0.15;
  sparkPS.maxSize = 0.45;
  sparkPS.addColorGradient(0, new Color4(1, 0.85, 0.3, 1));
  sparkPS.addColorGradient(0.6, new Color4(1, 0.35, 0, 0.8));
  sparkPS.addColorGradient(1, new Color4(0.5, 0.1, 0, 0));
  sparkPS.minEmitPower = 5;
  sparkPS.maxEmitPower = 13;
  sparkPS.gravity = new Vector3(0, -4, 0);
  sparkPS.blendMode = ParticleSystem.BLENDMODE_ADD;
  disposables.push(sparkPS);

  const sootEmitter = pos.clone().add(new Vector3(0, CAP_HEIGHT - 0.6, 0));
  const { ps: sootPS } = createAdaptiveParticleSystem('ff_soot', sootCapacity, _scene);
  sootPS.particleTexture = _tex(_smokeTexture);
  sootPS.emitter = sootEmitter;
  sootPS.minEmitBox = new Vector3(-1.7, -0.38, -1.7);
  sootPS.maxEmitBox = new Vector3(1.7, 0.38, 1.7);
  sootPS.emitRate = 0;
  sootPS.minLifeTime = 2.0;
  sootPS.maxLifeTime = isLowTier ? 3.4 : 4.2;
  sootPS.minSize = 0.35;
  sootPS.maxSize = isLowTier ? 0.95 : 1.2;
  sootPS.minEmitPower = 0.2;
  sootPS.maxEmitPower = 1.0;
  sootPS.direction1 = new Vector3(-0.5, 0.4, -0.5);
  sootPS.direction2 = new Vector3(0.5, 1.5, 0.5);
  sootPS.gravity = new Vector3(0, -0.18, 0);
  sootPS.addColorGradient(0, new Color4(0.16 * smokeShade, 0.15 * smokeShade, 0.15 * smokeShade, 0.28 * smokeDensity));
  sootPS.addColorGradient(0.6, new Color4(0.09 * smokeShade, 0.09 * smokeShade, 0.09 * smokeShade, 0.18 * smokeDensity));
  sootPS.addColorGradient(1, new Color4(0.04, 0.04, 0.04, 0));
  sootPS.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  disposables.push(sootPS);

  const falloutEmitter = pos.clone().add(new Vector3(0, 0.35, 0));
  const { ps: falloutPS } = createAdaptiveParticleSystem('ff_fallout', falloutCapacity, _scene);
  falloutPS.particleTexture = _tex(_smokeTexture);
  falloutPS.emitter = falloutEmitter;
  falloutPS.minEmitBox = new Vector3(-0.82, -0.12, -0.82);
  falloutPS.maxEmitBox = new Vector3(0.82, 0.22, 0.82);
  falloutPS.emitRate = 0;
  falloutPS.minLifeTime = 2.6;
  falloutPS.maxLifeTime = isLowTier ? 4.2 : 5.2;
  falloutPS.minSize = 0.45;
  falloutPS.maxSize = (isLowTier ? 1.4 : 1.9) * 0.78;
  falloutPS.minEmitPower = 0.15;
  falloutPS.maxEmitPower = 0.8;
  falloutPS.direction1 = new Vector3(-0.35, 0.06, -0.35);
  falloutPS.direction2 = new Vector3(0.35, 0.35, 0.35);
  falloutPS.gravity = new Vector3(0, -0.04, 0);
  falloutPS.addColorGradient(0, new Color4(0.12 * smokeShade, 0.11 * smokeShade, 0.1 * smokeShade, 0.2 * smokeDensity));
  falloutPS.addColorGradient(0.65, new Color4(0.08 * smokeShade, 0.075 * smokeShade, 0.07 * smokeShade, 0.14 * smokeDensity));
  falloutPS.addColorGradient(1, new Color4(0.04, 0.04, 0.04, 0));
  falloutPS.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  disposables.push(falloutPS);

  const dustPS = new ParticleSystem('ff_dust', scaleBurst(isLowTier ? 18 : 28), _scene);
  dustPS.particleTexture = _tex(_smokeTexture);
  dustPS.emitter = pos.clone();
  dustPS.emitter.y += 0.2;
  dustPS.emitRate = 0;
  dustPS.minLifeTime = 0.55;
  dustPS.maxLifeTime = 1.35;
  dustPS.minSize = 0.6;
  dustPS.maxSize = 1.55;
  dustPS.addColorGradient(0, new Color4(0.52, 0.44, 0.32, 0.72));
  dustPS.addColorGradient(1, new Color4(0.18, 0.15, 0.12, 0));
  dustPS.minEmitPower = 4;
  dustPS.maxEmitPower = 10;
  dustPS.direction1 = new Vector3(-2.45, 0.3, -2.45);
  dustPS.direction2 = new Vector3(2.45, 1.45, 2.45);
  dustPS.gravity = new Vector3(0, -2.2, 0);
  dustPS.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  disposables.push(dustPS);

  const { ps: groundSoftPS } = createAdaptiveParticleSystem('ff_ground_soft', isLowTier ? 40 : (isMediumTier ? 56 : 72), _scene);
  groundSoftPS.particleTexture = _tex(_smokeTexture);
  groundSoftPS.emitter = pos.clone().add(new Vector3(0, 0.12, 0));
  groundSoftPS.minEmitBox = new Vector3(-0.8, -0.04, -0.8);
  groundSoftPS.maxEmitBox = new Vector3(0.8, 0.12, 0.8);
  groundSoftPS.emitRate = 0;
  groundSoftPS.minLifeTime = 1.4;
  groundSoftPS.maxLifeTime = isLowTier ? 2.1 : 2.8;
  groundSoftPS.minSize = 0.8;
  groundSoftPS.maxSize = isLowTier ? 1.8 : 2.4;
  groundSoftPS.minEmitPower = 0.06;
  groundSoftPS.maxEmitPower = 0.45;
  groundSoftPS.direction1 = new Vector3(-0.35, 0.02, -0.35);
  groundSoftPS.direction2 = new Vector3(0.35, 0.28, 0.35);
  groundSoftPS.gravity = new Vector3(0, -0.02, 0);
  groundSoftPS.addColorGradient(0, new Color4(0.2, 0.11, 0.04, 0.18));
  groundSoftPS.addColorGradient(0.65, new Color4(0.09, 0.07, 0.05, 0.1));
  groundSoftPS.addColorGradient(1, new Color4(0.03, 0.03, 0.03, 0));
  groundSoftPS.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  disposables.push(groundSoftPS);

  const { ps: shadowMistPS } = createAdaptiveParticleSystem('ff_shadow_mist', isLowTier ? 34 : (isMediumTier ? 48 : 62), _scene);
  shadowMistPS.particleTexture = _tex(_smokeTexture);
  shadowMistPS.emitter = pos.clone().add(new Vector3(0, 0.55, 0));
  shadowMistPS.minEmitBox = new Vector3(-0.75, -0.1, -0.75);
  shadowMistPS.maxEmitBox = new Vector3(0.75, 0.6, 0.75);
  shadowMistPS.emitRate = 0;
  shadowMistPS.minLifeTime = 1.6;
  shadowMistPS.maxLifeTime = isLowTier ? 2.5 : 3.0;
  shadowMistPS.minSize = 0.85;
  shadowMistPS.maxSize = isLowTier ? 1.8 : 2.4;
  shadowMistPS.minEmitPower = 0.08;
  shadowMistPS.maxEmitPower = 0.55;
  shadowMistPS.direction1 = new Vector3(-0.22, 0.08, -0.22);
  shadowMistPS.direction2 = new Vector3(0.22, 0.65, 0.22);
  shadowMistPS.gravity = new Vector3(0, -0.06, 0);
  shadowMistPS.addColorGradient(0, new Color4(0.04, 0.035, 0.03, 0.14));
  shadowMistPS.addColorGradient(0.75, new Color4(0.03, 0.03, 0.03, 0.09));
  shadowMistPS.addColorGradient(1, new Color4(0.02, 0.02, 0.02, 0));
  shadowMistPS.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  disposables.push(shadowMistPS);

  const { ps: shockDustPS } = createAdaptiveParticleSystem('ff_shock_dust', isLowTier ? 34 : (isMediumTier ? 46 : 62), _scene);
  shockDustPS.particleTexture = _tex(_smokeTexture);
  shockDustPS.emitter = pos.clone().add(new Vector3(0, 0.4, 0));
  shockDustPS.minEmitBox = new Vector3(-0.25, -0.04, -0.25);
  shockDustPS.maxEmitBox = new Vector3(0.25, 0.08, 0.25);
  shockDustPS.emitRate = 0;
  shockDustPS.minLifeTime = 0.45;
  shockDustPS.maxLifeTime = 0.85;
  shockDustPS.minSize = 0.5;
  shockDustPS.maxSize = 1.2;
  shockDustPS.minEmitPower = 1.8;
  shockDustPS.maxEmitPower = 5.4;
  shockDustPS.direction1 = new Vector3(-2.8, 0.06, -2.8);
  shockDustPS.direction2 = new Vector3(2.8, 0.65, 2.8);
  shockDustPS.gravity = new Vector3(0, -1.1, 0);
  shockDustPS.addColorGradient(0, new Color4(0.9, 0.78, 0.56, 0.32));
  shockDustPS.addColorGradient(1, new Color4(0.18, 0.14, 0.1, 0));
  shockDustPS.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  disposables.push(shockDustPS);

  let elapsed = 0;
  let stemStarted = false;
  let capStarted = false;
  let sparksStarted = false;
  let dustStarted = false;
  let sootStarted = false;
  let falloutStarted = false;
  let stemStopped = false;
  let capStopped = false;
  let sootStopped = false;
  let falloutStopped = false;
  let fbStopped = false;
  let sparksStopped = false;

  obs = _scene.onBeforeRenderObservable.add(() => {
    if (!_scene || _scene.isDisposed) {
      cleanup();
      return;
    }
    const dtMs = _scene.getEngine().getDeltaTime();
    elapsed += dtMs;

    if (skyContamination > 0) {
      const flashT = Math.max(0, 1 - elapsed / 260);
      const ashT = elapsed > 220 ? Math.max(0, 1 - (elapsed - 220) / 1500) : 0;
      const contamT = Math.max(flashT * 1.2, ashT * 0.8) * skyContamination;
      if (contamT > 0.001) {
        _scene.ambientColor = new Color3(
          baseAmbientColor.r + 0.34 * contamT,
          baseAmbientColor.g + 0.16 * contamT,
          baseAmbientColor.b + 0.05 * contamT,
        );
        _scene.fogColor = new Color3(
          Math.min(1, baseFogColor.r + 0.28 * contamT),
          Math.min(1, baseFogColor.g + 0.11 * contamT),
          Math.min(1, baseFogColor.b * (1 - 0.35 * contamT)),
        );
        _scene.clearColor = new Color4(
          Math.min(1, baseClearColor.r + 0.22 * contamT),
          Math.min(1, baseClearColor.g + 0.08 * contamT),
          Math.max(0, baseClearColor.b * (1 - 0.28 * contamT)),
          baseClearColor.a,
        );
        if (imageProcessing) imageProcessing.exposure = baseExposure + 0.14 * contamT;
      } else {
        _scene.ambientColor = baseAmbientColor.clone();
        _scene.fogColor = baseFogColor.clone();
        _scene.clearColor = baseClearColor.clone();
        if (imageProcessing) imageProcessing.exposure = baseExposure;
      }
    }

    if (flashLight) {
      if (elapsed < 60) {
        flashLight.intensity = isLowTier ? 18 : (isMediumTier ? 24 : 30);
      } else if (elapsed < 400) {
        const peak = isLowTier ? 18 : (isMediumTier ? 24 : 30);
        flashLight.intensity = peak * Math.max(0, 1 - (elapsed - 60) / 340);
      } else if (elapsed <= 500) {
        flashLight.intensity = 0;
      }
    }

    if (elapsed > 60 && elapsed < 1200) {
      const fbT = Math.min(1, (elapsed - 60) / 1140);
      fireball.position.y = pos.y + 1.25 + fbT * 0.5;
      fireball.scaling.setAll(1 + fbT * (isLowTier ? 4.8 : 5.9));
      coreFillPS.emitRate = fireballEmitRate * (1.1 - fbT * 0.35);
      coreFillPS.minSize = 0.32 + fbT * 0.2;
      coreFillPS.maxSize = (isLowTier ? 1.0 : 1.25) + fbT * (isLowTier ? 0.45 : 0.6);
    } else if (elapsed >= 1200) {
      coreFillPS.emitRate = 0;
    }

    if (elapsed > 120 && elapsed < STEM_EMIT_END + 350) {
      const stemT = Math.min(1, (elapsed - 120) / Math.max(1, STEM_EMIT_END + 230));
      const stemPulse = 1 + Math.sin(elapsed * 0.01) * 0.05;
      stemCloud.position.y = pos.y + 1.8 + stemT * (CAP_HEIGHT * 0.56);
      stemCloud.scaling.set(
        (1.28 + stemT * 1.55) * stemPulse,
        1.9 + stemT * (STEM_HEIGHT - 0.9),
        (1.28 + stemT * 1.55) * stemPulse
      );
    }

    if (elapsed > 520 && elapsed < TOTAL_DURATION) {
      const capT = Math.min(1, (elapsed - 520) / (isLowTier ? 1450 : 1850));
      const capFade = Math.max(0, (elapsed - CAP_EMIT_END) / 1400);
      const capPulse = 1 + Math.sin(elapsed * 0.0065) * 0.035;
      capEmitter.y = pos.y + CAP_HEIGHT - 0.1 + capT * 0.9;
      sootEmitter.y = pos.y + CAP_HEIGHT + 0.2 + capT * 0.8;
      capCloud.position.y = pos.y + CAP_HEIGHT - 1.2 + capT * 1.1;
      capCloud.scaling.set(
        (3.6 + capT * 6.1) * capPulse,
        2.1 + capT * 2.8,
        (3.6 + capT * 6.1) * capPulse
      );

      capShelf.position.y = pos.y + CAP_HEIGHT - 0.55 + capT * 0.6;
      capShelf.scaling.set(
        (4.6 + capT * 7.1) * capPulse,
        0.82 + capT * 0.95,
        (4.6 + capT * 7.1) * capPulse
      );

      ashVeil.position.y = pos.y + CAP_HEIGHT - 0.2 + capT * 1.2;
      ashVeil.scaling.set(
        (5.1 + capT * 8.6) * capPulse,
        2.3 + capT * 3.7,
        (5.1 + capT * 8.6) * capPulse
      );
      const capRadius = Math.max(1.1, capCloud.scaling.x * 0.22);
      capVeilPS.minEmitBox = new Vector3(-capRadius, -0.35, -capRadius);
      capVeilPS.maxEmitBox = new Vector3(capRadius, 0.38, capRadius);
      capVeilPS.emitRate = capEmitRate * Math.max(0.22, 0.88 - capFade * 0.7);

      const shelfRadius = Math.max(1.35, capShelf.scaling.x * 0.19);
      shelfVeilPS.minEmitBox = new Vector3(-shelfRadius, -0.16, -shelfRadius);
      shelfVeilPS.maxEmitBox = new Vector3(shelfRadius, 0.2, shelfRadius);
      shelfVeilPS.emitRate = Math.round(capEmitRate * 0.68 * Math.max(0.18, 1 - capFade * 0.82));
    } else if (elapsed >= TOTAL_DURATION) {
      capVeilPS.emitRate = 0;
      shelfVeilPS.emitRate = 0;
    }

    if (!fbStopped && elapsed > 1200) {
      fbStopped = true;
      fbPS.emitRate = 0;
    }

    if (elapsed > 80 && elapsed < 700) {
      const srT = (elapsed - 80) / 620;
      shockRing.scaling.set(1 + srT * 12.5, 1 + srT * 12.5, (1 + srT * 12.5) * 0.34);
      const shockRadius = Math.max(0.4, shockRing.scaling.x * 0.24);
      shockDustPS.minEmitBox = new Vector3(-shockRadius, -0.05, -shockRadius);
      shockDustPS.maxEmitBox = new Vector3(shockRadius, 0.08, shockRadius);
      shockDustPS.emitRate = Math.round((isLowTier ? 12 : 18) * Math.max(0.22, 1 - srT * 0.8));
    } else if (elapsed >= 700) {
      shockDustPS.emitRate = 0;
    }

    if (elapsed > 120 && elapsed < TOTAL_DURATION) {
      const groundT = Math.min(1, (elapsed - 120) / 900);
      const groundFade = Math.max(0, (elapsed - (TOTAL_DURATION - 1200)) / 1200);
      const hazeScale = 1 + groundT * (isLowTier ? 3.2 : 4.4);
      groundHaze.scaling.set(hazeScale, hazeScale, hazeScale);
      const hazeRadius = Math.max(0.75, hazeScale * 0.78);
      groundSoftPS.minEmitBox = new Vector3(-hazeRadius, -0.04, -hazeRadius);
      groundSoftPS.maxEmitBox = new Vector3(hazeRadius, 0.14, hazeRadius);
      groundSoftPS.emitRate = Math.round((isLowTier ? 7 : 11) * Math.max(0.14, 1 - groundFade));

      const shadowT = Math.min(1, Math.max(0, (elapsed - 140) / 1300));
      const shadowFade = Math.max(0, (elapsed - (TOTAL_DURATION - 1600)) / 1600);
      const shadowScale = 1 + shadowT * (isLowTier ? 4.0 : 5.3);
      shadowRing.scaling.set(shadowScale, shadowScale, shadowScale);

      const sleeveScale = 1 + shadowT * (isLowTier ? 1.9 : 2.5);
      shadowSleeve.position.y = pos.y + 1.1 + shadowT * 0.35;
      shadowSleeve.scaling.set(sleeveScale, 1 + shadowT * 0.4, sleeveScale);
      const shadowRadius = Math.max(0.85, shadowScale * 0.88);
      shadowMistPS.minEmitBox = new Vector3(-shadowRadius, -0.1, -shadowRadius);
      shadowMistPS.maxEmitBox = new Vector3(shadowRadius, 0.7 + shadowT * 0.35, shadowRadius);
      shadowMistPS.emitRate = Math.round((isLowTier ? 6 : 10) * Math.max(0.16, 1 - shadowFade * 0.9));
    } else if (elapsed >= TOTAL_DURATION) {
      groundSoftPS.emitRate = 0;
      shadowMistPS.emitRate = 0;
    }

    if (elapsed > Math.max(CAP_EMIT_END - 300, 1400) && elapsed < TOTAL_DURATION) {
      const falloutT = Math.min(1, (elapsed - Math.max(CAP_EMIT_END - 300, 1400)) / 1500);
      const falloutFade = Math.max(0, (elapsed - (TOTAL_DURATION - 1800)) / 1800);
      const falloutRadius = 0.95 + falloutT * (isLowTier ? 2.8 : 4.2);
      falloutPS.minEmitBox = new Vector3(-falloutRadius, -0.12, -falloutRadius);
      falloutPS.maxEmitBox = new Vector3(falloutRadius, 0.35, falloutRadius);
      groundSoftPS.emitRate = Math.max(
        groundSoftPS.emitRate,
        Math.round((isLowTier ? 8 : 12) * Math.max(0.16, 1 - falloutFade * 0.85))
      );
      falloutPS.emitRate = falloutEmitRate * Math.max(0.28, 1 - falloutFade);
    } else if (elapsed >= TOTAL_DURATION) {
      falloutPS.emitRate = 0;
    }

    if (!sparksStarted && elapsed > 100) {
      sparksStarted = true;
      sparkPS.emitRate = sparkEmitRate;
      sparkPS.start();
    }

    if (!stemStarted && elapsed > 150) {
      stemStarted = true;
      stemPS.emitRate = stemEmitRate;
      stemPS.start();
    }

    if (stemStarted && elapsed < STEM_EMIT_END) {
      const climbDuration = Math.max(1, STEM_EMIT_END - 150);
      const climb = Math.min(1, (elapsed - 150) / climbDuration);
      stemEmitter.position.y = pos.y + 2.2 + climb * (CAP_HEIGHT - 2.2);
    }

    if (!dustStarted && elapsed > 200) {
      dustStarted = true;
      dustPS.manualEmitCount = scaleBurst(isLowTier ? 18 : 28);
      dustPS.start();
    }

    if (!capStarted && elapsed > 500) {
      capStarted = true;
      capPS.emitRate = capEmitRate;
      capPS.start();
      if (flashLight) {
        flashLight.position.y = pos.y + CAP_HEIGHT + 0.75;
        flashLight.diffuse = new Color3(1.0, 0.7, 0.3);
        flashLight.intensity = isLowTier ? 10 : (isMediumTier ? 14 : 18);
        flashLight.range = isLowTier ? 16 : (isMediumTier ? 20 : 24);
      }
    }

    if (!sootStarted && elapsed > 760) {
      sootStarted = true;
      sootPS.emitRate = sootEmitRate;
      sootPS.start();
    }

    if (!falloutStarted && elapsed > Math.max(CAP_EMIT_END - 300, 1400)) {
      falloutStarted = true;
      falloutPS.emitRate = falloutEmitRate;
      falloutPS.start();
    }

    if (flashLight && elapsed > 500 && elapsed < 1800) {
      const capPeak = isLowTier ? 10 : (isMediumTier ? 14 : 18);
      flashLight.intensity = capPeak * Math.max(0, 1 - (elapsed - 500) / 1300);
    } else if (flashLight && elapsed >= 1800) {
      flashLight.intensity = 0;
    }

    if (!sparksStopped && elapsed > 1500) {
      sparksStopped = true;
      sparkPS.emitRate = 0;
    }
    if (!stemStopped && elapsed > STEM_EMIT_END) {
      stemStopped = true;
      stemPS.emitRate = 0;
    }
    if (!capStopped && elapsed > CAP_EMIT_END) {
      capStopped = true;
      capPS.emitRate = 0;
    }
    if (!sootStopped && elapsed > SOOT_EMIT_END) {
      sootStopped = true;
      sootPS.emitRate = 0;
    }
    if (!falloutStopped && elapsed > (TOTAL_DURATION - 600)) {
      falloutStopped = true;
      falloutPS.emitRate = 0;
    }

    if (elapsed > TOTAL_DURATION) {
      cleanup();
    }
  });
  _observers.push(obs);
}

// ═════════════════════════════════════════════════════════════════════════════
//  WIZARD-MASTERS ELEMENTAL VFX
//  New spectacular effects using WM particle textures and patterns.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Fire Nova Ring — expanding fiery torus with flame particles.
 * Adapted from WM super-nova post-processing shockwave.
 */
export function emitFireNovaRing(position) {
  if (!_scene) return;

  const ring = MeshBuilder.CreateTorus('fire_nova_ring', {
    diameter: 0.5, thickness: 0.2, tessellation: 32,
  }, _scene);
  ring.position.copyFrom(position);
  ring.position.y += 0.5;
  const ringMat = new StandardMaterial('fire_nova_mat', _scene);
  ringMat.emissiveColor = new Color3(1, 0.4, 0);
  ringMat.disableLighting = true;
  ringMat.alpha = 0.8;
  ring.material = ringMat;

  // Fire particles along the expanding ring
  const ps = new ParticleSystem('fire_nova_ps', scaleBurst(60), _scene);
  ps.particleTexture = _tex(_flameTexture);
  ps.emitter = position.clone();
  ps.createSphereEmitter(0.5);
  ps.minLifeTime = 0.15;
  ps.maxLifeTime = 0.4;
  ps.minSize = 0.15;
  ps.maxSize = 0.5;
  ps.emitRate = 0;
  ps.manualEmitCount = scaleBurst(50);
  ps.color1 = new Color4(1, 0.6, 0, 1);
  ps.color2 = new Color4(1, 0.15, 0, 0.8);
  ps.colorDead = new Color4(0.2, 0, 0, 0);
  ps.minEmitPower = 6;
  ps.maxEmitPower = 12;
  ps.direction1 = new Vector3(-1, 0, -1);
  ps.direction2 = new Vector3(1, 0.5, 1);
  ps.gravity = new Vector3(0, 2, 0);
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.start();

  let elapsed = 0;
  const obs = _scene.onBeforeRenderObservable.add(() => {
    elapsed += _scene.getEngine().getDeltaTime();
    const t = elapsed / 500;
    ring.scaling.setAll(1 + t * 12);
    ringMat.alpha = Math.max(0, 0.8 * (1 - t));
    if (elapsed > 600) {
      ring.dispose(); ringMat.dispose(); ps.dispose();
      _scene.onBeforeRenderObservable.remove(obs);
      const idx = _observers.indexOf(obs);
      if (idx >= 0) _observers.splice(idx, 1);
    }
  });
  _observers.push(obs);
}

/**
 * Toxic Splash — green poison puddle with rising toxic bubbles.
 * Adapted from WM toxic collision + puddle debuff formation.
 */
export function emitToxicSplash(position) {
  if (!_scene) return;

  // Ground puddle disc
  const puddle = MeshBuilder.CreateDisc('toxic_puddle', { radius: 2, tessellation: 16 }, _scene);
  puddle.position.copyFrom(position);
  puddle.position.y = 0.1;
  puddle.rotation.x = Math.PI / 2;
  const puddleMat = new StandardMaterial('toxic_puddle_mat', _scene);
  puddleMat.diffuseColor = new Color3(0.15, 0.5, 0.05);
  puddleMat.emissiveColor = new Color3(0.1, 0.4, 0);
  puddleMat.alpha = 0.6;
  puddle.material = puddleMat;

  // Rising toxic bubbles
  const ps = new ParticleSystem('toxic_bubbles', scaleBurst(40), _scene);
  ps.particleTexture = _tex(_smokeTexture);
  ps.emitter = position.clone();
  ps.createSphereEmitter(1.5);
  ps.minLifeTime = 0.4;
  ps.maxLifeTime = 1.0;
  ps.minSize = 0.1;
  ps.maxSize = 0.35;
  ps.emitRate = 0;
  ps.manualEmitCount = scaleBurst(30);
  ps.color1 = new Color4(0.2, 0.8, 0.1, 0.8);
  ps.color2 = new Color4(0.1, 0.6, 0, 0.5);
  ps.colorDead = new Color4(0, 0.2, 0, 0);
  ps.minEmitPower = 1;
  ps.maxEmitPower = 4;
  ps.direction1 = new Vector3(-0.5, 1, -0.5);
  ps.direction2 = new Vector3(0.5, 3, 0.5);
  ps.gravity = new Vector3(0, 1, 0);
  ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  ps.start();

  let elapsed = 0;
  const obs = _scene.onBeforeRenderObservable.add(() => {
    elapsed += _scene.getEngine().getDeltaTime();
    if (elapsed > 2000) {
      puddleMat.alpha = Math.max(0, 0.6 * (1 - (elapsed - 2000) / 500));
    }
    if (elapsed > 2500) {
      puddle.dispose(); puddleMat.dispose(); ps.dispose();
      _scene.onBeforeRenderObservable.remove(obs);
      const idx = _observers.indexOf(obs);
      if (idx >= 0) _observers.splice(idx, 1);
    }
  });
  _observers.push(obs);
}

/**
 * Ice Shatter — crystalline ice fragments bursting outward with sparkle.
 * Adapted from WM ice collision with fragment spray pattern.
 */
export function emitIceShatter(position) {
  if (!_scene) return;

  // Ice fragment meshes (small polyhedra thrown outward)
  const fragments = [];
  for (let i = 0; i < 8; i++) {
    const frag = MeshBuilder.CreatePolyhedron('ice_frag' + i, { type: 1, size: 0.08 + Math.random() * 0.1 }, _scene);
    const fragMat = new StandardMaterial('ice_frag_mat' + i, _scene);
    fragMat.diffuseColor = new Color3(0.5 + Math.random() * 0.3, 0.85, 1);
    fragMat.emissiveColor = new Color3(0.3, 0.6, 0.9);
    fragMat.alpha = 0.7;
    frag.material = fragMat;
    frag.position.copyFrom(position);
    const angle = (i / 8) * Math.PI * 2;
    frag.metadata = {
      vx: Math.cos(angle) * (3 + Math.random() * 4),
      vy: 2 + Math.random() * 5,
      vz: Math.sin(angle) * (3 + Math.random() * 4),
    };
    fragments.push(frag);
  }

  // Sparkle burst particles
  const ps = new ParticleSystem('ice_sparkle', scaleBurst(40), _scene);
  ps.particleTexture = _tex(_sparkTexture);
  ps.emitter = position.clone();
  ps.minLifeTime = 0.2;
  ps.maxLifeTime = 0.6;
  ps.minSize = 0.05;
  ps.maxSize = 0.15;
  ps.emitRate = 0;
  ps.manualEmitCount = scaleBurst(30);
  ps.color1 = new Color4(0.7, 0.95, 1, 1);
  ps.color2 = new Color4(0.4, 0.7, 1, 0.7);
  ps.colorDead = new Color4(0.5, 0.7, 0.9, 0);
  ps.minEmitPower = 3;
  ps.maxEmitPower = 8;
  ps.direction1 = new Vector3(-1, 0, -1);
  ps.direction2 = new Vector3(1, 2, 1);
  ps.gravity = new Vector3(0, -5, 0);
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.start();

  let elapsed = 0;
  const obs = _scene.onBeforeRenderObservable.add(() => {
    const dt = _scene.getEngine().getDeltaTime() / 1000;
    elapsed += dt * 1000;
    fragments.forEach(f => {
      const md = f.metadata;
      f.position.x += md.vx * dt;
      f.position.y += md.vy * dt;
      f.position.z += md.vz * dt;
      md.vy -= 15 * dt; // gravity
      f.rotation.x += dt * 5;
      f.rotation.z += dt * 3;
      if (f.material) f.material.alpha = Math.max(0, 0.7 * (1 - elapsed / 1200));
    });
    if (elapsed > 1200) {
      fragments.forEach(f => f.dispose());
      ps.dispose();
      _scene.onBeforeRenderObservable.remove(obs);
      const idx = _observers.indexOf(obs);
      if (idx >= 0) _observers.splice(idx, 1);
    }
  });
  _observers.push(obs);
}

/**
 * Wind Burst — swirling wind particles with expanding translucent rings.
 * Adapted from WM wind-tornado knockback effect.
 */
export function emitWindBurst(position) {
  if (!_scene) return;

  // Massive upward air column
  const ps = new ParticleSystem('wind_burst', scaleBurst(64), _scene);
  ps.particleTexture = _tex(_flareTexture);
  ps.emitter = position.clone();
  ps.createCylinderEmitter(4, 8, 0, 0);
  ps.minLifeTime = 0.5;
  ps.maxLifeTime = 1.2;
  ps.minSize = 0.2;
  ps.maxSize = 0.8;
  ps.emitRate = 0;
  ps.manualEmitCount = scaleBurst(54);
  ps.color1 = new Color4(0.6, 0.95, 0.8, 0.8);
  ps.color2 = new Color4(0.4, 0.85, 0.7, 0.5);
  ps.colorDead = new Color4(0.3, 0.6, 0.5, 0);
  ps.minEmitPower = 8;
  ps.maxEmitPower = 22;
  ps.direction1 = new Vector3(-3, 2, -3);
  ps.direction2 = new Vector3(3, 8, 3);
  ps.gravity = new Vector3(0, 3, 0);
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.start();

  // Ground debris burst
  const debris = new ParticleSystem('wind_debris', scaleBurst(32), _scene);
  debris.particleTexture = _tex(_smokeTexture);
  debris.emitter = position.clone();
  debris.createSphereEmitter(3);
  debris.minLifeTime = 0.6;
  debris.maxLifeTime = 1.5;
  debris.minSize = 0.3;
  debris.maxSize = 0.9;
  debris.emitRate = 0;
  debris.manualEmitCount = scaleBurst(24);
  debris.color1 = new Color4(0.5, 0.45, 0.35, 0.6);
  debris.color2 = new Color4(0.3, 0.28, 0.22, 0.3);
  debris.colorDead = new Color4(0.1, 0.1, 0.1, 0);
  debris.minEmitPower = 5;
  debris.maxEmitPower = 14;
  debris.direction1 = new Vector3(-4, 0, -4);
  debris.direction2 = new Vector3(4, 2, 4);
  debris.gravity = new Vector3(0, -8, 0);
  debris.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  debris.start();

  // Lightning flash at impact (pooled)
  const flash = _acquireLight('tornado_flash', position);
  if (flash) {
    flash.position.y += 4;
    flash.diffuse = new Color3(0.7, 0.9, 1.0);
    flash.intensity = 25;
    flash.range = 35;
  }

  // Keep this impact readable, but cheaper than the old multi-ring stack.
  const rings = [];
  for (let i = 0; i < 2; i++) {
    const ring = MeshBuilder.CreateTorus('wind_ring' + i, {
      diameter: 0.8, thickness: 0.08, tessellation: 32,
    }, _scene);
    ring.position.copyFrom(position);
    ring.position.y += 0.5 + i * 1.5;
    const ringMat = new StandardMaterial('wind_ring_mat' + i, _scene);
    ringMat.emissiveColor = new Color3(0.5 + i * 0.1, 0.9, 0.8);
    ringMat.disableLighting = true;
    ringMat.alpha = 0.7;
    ring.material = ringMat;
    rings.push({ mesh: ring, mat: ringMat });
  }

  let elapsed = 0;
  const obs = _scene.onBeforeRenderObservable.add(() => {
    elapsed += _scene.getEngine().getDeltaTime();
    const t = elapsed / 800;
    rings.forEach((r, i) => {
      const scale = 1 + t * (10 + i * 4);
      r.mesh.scaling.set(scale, 1, scale);
      r.mesh.rotation.y += 0.08 * (i % 2 === 0 ? 1 : -1);
      r.mat.alpha = Math.max(0, 0.7 * (1 - t));
    });
    if (flash) flash.intensity = 25 * Math.max(0, 1 - t * 2);
    if (elapsed > 900) {
      rings.forEach(r => { r.mesh.dispose(); r.mat.dispose(); });
      ps.dispose();
      debris.dispose();
      _releaseLight(flash);
      _scene.onBeforeRenderObservable.remove(obs);
      const idx = _observers.indexOf(obs);
      if (idx >= 0) _observers.splice(idx, 1);
    }
  });
  _observers.push(obs);
}

/**
 * Rock Debris — chunks of earth exploding outward with dust cloud.
 * Adapted from WM rock projectile collision impact.
 */
export function emitRockDebris(position) {
  if (!_scene) return;

  // Rock fragment meshes
  const chunks = [];
  for (let i = 0; i < 6; i++) {
    const chunk = MeshBuilder.CreateIcoSphere('rock_chunk' + i, {
      radius: 0.06 + Math.random() * 0.12, subdivisions: 1,
    }, _scene);
    const chunkMat = new StandardMaterial('rock_chunk_mat' + i, _scene);
    chunkMat.diffuseColor = new Color3(0.45 + Math.random() * 0.15, 0.35 + Math.random() * 0.1, 0.25);
    chunk.material = chunkMat;
    chunk.position.copyFrom(position);
    const angle = (i / 6) * Math.PI * 2;
    chunk.metadata = {
      vx: Math.cos(angle) * (2 + Math.random() * 3),
      vy: 3 + Math.random() * 4,
      vz: Math.sin(angle) * (2 + Math.random() * 3),
    };
    chunks.push(chunk);
  }

  // Dust cloud
  const ps = new ParticleSystem('rock_dust', scaleBurst(40), _scene);
  ps.particleTexture = _tex(_smokeTexture);
  ps.emitter = position.clone();
  ps.minLifeTime = 0.3;
  ps.maxLifeTime = 0.8;
  ps.minSize = 0.2;
  ps.maxSize = 0.6;
  ps.emitRate = 0;
  ps.manualEmitCount = scaleBurst(30);
  ps.color1 = new Color4(0.6, 0.5, 0.4, 0.7);
  ps.color2 = new Color4(0.4, 0.35, 0.25, 0.4);
  ps.colorDead = new Color4(0.3, 0.25, 0.2, 0);
  ps.minEmitPower = 2;
  ps.maxEmitPower = 6;
  ps.direction1 = new Vector3(-1, 0.5, -1);
  ps.direction2 = new Vector3(1, 2, 1);
  ps.gravity = new Vector3(0, -8, 0);
  ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  ps.start();

  let elapsed = 0;
  const obs = _scene.onBeforeRenderObservable.add(() => {
    const dt = _scene.getEngine().getDeltaTime() / 1000;
    elapsed += dt * 1000;
    chunks.forEach(c => {
      const md = c.metadata;
      c.position.x += md.vx * dt;
      c.position.y += md.vy * dt;
      c.position.z += md.vz * dt;
      md.vy -= 12 * dt;
      c.rotation.x += dt * 4;
    });
    if (elapsed > 1000) {
      chunks.forEach(c => c.dispose());
      ps.dispose();
      _scene.onBeforeRenderObservable.remove(obs);
      const idx = _observers.indexOf(obs);
      if (idx >= 0) _observers.splice(idx, 1);
    }
  });
  _observers.push(obs);
}

/**
 * Light Burst — bright flash with radial light-burst texture plane.
 * Adapted from WM light-strike thunder flash.
 */
export function emitLightBurst(position) {
  if (!_scene) return;

  // Billboard flash plane using light-burst texture
  const flash = MeshBuilder.CreatePlane('light_burst', { size: 5 }, _scene);
  flash.position.copyFrom(position);
  flash.position.y += 1;
  flash.billboardMode = 7; // BILLBOARDMODE_ALL
  const flashMat = new StandardMaterial('light_burst_mat', _scene);
  flashMat.diffuseTexture = getBattleTexture('light_burst') ||
    new Texture('/textures/battle/fx/light-burst.png', _scene);
  flashMat.emissiveColor = new Color3(1, 1, 1);
  flashMat.disableLighting = true;
  flashMat.alpha = 0.9;
  flashMat.useAlphaFromDiffuseTexture = true;
  flashMat.backFaceCulling = false;
  flash.material = flashMat;

  let elapsed = 0;
  const obs = _scene.onBeforeRenderObservable.add(() => {
    elapsed += _scene.getEngine().getDeltaTime();
    const t = elapsed / 200;
    flash.scaling.setAll(1 + t * 2);
    flashMat.alpha = Math.max(0, 0.9 * (1 - t));
    if (elapsed > 250) {
      flash.dispose(); flashMat.dispose();
      _scene.onBeforeRenderObservable.remove(obs);
      const idx = _observers.indexOf(obs);
      if (idx >= 0) _observers.splice(idx, 1);
    }
  });
  _observers.push(obs);
}

// ── Bow fire animation for Ice Lance ───────────────────────────────────────

// ═════════════════════════════════════════════════════════════════════════════
//  AAA ENHANCED WEAPON EFFECTS
//  New persistent / missing weapon VFX for current-gen quality.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Persistent Fire Ground — lingering flames on the ground after fire weapon impact.
 * Creates a burning patch that fades over 2 seconds.
 */
export function emitPersistentFireGround(position) {
  if (!_scene) return;
  const ps = new ParticleSystem('fire_ground', scaleParticles(80), _scene);
  ps.particleTexture = _tex(_flameTexture);
  const emitter = position.clone();
  emitter.y += 0.15;
  ps.emitter = emitter;
  ps.createSphereEmitter(1.8);
  ps.minLifeTime = 0.3;
  ps.maxLifeTime = 0.7;
  ps.minSize = 0.12;
  ps.maxSize = 0.4;
  ps.emitRate = scaleParticles(40);
  ps.color1 = new Color4(1, 0.5, 0, 0.9);
  ps.color2 = new Color4(1, 0.15, 0, 0.6);
  ps.colorDead = new Color4(0.2, 0.05, 0, 0);
  ps.minEmitPower = 0.5;
  ps.maxEmitPower = 2;
  ps.direction1 = new Vector3(-0.3, 0.5, -0.3);
  ps.direction2 = new Vector3(0.3, 2, 0.3);
  ps.gravity = new Vector3(0, 1.5, 0);
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.start();

  // Fade and dispose after 2s
  let elapsed = 0;
  const obs = _scene.onBeforeRenderObservable.add(() => {
    elapsed += _scene.getEngine().getDeltaTime();
    if (elapsed > 1400) {
      ps.emitRate = Math.max(0, 40 * (1 - (elapsed - 1400) / 600));
    }
    if (elapsed > 2200) {
      ps.dispose();
      _scene.onBeforeRenderObservable.remove(obs);
      const idx = _observers.indexOf(obs);
      if (idx >= 0) _observers.splice(idx, 1);
    }
  });
  _observers.push(obs);
}

/**
 * Ice Ground Frost — lingering frost patch with cold mist at impact point.
 */
export function emitIceGroundFrost(position) {
  if (!_scene) return;
  // Frost disc
  const disc = MeshBuilder.CreateDisc('ice_frost_disc', { radius: 2.5, tessellation: 24 }, _scene);
  disc.position.copyFrom(position);
  disc.position.y = 0.08;
  disc.rotation.x = Math.PI / 2;
  const mat = new StandardMaterial('ice_frost_mat', _scene);
  mat.diffuseColor = new Color3(0.6, 0.88, 1);
  mat.emissiveColor = new Color3(0.2, 0.45, 0.7);
  mat.alpha = 0.5;
  mat.disableLighting = true;
  disc.material = mat;

  // Cold mist particles
  const ps = new ParticleSystem('ice_mist', scaleParticles(30), _scene);
  ps.particleTexture = _tex(_smokeTexture);
  ps.emitter = position.clone();
  ps.createSphereEmitter(2);
  ps.minLifeTime = 0.5;
  ps.maxLifeTime = 1.2;
  ps.minSize = 0.3;
  ps.maxSize = 0.8;
  ps.emitRate = scaleParticles(15);
  ps.color1 = new Color4(0.6, 0.85, 1, 0.4);
  ps.color2 = new Color4(0.8, 0.95, 1, 0.2);
  ps.colorDead = new Color4(0.7, 0.9, 1, 0);
  ps.minEmitPower = 0.3;
  ps.maxEmitPower = 1.5;
  ps.direction1 = new Vector3(-0.5, 0, -0.5);
  ps.direction2 = new Vector3(0.5, 0.8, 0.5);
  ps.gravity = new Vector3(0, 0.5, 0);
  ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  ps.start();

  let elapsed = 0;
  const obs = _scene.onBeforeRenderObservable.add(() => {
    elapsed += _scene.getEngine().getDeltaTime();
    if (elapsed > 2000) {
      const fade = (elapsed - 2000) / 800;
      mat.alpha = Math.max(0, 0.5 * (1 - fade));
      ps.emitRate = Math.max(0, 15 * (1 - fade));
    }
    if (elapsed > 3000) {
      disc.dispose(); mat.dispose(); ps.dispose();
      _scene.onBeforeRenderObservable.remove(obs);
      const idx = _observers.indexOf(obs);
      if (idx >= 0) _observers.splice(idx, 1);
    }
  });
  _observers.push(obs);
}

/**
 * Gravity Well Pulse — pulsating dark sphere with inward spiraling particles.
 */
export function emitGravityWellPulse(position) {
  if (!_scene) return;
  const sphere = MeshBuilder.CreateSphere('grav_sphere', { diameter: 3, segments: 16 }, _scene);
  sphere.position.copyFrom(position);
  sphere.position.y += 1.5;
  const mat = new StandardMaterial('grav_sphere_mat', _scene);
  mat.diffuseColor = new Color3(0.08, 0, 0.15);
  mat.emissiveColor = new Color3(0.15, 0, 0.35);
  mat.alpha = 0.35;
  mat.disableLighting = true;
  sphere.material = mat;

  // Inward spiraling particles
  const ps = new ParticleSystem('grav_pull', scaleParticles(60), _scene);
  ps.particleTexture = _tex(_flareTexture);
  ps.emitter = position.clone();
  ps.createSphereEmitter(6);
  ps.minLifeTime = 0.4;
  ps.maxLifeTime = 0.9;
  ps.minSize = 0.05;
  ps.maxSize = 0.18;
  ps.emitRate = scaleParticles(50);
  ps.color1 = new Color4(0.5, 0.2, 1, 0.9);
  ps.color2 = new Color4(0.3, 0, 0.8, 0.6);
  ps.colorDead = new Color4(0.1, 0, 0.3, 0);
  ps.minEmitPower = -8; // negative = inward
  ps.maxEmitPower = -3;
  ps.gravity = new Vector3(0, 2, 0);
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.start();

  let elapsed = 0;
  const obs = _scene.onBeforeRenderObservable.add(() => {
    elapsed += _scene.getEngine().getDeltaTime();
    const pulse = 1 + Math.sin(elapsed * 0.008) * 0.15;
    sphere.scaling.setAll(pulse);
    mat.alpha = 0.35 * pulse;
    if (elapsed > 2500) {
      const fade = (elapsed - 2500) / 500;
      mat.alpha = Math.max(0, 0.35 * (1 - fade));
      ps.emitRate = Math.max(0, 50 * (1 - fade));
    }
    if (elapsed > 3200) {
      sphere.dispose(); mat.dispose(); ps.dispose();
      _scene.onBeforeRenderObservable.remove(obs);
      const idx = _observers.indexOf(obs);
      if (idx >= 0) _observers.splice(idx, 1);
    }
  });
  _observers.push(obs);
}

/**
 * Shield Reflect Flash — bright mirror-like flash when a shield blocks/reflects.
 */
export function emitShieldReflectFlash(position) {
  if (!_scene) return;
  // Concentric expanding rings
  for (let i = 0; i < 3; i++) {
    const ring = MeshBuilder.CreateTorus('shield_ring' + i, {
      diameter: 0.5 + i * 0.3, thickness: 0.06, tessellation: 32,
    }, _scene);
    ring.position.copyFrom(position);
    ring.position.y += 1;
    const ringMat = new StandardMaterial('shield_ring_mat' + i, _scene);
    ringMat.emissiveColor = new Color3(0.5, 0.7, 1.0);
    ringMat.disableLighting = true;
    ringMat.alpha = 0.8;
    ring.material = ringMat;

    let elapsed = 0;
    const delay = i * 60;
    const obs = _scene.onBeforeRenderObservable.add(() => {
      elapsed += _scene.getEngine().getDeltaTime();
      if (elapsed < delay) return;
      const t = (elapsed - delay) / 300;
      ring.scaling.setAll(1 + t * 8);
      ringMat.alpha = Math.max(0, 0.8 * (1 - t));
      if (elapsed - delay > 400) {
        ring.dispose(); ringMat.dispose();
        _scene.onBeforeRenderObservable.remove(obs);
        const idx = _observers.indexOf(obs);
        if (idx >= 0) _observers.splice(idx, 1);
      }
    });
    _observers.push(obs);
  }

  // Bright flash light (pooled)
  const flash = _acquireLight('shield_flash', position);
  if (flash) {
    flash.diffuse = new Color3(0.6, 0.8, 1);
    flash.intensity = 20;
    flash.range = 18;
    setTimeout(() => _releaseLight(flash), 200);
  }

  // Spark burst
  const ps = new ParticleSystem('shield_sparks', scaleBurst(30), _scene);
  ps.particleTexture = _tex(_sparkTexture);
  ps.emitter = position.clone();
  ps.minLifeTime = 0.15;
  ps.maxLifeTime = 0.4;
  ps.minSize = 0.04;
  ps.maxSize = 0.12;
  ps.emitRate = 0;
  ps.manualEmitCount = scaleBurst(25);
  ps.color1 = new Color4(0.7, 0.85, 1, 1);
  ps.color2 = new Color4(1, 1, 1, 0.8);
  ps.colorDead = new Color4(0.5, 0.6, 0.8, 0);
  ps.minEmitPower = 6;
  ps.maxEmitPower = 15;
  ps.direction1 = new Vector3(-1, -0.5, -1);
  ps.direction2 = new Vector3(1, 2, 1);
  ps.gravity = new Vector3(0, -5, 0);
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.start();
  setTimeout(() => ps.dispose(), 600);
}

/**
 * Data Burst — digital glitch effect for memory_leak.
 * Square pixel-style particles erupting outward.
 */
export function emitDataBurst(position) {
  if (!_scene) return;
  const ps = new ParticleSystem('data_burst', scaleBurst(60), _scene);
  ps.particleTexture = _tex(_pixelTexture);
  ps.emitter = position.clone();
  ps.minLifeTime = 0.3;
  ps.maxLifeTime = 0.8;
  ps.minSize = 0.06;
  ps.maxSize = 0.18;
  ps.emitRate = 0;
  ps.manualEmitCount = scaleBurst(50);
  ps.color1 = new Color4(0, 1, 0.4, 1);
  ps.color2 = new Color4(0, 0.7, 1, 0.8);
  ps.colorDead = new Color4(0, 0.3, 0.1, 0);
  ps.minEmitPower = 5;
  ps.maxEmitPower = 14;
  ps.direction1 = new Vector3(-1, -0.5, -1);
  ps.direction2 = new Vector3(1, 3, 1);
  ps.gravity = new Vector3(0, -6, 0);
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.start();

  // Flash
  const light = _acquireLight('data_flash', position);
  if (light) {
    light.diffuse = new Color3(0, 1, 0.5);
    light.intensity = 12;
    light.range = 14;
  }

  let elapsed = 0;
  const obs = _scene.onBeforeRenderObservable.add(() => {
    elapsed += _scene.getEngine().getDeltaTime();
    if (light) light.intensity = 12 * Math.max(0, 1 - elapsed / 250);
    if (elapsed > 900) {
      ps.dispose(); _releaseLight(light);
      _scene.onBeforeRenderObservable.remove(obs);
      const idx = _observers.indexOf(obs);
      if (idx >= 0) _observers.splice(idx, 1);
    }
  });
  _observers.push(obs);
}

/**
 * Warp Distortion — teleport flash with inward/outward particle whoosh.
 */
export function emitWarpDistortion(position) {
  if (!_scene) return;
  // Inward whoosh
  const psIn = new ParticleSystem('warp_in', scaleBurst(40), _scene);
  psIn.particleTexture = _tex(_flareTexture);
  psIn.emitter = position.clone();
  psIn.createSphereEmitter(5);
  psIn.minLifeTime = 0.2;
  psIn.maxLifeTime = 0.5;
  psIn.minSize = 0.1;
  psIn.maxSize = 0.3;
  psIn.emitRate = 0;
  psIn.manualEmitCount = scaleBurst(35);
  psIn.color1 = new Color4(0.8, 0.4, 1, 0.9);
  psIn.color2 = new Color4(0.4, 0.1, 0.8, 0.6);
  psIn.colorDead = new Color4(0.2, 0, 0.4, 0);
  psIn.minEmitPower = -10;
  psIn.maxEmitPower = -4;
  psIn.gravity = new Vector3(0, 0, 0);
  psIn.blendMode = ParticleSystem.BLENDMODE_ADD;
  psIn.start();

  // Delayed outward burst
  setTimeout(() => {
    if (!_scene) return;
    const psOut = new ParticleSystem('warp_out', scaleBurst(40), _scene);
    psOut.particleTexture = _tex(_flareTexture);
    psOut.emitter = position.clone();
    psOut.minLifeTime = 0.2;
    psOut.maxLifeTime = 0.6;
    psOut.minSize = 0.08;
    psOut.maxSize = 0.25;
    psOut.emitRate = 0;
    psOut.manualEmitCount = scaleBurst(35);
    psOut.color1 = new Color4(0.9, 0.5, 1, 0.9);
    psOut.color2 = new Color4(0.5, 0.2, 0.9, 0.6);
    psOut.colorDead = new Color4(0.3, 0.1, 0.5, 0);
    psOut.minEmitPower = 6;
    psOut.maxEmitPower = 16;
    psOut.direction1 = new Vector3(-1, -1, -1);
    psOut.direction2 = new Vector3(1, 2, 1);
    psOut.gravity = new Vector3(0, -3, 0);
    psOut.blendMode = ParticleSystem.BLENDMODE_ADD;
    psOut.start();
    setTimeout(() => psOut.dispose(), 800);
  }, 200);

  // Flash + ring
  emitShockwaveRing(position, 6, [0.7, 0.3, 1]);
  const light = _acquireLight('warp_flash', position);
  if (light) {
    light.diffuse = new Color3(0.7, 0.3, 1);
    light.intensity = 18;
    light.range = 20;
    setTimeout(() => { try { _releaseLight(light); psIn.dispose(); } catch (_) {} }, 600);
  } else {
    setTimeout(() => { try { psIn.dispose(); } catch (_) {} }, 600);
  }
}

// ── Bow fire animation for Ice Lance (original) ───────────────────────────
/**
 * Show a brief bow model animation when firing ice_lance.
 * The bow.glb is loaded from WM assets, shown at muzzle position,
 * then disposed after the draw animation completes.
 */
let _bowTemplate = null;
let _bowLoading = false;

export function playBowFireAnimation(position, forward) {
  if (!_scene) return;
  _ensureBow(_scene).then(template => {
    if (!template) return;
    const bow = template.clone('bow_fire', null);
    bow.setEnabled(true);
    bow.getChildMeshes().forEach(m => m.setEnabled(true));
    bow.position.copyFrom(position);
    bow.scaling.setAll(1.5);
    // Orient bow to face forward
    if (forward) {
      const angle = Math.atan2(forward.x, forward.z);
      bow.rotation.y = angle;
    }

    let elapsed = 0;
    const obs = _scene.onBeforeRenderObservable.add(() => {
      elapsed += _scene.getEngine().getDeltaTime();
      const t = elapsed / 400;
      // Draw-back animation: slight scale Y increase then snap
      bow.scaling.y = 1.5 * (1 + Math.sin(t * Math.PI) * 0.2);
      if (t > 0.7) {
        bow.getChildMeshes().forEach(m => {
          if (m.material) m.material.alpha = Math.max(0, 1 - (t - 0.7) / 0.3);
        });
      }
      if (elapsed > 400) {
        bow.dispose(false, true);
        _scene.onBeforeRenderObservable.remove(obs);
      }
    });
  });
}

async function _ensureBow(scene) {
  if (_bowTemplate) return _bowTemplate;
  if (_bowLoading) return null;
  _bowLoading = true;
  try {
    const result = await SceneLoader.ImportMeshAsync('', '/models/battle/', 'bow.glb', scene);
    if (result.meshes.length > 0) {
      _bowTemplate = result.meshes[0];
      _bowTemplate.setEnabled(false);
      _bowTemplate.getChildMeshes().forEach(m => m.setEnabled(false));
      return _bowTemplate;
    }
  } catch {
    // bow.glb not available
  }
  _bowLoading = false;
  return null;
}

