/**
 * glo-flux-powers.js — Complete power-up catalogue & synergy engine for gloFLUX mode.
 *
 * 20 power-ups across 4 symbiotic families with chain detection, feedback loops,
 * Surge Meter accumulation, and Echo Shard near-miss rewards.
 *
 * Families:
 *   Phantom Horde   (1-4)   — Offensive deception/overwhelm
 *   Entropic Void   (5-8)   — Offensive/neutral sabotage/chaos
 *   Biofractal Aegis(9-13)  — Defensive adaptation/survival
 *   Psyche Apotheosis(14-20) — Neutral/offensive evolution/mindgames
 */

// ── Family Definitions ──────────────────────────────────────────────────────

export const FAMILY = Object.freeze({
  PHANTOM_HORDE:     'phantom_horde',
  ENTROPIC_VOID:     'entropic_void',
  BIOFRACTAL_AEGIS:  'biofractal_aegis',
  PSYCHE_APOTHEOSIS: 'psyche_apotheosis',
});

export const FAMILY_META = Object.freeze({
  [FAMILY.PHANTOM_HORDE]: {
    label: 'Phantom Horde', color: [0.6, 0.1, 0.9], icon: 'ghost',
    desc: 'Deception & overwhelm — drown enemies in spectral chaos.',
  },
  [FAMILY.ENTROPIC_VOID]: {
    label: 'Entropic Void', color: [0.1, 0.05, 0.2], icon: 'void',
    desc: 'Sabotage & chaos — warp reality, trap and confuse.',
  },
  [FAMILY.BIOFRACTAL_AEGIS]: {
    label: 'Biofractal Aegis', color: [0.1, 0.8, 0.3], icon: 'shield',
    desc: 'Adaptation & survival — regenerate, phase, multiply.',
  },
  [FAMILY.PSYCHE_APOTHEOSIS]: {
    label: 'Psyche Apotheosis', color: [1.0, 0.3, 0.6], icon: 'brain',
    desc: 'Evolution & mindgames — hallucinate, mutate, reverse.',
  },
});

// ── Power-Up Catalogue (all 20) ────────────────────────────────────────────

