/**
 * game-modes.js — Centralised game-mode registry & page-routing
 *
 * Every playable mode lives here so the lobby, pages, and future
 * features all share one source of truth.
 *
 * ── Taxonomy ──────────────────────────────────────────────────
 *  Category   │ Mode              │ Page           │ Status
 * ────────────┼───────────────────┼────────────────┼──────────
 *  solo       │ quick_race        │ game.html      │ ready
 *  solo       │ time_trial        │ game.html      │ ready
 *  solo       │ grand_prix        │ game.html      │ ready
 *  online     │ race_online       │ realtime.html  │ ready
 *  online     │ battle_online     │ realtime.html  │ ready
 *  local      │ local_2p_race     │ splitscreen.html│ beta
 *  local      │ local_2p_battle   │ splitscreen.html│ beta
 *  tools      │ track_builder     │ builder.html   │ ready
 *  shop       │ marketplace       │ marketplace.html│ beta
 *  gloflux    │ gloflux_race      │ gloflux.html   │ beta
 *  gloflux    │ gloflux_arena     │ gloflux.html   │ beta
 * ────────────┴───────────────────┴────────────────┴──────────
 *
 * Adding a new mode:
 *   1. Add an entry to MODE_REGISTRY below.
 *   2. If it needs a new .html page, create the page and add it
 *      to vite.config.js `rollupOptions.input`.
 *   3. The lobby UI auto-renders from this registry — no other
 *      file changes needed.
 */

import { buildResolvedModeConfig, resolveModePage } from './modules/single-player-routing.js';

// ── Status enum ────────────────────────────────────────────────
export const MODE_STATUS = {
  READY:   'ready',    // fully playable
  BETA:    'beta',     // functional but rough
  PLANNED: 'planned',  // shows in UI as "coming soon"
  HIDDEN:  'hidden',   // dev-only, not shown in UI
};

// ── Category definitions ───────────────────────────────────────
export const CATEGORIES = {
  solo: {
    id:    'solo',
    label: 'SOLO',
    desc:  'Play offline against bots or beat your own records.',
    icon:  'fa-user',
  },
  online: {
    id:    'online',
    label: 'ONLINE',
    desc:  'Race or battle with friends in real-time lobbies.',
    icon:  'fa-globe',
  },
  tools: {
    id:    'tools',
    label: 'BUILD',
    desc:  'Build and share custom tracks.',
    icon:  'fa-wrench',
  },
  local: {
    id:    'local',
    label: 'Split Screen',
    desc:  'Splitscreen multiplayer on one device.',
    icon:  'fa-users',
  },
  shop: {
    id:    'shop',
    label: 'SHOP',
    desc:  'Browse and purchase add-ons with GLOs tokens.',
    icon:  'fa-store',
  },
  gloflux: {
    id:    'gloflux',
    label: 'gloFLUX',
    desc:  'Symbiotic kart warfare in a post-nuclear wasteland.',
    icon:  'fa-radiation',
  },
};

