import { ColyseusBabylonClient } from './modules/realtime/colyseus-babylon-client.js';
import { getColyseusEndpoint, shouldUseColyseus } from './modules/realtime/feature-flag.js';

const statusEl = document.getElementById('rt-status');
const canvas = document.getElementById('realtime-canvas');

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function getGameConfig() {
  try {
    const raw = sessionStorage.getItem('gameConfig');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function resolvePlayerName(config) {
  const fallback = `Player_${Math.floor(Math.random() * 10000)}`;
  const myPeerId = localStorage.getItem('myPlayerId');
  if (!config?.players?.length) return fallback;

  if (myPeerId) {
    const me = config.players.find((player) => player.id === myPeerId);
    if (me?.name) return me.name;
  }

  return config.players[0]?.name || fallback;
}

function createInputState() {
  const input = {
    throttle: 0,
    steer: 0,
    brake: 0,
    fire: false,
    startPressed: false,
  };

  const update = (event, isDown) => {
    const key = event.key.toLowerCase();

    if (key === 'w' || key === 'arrowup') input.throttle = isDown ? 1 : 0;
    if (key === 's' || key === 'arrowdown') input.throttle = isDown ? -1 : 0;
    if (key === 'a' || key === 'arrowleft') input.steer = isDown ? -1 : 0;
    if (key === 'd' || key === 'arrowright') input.steer = isDown ? 1 : 0;
    if (key === ' ') input.brake = isDown ? 1 : 0;
    if (key === 'f') input.fire = !!isDown;
    if (key === 'enter' && isDown) input.startPressed = true;
  };

  window.addEventListener('keydown', (event) => update(event, true));
  window.addEventListener('keyup', (event) => update(event, false));

  return input;
}

async function bootRealtime() {
  const config = getGameConfig();
  const params = new URLSearchParams(window.location.search);
  const smokeName = params.get('smoke');
  const forceColyseus = config?.multiplayerProvider === 'colyseus';

  if (!forceColyseus && !shouldUseColyseus() && !smokeName) {
    setStatus('Realtime provider disabled. Return to lobby and enable Colyseus.');
    return;
  }

  const roomName = config?.gameMode === 'battle' ? 'battle_room' : 'race_room';
  const endpoint = getColyseusEndpoint();
  const playerName = smokeName || resolvePlayerName(config);
  const myPlayerId = localStorage.getItem('myPlayerId');
  const playerInfo = config?.players?.find((player) => player.id === myPlayerId) || {};
  const joinCustomization = {
    kartId: playerInfo.playerKart || sessionStorage.getItem('selectedKart') || 'tux',
    playerColor: playerInfo.playerColor || sessionStorage.getItem('carColor') || 'red',
    gloEffect: sessionStorage.getItem('gloEffect') || 'solid',
    gloColor: sessionStorage.getItem('gloColor') || '#ff0080',
    gloColor2: sessionStorage.getItem('gloColor2') || '#00e5ff',
  };

  const client = new ColyseusBabylonClient({
    endpoint,
    roomName,
    playerName,
    maxPlayers: config?.maxPlayers || 12,
    gameMode: config?.gameMode || 'race',
    gameType: config?.battleType || 'deathmatch',
  });

  setStatus(`Connecting to ${roomName}...`);

  await client.initBabylon(canvas);
  await client.connect({
    playerName,
    maxPlayers: config?.maxPlayers || 12,
    gameMode: config?.gameMode || 'race',
    gameType: config?.battleType || 'deathmatch',
    trackId: config?.trackId || 'cocoa_temple',
    scoreLimit: config?.scoreLimit || 5,
    partyCode: config?.lobbyCode || '',
    ...joinCustomization,
  });

  setStatus(`Connected (${roomName}). Waiting for match start...`);

  const input = createInputState();
  let lastSentAt = performance.now();

  const tick = () => {
    const now = performance.now();
    if (now - lastSentAt >= 1000 / 60) {
      if (input.startPressed) {
        client.startMatch();
        input.startPressed = false;
      }

      client.sendInput({
        throttle: input.throttle,
        steer: input.steer,
        brake: input.brake,
        fire: input.fire,
      });

      lastSentAt = now;
    }

    if (client.started) {
      setStatus(`Connected (${roomName}) • Match live`);
    }

    window.requestAnimationFrame(tick);
  };

  window.requestAnimationFrame(tick);

  window.addEventListener('beforeunload', () => {
    client.dispose();
  });
}

bootRealtime().catch((error) => {
  console.error('[realtime] boot failed', error);
  setStatus(`Connection failed: ${error?.message || 'unknown error'}`);
});
