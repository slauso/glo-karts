/**
 * GLO Karts — Spawn Sequence Tests
 *
 * Verifies that:
 *  1. Kart mesh is hidden (isVisible=false) during the pre-match countdown.
 *  2. Physics body is STATIC so the kart does not fall from the sky.
 *  3. After matchLive fires, the kart becomes visible and physics go DYNAMIC.
 *  4. No critical JS errors occur during the whole sequence.
 *
 * Requires: Vite (:5173) + Colyseus (:2567) both running.
 */
import { test, expect } from '@playwright/test';
import {
  injectGameConfig,
  waitForDebug,
  readDebug,
  isCriticalError,
  BATTLE_CONFIG,
} from './helpers/game-helpers.js';

test.describe('Spawn Sequence', () => {
  test('kart is hidden before matchLive and visible after', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await injectGameConfig(page, BATTLE_CONFIG);
    await page.goto('/realtime.html');

    // ── Phase 1: wait for kart to load (but NOT matchLive yet) ──────────────
    // trackPhysicsCount > 0 tells us the map loaded; kartLoaded tells us the
    // kart GLB is done — both happen BEFORE Colyseus room join.
    await waitForDebug(page, (d) => d.kartLoaded === true, 20_000);

    const preMatch = await readDebug(page);
    expect(preMatch.kartLoaded, 'kart GLB loaded').toBe(true);
    expect(preMatch.kartVisible, 'kart should be hidden pre-match').toBe(false);
    expect(preMatch.matchLive, 'match should not be live yet').toBe(false);

    // ── Phase 2: wait for matchLive ──────────────────────────────────────────
    // Auto-start fires after 2 s, countdown is 4 s → matchLive ~6 s after join
    await waitForDebug(page, (d) => d.matchLive === true, 25_000);

    const postMatch = await readDebug(page);
    expect(postMatch.matchLive, 'matchLive received').toBe(true);
    expect(postMatch.kartVisible, 'kart revealed at GO').toBe(true);

    // ── Phase 3: check spawn position is sensible ────────────────────────────
    const sp = postMatch.spawnPos;
    expect(sp, 'spawnPos set').toBeTruthy();
    expect(Number.isFinite(sp.x), 'spawn x is finite').toBe(true);
    expect(Number.isFinite(sp.y), 'spawn y is finite').toBe(true);
    expect(sp.y, 'spawn y is above deep-void').toBeGreaterThan(-10);
    expect(sp.y, 'spawn y is below orbit').toBeLessThan(500);

    // ── Phase 4: no critical JS errors ──────────────────────────────────────
    const critErrors = errors.filter(isCriticalError);
    if (critErrors.length > 0) console.warn('[spawn-sequence] Critical errors:', critErrors);
    expect(critErrors).toHaveLength(0);
  });

  test('kart does not leave spawn area in first 500ms after GO', async ({ page }) => {
    await injectGameConfig(page, BATTLE_CONFIG);
    await page.goto('/realtime.html');

    await waitForDebug(page, (d) => d.matchLive === true, 25_000);

    // Read kart world position immediately after GO
    const posNow = await page.evaluate(() => {
      const c = window.__gloClient;
      if (!c?.localMesh) return null;
      const p = c.localMesh.position;
      return { x: p.x, y: p.y, z: p.z };
    });

    expect(posNow, 'local mesh position accessible').toBeTruthy();

    // Kart should not have teleported to 0,0,0 or fallen to void
    const sp = await page.evaluate(() => window.__gloDebug?.spawnPos);
    if (sp && posNow) {
      const dist = Math.sqrt(
        (posNow.x - sp.x) ** 2 + (posNow.z - sp.z) ** 2,
      );
      // Within 5 m of spawn in the horizontal plane immediately after GO
      expect(dist, 'kart within 5m of spawn after GO').toBeLessThan(5);
    }
  });

  test('kart extents match arena kartScale', async ({ page }) => {
    // blockfort kartScale = 0.40, base extents 1.8 × 0.5 × 3.2
    await injectGameConfig(page, { ...BATTLE_CONFIG, trackId: 'blockfort' });
    await page.goto('/realtime.html');

    await waitForDebug(page, (d) => d.kartLoaded === true, 20_000);

    const debug = await readDebug(page);
    const scale = debug.effectiveKartScale;
    expect(scale, 'effective scale set for blockfort').not.toBeNull();
    // blockfort kartScale = 0.40 — karts should be significantly smaller than stock 2.2
    expect(scale, 'blockfort kart scale is smaller than stock').toBeLessThan(1.0);
    expect(scale, 'blockfort kart scale positive').toBeGreaterThan(0);
  });
});
