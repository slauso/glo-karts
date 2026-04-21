/**
 * playtest-bridge.js — Launch arena in realtime mode for playtesting.
 */

const BUILDER_PLAYTEST_META_KEY = 'gloBuilderPlaytestMeta';
const DEG_TO_RAD = Math.PI / 180;
const BUILDER_PLAYTEST_ROOM = Object.freeze({
  race: 'builder_race_playtest',
  battle: 'builder_battle_playtest',
});

function createBuilderPlaytestCode() {
  const timePart = Date.now().toString(36).slice(-6).toUpperCase();
  const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `BT-${timePart}-${randomPart}`;
}

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
   * @param {{ preset?: 'track' | 'arena' }} options
   */
  launch(name, author, options = {}) {
    const preset = options?.preset === 'track' ? 'track' : 'arena';
    const data = this._serializer.buildPlaytestTrackData(name, author, { preset });
    const playtestMode = data.playtestMode || 'race';
    const builderPlaytestCode = createBuilderPlaytestCode();
    const roomName = playtestMode === 'battle'
      ? BUILDER_PLAYTEST_ROOM.battle
      : BUILDER_PLAYTEST_ROOM.race;
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
      const anchorY = Number(anchorSegment?.position?.y || 0);
      data.startPositions = [{
        id: 1,
        position: {
          x: Number(anchorSegment?.position?.x || 0),
          // Hint Y just above the authored segment; the runtime raycasts the
          // drivable surface (LAYER.TRACK) and snaps the kart to
          // `surfaceY + clearance`. A large hardcoded offset previously made
          // the kart appear to hover above the deck on flat arenas.
          y: anchorY + 1,
          z: Number(anchorSegment?.position?.z || 0),
        },
        heading: Number(anchorSegment?.rotation || 0) * DEG_TO_RAD,
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
      roomName,
      playtestCode: builderPlaytestCode,
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
      roomName,
      partyCode: builderPlaytestCode,
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
