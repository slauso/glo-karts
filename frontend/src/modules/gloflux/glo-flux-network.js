/**
 * glo-flux-network.js — Colyseus networking layer for gloFLUX mode.
 *
 * Client-side:
 *   - GloFluxClient: connects to GloFluxRoom, syncs state, sends input
 *   - Power-up collection validation
 *   - Surge sync
 *   - Mutation broadcast
 *
 * Server-side room is in realtime/src/rooms/GloFluxRoom.js
 */

// ── Client-Side Network Adapter ─────────────────────────────────────────────

/**
 * Create a gloFLUX network client.
 * Wraps Colyseus client for gloFLUX-specific message handling.
 *
 * @param {object} opts
 * @param {string} opts.serverUrl - Colyseus server URL
 * @param {string} opts.roomName - Room name (default: 'gloflux')
 * @param {object} opts.joinOptions - Room join options
 * @returns {object} Network client adapter
 */
export function createGloFluxClient(opts = {}) {
  const state = {
    room: null,
    connected: false,
    sessionId: null,
    players: new Map(),        // sessionId → synced player data
    powerSpawns: [],           // server-authoritative spawns
    telemetry: {
      arenaSeed: 0,
      activeCoreCount: 0,
      totalCoreCollections: 0,
      totalChainBursts: 0,
      activeChainPeak: 0,
      longestChain: 0,
      patchVersion: 0,
      totalSurgeEvents: 0,
      highestSurgeMeter: 0,
      apocalypseBursts: 0,
      anomalyCoreCollections: 0,
      anomalyChainBursts: 0,
    },
    surgeStates: new Map(),    // sessionId → surge data
    mutationStates: new Map(), // sessionId → mutation data
    callbacks: {},
    disposed: false,
    metricsPollInterval: null,
  };

  return {
    get connected() { return state.connected; },
    get sessionId() { return state.sessionId; },
    get players() { return state.players; },
    get powerSpawns() { return state.powerSpawns; },
    get telemetry() { return state.telemetry; },
    get room() { return state.room; },

    /**
     * Connect to the gloFLUX room.
     * @param {import('colyseus.js').Client} colyseusClient
     */
    async connect(colyseusClient) {
      const roomName = opts.roomName || 'gloflux';
      const joinOpts = opts.joinOptions || {};

      try {
        // 20.22 — if a party code is provided, try to join existing room first
        if (joinOpts.partyCode) {
          try {
            const rooms = await colyseusClient.getAvailableRooms(roomName);
            const partyRoom = rooms.find(r => r.metadata?.partyCode === joinOpts.partyCode);
            if (partyRoom) {
              state.room = await colyseusClient.joinById(partyRoom.roomId, joinOpts);
            } else {
              state.room = await colyseusClient.create(roomName, joinOpts);
            }
          } catch (_) {
            state.room = await colyseusClient.joinOrCreate(roomName, joinOpts);
          }
        } else {
          state.room = await colyseusClient.joinOrCreate(roomName, joinOpts);
        }

        state.sessionId = state.room.sessionId;
        state.connected = true;

        setupStateHandlers(state);
        setupMessageHandlers(state);
        startMetricsPolling(state);

        console.log(`[gloFLUX-net] Connected to room ${roomName}, session=${state.sessionId}`);
      } catch (err) {
        console.error('[gloFLUX-net] Failed to connect:', err.message);
        state.connected = false;
        throw err;
      }
    },

    /**
     * Send player input to server.
     * @param {object} input - { forward, steer, brake, usePower }
     */
    sendInput(input) {
      if (!state.room || state.disposed) return;
      state.room.send('input', {
        f: input.forward ? 1 : 0,
        s: Math.round((input.steer || 0) * 100) / 100,
        b: input.brake ? 1 : 0,
        p: input.usePower || null,
      });
    },

    /**
     * Notify server that local player collected a power-up.
     * Server validates proximity and grants/denies.
     * @param {number} spawnIndex
     */
    requestPowerCollection(spawnIndex) {
      if (!state.room || state.disposed) return;
      state.room.send('collectPower', { idx: spawnIndex });
    },

    /**
     * Send surge state update to server for validation.
     * @param {number} surgeValue
     */
    syncSurge(surgeValue) {
      if (!state.room || state.disposed) return;
      state.room.send('surgeSync', { v: surgeValue });
    },

    /**
     * Send mutation state to server for broadcast.
     * @param {object} serialized - From serializeMutation()
     */
    syncMutation(serialized) {
      if (!state.room || state.disposed) return;
      state.room.send('mutationSync', serialized);
    },

    /**
     * Request apocalypse burst trigger.
     */
    requestApocalypse() {
      if (!state.room || state.disposed) return;
      state.room.send('apocalypse', {});
    },

    triggerStart() {
      if (!state.room || state.disposed) return;
      state.room.send('triggerStart', {});
    },

    /** 20.15 — Vote for rematch after results. */
    requestRematch() {
      if (!state.room || state.disposed) return;
      state.room.send('rematchVote', {});
    },

    /** 20.15 — Request return to menu. */
    requestReturn() {
      if (!state.room || state.disposed) return;
      state.room.send('returnToMenu', {});
    },

    /** 20.16 — Request spectator mode. */
    requestSpectate() {
      if (!state.room || state.disposed) return;
      state.room.send('spectate', {});
    },

    /**
     * Register a callback.
     * @param {string} event
     * @param {Function} cb
     */
    on(event, cb) {
      state.callbacks[event] = state.callbacks[event] || [];
      state.callbacks[event].push(cb);
    },

    /**
     * Disconnect and clean up.
     */
    dispose() {
      state.disposed = true;
      if (state.room) {
        state.room.leave();
        state.room = null;
      }
      state.connected = false;
      state.players.clear();
      state.surgeStates.clear();
      state.mutationStates.clear();
      stopMetricsPolling(state);
      state.callbacks = {};
    },
  };
}

