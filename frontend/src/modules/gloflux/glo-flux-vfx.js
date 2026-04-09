/**
 * glo-flux-vfx.js — Layered VFX system for gloFLUX mode.
 *
 * Handles per-power-up particle effects, synergy visuals,
 * post-process hallucination / EMP / gravity-flip,
 * mutation glow overlays, Apocalypse Burst explosions,
 * and global VFX cap for performance.
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { FAMILY, FAMILY_META } from './glo-flux-powers.js';
import { SURGE_TIER } from './glo-flux-surge.js';
import { MUTATION_TIER } from './glo-flux-mutations.js';

// ── Config ──────────────────────────────────────────────────────────────────

const MAX_ACTIVE_SYSTEMS = 12;          // global cap on particle systems
const LOD_DISTANCE_SQ = 900;            // 30 units squared
const PARTICLE_BUDGET = 2000;           // max concurrent particles
const POST_PROCESS_DURATION = 3000;     // ms for screen effects

// ── VFX Registry ────────────────────────────────────────────────────────────

/**
 * Per-power VFX descriptors (used to instantiate particle systems).
 * These are specifications, not live instances.
 */
const POWER_VFX = {
  echo_phantom: {
    type: 'trail',
    color1: [0.4, 0.8, 1.0, 0.7],
    color2: [0.2, 0.5, 0.8, 0.0],
    rate: 30,
    lifetime: 0.8,
    size: [0.2, 0.6],
    emitBox: [0.3, 0.1, 0.5],
  },
  quantum_duplicate: {
    type: 'burst',
    color1: [0.6, 0.9, 1.0, 0.9],
    color2: [0.3, 0.6, 0.9, 0.0],
    rate: 50,
    lifetime: 0.5,
    size: [0.15, 0.4],
    emitBox: [0.5, 0.5, 0.5],
  },
  neural_hijack: {
    type: 'beam',
    color1: [1.0, 0.2, 0.8, 0.9],
    color2: [0.5, 0.1, 0.4, 0.0],
    rate: 15,
    lifetime: 1.2,
    size: [0.05, 0.1],
    emitBox: [0.1, 0.1, 2.0],
  },
  symbiote_swarm: {
    type: 'swarm',
    color1: [0.3, 1.0, 0.5, 0.8],
    color2: [0.1, 0.6, 0.2, 0.0],
    rate: 60,
    lifetime: 1.0,
    size: [0.08, 0.2],
    emitBox: [1.0, 0.5, 1.0],
  },
  pirateleportation: {
    type: 'vortex',
    color1: [0.8, 0.2, 1.0, 0.8],
    color2: [0.4, 0.0, 0.6, 0.0],
    rate: 40,
    lifetime: 1.5,
    size: [0.1, 0.5],
    emitBox: [1.5, 1.5, 1.5],
  },
  dimensional_rift: {
    type: 'rift',
    color1: [0.1, 0.0, 0.2, 1.0],
    color2: [0.5, 0.0, 1.0, 0.0],
    rate: 30,
    lifetime: 2.0,
    size: [0.3, 1.0],
    emitBox: [2.0, 3.0, 0.1],
  },
  entropy_cascade: {
    type: 'cascade',
    color1: [1.0, 0.5, 0.0, 0.9],
    color2: [0.8, 0.2, 0.0, 0.0],
    rate: 45,
    lifetime: 0.6,
    size: [0.1, 0.3],
    emitBox: [0.8, 0.3, 0.8],
  },
  weather_dominion: {
    type: 'weather',
    color1: [0.7, 0.7, 0.9, 0.5],
    color2: [0.3, 0.3, 0.5, 0.0],
    rate: 80,
    lifetime: 2.5,
    size: [0.02, 0.08],
    emitBox: [10, 8, 10],
  },
  phase_shift: {
    type: 'shimmer',
    color1: [0.2, 1.0, 0.6, 0.6],
    color2: [0.1, 0.5, 0.3, 0.0],
    rate: 20,
    lifetime: 0.4,
    size: [0.3, 0.8],
    emitBox: [0.5, 0.5, 0.5],
  },
  bio_regen_cocoon: {
    type: 'cocoon',
    color1: [0.3, 0.9, 0.2, 0.8],
    color2: [0.1, 0.5, 0.1, 0.0],
    rate: 35,
    lifetime: 1.5,
    size: [0.1, 0.4],
    emitBox: [0.8, 1.0, 0.8],
  },
  fractal_duplication: {
    type: 'fractal',
    color1: [0.1, 0.8, 0.8, 0.7],
    color2: [0.0, 0.4, 0.4, 0.0],
    rate: 25,
    lifetime: 1.0,
    size: [0.2, 0.5],
    emitBox: [0.6, 0.6, 0.6],
  },
  symbiotic_overgrowth: {
    type: 'growth',
    color1: [0.4, 0.9, 0.1, 0.9],
    color2: [0.2, 0.5, 0.0, 0.0],
    rate: 50,
    lifetime: 2.0,
    size: [0.05, 0.15],
    emitBox: [1.2, 0.8, 1.2],
  },
  paradox_loop: {
    type: 'loop',
    color1: [0.0, 1.0, 0.5, 0.8],
    color2: [0.0, 0.6, 0.3, 0.0],
    rate: 20,
    lifetime: 3.0,
    size: [0.1, 0.2],
    emitBox: [0.4, 0.4, 0.4],
  },
  psyche_fracture: {
    type: 'fracture',
    color1: [1.0, 0.0, 0.5, 0.9],
    color2: [0.6, 0.0, 0.3, 0.0],
    rate: 40,
    lifetime: 0.7,
    size: [0.15, 0.5],
    emitBox: [0.6, 0.6, 0.6],
  },
  chronal_echo: {
    type: 'echo',
    color1: [0.8, 0.8, 1.0, 0.6],
    color2: [0.4, 0.4, 0.6, 0.0],
    rate: 15,
    lifetime: 2.0,
    size: [0.5, 1.0],
    emitBox: [0.3, 0.3, 0.3],
  },
  mutation_surge: {
    type: 'surge',
    color1: [1.0, 0.8, 0.0, 1.0],
    color2: [0.8, 0.4, 0.0, 0.0],
    rate: 60,
    lifetime: 0.5,
    size: [0.1, 0.4],
    emitBox: [0.5, 0.5, 0.5],
  },
  rogue_ai_companion: {
    type: 'orbit',
    color1: [0.0, 0.8, 1.0, 0.8],
    color2: [0.0, 0.4, 0.6, 0.0],
    rate: 20,
    lifetime: 1.5,
    size: [0.1, 0.3],
    emitBox: [1.0, 0.5, 1.0],
  },
  rhythm_pulse: {
    type: 'pulse',
    color1: [1.0, 0.5, 1.0, 0.7],
    color2: [0.6, 0.2, 0.6, 0.0],
    rate: 30,
    lifetime: 0.3,
    size: [0.5, 1.5],
    emitBox: [0.2, 0.2, 0.2],
  },
  karmic_reversal: {
    type: 'karma',
    color1: [1.0, 1.0, 0.0, 0.9],
    color2: [0.6, 0.6, 0.0, 0.0],
    rate: 25,
    lifetime: 1.0,
    size: [0.2, 0.6],
    emitBox: [0.4, 0.4, 0.4],
  },
  ecosystem_hack: {
    type: 'hack',
    color1: [0.0, 1.0, 0.0, 0.8],
    color2: [0.0, 0.5, 0.0, 0.0],
    rate: 35,
    lifetime: 1.2,
    size: [0.1, 0.3],
    emitBox: [2.0, 1.0, 2.0],
  },
};

