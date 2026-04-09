/**
 * weapon-fx-enhance.js — AAA-quality weapon VFX enhancement system
 *
 * Provides current-gen console-quality visual polish for all pickups:
 *   - GlowLayer for emissive weapon meshes
 *   - DefaultRenderingPipeline (bloom, chromatic aberration, grain, vignette)
 *   - Per-weapon projectile rotation/tumble animations
 *   - Enhanced particle trail configurations
 *   - Impact decal system (scorch marks, frost patches)
 *   - Screen distortion on heavy impacts
 *   - Persistent ground effects
 *
 * Babylon.js capabilities leveraged:
 *   - GlowLayer (Layers/)
 *   - DefaultRenderingPipeline (PostProcesses/)
 *   - ParticleSystem addSizeGradient/addColorGradient
 *   - MeshBuilder.CreateDecal for impact marks
 *   - Scene.onBeforeRenderObservable for per-frame animation
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { GPUParticleSystem } from '@babylonjs/core/Particles/gpuParticleSystem';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import {
  isGlowEnabled, isPostFXEnabled, bloomKernel, glowKernelSize,
  glowFixedSize, glowSamples, decalsEnabled, maxDecals as getMaxDecals,
  isGrainEnabled, isVignetteEnabled, scaleTrail, getTier, TIER,
  gpuParticlesEnabled, scaleGPUParticles, scaleParticles,
  clusteredLightsEnabled, maxClusteredLights,
  motionBlurEnabled, ssrEnabled,
  runtimeFXBudget, runtimePostFXBudget, runtimePressure,
} from '../perf-tier.js';

const PIXEL_TEX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

// ── State ───────────────────────────────────────────────────────────────────
let _scene = null;
let _camera = null;
let _glowLayer = null;
let _pipeline = null;
let _observers = [];
let _decals = [];
let _clusteredContainer = null;
let _havokPlugin = null;
let _gpuParticleSupported = null; // lazy-detected
let _lastDecalTickAt = 0;

// ── Per-weapon rotation configs ─────────────────────────────────────────────
// Each entry: { axis: Vector3, speed: rad/s, tumble: bool, tumbleAxis, tumbleSpeed }
const PROJECTILE_ROTATION = {
  bowling_ball:  { axis: new Vector3(1, 0, 0), speed: 12, tumble: false },
  cake:          { axis: new Vector3(0, 1, 0), speed: 3, tumble: true, tumbleAxis: new Vector3(0.3, 0, 1), tumbleSpeed: 1.5 },
  plunger:       { axis: new Vector3(0, 0, 1), speed: 0, tumble: false }, // flies straight
  nitro:         { axis: new Vector3(0, 1, 0), speed: 5, tumble: true, tumbleAxis: new Vector3(1, 0, 0), tumbleSpeed: 2 },
  missile:       { axis: new Vector3(0, 0, 1), speed: 0.5, tumble: false }, // subtle roll
  crimson_hydra: { axis: new Vector3(0, 0, 1), speed: 0.7, tumble: false },
  fireball:      { axis: new Vector3(0, 1, 0), speed: 8, tumble: false },
  toxic_spread:  { axis: new Vector3(0, 1, 0), speed: 6, tumble: true, tumbleAxis: new Vector3(1, 0, 0), tumbleSpeed: 3 },
  ice_lance:     { axis: new Vector3(0, 0, 1), speed: 0, tumble: false }, // flies like a dart
  rock_barrage:  { axis: new Vector3(0.5, 1, 0.3), speed: 4, tumble: true, tumbleAxis: new Vector3(1, 0.2, 0), tumbleSpeed: 2.5 },
  lightning_bolt:{ axis: new Vector3(0, 0, 1), speed: 0, tumble: false },
  wind_slash:    { axis: new Vector3(0, 0, 1), speed: 18, tumble: false }, // rapid spin like shuriken
  cannon:        { axis: new Vector3(1, 0, 0), speed: 10, tumble: false },
  frostAxe:      { axis: new Vector3(0, 0, 1), speed: 14, tumble: false }, // axe spin
  moltenDagger:  { axis: new Vector3(0, 0, 1), speed: 20, tumble: false },
  grenade:       { axis: new Vector3(0.4, 1, 0.2), speed: 5, tumble: true, tumbleAxis: new Vector3(1, 0, 0.5), tumbleSpeed: 3 },
  super_nova:    { axis: new Vector3(0, 1, 0), speed: 1.5, tumble: false }, // slow ominous spin
  glow_thrower:  { axis: new Vector3(0, 0, 1), speed: 0, tumble: false },
  glo_burst:     { axis: new Vector3(0, 0, 1), speed: 0, tumble: false },
  final_fission: { axis: new Vector3(0, 1, 0), speed: 0.8, tumble: false }, // slow ominous spin
};

// ── Impact decal color configs ──────────────────────────────────────────────
const DECAL_CONFIGS = {
  fireball:       { color: new Color3(0.15, 0.05, 0.0), emissive: new Color3(0.4, 0.1, 0.0), size: 3.5, lifetime: 8000 },
  missile:        { color: new Color3(0.1, 0.05, 0.02), emissive: new Color3(0.3, 0.08, 0.0), size: 4.0, lifetime: 10000 },
  crimson_hydra:  { color: new Color3(0.16, 0.03, 0.04), emissive: new Color3(0.5, 0.08, 0.05), size: 3.2, lifetime: 8500 },
  nitro:          { color: new Color3(0.05, 0.1, 0.08), emissive: new Color3(0.0, 0.2, 0.1), size: 3.0, lifetime: 6000 },
  super_nova:     { color: new Color3(0.2, 0.1, 0.0), emissive: new Color3(0.6, 0.3, 0.0), size: 8.0, lifetime: 12000 },
  ice_lance:      { color: new Color3(0.7, 0.85, 0.95), emissive: new Color3(0.3, 0.5, 0.7), size: 2.5, lifetime: 5000 },
  toxic_spread:   { color: new Color3(0.1, 0.3, 0.05), emissive: new Color3(0.05, 0.2, 0.0), size: 3.0, lifetime: 7000 },
  toxic_cloud:    { color: new Color3(0.08, 0.25, 0.03), emissive: new Color3(0.03, 0.15, 0.0), size: 5.0, lifetime: 9000 },
  tornado:        { color: new Color3(0.3, 0.3, 0.28), emissive: new Color3(0.1, 0.12, 0.1), size: 6.0, lifetime: 6000 },
  lightning_bolt: { color: new Color3(0.05, 0.05, 0.1), emissive: new Color3(0.4, 0.4, 0.8), size: 2.0, lifetime: 4000 },
  gravity_well:   { color: new Color3(0.05, 0.0, 0.1), emissive: new Color3(0.15, 0.0, 0.3), size: 5.0, lifetime: 8000 },
  rock_barrage:   { color: new Color3(0.25, 0.2, 0.15), emissive: new Color3(0.1, 0.08, 0.05), size: 3.5, lifetime: 6000 },
  bowling_ball:   { color: new Color3(0.15, 0.12, 0.1), emissive: new Color3(0.05, 0.04, 0.03), size: 2.0, lifetime: 5000 },
  cake:           { color: new Color3(0.6, 0.4, 0.2), emissive: new Color3(0.2, 0.12, 0.05), size: 2.5, lifetime: 4000 },
  final_fission:  { color: new Color3(0.05, 0.04, 0.03), emissive: new Color3(0.3, 0.13, 0.03), size: 7.5, lifetime: 28000 },
};

// ═══════════════════════════════════════════════════════════════════════════
//  INITIALIZATION — call once when battle scene is ready
// ═══════════════════════════════════════════════════════════════════════════

export function initWeaponFXEnhance(scene, camera) {
  _scene = scene;
  _camera = camera;
  _setupGlowLayer(scene);
  _setupRenderPipeline(scene, camera);
  _setupClusteredLighting(scene);
  syncWeaponFXQuality();
}

export function disposeWeaponFXEnhance() {
  _observers.forEach(o => {
    try { _scene?.onBeforeRenderObservable?.remove(o); } catch (_) {}
  });
  _observers = [];
  _decals.forEach(d => {
    try { d.mesh?.dispose(); d.material?.dispose(); } catch (_) {}
  });
  _decals = [];
  if (_glowLayer) { _glowLayer.dispose(); _glowLayer = null; }
  if (_pipeline) { _pipeline.dispose(); _pipeline = null; }
  if (_clusteredContainer) {
    try { _clusteredContainer.dispose(); } catch (_) {}
    _clusteredContainer = null;
    _clusteredLightCount = 0;
  }
  // Reset Havok singleton so re-init uses the new scene
  _havokPlugin = null;
  _havokReady = null;
  _gpuParticleSupported = null;
  // Clear batch rotation registry
  _rotatingMeshes.length = 0;
  _rotationObserver = null;
  _scene = null;
  _camera = null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  GLOW LAYER — makes emissive weapon meshes bloom naturally
// ═══════════════════════════════════════════════════════════════════════════

function _setupGlowLayer(scene) {
  if (_glowLayer) return;
  if (!isGlowEnabled()) return; // Skip entirely on LOW tier
  _glowLayer = new GlowLayer('weaponGlow', scene, {
    mainTextureSamples: glowSamples(),
    blurKernelSize: glowKernelSize(),
    mainTextureFixedSize: glowFixedSize(),
  });
  _glowLayer.intensity = 0.65;
  // Only glow meshes that opt-in via metadata or high emissive
  _glowLayer.customEmissiveColorSelector = (mesh, subMesh, material, result) => {
    if (mesh.metadata?.glowIntensity) {
      const ec = material.emissiveColor || Color3.Black();
      const gi = mesh.metadata.glowIntensity;
      result.set(ec.r * gi, ec.g * gi, ec.b * gi, 1.0);
    } else if (material && material.emissiveColor) {
      const e = material.emissiveColor;
      const lum = e.r * 0.299 + e.g * 0.587 + e.b * 0.114;
      if (lum > 0.25) {
        result.set(e.r * 0.6, e.g * 0.6, e.b * 0.6, 1.0);
      } else {
        result.set(0, 0, 0, 0);
      }
    } else {
      result.set(0, 0, 0, 0);
    }
  };
}

export function getGlowLayer() { return _glowLayer; }

/**
 * Tag a mesh for enhanced glow. Call after creating weapon model meshes.
 * @param {Mesh} mesh - the mesh to glow
 * @param {number} intensity - glow multiplier (0.5 = subtle, 2.0 = intense)
 */
