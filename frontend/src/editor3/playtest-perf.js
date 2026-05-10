/**
 * playtest-perf.js — Quality budget + adaptive monitor for the
 * editor3 simulate (playtest) runtime.
 *
 * Goal: hit ≥30 FPS on Chromebooks / older iPads while still letting
 * desktop GPUs render the full-fidelity scene a user designed.
 *
 * Design constraints:
 *   - Zero dependencies beyond what `play-main.js` already imports.
 *   - One source of truth for *every* frame-cost knob:
 *       pixel ratio, shadow map, fog distance, instancing thresholds,
 *       collider chunk size, max segment shadow casters, post-fx flags.
 *   - Honour the lobby-wide `gloPerformanceMode` (auto | ultra_low) so
 *     "Ultra-Low" propagates from the index.html device settings into
 *     the playtest scene without any extra UI plumbing.
 *   - Adaptive: if measured FPS drops below the floor for ~1.5 s the
 *     budget steps DOWN one tier (HIGH→MEDIUM→LOW→ULTRA). It never
 *     auto-upgrades during a session — once you've paid the cost of a
 *     tier change, we keep the new ceiling stable to avoid oscillation.
 *
 * Tiers map roughly to:
 *   - ULTRA: Chromebook, low-end Android, weak iPad. ~20 px/m at 720p.
 *   - LOW:   midrange mobile, integrated GPU laptops.
 *   - MED:   modern integrated / midrange dGPU.
 *   - HIGH:  desktop / current-gen iPad / M-series Mac / RTX laptop.
 */

const TIER = Object.freeze({ ULTRA: 0, LOW: 1, MED: 2, HIGH: 3 });
const TIER_NAMES = ['ULTRA', 'LOW', 'MED', 'HIGH'];

const PERFORMANCE_MODE_STORAGE_KEY = 'gloPerformanceMode';

function readForcedMode() {
  try {
    return (
      (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(PERFORMANCE_MODE_STORAGE_KEY))
      || (typeof localStorage !== 'undefined' && localStorage.getItem(PERFORMANCE_MODE_STORAGE_KEY))
      || ''
    );
  } catch (_) { return ''; }
}

function urlOverrideTier() {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = (params.get('perfTier') || '').toLowerCase();
    if (raw === 'ultra') return TIER.ULTRA;
    if (raw === 'low') return TIER.LOW;
    if (raw === 'med' || raw === 'medium') return TIER.MED;
    if (raw === 'high') return TIER.HIGH;
  } catch (_) {}
  return null;
}

function detectAutoTier() {
  const ua = (navigator.userAgent || '').toLowerCase();
  const cores = navigator.hardwareConcurrency || 2;
  const memory = navigator.deviceMemory || 2; // GB, Chrome only
  const isMobile = /android|iphone|ipad|ipod|cros|chromeos/i.test(ua);
  const isChromebook = /cros|chromeos/i.test(ua);
  const lowRes = (window.screen?.width || 0) * (window.screen?.height || 0) < 1280 * 720;
  // Probe the WebGL renderer for high-confidence GPU class.
  let gpuStr = '';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) gpuStr = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '');
    }
  } catch (_) {}
  const gpuLow = /mali|adreno [34]|powervr|swiftshader|intel hd|intel uhd [56]|apple gpu/i.test(gpuStr);
  const gpuHigh = /rtx|radeon pro|geforce gtx 1[06-9]|geforce (gtx|rtx) [234]\d|arc a[57]|apple m[1-9]/i.test(gpuStr);
  let score = 0;
  if (cores >= 8) score += 2; else if (cores >= 4) score += 1;
  if (memory >= 8) score += 2; else if (memory >= 4) score += 1;
  if (gpuHigh) score += 3;
  if (gpuLow) score -= 2;
  if (isMobile) score -= 1;
  if (isChromebook) score -= 2;
  if (lowRes) score -= 1;
  if (score >= 5) return TIER.HIGH;
  if (score >= 2) return TIER.MED;
  if (score >= 0) return TIER.LOW;
  return TIER.ULTRA;
}

function tierFromMode(mode) {
  if (mode === 'ultra_low') return TIER.ULTRA;
  return null;
}

