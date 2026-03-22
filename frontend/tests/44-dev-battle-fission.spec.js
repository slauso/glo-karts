import { test, expect } from '@playwright/test';
import { waitForDebug, readDebug, isCriticalError } from './helpers/game-helpers.js';

test.describe('Dev Battle Fission Regression', () => {
  test('dev battle boot path runs debug burst and manual mushroom cloud without renderer collapse', async ({ page }) => {
    test.setTimeout(120_000);

    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/realtime.html?devBattle=1&trackId=test_box&scenarioCount=8&scenarioWeapon=super_nova&scenarioDelayMs=500');

    await waitForDebug(page, (d) => d.devBattleMode === true && d.roomJoined === true, 30_000);
    await waitForDebug(page, (d) => typeof d.runBattleDebugScenario === 'function', 20_000);
    await waitForDebug(page, (d) => d.matchLive === true || d.readySignalSent === true || d.readyCount >= 1, 45_000);
    await page.evaluate(() => {
      window.__gloClient?.triggerStart?.();
      window.__gloDebug?.runBattleDebugScenario?.({
        count: 8,
        subType: 'super_nova',
        durationMs: 1200,
        radius: 14,
      });
    });
    await waitForDebug(page, (d) => d.lastDebugScenario?.type === 'battle-burst', 45_000);

    const autoDebug = await readDebug(page);
    expect(autoDebug.devBattleMode).toBe(true);
    expect(autoDebug.burstQueues?.projectileFires ?? -1).toBeGreaterThanOrEqual(0);
    expect(autoDebug.remoteProjectileBudget?.budget ?? 0).toBeGreaterThan(0);

    const mushroomState = await page.evaluate(async () => {
      window.__gloDebug?.clearBattleDebugScenario?.();
      window.__gloDebug?.triggerMushroomCloud?.({ distance: 3.5 });
      await new Promise((resolve) => setTimeout(resolve, 820));

      const scene = window.__gloClient?.scene;
      const engine = scene?.getEngine?.();
      const meshes = scene?.meshes ?? [];
      const particleSystems = scene?.particleSystems ?? [];
      const fissionMeshes = meshes
        .filter((mesh) => /^ff_/.test(mesh.name))
        .map((mesh) => ({
          name: mesh.name,
          visible: mesh.isVisible,
          alpha: mesh.material?.alpha ?? null,
          scalingY: mesh.scaling?.y ?? null,
        }));

      return {
        lastDebugScenario: window.__gloDebug?.lastDebugScenario ?? null,
        fps: engine?.getFps?.() ?? 0,
        fissionMeshNames: fissionMeshes.map((mesh) => mesh.name),
        visibleFissionMeshes: fissionMeshes.filter((mesh) => mesh.visible),
        hiddenFissionMeshes: fissionMeshes.filter((mesh) => mesh.visible === false),
        activeFissionSystems: particleSystems
          .filter((ps) => /^ff_/.test(ps.name))
          .map((ps) => ({ name: ps.name, emitRate: ps.emitRate ?? 0 })),
      };
    });

    expect(mushroomState.lastDebugScenario?.type).toBe('mushroom-cloud');
    expect(mushroomState.fissionMeshNames).toEqual(expect.arrayContaining([
      'ff_fireball',
      'ff_stemMesh',
      'ff_capMesh',
      'ff_capShelf',
    ]));
    expect(mushroomState.hiddenFissionMeshes.length).toBeGreaterThan(0);
    expect(mushroomState.activeFissionSystems.length).toBeGreaterThan(0);

    const settledState = await page.evaluate(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const scene = window.__gloClient?.scene;
      const engine = scene?.getEngine?.();
      return {
        fps: engine?.getFps?.() ?? 0,
        activeFissionMeshes: (scene?.meshes ?? []).filter((mesh) => /^ff_/.test(mesh.name)).length,
        activeFissionSystems: (scene?.particleSystems ?? []).filter((ps) => /^ff_/.test(ps.name)).length,
      };
    });

    expect(settledState.activeFissionMeshes).toBe(0);
    expect(settledState.activeFissionSystems).toBe(0);

    const criticalErrors = errors.filter(isCriticalError);
    expect(criticalErrors).toHaveLength(0);
  });
});