export function tagMeshForGlow(mesh, intensity = 1.0) {
  if (!mesh) return;
  if (!mesh.metadata) mesh.metadata = {};
  mesh.metadata.glowIntensity = intensity;
}

// ═══════════════════════════════════════════════════════════════════════════
//  DEFAULT RENDERING PIPELINE — bloom, chromatic aberration, grain
// ═══════════════════════════════════════════════════════════════════════════

function _setupRenderPipeline(scene, camera) {
  if (_pipeline) return;
  if (!isPostFXEnabled()) return; // Skip entire pipeline on LOW tier
  try {
    _pipeline = new DefaultRenderingPipeline('weaponFXPipeline', true, scene, [camera]);
    // Bloom — subtle baseline, pulsed up on big explosions
    _pipeline.bloomEnabled = true;
    _pipeline.bloomThreshold = 0.72;
    _pipeline.bloomWeight = 0.25;
    _pipeline.bloomKernel = bloomKernel();
    _pipeline.bloomScale = 0.5;
    // Chromatic aberration — off by default, enabled on hit
    _pipeline.chromaticAberrationEnabled = false;
    _pipeline.chromaticAberration.aberrationAmount = 0;
    // Film grain — tier-dependent
    _pipeline.grainEnabled = isGrainEnabled();
    _pipeline.grain.intensity = 8;
    _pipeline.grain.animated = isGrainEnabled();
    // Vignette — tier-dependent
    _pipeline.vignetteEnabled = isVignetteEnabled();
    _pipeline.vignette.vignetteWeight = 1.2;
    _pipeline.vignette.vignetteStretch = 0.5;
    _pipeline.vignette.vignetteColor = new Color4(0, 0, 0, 0);
    _pipeline.vignette.vignetteCentreX = 0;
    _pipeline.vignette.vignetteCentreY = 0;
    // Image processing
    _pipeline.imageProcessingEnabled = true;
    _pipeline.imageProcessing.contrast = 1.05;
    _pipeline.imageProcessing.exposure = 1.02;
  } catch (e) {
    console.warn('[weapon-fx-enhance] Pipeline setup failed (WebGL1?):', e.message);
    _pipeline = null;
  }
}

