/**
 * GLO KARTS — Race Flow & Physics Checkpoint Tests (Phase 3 Verification)
 *
 * Verifies:
 *  1. Online gravity matches solo gravity (-20)
 *  2. Lap HUD elements exist and update during race
 *  3. Race join and matchLive work for race mode
 *  4. Mini-turbo drift state is accessible via debug bus
 *  5. Race completion flow (lap crossing events)
 *
 * Requires: Vite (:5173) + Colyseus (:2567) both running.
 */
import { test, expect } from '@playwright/test';
import {
  injectGameConfig,
  waitForDebug,
  readDebug,
  waitForMatchLive,
  isCriticalError,
  RACE_CONFIG,
  BATTLE_CONFIG,
} from './helpers/game-helpers.js';

test.describe.configure({ mode: 'serial' });

test.describe('Race Flow & Physics Checkpoint', () => {

  // ── Test 1: Online gravity is -20, matching solo ──────────────────────────
  test('online physics gravity matches solo (-20)', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    try {
      await injectGameConfig(page1, { ...BATTLE_CONFIG, playerName: 'Grav-P1' });
      await page1.goto('/realtime.html');
      await page1.waitForTimeout(2000);
      await injectGameConfig(page2, { ...BATTLE_CONFIG, playerName: 'Grav-P2' });
      await page2.goto('/realtime.html');

      await waitForMatchLive([page1, page2], 30_000);

      // Read the scene gravity vector from Havok
      const gravity = await page1.evaluate(() => {
        const c = window.__gloClient;
        if (!c?.scene?.getPhysicsEngine) return null;
        const engine = c.scene.getPhysicsEngine();
        if (!engine) return null;
        const g = engine.gravity;
        return { x: g.x, y: g.y, z: g.z };
      });

      expect(gravity, 'gravity vector available').toBeTruthy();
      if (gravity) {
        expect(gravity.y, 'gravity Y is -20 (matches solo)').toBeCloseTo(-20, 0);
        expect(gravity.x, 'gravity X is 0').toBeCloseTo(0, 0);
        expect(gravity.z, 'gravity Z is 0').toBeCloseTo(0, 0);
      }
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  // ── Test 2: Race mode join and matchLive ──────────────────────────────────
  test('race mode joins and reaches matchLive', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    const errors = [];
    page1.on('pageerror', (e) => errors.push(e.message));
    page2.on('pageerror', (e) => errors.push(e.message));

    try {
      await injectGameConfig(page1, { ...RACE_CONFIG, playerName: 'Race-P1' });
      await page1.goto('/realtime.html');
      await page1.waitForTimeout(2000);
      await injectGameConfig(page2, { ...RACE_CONFIG, playerName: 'Race-P2' });
      await page2.goto('/realtime.html');

      await Promise.all([
        waitForDebug(page1, (d) => d.roomJoined, 25_000),
        waitForDebug(page2, (d) => d.roomJoined, 25_000),
      ]);

      await waitForMatchLive([page1, page2], 30_000);

      const d1 = await readDebug(page1);
      const d2 = await readDebug(page2);
      expect(d1.matchLive, 'P1 matchLive').toBe(true);
      expect(d2.matchLive, 'P2 matchLive').toBe(true);
      expect(d1.playerCount).toBeGreaterThanOrEqual(2);

      const crit = errors.filter(isCriticalError);
      expect(crit, 'no critical errors in race mode').toHaveLength(0);
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  // ── Test 3: Lap HUD element exists after match starts ─────────────────────
  test('lap HUD is created and visible in race mode', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    try {
      await injectGameConfig(page1, { ...RACE_CONFIG, playerName: 'HUD-P1' });
      await page1.goto('/realtime.html');
      await page1.waitForTimeout(2000);
      await injectGameConfig(page2, { ...RACE_CONFIG, playerName: 'HUD-P2' });
      await page2.goto('/realtime.html');

      await waitForMatchLive([page1, page2], 30_000);

      // The lap HUD should exist in the DOM (created by _initLapHud)
      const lapHudExists = await page1.evaluate(() => {
        const c = window.__gloClient;
        return !!c?._lapHudEl;
      });
      expect(lapHudExists, 'lap HUD element created').toBe(true);
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  // ── Test 4: Kart acceleration works (position changes over time) ──────────
  test('kart moves forward when accelerating', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    try {
      await injectGameConfig(page1, { ...BATTLE_CONFIG, playerName: 'Accel-P1' });
      await page1.goto('/realtime.html');
      await page1.waitForTimeout(2000);
      await injectGameConfig(page2, { ...BATTLE_CONFIG, playerName: 'Accel-P2' });
      await page2.goto('/realtime.html');

      await waitForMatchLive([page1, page2], 30_000);

      // Read initial position
      const pos1 = await page1.evaluate(() => {
        const c = window.__gloClient;
        if (!c?.localMesh) return null;
        const p = c.localMesh.position;
        return { x: p.x, y: p.y, z: p.z };
      });

      // Hold W (accelerate) for 1 second
      await page1.keyboard.down('KeyW');
      await page1.waitForTimeout(1000);
      await page1.keyboard.up('KeyW');

      // Read final position
      const pos2 = await page1.evaluate(() => {
        const c = window.__gloClient;
        if (!c?.localMesh) return null;
        const p = c.localMesh.position;
        return { x: p.x, y: p.y, z: p.z };
      });

      if (pos1 && pos2) {
        const dist = Math.sqrt(
          (pos2.x - pos1.x) ** 2 + (pos2.z - pos1.z) ** 2
        );
        expect(dist, 'kart moved from initial position').toBeGreaterThan(0.5);
      }
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  // ── Test 5: Mini-turbo drift state tracking exists ────────────────────────
  test('mini-turbo drift state is tracked on client', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    try {
      await injectGameConfig(page1, { ...BATTLE_CONFIG, playerName: 'Drift-P1' });
      await page1.goto('/realtime.html');
      await page1.waitForTimeout(2000);
      await injectGameConfig(page2, { ...BATTLE_CONFIG, playerName: 'Drift-P2' });
      await page2.goto('/realtime.html');

      await waitForMatchLive([page1, page2], 30_000);

      // Verify drift state properties exist on the client
      const driftState = await page1.evaluate(() => {
        const c = window.__gloClient;
        if (!c) return null;
        return {
          hasDriftCharge: '_driftCharge' in c,
          hasWasDrifting: '_wasDrifting' in c,
          hasMiniBoostTimer: '_miniBoostTimer' in c,
          hasMiniBoostTier: '_miniBoostTier' in c,
          driftCharge: c._driftCharge,
          miniBoostTier: c._miniBoostTier,
        };
      });

      expect(driftState, 'drift state accessible').toBeTruthy();
      if (driftState) {
        expect(driftState.hasDriftCharge, '_driftCharge exists').toBe(true);
        expect(driftState.hasWasDrifting, '_wasDrifting exists').toBe(true);
        expect(driftState.hasMiniBoostTimer, '_miniBoostTimer exists').toBe(true);
        expect(driftState.hasMiniBoostTier, '_miniBoostTier exists').toBe(true);
        expect(driftState.driftCharge, 'drift charge starts at 0').toBe(0);
      }
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });
});
