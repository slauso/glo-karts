import { test, expect } from '@playwright/test';
import {
  injectGameConfig,
  waitForDebug,
  waitForMatchLive,
  readDebug,
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

async function setupBattlePair(browser, label = 'anomaly-battle') {
  const roomConfig = withLobbyCode(BATTLE_CONFIG, label);
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const page1 = await ctx1.newPage();
  const page2 = await ctx2.newPage();

  // Player 1 creates the room first to avoid split-room race under load.
  await injectGameConfig(page1, roomConfig);
  await page1.goto('/realtime.html');
  await waitForDebug(page1, (d) => d.roomJoined === true, 25_000);

  // Player 2 joins only after room creation is confirmed.
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
  const p1SessionId = await getSessionId(page1);
  const p2SessionId = await getSessionId(page2);
  return { ctx1, ctx2, page1, page2, p1SessionId, p2SessionId };
}

test.describe('Anomaly Weapon Regression', () => {
  test('gravity well spawns an authoritative zone projectile', async ({ browser }) => {
    const session = await setupBattlePair(browser, 'anomaly-gravity-well');
    const { ctx1, ctx2, page1, p1SessionId, p2SessionId } = session;
    try {
      await debugTeleportAuthoritative(page1, { x: 0, y: 2.5, z: 0, heading: 0 }, p1SessionId);
      await debugTeleportAuthoritative(page1, { x: 40, y: 2.5, z: 40, heading: Math.PI }, p2SessionId);
      await waitForAuthoritativePosition(page1, p1SessionId, { x: 0, y: 2.5, z: 0 }, 0.9, 5_000);
      await waitForAuthoritativePosition(page1, p2SessionId, { x: 40, y: 2.5, z: 40 }, 0.9, 5_000);

      await debugGrantWeapon(page1, 'gravity_well', p1SessionId);
      await waitForDebug(page1, (d) => d.weaponState?.weapon2 === 'gravity_well', 5_000);
      await fireCurrentWeapon(page1);
      await waitForDebug(page1, (d) => d.lastWeaponFired === 'gravity_well', 5_000);
      await expect.poll(async () => {
        const projectiles = await getActiveProjectiles(page1);
        return projectiles.filter((projectile) => projectile.subType === 'gravity_well').length;
      }, { timeout: 4_000 }).toBe(1);
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('mirror realm reflects incoming projectile back to the attacker', async ({ browser }) => {
    const session = await setupBattlePair(browser, 'anomaly-mirror');
    const { ctx1, ctx2, page1, page2, p1SessionId, p2SessionId } = session;
    try {
      await debugTeleportAuthoritative(page1, { x: 0, y: 2.5, z: 0, heading: 0 }, p1SessionId);
      await debugTeleportAuthoritative(page1, { x: 0, y: 2.5, z: 6, heading: Math.PI }, p2SessionId);
      await waitForAuthoritativePosition(page1, p1SessionId, { x: 0, y: 2.5, z: 0 }, 0.9, 5_000);
      await waitForAuthoritativePosition(page1, p2SessionId, { x: 0, y: 2.5, z: 6 }, 0.9, 5_000);

      await debugGrantWeapon(page2, 'mirror_realm', p2SessionId);
      await waitForDebug(page2, (d) => d.weaponState?.weapon2 === 'mirror_realm', 5_000);
      await fireCurrentWeapon(page2);
      await waitForDebug(page2, (d) => d.weaponState?.effectType === 'mirror', 5_000);

      await debugGrantWeapon(page1, 'missile', p1SessionId);
      await waitForDebug(page1, (d) => d.weaponState?.weapon2 === 'missile', 5_000);
      await fireCurrentWeapon(page1);

      await expect.poll(async () => {
        const debug = await readDebug(page1);
        const state = await getAuthoritativePlayerState(page1, p1SessionId);
        return debug.lastHitVictimId === p1SessionId || Number(state?.health ?? 100) < 100;
      }, { timeout: 6_000 }).toBe(true);
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('phase shift swaps positions with the nearest rival', async ({ browser }) => {
    const session = await setupBattlePair(browser, 'anomaly-phase');
    const { ctx1, ctx2, page1, page2, p1SessionId, p2SessionId } = session;
    try {
      await debugTeleportAuthoritative(page1, { x: 0, y: 2.5, z: 0, heading: 0 }, p1SessionId);
      await debugTeleportAuthoritative(page1, { x: 0, y: 2.5, z: 6, heading: Math.PI }, p2SessionId);
      await waitForAuthoritativePosition(page1, p1SessionId, { x: 0, y: 2.5, z: 0 }, 0.9, 5_000);
      await waitForAuthoritativePosition(page1, p2SessionId, { x: 0, y: 2.5, z: 6 }, 0.9, 5_000);

      const attackerBefore = await getAuthoritativePlayerState(page1, p1SessionId);
      const victimBefore = await getAuthoritativePlayerState(page2, p2SessionId);

      await debugGrantWeapon(page2, 'phase_shift', p2SessionId);
      await waitForDebug(page2, (d) => d.weaponState?.weapon2 === 'phase_shift', 5_000);
      await fireCurrentWeapon(page2);
      await waitForDebug(page2, (d) => d.lastEffect === 'phase_shift_swap', 5_000);

      await expect.poll(async () => {
        const attackerAfter = await getAuthoritativePlayerState(page1, p1SessionId);
        const victimAfter = await getAuthoritativePlayerState(page2, p2SessionId);
        if (!attackerAfter || !victimAfter || !attackerBefore || !victimBefore) return false;

        const attackerMovedToVictim =
          Math.abs((attackerAfter.x ?? 0) - (victimBefore.x ?? 0)) < 0.75 &&
          Math.abs((attackerAfter.z ?? 0) - (victimBefore.z ?? 0)) < 0.75;
        const victimMovedToAttacker =
          Math.abs((victimAfter.x ?? 0) - (attackerBefore.x ?? 0)) < 0.75 &&
          Math.abs((victimAfter.z ?? 0) - (attackerBefore.z ?? 0)) < 0.75;

        return attackerMovedToVictim && victimMovedToAttacker;
      }, { timeout: 5_000 }).toBe(true);

      const attackerAfter = await getAuthoritativePlayerState(page1, p1SessionId);
      const victimAfter = await getAuthoritativePlayerState(page2, p2SessionId);
      expect(attackerAfter?.health).toBe(100);
      expect(victimAfter?.health).toBe(100);
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('pirateleportation steals the nearest rival weapon into the attacker inventory', async ({ browser }) => {
    const session = await setupBattlePair(browser, 'anomaly-pirate');
    const { ctx1, ctx2, page1, page2, p1SessionId, p2SessionId } = session;
    try {
      await debugTeleportAuthoritative(page1, { x: 0, y: 2.5, z: 0, heading: 0 }, p1SessionId);
      await debugTeleportAuthoritative(page1, { x: 0, y: 2.5, z: 4, heading: Math.PI }, p2SessionId);
      await waitForAuthoritativePosition(page1, p1SessionId, { x: 0, y: 2.5, z: 0 }, 0.9, 5_000);
      await waitForAuthoritativePosition(page1, p2SessionId, { x: 0, y: 2.5, z: 4 }, 0.9, 5_000);

      await debugGrantWeapon(page2, 'bowling_ball', p2SessionId);
      await waitForDebug(page2, (d) => d.weaponState?.weapon2 === 'bowling_ball', 5_000);

      await debugGrantWeapon(page1, 'pirateleportation', p1SessionId);
      await waitForDebug(page1, (d) => d.weaponState?.weapon2 === 'pirateleportation', 5_000);
      await fireCurrentWeapon(page1);

      await expect.poll(async () => {
        const state = await getAuthoritativePlayerState(page1, p1SessionId);
        return `${state?.weapon2 || ''}:${state?.ammo2 ?? -1}`;
      }, { timeout: 5_000 }).toBe('bowling_ball:1');

      const victimState = await getAuthoritativePlayerState(page2, p2SessionId);
      const attackerDebug = await readDebug(page1);
      expect(attackerDebug.lastEffect).toBe('pirateleportation');
      expect(victimState?.weapon2).toBe('');
      expect(victimState?.ammo2).toBe(0);
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('weather dominion publishes an arena-wide anomaly effect', async ({ browser }) => {
    const session = await setupBattlePair(browser, 'anomaly-weather');
    const { ctx1, ctx2, page1, page2, p1SessionId } = session;
    try {
      await debugTeleportAuthoritative(page1, { x: 0, y: 2.5, z: 0, heading: 0 }, p1SessionId);
      await waitForAuthoritativePosition(page1, p1SessionId, { x: 0, y: 2.5, z: 0 }, 0.9, 5_000);

      await debugGrantWeapon(page1, 'weather_dominion', p1SessionId);
      await waitForDebug(page1, (d) => d.weaponState?.weapon2 === 'weather_dominion', 5_000);
      await fireCurrentWeapon(page1);

      await expect.poll(async () => (await readDebug(page1)).lastArenaEffect, { timeout: 5_000 }).toMatch(/^arena_(fog|rain)$/);
      await expect.poll(async () => (await readDebug(page2)).lastArenaEffect, { timeout: 5_000 }).toMatch(/^arena_(fog|rain)$/);

      const overlayVisible = await page1.evaluate(() => !!window.__gloClient?._arenaEffectOverlayEl);
      expect(overlayVisible).toBe(true);
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });
});
