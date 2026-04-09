/**
 * perf-tier.js — Adaptive performance tier detection & quality scaling.
 *
 * Detects device capability at startup and provides multipliers for:
 *   - Particle counts / emit rates
 *   - Post-processing (bloom kernel, glow, grain, vignette)
 *   - Mesh complexity (tessellation, subdivision counts)
 *   - Dynamic lights (max concurrent impact lights)
 *   - Pool sizes (projectiles, trails)
 *   - Observer budgets
 *
 * Also provides an adaptive FPS monitor that downgrades quality
 * in real-time if the frame rate drops below a threshold.
 *
 * Tiers:  LOW (Chromebooks, tablets)  |  MEDIUM  |  HIGH (desktop GPU)
 */

// ─── Tier Enum ──────────────────────────────────────────────────────────
export const TIER = Object.freeze({ LOW: 0, MEDIUM: 1, HIGH: 2 });

// ─── Current state ──────────────────────────────────────────────────────
let _tier = TIER.HIGH;
let _particleMul = 1.0;     // multiplier for emit rates and burst counts
let _meshDetailMul = 1.0;   // multiplier for tessellation/subdivision
let _postFX = true;          // bloom/grain/vignette enabled
let _glowEnabled = true;     // GlowLayer enabled
let _maxLights = 6;          // max concurrent per-impact PointLights
let _poolScale = 1.0;        // scale for projectile/trail pool sizes
let _bloomKernel = 48;
let _glowKernel = 32;
let _glowFixedSize = 512;
let _glowSamples = 4;
let _decalsEnabled = true;
let _maxDecals = 24;
let _grainEnabled = true;
let _vignetteEnabled = true;
let _trailMul = 1.0;         // enhanced trail rate multiplier
let _gpuParticlesEnabled = false; // GPU particle systems (WebGL2 transform feedback)
let _gpuParticleCap = 0;     // total GPU particle capacity across all systems
let _maxPhysicsBodies = 0;   // max concurrent Havok rigid bodies
let _clusteredLights = false; // ClusteredLightContainer enabled
let _maxClusteredLights = 0; // max lights in cluster
let _motionBlur = false;     // motion blur post-process
let _ssrEnabled = false;     // screen-space reflections
let _maxProjectiles = 24;    // hard cap on simultaneous projectiles
let _runtimeFxBudget = 1.0;  // live load-based multiplier for effects
let _runtimePostFXBudget = 1.0; // live load-based multiplier for post-processing
let _runtimePressure = 0;    // 0..1 combined scene pressure

// ─── Adaptive FPS state ─────────────────────────────────────────────────
let _engine = null;
let _fpsSamples = [];
const FPS_SAMPLE_WINDOW = 60; // frames to average
let _adaptiveActive = false;
let _adaptiveObs = null;
let _downgradeCount = 0;
let _upgradeCount = 0;
let _peakTier = TIER.HIGH; // remember initial tier for upgrade ceiling

// ═════════════════════════════════════════════════════════════════════════
//  DETECTION — call once at startup, before any VFX init
// ═════════════════════════════════════════════════════════════════════════

/**
 * Detect the performance tier of the current device.
 * Call once before scene setup.
 * @param {Engine} [engine] - optional Babylon Engine for GL introspection
 */
