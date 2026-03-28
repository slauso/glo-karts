import {
  ALL_ARENAS,
  ALL_TRACKS,
  resolvePlayableRaceTrack,
  resolveSinglePlayerCup,
} from './content-registry.js';

const ARENA_MODE_IDS = new Set([
  'battle_solo',
  'soccer',
  'battle_online',
  'local_2p_battle',
]);

const TRACK_MODE_IDS = new Set([
  'quick_race',
  'time_trial',
  'grand_prix',
  'free_roam',
  'follow_the_leader',
  'race_online',
  'local_2p_race',
]);

const GLOFLUX_MODE_IDS = new Set([
  'gloflux_race',
  'gloflux_arena',
]);

function getSelectedKartId() {
  try {
    return sessionStorage.getItem('selectedKart') || 'tux';
  } catch {
    return 'tux';
  }
}

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function resolveArenaSelection(selectedMap, modeId) {
  if (selectedMap && ALL_ARENAS[selectedMap]) {
    return { arenaId: selectedMap, fallbackCause: null };
  }

  const fallbackArena = ALL_ARENAS.glo_arena ? 'glo_arena' : 'test_box';

  return {
    arenaId: fallbackArena,
    fallbackCause: selectedMap ? `invalid-arena:${selectedMap}` : 'missing-arena-selection',
  };
}

function resolveTrackSelection(selectedMap) {
  const trackId = resolvePlayableRaceTrack(selectedMap || 'test_box');
  return {
    trackId,
    fallbackCause: trackId === (selectedMap || 'test_box')
      ? null
      : (selectedMap ? `invalid-track:${selectedMap}` : 'missing-track-selection'),
  };
}

function resolveCupSelection(cupId, raceIdx = 0) {
  const cup = resolveSinglePlayerCup(cupId || 'starter');
  const boundedRaceIdx = Math.max(0, Math.min(Number(raceIdx) || 0, cup.trackIds.length - 1));
  const { trackId, fallbackCause } = resolveTrackSelection(cup.trackIds[boundedRaceIdx]);
  return {
    cupId: cup.id,
    raceIdx: boundedRaceIdx,
    trackId,
    fallbackCause,
  };
}

export function usesArenaSelection(modeId) {
  return ARENA_MODE_IDS.has(modeId);
}

export function usesTrackSelection(modeId) {
  return TRACK_MODE_IDS.has(modeId);
}

export function usesCupSelection(modeId) {
  return modeId === 'grand_prix';
}

export function getLegacyModeFamily(modeId) {
  if (GLOFLUX_MODE_IDS.has(modeId)) return 'gloflux';
  return usesArenaSelection(modeId) ? 'battle' : 'race';
}

export function getSelectableContentList(modeId) {
  const source = usesArenaSelection(modeId) ? ALL_ARENAS : ALL_TRACKS;
  return Object.values(source).map((entry) => ({ id: entry.id, name: entry.label }));
}

export function resolveModePage(modeId) {
  switch (modeId) {
    case 'quick_race':
    case 'time_trial':
    case 'grand_prix':
    case 'free_roam':
    case 'follow_the_leader':
    case 'soccer':
      return 'game.html';
    case 'battle_solo':
      return 'battle.html';
    case 'local_2p_race':
    case 'local_2p_battle':
      return 'splitscreen.html';
    case 'race_online':
    case 'battle_online':
      return 'realtime.html';
    case 'gloflux_race':
    case 'gloflux_arena':
      return 'gloflux.html';
    default:
      return 'index.html';
  }
}

