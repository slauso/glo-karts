/**
 * 14-splitscreen.spec.js — Phase 15.1 checkpoint
 *
 * Validates local 2-player splitscreen:
 *  - Page loads without fatal errors
 *  - Canvas exists
 *  - Splitscreen module exports are available
 *  - Game-modes registry contains local modes
 */
import { test, expect } from '@playwright/test';

const VITE = 'http://localhost:5173';

test.describe('Local 2P Splitscreen', () => {

  test('splitscreen.html loads with canvas', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(`${VITE}/splitscreen.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const canvasCount = await page.locator('canvas#app').count();
    expect(canvasCount).toBe(1);

    // No fatal errors (physics/WebGL may warn but shouldn't crash)
    const fatalErrors = errors.filter(e =>
      e.includes('Cannot read properties of null') || e.includes('is not a function')
    );
    expect(fatalErrors).toHaveLength(0);
  });

  test('splitscreen module exports required functions', async ({ page }) => {
    await page.goto(`${VITE}/splitscreen.html`, { waitUntil: 'domcontentloaded' });

    const exports = await page.evaluate(async () => {
      const mod = await import('/src/modules/splitscreen.js');
      return {
        hasCreateKeyState:         typeof mod.createKeyState === 'function',
        hasInstallSplitscreenInput: typeof mod.installSplitscreenInput === 'function',
        hasCreateSplitCameras:      typeof mod.createSplitCameras === 'function',
        hasLockCamerasToKarts:      typeof mod.lockCamerasToKarts === 'function',
        hasCreateSplitHUD:          typeof mod.createSplitHUD === 'function',
        hasCreateDividerLine:       typeof mod.createDividerLine === 'function',
      };
    });

    expect(exports.hasCreateKeyState).toBe(true);
    expect(exports.hasInstallSplitscreenInput).toBe(true);
    expect(exports.hasCreateSplitCameras).toBe(true);
    expect(exports.hasLockCamerasToKarts).toBe(true);
    expect(exports.hasCreateSplitHUD).toBe(true);
    expect(exports.hasCreateDividerLine).toBe(true);
  });

  test('game-modes.js includes local_2p_race and local_2p_battle', async ({ page }) => {
    await page.goto(`${VITE}/index.html`, { waitUntil: 'domcontentloaded' });

    const modes = await page.evaluate(async () => {
      const mod = await import('/src/game-modes.js');
      return {
        hasLocal2pRace:   !!mod.MODE_REGISTRY.local_2p_race,
        hasLocal2pBattle: !!mod.MODE_REGISTRY.local_2p_battle,
        raceCategory:     mod.MODE_REGISTRY.local_2p_race?.category,
        racePage:         mod.MODE_REGISTRY.local_2p_race?.page,
        battlePage:       mod.MODE_REGISTRY.local_2p_battle?.page,
        hasLocalCategory: !!mod.CATEGORIES.local,
      };
    });

    expect(modes.hasLocal2pRace).toBe(true);
    expect(modes.hasLocal2pBattle).toBe(true);
    expect(modes.raceCategory).toBe('local');
    expect(modes.racePage).toBe('splitscreen.html');
    expect(modes.battlePage).toBe('splitscreen.html');
    expect(modes.hasLocalCategory).toBe(true);
  });

  test('splitscreen createKeyState produces clean state object', async ({ page }) => {
    await page.goto(`${VITE}/splitscreen.html`, { waitUntil: 'domcontentloaded' });

    const state = await page.evaluate(async () => {
      const mod = await import('/src/modules/splitscreen.js');
      return mod.createKeyState();
    });

    expect(state).toEqual({ w: false, s: false, a: false, d: false, space: false, shift: false });
  });
});