export function detectPerformanceTier(engine) {
  _engine = engine || null;

  const cores = navigator.hardwareConcurrency || 2;
  const memory = navigator.deviceMemory || 2;       // GB (Chrome only)
  const ua = navigator.userAgent || '';

  // Mobile / low-power heuristics
  const isMobile = /Android|iPhone|iPad|iPod|CrOS|ChromeOS/i.test(ua);
  const isTablet = /iPad|Tablet|SM-T|MediaPad/i.test(ua) || (isMobile && Math.min(screen.width, screen.height) > 600);
  const isChromebook = /CrOS/i.test(ua);
  const isLowResolution = screen.width * screen.height < 1280 * 720;

  // WebGL renderer string (when available)
  let gpuTier = 'unknown';
  if (engine) {
    try {
      const gl = engine._gl || engine._webGLContext;
      if (gl) {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        if (dbg) {
          gpuTier = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || 'unknown';
        }
      }
    } catch (_) {}
  }

  const gpuLow = /Mali|Adreno [34]|PowerVR|Intel HD|Intel UHD [56]|Intel Iris|Apple GPU|SwiftShader/i.test(gpuTier);
  const gpuHigh = /RTX|RX [567]|Radeon Pro|GeForce GTX 1[06-9]|GeForce GTX 20|GeForce GTX 30|GeForce GTX 40|Arc A[57]/i.test(gpuTier);

  // Scoring
  let score = 0;
  if (cores >= 8) score += 2;
  else if (cores >= 4) score += 1;
  if (memory >= 8) score += 2;
  else if (memory >= 4) score += 1;
  if (gpuHigh) score += 3;
  if (gpuLow) score -= 2;
  if (isMobile) score -= 1;
  if (isTablet) score -= 1;
  if (isChromebook) score -= 2;
  if (isLowResolution) score -= 1;

  if (score >= 4) _tier = TIER.HIGH;
  else if (score >= 1) _tier = TIER.MEDIUM;
  else _tier = TIER.LOW;

  _applyTier(_tier);

  console.log(
    `[perf-tier] Detected tier: ${['LOW','MEDIUM','HIGH'][_tier]}`,
    `(cores=${cores}, mem=${memory}GB, gpu="${gpuTier.slice(0,40)}", mobile=${isMobile}, score=${score})`
  );

  return _tier;
}

/**
 * Force a specific tier (for debug/testing).
 * @param {number} tier - TIER.LOW, TIER.MEDIUM, or TIER.HIGH
 */
export function forcePerformanceTier(tier) {
  _tier = tier;
  _applyTier(tier);
  console.log(`[perf-tier] Forced tier: ${['LOW','MEDIUM','HIGH'][tier]}`);
}

function _applyTier(tier) {
  switch (tier) {
    case TIER.LOW:
      _particleMul = 0.35;
      _meshDetailMul = 0.5;
      _postFX = false;
      _glowEnabled = false;
      _maxLights = 2;
      _poolScale = 0.5;
      _bloomKernel = 16;
      _glowKernel = 16;
      _glowFixedSize = 256;
      _glowSamples = 1;
      _decalsEnabled = false;
      _maxDecals = 0;
      _grainEnabled = false;
      _vignetteEnabled = false;
      _trailMul = 0.4;
      _gpuParticlesEnabled = false;
      _gpuParticleCap = 0;
      _maxPhysicsBodies = 4;
      _clusteredLights = false;
      _maxClusteredLights = 0;
      _motionBlur = false;
      _ssrEnabled = false;
      _maxProjectiles = 12;
      break;
    case TIER.MEDIUM:
      _particleMul = 0.65;
      _meshDetailMul = 0.75;
      _postFX = true;
      _glowEnabled = true;
      _maxLights = 4;
      _poolScale = 0.75;
      _bloomKernel = 24;
      _glowKernel = 20;
      _glowFixedSize = 256;
      _glowSamples = 2;
      _decalsEnabled = true;
      _maxDecals = 12;
      _grainEnabled = false;
      _vignetteEnabled = true;
      _trailMul = 0.7;
      _gpuParticlesEnabled = true;
      _gpuParticleCap = 25000;
      _maxPhysicsBodies = 12;
      _clusteredLights = true;
      _maxClusteredLights = 16;
      _motionBlur = false;
      _ssrEnabled = false;
      _maxProjectiles = 20;
      break;
    case TIER.HIGH:
    default:
      _particleMul = 1.0;
      _meshDetailMul = 1.0;
      _postFX = true;
      _glowEnabled = true;
      _maxLights = 6;
      _poolScale = 1.0;
      _bloomKernel = 48;
      _glowKernel = 32;
      _glowFixedSize = 256;
      _glowSamples = 2;
      _decalsEnabled = true;
      _maxDecals = 24;
      _grainEnabled = true;
      _vignetteEnabled = true;
      _trailMul = 1.0;
      _gpuParticlesEnabled = true;
      _gpuParticleCap = 80000;
      _maxPhysicsBodies = 20;
      _clusteredLights = true;
      _maxClusteredLights = 64;
      _motionBlur = false;
      _ssrEnabled = false;
      _maxProjectiles = 32;
      break;
  }
}

