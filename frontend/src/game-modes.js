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
    label: 'Online Battle',
    desc: 'Create or join a realtime arena battle with friends.',
    icon: 'fa-crosshairs',
    page: 'realtime.html',
    status: MODE_STATUS.READY,
    selectors: { track: false, arena: true, battleSettings: true },
    requiresLobby: true,
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

  race_online: {
    id: 'race_online',
    category: 'online',
    label: 'Online Race',
    desc: 'Lap-based realtime race lobby. Pick a built track or one of the bundled circuits.',
    icon: 'fa-flag-checkered',
    page: 'realtime.html',
    status: MODE_STATUS.READY,
    selectors: { track: true, arena: false, battleSettings: false },
    requiresLobby: true,
    buildConfig(lobby) {
      return {
        gameMode: 'race',
        trackId: lobby.selectedMap,
        multiplayer: true,
        multiplayerProvider: 'colyseus',
        maxPlayers: lobby.selectedMaxPlayers || 8,
        totalLaps: parseInt(lobby?.selectedLaps || '3', 10) || 3,
      };
    },
  },

  track_builder: {
    id: 'track_builder',
    category: 'tools',
    label: 'TinkerTracks',
    desc: 'Build custom tracks and arenas. Outputs playtest into either race or battle modes.',
    icon: 'fa-road',
    page: 'builder.html',
    status: MODE_STATUS.READY,
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
        selectedKart: sessionStorage.getItem('selectedKart') || 'tux',
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
        selectedKart: sessionStorage.getItem('selectedKart') || 'tux',
      };
    },
  },
};

const VISIBLE_MODE_IDS = ['battle_online', 'race_online', 'track_builder'];

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
