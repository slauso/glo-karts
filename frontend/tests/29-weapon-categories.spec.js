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
  getProjectileSubTypes,
  fireCurrentWeapon,
} from './helpers/game-helpers.js';

test.describe.configure({ mode: 'serial' });

function withLobbyCode(config, label) {
  return {
    ...config,
    lobbyCode: `${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
  };
}

async function setupBattlePair(browser) {
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const page1 = await ctx1.newPage();
  const page2 = await ctx2.newPage();

  const roomConfig = withLobbyCode(BATTLE_CONFIG, 'weapon-regression');

  // Player 1 navigates first and must finish room creation before Player 2 joins
  await injectGameConfig(page1, { ...roomConfig, playerName: 'Weapon-P1' });
  await page1.goto('/realtime.html');
  await waitForDebug(page1, (d) => d.roomJoined === true, 25_000);

  // Player 2 joins AFTER Player 1's room exists — prevents split-room race
  await injectGameConfig(page2, { ...roomConfig, playerName: 'Weapon-P2' });
  await page2.goto('/realtime.html');
  await waitForDebug(page2, (d) => d.roomJoined === true, 25_000);

  await waitForMatchLive([page1, page2], 30_000);
  await Promise.all([
    waitForDebug(page1, (d) => Number(d.playerCount || 0) >= 2, 10_000),
    waitForDebug(page2, (d) => Number(d.playerCount || 0) >= 2, 10_000),
  ]);
  const p1SessionId = await getSessionId(page1);
  const p2SessionId = await getSessionId(page2);
  return { ctx1, ctx2, page1, page2, p1SessionId, p2SessionId };
}

test.describe('Weapon Category Regression', () => {
  test('projectile effects apply to the victim', async ({ browser }) => {
    const session = await setupBattlePair(browser);
    const { ctx1, ctx2, page1, page2, p1SessionId, p2SessionId } = session;
    try {
      await debugTeleportAuthoritative(page1, { x: 0, y: 2.5, z: 0, heading: 0 }, p1SessionId);
      await debugTeleportAuthoritative(page1, { x: 0, y: 2.5, z: 5, heading: Math.PI }, p2SessionId);
      await page1.waitForTimeout(250);

      await debugGrantWeapon(page1, 'plunger', p1SessionId);
      await waitForDebug(page1, (d) => d.weaponState?.weapon2 === 'plunger', 5_000);
      await fireCurrentWeapon(page1);

      await waitForDebug(page2, (d) => d.lastEffect === 'blind', 8_000);
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('shield absorbs projectile hits directly', async ({ browser }) => {
    const session = await setupBattlePair(browser);
    const { ctx1, ctx2, page1, page2, p1SessionId, p2SessionId } = session;
    try {
      await debugTeleportAuthoritative(page1, { x: 0, y: 2.5, z: 0, heading: 0 }, p1SessionId);
      await debugTeleportAuthoritative(page1, { x: 0, y: 2.5, z: 5, heading: Math.PI }, p2SessionId);
      await page1.waitForTimeout(250);

      await debugGrantWeapon(page2, 'shield', p2SessionId);
      await waitForDebug(page2, (d) => d.weaponState?.weapon2 === 'shield', 5_000);
      await fireCurrentWeapon(page2);
      await waitForDebug(page2, (d) => d.weaponState?.shielded === true, 5_000);

      await debugGrantWeapon(page1, 'missile', p1SessionId);
      await waitForDebug(page1, (d) => d.weaponState?.weapon2 === 'missile', 5_000);
      await fireCurrentWeapon(page1);

      // Shield absorbs the hit — shieldHP drops but shield may not break from one hit
      await waitForDebug(page2, (d) => d.lastShieldAbsorbed === d.sessionId, 8_000);
      const debug2 = await readDebug(page2);
      expect(debug2.weaponState?.shielded).toBe(true);
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('trap weapons spawn authoritative trap entities', async ({ browser }) => {
    const session = await setupBattlePair(browser);
    const { ctx1, ctx2, page1, page2, p1SessionId } = session;
    try {
      await debugTeleportAuthoritative(page1, { x: 0, y: 2.5, z: 0, heading: 0 }, p1SessionId);
      await page1.waitForTimeout(250);

      await debugGrantWeapon(page1, 'bubblegum', p1SessionId);
      await waitForDebug(page1, (d) => d.weaponState?.weapon2 === 'bubblegum', 5_000);
      await fireCurrentWeapon(page1);

      await page1.waitForTimeout(500);
      const projectiles = await getProjectileSubTypes(page1);
      expect(projectiles).toContain('bubblegum');
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('debuff weapons apply direct status effects without projectile travel', async ({ browser }) => {
    const session = await setupBattlePair(browser);
    const { ctx1, ctx2, page1, page2, p1SessionId, p2SessionId } = session;
    try {
      await debugTeleportAuthoritative(page1, { x: 0, y: 2.5, z: 0, heading: 0 }, p1SessionId);
      await debugTeleportAuthoritative(page1, { x: 0, y: 2.5, z: 4, heading: Math.PI }, p2SessionId);
      await page1.waitForTimeout(250);

      await debugGrantWeapon(page1, 'parachute', p1SessionId);
      await waitForDebug(page1, (d) => d.weaponState?.weapon2 === 'parachute', 5_000);
      await fireCurrentWeapon(page1);

      await waitForDebug(page2, (d) => d.lastEffect === 'slow', 5_000);
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('kart crash damage is broadcast and favors the struck kart on a rear impact', async ({ browser }) => {
    const session = await setupBattlePair(browser);
    const { ctx1, ctx2, page1, page2, p1SessionId, p2SessionId } = session;
    try {
      await debugTeleportAuthoritative(page1, { x: 0, y: 2.5, z: 0, heading: 0 }, p1SessionId);
      await debugTeleportAuthoritative(page1, { x: 0, y: 2.5, z: 3.25, heading: 0 }, p2SessionId);
      await page1.waitForTimeout(350);

      await page1.bringToFront();
      await page1.keyboard.down('KeyW');
      await Promise.all([
        waitForDebug(page1, (d) => !!d.lastKartCrash, 8_000),
        waitForDebug(page2, (d) => !!d.lastKartCrash, 8_000),
      ]);
      await page1.keyboard.up('KeyW');

      const debug1 = await readDebug(page1);
      const debug2 = await readDebug(page2);
      expect(debug1.lastKartCrash).toBeTruthy();
      expect(debug2.lastKartCrash).toBeTruthy();
      expect(Number(debug1.lastKartCrash.severity || 0)).toBeGreaterThan(0);
      expect(Number(debug2.lastKartCrash.severity || 0)).toBeGreaterThan(0);
      expect(Number(debug2.lastKartCrash.localDamage || 0)).toBeGreaterThanOrEqual(Number(debug1.lastKartCrash.localDamage || 0));
    } finally {
      await page1.keyboard.up('KeyW').catch(() => {});
      await ctx1.close();
      await ctx2.close();
    }
  });
});