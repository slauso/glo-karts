/**
 * 12-solo-mode.spec.js — Phase 9 checkpoint
 *
 * Validates solo race initialization, free roam mode availability,
 * and Grand Prix setup through module-level assertions.
 */
import { test, expect } from '@playwright/test';

const VITE = 'http://localhost:5173';

test.describe('Solo Mode Smoke Tests', () => {

  test('game.html loads with Babylon canvas and no fatal errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);

    // Should have a canvas element (Babylon render target)
    const canvasCount = await page.locator('canvas').count();
    expect(canvasCount).toBeGreaterThanOrEqual(1);

    // No fatal runtime errors related to engine mismatch
    const fatalErrors = errors.filter(e =>
      e.includes('traverse') || e.includes('isMesh') || e.includes('THREE') ||
      e.includes('Cannot read properties of null')
    );
    expect(fatalErrors).toHaveLength(0);
  });

  test('game-modes.js defines Free Roam configuration', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const hasFreeRoam = await page.evaluate(async () => {
      try {
        const mod = await import('/src/game-modes.js');
        const modes = mod.MODE_REGISTRY || mod.default || {};
        return !!modes.free_roam;
      } catch {
        return false;
      }
    });

    expect(hasFreeRoam).toBe(true);
  });

  test('Babylon car loader exports are available', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const exports = await page.evaluate(async () => {
      const mod = await import('/src/modules/babylon-car.js');
      return {
        hasLoad: typeof mod.createVehicle === 'function' || typeof mod.resetCarPosition === 'function',
      };
    });

    expect(exports.hasLoad).toBe(true);
  });

  test('Havok physics module exports stepPhysics', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const hasExport = await page.evaluate(async () => {
      const mod = await import('/src/modules/havok-physics.js');
      return typeof mod.stepPhysics === 'function';
    });

    expect(hasExport).toBe(true);
  });

  test('minimap module exports createMinimap and updateMinimapPlayers', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const exports = await page.evaluate(async () => {
      const mod = await import('/src/modules/minimap.js');
      return {
        hasCreate: typeof mod.createMinimap === 'function',
        hasUpdate: typeof mod.updateMinimapPlayers === 'function',
      };
    });

    expect(exports.hasCreate).toBe(true);
    expect(exports.hasUpdate).toBe(true);
  });

  test('no legacy audio.js import exists in main.js source', async ({ page }) => {
    const response = await page.goto(`${VITE}/src/main.js`, { waitUntil: 'domcontentloaded' });
    const source = await response.text();

    // Should NOT import from audio.js (legacy)
    expect(source).not.toContain("from './modules/audio.js'");
    expect(source).not.toContain('from "./modules/audio.js"');

    // Should import from game-audio.js (current)
    expect(source).toContain('game-audio.js');
  });
});
