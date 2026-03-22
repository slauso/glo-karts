import { test, expect } from '@playwright/test';
import { waitForDebug, isCriticalError } from './helpers/game-helpers.js';

test.describe.configure({ mode: 'serial' });

test.describe('Battle Performance Audit', () => {
  test('8-projectile battle stress adapts quality and stays stable', async ({ page }) => {
    test.setTimeout(180_000);

    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/realtime.html?devBattle=1&trackId=test_box&scenarioCount=8&scenarioWeapon=super_nova&scenarioDelayMs=450');

    await waitForDebug(page, (d) => d.devBattleMode === true && d.roomJoined === true, 30_000);
    await waitForDebug(page, (d) => typeof d.runBattleDebugScenario === 'function', 20_000);
    await waitForDebug(page, (d) => d.kartLoaded === true || d.kartVisible === true || d.playerCount >= 1, 45_000);

    const audit = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      window.__gloClient?.triggerStart?.();

      window.__gloDebug?.runBattleDebugScenario?.({
        count: 8,
        subType: 'super_nova',
        durationMs: 1400,
        radius: 12,
      });
      await sleep(1800);
      window.__gloDebug?.triggerMushroomCloud?.({ distance: 3.5 });

      const samples = [];
      for (let i = 0; i < 18; i++) {
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
        });
      }

      const fpsValues = samples.map((s) => s.fps).filter((n) => Number.isFinite(n) && n > 0);
      const drawValues = samples.map((s) => s.drawCalls);
      const particleValues = samples.map((s) => s.particles);
      const projectileValues = samples.map((s) => s.projectiles);
      const fxBudgetValues = samples.map((s) => s.fxBudget);
      const postBudgetValues = samples.map((s) => s.postFXBudget);
      const pressureValues = samples.map((s) => s.pressure);

      const scene = window.__gloClient?.scene;
      return {
        samples,
        avgFps: fpsValues.reduce((sum, value) => sum + value, 0) / Math.max(1, fpsValues.length),
        minFps: fpsValues.length ? Math.min(...fpsValues) : 0,
        maxDrawCalls: drawValues.length ? Math.max(...drawValues) : 0,
        maxParticles: particleValues.length ? Math.max(...particleValues) : 0,
        maxProjectiles: projectileValues.length ? Math.max(...projectileValues) : 0,
        minFxBudget: fxBudgetValues.length ? Math.min(...fxBudgetValues) : 1,
        minPostFXBudget: postBudgetValues.length ? Math.min(...postBudgetValues) : 1,
        maxPressure: pressureValues.length ? Math.max(...pressureValues) : 0,
        remainingFFSystems: (scene?.particleSystems ?? []).filter((ps) => /^ff_/.test(ps.name)).length,
        remainingFFMeshes: (scene?.meshes ?? []).filter((mesh) => /^ff_/.test(mesh.name)).length,
      };
    });

    expect(audit.maxPressure).toBeGreaterThan(0.45);
    expect(audit.minFxBudget).toBeLessThan(0.8);
    expect(audit.minPostFXBudget).toBeLessThan(0.45);
    expect(audit.maxParticles).toBeLessThan(4500);
    expect(audit.maxProjectiles).toBeLessThanOrEqual(52);
    expect(audit.remainingFFSystems).toBeLessThanOrEqual(2);
    expect(audit.remainingFFMeshes).toBeLessThanOrEqual(2);

    const criticalErrors = errors.filter(isCriticalError);
    expect(criticalErrors).toHaveLength(0);
  });
});
