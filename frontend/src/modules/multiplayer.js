const state = {
  peer: null,
  playerConnections: [],
  opponentCars: {},
  gameConfig: null,
  isHost: false,
  allPlayers: [],
  scene: null,
  allCarsData: {},
  lastBroadcastTime: 0,
  carModel: null,
};

function noop() {}

function getCurrentPlayerId() {
  return sessionStorage.getItem('myPlayerId') || localStorage.getItem('myPlayerId');
}

export function initMultiplayer(gameState = {}) {
  state.scene = gameState.scene || null;

  try {
    const raw = sessionStorage.getItem('gameConfig');
    state.gameConfig = raw ? JSON.parse(raw) : null;
  } catch {
    state.gameConfig = null;
  }

  state.allPlayers = Array.isArray(state.gameConfig?.players) ? state.gameConfig.players : [];

  const myId = getCurrentPlayerId();
  state.isHost = !!state.allPlayers.find((player) => player.id === myId && player.isHost);

  state.checkAllPlayersConnected = checkAllPlayersConnected;
  state.broadcastRaceStart = broadcastRaceStart;
  state.broadcastCountdownStart = broadcastCountdownStart;
  state.broadcastDamageEvent = noop;
  state.onDamageEvent = null;
  state.onWeaponPickups = null;
  state.onProjectileSpawn = null;
  state.onProjectileHit = null;

  return state;
}

export function updateOpponentCarPosition(playerId, data) {
  if (!playerId || !data) return;
  state.allCarsData[playerId] = { ...(state.allCarsData[playerId] || {}), ...data };
}

export function updateMarkers() {
  return;
}

export function sendCarData() {
  return;
}

export function checkAllPlayersConnected() {
  const players = state.allPlayers || [];
  return players.length <= 1;
}

export function broadcastRaceStart() {
  return;
}

export function broadcastCountdownStart() {
  return;
}

export function interpolateOpponents() {
  return;
}
