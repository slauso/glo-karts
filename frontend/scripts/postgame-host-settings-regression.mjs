import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const HEADLESS = String(process.env.HEADLESS || 'true').toLowerCase() !== 'false';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function preparePage(page, { sessionPlayerId, localPlayerId, gameConfig }) {
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ nextSessionPlayerId, nextLocalPlayerId, nextGameConfig }) => {
    localStorage.setItem('myPlayerId', nextLocalPlayerId);
    sessionStorage.setItem('myPlayerId', nextSessionPlayerId);
    sessionStorage.setItem('gameConfig', JSON.stringify(nextGameConfig));
  }, {
    nextSessionPlayerId: sessionPlayerId,
    nextLocalPlayerId: localPlayerId,
    nextGameConfig: gameConfig,
  });
}

async function renderPostGameOverlay(page, { roomSessionId, joinIsHost }) {
  await page.evaluate(async ({ nextRoomSessionId, nextJoinIsHost }) => {
    document.getElementById('_glo-match-end')?.remove();

    const { ColyseusBabylonClient } = await import('/src/modules/realtime/colyseus-babylon-client.js');

    const fakePlayers = {
      forEach(callback) {
        callback({ name: 'Host' }, 'battle-host-session');
        callback({ name: 'Guest' }, 'battle-guest-session');
      },
    };

    const fakeClient = {
      room: {
        sessionId: nextRoomSessionId,
        state: {
          players: fakePlayers,
        },
      },
      _joinOptions: {
        isHost: nextJoinIsHost,
        trackId: 'cave',
        arenaId: 'cave',
        battleType: 'ctf',
        loadoutId: 'classic',
        scoreLimit: 5,
        botCount: 0,
      },
      _postGameSettingsChanged: false,
      _postGamePlayerRefresh: null,
    };

    ColyseusBabylonClient.prototype._showMatchEndScreen.call(fakeClient, {
      mode: 'battle',
      winnerId: 'battle-host-session',
      winner: 'Host',
      standings: [
        { sessionId: 'battle-host-session', name: 'Host', score: 3, deaths: 1 },
        { sessionId: 'battle-guest-session', name: 'Guest', score: 1, deaths: 3 },
      ],
    });
  }, {
    nextRoomSessionId: roomSessionId,
    nextJoinIsHost: joinIsHost,
  });

  await page.waitForSelector('#_glo-match-end', { timeout: 5000 });
  await wait(1200);
}

async function readOverlayState(page) {
  return page.evaluate(() => {
    const overlay = document.getElementById('_glo-match-end');
    if (!overlay) throw new Error('Post-game overlay missing');

    return {
      text: overlay.textContent || '',
      controlsDisabled: [...overlay.querySelectorAll('select, input')].map((control) => control.disabled),
      sessionPlayerId: sessionStorage.getItem('myPlayerId'),
      localPlayerId: localStorage.getItem('myPlayerId'),
      gameConfig: JSON.parse(sessionStorage.getItem('gameConfig') || '{}'),
    };
  });
}

async function run() {
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext();
  const host = await context.newPage();
  const guest = await context.newPage();

  const hostLobbyId = 'lobby-host';
  const guestLobbyId = 'lobby-guest';
  const gameConfig = {
    players: [
      { id: hostLobbyId, name: 'Host', isHost: true },
      { id: guestLobbyId, name: 'Guest', isHost: false },
    ],
  };
  const summary = { ok: true };

  try {
    await preparePage(host, {
      sessionPlayerId: hostLobbyId,
      localPlayerId: hostLobbyId,
      gameConfig,
    });
    await preparePage(guest, {
      sessionPlayerId: guestLobbyId,
      localPlayerId: guestLobbyId,
      gameConfig,
    });

    await renderPostGameOverlay(host, {
      roomSessionId: 'battle-host-session',
      joinIsHost: true,
    });
    await renderPostGameOverlay(guest, {
      roomSessionId: 'battle-guest-session',
      joinIsHost: false,
    });

    const hostState = await readOverlayState(host);
    const guestState = await readOverlayState(guest);

    summary.host = hostState;
    summary.guest = guestState;

    assert(hostState.sessionPlayerId === hostLobbyId, 'Host tab should keep the host lobby ID in sessionStorage');
    assert(guestState.sessionPlayerId === guestLobbyId, 'Guest tab should keep the guest lobby ID in sessionStorage');
    assert(hostState.localPlayerId === guestLobbyId, 'Shared localStorage should reflect the guest tab overwrite');
    assert(hostState.sessionPlayerId !== hostState.localPlayerId, 'Host sessionStorage must differ from shared localStorage in the regression case');
    assert(hostState.gameConfig?.players?.some((player) => player.id === hostState.sessionPlayerId && player.isHost), 'Host sessionStorage ID should still resolve to the host player in gameConfig');
    assert(hostState.text.includes('NEXT MATCH SETTINGS'), 'Host overlay should render editable next-match settings');
    assert(!hostState.text.includes('Waiting for host to configure'), 'Host overlay should not show the guest waiting note');
    assert(hostState.controlsDisabled.length > 0, 'Host overlay should render settings controls');
    assert(hostState.controlsDisabled.every((disabled) => disabled === false), 'Host controls should be enabled');
    assert(guestState.text.includes('MATCH SETTINGS'), 'Guest overlay should render match settings');
    assert(guestState.text.includes('Waiting for host to configure'), 'Guest overlay should show the waiting note');
    assert(guestState.controlsDisabled.length > 0, 'Guest overlay should render settings controls');
    assert(guestState.controlsDisabled.every((disabled) => disabled === true), 'Guest controls should remain disabled');

    console.log('POSTGAME_HOST_SETTINGS_REGRESSION', JSON.stringify(summary, null, 2));
  } catch (error) {
    summary.ok = false;
    summary.error = String(error?.message || error);
    console.error('POSTGAME_HOST_SETTINGS_REGRESSION', JSON.stringify(summary, null, 2));
    process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
  }
}

run().catch((error) => {
  console.error(
    'POSTGAME_HOST_SETTINGS_REGRESSION',
    JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2),
  );
  process.exit(1);
});