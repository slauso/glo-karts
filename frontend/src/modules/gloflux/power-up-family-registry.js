import { FAMILY, POWERS, SYNERGIES } from './glo-flux-powers.js';

const FAMILY_TABLE = Object.freeze({
  [FAMILY.PHANTOM_HORDE]: {
    id: FAMILY.PHANTOM_HORDE,
    label: 'Phantom Horde',
    powerIds: ['echo_phantom', 'quantum_duplicate', 'neural_hijack', 'symbiote_swarm'],
    synergies: {
      base: {
        comboId: 'horde_split',
        requires: ['echo_phantom', 'quantum_duplicate'],
        label: 'Horde Split',
        effect: '5 ghosts hijack on death',
      },
      loop: 'Hijacked -> Echo Shard -> +1 duplicate',
      surgeMultiplier: 2,
      proceduralTwist: 'Ghost models with noise-deformed clones and evolving trails',
    },
  },
  [FAMILY.ENTROPIC_VOID]: {
    id: FAMILY.ENTROPIC_VOID,
    label: 'Entropic Void',
    powerIds: ['pirateleportation', 'dimensional_rift', 'entropy_cascade', 'weather_dominion'],
    synergies: {
      base: {
        comboId: 'void_portal',
        requires: ['pirateleportation', 'dimensional_rift'],
        label: 'Void Portal',
        effect: 'Pull -> swap trap',
      },
      loop: 'Swapped -> entropy -> weather (fog escape)',
      surgeMultiplier: 1.6,
      proceduralTwist: 'Bezier rifts and dynamic fog/heightmap ruptures',
    },
  },
  [FAMILY.BIOFRACTAL_AEGIS]: {
    id: FAMILY.BIOFRACTAL_AEGIS,
    label: 'Biofractal Aegis',
    powerIds: ['phase_shift', 'bio_regen_cocoon', 'fractal_duplication', 'symbiotic_overgrowth', 'paradox_loop'],
    synergies: {
      base: {
        comboId: 'fractal_cocoon',
        requires: ['phase_shift', 'bio_regen_cocoon'],
        label: 'Fractal Cocoon',
        effect: '5 phasing minis with regen',
      },
      loop: 'Minis rewind -> vines block -> full heal on surge',
      surgeMultiplier: 1.45,
      proceduralTwist: 'Recursive fractal minis and SPS vine growth',
    },
  },
  [FAMILY.PSYCHE_APOTHEOSIS]: {
    id: FAMILY.PSYCHE_APOTHEOSIS,
    label: 'Psyche Apotheosis',
    powerIds: ['psyche_fracture', 'chronal_echo', 'mutation_surge', 'rogue_ai_companion', 'rhythm_pulse', 'karmic_reversal', 'ecosystem_hack'],
    synergies: {
      base: {
        comboId: 'echo_hallucination',
        requires: ['psyche_fracture', 'chronal_echo'],
        label: 'Echo Hallucination',
        effect: 'Rewind illusions',
      },
      loop: 'Illusions -> AI companions -> rhythm stampede -> arena-wide reversal',
      surgeMultiplier: 1.75,
      proceduralTwist: 'Code-gen mutations and noisy AI decision trees',
    },
  },
});

export class PowerUpFamilyRegistry {
  constructor() {
    this.families = new Map();
    this.powerToFamily = new Map();
    this.comboToFamily = new Map();
    this._bootstrap();
  }

  _bootstrap() {
    for (const family of Object.values(FAMILY_TABLE)) {
      const powers = family.powerIds.map((powerId) => ({
        ...POWERS[powerId],
      })).filter(Boolean);

      const enriched = {
        ...family,
        powers,
        powerIds: powers.map((power) => power.id),
      };

      this.families.set(family.id, enriched);
      for (const power of powers) {
        this.powerToFamily.set(power.id, family.id);
      }
      if (family.synergies?.base?.comboId) {
        this.comboToFamily.set(family.synergies.base.comboId, family.id);
      }
    }

    for (const synergy of Object.values(SYNERGIES)) {
      if (!this.comboToFamily.has(synergy.id) && synergy.family) {
        this.comboToFamily.set(synergy.id, synergy.family);
      }
    }
  }

  getFamilies() {
    return Array.from(this.families.values());
  }

  getFamily(familyId) {
    return this.families.get(familyId) || null;
  }

  getFamilyForPower(powerId) {
    return this.powerToFamily.get(powerId) || null;
  }

  getFamilyForCombo(comboId) {
    return this.comboToFamily.get(comboId) || null;
  }

  getProceduralDescriptor(powerId) {
    const family = this.getFamily(this.getFamilyForPower(powerId));
    return family
      ? {
          familyId: family.id,
          familyLabel: family.label,
          proceduralTwist: family.synergies.proceduralTwist,
          surgeMultiplier: family.synergies.surgeMultiplier,
        }
      : null;
  }

  toJSON() {
    return this.getFamilies().map((family) => ({
      id: family.id,
      label: family.label,
      powerIds: family.powerIds.slice(),
      synergies: family.synergies,
    }));
  }
}

export function createPowerUpFamilyRegistry() {
  return new PowerUpFamilyRegistry();
}