// ── State Sync Handlers ─────────────────────────────────────────────────────

function setupStateHandlers(state) {
  const room = state.room;
  if (!room?.state) return;

  const syncTelemetry = () => {
    state.telemetry = {
      ...state.telemetry,
      arenaSeed: Number(room.state.arenaSeed || 0),
      activeCoreCount: Number(room.state.activeCoreCount || 0),
      totalCoreCollections: Number(room.state.totalCoreCollections || 0),
      totalChainBursts: Number(room.state.totalChainBursts || 0),
      activeChainPeak: Number(room.state.activeChainPeak || 0),
      longestChain: Number(room.state.longestChain || 0),
    };
    emit(state, 'telemetry', state.telemetry);
  };

  syncTelemetry();
  room.state.onChange?.(() => syncTelemetry());

  if (room.state.powerSpawns) {
    const syncPowerSpawns = () => {
      state.powerSpawns = Array.from(room.state.powerSpawns, (spawn, idx) => ({
        idx,
        x: spawn.x,
        y: spawn.y,
        z: spawn.z,
        powerId: spawn.powerId,
        collected: spawn.collected,
      }));
      syncTelemetry();
    };

    syncPowerSpawns();
    room.state.powerSpawns.onAdd?.(() => syncPowerSpawns());
    room.state.powerSpawns.onChange?.(() => syncPowerSpawns());
    room.state.powerSpawns.onRemove?.(() => syncPowerSpawns());
  }

  // Player add/remove
  if (room.state.players) {
    room.state.players.onAdd((player, sessionId) => {
      state.players.set(sessionId, {
        sessionId,
        name: player.name || sessionId,
        kartId: player.kartId || 'tux',
        playerColor: player.playerColor || 'red',
        gloColor: player.gloColor || '#ff0080',
        gloColor2: player.gloColor2 || '#00e5ff',
        x: player.x || 0,
        y: player.y || 0,
        z: player.z || 0,
        ry: player.ry || 0,
        health: player.health || 100,
        alive: (player.health || 100) > 0,
        score: player.score || 0,
      });
      emit(state, 'playerJoin', { sessionId });

      player.onChange(() => {
        const p = state.players.get(sessionId);
        if (!p) return;
        p.name = player.name;
        p.kartId = player.kartId;
        p.playerColor = player.playerColor;
        p.gloColor = player.gloColor;
        p.gloColor2 = player.gloColor2;
        p.x = player.x;
        p.y = player.y;
        p.z = player.z;
        p.ry = player.ry;
        p.health = player.health;
        p.alive = player.health > 0;
        p.score = player.score;
      });
    });

    room.state.players.onRemove((_player, sessionId) => {
      state.players.delete(sessionId);
      state.surgeStates.delete(sessionId);
      state.mutationStates.delete(sessionId);
      emit(state, 'playerLeave', { sessionId });
    });
  }
}

