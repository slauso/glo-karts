/**
 * glo-flux-mutations.js — Kart mutation & evolution system for gloFLUX.
 *
 * Manages visual/physical transformation of karts as power-ups infect them:
 *   - Vertex deformation (VertexBuffer morph)
 *   - Emissive growth overlays
 *   - Particle trail evolution
 *   - Symbiote attachments
 *   - Mutation persistence across respawns
 *   - 6 mutation tiers (0=clean, 5=fully consumed)
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { FAMILY, FAMILY_META } from './glo-flux-powers.js';

// ── Mutation Tiers ──────────────────────────────────────────────────────────

export const MUTATION_TIER = Object.freeze({
  CLEAN:     0,  // No mutation
  INFECTED:  1,  // Subtle glow, minor vertex shift
  GROWING:   2,  // Visible growths, emissive patches
  CONSUMED:  3,  // Major deformation, particle trails
  EVOLVED:   4,  // Nearly unrecognizable, full VFX suite
  APEX:      5,  // Maximum mutation, living weapon
});

const TIER_LABELS = ['Clean', 'Infected', 'Growing', 'Consumed', 'Evolved', 'Apex'];
const TIER_DEFORM_STRENGTH = [0, 0.02, 0.06, 0.12, 0.2, 0.3];
const TIER_EMISSIVE_MULT = [0, 0.15, 0.35, 0.6, 0.85, 1.0];
const TIER_PARTICLE_RATE = [0, 5, 15, 30, 50, 80];

// ── Mutation State ──────────────────────────────────────────────────────────

/**
 * Create a mutation state for one kart.
 * @returns {object} Mutable mutation state
 */
export function createMutationState() {
  return {
    tier: MUTATION_TIER.CLEAN,
    dominantFamily: FAMILY.PHANTOM_HORDE,
    infectionCount: 0,
    deformSeed: Math.random() * 10000,
    originalPositions: null,     // Float32Array snapshot
    deformApplied: false,
    emissiveIntensity: 0,
    particleRate: 0,
    attachments: [],             // [{type, meshId, family}]
    history: [],                 // [{powerId, timestamp}]
  };
}

// ── Tier Advancement ────────────────────────────────────────────────────────

/**
 * Advance mutation from a power-up infection.
 * @param {object} state - Mutation state
 * @param {string} powerId - Power-up that caused infection
 * @param {string} family - Family of the power-up
 * @param {number} now - Timestamp
 * @returns {{ tierChanged: boolean, newTier: number, deformStrength: number }}
 */
export function infectKart(state, powerId, family, now) {
  state.infectionCount++;
  state.history.push({ powerId, timestamp: now });

  // Update dominant family (most frequent)
  const familyCounts = {};
  for (const h of state.history) {
    const f = h.powerId; // We track family via the history
    familyCounts[family] = (familyCounts[family] || 0) + 1;
  }
  let maxCount = 0;
  for (const [f, c] of Object.entries(familyCounts)) {
    if (c > maxCount) { maxCount = c; state.dominantFamily = f; }
  }
  state.dominantFamily = family; // latest wins ties

  // Advance tier every 4 infections
  const newTier = Math.min(MUTATION_TIER.APEX, Math.floor(state.infectionCount / 4));
  const tierChanged = newTier !== state.tier;
  state.tier = newTier;

  // Update visual parameters
  state.deformApplied = false; // force re-apply
  state.emissiveIntensity = TIER_EMISSIVE_MULT[state.tier];
  state.particleRate = TIER_PARTICLE_RATE[state.tier];

  return {
    tierChanged,
    newTier: state.tier,
    deformStrength: TIER_DEFORM_STRENGTH[state.tier],
  };
}

// ── Vertex Deformation ──────────────────────────────────────────────────────

/**
 * Compute deformed vertex positions for a kart mesh.
 * Uses seeded noise to create organic mutation growths.
 *
 * @param {Float32Array} originalPositions
 * @param {number} tier - Current mutation tier
 * @param {number} seed - Unique per-kart seed
 * @param {string} family - Dominant family (affects deform pattern)
 * @returns {Float32Array} Deformed positions
 */
export function computeDeformedPositions(originalPositions, tier, seed, family) {
  if (tier === 0) return originalPositions;

  const strength = TIER_DEFORM_STRENGTH[tier];
  const result = new Float32Array(originalPositions.length);
  const familyPattern = familyDeformPattern(family);

  for (let i = 0; i < originalPositions.length; i += 3) {
    const x = originalPositions[i];
    const y = originalPositions[i + 1];
    const z = originalPositions[i + 2];

    // Seeded pseudo-noise deformation
    const n1 = Math.sin(x * 3.7 + seed) * Math.cos(z * 2.3 + seed * 0.7);
    const n2 = Math.sin(y * 4.1 + seed * 1.3) * Math.cos(x * 1.9 + seed * 0.3);
    const n3 = Math.cos(z * 3.3 + seed * 0.5) * Math.sin(y * 2.7 + seed * 1.1);

    result[i]     = x + n1 * strength * familyPattern.x;
    result[i + 1] = y + n2 * strength * familyPattern.y;
    result[i + 2] = z + n3 * strength * familyPattern.z;
  }

  return result;
}

