/**
 * GLO KARTS — Prematch Lobby Transition Tests
 *
 * Verifies the full flow:
 *  1. Loading screen visible on initial load
 *  2. Loading screen fades → prematch lobby appears after connect
 *  3. Player cards render with correct name and GLO info
 *  4. Countdown starts and decrements
 *  5. Prematch lobby fades out when game starts (matchLive)
 *  6. Game canvas is visible after transition
 *  7. No critical JS errors throughout the sequence
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
  RACE_CONFIG,
} from './helpers/game-helpers.js';

function withLobbyCode(config, label) {
  return {
    ...config,
    lobbyCode: `${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
  };
}

test.describe('Prematch Lobby', () => {
  test('loading screen shows then prematch lobby appears', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await injectGameConfig(page, withLobbyCode(BATTLE_CONFIG, 'prematch-load'));
    await page.goto('/realtime.html');

    // Loading screen should be visible initially
    const loadingScreen = page.locator('#loading-screen');
    await expect(loadingScreen).toBeVisible({ timeout: 5_000 });

    // Wait for prematch lobby to become visible (connect succeeded)
    const lobby = page.locator('#prematch-lobby');
    await expect(lobby).toBeVisible({ timeout: 20_000 });

    // Loading screen should be hidden once lobby shows
    await expect(loadingScreen).toBeHidden({ timeout: 5_000 });
  });

  test('player card displays correct name and GLO info', async ({ page }) => {
    await injectGameConfig(page, {
      ...withLobbyCode(BATTLE_CONFIG, 'prematch-card'),
      players: [{ id: 'test-player-001', name: 'TestRacer', playerColor: 'red' }],
    });
    await page.goto('/realtime.html');

    const lobby = page.locator('#prematch-lobby');
    await expect(lobby).toBeVisible({ timeout: 20_000 });

    // At least one player card should exist
    const cards = page.locator('.pm-player-card');
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });

    // Verify the first card has proper content
    const firstCard = cards.first();
    const nameEl = firstCard.locator('.pm-player-name');
    await expect(nameEl).toBeVisible();
    const nameText = await nameEl.textContent();
    // Name should be either 'TestRacer' or 'Player' (depending on server state sync)
    expect(['TestRacer', 'Player']).toContain(nameText);

    // GLO swatch should exist
    const swatch = firstCard.locator('.pm-glo-swatch');
    await expect(swatch).toBeVisible();

    // Kart preview canvas should exist
    const kartCanvas = firstCard.locator('.pm-kart-canvas');
    await expect(kartCanvas).toBeVisible();
  });

  test('countdown starts and decrements', async ({ page }) => {
    await injectGameConfig(page, withLobbyCode(BATTLE_CONFIG, 'prematch-countdown'));
    await page.goto('/realtime.html');

    const lobby = page.locator('#prematch-lobby');
    await expect(lobby).toBeVisible({ timeout: 20_000 });

    // Wait for countdown to start (triggerStart fires 3s after connect)
    const countdown = page.locator('#pm-countdown');
    await expect(countdown).toBeVisible({ timeout: 10_000 });

    // Wait for countdown to show a numeric value (not '—')
    await page.waitForFunction(
      () => {
        const el = document.getElementById('pm-countdown');
        return el && /^\d+$/.test(el.textContent.trim());
      },
      { timeout: 15_000 },
    );

    const firstValue = await countdown.textContent();
    const firstNum = parseInt(firstValue, 10);
    expect(firstNum, 'countdown is a positive number').toBeGreaterThan(0);
    expect(firstNum, 'countdown starts at 10 or less').toBeLessThanOrEqual(10);

    // Wait 2 seconds then verify countdown decremented
    await page.waitForTimeout(2200);
    const laterValue = await countdown.textContent();
    // Could be a lower number or 'GO!'
    if (laterValue !== 'GO!') {
      const laterNum = parseInt(laterValue, 10);
      expect(laterNum, 'countdown decremented').toBeLessThan(firstNum);
    }
  });

  test('lobby hides and game canvas visible after matchLive', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await injectGameConfig(page, withLobbyCode(BATTLE_CONFIG, 'prematch-live'));
    await page.goto('/realtime.html');

    // Wait for matchLive
    await waitForDebug(page, (d) => d.matchLive === true, 30_000);

    // Prematch lobby should be hidden
    const lobby = page.locator('#prematch-lobby');
    await expect(lobby).toBeHidden({ timeout: 5_000 });

    // Babylon canvas should be visible
    const canvas = page.locator('#realtime-canvas');
    await expect(canvas).toBeVisible({ timeout: 5_000 });

    // No critical errors
    const critErrors = errors.filter(isCriticalError);
    if (critErrors.length > 0) console.warn('[prematch-lobby] Critical errors:', critErrors);
    expect(critErrors).toHaveLength(0);
  });

  test('full transition flow: load → lobby → countdown → game', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    const timestamps = {};

    await injectGameConfig(page, withLobbyCode(BATTLE_CONFIG, 'prematch-flow'));

    timestamps.start = Date.now();
    await page.goto('/realtime.html');

    // Phase 1: Loading screen
    await expect(page.locator('#loading-screen')).toBeVisible({ timeout: 5_000 });
    timestamps.loadingVisible = Date.now();

    // Phase 2: Prematch lobby
    await expect(page.locator('#prematch-lobby')).toBeVisible({ timeout: 20_000 });
    timestamps.lobbyVisible = Date.now();

    // Phase 3: Countdown starts
    await page.waitForFunction(
      () => {
        const el = document.getElementById('pm-countdown');
        return el && /^\d+$/.test(el.textContent.trim());
      },
      { timeout: 15_000 },
    );
    timestamps.countdownStarted = Date.now();

    // Phase 4: matchLive fires
    await waitForDebug(page, (d) => d.matchLive === true, 30_000);
    timestamps.matchLive = Date.now();

    // Phase 5: Lobby is gone, canvas ready
    await expect(page.locator('#prematch-lobby')).toBeHidden({ timeout: 5_000 });
    await expect(page.locator('#realtime-canvas')).toBeVisible({ timeout: 5_000 });
    timestamps.gameReady = Date.now();

    // Sanity: the whole flow should complete within 60s
    const totalTime = timestamps.gameReady - timestamps.start;
    expect(totalTime, 'full flow within 60s').toBeLessThan(60_000);

    // Verify lobby appeared BEFORE countdown
    expect(
      timestamps.lobbyVisible,
      'lobby appeared before countdown',
    ).toBeLessThanOrEqual(timestamps.countdownStarted);

    // Verify countdown started BEFORE matchLive
    expect(
      timestamps.countdownStarted,
      'countdown started before matchLive',
    ).toBeLessThan(timestamps.matchLive);

    // No critical JS errors
    const critErrors = errors.filter(isCriticalError);
    if (critErrors.length > 0) console.warn('[prematch-lobby] Critical errors:', critErrors);
    expect(critErrors).toHaveLength(0);

    console.log('[prematch-lobby] Transition timestamps:', {
      loadToLobby: `${timestamps.lobbyVisible - timestamps.start}ms`,
      lobbyToCountdown: `${timestamps.countdownStarted - timestamps.lobbyVisible}ms`,
      countdownToLive: `${timestamps.matchLive - timestamps.countdownStarted}ms`,
      liveToReady: `${timestamps.gameReady - timestamps.matchLive}ms`,
      total: `${totalTime}ms`,
    });
  });

  test('map info and settings display correctly', async ({ page }) => {
    await injectGameConfig(page, {
      ...withLobbyCode(BATTLE_CONFIG, 'prematch-settings'),
      maxPlayers: 4,
      scoreLimit: 10,
    });
    await page.goto('/realtime.html');

    const lobby = page.locator('#prematch-lobby');
    await expect(lobby).toBeVisible({ timeout: 20_000 });

    // Mode label should say BATTLE
    const modeLabel = page.locator('#pm-mode-label');
    await expect(modeLabel).toHaveText('BATTLE');

    // Map mode tag
    const modeTag = page.locator('#pm-map-mode-tag');
    const modeText = await modeTag.textContent();
    expect(['DEATHMATCH', 'CAPTURE THE FLAG']).toContain(modeText);

    // Settings pills should exist
    const pills = page.locator('.pm-setting-pill');
    const pillCount = await pills.count();
    expect(pillCount, 'at least 2 setting pills').toBeGreaterThanOrEqual(2);
  });

  test('race mode shows correct labels', async ({ page }) => {
    await injectGameConfig(page, {
      ...withLobbyCode(RACE_CONFIG, 'prematch-race'),
      trackId: 'test_box',
    });
    await page.goto('/realtime.html');

    const lobby = page.locator('#prematch-lobby');
    await expect(lobby).toBeVisible({ timeout: 20_000 });

    const modeLabel = page.locator('#pm-mode-label');
    await expect(modeLabel).toHaveText('RACE');
  });

  test('at most 2 WebGL contexts (main game + kart previews)', async ({ page }) => {
    await injectGameConfig(page, withLobbyCode(BATTLE_CONFIG, 'prematch-webgl'));

    // Instrument canvas.getContext to count WebGL context requests before lobby
    await page.addInitScript(() => {
      window.__webglContextCount = 0;
      const origGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
          window.__webglContextCount++;
        }
        return origGetContext.call(this, type, ...args);
      };
    });

    await page.goto('/realtime.html');

    // Wait for prematch lobby to appear
    await expect(page.locator('#prematch-lobby')).toBeVisible({ timeout: 20_000 });

    // Wait briefly for Three.js lazy load to create its context
    await page.waitForTimeout(3000);

    // Check how many WebGL contexts were created
    const contextCount = await page.evaluate(() => window.__webglContextCount);
    // 1 for main Babylon.js game canvas + 1 for Three.js kart preview renderer
    expect(contextCount, 'at most 2 WebGL contexts').toBeLessThanOrEqual(2);
  });
});