function setupMessageHandlers(state) {
  const room = state.room;
  if (!room) return;

  room.onMessage('joined', (msg) => {
    emit(state, 'joined', msg);
  });

  room.onMessage('syncMetricsSnapshot', (msg = {}) => {
    state.telemetry = {
      ...state.telemetry,
      patchVersion: Number(msg.patchVersion || state.telemetry.patchVersion || 0),
      totalSurgeEvents: Number(msg.totalSurgeEvents || state.telemetry.totalSurgeEvents || 0),
      highestSurgeMeter: Number(msg.highestSurgeMeter || state.telemetry.highestSurgeMeter || 0),
      apocalypseBursts: Number(msg.apocalypseBursts || 0),
      anomalyCoreCollections: Number(msg.anomalyCoreCollections || 0),
      anomalyChainBursts: Number(msg.anomalyChainBursts || 0),
    };
    emit(state, 'telemetry', state.telemetry);
  });

  room.onMessage('chainActivated', (msg) => {
    if (msg?.surgeMeter != null) {
      state.telemetry = {
        ...state.telemetry,
        totalSurgeEvents: state.telemetry.totalSurgeEvents + 1,
        highestSurgeMeter: Math.max(state.telemetry.highestSurgeMeter, Number(msg.surgeMeter || 0)),
        patchVersion: Math.max(state.telemetry.patchVersion, Number(msg.patchVersion || 0)),
      };
    }
    emit(state, 'chainActivated', msg);
  });

  // Server grants power-up collection
  room.onMessage('powerGranted', (msg) => {
    emit(state, 'powerGranted', msg);
  });

  // Server denies power-up collection (already collected by another player)
  room.onMessage('powerDenied', (msg) => {
    emit(state, 'powerDenied', msg);
  });

  // Another player's surge data
  room.onMessage('surgeBroadcast', (msg) => {
    state.surgeStates.set(msg.sessionId, msg);
    emit(state, 'surgeBroadcast', msg);
  });

  // Another player's mutation data
  room.onMessage('mutationBroadcast', (msg) => {
    state.mutationStates.set(msg.sessionId, msg);
    emit(state, 'mutationBroadcast', msg);
  });

  // Apocalypse burst triggered by someone
  room.onMessage('apocalypseTriggered', (msg) => {
    emit(state, 'apocalypseTriggered', msg);
  });

  // Game over
  room.onMessage('gameOver', (msg) => {
    emit(state, 'gameOver', msg);
  });

  // Countdown
  room.onMessage('countdown', (msg) => {
    emit(state, 'countdown', msg);
  });

  room.onMessage('matchLive', () => {
    emit(state, 'matchLive', {});
  });

  // 20.15 — phase transitions from server
  room.onMessage('phaseChange', (msg) => {
    emit(state, 'phaseChange', msg);
  });

  room.onMessage('matchResults', (msg) => {
    emit(state, 'matchResults', msg);
  });

  room.onMessage('rematchStatus', (msg) => {
    emit(state, 'rematchStatus', msg);
  });

  room.onMessage('rematchStarting', () => {
    emit(state, 'rematchStarting', {});
  });

  // 20.16 — spectate confirmation
  room.onMessage('spectateConfirmed', (msg) => {
    emit(state, 'spectateConfirmed', msg);
  });

  // Power-up respawn broadcast
  room.onMessage('powerRespawn', (msg) => {
    emit(state, 'powerRespawn', msg);
  });

  room.onLeave(() => {
    state.connected = false;
    stopMetricsPolling(state);
    emit(state, 'disconnected', {});
  });

  room.onError((code, message) => {
    console.error(`[gloFLUX-net] Room error ${code}: ${message}`);
    emit(state, 'error', { code, message });
  });
}

function emit(state, event, data) {
  const cbs = state.callbacks[event];
  if (!cbs) return;
  for (const cb of cbs) {
    try { cb(data); } catch (e) { console.error(`[gloFLUX-net] callback error:`, e); }
  }
}

function startMetricsPolling(state) {
  stopMetricsPolling(state);
  if (!state.room) return;

  const pollMetrics = () => {
    if (!state.room || state.disposed) return;
    state.room.send('syncMetricsRequest', {});
  };

  pollMetrics();
  state.metricsPollInterval = window.setInterval(pollMetrics, 1000);
}

function stopMetricsPolling(state) {
  if (!state.metricsPollInterval) return;
  window.clearInterval(state.metricsPollInterval);
  state.metricsPollInterval = null;
}
