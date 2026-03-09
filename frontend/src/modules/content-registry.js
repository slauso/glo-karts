export const GAME_MODES = {
  race: {
    id: 'race',
    label: 'Race',
    defaultWeaponSet: null,
  },
  battle: {
    id: 'battle',
    label: 'Battle',
    defaultWeaponSet: 'classic',
  },
};

import { getTrackRegistry } from './track-data.js';

export const SINGLE_PLAYER_RACE_MODES = {
  quick_race: { id: 'quick_race', label: 'Quick Race' },
  time_attack: { id: 'time_attack', label: 'Time Attack' },
  grand_prix: { id: 'grand_prix', label: 'Grand Prix' },
};

// ── Single-player cups — Procedural demo course only ───────────────
export const SINGLE_PLAYER_CUPS = {
  starter: {
    id: 'starter',
    label: 'Glo Cup',
    description: 'Race the procedurally generated Glo Circuit.',
    icon: '🏁',
    theme: 'All Levels',
    trackIds: ['glo_circuit', 'glo_circuit', 'glo_circuit', 'glo_circuit'],
    unlockByCup: null,
  },
};

export const VERIFIED_RACE_TRACK_IDS = [
  'glo_circuit',
];

export const TIME_ATTACK_TARGETS = {
  glo_circuit: { id: 'glo_circuit', label: 'Glo Circuit', trackPath: null, scale: 1, startPositions: [{x: 0, y: 2, z: 0}] },
};

export const WEAPON_SETS = {
  lite: {
    id: 'lite',
    label: 'Lite',
    weapons: {
      bowling: { id: 'bowling', name: 'BOWLING BALL', icon: '', damage: 25, speed: 40, lifetime: 5.0, bounces: true },
      plunger: { id: 'plunger', name: 'PLUNGER', icon: '', damage: 15, speed: 60, lifetime: 3.0, blinds: true },
      bubblegum: { id: 'bubblegum', name: 'BUBBLEGUM', icon: '', damage: 20, speed: 0, lifetime: 30.0, mine: true },
    },
  },
  classic: {
    id: 'classic',
    label: 'Classic',
    weapons: {
      bowling: { id: 'bowling', name: 'BOWLING BALL', icon: '', damage: 25, speed: 40, lifetime: 5.0, bounces: true },
      cake: { id: 'cake', name: 'CAKE', icon: '', damage: 35, speed: 45, lifetime: 6.0, homing: true },
      plunger: { id: 'plunger', name: 'PLUNGER', icon: '', damage: 15, speed: 60, lifetime: 3.0, blinds: true },
      bubblegum: { id: 'bubblegum', name: 'BUBBLEGUM', icon: '', damage: 20, speed: 0, lifetime: 30.0, mine: true },
      swatter: { id: 'swatter', name: 'SWATTER', icon: '', damage: 40, speed: 0, lifetime: 0.5, melee: true },
    },
  },
};

// ── Derive ALL_TRACKS & ALL_ARENAS from the authoritative track-data.js registry ──
// This eliminates the prior duplication where every track/arena ID, label, type,
// and start position was maintained in two separate data structures.
// Extra UI-only overrides (kartScale) are applied below.

const _registry = getTrackRegistry();

function _toContentEntry(id, info, overrides = {}) {
  const start = info.start || { x: 0, y: 2, z: 0 };
  return {
    id,
    label: info.name || id,
    type: info.type,
    scale: info.scale || 1,
    startPositions: [{ x: start.x, y: start.y, z: start.z }],
    ...overrides,
  };
}

const _arenaOverrides = {
  glo_arena: { startPositions: [{x: 0, y: 2, z: 0}, {x: 15, y: 2, z: 15}, {x: -15, y: 2, z: -15}, {x: 15, y: 2, z: -15}] },
};

const _trackOverrides = {
  glo_circuit: { startPositions: [{x: 0, y: 2, z: 0}, {x: 5, y: 2, z: 5}, {x: -5, y: 2, z: -5}, {x: 5, y: 2, z: -5}] },
};

