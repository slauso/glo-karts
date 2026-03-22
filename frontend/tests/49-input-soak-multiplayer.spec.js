import { test, expect } from '@playwright/test';
import {
  injectGameConfig,
  waitForDebug,
  waitForMatchLive,
  isCriticalError,
  BATTLE_CONFIG,
} from './helpers/game-helpers.js';

function withLobbyCode(config, label) {
  return {
    ...config,
    lobbyCode: `${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
  };
}

function planarDistance(a, b) {
  const dx = Number(b?.x || 0) - Number(a?.x || 0);
  const dz = Number(b?.z || 0) - Number(a?.z || 0);
  return Math.hypot(dx, dz);
}

async function readInputSnapshot(page) {
  return page.evaluate(() => {
    const client = window.__gloClient;
    const mesh = client?.localMesh;
    const selfId = client?.room?.sessionId;
    const self = selfId ? client?.authoritativeState?.players?.get?.(selfId) : null;
    return {
      pos: mesh?.position ? {
        x: Number(mesh.position.x || 0),
        y: Number(mesh.position.y || 0),
        z: Number(mesh.position.z || 0),
      } : null,
      spawnPos: window.__gloDebug?.spawnPos || null,
      pendingInputs: Number(client?.pendingInputs?.length || 0),
      inputSeq: Number(client?.inputSeq || 0),
      ackSeq: Number(self?.lastProcessedInput || 0),
      health: Number(self?.health || client?._localHealth || 0),
      fps: Number(client?.engine?.getFps?.() || 0),
      performancePressure: Number(window.__gloDebug?.performanceBudget?.pressure || 0),
      matchLive: !!window.__gloDebug?.matchLive,
      kartVisible: !!window.__gloDebug?.kartVisible,
      latestInput: client?._latestRealtimeInput ? {
        throttle: Number(client._latestRealtimeInput.throttle || 0),
        steer: Number(client._latestRealtimeInput.steer || 0),
        brake: !!client._latestRealtimeInput.brake,
        firePrimary: !!client._latestRealtimeInput.firePrimary,
        fireSecondary: !!client._latestRealtimeInput.fireSecondary,
      } : null,
    };
  });
}

async function waitForPendingInputsToDrain(page, maxPending = 40, timeout = 5_000) {
  await page.waitForFunction(
    (limit) => Number(window.__gloClient?.pendingInputs?.length || 0) <= Number(limit),
    maxPending,
    { timeout },
  );
}

async function waitForRespawn(page, expectedSpawn = null, timeout = 8_000) {
  await page.waitForFunction(
    (spawnOverride) => {
      const mesh = window.__gloClient?.localMesh;
      const spawnPos = spawnOverride || window.__gloDebug?.spawnPos;
      if (!mesh?.position || !spawnPos) return false;
      const dx = Number(mesh.position.x || 0) - Number(spawnPos.x || 0);
      const dz = Number(mesh.position.z || 0) - Number(spawnPos.z || 0);
      return (
        Number(window.__gloClient?._invulnTimer || 0) > 0
        && Number(mesh.position.y || 0) > -20
        && Number.isFinite(Number(mesh.position.x || 0))
        && Number.isFinite(Number(mesh.position.z || 0))
        && ((dx * dx + dz * dz) < 900 || window.__gloClient?._deathState == null)
      );
    },
    expectedSpawn,
    { timeout },
  );
}

async function triggerClientRespawn(page, timeout = 8_000) {
  await page.evaluate(() => {
    window.__gloClient?._resetInputState?.({ sendNeutral: true });
    window.__gloClient?.room?.send('debugRespawn', {});
  });
  await page.waitForFunction(() => !!window.__gloClient?._deathState, undefined, { timeout: 3_000 });
  await page.waitForFunction(() => Number(window.__gloClient?._invulnTimer || 0) > 0, undefined, { timeout });
  await waitForRespawn(page, null, timeout);
}

async function measurePagePing(page) {
  const startedAt = Date.now();
  await page.evaluate(() => performance.now());
  return Date.now() - startedAt;
}

async function stabilizeForegroundPage(page, settleMs = 250) {
  await page.bringToFront();
  await page.waitForTimeout(settleMs);
}

async function runControlBurst(page, label, cycle) {
  await stabilizeForegroundPage(page, 150);
  const pingBefore = await measurePagePing(page);
  const before = await readInputSnapshot(page);
  await page.keyboard.down('KeyW');
  await page.keyboard.down('Space');
  await page.waitForTimeout(300);
  await page.keyboard.down(cycle % 2 === 0 ? 'KeyD' : 'KeyA');
  await page.waitForTimeout(300);
  await page.keyboard.up(cycle % 2 === 0 ? 'KeyD' : 'KeyA');
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(350);
  await page.keyboard.up('KeyE');
  await page.waitForTimeout(550);
  await page.keyboard.up('Space');
  await page.keyboard.up('KeyW');

  await page.waitForTimeout(1500);
  await waitForPendingInputsToDrain(page, 64, 10_000);
  const pingAfter = await measurePagePing(page);
  const after = await readInputSnapshot(page);
  const moved = planarDistance(before.pos, after.pos);

  expect(after.matchLive, `${label} stays live`).toBe(true);
  expect(after.kartVisible, `${label} kart stays visible`).toBe(true);
  expect(moved, `${label} should still move after burst`).toBeGreaterThan(1.4);
  expect(after.pendingInputs, `${label} pending inputs should drain`).toBeLessThanOrEqual(64);
  expect(after.ackSeq, `${label} ack sequence should not regress`).toBeGreaterThanOrEqual(before.ackSeq);
  expect(after.inputSeq, `${label} input sequence should advance`).toBeGreaterThan(before.inputSeq);
  expect(pingBefore, `${label} pre-burst page ping should stay responsive`).toBeLessThan(2_000);
  expect(pingAfter, `${label} post-burst page ping should stay responsive`).toBeLessThan(2_000);
  expect(Number.isFinite(after.pos?.x), `${label} x finite`).toBe(true);
  expect(Number.isFinite(after.pos?.y), `${label} y finite`).toBe(true);
  expect(Number.isFinite(after.pos?.z), `${label} z finite`).toBe(true);

  return { before, after, moved, pingBefore, pingAfter };
}

test.describe.configure({ mode: 'serial' });
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

test('two-window soak keeps controls responsive through weapon spam and respawns', async ({ browser }) => {
  test.setTimeout(300_000);

  const roomConfig = withLobbyCode({ ...BATTLE_CONFIG, maxPlayers: 2, scoreLimit: 10 }, 'input-soak');
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const page1 = await ctx1.newPage();
  const page2 = await ctx2.newPage();

  const errors1 = [];
  const errors2 = [];
  page1.on('pageerror', (e) => errors1.push(e.message));
  page2.on('pageerror', (e) => errors2.push(e.message));

  const movementLog = [];

  try {
    await injectGameConfig(page1, { ...roomConfig, playerName: 'Soak-P1' });
    await page1.goto('/realtime.html');
    await page1.waitForTimeout(2000);
    await injectGameConfig(page2, { ...roomConfig, playerName: 'Soak-P2' });
    await page2.goto('/realtime.html');

    await Promise.all([
      waitForDebug(page1, (d) => d.roomJoined && d.kartLoaded, 30_000),
      waitForDebug(page2, (d) => d.roomJoined && d.kartLoaded, 30_000),
    ]);
    await waitForMatchLive([page1, page2], 45_000);

    for (let cycle = 0; cycle < 4; cycle += 1) {
      const p1Burst = await runControlBurst(page1, `P1 cycle ${cycle + 1}`, cycle);
      movementLog.push({ player: 'P1', cycle: cycle + 1, moved: Number(p1Burst.moved.toFixed(2)), pending: p1Burst.after.pendingInputs, ack: p1Burst.after.ackSeq, fps: Math.round(p1Burst.after.fps), pressure: Number(p1Burst.after.performancePressure.toFixed(2)), pingBefore: p1Burst.pingBefore, pingAfter: p1Burst.pingAfter });

      const p2Burst = await runControlBurst(page2, `P2 cycle ${cycle + 1}`, cycle + 1);
      movementLog.push({ player: 'P2', cycle: cycle + 1, moved: Number(p2Burst.moved.toFixed(2)), pending: p2Burst.after.pendingInputs, ack: p2Burst.after.ackSeq, fps: Math.round(p2Burst.after.fps), pressure: Number(p2Burst.after.performancePressure.toFixed(2)), pingBefore: p2Burst.pingBefore, pingAfter: p2Burst.pingAfter });

      await triggerClientRespawn(page1, 8_000);
      const p1PostRespawn = await runControlBurst(page1, `P1 post-respawn ${cycle + 1}`, cycle + 10);
      movementLog.push({ player: 'P1', cycle: cycle + 1.1, moved: Number(p1PostRespawn.moved.toFixed(2)), pending: p1PostRespawn.after.pendingInputs, ack: p1PostRespawn.after.ackSeq, fps: Math.round(p1PostRespawn.after.fps), pressure: Number(p1PostRespawn.after.performancePressure.toFixed(2)), pingBefore: p1PostRespawn.pingBefore, pingAfter: p1PostRespawn.pingAfter });

      await triggerClientRespawn(page2, 8_000);
      const p2PostRespawn = await runControlBurst(page2, `P2 post-respawn ${cycle + 1}`, cycle + 11);
      movementLog.push({ player: 'P2', cycle: cycle + 1.1, moved: Number(p2PostRespawn.moved.toFixed(2)), pending: p2PostRespawn.after.pendingInputs, ack: p2PostRespawn.after.ackSeq, fps: Math.round(p2PostRespawn.after.fps), pressure: Number(p2PostRespawn.after.performancePressure.toFixed(2)), pingBefore: p2PostRespawn.pingBefore, pingAfter: p2PostRespawn.pingAfter });
    }

    await waitForPendingInputsToDrain(page1, 24, 8_000);
    await waitForPendingInputsToDrain(page2, 24, 8_000);

    await stabilizeForegroundPage(page1);
    const final1 = await readInputSnapshot(page1);
    await stabilizeForegroundPage(page2);
    const final2 = await readInputSnapshot(page2);

    expect(final1.pendingInputs, 'P1 final pending inputs').toBeLessThanOrEqual(24);
    expect(final2.pendingInputs, 'P2 final pending inputs').toBeLessThanOrEqual(24);
    expect(final1.fps, 'P1 final FPS should stay alive').toBeGreaterThan(15);
    expect(final2.fps, 'P2 final FPS should stay alive').toBeGreaterThan(15);

    const crit1 = errors1.filter(isCriticalError);
    const crit2 = errors2.filter(isCriticalError);
    if (movementLog.length) console.log('[input-soak] movement summary:', JSON.stringify(movementLog, null, 2));
    if (crit1.length) console.warn('[input-soak] P1 critical errors:', crit1);
    if (crit2.length) console.warn('[input-soak] P2 critical errors:', crit2);
    expect(crit1, 'P1 critical runtime errors').toHaveLength(0);
    expect(crit2, 'P2 critical runtime errors').toHaveLength(0);
  } finally {
    await Promise.allSettled([
      ctx1.close(),
      ctx2.close(),
    ]);
  }
});