export function getPipeline() { return _pipeline; }

export function syncWeaponFXQuality() {
  const postBudget = runtimePostFXBudget();
  const fxBudget = runtimeFXBudget();

  if (_glowLayer) {
    _glowLayer.intensity = isGlowEnabled() ? (0.28 + fxBudget * 0.37) : 0;
    _glowLayer.blurKernelSize = Math.max(8, Math.round(glowKernelSize() * Math.max(0.5, postBudget)));
  }

  if (!_pipeline) return;
  const bloomAllowed = isPostFXEnabled() && postBudget > 0.16;
  _pipeline.bloomEnabled = bloomAllowed;
  _pipeline.bloomThreshold = 0.78;
  _pipeline.bloomWeight = bloomAllowed ? (0.08 + postBudget * 0.14) : 0;
  _pipeline.bloomKernel = Math.max(12, Math.round(bloomKernel() * Math.max(0.45, postBudget)));
  _pipeline.bloomScale = postBudget < 0.4 ? 0.35 : 0.5;

  const chromaAllowed = bloomAllowed && postBudget > 0.42;
  _pipeline.chromaticAberrationEnabled = false;
  _pipeline.chromaticAberration.aberrationAmount = 0;

  _pipeline.grainEnabled = isGrainEnabled() && postBudget > 0.72;
  if (_pipeline.grain) {
    _pipeline.grain.intensity = _pipeline.grainEnabled ? 4 + postBudget * 3 : 0;
    _pipeline.grain.animated = _pipeline.grainEnabled;
  }

  _pipeline.vignetteEnabled = isVignetteEnabled() && postBudget > 0.54;
  if (_pipeline.vignette) {
    _pipeline.vignette.vignetteWeight = 0.65 + postBudget * 0.35;
  }

  _pipeline.imageProcessingEnabled = true;
  if (_pipeline.imageProcessing) {
    _pipeline.imageProcessing.contrast = 1.0 + postBudget * 0.04;
    _pipeline.imageProcessing.exposure = 1.0 + postBudget * 0.02;
  }

  return chromaAllowed;
}

