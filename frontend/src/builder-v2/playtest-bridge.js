/**
 * playtest-bridge.js — Launch arena in realtime mode for playtesting.
 */

const BUILDER_PLAYTEST_META_KEY = 'gloBuilderPlaytestMeta';

export class PlaytestBridge {
  /**
   * @param {import('./serializer.js').Serializer} serializer
   */
  constructor(serializer) {
    this._serializer = serializer;
  }

  /**
   * Launch playtest: saves TrackData to sessionStorage, opens realtime.html.
   * @param {string} name
   * @param {string} author
   * @param {{ preset?: 'track' | 'arena', timeTrial?: boolean }} options
   */
  launch(name, author, options = {}) {
    const preset = options?.preset === 'track' ? 'track' : 'arena';
    const timeTrial = !!options?.timeTrial;
    const data = this._serializer.buildPlaytestTrackData(name, author, { preset });
    const playtestMode = timeTrial ? 'time_trial' : (data.playtestMode || 'race');
    const selectedKart = sessionStorage.getItem('selectedKart') || localStorage.getItem('selectedKart') || 'tux';
    const playerColor = sessionStorage.getItem('carColor') || localStorage.getItem('carColor') || 'red';
    const gloEffect = sessionStorage.getItem('gloEffect') || localStorage.getItem('gloEffect') || 'solid';
    const gloColor = sessionStorage.getItem('gloColor') || localStorage.getItem('gloColor') || '#ff0080';
    const gloColor2 = sessionStorage.getItem('gloColor2') || localStorage.getItem('gloColor2') || '#00e5ff';

    // Validate minimum requirements
    if (!data.roadCells?.length && !data.segments?.length) {
      return { ok: false, reason: 'Place some track pieces or road cells before playtesting.' };
    }
    if (!data.startPositions?.length) {
      const anchorSegment = data.segments?.[0];
      data.startPositions = [{
        id: 1,
        position: {
          x: Number(anchorSegment?.position?.x || 0),
          y: Math.max(2, Number(anchorSegment?.position?.y || 0) + 2),
          z: Number(anchorSegment?.position?.z || 0),
        },
        heading: Number(anchorSegment?.rotation || 0),
      }];
    }

    const stagedTrackData = JSON.stringify(data);
    const existingPlayerId = sessionStorage.getItem('myPlayerId') || localStorage.getItem('myPlayerId');
    const playerId = existingPlayerId || `builder-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem('myPlayerId', playerId);
    localStorage.setItem('myPlayerId', playerId);

    const builderPlaytestMeta = {
      name,
      author,
      preset,
      mode: playtestMode,
      segmentCount: data.segments?.length || 0,
      roadCellCount: data.roadCells?.length || 0,
      obstacleCount: data.obstacles?.length || 0,
      spawnCount: data.startPositions?.length || 0,
    };

    const gameConfig = {
      gameMode: playtestMode,
      battleType: 'deathmatch',
      trackId: 'custom_import',
      arenaId: 'custom_import',
      modeId: playtestMode === 'battle' ? 'battle_online' : 'race_online',
      resolvedContentId: 'custom_import',
      multiplayer: true,
      multiplayerProvider: 'colyseus',
      builderPlaytest: true,
      builderPreset: preset,
      selectedKart,
      maxPlayers: 1,
      players: [{
        id: playerId,
        name: author || 'Builder',
        isHost: true,
        playerKart: selectedKart,
        playerColor,
        gloEffect,
        gloColor,
        gloColor2,
      }],
      customTrackData: stagedTrackData,
    };

    sessionStorage.setItem('selectedKart', selectedKart);
    localStorage.setItem('selectedKart', selectedKart);

    // Store for runtime consumption
    sessionStorage.setItem('customTrackData', stagedTrackData);
    sessionStorage.setItem('gameConfig', JSON.stringify(gameConfig));
    sessionStorage.setItem('builderPlaytestMeta', JSON.stringify(builderPlaytestMeta));
    sessionStorage.setItem(BUILDER_PLAYTEST_META_KEY, JSON.stringify(builderPlaytestMeta));
    localStorage.setItem('customTrackData', stagedTrackData);
    localStorage.setItem('gameConfig', JSON.stringify(gameConfig));
    localStorage.setItem('builderPlaytestMeta', JSON.stringify(builderPlaytestMeta));
    localStorage.setItem(BUILDER_PLAYTEST_META_KEY, JSON.stringify(builderPlaytestMeta));

    // Open realtime mode
    const url = new URL('/realtime.html', window.location.origin);
    url.searchParams.set('map', 'custom_import');
    url.searchParams.set('mode', playtestMode);
    url.searchParams.set('fromBuilder', '1');
    url.searchParams.set('builderPlaytest', '1');
    window.open(url.toString(), '_blank');

    return { ok: true, mode: playtestMode };
  }
}
