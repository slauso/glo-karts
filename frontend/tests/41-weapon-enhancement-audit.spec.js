import { test, expect } from '@playwright/test';
import {
  injectGameConfig,
  waitForDebug,
  waitForMatchLive,
  BATTLE_CONFIG,
  debugGrantWeapon,
  debugTeleportAuthoritative,
  getSessionId,
  getRoomId,
  getAuthoritativePlayerState,
  getActiveProjectiles,
  fireCurrentWeapon,
  waitForAuthoritativePosition,
} from './helpers/game-helpers.js';

function withLobbyCode(config, label) {
  return {
    ...config,
    lobbyCode: `${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
  };
}

async function setupBattlePair(browser, label = 'weapon-audit') {
  const roomConfig = withLobbyCode(BATTLE_CONFIG, label);
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const page1 = await ctx1.newPage();
  const page2 = await ctx2.newPage();

  await injectGameConfig(page1, roomConfig);
  await page1.goto('/realtime.html');
  await waitForDebug(page1, (d) => d.roomJoined === true, 25_000);

  await injectGameConfig(page2, roomConfig);
  await page2.goto('/realtime.html');
  await waitForDebug(page2, (d) => d.roomJoined === true, 25_000);

  await waitForMatchLive([page1, page2], 75_000);
  await Promise.all([
    waitForDebug(page1, (d) => Number(d.playerCount || 0) >= 2, 20_000),
    waitForDebug(page2, (d) => Number(d.playerCount || 0) >= 2, 20_000),
  ]);
  const [roomId1, roomId2] = await Promise.all([getRoomId(page1), getRoomId(page2)]);
  expect(roomId1).toBeTruthy();
  expect(roomId1).toBe(roomId2);

  return {
    ctx1,
    ctx2,
    page1,
    page2,
    p1SessionId: await getSessionId(page1),
    p2SessionId: await getSessionId(page2),
  };
}

async function positionPlayersForLineAttack(page, attackerId, victimId, distance = 8) {
  const attackerPos = { x: 0, y: 2.5, z: 0, heading: 0 };
  const victimPos = { x: 0, y: 2.5, z: distance, heading: Math.PI };
  await debugTeleportAuthoritative(page, attackerPos, attackerId);
  await debugTeleportAuthoritative(page, victimPos, victimId);
  await waitForAuthoritativePosition(page, attackerId, attackerPos, 0.9, 5_000);
  await waitForAuthoritativePosition(page, victimId, victimPos, 0.9, 5_000);
}

async function waitForLock(page, targetId) {
  await expect.poll(async () => page.evaluate((expectedTargetId) => {
    const client = window.__gloClient;
    const reticle = document.getElementById('lock-reticle');
    return {
      targetId: client?._missileLockTargetId || null,
      locked: !!client?._missileLockState?.locked,
      reticleVisible: !!reticle && reticle.style.display !== 'none',
    };
  }, targetId), { timeout: 6_000 }).toMatchObject({
    targetId,
    locked: true,
    reticleVisible: true,
  });
}

async function fireRepeated(page, slot, shots, delayMs = 70) {
  for (let i = 0; i < shots; i += 1) {
    await fireCurrentWeapon(page, slot);
    await page.waitForTimeout(delayMs);
  }
}

async function expectHealthDrop(page, targetId, previousHealth, timeout = 6_000) {
  await expect.poll(async () => {
    const state = await getAuthoritativePlayerState(page, targetId);
    return Number(state?.health ?? previousHealth);
  }, { timeout }).toBeLessThan(previousHealth);
}

test.describe.configure({ mode: 'serial' });

test.describe('Weapon Enhancement Audit', () => {
  test('missile and lightning bolt lock on, show reticle feedback, and damage a rival', async ({ browser }) => {
    test.setTimeout(240_000);
    const session = await setupBattlePair(browser, 'weapon-lock-audit');
    const { ctx1, ctx2, page1, page2, p1SessionId, p2SessionId } = session;

    try {
      await positionPlayersForLineAttack(page1, p1SessionId, p2SessionId, 14);

      await debugGrantWeapon(page1, 'missile', p1SessionId);
      await waitForDebug(page1, (d) => d.weaponState?.weapon2 === 'missile', 5_000);
      await waitForLock(page1, p2SessionId);

      const missileTargetBefore = await getAuthoritativePlayerState(page2, p2SessionId);
      await fireCurrentWeapon(page1);
      await waitForDebug(page1, (d) => d.lastWeaponFired === 'missile', 5_000);
      await expectHealthDrop(page2, p2SessionId, Number(missileTargetBefore?.health ?? 100), 7_000);

      await positionPlayersForLineAttack(page1, p1SessionId, p2SessionId, 10);

      await debugGrantWeapon(page1, 'lightning_bolt', p1SessionId);
      await waitForDebug(page1, (d) => d.weaponState?.weapon2 === 'lightning_bolt', 5_000);
      await waitForLock(page1, p2SessionId);

      const lightningTargetBefore = await getAuthoritativePlayerState(page2, p2SessionId);
      await fireCurrentWeapon(page1);
      await waitForDebug(page1, (d) => d.lastWeaponFired === 'lightning_bolt', 5_000);
      await expectHealthDrop(page2, p2SessionId, Number(lightningTargetBefore?.health ?? 100), 5_000);
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('glo burst primary fire and glow thrower stream both deal sustained close-range damage', async ({ browser }) => {
    test.setTimeout(150_000);
    const session = await setupBattlePair(browser, 'weapon-stream-audit');
    const { ctx1, ctx2, page1, page2, p1SessionId, p2SessionId } = session;

    try {
      await positionPlayersForLineAttack(page1, p1SessionId, p2SessionId, 5);

      const primaryBefore = await getAuthoritativePlayerState(page2, p2SessionId);
      await fireRepeated(page1, 'primary', 10, 55);
      await waitForDebug(page1, (d) => d.lastWeaponFired === 'glo_burst', 5_000);
      await expectHealthDrop(page2, p2SessionId, Number(primaryBefore?.health ?? 100), 5_000);

      await positionPlayersForLineAttack(page1, p1SessionId, p2SessionId, 6);

      await debugGrantWeapon(page1, 'glow_thrower', p1SessionId);
      await waitForDebug(page1, (d) => d.weaponState?.weapon2 === 'glow_thrower', 5_000);

      const throwerBefore = await getAuthoritativePlayerState(page2, p2SessionId);
      await fireRepeated(page1, 'secondary', 6, 65);
      await waitForDebug(page1, (d) => d.lastWeaponFired === 'glow_thrower', 5_000);
      await expectHealthDrop(page2, p2SessionId, Number(throwerBefore?.health ?? 100), 5_000);
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('fireball and rock barrage both land authoritative hits, and rock barrage stays a single boulder', async ({ browser }) => {
    test.setTimeout(150_000);
    const session = await setupBattlePair(browser, 'weapon-impact-audit');
    const { ctx1, ctx2, page1, page2, p1SessionId, p2SessionId } = session;

    try {
      await positionPlayersForLineAttack(page1, p1SessionId, p2SessionId, 10);

      await debugGrantWeapon(page1, 'fireball', p1SessionId);
      await waitForDebug(page1, (d) => d.weaponState?.weapon2 === 'fireball', 5_000);

      const fireballBefore = await getAuthoritativePlayerState(page2, p2SessionId);
      await fireCurrentWeapon(page1);
      await waitForDebug(page1, (d) => d.lastWeaponFired === 'fireball', 5_000);
      await expectHealthDrop(page2, p2SessionId, Number(fireballBefore?.health ?? 100), 5_000);

      await positionPlayersForLineAttack(page1, p1SessionId, p2SessionId, 7);

      await debugGrantWeapon(page1, 'rock_barrage', p1SessionId);
      await waitForDebug(page1, (d) => d.weaponState?.weapon2 === 'rock_barrage', 5_000);

      const rockBefore = await getAuthoritativePlayerState(page2, p2SessionId);
      await fireCurrentWeapon(page1);
      await waitForDebug(page1, (d) => d.lastWeaponFired === 'rock_barrage', 5_000);
      let maxObservedRocks = 0;
      for (let i = 0; i < 5; i += 1) {
        const rocks = (await getActiveProjectiles(page1)).filter((projectile) => projectile.subType === 'rock_barrage');
        maxObservedRocks = Math.max(maxObservedRocks, rocks.length);
        await page1.waitForTimeout(180);
      }
      expect(maxObservedRocks).toBeLessThanOrEqual(1);
      await expectHealthDrop(page2, p2SessionId, Number(rockBefore?.health ?? 100), 10_000);
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('Final Fusion spawns a timed bomb and damages every kart inside the blast radius', async ({ browser }) => {
    test.setTimeout(150_000);
    const session = await setupBattlePair(browser, 'weapon-final-fusion-audit');
    const { ctx1, ctx2, page1, page2, p1SessionId, p2SessionId } = session;

    try {
      await positionPlayersForLineAttack(page1, p1SessionId, p2SessionId, 8);

      await debugGrantWeapon(page1, 'super_nova', p1SessionId);
      await waitForDebug(page1, (d) => d.weaponState?.weapon2 === 'super_nova', 5_000);

      const attackerBefore = await getAuthoritativePlayerState(page1, p1SessionId);
      const victimBefore = await getAuthoritativePlayerState(page2, p2SessionId);

      await fireCurrentWeapon(page1);
      await waitForDebug(page1, (d) => d.lastWeaponFired === 'super_nova', 5_000);
      await expect.poll(async () => {
        const fusionProjectiles = (await getActiveProjectiles(page1)).filter((projectile) => projectile.subType === 'super_nova');
        return fusionProjectiles.length;
      }, { timeout: 3_000 }).toBe(1);

      await expectHealthDrop(page1, p1SessionId, Number(attackerBefore?.health ?? 100), 8_000);
      await expectHealthDrop(page2, p2SessionId, Number(victimBefore?.health ?? 100), 8_000);
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });
});
