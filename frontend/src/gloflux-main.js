/**
 * gloflux-main.js — Entry point for the gloFLUX HTML page.
 *
 * Reads optional pre-config from sessionStorage (set by lobby),
 * then boots the gloFLUX orchestrator.  When the config indicates
 * multiplayer, creates a Colyseus-backed network client first.
 */

import { bootGloFlux } from './modules/gloflux/glo-flux.js';
import { createGloFluxClient } from './modules/gloflux/glo-flux-network.js';
import { getColyseusEndpoint } from './modules/realtime/feature-flag.js';
import * as prematchLobby from './modules/realtime/prematch-lobby.js';
import { publishDebugSnapshot } from './modules/debug-telemetry.js';

const canvas = document.getElementById('gloflux-canvas');
if (!canvas) {
  console.error('[gloFLUX] Canvas #gloflux-canvas not found');
} else {
  // Check for pre-config from lobby navigation
  let preConfig = null;
  const raw = sessionStorage.getItem('gameConfig');
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.gameMode === 'gloflux') {
        preConfig = parsed;
        console.log('[gloFLUX] Loaded config from lobby:', preConfig.subMode);
      }
    } catch { /* ignore parse errors, menu will show */ }
  }

  (async () => {
    let networkClient = null;

    if (preConfig?.multiplayer) {
      try {
        const { Client } = await import('colyseus.js');
        const endpoint = getColyseusEndpoint();
        const colyseusClient = new Client(endpoint);

        networkClient = createGloFluxClient({
          serverUrl: endpoint,
          roomName: preConfig.roomName || 'gloflux',
          joinOptions: {
            gameConfig: JSON.stringify(preConfig),
          },
        });
        await networkClient.connect(colyseusClient);
        console.log('[gloFLUX] Connected to multiplayer room');
                    const mockState = { players: networkClient.players };
          prematchLobby.show(mockState, networkClient.sessionId, preConfig);
          
          networkClient.on('playerJoin', () => prematchLobby.updatePlayers(mockState, networkClient.sessionId));
          networkClient.on('playerLeave', () => prematchLobby.updatePlayers(mockState, networkClient.sessionId));

          networkClient.on('countdown', (msg) => {
              console.log('Countdown', msg);
              prematchLobby.startCountdown(msg.durationMs / 1000);
          });

          networkClient.on('matchLive', () => {
               console.log('Match live!');
               prematchLobby.hide();
          });

          // Trigger start automatically for now
          setTimeout(() => {
              if (networkClient && networkClient.triggerStart) {
                  console.log('Triggering start!');
                  networkClient.triggerStart();
              }
          }, 4000);      } catch (err) {
        console.error('[gloFLUX] Multiplayer connection failed, falling back to solo:', err.message);
        networkClient = null;
        if (preConfig) preConfig.multiplayer = false;
      }
    }

    const instance = bootGloFlux(canvas, preConfig, { networkClient });

    publishDebugSnapshot(preConfig, { runtimeProvider: 'gloflux' });

    // Expose for debugging
    window.__gloflux = instance;

    console.log('[gloFLUX] Booted — press ESC to return to lobby');

    // ESC key → back to lobby
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (networkClient) networkClient.dispose();
        instance.dispose();
        window.location.href = 'index.html';
      }
    });
  })();
}