function familyDeformPattern(family) {
  switch (family) {
    case FAMILY.PHANTOM_HORDE:
      return { x: 1.2, y: 0.3, z: 1.2 }; // lateral ghostly distortion
    case FAMILY.ENTROPIC_VOID:
      return { x: 0.8, y: 1.5, z: 0.8 }; // vertical warping
    case FAMILY.BIOFRACTAL_AEGIS:
      return { x: 1.0, y: 1.0, z: 1.0 }; // organic uniform growth
    case FAMILY.PSYCHE_APOTHEOSIS:
      return { x: 1.4, y: 0.5, z: 1.4 }; // horizontal fracture
    default:
      return { x: 1, y: 1, z: 1 };
  }
}

// ── Emissive Color ──────────────────────────────────────────────────────────

/**
 * Get the emissive color for a mutation state.
 * @param {object} state
 * @returns {{ r: number, g: number, b: number, intensity: number }}
 */
export function getMutationEmissive(state) {
  const famColor = FAMILY_META[state.dominantFamily]?.color || [0.5, 0.5, 0.5];
  return {
    r: famColor[0],
    g: famColor[1],
    b: famColor[2],
    intensity: state.emissiveIntensity,
  };
}

/**
 * Apply mutation visuals to a Babylon material.
 * @param {BABYLON.StandardMaterial} material
 * @param {object} state
 */
export function applyMutationToMaterial(material, state) {
  if (!material || state.tier === 0) return;
  const em = getMutationEmissive(state);
  material.emissiveColor = new Color3(em.r * em.intensity, em.g * em.intensity, em.b * em.intensity);
}

// ── Symbiote Attachments ────────────────────────────────────────────────────

/**
 * Add a symbiote attachment (visual indicator of active power-up family).
 * @param {object} state
 * @param {string} type - Attachment type ('tendril', 'orb', 'spore', 'crystal')
 * @param {string} family
 * @returns {object} The new attachment descriptor
 */
export function addAttachment(state, type, family) {
  const attachment = {
    id: `attach_${state.attachments.length}`,
    type,
    family,
    scale: 0.3 + state.tier * 0.15,
  };
  state.attachments.push(attachment);
  return attachment;
}

/**
 * Remove expired attachments.
 * @param {object} state
 * @param {string[]} activePowerFamilies - Currently active families
 */
export function pruneAttachments(state, activePowerFamilies) {
  const activeSet = new Set(activePowerFamilies);
  state.attachments = state.attachments.filter(a => activeSet.has(a.family));
}

// ── Persistence ─────────────────────────────────────────────────────────────

/**
 * Serialize mutation state for respawn persistence.
 * @param {object} state
 * @returns {object} Serializable data
 */
export function serializeMutation(state) {
  return {
    tier: state.tier,
    dominantFamily: state.dominantFamily,
    infectionCount: state.infectionCount,
    deformSeed: state.deformSeed,
    history: state.history.slice(-20), // keep last 20
  };
}

/**
 * Restore mutation state after respawn.
 * @param {object} serialized
 * @returns {object} Restored mutation state
 */
export function deserializeMutation(serialized) {
  const state = createMutationState();
  state.tier = serialized.tier || 0;
  state.dominantFamily = serialized.dominantFamily || FAMILY.PHANTOM_HORDE;
  state.infectionCount = serialized.infectionCount || 0;
  state.deformSeed = serialized.deformSeed || Math.random() * 10000;
  state.history = serialized.history || [];
  state.emissiveIntensity = TIER_EMISSIVE_MULT[state.tier];
  state.particleRate = TIER_PARTICLE_RATE[state.tier];
  return state;
}

// ── Accessors ───────────────────────────────────────────────────────────────

export function getTierLabel(state) {
  return TIER_LABELS[state.tier] || 'Unknown';
}

export function getTierDeformStrength(tier) {
  return TIER_DEFORM_STRENGTH[tier] || 0;
}

export function getTierParticleRate(tier) {
  return TIER_PARTICLE_RATE[tier] || 0;
}

export function isMutated(state) {
  return state.tier > 0;
}

export function isApex(state) {
  return state.tier >= MUTATION_TIER.APEX;
}
