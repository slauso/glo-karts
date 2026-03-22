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

export const CUSTOM_TRACK_ID = 'custom_import';

export const SINGLE_PLAYER_RACE_MODES = {
  
  time_trial: { id: 'time_trial', label: 'Rally' },
  grand_prix: { id: 'grand_prix', label: 'Glo Prix' },
};

// ── Single-player cups — Procedural demo course only ───────────────
export const SINGLE_PLAYER_CUPS = {
  starter: {
    id: 'starter',
    label: 'Glo Cup',
    description: 'Race the verified procedural Test Box course.',
    icon: '🏁',
    theme: 'All Levels',
    trackIds: ['test_box', 'test_box', 'test_box', 'test_box'],
    unlockByCup: null,
  },
};

export const VERIFIED_RACE_TRACK_IDS = [
  'test_box',
];

export const TIME_ATTACK_TARGETS = {
  test_box: { id: 'test_box', label: 'Test Box', trackPath: null, scale: 1, startPositions: [{x: 0, y: 2, z: 0}] },
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
  const entry = {
    id,
    label: info.name || id,
    type: info.type,
    scale: info.scale || 1,
    startPositions: [{ x: start.x, y: start.y, z: start.z }],
  };
  if (info.arenaPath) entry.arenaPath = info.arenaPath;
  if (info.trackPath) entry.trackPath = info.trackPath;
  if (info.kartScale) entry.kartScale = info.kartScale;
  return { ...entry, ...overrides };
}

const _arenaOverrides = {
  glo_arena: {
    startPositions: [
      { x: 54.568, y: 5.123, z: 5.124, heading: 3.1416 },
      { x: 47.143, y: 5.123, z: 32.834, heading: 3.6652 },
      { x: 26.859, y: 5.123, z: 53.119, heading: 4.1888 },
      { x: -0.851, y: 5.123, z: 60.544, heading: 4.7124 },
      { x: -28.561, y: 5.123, z: 53.119, heading: 5.236 },
      { x: -48.846, y: 5.123, z: 32.834, heading: 5.7596 },
      { x: -56.271, y: 5.123, z: 5.124, heading: 6.2832 },
      { x: -48.846, y: 5.123, z: -22.586, heading: 6.8068 },
      { x: -28.561, y: 5.123, z: -42.87, heading: 7.3304 },
      { x: -0.851, y: 5.123, z: -50.295, heading: 7.854 },
      { x: 26.859, y: 5.123, z: -42.87, heading: 8.3776 },
      { x: 47.143, y: 5.123, z: -22.586, heading: 8.9012 },
    ],
  },

};

const _trackOverrides = {
  test_box: { startPositions: [
    {x: 20, y: 1, z: 0}, {x: -20, y: 1, z: 0}, {x: 0, y: 1, z: 20}, {x: 0, y: 1, z: -20},
    {x: 14, y: 1, z: 14}, {x: -14, y: 1, z: -14}, {x: 14, y: 1, z: -14}, {x: -14, y: 1, z: 14},
    {x: 0, y: 1, z: 0}, {x: 10, y: 1, z: -10}, {x: -10, y: 1, z: 10}, {x: -10, y: 1, z: -10},
  ] },
};

export const ALL_TRACKS = {};
export const ALL_ARENAS = {};

for (const [id, info] of Object.entries(_registry)) {
  const isArena = info.type === 'procedural-arena' || info.type === 'stk-arena';
  if (isArena) {
    ALL_ARENAS[id] = _toContentEntry(id, info, _arenaOverrides[id]);
  } else {
    ALL_TRACKS[id] = _toContentEntry(id, info, _trackOverrides[id]);
  }
}

ALL_TRACKS[CUSTOM_TRACK_ID] = {
  id: CUSTOM_TRACK_ID,
  label: 'Imported Track',
  type: 'custom',
  scale: 1,
  startPositions: [{ x: 0, y: 2, z: 0 }],
};

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

// ── Weight classes (21.36) ──────────────────────────────────────────────────
// light = nimble (higher steer, lower mass), medium = balanced, heavy = tanky (lower steer, higher mass/health)
export const KART_WEIGHT_CLASSES = {
  default: 'medium',
  adiumy: 'light', amanda: 'medium', beastie: 'heavy', emule: 'medium',
  gavroche: 'light', gnu: 'heavy', hexley: 'medium', kiki: 'light',
  konqi: 'heavy', nolok: 'heavy', pidgin: 'light', puffy: 'medium',
  sara_the_racer: 'light', sara_the_wizard: 'medium', suzanne: 'medium',
  tux: 'medium', wilber: 'heavy', xue: 'light', beagle_2: 'medium',
};

export const WEIGHT_CLASS_STATS = {
  light:  { speedMul: 1.05, steerMul: 1.2, healthMul: 0.85, massMul: 0.8 },
  medium: { speedMul: 1.00, steerMul: 1.0, healthMul: 1.00, massMul: 1.0 },
  heavy:  { speedMul: 0.92, steerMul: 0.8, healthMul: 1.20, massMul: 1.3 },
};

export function getWeightClass(kartId) {
  return KART_WEIGHT_CLASSES[kartId] || 'medium';
}

export function getWeightStats(kartId) {
  return WEIGHT_CLASS_STATS[getWeightClass(kartId)];
}

export function resolveGameMode(modeId) {
  return GAME_MODES[modeId] || GAME_MODES.race;
}

export function resolveWeaponSet(weaponSetId) {
  const fallback = WEAPON_SETS.classic;
  return WEAPON_SETS[weaponSetId] || fallback;
}

export function resolveTrackAsset(trackId = 'test_box') {
  if (ALL_TRACKS[trackId]) {
    return ALL_TRACKS[trackId];
  }
  return ALL_TRACKS.test_box;
}

export function isCustomTrackId(trackId) {
  return trackId === CUSTOM_TRACK_ID;
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

export function resolvePlayableRaceTrack(trackId = 'test_box') {
  if (trackId && ALL_TRACKS[trackId]) {
    return trackId;
  }
  return 'test_box';
}

export function resolveSinglePlayerCup(cupId = 'starter') {
  return SINGLE_PLAYER_CUPS[cupId] || SINGLE_PLAYER_CUPS.starter;
}

export function resolveSinglePlayerRaceMode(modeId = 'time_trial') {
  return SINGLE_PLAYER_RACE_MODES[modeId] || SINGLE_PLAYER_RACE_MODES.time_trial;
}

export function resolveTimeAttackTargets(trackId = 'test_box') {
  return TIME_ATTACK_TARGETS[trackId] || TIME_ATTACK_TARGETS.test_box;
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


