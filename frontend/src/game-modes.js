export const MODE_STATUS = {
  READY: 'ready',
  BETA: 'beta',
  PLANNED: 'planned',
  HIDDEN: 'hidden',
};

export const CATEGORIES = {
  online: {
    id: 'online',
    label: 'ONLINE',
    desc: 'Multiplayer battle lobbies running on the realtime shell.',
    icon: 'fa-globe',
  },
  tools: {
    id: 'tools',
    label: 'BUILD',
    desc: 'Track-building utilities kept outside the main multiplayer shell.',
    icon: 'fa-wrench',
  },
  shop: {
    id: 'shop',
    label: 'SHOP',
    desc: 'Marketplace tooling and content management.',
    icon: 'fa-store',
  },
  gloflux: {
    id: 'gloflux',
    label: 'GLOFLUX',
    desc: 'Experimental multiplayer variants built on the realtime stack.',
    icon: 'fa-radiation',
  },
};

export const MODE_REGISTRY = {
  create_party: {
    id: 'create_party',
    category: 'online',
    label: 'Create Party',
    desc: 'Create a private multiplayer lobby and invite friends.',
    icon: 'fa-users',
    page: 'index.html',
    status: MODE_STATUS.HIDDEN,
    selectors: { track: false, arena: false, battleSettings: false },
    requiresLobby: false,
    buildConfig() {
      return {};
    },
  },

  battle_online: {
    id: 'battle_online',
    category: 'online',
    label: 'Online',
    desc: 'Create or join a realtime arena battle with friends.',
    icon: 'fa-crosshairs',
    page: 'realtime.html',
    status: MODE_STATUS.READY,
    selectors: { track: false, arena: true, battleSettings: true },
    requiresLobby: true,
    legacyFamily: 'battle',
    roomName: 'battle_room',
    buildConfig(lobby) {
      return {
        gameMode: 'battle',
        trackId: lobby.selectedMap,
        arenaId: lobby.selectedMap,
        battleType: lobby.selectedBattleType || 'deathmatch',
        multiplayer: true,
        multiplayerProvider: 'colyseus',
        maxPlayers: lobby.selectedMaxPlayers || 12,
        loadoutId: lobby.selectedLoadout || 'random-all',
        collisionDamage: !!document.getElementById('battle-collision-damage')?.checked,
        scoreLimit: parseInt(document.getElementById('battle-score-limit')?.value || '5', 10) || 5,
      };
    },
  },

  track_builder: {
    id: 'track_builder',
    category: 'tools',
    label: 'Track Studio',
    desc: 'Build custom tracks and playtest them instantly.',
    icon: 'fa-cubes',
    page: 'editor.html',
    status: MODE_STATUS.BETA,
    selectors: { track: false, arena: false, battleSettings: false },
    requiresLobby: false,
    buildConfig() {
      return { gameMode: 'builder' };
    },
  },

  marketplace: {
    id: 'marketplace',
    category: 'shop',
    label: 'Addon Marketplace',
    desc: 'Browse and manage add-on content.',
    icon: 'fa-shopping-cart',
    page: 'marketplace.html',
    status: MODE_STATUS.HIDDEN,
    selectors: { track: false, arena: false, battleSettings: false },
    requiresLobby: false,
    buildConfig() {
      return { gameMode: 'marketplace' };
    },
  },

  gloflux_race: {
    id: 'gloflux_race',
    category: 'gloflux',
    label: 'GLOFLUX',
    desc: 'Experimental multiplayer variant on the realtime shell.',
    icon: 'fa-radiation',
    page: 'gloflux.html',
    status: MODE_STATUS.HIDDEN,
    requiresLobby: true,
    legacyFamily: 'gloflux',
    roomName: 'gloflux',
    selectors: { track: false, arena: false, battleSettings: false },
    buildConfig(lobby) {
      return {
        gameMode: 'gloflux',
        subMode: 'gloflux_race',
        variant: 'race',
        arenaTheme: lobby?.arenaTheme || 'nuclear_desert',
        maxPlayers: lobby?.selectedMaxPlayers || 8,
        multiplayer: true,
        multiplayerProvider: 'colyseus',
        selectedKart: sessionStorage.getItem('selectedKart') || 'amanda',
      };
    },
  },

  gloflux_arena: {
    id: 'gloflux_arena',
    category: 'gloflux',
    label: 'Flux Arena',
    desc: 'Experimental multiplayer arena variant on the realtime shell.',
    icon: 'fa-radiation',
    page: 'gloflux.html',
    status: MODE_STATUS.HIDDEN,
    requiresLobby: true,
    legacyFamily: 'gloflux',
    roomName: 'gloflux',
    selectors: { track: false, arena: false, battleSettings: false },
    buildConfig(lobby) {
      return {
        gameMode: 'gloflux',
        subMode: 'gloflux_arena',
        variant: 'arena',
        arenaTheme: lobby?.arenaTheme || 'nuclear_desert',
        maxPlayers: lobby?.selectedMaxPlayers || 8,
        multiplayer: true,
        multiplayerProvider: 'colyseus',
        selectedKart: sessionStorage.getItem('selectedKart') || 'amanda',
      };
    },
  },

  // Phase 1.2: Registered to mirror the realtime server's defaultModeId('race')
  // path (see realtime/src/rooms/LobbyRoom.js). Hidden in the UI; addressable
  // via getMode('race_online') for room-name resolution.
  race_online: {
    id: 'race_online',
    category: 'online',
    label: 'Race Online',
    desc: 'Realtime kart race on a shared track.',
    icon: 'fa-flag-checkered',
    page: 'realtime.html',
    status: MODE_STATUS.HIDDEN,
    selectors: { track: true, arena: false, battleSettings: false },
    requiresLobby: true,
    legacyFamily: 'race',
    roomName: 'race_room',
    buildConfig(lobby) {
      return {
        gameMode: 'race',
        trackId: lobby?.selectedMap,
        multiplayer: true,
        multiplayerProvider: 'colyseus',
        maxPlayers: lobby?.selectedMaxPlayers || 8,
      };
    },
  },

  // Phase 2: Editor3-driven online race. Uses the cannon-es server room
  // (Editor3RaceRoom) and the Track Studio's segment renderer end-to-end.
  // Hidden from the lobby grid for now — addressable via launch URL or
  // the Track Studio "Play Online" button (wired in a follow-up).
  race_editor3: {
    id: 'race_editor3',
    category: 'online',
    label: 'Race Online (editor3)',
    desc: 'Online race driven by the Track Studio engine end-to-end.',
    icon: 'fa-flag-checkered',
    page: 'multiplayer-editor3.html',
    status: MODE_STATUS.BETA,
    selectors: { track: true, arena: false, battleSettings: false },
    requiresLobby: true,
    legacyFamily: 'race',
    roomName: 'editor3_race_room',
    buildConfig(lobby) {
      return {
        gameMode: 'race',
        trackId: lobby?.selectedMap,
        multiplayer: true,
        multiplayerProvider: 'colyseus',
        maxPlayers: lobby?.selectedMaxPlayers || 8,
      };
    },
  },
};

