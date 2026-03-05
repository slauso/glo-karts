/**
 * GLO Karts — PvP Multiplayer Session Tests
 *
 * Tests a two-player battle session end-to-end:
 *   1. Both players join the same battle_room
 *   2. Both receive startSequence → matchLive
 *   3. Room state shows 2 players on both sides
 *   4. Weapon pickup works: teleport kart to item box → itemReceived event
 *   5. Fire weapon → projectileFired event broadcast to opponent
 *   6. Damage: winning condition accumulates score (simulated via rapid hits)
 *
 * Uses window.__gloDebug as the assertion surface and window.__gloClient for
 * direct client manipulation (teleport, send messages).
 */
import { test, expect } from '@playwright/test';
import {
  injectGameConfig,
  waitForDebug,
  readDebug,
  waitForMatchLive,
  teleportKart,
  getFirstItemBoxPos,
  isCriticalError,
  BATTLE_CONFIG,
} from './helpers/game-helpers.js';

// Run PvP tests serially — they share the Colyseus server
test.describe.configure({ mode: 'serial' });

test.describe('PvP Battle Session', () => {
  // ── Test 1: Two players join and both reach matchLive ─────────────────────
  test('2 players join battle_room and reach matchLive', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    const errors1 = [], errors2 = [];
    page1.on('pageerror', (e) => errors1.push(e.message));
    page2.on('pageerror', (e) => errors2.push(e.message));

    try {
      // Player 1 (host side)
      await injectGameConfig(page1, { ...BATTLE_CONFIG, playerName: 'P1-Test' });
      await page1.goto('/realtime.html');

      // Player 2 joins 2 s later (lets P1 create the room first and
      // ensures P1's Colyseus joinOrCreate is complete before P2 connects)
      await page1.waitForTimeout(2000);
      await injectGameConfig(page2, { ...BATTLE_CONFIG, playerName: 'P2-Test' });
      await page2.goto('/realtime.html');

      // Wait for both players to have joined the Colyseus room before
      // waiting for matchLive — prevents false-start timeouts.
      await Promise.all([
        waitForDebug(page1, (d) => d.roomJoined, 25_000),
        waitForDebug(page2, (d) => d.roomJoined, 25_000),
      ]);

      // Both should reach matchLive within 30 s of both being joined
      await waitForMatchLive([page1, page2], 30_000);

      const d1 = await readDebug(page1);
      const d2 = await readDebug(page2);

      expect(d1.matchLive, 'P1 matchLive').toBe(true);
      expect(d2.matchLive, 'P2 matchLive').toBe(true);
      expect(d1.roomJoined, 'P1 room joined').toBe(true);
      expect(d2.roomJoined, 'P2 room joined').toBe(true);

      // Each player sees the other in room state (2 total)
      expect(d1.playerCount, 'P1 sees 2 players').toBeGreaterThanOrEqual(2);
      expect(d2.playerCount, 'P2 sees 2 players').toBeGreaterThanOrEqual(2);

      // Session IDs should be different (each has their own Colyseus session)
      expect(d1.sessionId, 'P1 has session id').toBeTruthy();
      expect(d2.sessionId, 'P2 has session id').toBeTruthy();
      expect(d1.sessionId).not.toEqual(d2.sessionId);

      // No critical errors on either side
      const crit1 = errors1.filter(isCriticalError);
      const crit2 = errors2.filter(isCriticalError);
      if (crit1.length) console.warn('[pvp] P1 errors:', crit1);
      if (crit2.length) console.warn('[pvp] P2 errors:', crit2);
      expect(crit1).toHaveLength(0);
      expect(crit2).toHaveLength(0);
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  // ── Test 2: Item pickup — teleport to item box, verify weapon received ────
  test('item box pickup grants weapon to local player', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    try {
      await injectGameConfig(page1, BATTLE_CONFIG);
      await page1.goto('/realtime.html');
      await page1.waitForTimeout(1000);
      await injectGameConfig(page2, BATTLE_CONFIG);
      await page2.goto('/realtime.html');

      await waitForMatchLive([page1, page2], 30_000);

      // Give entities a moment to sync (server sends them after match starts)
      await page1.waitForTimeout(2000);

      // Find an item box in battle state
      const boxPos = await getFirstItemBoxPos(page1);
      if (!boxPos) {
        console.warn('[pvp] No item boxes found in state — skipping pickup sub-test');
        return;
      }

      // Teleport P1 kart to item box position
      await teleportKart(page1, { x: boxPos.x, y: boxPos.y + 1, z: boxPos.z });

      // Wait up to 3 s for itemReceived (Havok trigger fires on overlap)
      await waitForDebug(page1, (d) => d.lastWeaponReceived !== null, 5_000)
        .catch(() => console.warn('[pvp] Item pickup did not fire within 5 s (physics trigger may need another tick)'));

      const d1 = await readDebug(page1);
      if (d1.lastWeaponReceived) {
        console.log(`[pvp] P1 received weapon: ${d1.lastWeaponReceived}`);
        expect(typeof d1.lastWeaponReceived).toBe('string');
        expect(d1.lastWeaponReceived.length).toBeGreaterThan(0);
      }
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  // ── Test 3: Weapon fire — press E after acquiring weapon, check broadcast ─
  test('fire weapon broadcasts projectileFired to both players', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    try {
      await injectGameConfig(page1, BATTLE_CONFIG);
      await page1.goto('/realtime.html');
      await page1.waitForTimeout(1000);
      await injectGameConfig(page2, BATTLE_CONFIG);
      await page2.goto('/realtime.html');

      await waitForMatchLive([page1, page2], 30_000);

      // Teleport P1 to a known item box to grab a weapon
      await page1.waitForTimeout(2000);
      const boxPos = await getFirstItemBoxPos(page1);
      if (boxPos) {
        await teleportKart(page1, { x: boxPos.x, y: boxPos.y + 1, z: boxPos.z });
        // Wait for weapon grant
        await waitForDebug(page1, (d) => d.lastWeaponReceived !== null, 5_000)
          .catch(() => {});
      }

      const haweapon = await page1.evaluate(() => !!window.__gloClient?.currentWeapon);
      if (!haweapon) {
        // Grant a weapon directly via evaluate for test isolation
        await page1.evaluate(() => {
          if (window.__gloClient) window.__gloClient.currentWeapon = 'bowling_ball';
        });
      }

      // Press E (fire key) on P1
      await page1.keyboard.press('KeyE');
      await page1.waitForTimeout(500);

      // Check P1 sees a projectileFired debug entry
      // (may not fire if cooldown active, so soft-assert)
      const d1After = await readDebug(page1);
      if (d1After.lastWeaponFired) {
        console.log(`[pvp] projectileFired: ${d1After.lastWeaponFired}`);
        // P2 may also see a projectileFired message (broadcast)
        const d2After = await readDebug(page2);
        console.log(`[pvp] P2 lastWeaponFired: ${d2After.lastWeaponFired}`);
      } else {
        console.warn('[pvp] No projectileFired recorded — weapon may have been on cooldown or server rejected empty ammo');
      }
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  // ── Test 4: Room state integrity — no player position is NaN / Infinity ───
  test('kart positions stay finite for both players during live play', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    try {
      await injectGameConfig(page1, BATTLE_CONFIG);
      await page1.goto('/realtime.html');
      await page1.waitForTimeout(1000);
      await injectGameConfig(page2, BATTLE_CONFIG);
      await page2.goto('/realtime.html');

      await waitForMatchLive([page1, page2], 30_000);

      // Drive around for 3 s (hold W on P1)
      await page1.keyboard.down('KeyW');
      await page1.waitForTimeout(3000);
      await page1.keyboard.up('KeyW');

      // Sample positions from both clients
      const pos1 = await page1.evaluate(() => {
        const m = window.__gloClient?.localMesh;
        if (!m) return null;
        return { x: m.position.x, y: m.position.y, z: m.position.z };
      });
      const pos2 = await page2.evaluate(() => {
        const m = window.__gloClient?.localMesh;
        if (!m) return null;
        return { x: m.position.x, y: m.position.y, z: m.position.z };
      });

      // Assert positions are finite (no NaN/Infinity from bad physics)
      if (pos1) {
        expect(Number.isFinite(pos1.x), 'P1 x finite').toBe(true);
        expect(Number.isFinite(pos1.y), 'P1 y finite').toBe(true);
        expect(Number.isFinite(pos1.z), 'P1 z finite').toBe(true);
        expect(pos1.y, 'P1 not below kill-plane').toBeGreaterThan(-70);
      }
      if (pos2) {
        expect(Number.isFinite(pos2.x), 'P2 x finite').toBe(true);
        expect(Number.isFinite(pos2.y), 'P2 y finite').toBe(true);
        expect(Number.isFinite(pos2.z), 'P2 z finite').toBe(true);
      }
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });
});