export const POWERS = Object.freeze({

  // ─── Phantom Horde (1-4) ───────────────────────────────────────────────
  echo_phantom: {
    id: 'echo_phantom', idx: 1, family: FAMILY.PHANTOM_HORDE,
    label: 'Echo Phantom', rarity: 0.12,
    desc: 'Summon a noise-deformed ghost clone that mimics your path.',
    baseDuration: 8, cooldown: 12, surgeContrib: 5,
    effect: { type: 'summon', count: 1, behaviour: 'mimic', isGhost: true },
    havok: { bodyType: 'kinematic', mass: 0, collisionGroup: 'ghost' },
  },
  quantum_duplicate: {
    id: 'quantum_duplicate', idx: 2, family: FAMILY.PHANTOM_HORDE,
    label: 'Quantum Duplicate', rarity: 0.10,
    desc: 'Split into 2 functional copies — enemies waste ammo on fakes.',
    baseDuration: 6, cooldown: 15, surgeContrib: 7,
    effect: { type: 'split', count: 2, behaviour: 'scatter', isGhost: true },
    havok: { bodyType: 'kinematic', mass: 0, collisionGroup: 'ghost' },
  },
  neural_hijack: {
    id: 'neural_hijack', idx: 3, family: FAMILY.PHANTOM_HORDE,
    label: 'Neural Hijack', rarity: 0.06,
    desc: 'On ghost death — possess the nearest enemy for 3 seconds.',
    baseDuration: 3, cooldown: 20, surgeContrib: 10,
    effect: { type: 'possess', range: 15, inputOverride: true },
    havok: { bodyType: 'dynamic', impulseOnHijack: 8, contactPoint: true },
  },
  symbiote_swarm: {
    id: 'symbiote_swarm', idx: 4, family: FAMILY.PHANTOM_HORDE,
    label: 'Symbiote Swarm', rarity: 0.04,
    desc: 'Release a swarm of micro-symbiotes that attach to nearby karts.',
    baseDuration: 10, cooldown: 25, surgeContrib: 12,
    effect: { type: 'swarm', count: 8, range: 20, slowFactor: 0.6 },
    havok: { bodyType: 'kinematic', thinInstance: true, sleepInactive: true },
  },

  // ─── Entropic Void (5-8) ──────────────────────────────────────────────
  pirateleportation: {
    id: 'pirateleportation', idx: 5, family: FAMILY.ENTROPIC_VOID,
    label: 'Pirateleportation', rarity: 0.12,
    desc: 'Steal a random other player\'s item.',
    baseDuration: 5, cooldown: 12, surgeContrib: 5,
    effect: { type: 'radial_force', radius: 18, strength: 15, pull: true },
    havok: { radialImpulse: true, strengthScale: 1.0, damping: 0.98 },
  },
  dimensional_rift: {
    id: 'dimensional_rift', idx: 6, family: FAMILY.ENTROPIC_VOID,
    label: 'Dimensional Rift', rarity: 0.08,
    desc: 'Open a Bezier-curved portal — enemies entering swap positions.',
    baseDuration: 6, cooldown: 18, surgeContrib: 8,
    effect: { type: 'portal', swapTargets: true, bezierArc: true },
    havok: { teleport: true, preserveVelocity: false },
  },
  entropy_cascade: {
    id: 'entropy_cascade', idx: 7, family: FAMILY.ENTROPIC_VOID,
    label: 'Entropy Cascade', rarity: 0.06,
    desc: 'Infected karts slowly lose mass and control over 4 seconds.',
    baseDuration: 4, cooldown: 20, surgeContrib: 9,
    effect: { type: 'debuff', massDecay: 0.3, controlLoss: 0.5 },
    havok: { massReduction: true, linearDamping: 0.7, gravityOverride: true },
  },
  weather_dominion: {
    id: 'weather_dominion', idx: 8, family: FAMILY.ENTROPIC_VOID,
    label: 'Weather Dominion', rarity: 0.05,
    desc: 'Summon localized weather — fog blinds, lightning strikes chasers.',
    baseDuration: 8, cooldown: 22, surgeContrib: 10,
    effect: { type: 'weather', fog: true, lightning: true, radius: 25 },
    havok: { lightningImpulse: 20, fogPhysics: false },
  },

  // ─── Biofractal Aegis (9-13) ─────────────────────────────────────────
  phase_shift: {
    id: 'phase_shift', idx: 9, family: FAMILY.BIOFRACTAL_AEGIS,
    label: 'Phase Shift', rarity: 0.12,
    desc: 'Become intangible for 2 seconds — pass through all hazards.',
    baseDuration: 2, cooldown: 10, surgeContrib: 4,
    effect: { type: 'phase', intangible: true, visualAlpha: 0.3 },
    havok: { collisionDisabled: true, kinematic: true },
  },
  bio_regen_cocoon: {
    id: 'bio_regen_cocoon', idx: 10, family: FAMILY.BIOFRACTAL_AEGIS,
    label: 'Bio-Regen Cocoon', rarity: 0.10,
    desc: 'Encase in a fractal shell — frozen but regenerating health.',
    baseDuration: 3, cooldown: 18, surgeContrib: 6,
    effect: { type: 'cocoon', healPerSec: 25, immobile: true, armor: 0.8 },
    havok: { freeze: true, zeroVelocity: true, radialBurst: true },
  },
  fractal_duplication: {
    id: 'fractal_duplication', idx: 11, family: FAMILY.BIOFRACTAL_AEGIS,
    label: 'Fractal Duplication', rarity: 0.07,
    desc: 'Split into 5 tiny phasing copies that confuse and regenerate.',
    baseDuration: 5, cooldown: 20, surgeContrib: 8,
    effect: { type: 'fractal_split', count: 5, miniScale: 0.4, phase: true },
    havok: { lightMass: 0.01, kinematicPhase: true, sleepIdle: true },
  },
  symbiotic_overgrowth: {
    id: 'symbiotic_overgrowth', idx: 12, family: FAMILY.BIOFRACTAL_AEGIS,
    label: 'Symbiotic Overgrowth', rarity: 0.05,
    desc: 'Sprout SPS vines that block paths and snare enemies.',
    baseDuration: 7, cooldown: 22, surgeContrib: 9,
    effect: { type: 'vines', vineCount: 12, snareStrength: 0.3, blockRadius: 8 },
    havok: { staticBodies: true, sleepEnabled: true, snareForce: 5 },
  },
  paradox_loop: {
    id: 'paradox_loop', idx: 13, family: FAMILY.BIOFRACTAL_AEGIS,
    label: 'Paradox Loop', rarity: 0.04,
    desc: 'Rewind 3 seconds of damage — return to previous position/health.',
    baseDuration: 0, cooldown: 30, surgeContrib: 11,
    effect: { type: 'rewind', rewindFrames: 180, fullRestore: false },
    havok: { teleport: true, preserveVelocity: true },
  },

  // ─── Psyche Apotheosis (14-20) ────────────────────────────────────────
  psyche_fracture: {
    id: 'psyche_fracture', idx: 14, family: FAMILY.PSYCHE_APOTHEOSIS,
    label: 'Psyche Fracture', rarity: 0.10,
    desc: 'Enemy screens show hallucination overlays — fake walls and items.',
    baseDuration: 5, cooldown: 15, surgeContrib: 6,
    effect: { type: 'hallucination', targetCount: 3, fakeWalls: true },
    havok: { noPhysicsEffect: true },
  },
  chronal_echo: {
    id: 'chronal_echo', idx: 15, family: FAMILY.PSYCHE_APOTHEOSIS,
    label: 'Chronal Echo', rarity: 0.08,
    desc: 'Leave a time-ghost at your position — reactivate to teleport back.',
    baseDuration: 10, cooldown: 18, surgeContrib: 7,
    effect: { type: 'time_anchor', anchorDuration: 10, teleportBack: true },
    havok: { collisionDisabled: true, teleport: true },
  },
  mutation_surge: {
    id: 'mutation_surge', idx: 16, family: FAMILY.PSYCHE_APOTHEOSIS,
    label: 'Mutation Surge', rarity: 0.06,
    desc: 'Randomly mutate your kart — gain a random stat boost for 8 seconds.',
    baseDuration: 8, cooldown: 20, surgeContrib: 8,
    effect: { type: 'random_buff', possibleBuffs: ['speed', 'armor', 'damage', 'handling'] },
    havok: { vertexMutation: true, massShift: true },
  },
  rogue_ai_companion: {
    id: 'rogue_ai_companion', idx: 17, family: FAMILY.PSYCHE_APOTHEOSIS,
    label: 'Rogue AI Companion', rarity: 0.05,
    desc: 'Summon an autonomous AI fighter that hunts nearby enemies.',
    baseDuration: 12, cooldown: 25, surgeContrib: 10,
    effect: { type: 'ai_summon', aiMass: 0.2, friction: 0.1, huntRadius: 30 },
    havok: { dynamicAggregate: true, torqueSteering: true, damping: 0.85 },
  },
  rhythm_pulse: {
    id: 'rhythm_pulse', idx: 18, family: FAMILY.PSYCHE_APOTHEOSIS,
    label: 'Rhythm Pulse', rarity: 0.07,
    desc: 'Emit shockwaves synced to an audio beat — buffing allies, stunning foes.',
    baseDuration: 6, cooldown: 18, surgeContrib: 7,
    effect: { type: 'aoe_pulse', pulseInterval: 0.5, stunDuration: 0.8, radius: 12 },
    havok: { radialImpulse: true, intervalForce: true },
  },
  karmic_reversal: {
    id: 'karmic_reversal', idx: 19, family: FAMILY.PSYCHE_APOTHEOSIS,
    label: 'Karmic Reversal', rarity: 0.04,
    desc: 'Reverse gravity for all enemies in range for 3 seconds.',
    baseDuration: 3, cooldown: 25, surgeContrib: 12,
    effect: { type: 'gravity_flip', range: 20, flipDuration: 3 },
    havok: { gravityOverride: true, invertVector: true, angularTumble: true },
  },
  ecosystem_hack: {
    id: 'ecosystem_hack', idx: 20, family: FAMILY.PSYCHE_APOTHEOSIS,
    label: 'Ecosystem Hack', rarity: 0.03,
    desc: 'Turn arena hazards into allies — radiation pools heal you, fungi attack enemies.',
    baseDuration: 10, cooldown: 30, surgeContrib: 15,
    effect: { type: 'arena_hack', invertHazards: true, convertRadius: 25 },
    havok: { radialStampede: true, sleepToggle: true },
  },
});

