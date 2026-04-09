/**
 * builder-multiplayer-two-page-regression.mjs
 *
 * Verifies that two isolated browser clients can join the same builder-generated
 * custom battle arena room and that remote kart movement is visible on the host.
 *
 * Run:
 *   node scripts/builder-multiplayer-two-page-regression.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';
const HEADLESS = String(process.env.HEADLESS || 'false').toLowerCase() === 'true';
const REPORT_DIR = path.resolve(process.cwd(), 'test-results');
const PARTY_CODE = 'builder-duo';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function distance2d(a, b) {
  if (!a || !b) return 0;
  return Math.hypot(Number(a.x || 0) - Number(b.x || 0), Number(a.z || 0) - Number(b.z || 0));
}

const CUSTOM_ARENA_DATA = Object.freeze({
  version: 1,
  name: 'Two Client Builder Arena',
  author: 'Builder v2',
  builderPreset: 'arena',
  roadCells: [
    { id: 1, position: { x: -10, y: 0, z: 0 } },
    { id: 2, position: { x: 0, y: 0, z: 0 } },
    { id: 3, position: { x: 10, y: 0, z: 0 } },
    { id: 4, position: { x: 0, y: 0, z: 10 } },
  ],
  segments: [
    { id: 1, type: 'flat_wide', position: { x: -10, y: 0, z: 0 }, rotation: 0, scale: 1 },
    { id: 2, type: 'flat_wide', position: { x: 0, y: 0, z: 0 }, rotation: 0, scale: 1 },
    { id: 3, type: 'flat_wide', position: { x: 10, y: 0, z: 0 }, rotation: 0, scale: 1 },
    { id: 4, type: 'straight', position: { x: 0, y: 0, z: 10 }, rotation: 0, scale: 1 },
    { id: 5, type: 'curve_right', position: { x: -20, y: 0, z: 20 }, rotation: 180, scale: 1 },
    { id: 6, type: 'curve_right', position: { x: 20, y: 0, z: 20 }, rotation: 270, scale: 1 },
    { id: 7, type: 'ramp_up', position: { x: -10, y: 0, z: 20 }, rotation: 0, scale: 1 },
    { id: 8, type: 'ramp_down', position: { x: 10, y: 0, z: 20 }, rotation: 0, scale: 1 },
  ],
  checkpoints: [],
  startPositions: [
    { id: 9, position: { x: -10, y: 0, z: -10 }, heading: 0 },
    { id: 10, position: { x: 10, y: 0, z: -10 }, heading: Math.PI },
  ],
  obstacles: [
    { id: 11, type: 'item_box', position: { x: -10, y: 0, z: 15 } },
    { id: 12, type: 'boost_pad', position: { x: 0, y: 0, z: 15 } },
    { id: 13, type: 'barrier', position: { x: 10, y: 0, z: 15 } },
    { id: 14, type: 'banana', position: { x: 20, y: 0, z: 15 } },
  ],
  bounds: {
    min: { x: -40, y: 0, z: -20 },
    max: { x: 40, y: 10, z: 40 },
  },
  playtestMode: 'battle',
});

function buildGameConfig(playerId, roomId = '') {
  const customTrackData = JSON.stringify(CUSTOM_ARENA_DATA);
  return {
    playerId,
    customTrackData,
    gameConfig: {
      gameMode: 'battle',
      battleType: 'deathmatch',
      trackId: 'custom_import',
      arenaId: 'custom_import',
      modeId: 'battle_online',
      resolvedContentId: 'custom_import',
      multiplayer: true,
      multiplayerProvider: 'colyseus',
      partyCode: PARTY_CODE,
      lobbyCode: PARTY_CODE,
      roomId,
      builderPlaytest: true,
      builderPreset: 'arena',
      maxPlayers: 2,
      players: [
        { id: 'two-client-host', name: 'Host Two', isHost: true },
        { id: 'two-client-guest', name: 'Guest Two', isHost: false },
      ],
      customTrackData,
    },
    builderMeta: {
      name: CUSTOM_ARENA_DATA.name,
      author: CUSTOM_ARENA_DATA.author,
      preset: 'arena',
      mode: 'battle',
      segmentCount: CUSTOM_ARENA_DATA.segments.length,
      roadCellCount: CUSTOM_ARENA_DATA.roadCells.length,
      obstacleCount: CUSTOM_ARENA_DATA.obstacles.length,
      spawnCount: CUSTOM_ARENA_DATA.startPositions.length,
    },
  };
}

async function stageClient(page, config) {
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((payload) => {
    sessionStorage.clear();
    sessionStorage.setItem('myPlayerId', payload.playerId);
    sessionStorage.setItem('gameConfig', JSON.stringify(payload.gameConfig));
    sessionStorage.setItem('customTrackData', payload.customTrackData);
    sessionStorage.setItem('builderPlaytestMeta', JSON.stringify(payload.builderMeta));
    sessionStorage.setItem('gloBuilderPlaytestMeta', JSON.stringify(payload.builderMeta));
  }, config);
  await page.goto(`${BASE_URL}/realtime.html?map=custom_import&mode=battle&fromBuilder=1&builderPlaytest=1`, {
    waitUntil: 'domcontentloaded',
  });
}

async function waitForLive(page, label) {
  const timeoutAt = Date.now() + 45000;
  let summary = null;

  while (Date.now() < timeoutAt) {
    summary = await page.evaluate(() => {
      const client = window.__gloClient;
      const loading = document.getElementById('loading-screen');
      const authoritativePlayers = client?.authoritativeState?.players
        ? Array.from(client.authoritativeState.players.entries()).map(([id, player]) => ({
            id,
            x: player.x,
            y: player.y,
            z: player.z,
          }))
        : [];
      const remoteMeshes = client?.remoteMeshes
        ? Array.from(client.remoteMeshes.entries()).map(([id, mesh]) => ({
            id,
            name: mesh?.name || '',
            x: mesh?.position?.x ?? null,
            y: mesh?.position?.y ?? null,
            z: mesh?.position?.z ?? null,
          }))
        : [];

      return {
        roomId: client?.room?.roomId || window.__gloPlaytestState?.roomId || null,
        playerCount: authoritativePlayers.length,
        sessionId: client?.room?.sessionId || null,
        started: !!client?.started,
        loadingHidden: !!loading && getComputedStyle(loading).display === 'none',
        authoritativePlayers,
        remoteMeshes,
      };
    });

    const remotesReady = summary.remoteMeshes.length > 0
      && summary.remoteMeshes.every((mesh) => !String(mesh?.name || '').includes('placeholder'));
    const liveReady = !!summary.roomId
      && summary.started
      && summary.playerCount >= 2
      && summary.loadingHidden
      && remotesReady;

    if (liveReady) {
      await wait(1500);
      break;
    }

    await wait(500);
  }

  if (!summary) {
    throw new Error(`${label}: failed to capture live-room summary`);
  }

  const remotesReady = summary.remoteMeshes.length > 0
    && summary.remoteMeshes.every((mesh) => !String(mesh?.name || '').includes('placeholder'));
  if (!summary.roomId || !summary.started || summary.playerCount < 2 || !summary.loadingHidden || !remotesReady) {
    throw new Error(`${label}: live wait failed ${JSON.stringify(summary)}`);
  }

  summary = await page.evaluate(() => {
    const client = window.__gloClient;
    const authoritativePlayers = client?.authoritativeState?.players
      ? Array.from(client.authoritativeState.players.entries()).map(([id, player]) => ({
          id,
          x: player.x,
          y: player.y,
          z: player.z,
        }))
      : [];
    return {
      roomId: client?.room?.roomId || window.__gloPlaytestState?.roomId || null,
      playerCount: authoritativePlayers.length,
      sessionId: client?.room?.sessionId || null,
      started: !!client?.started,
      authoritativePlayers,
    };
  });

  assert(summary.roomId, `${label}: missing room id`);
  assert(summary.started, `${label}: match never started`);
  assert(summary.playerCount === 2, `${label}: expected playerCount 2, got ${summary.playerCount}`);
  assert(summary.authoritativePlayers.length === 2, `${label}: expected 2 authoritative players, got ${summary.authoritativePlayers.length}`);
  return summary;
}

async function captureState(page) {
  return page.evaluate(() => {
    const client = window.__gloClient;
    const authoritativePlayers = client?.authoritativeState?.players
      ? Array.from(client.authoritativeState.players.entries()).map(([id, player]) => ({
          id,
          x: player.x,
          y: player.y,
          z: player.z,
        }))
      : [];
    const remoteMeshes = client?.remoteMeshes
      ? Array.from(client.remoteMeshes.entries()).map(([id, mesh]) => ({
          id,
          x: mesh.position.x,
          y: mesh.position.y,
          z: mesh.position.z,
        }))
      : [];
    const local = client?.localMesh
      ? { x: client.localMesh.position.x, y: client.localMesh.position.y, z: client.localMesh.position.z }
      : null;
    return {
      authoritativePlayers,
      remoteMeshes,
      local,
      roomId: client?.room?.roomId || window.__gloPlaytestState?.roomId || null,
      started: !!client?.started,
      url: window.location.href,
      playtestState: window.__gloPlaytestState || null,
    };
  });
}

async function run() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ['--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const hostContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const guestContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const hostPage = await hostContext.newPage();
  const guestPage = await guestContext.newPage();
  const errors = [];

  const attachDiagnostics = (page, label) => {
    page.on('pageerror', (error) => errors.push(`${label} pageerror: ${error.message}`));
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (/WebSocket is already in CLOSING or CLOSED state/i.test(text)) return;
      errors.push(`${label} console: ${text}`);
    });
  };

  attachDiagnostics(hostPage, 'host');
  attachDiagnostics(guestPage, 'guest');

  try {
    await stageClient(hostPage, buildGameConfig('two-client-host'));
    await hostPage.waitForFunction(() => !!window.__gloClient?.room?.roomId, { timeout: 45000 });
    const hostRoomId = await hostPage.evaluate(() => window.__gloClient?.room?.roomId || null);
    assert(hostRoomId, 'host: missing room id after connect');
    await wait(1000);
    await stageClient(guestPage, buildGameConfig('two-client-guest', hostRoomId));

    const hostLive = await waitForLive(hostPage, 'host');
    const guestLive = await waitForLive(guestPage, 'guest');

    assert(hostLive.roomId === guestLive.roomId, `expected same room id, got ${hostLive.roomId} vs ${guestLive.roomId}`);

    const hostBefore = await captureState(hostPage);
    const guestBefore = await captureState(guestPage);

    await guestPage.evaluate(async () => {
      const client = window.__gloClient;
      if (!client) throw new Error('guest client missing');
      for (let tick = 0; tick < 72; tick += 1) {
        client.sendInput({ throttle: 1, steer: 0, brake: 0, fire: false });
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
      client.sendInput({ throttle: 0, steer: 0, brake: 0, fire: false });
    });
    await wait(2500);

    const hostAfter = await captureState(hostPage);
    const guestAfter = await captureState(guestPage);

    assert(hostAfter.roomId === guestAfter.roomId, `room diverged after movement: ${hostAfter.roomId} vs ${guestAfter.roomId}`);

    const hostRemoteBefore = hostBefore.remoteMeshes.find((mesh) => mesh.id === guestLive.sessionId) || null;
    const hostRemoteAfter = hostAfter.remoteMeshes.find((mesh) => mesh.id === guestLive.sessionId) || null;
    const guestAuthoritativeBefore = guestBefore.authoritativePlayers.find((player) => player.id === guestLive.sessionId) || null;
    const guestAuthoritativeAfter = guestAfter.authoritativePlayers.find((player) => player.id === guestLive.sessionId) || null;
    const hostAuthoritativeRemoteBefore = hostBefore.authoritativePlayers.find((player) => player.id === guestLive.sessionId) || null;
    const hostAuthoritativeRemoteAfter = hostAfter.authoritativePlayers.find((player) => player.id === guestLive.sessionId) || null;
    assert(guestAuthoritativeBefore && guestAuthoritativeAfter && hostAuthoritativeRemoteBefore && hostAuthoritativeRemoteAfter, 'missing guest authoritative player state');
    assert(distance2d(guestAuthoritativeBefore, guestAuthoritativeAfter) > 5, `expected guest authoritative movement > 5 units, got ${distance2d(guestAuthoritativeBefore, guestAuthoritativeAfter).toFixed(2)}`);
    assert(distance2d(hostAuthoritativeRemoteBefore, hostAuthoritativeRemoteAfter) > 5, `expected host authoritative remote movement > 5 units, got ${distance2d(hostAuthoritativeRemoteBefore, hostAuthoritativeRemoteAfter).toFixed(2)}`);
    assert(hostRemoteBefore && hostRemoteAfter, 'missing host remote mesh state');
    assert(distance2d(hostRemoteBefore, hostRemoteAfter) > 5, `expected host remote visual movement > 5 units, got ${distance2d(hostRemoteBefore, hostRemoteAfter).toFixed(2)}`);
    const remoteErrorBefore = distance2d(hostRemoteBefore, hostAuthoritativeRemoteBefore);
    const remoteErrorAfter = distance2d(hostRemoteAfter, hostAuthoritativeRemoteAfter);
    assert(remoteErrorAfter < remoteErrorBefore, `expected host remote visual to move toward authoritative state, got ${remoteErrorBefore.toFixed(2)} -> ${remoteErrorAfter.toFixed(2)}`);

    if (errors.length) throw new Error(errors[0]);

    console.log(JSON.stringify({
      roomId: hostAfter.roomId,
      hostSessionId: hostLive.sessionId,
      guestSessionId: guestLive.sessionId,
      hostRemoteBefore,
      hostRemoteAfter,
      guestAuthoritativeBefore,
      guestAuthoritativeAfter,
      hostAuthoritativeRemoteBefore,
      hostAuthoritativeRemoteAfter,
      hostRemoteMoved2d: Number(distance2d(hostRemoteBefore, hostRemoteAfter).toFixed(2)),
      remoteAuthoritativeDelta2d: Number(distance2d(hostRemoteAfter, hostAuthoritativeRemoteAfter).toFixed(2)),
      remoteErrorImprovement2d: Number((remoteErrorBefore - remoteErrorAfter).toFixed(2)),
    }, null, 2));
  } finally {
    await hostPage.screenshot({ path: path.join(REPORT_DIR, 'builder-multiplayer-host.png'), fullPage: true }).catch(() => {});
    await guestPage.screenshot({ path: path.join(REPORT_DIR, 'builder-multiplayer-guest.png'), fullPage: true }).catch(() => {});
    await hostContext.close().catch(() => {});
    await guestContext.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

run().catch((error) => {
  console.error('[builder-multiplayer-two-page-regression] failed:', error?.message || error);
  process.exit(1);
});