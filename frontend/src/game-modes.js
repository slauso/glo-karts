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
 *  solo       │ time_trial        │ game.html      │ planned
 *  solo       │ grand_prix        │ game.html      │ planned
 *  solo       │ free_roam         │ game.html      │ planned
 *  solo       │ battle_solo       │ battle.html    │ ready
 *  online     │ race_online       │ realtime.html  │ ready
 *  online     │ battle_online     │ realtime.html  │ ready
 * ────────────┴───────────────────┴────────────────┴──────────
 *
 * Adding a new mode:
 *   1. Add an entry to MODE_REGISTRY below.
 *   2. If it needs a new .html page, create the page and add it
 *      to vite.config.js `rollupOptions.input`.
 *   3. The lobby UI auto-renders from this registry — no other
 *      file changes needed.
 */

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
};

// ── Mode registry ──────────────────────────────────────────────
export const MODE_REGISTRY = {

  /* ── Solo modes ───────────────────────────────────────────── */

  quick_race: {
    id:       'quick_race',
    category: 'solo',
    label:    'Quick Race',
    desc:     'Pick a track and race against AI opponents.',
    icon:     'fa-flag-checkered',
    page:     'game.html',
    status:   MODE_STATUS.READY,
    // Which selectors the lobby must show for this mode
    selectors: { track: true, arena: false, battleSettings: false },
    // Fields injected into gameConfig
    buildConfig(lobby) {
      return {
        gameMode:      'race',
        trackId:       lobby.selectedMap,
        isSinglePlayer: true,
        selectedKart:  sessionStorage.getItem('selectedKart') || 'tux',
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
    status:   MODE_STATUS.PLANNED,
    selectors: { track: true, arena: false, battleSettings: false },
    buildConfig(lobby) {
      return {
        gameMode:       'race',
        subMode:        'time_trial',
        trackId:        lobby.selectedMap,
        isSinglePlayer: true,
        noItems:        true,
        selectedKart:   sessionStorage.getItem('selectedKart') || 'tux',
      };
    },
  },

  grand_prix: {
    id:       'grand_prix',
    category: 'solo',
    label:    'Grand Prix',
    desc:     'Compete in a series of races across curated cups.',
    icon:     'fa-trophy',
    page:     'game.html',
    status:   MODE_STATUS.PLANNED,
    selectors: { track: false, arena: false, battleSettings: false, cup: true },
    buildConfig(lobby) {
      return {
        gameMode:       'race',
        subMode:        'grand_prix',
        cupId:          lobby.selectedCup || 'starter',
        isSinglePlayer: true,
        selectedKart:   sessionStorage.getItem('selectedKart') || 'tux',
      };
    },
  },

  battle_solo: {
    id:       'battle_solo',
    category: 'solo',
    label:    'Battle',
    desc:     'Arena combat with bots — Deathmatch or Capture the Flag.',
    icon:     'fa-crosshairs',
    page:     'battle.html',
    status:   MODE_STATUS.READY,
    selectors: { track: false, arena: true, battleSettings: true },
    buildConfig(lobby) {
      return {
        gameMode:        'battle',
        trackId:         lobby.selectedMap,
        arenaId:         lobby.selectedMap,
        battleType:      lobby.selectedBattleType || 'deathmatch',
        isSinglePlayer:  true,
        maxPlayers:      lobby.selectedMaxPlayers || 12,
        botCount:        lobby.selectedBotCount   || 6,
        loadoutId:       lobby.selectedLoadout    || 'random-all',
        collisionDamage: !!document.getElementById('battle-collision-damage')?.checked,
        scoreLimit:      parseInt(document.getElementById('battle-score-limit')?.value || '5', 10) || 5,
        selectedKart:    sessionStorage.getItem('selectedKart') || 'tux',
      };
    },
  },

  free_roam: {
    id:       'free_roam',
    category: 'solo',
    label:    'Free Roam',
    desc:     'Explore any track with no timer and no opponents.',
    icon:     'fa-compass',
    page:     'game.html',
    status:   MODE_STATUS.PLANNED,
    selectors: { track: true, arena: false, battleSettings: false },
    buildConfig(lobby) {
      return {
        gameMode:       'race',
        subMode:        'free_roam',
        trackId:        lobby.selectedMap,
        isSinglePlayer: true,
        noItems:        true,
        noOpponents:    true,
        selectedKart:   sessionStorage.getItem('selectedKart') || 'tux',
      };
    },
  },

  /* ── Online modes ─────────────────────────────────────────── */

  race_online: {
    id:       'race_online',
    category: 'online',
    label:    'Online Race',
    desc:     'Create or join a lobby and race live against friends.',
    icon:     'fa-flag-checkered',
    page:     'realtime.html',
    status:   MODE_STATUS.READY,
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
};

// ── Public helpers ──────────────────────────────────────────────

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
  const mode = MODE_REGISTRY[modeId];
  return mode ? mode.page : 'index.html';
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

  const base = mode.buildConfig(lobbyState);
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
