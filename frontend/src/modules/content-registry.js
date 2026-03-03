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
    label: 'Starter Cup',
    description: 'Learn the flow with balanced tracks and forgiving pacing.',
    icon: '🏁',
    theme: 'Crimson Circuit',
    trackIds: ['map1', 'map2'],
    unlockByCup: null,
  },
  sunset: {
    id: 'sunset',
    label: 'Sunset Cup',
    description: 'Faster sequencing with tighter transitions and pressure laps.',
    icon: '🌇',
    theme: 'Amber Rush',
    trackIds: ['map2', 'map1', 'map2'],
    unlockByCup: 'starter',
  },
  midnight: {
    id: 'midnight',
    label: 'Midnight Cup',
    description: 'Endurance finale with long-form consistency challenges.',
    icon: '🌌',
    theme: 'Neon Nightfall',
    trackIds: ['map1', 'map2', 'map1', 'map2'],
    unlockByCup: 'sunset',
  },
};

export const VERIFIED_RACE_TRACK_IDS = ['map1', 'map2'];

export const TIME_ATTACK_TARGETS = {
  map1: { id: 'map1', label: 'Amalfi Coast', trackPath: '/models/maps/map1/track.glb', scale: 8, startPositions: [{x: 0, y: 1, z: 0}, {x: 5, y: 1, z: 2}, {x: -5, y: 1, z: 2}, {x: 0, y: 1, z: 5}] },
  map2: { id: 'map2', label: 'Desert Dunes', trackPath: '/models/maps/map2/track.glb', scale: 8, startPositions: [{x: 0, y: 1, z: 0}, {x: 5, y: 1, z: 0}] },
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
  map1: { id: 'map1', label: 'Amalfi Coast', trackPath: '/models/maps/map1/track.glb', scale: 8, startPositions: [{x: 0, y: 1, z: 0}, {x: 5, y: 1, z: 2}, {x: -5, y: 1, z: 2}, {x: 0, y: 1, z: 5}] },
  map2: { id: 'map2', label: 'Desert Dunes', trackPath: '/models/maps/map2/track.glb', scale: 8, startPositions: [{x: 0, y: 1, z: 0}, {x: 5, y: 1, z: 0}] },
  abyss: { id: 'abyss', label: 'Abyss', trackPath: '/models/stk/tracks/abyss/track.glb', scale: 1, startPositions: [{x: -36.26, y: 6.94, z: -5.73}, {x: -40, y: 7, z: -5}] },
  black_forest: { id: 'black_forest', label: 'Black Forest', trackPath: '/models/stk/tracks/black_forest/track.glb', scale: 1, startPositions: [{x: 238.16, y: 0.17, z: -250.70}, {x: 242, y: 0.2, z: -250}] },
  cocoa_temple: { id: 'cocoa_temple', label: 'Cocoa Temple', trackPath: '/models/stk/tracks/cocoa_temple/track.glb', scale: 1, startPositions: [{x: -188.58, y: 13.91, z: 279.79}, {x: -184, y: 14, z: 275}] },
  cornfield_crossing: { id: 'cornfield_crossing', label: 'Cornfield Xing', trackPath: '/models/stk/tracks/cornfield_crossing/track.glb', scale: 1, startPositions: [{x: 9.38, y: 4.88, z: 71.93}, {x: 13, y: 5, z: 75}] },
  gran_paradiso_island: { id: 'gran_paradiso_island', label: 'Gran Paradiso Island', trackPath: '/models/stk/tracks/gran_paradiso_island/track.glb', scale: 1 },
  hacienda: { id: 'hacienda', label: 'Hacienda', trackPath: '/models/stk/tracks/hacienda/track.glb', scale: 1 },
  lighthouse: { id: 'lighthouse', label: 'Lighthouse', trackPath: '/models/stk/tracks/lighthouse/track.glb', scale: 1 },
  mines: { id: 'mines', label: 'Mines', trackPath: '/models/stk/tracks/mines/track.glb', scale: 1 },
  minigolf: { id: 'minigolf', label: 'Minigolf', trackPath: '/models/stk/tracks/minigolf/track.glb', scale: 1 },
  oasis: { id: 'oasis', label: 'Oasis', trackPath: '/models/stk/tracks/oasis/track.glb', scale: 1 },
  olivermath: { id: 'olivermath', label: 'Oliver Math', trackPath: '/models/stk/tracks/olivermath/track.glb', scale: 1 },
  ravenbridge_mansion: { id: 'ravenbridge_mansion', label: 'Ravenbridge Mansion', trackPath: '/models/stk/tracks/ravenbridge_mansion/track.glb', scale: 1 },
  sandtrack: { id: 'sandtrack', label: 'Sandtrack', trackPath: '/models/stk/tracks/sandtrack/track.glb', scale: 1 },
  snowmountain: { id: 'snowmountain', label: 'Snowmountain', trackPath: '/models/stk/tracks/snowmountain/track.glb', scale: 1 },
  snowtuxpeak: { id: 'snowtuxpeak', label: 'Snowtuxpeak', trackPath: '/models/stk/tracks/snowtuxpeak/track.glb', scale: 1 },
  volcano_island: { id: 'volcano_island', label: 'Volcano Island', arenaPath: '/models/stk/arenas/volcano_island/arena.glb', scale: 1, startPositions: [{x: -54.78, y: -0.4, z: 4.6}, {x: -60, y: 0, z: 10}] },
  xr591: { id: 'xr591', label: 'XR591', trackPath: '/models/stk/tracks/xr591/track.glb', scale: 1 },
  zengarden: { id: 'zengarden', label: 'Zen Garden', trackPath: '/models/stk/tracks/zengarden/track.glb', scale: 1, startPositions: [{x: 104.53, y: 12.30, z: -43.20}, {x: 108, y: 12.5, z: -45}] },
};

