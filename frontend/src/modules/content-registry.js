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

export const SINGLE_PLAYER_RACE_MODES = {
  quick_race: { id: 'quick_race', label: 'Quick Race' },
  time_attack: { id: 'time_attack', label: 'Time Attack' },
  grand_prix: { id: 'grand_prix', label: 'Grand Prix' },
};

export const SINGLE_PLAYER_CUPS = {
  starter: {
    id: 'starter',
    label: 'Test Cup',
    description: 'Debug cup with the test box track.',
    icon: '🧪',
    theme: 'Debug',
    trackIds: ['test_box'],
    unlockByCup: null,
  },
};

export const VERIFIED_RACE_TRACK_IDS = ['test_box'];

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

export const ALL_TRACKS = {
  test_box: { id: 'test_box', label: 'Test Box', trackPath: null, scale: 1, type: 'procedural', startPositions: [{x: 0, y: 2, z: 0}, {x: 5, y: 2, z: 5}, {x: -5, y: 2, z: -5}, {x: 5, y: 2, z: -5}] },
};

export const ALL_ARENAS = {
  test_box: { id: 'test_box', label: 'Test Box', type: 'procedural', startPositions: [{x: 0, y: 2, z: 0}, {x: 10, y: 2, z: 10}, {x: -10, y: 2, z: -10}, {x: 10, y: 2, z: -10}] },
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
};

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

export function resolvePlayableRaceTrack(trackId = 'map1') {
  if (VERIFIED_RACE_TRACK_IDS.includes(trackId) && ALL_TRACKS[trackId]) {
    return trackId;
  }
  return 'map1';
}

export function resolveSinglePlayerCup(cupId = 'starter') {
  return SINGLE_PLAYER_CUPS[cupId] || SINGLE_PLAYER_CUPS.starter;
}

export function resolveSinglePlayerRaceMode(modeId = 'quick_race') {
  return SINGLE_PLAYER_RACE_MODES[modeId] || SINGLE_PLAYER_RACE_MODES.quick_race;
}

export function resolveTimeAttackTargets(trackId = 'map1') {
  return TIME_ATTACK_TARGETS[trackId] || TIME_ATTACK_TARGETS.map1;
}

export function getSinglePlayerCupsInOrder() {
  return ['starter', 'sunset', 'midnight']
    .map((cupId) => SINGLE_PLAYER_CUPS[cupId])
    .filter(Boolean);
}

export function isCupUnlocked(cupId, progressState = {}) {
  const cup = resolveSinglePlayerCup(cupId);
  if (!cup.unlockByCup) return true;
  const unlockSource = progressState?.cups?.[cup.unlockByCup];
  return !!unlockSource?.completed;
}

export function resolveArenaAsset(arenaId = 'test_box') {
  if (ALL_ARENAS[arenaId]) {
    return ALL_ARENAS[arenaId];
  }
  return ALL_ARENAS.test_box;
}