// ── Mode registry ──────────────────────────────────────────────
export const MODE_REGISTRY = {

  /* ── Solo modes ───────────────────────────────────────────── */

  grand_prix: {
    id:       'grand_prix',
    category: 'solo',
    label:    'Glo Prix',
    desc:     'Compete in a series of races across curated cups.',
    icon:     'fa-trophy',
    page:     'game.html',
    status:   MODE_STATUS.HIDDEN,
    requiresLobby: false,
    selectors: { track: false, arena: false, battleSettings: false, cup: true },
    buildConfig(lobby) {
      return {
        gameMode:             'race',
        subMode:              'grand_prix',
        singlePlayerMode:     true,
        multiplayer:          false,
        runtimeProvider:      'page-runtime',
        maxPlayers:           1,
        botCount:             0,
        cupId:                lobby.selectedCup || 'starter',
        selectedKart:         sessionStorage.getItem('selectedKart') || 'tux',
      };
    },
  },

  quick_race: {
    id:       'quick_race',
    category: 'solo',
    label:    'Quick Race',
    desc:     'Pick a track and race against AI opponents.',
    icon:     'fa-flag-checkered',
    page:     'game.html',
    status:   MODE_STATUS.READY,
    requiresLobby: false,
    // Which selectors the lobby must show for this mode
    selectors: { track: true, arena: false, battleSettings: false },
    // Fields injected into gameConfig
    buildConfig(lobby) {
      return {
        gameMode:             'race',
        subMode:              'quick_race',
        singlePlayerMode:     true,
        multiplayer:          false,
        runtimeProvider:      'page-runtime',
        maxPlayers:           1,
        botCount:             0,
        trackId:              lobby.selectedMap || 'test_box',
        selectedKart:         sessionStorage.getItem('selectedKart') || 'tux',
      };
    },
  },

  time_trial: {
    id:       'time_trial',
    category: 'solo',
    label:    'Time Trial',
    desc:     'Race alone against the clock — no items, pure speed.',
    icon:     'fa-stopwatch',
    page:     'game.html',
    status:   MODE_STATUS.HIDDEN,
    requiresLobby: false,
    selectors: { track: true, arena: false, battleSettings: false },
    buildConfig(lobby) {
      return {
        gameMode:             'race',
        subMode:              'time_trial',
        singlePlayerMode:     true,
        multiplayer:          false,
        runtimeProvider:      'page-runtime',
        maxPlayers:           1,
        botCount:             0,
        trackId:              lobby.selectedMap || 'test_box',
        noItems:              true,
        selectedKart:         sessionStorage.getItem('selectedKart') || 'tux',
      };
    },
  },

  /* ── Online modes ─────────────────────────────────────────── */


  create_party: {
    id:       'create_party',
    category: 'online',
    label:    'Create Party',
    desc:     'Create a custom multiplayer lobby and invite friends.',
    icon:     'fa-users',
    page:     'lobby.html',
    status:   MODE_STATUS.HIDDEN,
    selectors: { track: false, arena: false, battleSettings: false },
    requiresLobby: false,
    buildConfig(lobby) { return {}; },
  },

  race_online: {
    id:       'race_online',
    category: 'online',
    label:    'Online Race',
    desc:     'Create or join a lobby and race live against friends.',
    icon:     'fa-flag-checkered',
    page:     'realtime.html',
    status:   MODE_STATUS.HIDDEN,
    selectors: { track: true, arena: false, battleSettings: false },
    requiresLobby: true,
    buildConfig(lobby) {
      return {
        gameMode:   'race',
        trackId:    lobby.selectedMap,
        multiplayer: true,
        multiplayerProvider: 'colyseus',
      };
    },
  },

  battle_online: {
    id:       'battle_online',
    category: 'online',
    label:    'Online Battle',
    desc:     'Create or join a lobby for arena combat with friends.',
    icon:     'fa-crosshairs',
    page:     'realtime.html',
    status:   MODE_STATUS.READY,
    selectors: { track: false, arena: true, battleSettings: true },
    requiresLobby: true,
    buildConfig(lobby) {
      return {
        gameMode:    'battle',
        trackId:     lobby.selectedMap,
        arenaId:     lobby.selectedMap,
        battleType:  lobby.selectedBattleType || 'deathmatch',
        multiplayer: true,
        multiplayerProvider: 'colyseus',
        maxPlayers:  lobby.selectedMaxPlayers || 12,
        loadoutId:   lobby.selectedLoadout   || 'random-all',
        collisionDamage: !!document.getElementById('battle-collision-damage')?.checked,
        scoreLimit:  parseInt(document.getElementById('battle-score-limit')?.value || '5', 10) || 5,
      };
    },
  },

  /* ── Tools ────────────────────────────────────────────── */

  track_builder: {
    id:       'track_builder',
    category: 'tools',
    label:    'Track Builder',
    desc:     'Build custom tracks and share them with friends.',
    icon:     'fa-road',
    page:     'builder.html',
    status:   MODE_STATUS.HIDDEN,
    selectors: { track: false, arena: false, battleSettings: false },
    buildConfig() {
      return { gameMode: 'builder' };
    },
  },

  /* ── Local splitscreen ────────────────────────────────── */


  track_builder: {
    id:       'track_builder',
    category: 'tools',
    label:    'Track Builder',
    desc:     'Build custom tracks and share them with friends.',
    icon:     'fa-wrench',
    page:     'builder.html',
    status:   MODE_STATUS.HIDDEN,
    selectors: { track: false, arena: false, battleSettings: false },
    requiresLobby: false,
    buildConfig(lobby) { return {}; },
  },

  local_2p_race: {
    id:       'local_2p_race',
    category: 'local',
    label:    'Split Screen',
    icon:     'fa-columns',
    page:     'splitscreen.html',
    status:   MODE_STATUS.READY,
    selectors: { track: true, arena: false, battleSettings: false },
    buildConfig(lobby) {
      const subType = lobby?.splitScreenType || 'race';
      return {
        gameMode:       subType === 'battle' ? 'splitscreen_battle' : 'splitscreen_race',
        trackId:        lobby.selectedMap || 'test_box',
        arenaId:        subType === 'battle' ? (lobby.selectedMap || 'test_box') : undefined,
        isSinglePlayer: false,
        p1Kart:         sessionStorage.getItem('selectedKart') || 'tux',
        p2Kart:         'nolok',
      };
    },
  },

  local_2p_battle: {
    id:       'local_2p_battle',
    category: 'local',
    label:    '2P Battle',
    desc:     'Splitscreen arena combat — WASD vs Arrow keys.',
    icon:     'fa-columns',
    page:     'splitscreen.html',
    status:   MODE_STATUS.HIDDEN,
    selectors: { track: false, arena: true, battleSettings: false },
    buildConfig(lobby) {
      return {
        gameMode:        'splitscreen_battle',
        trackId:         lobby.selectedMap || 'test_box',
        arenaId:         lobby.selectedMap || 'test_box',
        isSinglePlayer:  false,
        p1Kart:          sessionStorage.getItem('selectedKart') || 'tux',
        p2Kart:          'nolok',
      };
    },
  },

  /* ── Marketplace ──────────────────────────────────────── */

  marketplace: {
    id:       'marketplace',
    category: 'shop',
    label:    'Addon Marketplace',
    desc:     'Browse and purchase karts, tracks, skins, and effects with GLOs.',
    icon:     'fa-shopping-cart',
    page:     'marketplace.html',
    status:   MODE_STATUS.HIDDEN,
    selectors: { track: false, arena: false, battleSettings: false },
    buildConfig() {
      return { gameMode: 'marketplace' };
    },
  },

  /* ── gloFLUX — Symbiotic Wasteland Warfare ────────────── */

  gloflux_race: {
    id:       'gloflux_race',
    category: 'gloflux',
    label:    'GLOFLUX',
    icon:     'fa-radiation',
    page:     'gloflux.html',
    status:   MODE_STATUS.BETA,
    requiresLobby: true,
    selectors: { track: false, arena: false, battleSettings: false },
    buildConfig(lobby) {
      return {
        gameMode:         'gloflux',
        subMode:          'gloflux_race',
        variant:          'race',
        arenaTheme:       lobby?.arenaTheme || 'nuclear_desert',
        maxPlayers:       lobby?.selectedMaxPlayers || 8,
        singlePlayerMode: false,
        multiplayer:      true,
        multiplayerProvider: 'colyseus',
        selectedKart:     sessionStorage.getItem('selectedKart') || 'tux',
      };
    },
  },

  gloflux_arena: {
    id:       'gloflux_arena',
    category: 'gloflux',
    label:    'Flux Arena',
    desc:     'Last kart standing in a shrinking post-nuclear wasteland.',
    icon:     'fa-radiation',
    page:     'gloflux.html',
    status:   MODE_STATUS.HIDDEN,
    requiresLobby: true,
    selectors: { track: false, arena: false, battleSettings: false },
    buildConfig(lobby) {
      return {
        gameMode:         'gloflux',
        subMode:          'gloflux_arena',
        variant:          'arena',
        arenaTheme:       lobby?.arenaTheme || 'nuclear_desert',
        maxPlayers:       lobby?.selectedMaxPlayers || 8,
        singlePlayerMode: false,
        multiplayer:      true,
        multiplayerProvider: 'colyseus',
        selectedKart:     sessionStorage.getItem('selectedKart') || 'tux',
      };
    },
  },
};