// ── Synergy VFX ─────────────────────────────────────────────────────────────

const SYNERGY_VFX = {
  horde_split:          { screenEffect: null, auraColor: [0.4, 0.8, 1.0], auraIntensity: 1.5 },
  void_portal:          { screenEffect: 'gravity_flip', auraColor: [0.6, 0.0, 1.0], auraIntensity: 1.8 },
  fractal_cocoon:       { screenEffect: null, auraColor: [0.2, 1.0, 0.4], auraIntensity: 1.3 },
  echo_hallucination:   { screenEffect: 'hallucination', auraColor: [1.0, 0.3, 0.8], auraIntensity: 2.0 },
  phantom_entropy:      { screenEffect: 'emp_static', auraColor: [0.8, 0.4, 1.0], auraIntensity: 2.5 },
  bio_psyche_bloom:     { screenEffect: 'hallucination', auraColor: [0.5, 1.0, 0.8], auraIntensity: 3.0 },
  apocalypse_precursor: { screenEffect: 'apocalypse_warning', auraColor: [1.0, 0.8, 0.0], auraIntensity: 5.0 },
};

// ── VFX Manager State ───────────────────────────────────────────────────────

/**
 * Create a VFX manager state.
 * @returns {object}
 */
export function createVFXState() {
  return {
    activeSystems: [],          // [{id, powerId, startTime}]
    postProcessQueue: [],       // [{effect, startTime, duration}]
    totalParticles: 0,
    disposed: false,
  };
}

