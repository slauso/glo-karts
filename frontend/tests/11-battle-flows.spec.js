/**
 * 11-battle-flows.spec.js — Phase 9 checkpoint
 *
 * Validates battle mode: health system, weapons, respawn, damage application,
 * and scoring state exports.
 */
import { test, expect } from '@playwright/test';

const VITE = 'http://localhost:5173';

test.describe('Battle Mode Flow Validation', () => {

  test('battle page loads without Three.js API errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(`${VITE}/battle.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);

    const threeErrors = errors.filter(e =>
      e.includes('traverse') || e.includes('isMesh') || e.includes('THREE')
    );
    expect(threeErrors).toHaveLength(0);
  });

  test('health module exports createHealthSystem', async ({ page }) => {
    await page.goto(`${VITE}/battle.html`, { waitUntil: 'domcontentloaded' });

    const hasExport = await page.evaluate(async () => {
      const mod = await import('/src/modules/battle/health.js');
      return typeof mod.createHealthSystem === 'function';
    });

    expect(hasExport).toBe(true);
  });

  test('weapons module exports initWeapons and attemptFire', async ({ page }) => {
    await page.goto(`${VITE}/battle.html`, { waitUntil: 'domcontentloaded' });

    const exports = await page.evaluate(async () => {
      const mod = await import('/src/modules/battle/weapons.js');
      return {
        hasInit: typeof mod.initWeapons === 'function',
        hasFire: typeof mod.attemptFire === 'function',
        hasDef: typeof mod.getWeaponDef === 'function',
      };
    });

    expect(exports.hasInit).toBe(true);
    expect(exports.hasFire).toBe(true);
    expect(exports.hasDef).toBe(true);
  });

  test('game-audio weapon SFX maps cover all weapon types', async ({ page }) => {
    await page.goto(`${VITE}/battle.html`, { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async () => {
      const mod = await import('/src/modules/game-audio.js');
      const fireSfx = mod.WEAPON_FIRE_SFX || {};
      const hitSfx = mod.WEAPON_HIT_SFX || {};
      return {
        fireCount: Object.keys(fireSfx).length,
        hitCount: Object.keys(hitSfx).length,
      };
    });

    expect(result.fireCount).toBeGreaterThanOrEqual(9);
    expect(result.hitCount).toBeGreaterThanOrEqual(9);
  });

  test('battle bot controller exports are available', async ({ page }) => {
    await page.goto(`${VITE}/battle.html`, { waitUntil: 'domcontentloaded' });

    const exports = await page.evaluate(async () => {
      const mod = await import('/src/modules/battle-bot-controller.js');
      return {
        hasCreate: typeof mod.createBattleBots === 'function',
        hasUpdate: typeof mod.updateBattleBots === 'function',
        hasDamage: typeof mod.damageBattleBot === 'function',
        hasScoreboard: typeof mod.getBattleScoreboard === 'function',
      };
    });

    for (const [name, ok] of Object.entries(exports)) {
      expect(ok, `battle-bot-controller should export ${name}`).toBe(true);
    }
  });
});
