import { test, expect } from '@playwright/test';
import { waitForDebug, isCriticalError } from './helpers/game-helpers.js';

test.describe.configure({ mode: 'serial' });

test.describe('Battle Overlap Performance Audit', () => {
  test('mixed heavy weapons stay inside budget under overlap', async ({ page }) => {
    test.setTimeout(180_000);

    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/realtime.html?devBattle=1&trackId=test_box');

    await waitForDebug(page, (d) => d.devBattleMode === true && d.roomJoined === true, 30_000);
    await waitForDebug(page, (d) => typeof d.runBattleDebugScenario === 'function', 20_000);
    await waitForDebug(page, (d) => d.kartLoaded === true || d.kartVisible === true || d.playerCount >= 1, 45_000);

    const audit = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      window.__gloClient?.triggerStart?.();

      window.__gloDebug?.runBattleDebugScenario?.({
        count: 12,
        durationMs: 2200,
        radius: 11,
        subTypes: ['super_nova', 'glow_thrower', 'toxic_cloud', 'tornado'],
      });

      await sleep(900);
      window.__gloDebug?.triggerMushroomCloud?.({ distance: 3.25 });

      const samples = [];
      for (let i = 0; i < 20; i++) {
        await sleep(300);
        const scene = window.__gloClient?.scene;
        const engine = scene?.getEngine?.();
        const perf = window.__gloDebug?.performanceBudget || {};
        samples.push({
          fps: engine?.getFps?.() ?? 0,
          drawCalls: Number(perf.drawCalls || 0),
          particles: Number(perf.particles || 0),
          projectiles: Number(perf.projectiles || 0),
          fxBudget: Number(perf.fxBudget ?? 1),
          postFXBudget: Number(perf.postFXBudget ?? 1),
          pressure: Number(perf.pressure ?? 0),
          tier: Number(perf.tier ?? -1),
          particleSystems: scene?.particleSystems?.length ?? 0,
        });
      }

      const scene = window.__gloClient?.scene;
      const numeric = (key) => samples.map((s) => s[key]).filter((n) => Number.isFinite(n));
      const maxOf = (key) => Math.max(0, ...numeric(key));
      const minOf = (key) => Math.min(1, ...numeric(key));

      await sleep(6000);

      return {
        samples,
        avgFps: numeric('fps').reduce((sum, value) => sum + value, 0) / Math.max(1, numeric('fps').length),
        minFps: numeric('fps').length ? Math.min(...numeric('fps')) : 0,
        maxDrawCalls: maxOf('drawCalls'),
        maxParticles: maxOf('particles'),
        maxProjectiles: maxOf('projectiles'),
        minFxBudget: minOf('fxBudget'),
        minPostFXBudget: minOf('postFXBudget'),
        maxPressure: maxOf('pressure'),
        cleanupHeavySystems: (scene?.particleSystems ?? []).filter((ps) => /^(gt_|tc_|torn_)/.test(ps.name)).length,
        cleanupFusionSystems: (scene?.particleSystems ?? []).filter((ps) => /^ff_/.test(ps.name)).length,
      };
    });

    expect(audit.maxPressure).toBeGreaterThan(0.6);
    expect(audit.minFxBudget).toBeLessThan(0.65);
    expect(audit.minPostFXBudget).toBeLessThan(0.35);
    expect(audit.maxParticles).toBeLessThan(5000);
    expect(audit.maxDrawCalls).toBeLessThan(450);
    expect(audit.maxProjectiles).toBeLessThanOrEqual(52);
    expect(audit.cleanupHeavySystems).toBe(0);
    expect(audit.cleanupFusionSystems).toBe(0);

    const criticalErrors = errors.filter(isCriticalError);
    expect(criticalErrors).toHaveLength(0);
  });
});