// ── Rarity-weighted draw ────────────────────────────────────────────────────

const _powerList = Object.values(POWERS);
const _totalWeight = _powerList.reduce((s, p) => s + p.rarity, 0);

/** Draw a random power-up weighted by rarity. */
export function drawPower(rand = Math.random) {
  let r = rand() * _totalWeight;
  for (const p of _powerList) {
    r -= p.rarity;
    if (r <= 0) return p;
  }
  return _powerList[_powerList.length - 1];
}

/** Draw a power-up from a specific family. */
export function drawFamilyPower(familyId, rand = Math.random) {
  const familyPowers = _powerList.filter(p => p.family === familyId);
  const total = familyPowers.reduce((s, p) => s + p.rarity, 0);
  let r = rand() * total;
  for (const p of familyPowers) {
    r -= p.rarity;
    if (r <= 0) return p;
  }
  return familyPowers[familyPowers.length - 1];
}

// ── Synergy Detection Engine ────────────────────────────────────────────────

/**
 * Synergy definitions — when specific power-up combos are active, trigger
 * enhanced effects. Each synergy has a unique resultant behavior.
 */
export const SYNERGIES = Object.freeze({
  horde_split: {
    id: 'horde_split',
    label: 'Horde Split',
    family: FAMILY.PHANTOM_HORDE,
    requires: ['echo_phantom', 'quantum_duplicate'],
    desc: '5 ghosts that each hijack on death.',
    surgeMultiplier: 2.0,
    effect: { ghostCount: 5, hijackOnDeath: true },
  },
  void_portal: {
    id: 'void_portal',
    label: 'Void Portal',
    family: FAMILY.ENTROPIC_VOID,
    requires: ['pirateleportation', 'dimensional_rift'],
    desc: 'Pull enemies into a swap-trap.',
    surgeMultiplier: 1.8,
    effect: { pullRadius: 22, swapOnContact: true },
  },
  fractal_cocoon: {
    id: 'fractal_cocoon',
    label: 'Fractal Cocoon',
    family: FAMILY.BIOFRACTAL_AEGIS,
    requires: ['phase_shift', 'bio_regen_cocoon'],
    desc: '5 phasing minis that regenerate.',
    surgeMultiplier: 1.6,
    effect: { miniCount: 5, phasing: true, regenPerSec: 15 },
  },
  echo_hallucination: {
    id: 'echo_hallucination',
    label: 'Echo Hallucination',
    family: FAMILY.PSYCHE_APOTHEOSIS,
    requires: ['psyche_fracture', 'chronal_echo'],
    desc: 'Enemies rewind into illusion fields.',
    surgeMultiplier: 2.2,
    effect: { hallucinateOnRewind: true, illusionDuration: 6 },
  },

  // ── Cross-family mega synergies ──────────────────────────────────────
  phantom_entropy: {
    id: 'phantom_entropy',
    label: 'Phantom Entropy',
    family: null, // cross-family
    requires: ['symbiote_swarm', 'entropy_cascade'],
    desc: 'Swarm carriers decay and explode on death.',
    surgeMultiplier: 2.5,
    effect: { swarmDecay: true, explodeOnDeath: true, radius: 10 },
  },
  bio_psyche_bloom: {
    id: 'bio_psyche_bloom',
    label: 'Bio-Psyche Bloom',
    family: null,
    requires: ['symbiotic_overgrowth', 'ecosystem_hack'],
    desc: 'Vines become sentient — hunt and snare enemies autonomously.',
    surgeMultiplier: 3.0,
    effect: { sentientVines: true, huntRange: 20, snareDuration: 4 },
  },
  apocalypse_precursor: {
    id: 'apocalypse_precursor',
    label: 'Apocalypse Precursor',
    family: null,
    requires: ['neural_hijack', 'karmic_reversal', 'paradox_loop'],
    desc: 'Time-gravity-mind collapse — arena momentarily inverts all rules.',
    surgeMultiplier: 5.0,
    effect: { invertAll: true, duration: 3, arenaWide: true },
  },
});