export const ALL_ARENAS = {
  box: { id: 'box', label: 'Box Arena', type: 'procedural' },
  cross: { id: 'cross', label: 'Cross Arena', type: 'procedural' },
  alien_signal: { id: 'alien_signal', label: 'Alien Signal', type: 'gltf', arenaPath: '/models/stk/arenas/alien_signal/arena.glb', scale: 1 },
  ancient_colosseum_labyrinth: { id: 'ancient_colosseum_labyrinth', label: 'Ancient Colosseum Labyrinth', type: 'gltf', arenaPath: '/models/stk/arenas/ancient_colosseum_labyrinth/arena.glb', scale: 1 },
  arena_candela_city: { id: 'arena_candela_city', label: 'Candela City', type: 'gltf', arenaPath: '/models/stk/arenas/arena_candela_city/arena.glb', scale: 1 },
  battleisland: { id: 'battleisland', label: 'Battle Island', arenaPath: '/models/stk/arenas/battleisland/arena.glb', scale: 1, startPositions: [{x: -7, y: 0.1, z: -10}, {x: 7, y: 0.1, z: 10}] },
  cave: { id: 'cave', label: 'Cave', type: 'gltf', arenaPath: '/models/stk/arenas/cave/arena.glb', scale: 1 },
  lasdunasarena: { id: 'lasdunasarena', label: 'Las Dunas Arena', type: 'gltf', arenaPath: '/models/stk/arenas/lasdunasarena/arena.glb', scale: 1 },
  pumpkin_park: { id: 'pumpkin_park', label: 'Pumpkin Park', type: 'gltf', arenaPath: '/models/stk/arenas/pumpkin_park/arena.glb', scale: 1 },
  stadium: { id: 'stadium', label: 'Stadium', type: 'gltf', arenaPath: '/models/stk/arenas/stadium/arena.glb', scale: 1 },
  temple: { id: 'temple', label: 'Temple', type: 'gltf', arenaPath: '/models/stk/arenas/temple/arena.glb', scale: 1 },
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

export function resolveTrackAsset(trackId = 'map1') {
  if (ALL_TRACKS[trackId]) {
    return ALL_TRACKS[trackId];
  }

  if (trackId.startsWith('import:')) {
    const importedId = trackId.slice(7);
    return {
      id: importedId,
      trackPath: `/models/stk/tracks/${importedId}/track.glb`,
      decorationsPath: `/models/stk/tracks/${importedId}/decorations.glb`,
      scale: 1,
    };
  }

  return ALL_TRACKS.map1;
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

export function resolveArenaAsset(arenaId = 'box') {
  if (ALL_ARENAS[arenaId]) {
    return ALL_ARENAS[arenaId];
  }

  if (arenaId.startsWith('import:')) {
    const importedId = arenaId.slice(7);
    return {
      id: importedId,
      type: 'gltf',
      arenaPath: `/models/stk/arenas/${importedId}/arena.glb`,
      scale: 1,
    };
  }

  return ALL_ARENAS.box;
}


