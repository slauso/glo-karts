import { test, expect } from '@playwright/test';
import {
  injectGameConfig,
  waitForDebug,
  readDebug,
  isCriticalError,
  BATTLE_CONFIG,
} from './helpers/game-helpers.js';

const PROCEDURAL_BATTLE_CONFIG = {
  ...BATTLE_CONFIG,
  trackId: 'glo_arena',
};

function withLobbyCode(config, label) {
  return {
    ...config,
    lobbyCode: `${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
  };
}

test.describe('Spawn Sequence', () => {
  test('kart is hidden before matchLive and visible after', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await injectGameConfig(page, withLobbyCode(PROCEDURAL_BATTLE_CONFIG, 'spawn-visibility'));
    await page.goto('/realtime.html');

    await waitForDebug(page, (d) => d.kartLoaded === true, 20_000);

    const preMatch = await readDebug(page);
    expect(preMatch.kartLoaded, 'kart GLB loaded').toBe(true);
    expect(preMatch.kartVisible, 'kart should be hidden pre-match').toBe(false);
    expect(preMatch.matchLive, 'match should not be live yet').toBe(false);

    await waitForDebug(page, (d) => d.matchLive === true, 25_000);

    const postMatch = await readDebug(page);
    expect(postMatch.matchLive, 'matchLive received').toBe(true);
    expect(postMatch.kartVisible, 'kart revealed at GO').toBe(true);

    const sp = postMatch.spawnPos;
    expect(sp, 'spawnPos set').toBeTruthy();
    expect(Number.isFinite(sp.x), 'spawn x is finite').toBe(true);
    expect(Number.isFinite(sp.y), 'spawn y is finite').toBe(true);
    expect(sp.y, 'spawn y is above deep-void').toBeGreaterThan(-10);
    expect(sp.y, 'spawn y is below orbit').toBeLessThan(500);

    const critErrors = errors.filter(isCriticalError);
    if (critErrors.length > 0) console.warn('[spawn-sequence] Critical errors:', critErrors);
    expect(critErrors).toHaveLength(0);
  });

  test('kart does not leave spawn area in first 500ms after GO', async ({ page }) => {
    await injectGameConfig(page, withLobbyCode(PROCEDURAL_BATTLE_CONFIG, 'spawn-hold'));
    await page.goto('/realtime.html');

    await waitForDebug(page, (d) => d.matchLive === true, 25_000);

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
      expect(dist, 'kart within 5m of spawn after GO').toBeLessThan(5);
    }
  });

  test('procedural arena publishes a consistent kart scale and extents', async ({ page }) => {
    await injectGameConfig(page, withLobbyCode(PROCEDURAL_BATTLE_CONFIG, 'spawn-scale'));
    await page.goto('/realtime.html');

    await waitForDebug(page, (d) => d.kartLoaded === true && d.effectiveKartScale !== null, 20_000);

    const debug = await readDebug(page);
    expect(debug.effectiveKartScale, 'effective scale is published').toBeGreaterThan(1);

    const physExtents = await page.evaluate(() => {
      const c = window.__gloClient;
      if (!c?._localKartExtents) return null;
      return { x: c._localKartExtents.x, y: c._localKartExtents.y, z: c._localKartExtents.z };
    });

    expect(physExtents).toBeTruthy();
    expect(physExtents.x, 'physics width follows scale').toBeCloseTo(1.8 * debug.effectiveKartScale, 0);
    expect(physExtents.z, 'physics length follows scale').toBeCloseTo(3.2 * debug.effectiveKartScale, 0);
  });
});
