import { test, expect } from '@playwright/test';
import { isCriticalError, readDebug, waitForDebug, waitForMatchLive } from './helpers/game-helpers.js';

async function seedFpsIdentity(page, playerName, partyCode) {
  await page.addInitScript(({ name, roomCode }) => {
    sessionStorage.setItem('playerName', name);
    sessionStorage.setItem('partyCode', roomCode);
  }, { name: playerName, roomCode: partyCode });
}

test.describe.configure({ mode: 'serial' });

test.describe('FPS Arena Smoke', () => {
  test('two players join fps_arena and replicate remote players plus projectiles', async ({ browser }) => {
    const partyCode = `fps-smoke-${Date.now()}`;
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();
    const errors1 = [];
    const errors2 = [];

    page1.on('pageerror', (err) => errors1.push(err.message));
    page2.on('pageerror', (err) => errors2.push(err.message));

    try {
      await seedFpsIdentity(page1, 'FPS-One', partyCode);
      await seedFpsIdentity(page2, 'FPS-Two', partyCode);

      await page1.goto(`/fps.html?party=${partyCode}`);
      await page2.goto(`/fps.html?party=${partyCode}`);

      await Promise.all([
        waitForDebug(page1, (d) => d.roomJoined === true, 30_000),
        waitForDebug(page2, (d) => d.roomJoined === true, 30_000),
      ]);

      await waitForMatchLive([page1, page2], 35_000);

      await expect.poll(async () => (await readDebug(page1)).playerCount || 0, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
      await expect.poll(async () => (await readDebug(page2)).remotePlayerCount || 0, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);

      await page1.evaluate(() => {
        window.__gloClient?.debugTeleport({ x: 0, y: 2.5, z: -8, yaw: 0 });
      });
      await page2.evaluate(() => {
        window.__gloClient?.debugTeleport({ x: 0, y: 2.5, z: 8, yaw: Math.PI });
      });

      await page1.waitForTimeout(400);

      await page1.evaluate(() => {
        window.__gloClient?.debugFire();
      });

      await expect.poll(async () => (await readDebug(page1)).lastWeaponFired, { timeout: 8_000 }).toBeTruthy();
      await expect.poll(async () => (await readDebug(page2)).remoteProjectileReplications || 0, { timeout: 8_000 }).toBeGreaterThan(0);

      const final1 = await readDebug(page1);
      const final2 = await readDebug(page2);
      expect(final1.matchLive).toBe(true);
      expect(final2.matchLive).toBe(true);
      expect(final1.sessionId).toBeTruthy();
      expect(final2.sessionId).toBeTruthy();
      expect(final1.sessionId).not.toBe(final2.sessionId);

      const critical1 = errors1.filter(isCriticalError);
      const critical2 = errors2.filter(isCriticalError);
      expect(critical1).toHaveLength(0);
      expect(critical2).toHaveLength(0);
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });
});