import { ColyseusBabylonClient } from './modules/realtime/colyseus-babylon-client.js';
import { resolveKartAsset } from './modules/content-registry.js';
import { getColyseusEndpoint, shouldUseColyseus } from './modules/realtime/feature-flag.js';

const statusEl = document.getElementById('rt-status');
const canvas = document.getElementById('realtime-canvas');
const splashScreen = document.getElementById('splash-screen');
const splashStatus = document.getElementById('splash-status');
const splashCountdown = document.getElementById('splash-countdown');
const countdownOverlay = document.getElementById('countdown-overlay');

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function setCountdownText(text) {
  
  if (countdownOverlay) countdownOverlay.textContent = text;
}

function showCountdownOverlay() {
  if (!countdownOverlay) return;
  countdownOverlay.classList.add('active');
  countdownOverlay.style.display = 'flex';
}

function hideCountdownOverlay() {
  if (!countdownOverlay) return;
  countdownOverlay.classList.remove('active');
  countdownOverlay.style.display = 'none';
  countdownOverlay.textContent = '';
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

  const keyState = {
    w: false,
    a: false,
    s: false,
    d: false,
    arrowup: false,
    arrowleft: false,
    arrowdown: false,
    arrowright: false,
    ' ': false,
    enter: false,
    f: false,
  };

  const syncInputFromKeys = () => {
    const forward = keyState.w || keyState.arrowup;
    const reverse = keyState.s || keyState.arrowdown;
    const left = keyState.a || keyState.arrowleft;
    const right = keyState.d || keyState.arrowright;

    input.throttle = forward && !reverse ? 1 : (!forward && reverse ? -1 : 0);
    input.steer = left && !right ? 1 : (!left && right ? -1 : 0);
    input.brake = keyState[' '] ? 1 : 0;
    input.fire = keyState.f;
  };

  const update = (event, isDown) => {
    const key = event.key.toLowerCase();

    if (!(key in keyState)) return;

    keyState[key] = !!isDown;
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright', ' ', 'enter', 'f'].includes(key)) {
      event.preventDefault();
    }

    syncInputFromKeys();

    if (key === 'enter' && isDown) input.startPressed = true;
  };

  window.addEventListener('keydown', (event) => update(event, true));
  window.addEventListener('keyup', (event) => update(event, false));
  window.addEventListener('blur', () => {
    Object.keys(keyState).forEach((k) => {
      keyState[k] = false;
    });
    input.throttle = 0;
    input.steer = 0;
    input.brake = 0;
    input.fire = false;
  });

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
    kartId: sessionStorage.getItem('selectedKart') || playerInfo.playerKart || 'tux',
    playerColor: sessionStorage.getItem('carColor') || playerInfo.playerColor || 'red',
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

  window.client = client; await client.initBabylon(canvas);
  canvas.focus();
  canvas.tabIndex = 1;
  canvas.addEventListener('click', () => canvas.focus());
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

    const splashMode = document.getElementById('splash-mode');
  if (splashMode) {
      const modeStr = (config?.gameMode || 'race').toUpperCase();
      const trackStr = (config?.trackId || 'COCOA TEMPLE').replace(/_/g, ' ').toUpperCase();
      splashMode.textContent = modeStr + ' - ' + trackStr;
  }

  const input = createInputState();
  let lastSentAt = performance.now();
  let countdownActive = false;
  let countdownStartAt = 0;

  const beginCountdown = (message = {}) => {
    const durationMs = Number(message.durationMs || 4000);
    const serverNow = Number(message.serverNow || Date.now());
    const startAt = Number(message.startAt || (serverNow + durationMs));
    const syncOffset = Date.now() - serverNow;

    countdownStartAt = startAt + syncOffset;
    countdownActive = true;

    if (splashStatus) {
      splashStatus.innerHTML = 'MATCH STARTING...';
    }

    showCountdownOverlay();
  };

  const endCountdown = () => {
    countdownActive = false;
    if (splashScreen) {
      splashScreen.classList.add('hidden');
      window.setTimeout(() => {
        splashScreen.style.display = 'none';
      }, 420);
    }
    hideCountdownOverlay();
    setStatus(`Connected (${roomName}) • Match live`);
  };

  client.room.onMessage('startSequence', (msg) => {
    beginCountdown(msg || {});
  });

  client.room.onMessage('matchLive', () => {
    endCountdown();
  });

  let lastSplashHtml = '';

  const tick = () => {
    const now = performance.now();
    if (now - lastSentAt >= 1000 / 60) {
      const isGameStarted = !!(client.room && client.room.state && client.room.state.started);

      if (input.startPressed && !isGameStarted && !countdownActive) {
        client.triggerStart();
        input.startPressed = false;
      }

      if (isGameStarted) {
        client.sendInput({
          throttle: input.throttle,
          steer: input.steer,
          brake: input.brake,
          fire: input.fire,
        });
      }

      lastSentAt = now;
    }

    const isGameStarted = client.room && client.room.state && client.room.state.started;

    if (countdownActive) {
      const remainingMs = Math.max(0, countdownStartAt - Date.now());
      if (remainingMs > 3000) setCountdownText('3');
      else if (remainingMs > 2000) setCountdownText('2');
      else if (remainingMs > 1000) setCountdownText('1');
      else if (remainingMs > 0) setCountdownText('START!');
      else setCountdownText('START!');
    }
    
    if (isGameStarted) {
        endCountdown();
    } else if (client.room && client.room.state && client.room.state.players) { 
        const plDiv = document.getElementById('splash-players');
        const statusDiv = splashStatus;
        
        if (plDiv) {
            let html = '';
            let pCount = 0;
            client.room.state.players.forEach(p => {
                  const kartInfo = resolveKartAsset(p.kartId);
                  
                  let modelPath = kartInfo.modelPath || `/models/car_${p.playerColor || 'red'}.glb`;
                  if (kartInfo.id === 'default' || p.kartId === 'default' || !p.kartId) {
                      modelPath = `/models/car_${p.playerColor || 'red'}.glb`;
                  }
                  
                  html += `<div class="splash-player" style="display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(0,0,0,0.5); border-radius: 12px; color: ${p.gloColor || p.playerColor || '#fff'}; border: 2px solid ${p.gloColor || p.playerColor || '#fff'}; padding: 10px; margin: 10px; font-weight: bold; box-shadow: 0 0 15px ${p.gloColor || '#ff0080'}; min-width: 180px; max-width: 220px;">`;
                  html += `<model-viewer src="${modelPath}" auto-rotate shadow-intensity="1" shadow-softness="0.5" camera-controls disable-zoom style="width: 100%; height: 200px; background-color: transparent; outline: none;"></model-viewer>`;
                  html += `<div style="margin-top: 5px; font-size: 1.2rem; text-align: center; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%;">${p.name || 'Player'}</div>`;
                  html += '</div>';
                  pCount++;
              });
            if (lastSplashHtml !== html) {
                lastSplashHtml = html;
                plDiv.innerHTML = html;
            }
            if (statusDiv) {
              if (countdownActive) {
                statusDiv.innerHTML = 'MATCH STARTING...';
              } else if (pCount > 1) {
                    statusDiv.innerHTML = 'READY - HOST PRESS <span style="color:#0f0;">ENTER</span> TO START';
                } else {
                    statusDiv.textContent = 'WAITING FOR OTHERS...';
                }
            }
        }
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