export function buildResolvedModeConfig(modeId, lobbyState = {}) {
  const selectedKart = getSelectedKartId();
  const requestedBotCount = toPositiveInt(lobbyState.selectedBotCount, undefined);

  switch (modeId) {
    case 'quick_race': {
      const { trackId, fallbackCause } = resolveTrackSelection(lobbyState.selectedMap);
      return {
        gameMode: 'race',
        subMode: 'quick_race',
        singlePlayerMode: true,
        multiplayer: false,
        runtimeProvider: 'page-runtime',
        maxPlayers: 1,
        botCount: requestedBotCount ?? 5,
        trackId,
        contentType: 'track',
        resolvedContentId: trackId,
        fallbackCause,
        selectedKart,
      };
    }

    case 'time_trial': {
      const { trackId, fallbackCause } = resolveTrackSelection(lobbyState.selectedMap);
      return {
        gameMode: 'race',
        subMode: 'time_trial',
        singlePlayerMode: true,
        multiplayer: false,
        runtimeProvider: 'page-runtime',
        maxPlayers: 1,
        botCount: 0,
        noItems: true,
        noOpponents: true,
        trackId,
        contentType: 'track',
        resolvedContentId: trackId,
        fallbackCause,
        selectedKart,
      };
    }

    case 'grand_prix': {
      const resolved = resolveCupSelection(lobbyState.selectedCup, lobbyState._gpRaceIdx);
      const cup = resolveSinglePlayerCup(resolved.cupId);
      return {
        gameMode: 'race',
        subMode: 'grand_prix',
        singlePlayerMode: true,
        multiplayer: false,
        runtimeProvider: 'page-runtime',
        maxPlayers: 1,
        botCount: requestedBotCount ?? 7,
        cupId: resolved.cupId,
        cupLabel: cup.label,
        cupIcon: cup.icon,
        cupTotal: cup.trackIds.length,
        cupRace: resolved.raceIdx + 1,
        trackId: resolved.trackId,
        contentType: 'track',
        resolvedContentId: resolved.trackId,
        fallbackCause: resolved.fallbackCause,
        selectedKart,
        _gpRaceIdx: resolved.raceIdx,
      };
    }

    case 'free_roam': {
      const { trackId, fallbackCause } = resolveTrackSelection(lobbyState.selectedMap);
      return {
        gameMode: 'race',
        subMode: 'free_roam',
        singlePlayerMode: true,
        multiplayer: false,
        runtimeProvider: 'page-runtime',
        maxPlayers: 1,
        botCount: 0,
        noItems: true,
        noOpponents: true,
        trackId,
        contentType: 'track',
        resolvedContentId: trackId,
        fallbackCause,
        selectedKart,
      };
    }

    case 'follow_the_leader': {
      const { trackId, fallbackCause } = resolveTrackSelection(lobbyState.selectedMap);
      return {
        gameMode: 'race',
        subMode: 'follow_the_leader',
        singlePlayerMode: true,
        multiplayer: false,
        runtimeProvider: 'page-runtime',
        maxPlayers: 1,
        botCount: requestedBotCount ?? 7,
        trackId,
        contentType: 'track',
        resolvedContentId: trackId,
        fallbackCause,
        selectedKart,
      };
    }

    case 'soccer': {
      const { arenaId, fallbackCause } = resolveArenaSelection(lobbyState.selectedMap, modeId);
      return {
        gameMode: 'race',
        subMode: 'soccer',
        singlePlayerMode: true,
        multiplayer: false,
        runtimeProvider: 'page-runtime',
        maxPlayers: 1,
        botCount: requestedBotCount ?? 5,
        noItems: true,
        trackId: arenaId,
        arenaId,
        contentType: 'arena',
        resolvedContentId: arenaId,
        fallbackCause,
        selectedKart,
      };
    }

    case 'battle_solo': {
      const { arenaId, fallbackCause } = resolveArenaSelection(lobbyState.selectedMap, modeId);
      return {
        gameMode: 'battle',
        subMode: 'battle_solo',
        singlePlayerMode: true,
        multiplayer: false,
        runtimeProvider: 'page-runtime',
        maxPlayers: 1,
        botCount: requestedBotCount ?? 4,
        trackId: arenaId,
        arenaId,
        contentType: 'arena',
        resolvedContentId: arenaId,
        fallbackCause,
        battleType: lobbyState.selectedBattleType || 'deathmatch',
        loadoutId: lobbyState.selectedLoadout || 'random-all',
        scoreLimit: toPositiveInt(lobbyState.scoreLimit, 5),
        selectedKart,
      };
    }

    case 'race_online':
      return {
        gameMode: 'race',
        trackId: resolveTrackSelection(lobbyState.selectedMap).trackId,
        multiplayer: true,
        multiplayerProvider: 'colyseus',
      };

    case 'battle_online': {
      const { arenaId } = resolveArenaSelection(lobbyState.selectedMap, modeId);
      return {
        gameMode: 'battle',
        trackId: arenaId,
        arenaId,
        multiplayer: true,
        multiplayerProvider: 'colyseus',
        battleType: lobbyState.selectedBattleType || 'deathmatch',
        maxPlayers: toPositiveInt(lobbyState.selectedMaxPlayers, 12),
        loadoutId: lobbyState.selectedLoadout || 'random-all',
        scoreLimit: toPositiveInt(lobbyState.scoreLimit, 5),
      };
    }

    case 'local_2p_race': {
      const { trackId, fallbackCause } = resolveTrackSelection(lobbyState.selectedMap);
      return {
        gameMode: 'splitscreen_race',
        trackId,
        contentType: 'track',
        resolvedContentId: trackId,
        fallbackCause,
        isSinglePlayer: false,
        p1Kart: selectedKart,
        p2Kart: 'nolok',
      };
    }

    case 'local_2p_battle': {
      const { arenaId, fallbackCause } = resolveArenaSelection(lobbyState.selectedMap, modeId);
      return {
        gameMode: 'splitscreen_battle',
        trackId: arenaId,
        arenaId,
        contentType: 'arena',
        resolvedContentId: arenaId,
        fallbackCause,
        isSinglePlayer: false,
        p1Kart: selectedKart,
        p2Kart: 'nolok',
      };
    }

    case 'gloflux_race':
      return {
        gameMode: 'gloflux',
        subMode: 'gloflux_race',
        variant: 'race',
        singlePlayerMode: true,
        multiplayer: false,
        runtimeProvider: 'page-runtime',
        selectedKart,
      };

    case 'gloflux_arena':
      return {
        gameMode: 'gloflux',
        subMode: 'gloflux_arena',
        variant: 'arena',
        singlePlayerMode: true,
        multiplayer: false,
        runtimeProvider: 'page-runtime',
        selectedKart,
      };

    default:
      return null;
  }
}


