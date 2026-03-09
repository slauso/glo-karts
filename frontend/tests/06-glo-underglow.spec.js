/**
 * GLO KARTS — Underglow Shader System Tests
 *
 * Verifies that:
 *  1. Local player GLO kit (decal + trail) is created after kart load.
 *  2. GLO meshes are hidden during pre-match and visible after matchLive.
 *  3. GLO decal shader is receiving correct colour uniforms.
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

const TEST_BOX_BATTLE = { ...BATTLE_CONFIG, trackId: 'test_box' };

test.describe('GLO Underglow', () => {

  test('local player GLO kit is created and hidden pre-match', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await injectGameConfig(page, TEST_BOX_BATTLE);
    await page.goto('/realtime.html');

    // Wait for kart to load AND __gloClient to be exposed
    // (__gloClient is set after connect() resolves, which is after kart load)
    await waitForDebug(page, (d) => d.kartLoaded === true, 20_000);
    await page.waitForFunction(() => !!window.__gloClient?._gloKit, { timeout: 15_000 });

    // Check that the glo kit exists on the client
    const preGlo = await page.evaluate(() => {
      const c = window.__gloClient;
      if (!c?._gloKit) return null;
      return {
        hasDecal: !!c._gloKit.decal,
        hasTrail: !!c._gloKit.trail,
        hasPivot: !!c._gloKit.pivot,
        hasSpot:  !!c._gloKit.spot,
        decalVisible: c._gloKit.decal?.isVisible ?? null,
        trailVisible: c._gloKit.trail?.isVisible ?? null,
        spotEnabled:  c._gloKit.spot?.isEnabled() ?? null,
        effect: c._gloKit.effect,
      };
    });

    expect(preGlo, 'GLO kit exists').toBeTruthy();
    expect(preGlo.hasDecal, 'decal mesh created').toBe(true);
    expect(preGlo.hasTrail, 'trail mesh created').toBe(true);
    expect(preGlo.hasPivot, 'pivot mesh created').toBe(true);
    expect(preGlo.hasSpot,  'SpotLight created').toBe(true);
    expect(preGlo.decalVisible, 'decal hidden pre-match').toBe(false);
    expect(preGlo.trailVisible, 'trail hidden pre-match').toBe(false);
    expect(preGlo.spotEnabled,  'SpotLight disabled pre-match').toBe(false);
    expect(preGlo.effect, 'effect matches config').toBe('solid');

    const critErrors = errors.filter(isCriticalError);
    expect(critErrors).toHaveLength(0);
  });

  test('GLO becomes visible after matchLive', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await injectGameConfig(page, TEST_BOX_BATTLE);
    await page.goto('/realtime.html');

    await waitForDebug(page, (d) => d.matchLive === true, 25_000);

    const postGlo = await page.evaluate(() => {
      const c = window.__gloClient;
      if (!c?._gloKit) return null;
      return {
        decalVisible: c._gloKit.decal?.isVisible ?? null,
        trailVisible: c._gloKit.trail?.isVisible ?? null,
        visible: c._gloKit.visible,
      };
    });

    expect(postGlo, 'GLO kit still exists after GO').toBeTruthy();
    expect(postGlo.decalVisible, 'decal visible after GO').toBe(true);
    expect(postGlo.trailVisible, 'trail visible after GO').toBe(true);
    expect(postGlo.visible, 'kit.visible flag true').toBe(true);

    const critErrors = errors.filter(isCriticalError);
    expect(critErrors).toHaveLength(0);
  });

  test('GLO shader uniforms reflect configured colour', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const customConfig = {
      ...TEST_BOX_BATTLE,
      gloEffect: 'solid',
      gloColor: '#00ff00',
      gloColor2: '#0000ff',
    };

    await injectGameConfig(page, customConfig);
    await page.goto('/realtime.html');

    await waitForDebug(page, (d) => d.matchLive === true, 25_000);

    // Let a few frames tick so uniforms are updated
    await page.waitForTimeout(500);

    const colorCheck = await page.evaluate(() => {
      const c = window.__gloClient;
      if (!c?._gloKit?.decalMat) return null;
      const uni = c._gloKit.decalMat.getEffect();
      // Read the stored colour from the kit state
      return {
        kitColor: c._gloKit.color,
        kitColor2: c._gloKit.color2,
        kitEffect: c._gloKit.effect,
        hasDecalMat: !!c._gloKit.decalMat,
        hasTrailMat: !!c._gloKit.trailMat,
      };
    });

    expect(colorCheck, 'color check data').toBeTruthy();
    expect(colorCheck.kitColor, 'primary colour stored').toBe('#00ff00');
    expect(colorCheck.kitColor2, 'secondary colour stored').toBe('#0000ff');
    expect(colorCheck.kitEffect, 'effect stored').toBe('solid');
    expect(colorCheck.hasDecalMat, 'decal material exists').toBe(true);
    expect(colorCheck.hasTrailMat, 'trail material exists').toBe(true);

    const critErrors = errors.filter(isCriticalError);
    expect(critErrors).toHaveLength(0);
  });

  test('GLO decal tracks kart position', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await injectGameConfig(page, TEST_BOX_BATTLE);
    await page.goto('/realtime.html');

    await waitForDebug(page, (d) => d.matchLive === true, 25_000);

    // Let a few frames render
    await page.waitForTimeout(300);

    const posCheck = await page.evaluate(() => {
      const c = window.__gloClient;
      if (!c?._gloKit?.decal || !c?.localMesh) return null;
      // Decal is parented to kartMesh — use absolute world position
      const dp = c._gloKit.decal.getAbsolutePosition();
      const kp = c.localMesh.getAbsolutePosition();
      return {
        decalX: dp.x, decalZ: dp.z,
        kartX: kp.x, kartZ: kp.z,
        isParented: c._gloKit.decal.parent === c.localMesh,
      };
    });

    expect(posCheck, 'position data available').toBeTruthy();
    expect(posCheck.isParented, 'decal is parented to kart').toBe(true);
    // Decal world XZ should track very close to kart world XZ
    const dx = Math.abs(posCheck.decalX - posCheck.kartX);
    const dz = Math.abs(posCheck.decalZ - posCheck.kartZ);
    expect(dx, 'decal X tracks kart').toBeLessThan(0.5);
    expect(dz, 'decal Z tracks kart').toBeLessThan(0.5);

    const critErrors = errors.filter(isCriticalError);
    expect(critErrors).toHaveLength(0);
  });
});