export const ALL_TRACKS = {};
export const ALL_ARENAS = {};

for (const [id, info] of Object.entries(_registry)) {
  const isArena = info.type === 'procedural-arena';
  if (isArena) {
    ALL_ARENAS[id] = _toContentEntry(id, info, _arenaOverrides[id]);
  } else {
    ALL_TRACKS[id] = _toContentEntry(id, info, _trackOverrides[id]);
  }
}

export const ALL_KARTS = {
  default: { id: 'default', label: 'Classic Kart', modelPath: '/models/car.glb', scale: 2.8 },
  adiumy: { id: 'adiumy', label: 'Angela', modelPath: '/models/stk/karts/adiumy/kart.glb', scale: 2.2 },
  amanda: { id: 'amanda', label: 'Olivia', modelPath: '/models/stk/karts/amanda/kart.glb', scale: 2.2 },
  beastie: { id: 'beastie', label: 'Fred', modelPath: '/models/stk/karts/beastie/kart.glb', scale: 2.2 },
  emule: { id: 'emule', label: 'Luca', modelPath: '/models/stk/karts/emule/kart.glb', scale: 2.2 },
  gavroche: { id: 'gavroche', label: 'Mia', modelPath: '/models/stk/karts/gavroche/kart.glb', scale: 2.2 },
  gnu: { id: 'gnu', label: 'Wes', modelPath: '/models/stk/karts/gnu/kart.glb', scale: 2.2 },
  hexley: { id: 'hexley', label: 'James', modelPath: '/models/stk/karts/hexley/kart.glb', scale: 2.2 },
  kiki: { id: 'kiki', label: 'Grace', modelPath: '/models/stk/karts/kiki/kart.glb', scale: 2.2 },
  konqi: { id: 'konqi', label: 'John', modelPath: '/models/stk/karts/konqi/kart.glb', scale: 2.2 },
  nolok: { id: 'nolok', label: 'Lisa', modelPath: '/models/stk/karts/nolok/kart.glb', scale: 2.2 },
  pidgin: { id: 'pidgin', label: 'Christi', modelPath: '/models/stk/karts/pidgin/kart.glb', scale: 2.2 },
  puffy: { id: 'puffy', label: 'Pat', modelPath: '/models/stk/karts/puffy/kart.glb', scale: 2.2 },
  sara_the_racer: { id: 'sara_the_racer', label: 'Judy', modelPath: '/models/stk/karts/sara_the_racer/kart.glb', scale: 2.2 },
  sara_the_wizard: { id: 'sara_the_wizard', label: 'Stephen', modelPath: '/models/stk/karts/sara_the_wizard/kart.glb', scale: 2.2 },
  suzanne: { id: 'suzanne', label: 'Gianna', modelPath: '/models/stk/karts/suzanne/kart.glb', scale: 2.2 },
  tux: { id: 'tux', label: 'Anthony', modelPath: '/models/stk/karts/tux/kart.glb', scale: 2.2 },
  wilber: { id: 'wilber', label: 'Zane', modelPath: '/models/stk/karts/wilber/kart.glb', scale: 2.2 },
  xue: { id: 'xue', label: 'Carrie', modelPath: '/models/stk/karts/xue/kart.glb', scale: 2.2 },
  beagle_2: { id: 'beagle_2', label: 'Beagle', modelPath: '/models/stk/karts/beagle_2/kart.glb', scale: 2.2 },
};

export function resolveGameMode(modeId) {
  return GAME_MODES[modeId] || GAME_MODES.race;
}

export function resolveWeaponSet(weaponSetId) {
  const fallback = WEAPON_SETS.classic;
  return WEAPON_SETS[weaponSetId] || fallback;
}

export function resolveTrackAsset(trackId = 'glo_circuit') {
  if (ALL_TRACKS[trackId]) {
    return ALL_TRACKS[trackId];
  }
  return ALL_TRACKS.glo_circuit || ALL_TRACKS.test_box;
}