const VISIBLE_MODE_IDS = ['battle_online', 'race_editor3', 'track_builder'];

export function getVisibleModes() {
  return VISIBLE_MODE_IDS.map((id) => MODE_REGISTRY[id]).filter(Boolean);
}

export function getMode(modeId) {
  return MODE_REGISTRY[modeId] || null;
}

export function getModesInCategory(categoryId, { includeStatuses } = {}) {
  const allowed = includeStatuses
    ? new Set(includeStatuses)
    : new Set([MODE_STATUS.READY, MODE_STATUS.BETA, MODE_STATUS.PLANNED]);
  return Object.values(MODE_REGISTRY).filter(
    (mode) => mode.category === categoryId && allowed.has(mode.status),
  );
}

export function getCategoryTree(opts) {
  return Object.values(CATEGORIES).map((category) => ({
    ...category,
    modes: getModesInCategory(category.id, opts),
  }));
}

export function getPageForMode(modeId) {
  return MODE_REGISTRY[modeId]?.page || 'index.html';
}

export function requiresLobby(modeId) {
  return !!MODE_REGISTRY[modeId]?.requiresLobby;
}

export function isPlayable(modeId) {
  const mode = MODE_REGISTRY[modeId];
  return !!mode && (mode.status === MODE_STATUS.READY || mode.status === MODE_STATUS.BETA);
}

// Phase 1.2: Canonical legacy-family + room-name resolvers. Prefer these over
// hardcoded `gameMode === 'battle'` / `'race_room'` string comparisons.
//
// The fallback branches mirror the legacy single-player-routing.js heuristics
// for mode IDs that have NOT been registered (e.g. battle_solo, quick_race);
// once those modes get formal MODE_REGISTRY entries, the fallback can be
// dropped.
const LEGACY_GLOFLUX_IDS = new Set(['gloflux_race', 'gloflux_arena']);
const LEGACY_BATTLE_FALLBACK_IDS = new Set([
  'battle', 'battle_solo', 'soccer', 'local_2p_battle', 'battle_online',
]);

export function getLegacyModeFamily(modeId) {
  const mode = MODE_REGISTRY[modeId];
  if (mode?.legacyFamily) return mode.legacyFamily;
  if (LEGACY_GLOFLUX_IDS.has(modeId)) return 'gloflux';
  if (LEGACY_BATTLE_FALLBACK_IDS.has(modeId)) return 'battle';
  return 'race';
}

export function getRoomNameForMode(modeId) {
  const mode = MODE_REGISTRY[modeId];
  if (mode?.roomName) return mode.roomName;
  const family = getLegacyModeFamily(modeId);
  if (family === 'gloflux') return 'gloflux';
  if (family === 'battle') return 'battle_room';
  return 'race_room';
}