// ── Public helpers ──────────────────────────────────────────────

/** The three visible modes after radical simplification. */
const VISIBLE_MODE_IDS = ['quick_race', 'battle_online', 'local_2p_race', 'gloflux_race'];

/** Flat list of the three playable modes (no categories needed). */
export function getVisibleModes() {
  return VISIBLE_MODE_IDS.map(id => MODE_REGISTRY[id]).filter(Boolean);
}

/** Get a mode entry by id. */
export function getMode(modeId) {
  return MODE_REGISTRY[modeId] || null;
}

/** All modes in a given category, optionally filtered by status. */
export function getModesInCategory(categoryId, { includeStatuses } = {}) {
  const allowed = includeStatuses
    ? new Set(includeStatuses)
    : new Set([MODE_STATUS.READY, MODE_STATUS.BETA, MODE_STATUS.PLANNED]);
  return Object.values(MODE_REGISTRY).filter(
    m => m.category === categoryId && allowed.has(m.status)
  );
}

/** Ordered list of categories with their modes pre-attached. */
export function getCategoryTree(opts) {
  return Object.values(CATEGORIES).map(cat => ({
    ...cat,
    modes: getModesInCategory(cat.id, opts),
  }));
}

/** Resolve the target page for a mode id. */
export function getPageForMode(modeId) {
  return resolveModePage(modeId);
}

/** Does this mode require creating/joining an online lobby first? */
export function requiresLobby(modeId) {
  return !!MODE_REGISTRY[modeId]?.requiresLobby;
}

/** Is this mode playable (not just "coming soon")? */
export function isPlayable(modeId) {
  const mode = MODE_REGISTRY[modeId];
  return mode && (mode.status === MODE_STATUS.READY || mode.status === MODE_STATUS.BETA);
}

/**
 * Build a full gameConfig object for a given mode.
 * `lobbyState` should expose selectedMap, selectedBattleType, etc.
 */
export function buildGameConfig(modeId, lobbyState, players = []) {
  const mode = MODE_REGISTRY[modeId];
  if (!mode) throw new Error(`Unknown game mode: ${modeId}`);

  const base = buildResolvedModeConfig(modeId, lobbyState) || mode.buildConfig(lobbyState);
  return {
    type: 'startGame',
    modeId,
    ...base,
    players: players.length ? players : [{
      id:          lobbyState.playerId || 'solo-player',
      name:        lobbyState.playerName || 'Player',
      isHost:      true,
      playerColor: sessionStorage.getItem('carColor') || 'red',
      playerKart:  sessionStorage.getItem('selectedKart') || 'tux',
    }],
  };
}