// ── Power-Up VFX ────────────────────────────────────────────────────────────

/**
 * Get the VFX descriptor for a power-up.
 * @param {string} powerId
 * @returns {object|null}
 */
export function getPowerVFX(powerId) {
  return POWER_VFX[powerId] || null;
}

/**
 * Register a new particle system for an active power-up.
 * Respects global cap + particle budget.
 *
 * @param {object} vfxState - VFX manager state
 * @param {string} powerId
 * @param {number} now
 * @returns {{ descriptor: object|null, allowed: boolean }}
 */
export function requestPowerVFX(vfxState, powerId, now) {
  if (vfxState.activeSystems.length >= MAX_ACTIVE_SYSTEMS) {
    return { descriptor: null, allowed: false };
  }
  const desc = POWER_VFX[powerId];
  if (!desc) return { descriptor: null, allowed: false };
  if (vfxState.totalParticles + desc.rate > PARTICLE_BUDGET) {
    return { descriptor: null, allowed: false };
  }

  const entry = { id: `vfx_${powerId}_${now}`, powerId, startTime: now };
  vfxState.activeSystems.push(entry);
  vfxState.totalParticles += desc.rate;

  return { descriptor: desc, allowed: true };
}

/**
 * Release a power VFX when the power expires.
 * @param {object} vfxState
 * @param {string} powerId
 */
export function releasePowerVFX(vfxState, powerId) {
  const idx = vfxState.activeSystems.findIndex(s => s.powerId === powerId);
  if (idx !== -1) {
    const desc = POWER_VFX[powerId];
    if (desc) vfxState.totalParticles = Math.max(0, vfxState.totalParticles - desc.rate);
    vfxState.activeSystems.splice(idx, 1);
  }
}

// ── Post-Process Effects ────────────────────────────────────────────────────

/**
 * Queue a screen-wide post-process effect.
 * @param {object} vfxState
 * @param {string} effect - 'hallucination'|'emp_static'|'gravity_flip'|'apocalypse_warning'
 * @param {number} now
 * @param {number} [duration]
 */
export function queuePostProcess(vfxState, effect, now, duration = POST_PROCESS_DURATION) {
  // Only one of each type at a time
  if (vfxState.postProcessQueue.some(p => p.effect === effect)) return;
  vfxState.postProcessQueue.push({ effect, startTime: now, duration });
}

/**
 * Tick post-process effects, removing expired ones.
 * @param {object} vfxState
 * @param {number} now
 * @returns {string[]} Currently active effects
 */
export function tickPostProcess(vfxState, now) {
  vfxState.postProcessQueue = vfxState.postProcessQueue.filter(
    p => (now - p.startTime) < p.duration
  );
  return vfxState.postProcessQueue.map(p => p.effect);
}

/**
 * Get post-process parameters for an effect type.
 * @param {string} effect
 * @param {number} progress - 0..1 through duration
 * @returns {object} Shader-ready parameters
 */