export function resolveKartAsset(kartId = 'default') {
  if (ALL_KARTS[kartId]) {
    return ALL_KARTS[kartId];
  }
  if (kartId.startsWith('import:')) {
    const importedId = kartId.slice(7);
    return {
      id: importedId,
      modelPath: `/models/stk/karts/${importedId}/kart.glb`,
      scale: 1,
    };
  }
  return ALL_KARTS.default;
}

export function getVerifiedRaceTracks() {
  return VERIFIED_RACE_TRACK_IDS
    .map((id) => ALL_TRACKS[id])
    .filter(Boolean);
}

export function resolvePlayableRaceTrack(trackId = 'glo_circuit') {
  if (VERIFIED_RACE_TRACK_IDS.includes(trackId) && ALL_TRACKS[trackId]) {
    return trackId;
  }
  return 'glo_circuit';
}

export function resolveSinglePlayerCup(cupId = 'starter') {
  return SINGLE_PLAYER_CUPS[cupId] || SINGLE_PLAYER_CUPS.starter;
}

export function resolveSinglePlayerRaceMode(modeId = 'quick_race') {
  return SINGLE_PLAYER_RACE_MODES[modeId] || SINGLE_PLAYER_RACE_MODES.quick_race;
}

export function resolveTimeAttackTargets(trackId = 'glo_circuit') {
  return TIME_ATTACK_TARGETS[trackId] || TIME_ATTACK_TARGETS.glo_circuit;
}

export function getSinglePlayerCupsInOrder() {
  return ['starter']
    .map((cupId) => SINGLE_PLAYER_CUPS[cupId])
    .filter(Boolean);
}

export function isCupUnlocked(cupId, progressState = {}) {
  const cup = resolveSinglePlayerCup(cupId);
  if (!cup.unlockByCup) return true;
  const unlockSource = progressState?.cups?.[cup.unlockByCup];
  return !!unlockSource?.completed;
}

/**
 * Validate that all asset references in the content registry are well-formed.
 * Returns { valid: boolean, errors: string[] }.
 */
export function validateAssetAvailability() {
  const errors = [];

  // Validate kart entries have required fields
  for (const [id, kart] of Object.entries(ALL_KARTS)) {
    if (!kart.modelPath) errors.push(`Kart '${id}' missing modelPath`);
    if (typeof kart.scale !== 'number') errors.push(`Kart '${id}' missing numeric scale`);
  }

  // Validate track entries have required fields
  for (const [id, track] of Object.entries(ALL_TRACKS)) {
    if (!track.type) errors.push(`Track '${id}' missing type`);
    if (!track.startPositions?.length) errors.push(`Track '${id}' missing startPositions`);
  }

  // Validate arena entries have required fields
  for (const [id, arena] of Object.entries(ALL_ARENAS)) {
    if (!arena.type) errors.push(`Arena '${id}' missing type`);
    if (!arena.startPositions?.length) errors.push(`Arena '${id}' missing startPositions`);
  }

  // Validate cup tracks exist in ALL_TRACKS
  for (const [cupId, cup] of Object.entries(SINGLE_PLAYER_CUPS)) {
    for (const trackId of cup.trackIds) {
      if (!ALL_TRACKS[trackId]) errors.push(`Cup '${cupId}' references unknown track '${trackId}'`);
    }
  }

  // Validate VERIFIED_RACE_TRACK_IDS reference existing tracks
  for (const id of VERIFIED_RACE_TRACK_IDS) {
    if (!ALL_TRACKS[id]) errors.push(`VERIFIED_RACE_TRACK_IDS contains unknown track '${id}'`);
  }

  return { valid: errors.length === 0, errors };
}

export function resolveArenaAsset(arenaId = 'glo_arena') {
  if (ALL_ARENAS[arenaId]) {
    return ALL_ARENAS[arenaId];
  }
  return ALL_ARENAS.glo_arena;
}