// ═══════════════════════════════════════════════════════════════════════════
//  BLOOM PULSE — spike bloom on big explosions then decay
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Temporarily spike bloom weight for dramatic explosions.
 * @param {number} intensity 0.0–1.0 (maps to 0.25–1.2 bloom weight)
 * @param {number} durationMs decay time
 */
export function pulseBloom(intensity = 0.6, durationMs = 400) {
  if (!_pipeline || !_scene) return;
  const postBudget = runtimePostFXBudget();
  if (postBudget <= 0.16) return;
  const baseWeight = 0.08 + postBudget * 0.14;
  const peakWeight = baseWeight + (intensity * postBudget * 0.55);
  _pipeline.bloomWeight = peakWeight;

  let elapsed = 0;
  const obs = _scene.onBeforeRenderObservable.add(() => {
    elapsed += _scene.getEngine().getDeltaTime();
    const t = Math.min(1, elapsed / durationMs);
    // Ease-out cubic
    const eased = 1 - Math.pow(1 - t, 3);
    _pipeline.bloomWeight = peakWeight + (baseWeight - peakWeight) * eased;
    if (t >= 1) {
      _pipeline.bloomWeight = baseWeight;
      _scene.onBeforeRenderObservable.remove(obs);
      const idx = _observers.indexOf(obs);
      if (idx >= 0) _observers.splice(idx, 1);
    }
  });
  _observers.push(obs);
}

// ═══════════════════════════════════════════════════════════════════════════
//  CHROMATIC ABERRATION PULSE — screen distortion on heavy hits
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Flash chromatic aberration for screen-distortion on heavy impacts.
 * @param {number} strength 0–1 (maps to 0–80 aberration amount)
 * @param {number} durationMs
 */
export function pulseChromatic(strength = 0.5, durationMs = 300) {
  if (!_pipeline || !_scene) return;
  const postBudget = runtimePostFXBudget();
  if (postBudget <= 0.42) return;
  _pipeline.chromaticAberrationEnabled = true;
  const peakAmount = strength * 36 * postBudget;

  let elapsed = 0;
  const obs = _scene.onBeforeRenderObservable.add(() => {
    elapsed += _scene.getEngine().getDeltaTime();
    const t = Math.min(1, elapsed / durationMs);
    const eased = 1 - Math.pow(1 - t, 2);
    _pipeline.chromaticAberration.aberrationAmount = peakAmount * (1 - eased);
    if (t >= 1) {
      _pipeline.chromaticAberrationEnabled = false;
      _pipeline.chromaticAberration.aberrationAmount = 0;
      _scene.onBeforeRenderObservable.remove(obs);
      const idx = _observers.indexOf(obs);
      if (idx >= 0) _observers.splice(idx, 1);
    }
  });
  _observers.push(obs);
}

// ═══════════════════════════════════════════════════════════════════════════
//  PROJECTILE ROTATION — per-frame spin/tumble for in-flight meshes
// ═══════════════════════════════════════════════════════════════════════════

// ── Batch rotation system ─────────────────────────────────────────────────
// Instead of one onBeforeRenderObservable per projectile (N observers),
// use a single observer that iterates a lightweight registry.
const _rotatingMeshes = []; // { mesh, axis, speed, tumbleAxis, tumbleSpeed }
let _rotationObserver = null;

function _ensureRotationObserver() {
  if (_rotationObserver || !_scene) return;
  _rotationObserver = _scene.onBeforeRenderObservable.add(() => {
    if (_rotatingMeshes.length === 0) return;
    const dt = _scene.getEngine().getDeltaTime() / 1000;
    for (let i = _rotatingMeshes.length - 1; i >= 0; i--) {
      const entry = _rotatingMeshes[i];
      if (entry.mesh.isDisposed?.()) {
        _rotatingMeshes.splice(i, 1);
        continue;
      }
      entry.mesh.rotate(entry.axis, entry.speed * dt);
      if (entry.tumbleAxis) {
        entry.mesh.rotate(entry.tumbleAxis, entry.tumbleSpeed * dt);
      }
    }
  });
  _observers.push(_rotationObserver);
}

/**
 * Attach spin/tumble animation to a projectile mesh.
 * Uses a single batch observer instead of one observer per projectile.
 * @param {TransformNode} mesh - the projectile root
 * @param {string} weaponId - weapon type key
 * @returns {Function} dispose callback to unregister the mesh
 */