export function getPostProcessParams(effect, progress) {
  switch (effect) {
    case 'hallucination':
      return {
        chromatic: 0.02 * Math.sin(progress * Math.PI),
        waveAmplitude: 0.01 * (1 - progress),
        saturation: 1.5 - progress * 0.5,
        hueShift: Math.sin(progress * 6.28) * 0.15,
      };
    case 'emp_static':
      return {
        noiseIntensity: 0.3 * (1 - progress),
        scanlineFreq: 50 + progress * 100,
        glitchProb: 0.1 * (1 - progress),
        brightness: 1.0 + Math.random() * 0.3 * (1 - progress),
      };
    case 'gravity_flip':
      return {
        flipAmount: Math.sin(progress * Math.PI),
        distortion: 0.05 * (1 - progress),
        tint: [0.6, 0.0, 1.0, 0.2 * (1 - progress)],
      };
    case 'apocalypse_warning':
      return {
        pulseFreq: 4 + progress * 8,
        edgeGlow: 1.0 - progress * 0.5,
        screenShake: 0.03 * (1 - progress),
        vignetteIntensity: 0.5 + progress * 0.5,
        tint: [1.0, 0.5, 0.0, 0.3 * (1 - progress)],
      };
    default:
      return {};
  }
}

// ── Synergy VFX ─────────────────────────────────────────────────────────────

/**
 * Get synergy VFX data for rendering.
 * @param {string} synergyId
 * @returns {object|null}
 */
export function getSynergyVFX(synergyId) {
  return SYNERGY_VFX[synergyId] || null;
}

// ── Apocalypse Burst VFX ────────────────────────────────────────────────────

/**
 * Compute Apocalypse Burst visual parameters.
 * @param {number} progress - 0..1 through burst duration
 * @param {string} dominantFamily
 * @returns {object} Burst visual data
 */
export function getApocalypseBurstVFX(progress, dominantFamily) {
  const famColor = FAMILY_META[dominantFamily]?.color || [1, 1, 1];
  const shockwaveRadius = progress * 50;         // expands outward
  const intensity = Math.sin(progress * Math.PI); // peaks at 0.5

  return {
    shockwaveRadius,
    shockwaveWidth: 2 + progress * 3,
    color: famColor,
    intensity,
    screenFlash: progress < 0.1 ? 1.0 - progress * 10 : 0,
    cameraShake: 0.08 * intensity,
    particleBurst: progress < 0.3,
    particleCount: Math.floor(200 * intensity),
    lightIntensity: 3 * intensity,
  };
}

// ── Mutation Tier VFX ───────────────────────────────────────────────────────

/**
 * Get continuous VFX parameters based on mutation tier.
 * @param {number} tier
 * @param {string} family
 * @returns {object}
 */
export function getMutationTierVFX(tier, family) {
  if (tier === 0) return { trailRate: 0, glowRadius: 0, distortionStrength: 0 };

  const famColor = FAMILY_META[family]?.color || [0.5, 0.5, 0.5];
  const t = tier / MUTATION_TIER.APEX;

  return {
    trailRate: 5 + tier * 12,
    trailColor: [...famColor, 0.3 + t * 0.5],
    glowRadius: 0.5 + tier * 0.4,
    glowColor: famColor,
    distortionStrength: t * 0.02,
    pulseSpeed: 1.0 + tier * 0.5,
  };
}

// ── LOD ─────────────────────────────────────────────────────────────────────

/**
 * Compute LOD factor for a VFX system based on camera distance.
 * @param {number} distanceSq - Squared distance to camera
 * @returns {number} 0..1 scale factor for particle rate/size
 */
export function computeVFXLOD(distanceSq) {
  if (distanceSq < LOD_DISTANCE_SQ) return 1.0;
  return Math.max(0.1, LOD_DISTANCE_SQ / distanceSq);
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

/**
 * Dispose all VFX state. Call on mode exit.
 * @param {object} vfxState
 */
export function disposeVFX(vfxState) {
  vfxState.activeSystems.length = 0;
  vfxState.postProcessQueue.length = 0;
  vfxState.totalParticles = 0;
  vfxState.disposed = true;
}