const _synergyList = Object.values(SYNERGIES);

/**
 * Detect which synergies a player has unlocked given their active power-up set.
 * @param {string[]} activePowerIds - IDs of currently active power-ups
 * @returns {object[]} Array of active synergy definitions
 */
export function detectSynergies(activePowerIds) {
  const activeSet = new Set(activePowerIds);
  return _synergyList.filter(syn =>
    syn.requires.every(reqId => activeSet.has(reqId))
  );
}

/**
 * Calculate total surge contribution from power-ups + synergy multipliers.
 * @param {string[]} activePowerIds
 * @returns {{ baseSurge: number, multiplier: number, totalSurge: number }}
 */
export function calculateSurgeGain(activePowerIds) {
  let baseSurge = 0;
  for (const pid of activePowerIds) {
    const p = POWERS[pid];
    if (p) baseSurge += p.surgeContrib;
  }
  const synergies = detectSynergies(activePowerIds);
  let multiplier = 1.0;
  for (const syn of synergies) {
    multiplier *= syn.surgeMultiplier;
  }
  return { baseSurge, multiplier, totalSurge: baseSurge * multiplier };
}

// ── Player Power-Up State ───────────────────────────────────────────────────

/**
 * Create a player's power-up state tracker.
 * @returns {object} Mutable power state
 */