// ═════════════════════════════════════════════════════════════════════════
//  ADAPTIVE FPS MONITOR — auto-downgrade if FPS consistently low
// ═════════════════════════════════════════════════════════════════════════

/**
 * Start adaptive FPS monitoring. Downgrades tier if avg FPS < threshold.
 * Call after engine.runRenderLoop.
 * @param {Engine} engine
 * @param {number} fpsFloor - minimum acceptable FPS (default 28)
 */
export function startAdaptiveMonitor(engine, fpsFloor = 28) {
  _engine = engine;
  _adaptiveActive = true;
  _fpsSamples = [];
  _downgradeCount = 0;
  _upgradeCount = 0;
  _peakTier = _tier; // remember starting tier as ceiling

  // Sample FPS every frame, check average periodically
  let checkCounter = 0;
  const CHECK_INTERVAL = 90; // check every 90 frames (~1.5s at 60fps)

  _adaptiveObs = () => {
    if (!_adaptiveActive) return;
    const fps = engine.getFps();
    _fpsSamples.push(fps);
    if (_fpsSamples.length > FPS_SAMPLE_WINDOW) _fpsSamples.shift();
    checkCounter++;

    if (checkCounter >= CHECK_INTERVAL && _fpsSamples.length >= FPS_SAMPLE_WINDOW) {
      checkCounter = 0;
      const avg = _fpsSamples.reduce((a, b) => a + b, 0) / _fpsSamples.length;
      if (avg < fpsFloor && _tier > TIER.LOW) {
        _downgradeCount++;
        _upgradeCount = 0;
        if (_downgradeCount >= 2) { // require 2 consecutive low readings
          const newTier = _tier - 1;
          console.warn(`[perf-tier] Adaptive downgrade: ${['LOW','MEDIUM','HIGH'][_tier]} → ${['LOW','MEDIUM','HIGH'][newTier]} (avg FPS: ${avg.toFixed(1)})`);
          _tier = newTier;
          _applyTier(newTier);
          _downgradeCount = 0;
          _fpsSamples = [];
        }
      } else if (avg > fpsFloor + 15 && _tier < _peakTier) {
        // Upgrade back if FPS is comfortably above threshold for sustained period
        _upgradeCount++;
        _downgradeCount = 0;
        if (_upgradeCount >= 6) { // require 6 consecutive good readings (~9s)
          const newTier = _tier + 1;
          console.log(`[perf-tier] Adaptive upgrade: ${['LOW','MEDIUM','HIGH'][_tier]} → ${['LOW','MEDIUM','HIGH'][newTier]} (avg FPS: ${avg.toFixed(1)})`);
          _tier = newTier;
          _applyTier(newTier);
          _upgradeCount = 0;
          _fpsSamples = [];
        }
      } else {
        _downgradeCount = 0;
      }
    }
  };

  engine.onEndFrameObservable.add(_adaptiveObs);
}

export function stopAdaptiveMonitor() {
  _adaptiveActive = false;
  if (_engine && _adaptiveObs) {
    _engine.onEndFrameObservable.removeCallback(_adaptiveObs);
  }
  _adaptiveObs = null;
}