export function attachProjectileRotation(mesh, weaponId) {
  if (!_scene || !mesh) return () => {};
  const config = PROJECTILE_ROTATION[weaponId];
  if (!config || config.speed === 0) return () => {};

  _ensureRotationObserver();
  const entry = {
    mesh,
    axis: config.axis.normalize(),
    speed: config.speed,
    tumbleAxis: config.tumble && config.tumbleAxis ? config.tumbleAxis.normalize() : null,
    tumbleSpeed: config.tumbleSpeed || 0,
  };
  _rotatingMeshes.push(entry);
  return () => {
    const idx = _rotatingMeshes.indexOf(entry);
    if (idx >= 0) _rotatingMeshes.splice(idx, 1);
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  IMPACT DECALS — scorch marks, frost patches on terrain
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Stamp an impact decal on the ground at the given position.
 * @param {Vector3} position
 * @param {string} weaponId
 */
export function stampImpactDecal(position, weaponId) {
  if (!_scene || !decalsEnabled()) return;
  if (runtimePressure() > 0.68) return;
  const config = DECAL_CONFIGS[weaponId];
  if (!config) return;
  const cap = getMaxDecals();
  if (cap <= 0) return;

  // Find ground mesh via ray
  const ray = new BABYLON_RAY(position.add(new Vector3(0, 2, 0)), new Vector3(0, -1, 0), 10);
  // Use scene.pick for ground detection
  const pick = _scene.pickWithRay(ray, (m) => {
    return m.isPickable && !m.name.startsWith('proj_') && !m.name.startsWith('mdl_')
      && !m.name.startsWith('weapon_') && !m.name.startsWith('kart_');
  });

  if (!pick?.hit || !pick.pickedMesh) return;

  const size = new Vector3(config.size, config.size, config.size);
  const normal = pick.getNormal(true) || new Vector3(0, 1, 0);

  try {
    const decal = MeshBuilder.CreateDecal('impact_decal', pick.pickedMesh, {
      position: pick.pickedPoint,
      normal,
      size,
    });

    const decalMat = new StandardMaterial('decalMat_' + Date.now(), _scene);
    decalMat.diffuseColor = config.color;
    decalMat.emissiveColor = config.emissive;
    decalMat.alpha = 0.55;
    decalMat.zOffset = -2;
    decalMat.backFaceCulling = false;
    decal.material = decalMat;

    // Track for cleanup
    _decals.push({ mesh: decal, material: decalMat, birth: Date.now(), lifetime: config.lifetime });

    // Mark overflow decals for lazy eviction on tickDecals to avoid sync dispose spikes.
    const overflow = _decals.length - cap;
    for (let i = 0; i < overflow; i++) {
      if (_decals[i]) _decals[i].lifetime = Math.min(_decals[i].lifetime, 0);
    }
  } catch (_e) {
    // Decal creation can fail on complex geometry — silently ignore
  }
}

/** Fade and remove expired decals (call periodically). */
export function tickDecals() {
  if (!_scene) return;
  const now = Date.now();
  const pressure = runtimePressure();
  const minInterval = pressure > 0.7 ? 180 : pressure > 0.45 ? 120 : 48;
  if ((now - _lastDecalTickAt) < minInterval) return;
  _lastDecalTickAt = now;
  for (let i = _decals.length - 1; i >= 0; i--) {
    const d = _decals[i];
    const age = now - d.birth;
    if (age >= d.lifetime) {
      d.mesh?.dispose();
      d.material?.dispose();
      _decals.splice(i, 1);
    } else if (age > d.lifetime * 0.7) {
      // Fade out in last 30%
      const fadeT = (age - d.lifetime * 0.7) / (d.lifetime * 0.3);
      if (d.material) d.material.alpha = 0.55 * (1 - fadeT);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  ENHANCED PARTICLE TRAIL FACTORY — richer trails for projectiles
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Weapon-specific enhanced trail particle config.
 * Returns a config object that can be applied to the existing trail ParticleSystem.
 */
export function getEnhancedTrailConfig(weaponId) {
  switch (weaponId) {
    case 'fireball':
      return {
        emitRate: 55,
        minLifeTime: 0.2, maxLifeTime: 0.6,
        minSize: 0.15, maxSize: 0.55,
        color1: new Color4(1.0, 0.6, 0.0, 1.0),
        color2: new Color4(1.0, 0.2, 0.0, 0.8),
        colorDead: new Color4(0.3, 0.05, 0.0, 0.0),
        gravity: new Vector3(0, 2, 0), // embers rise
        blendMode: ParticleSystem.BLENDMODE_ADD,
        sizeGradients: [[0, 0.5, 0.6], [0.5, 0.35, 0.4], [1.0, 0.0, 0.05]],
      };
    case 'ice_lance':
      return {
        emitRate: 40,
        minLifeTime: 0.15, maxLifeTime: 0.45,
        minSize: 0.08, maxSize: 0.3,
        color1: new Color4(0.6, 0.9, 1.0, 0.9),
        color2: new Color4(0.3, 0.65, 0.9, 0.7),
        colorDead: new Color4(0.8, 0.95, 1.0, 0.0),
        gravity: new Vector3(0, -1, 0), // frost drifts down
        blendMode: ParticleSystem.BLENDMODE_ADD,
        sizeGradients: [[0, 0.3, 0.35], [0.6, 0.2, 0.25], [1.0, 0.0, 0.0]],
      };
    case 'toxic_spread':
      return {
        emitRate: 35,
        minLifeTime: 0.3, maxLifeTime: 0.8,
        minSize: 0.12, maxSize: 0.45,
        color1: new Color4(0.2, 0.8, 0.1, 0.8),
        color2: new Color4(0.05, 0.5, 0.0, 0.6),
        colorDead: new Color4(0.0, 0.2, 0.0, 0.0),
        gravity: new Vector3(0, 0.5, 0),
        blendMode: ParticleSystem.BLENDMODE_STANDARD,
        sizeGradients: [[0, 0.25, 0.3], [0.5, 0.4, 0.45], [1.0, 0.05, 0.1]],
      };
    case 'missile':
    case 'crimson_hydra':
      return {
        emitRate: 60,
        minLifeTime: 0.3, maxLifeTime: 0.7,
        minSize: 0.1, maxSize: 0.45,
        color1: new Color4(1.0, 0.5, 0.0, 0.9),
        color2: new Color4(0.6, 0.3, 0.0, 0.7),
        colorDead: new Color4(0.2, 0.1, 0.05, 0.0),
        gravity: new Vector3(0, 1.5, 0),
        blendMode: ParticleSystem.BLENDMODE_ADD,
        sizeGradients: [[0, 0.1, 0.15], [0.3, 0.35, 0.45], [1.0, 0.0, 0.0]],
      };
    case 'lightning_bolt':
      return {
        emitRate: 80,
        minLifeTime: 0.05, maxLifeTime: 0.2,
        minSize: 0.04, maxSize: 0.18,
        color1: new Color4(0.8, 0.85, 1.0, 1.0),
        color2: new Color4(0.5, 0.5, 1.0, 0.8),
        colorDead: new Color4(0.3, 0.3, 0.7, 0.0),
        gravity: new Vector3(0, 0, 0),
        blendMode: ParticleSystem.BLENDMODE_ADD,
        sizeGradients: [[0, 0.15, 0.18], [0.5, 0.06, 0.08], [1.0, 0.0, 0.0]],
      };
    case 'wind_slash':
      return {
        emitRate: 45,
        minLifeTime: 0.1, maxLifeTime: 0.35,
        minSize: 0.1, maxSize: 0.35,
        color1: new Color4(0.7, 1.0, 0.85, 0.7),
        color2: new Color4(0.4, 0.8, 0.6, 0.5),
        colorDead: new Color4(0.5, 0.7, 0.6, 0.0),
        gravity: new Vector3(0, 0.5, 0),
        blendMode: ParticleSystem.BLENDMODE_ADD,
        sizeGradients: [[0, 0.28, 0.35], [0.5, 0.12, 0.18], [1.0, 0.0, 0.0]],
      };
    case 'rock_barrage':
      return {
        emitRate: 20,
        minLifeTime: 0.3, maxLifeTime: 0.6,
        minSize: 0.08, maxSize: 0.25,
        color1: new Color4(0.45, 0.35, 0.25, 0.8),
        color2: new Color4(0.3, 0.22, 0.15, 0.6),
        colorDead: new Color4(0.2, 0.15, 0.1, 0.0),
        gravity: new Vector3(0, -6, 0),
        blendMode: ParticleSystem.BLENDMODE_STANDARD,
        sizeGradients: [[0, 0.1, 0.15], [0.5, 0.2, 0.25], [1.0, 0.0, 0.05]],
      };
    case 'glow_thrower':
      return {
        emitRate: 70,
        minLifeTime: 0.1, maxLifeTime: 0.32,
        minSize: 0.15, maxSize: 0.5,
        color1: new Color4(1.0, 0.45, 0.0, 1.0),
        color2: new Color4(1.0, 0.0, 0.5, 0.8),
        colorDead: new Color4(0.4, 0.0, 0.1, 0.0),
        gravity: new Vector3(0, 1, 0),
        blendMode: ParticleSystem.BLENDMODE_ADD,
        sizeGradients: [[0, 0.2, 0.3], [0.5, 0.5, 0.55], [1.0, 0.0, 0.0]],
      };
    default:
      return null; // use existing trail config
  }
}

/**
 * Apply enhanced trail config to an existing ParticleSystem.
 * @param {ParticleSystem} ps
 * @param {string} weaponId
 */
export function applyEnhancedTrail(ps, weaponId) {
  const config = getEnhancedTrailConfig(weaponId);
  if (!config || !ps) return;

  ps.emitRate = scaleTrail(config.emitRate);
  ps.minLifeTime = config.minLifeTime;
  ps.maxLifeTime = config.maxLifeTime;
  ps.minSize = config.minSize;
  ps.maxSize = config.maxSize;
  ps.color1 = config.color1;
  ps.color2 = config.color2;
  ps.colorDead = config.colorDead;
  ps.gravity = config.gravity;
  ps.blendMode = config.blendMode;

  // Apply size gradients if supported
  if (config.sizeGradients && ps.addSizeGradient) {
    try {
      for (const [pos, min, max] of config.sizeGradients) {
        ps.addSizeGradient(pos, min, max);
      }
    } catch (_) { /* gradient methods may not be available in all builds */ }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  SCREEN SHAKE ENHANCED — more dramatic with roll and frequency
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Enhanced camera shake with per-axis intensity and roll.
 * @param {Camera} camera
 * @param {Object} opts - { intensity, roll, durationMs, frequency }
 */
export function enhancedShake(camera, opts = {}) {
  if (!camera || !_scene) return;
  const intensity = opts.intensity ?? 0.3;
  const rollAmount = opts.roll ?? 0.01;
  const duration = opts.durationMs ?? 300;
  const frequency = opts.frequency ?? 40; // Hz

  const origTarget = camera.target?.clone();
  let elapsed = 0;

  const obs = _scene.onBeforeRenderObservable.add(() => {
    elapsed += _scene.getEngine().getDeltaTime();
    const t = Math.min(1, elapsed / duration);
    const decay = 1 - t * t; // quadratic decay
    const phase = elapsed * frequency * 0.001 * Math.PI * 2;

    if (camera.target) {
      const offsetX = Math.sin(phase) * intensity * decay;
      const offsetY = Math.cos(phase * 1.3) * intensity * 0.6 * decay;
      camera.target = origTarget.add(new Vector3(offsetX, offsetY, 0));
    }

    if (t >= 1) {
      if (origTarget && camera.target) camera.target = origTarget;
      _scene.onBeforeRenderObservable.remove(obs);
      const idx = _observers.indexOf(obs);
      if (idx >= 0) _observers.splice(idx, 1);
    }
  });
  _observers.push(obs);
}

// ═══════════════════════════════════════════════════════════════════════════
//  PER-WEAPON IMPACT ENHANCEMENT DISPATCH
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Call after the base emitWeaponImpactVFX to add AAA polish:
 *  - Bloom pulse
 *  - Chromatic aberration
 *  - Impact decal
 *  - Enhanced camera shake
 *
 * @param {Vector3} position
 * @param {string} subType
 * @param {number} damage
 * @param {Camera} camera
 * @param {boolean} isLocalPlayer - true if the local player is the one hit
 */
export function enhanceWeaponImpact(position, subType, damage, camera, isLocalPlayer = false) {
  if (!_scene) return;

  // Bloom spike proportional to damage
  const dmgNorm = Math.min(1, (damage || 20) / 60);
  pulseBloom(0.3 + dmgNorm * 0.5, 350 + dmgNorm * 250);

  // Chromatic aberration if player is hit
  if (isLocalPlayer) {
    pulseChromatic(0.3 + dmgNorm * 0.4, 250);
  }

  // Impact decal on ground
  stampImpactDecal(position, subType);

  // Enhanced shake for heavy weapons
  const heavyWeapons = new Set(['super_nova', 'gravity_well', 'tornado', 'missile', 'crimson_hydra', 'rock_barrage', 'lightning_bolt']);
  if (heavyWeapons.has(subType) && camera) {
    enhancedShake(camera, {
      intensity: 0.15 + dmgNorm * 0.35,
      durationMs: 200 + dmgNorm * 300,
      frequency: 30 + dmgNorm * 20,
    });
  }
}

// Decal tick requires a Ray import — lazy loaded
let BABYLON_RAY = null;
async function _ensureRay() {
  if (BABYLON_RAY) return BABYLON_RAY;
  try {
    const rayModule = await import('@babylonjs/core/Culling/ray');
    BABYLON_RAY = rayModule.Ray;
  } catch (_) {}
  return BABYLON_RAY;
}
// Eagerly try to load
_ensureRay();

// ═══════════════════════════════════════════════════════════════════════════
//  CLUSTERED LIGHTING — high-count impact lights without per-frag cost
// ═══════════════════════════════════════════════════════════════════════════

let _ClusteredLightContainer = null;

async function _loadClusteredLighting() {
  if (_ClusteredLightContainer !== null) return _ClusteredLightContainer;
  try {
    const mod = await import('@babylonjs/core/Lights/Clustered/clusteredLightContainer');
    _ClusteredLightContainer = mod.ClusteredLightContainer || null;
  } catch (_) {
    _ClusteredLightContainer = false; // not available in this build
  }
  return _ClusteredLightContainer;
}

function _setupClusteredLighting(scene) {
  if (!clusteredLightsEnabled()) return;
  _loadClusteredLighting().then(CLC => {
    if (!CLC || CLC === false || _clusteredContainer) return;
    try {
      _clusteredContainer = new CLC('weaponCluster', [], scene);
      console.log(`[weapon-fx] Clustered lighting enabled (max ${maxClusteredLights()})`);
    } catch (e) {
      console.warn('[weapon-fx] Clustered lighting unavailable:', e.message);
      _clusteredContainer = null;
    }
  });
}

let _clusteredLightCount = 0;

/**
 * Register a light with the clustered container (if available).
 * Returns true if added, false if clustered lighting is not active or at capacity.
 */
export function addClusteredLight(light) {
  if (!_clusteredContainer || !light) return false;
  if (_clusteredLightCount >= maxClusteredLights()) return false;
  try {
    _clusteredContainer.addLight(light);
    _clusteredLightCount++;
    return true;
  } catch (_) { return false; }
}

/**
 * Remove a light from the clustered container.
 */
export function removeClusteredLight(light) {
  if (!_clusteredContainer || !light) return;
  try {
    _clusteredContainer.removeLight(light);
    _clusteredLightCount = Math.max(0, _clusteredLightCount - 1);
  } catch (_) {}
}

/** Get the clustered light container instance (may be null). */
export function getClusteredContainer() { return _clusteredContainer; }

// ═══════════════════════════════════════════════════════════════════════════
//  GPU PARTICLE FACTORY — auto-fallback to CPU if unsupported
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if GPU particles are supported on the current device.
 * Lazily detected on first call.
 */
export function isGPUParticleSupported() {
  if (_gpuParticleSupported !== null) return _gpuParticleSupported;
  try {
    _gpuParticleSupported = GPUParticleSystem.IsSupported;
  } catch (_) {
    _gpuParticleSupported = false;
  }
  return _gpuParticleSupported;
}

/**
 * Create a particle system — GPU if supported and tier allows, else CPU.
 * Applies tier-appropriate capacity scaling automatically.
 *
 * @param {string} name - system name
 * @param {number} capacity - desired capacity (will be scaled by tier)
 * @param {Scene} scene - Babylon scene
 * @param {Object} [opts] - optional overrides
 * @param {boolean} [opts.forceGPU] - force GPU even if tier says CPU
 * @param {boolean} [opts.forceCPU] - force CPU regardless of tier
 * @param {number} [opts.randomTextureSize] - GPU random texture size
 * @returns {{ ps: ParticleSystem|GPUParticleSystem, isGPU: boolean }}
 */
export function createAdaptiveParticleSystem(name, capacity, scene, opts = {}) {
  const budgetedCapacity = Math.max(8, Math.round(capacity * runtimeFXBudget()));
  const useGPU = !opts.forceCPU
    && (opts.forceGPU || (gpuParticlesEnabled() && isGPUParticleSupported()));

  if (useGPU) {
    const scaledCap = scaleGPUParticles(budgetedCapacity);
    const ps = new GPUParticleSystem(name, {
      capacity: scaledCap,
      randomTextureSize: opts.randomTextureSize || 4096,
    }, scene);
    return { ps, isGPU: true };
  }

  // CPU fallback with reduced capacity
  const scaledCap = scaleParticles(Math.min(budgetedCapacity, 2000));
  const ps = new ParticleSystem(name, scaledCap, scene);
  return { ps, isGPU: false };
}

// ═══════════════════════════════════════════════════════════════════════════
//  HAVOK PHYSICS INITIALIZATION HELPER
// ═══════════════════════════════════════════════════════════════════════════

let _havokReady = null; // Promise<HavokPlugin | null>

/**
 * Initialize Havok physics for the scene.
 * Safe to call multiple times — only initializes once.
 * @param {Scene} scene
 * @returns {Promise<import('@babylonjs/core/Physics/v2/Plugins/havokPlugin').HavokPlugin | null>}
 */
export async function initHavokPhysics(scene) {
  if (_havokPlugin) return _havokPlugin;
  if (_havokReady) return _havokReady;

  _havokReady = (async () => {
    try {
      const [{ HavokPlugin }, HavokPhysics] = await Promise.all([
        import('@babylonjs/core/Physics/v2/Plugins/havokPlugin'),
        import('@babylonjs/havok').then(m => m.default || m),
      ]);
      const havokInstance = await HavokPhysics();
      _havokPlugin = new HavokPlugin(true, havokInstance);
      scene.enablePhysics(new Vector3(0, -9.81, 0), _havokPlugin);
      console.log('[weapon-fx] Havok physics initialized');
      return _havokPlugin;
    } catch (e) {
      console.warn('[weapon-fx] Havok physics unavailable:', e.message);
      _havokPlugin = null;
      return null;
    }
  })();

  return _havokReady;
}

/** Get the Havok plugin instance (null if not initialized). */
export function getHavokPlugin() { return _havokPlugin; }