export function createPowerState() {
  return {
    activePowers: [],      // [{powerId, startTime, remaining, stacks}]
    recentChains: [],      // [{synergyId, timestamp}]
    echoShards: 0,         // near-miss reward currency
    totalChainsHit: 0,
    mutationLevel: 0,      // 0-5 visual mutation tiers
    familyCounts: {        // how many from each family collected total
      [FAMILY.PHANTOM_HORDE]: 0,
      [FAMILY.ENTROPIC_VOID]: 0,
      [FAMILY.BIOFRACTAL_AEGIS]: 0,
      [FAMILY.PSYCHE_APOTHEOSIS]: 0,
    },
  };
}

/**
 * Activate a power-up for a player.
 * @param {object} state - Player power state from createPowerState()
 * @param {string} powerId
 * @param {number} now - Current time in seconds
 * @returns {{ power, newSynergies, surgeGain }}
 */
export function activatePower(state, powerId, now) {
  const power = POWERS[powerId];
  if (!power) return null;

  // Add to active list
  state.activePowers.push({
    powerId,
    startTime: now,
    remaining: power.baseDuration,
    stacks: 1,
  });

  // Track family count
  state.familyCounts[power.family]++;

  // Update mutation level based on total power-ups collected
  const totalCollected = Object.values(state.familyCounts).reduce((a, b) => a + b, 0);
  state.mutationLevel = Math.min(5, Math.floor(totalCollected / 4));

  // Detect new synergies
  const activeIds = state.activePowers.map(a => a.powerId);
  const newSynergies = detectSynergies(activeIds);
  const surgeGain = calculateSurgeGain(activeIds);

  // Record new chains
  for (const syn of newSynergies) {
    if (!state.recentChains.find(c => c.synergyId === syn.id && now - c.timestamp < 10)) {
      state.recentChains.push({ synergyId: syn.id, timestamp: now });
      state.totalChainsHit++;
    }
  }

  return { power, newSynergies, surgeGain };
}

/**
 * Tick power-up durations and expire finished ones.
 * @param {object} state
 * @param {number} dt - Delta time in seconds
 * @returns {string[]} IDs of expired power-ups
 */
export function tickPowers(state, dt) {
  const expired = [];
  state.activePowers = state.activePowers.filter(entry => {
    entry.remaining -= dt;
    if (entry.remaining <= 0) {
      expired.push(entry.powerId);
      return false;
    }
    return true;
  });

  // Clean old chain records (keep last 30s)
  const now = state.activePowers.length > 0
    ? state.activePowers[0].startTime + state.activePowers[0].remaining
    : 0;
  state.recentChains = state.recentChains.filter(c => now - c.timestamp < 30);

  return expired;
}

/**
 * Award Echo Shards for near-miss events.
 * @param {object} state
 * @param {number} distance - How close the near-miss was
 * @returns {number} Shards awarded
 */
export function awardEchoShards(state, distance) {
  // Closer = more shards, max 5 at point-blank, min 1
  const shards = Math.max(1, Math.round(5 * (1 - distance / 15)));
  state.echoShards += shards;
  return shards;
}

/**
 * Get the dominant family for a player (most power-ups collected from).
 * @param {object} state
 * @returns {string} Family ID
 */
export function getDominantFamily(state) {
  let max = 0;
  let dominant = FAMILY.PHANTOM_HORDE;
  for (const [fam, count] of Object.entries(state.familyCounts)) {
    if (count > max) { max = count; dominant = fam; }
  }
  return dominant;
}

/**
 * Get all power-ups in a family.
 * @param {string} familyId
 * @returns {object[]}
 */
export function getPowersInFamily(familyId) {
  return _powerList.filter(p => p.family === familyId);
}

/** Get a power-up definition by ID. */
export function getPower(id) {
  return POWERS[id] || null;
}

/** Get a synergy definition by ID. */
export function getSynergy(id) {
  return SYNERGIES[id] || null;
}

/** Get all power-up IDs. */
export function getAllPowerIds() {
  return Object.keys(POWERS);
}

/** Get all synergy IDs. */
export function getAllSynergyIds() {
  return Object.keys(SYNERGIES);
}