function budgetFor(tier) {
  switch (tier) {
    case TIER.ULTRA: return {
      tier, name: 'ULTRA',
      maxPixelRatio: 0.7,                // sub-native — 720p chromebook → ~500p
      shadowsEnabled: false,
      shadowMapSize: 0,
      maxShadowSegments: 0,
      ambientIntensity: 0.85,
      hemiIntensity: 0.55,
      fogNearTiles: 6,
      fogFarTiles: 22,
      fogColor: 0x0a0d12,
      decorInstancing: true,
      decorInstanceMin: 1,               // batch even single instances (uniform path)
      decorMaxColliders: 256,
      decorColliderChunkUnits: 24000,    // ~24 m chunks merged into one body
      maxLights: 1,
      physicsSubsteps: 1,
      physicsSolverIterations: 6,
      adaptiveFloorFps: 26,
      adaptiveSampleMs: 1500,
    };
    case TIER.LOW: return {
      tier, name: 'LOW',
      maxPixelRatio: 1.0,
      shadowsEnabled: false,
      shadowMapSize: 0,
      maxShadowSegments: 0,
      ambientIntensity: 0.65,
      hemiIntensity: 0.5,
      fogNearTiles: 10,
      fogFarTiles: 32,
      fogColor: 0x0a0d12,
      decorInstancing: true,
      decorInstanceMin: 1,
      decorMaxColliders: 512,
      decorColliderChunkUnits: 18000,
      maxLights: 1,
      physicsSubsteps: 2,
      physicsSolverIterations: 8,
      adaptiveFloorFps: 28,
      adaptiveSampleMs: 1500,
    };
    case TIER.MED: return {
      tier, name: 'MED',
      maxPixelRatio: 1.25,
      shadowsEnabled: true,
      shadowMapSize: 1024,
      maxShadowSegments: 24,
      ambientIntensity: 0.55,
      hemiIntensity: 0.4,
      fogNearTiles: 14,
      fogFarTiles: 42,
      fogColor: 0x0a0d12,
      decorInstancing: true,
      decorInstanceMin: 2,
      decorMaxColliders: 1024,
      decorColliderChunkUnits: 14000,
      maxLights: 2,
      physicsSubsteps: 2,
      physicsSolverIterations: 10,
      adaptiveFloorFps: 30,
      adaptiveSampleMs: 1500,
    };
    case TIER.HIGH:
    default: return {
      tier: TIER.HIGH, name: 'HIGH',
      maxPixelRatio: 1.5,
      shadowsEnabled: true,
      shadowMapSize: 2048,
      maxShadowSegments: 64,
      ambientIntensity: 0.5,
      hemiIntensity: 0.4,
      fogNearTiles: 18,
      fogFarTiles: 56,
      fogColor: 0x0a0d12,
      decorInstancing: true,
      decorInstanceMin: 3,
      decorMaxColliders: 2048,
      decorColliderChunkUnits: 12000,
      maxLights: 3,
      physicsSubsteps: 3,
      physicsSolverIterations: 12,
      adaptiveFloorFps: 32,
      adaptiveSampleMs: 1500,
    };
  }
}

/** Resolve the runtime budget once at scene boot. */
export function resolvePlaytestBudget() {
  const forced = urlOverrideTier();
  if (forced != null) return budgetFor(forced);
  const modeForced = tierFromMode(readForcedMode());
  if (modeForced != null) return budgetFor(modeForced);
  return budgetFor(detectAutoTier());
}

/** Adaptive monitor: every sample window, if FPS < floor, downgrade. */
export function createAdaptiveMonitor(initialBudget, onChange) {
  let current = initialBudget;
  let frames = 0;
  let acc = 0;
  let lastSampleAt = (typeof performance !== 'undefined' ? performance.now() : 0);
  let downgradeStreak = 0;
  return {
    get budget() { return current; },
    /** Call once per frame with the latest dt in seconds. */
    sample(dt) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      frames += 1;
      acc += dt;
      const now = (typeof performance !== 'undefined' ? performance.now() : 0);
      if (now - lastSampleAt < current.adaptiveSampleMs) return;
      const fps = frames / acc;
      frames = 0; acc = 0; lastSampleAt = now;
      if (fps < current.adaptiveFloorFps && current.tier > TIER.ULTRA) {
        downgradeStreak += 1;
        if (downgradeStreak >= 1) {
          const next = budgetFor(current.tier - 1);
          // Preserve the (possibly stricter) floor so adaptive doesn't
          // immediately re-trigger because the new tier set a higher one.
          next.adaptiveFloorFps = Math.min(next.adaptiveFloorFps, current.adaptiveFloorFps);
          current = next;
          downgradeStreak = 0;
          try { onChange?.(current, fps); } catch (_) {}
        }
      } else {
        downgradeStreak = 0;
      }
    },
  };
}

export const PLAYTEST_TIER = TIER;
export const PLAYTEST_TIER_NAMES = TIER_NAMES;