export function updateRuntimePerformanceBudget(stats = {}) {
  const players = Math.max(1, Number(stats.players || 1));
  const particles = Math.max(0, Number(stats.particles || 0));
  const particleSystems = Math.max(0, Number(stats.particleSystems || 0));
  const drawCalls = Math.max(0, Number(stats.drawCalls || 0));
  const projectiles = Math.max(0, Number(stats.projectiles || 0));
  const fps = Math.max(1, Number(stats.fps || 60));

  const clamp01 = (n) => Math.max(0, Math.min(1, n));
  const playerPressure = clamp01((players - 2) / 6);
  const particlePressure = clamp01((particles - 800) / 1300);
  const systemPressure = clamp01((particleSystems - 42) / 52);
  const drawPressure = clamp01((drawCalls - 180) / 180);
  const projectilePressure = clamp01((projectiles - 12) / 20);
  const fpsPressure = clamp01((55 - fps) / 18);

  const pressure = clamp01(
    (playerPressure * 0.18)
    + (particlePressure * 0.18)
    + (systemPressure * 0.14)
    + (drawPressure * 0.14)
    + (projectilePressure * 0.08)
    + (fpsPressure * 0.28)
  );

  _runtimePressure = pressure;
  _runtimeFxBudget = Math.max(0.3, 1 - pressure * 0.72);
  _runtimePostFXBudget = Math.max(0.06, 1 - pressure * 1.02);

  return {
    pressure: _runtimePressure,
    fxBudget: _runtimeFxBudget,
    postFXBudget: _runtimePostFXBudget,
  };
}

// ═════════════════════════════════════════════════════════════════════════
//  PUBLIC GETTERS — read by all VFX / rendering systems
// ═════════════════════════════════════════════════════════════════════════

export function getTier()          { return _tier; }
export function particleMul()      { return _particleMul; }
export function meshDetailMul()    { return _meshDetailMul; }
export function isPostFXEnabled()  { return _postFX; }
export function isGlowEnabled()    { return _glowEnabled; }
export function maxImpactLights()  { return _maxLights; }
export function poolScale()        { return _poolScale; }
export function bloomKernel()      { return _bloomKernel; }
export function glowKernelSize()   { return _glowKernel; }
export function glowFixedSize()    { return _glowFixedSize; }
export function glowSamples()      { return _glowSamples; }
export function decalsEnabled()    { return _decalsEnabled; }
export function maxDecals()        { return _maxDecals; }
export function isGrainEnabled()   { return _grainEnabled; }
export function isVignetteEnabled(){ return _vignetteEnabled; }
export function trailMul()         { return _trailMul; }
export function gpuParticlesEnabled() { return _gpuParticlesEnabled; }
export function gpuParticleCap()    { return _gpuParticleCap; }
export function maxPhysicsBodies()  { return _maxPhysicsBodies; }
export function clusteredLightsEnabled() { return _clusteredLights; }
export function maxClusteredLights(){ return _maxClusteredLights; }
export function motionBlurEnabled() { return _motionBlur; }
export function ssrEnabled()        { return _ssrEnabled; }
export function maxProjectiles()     { return _maxProjectiles; }
export function runtimeFXBudget()    { return _runtimeFxBudget; }
export function runtimePostFXBudget(){ return _runtimePostFXBudget; }
export function runtimePressure()    { return _runtimePressure; }

// ═════════════════════════════════════════════════════════════════════════
//  UTILITY — scale a value by the particle multiplier
// ═════════════════════════════════════════════════════════════════════════

/** Scale a particle count / emit rate by the current tier multiplier, returning at least 1. */
export function scaleParticles(n) { return Math.max(1, Math.round(n * _particleMul * _runtimeFxBudget)); }

/** Scale a manual emit burst count, returning at least 1. */
export function scaleBurst(n) { return Math.max(1, Math.round(n * _particleMul * _runtimeFxBudget)); }

/** Scale mesh tessellation / segments, minimum 6. */
export function scaleTess(n) { return Math.max(6, Math.round(n * _meshDetailMul)); }

/** Scale trail emit rate by trail multiplier. */
export function scaleTrail(n) { return Math.max(1, Math.round(n * _trailMul * _runtimeFxBudget)); }

/** Scale a GPU particle capacity, clamped to the tier's total GPU particle budget. */
export function scaleGPUParticles(n) {
  if (!_gpuParticlesEnabled) return 0;
  return Math.max(64, Math.min(Math.round(n * _particleMul * _runtimeFxBudget), _gpuParticleCap));
}
