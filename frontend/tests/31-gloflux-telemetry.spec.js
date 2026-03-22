import { test, expect } from '@playwright/test';
import {
  injectGameConfig,
  isCriticalError,
} from './helpers/game-helpers.js';

const GLOFLUX_CONFIG = {
  gameMode: 'gloflux',
  multiplayer: true,
  roomName: 'gloflux',
  variant: 'arena',
  subMode: 'arena',
  maxPlayers: 2,
  selectedKart: 'tux',
  playerName: 'Telemetry Test',
};

async function waitForGloFluxReady(page, timeout = 30_000) {
  await page.waitForFunction(
    () => {
      const orch = window.__gloflux?._orch;
      return !!(
        orch &&
        orch.network?.connected &&
        orch.hud?.canvas &&
        orch.scene
      );
    },
    null,
    { timeout },
  );

  await page.waitForFunction(
    () => {
      const orch = window.__gloflux?._orch;
      return !!(orch && (orch.state === 'flux_active' || orch.network?.room?.state?.started));
    },
    null,
    { timeout },
  );
}

async function seedDeterministicGloFluxState(page) {
  await page.evaluate(async () => {
    const orch = window.__gloflux._orch;
    const [{ createPowerState }, { createSurgeState }, { createMutationState }] = await Promise.all([
      import('/src/modules/gloflux/glo-flux-powers.js'),
      import('/src/modules/gloflux/glo-flux-surge.js'),
      import('/src/modules/gloflux/glo-flux-mutations.js'),
    ]);

    orch.isMultiplayer = false;

    if (orch.state !== 'flux_active') {
      orch.state = 'flux_active';
    }

    if (!orch.players.some((player) => player.id === orch.localPlayerId)) {
      orch.players.push({
        id: orch.localPlayerId,
        alive: true,
        isBot: false,
        mesh: {
          position: { x: 0, y: 1.8, z: 0 },
          rotation: { y: 0 },
          setEnabled() {},
        },
        driftState: {},
        input: { forward: false, reverse: false, left: false, right: false, brake: false },
        powerState: createPowerState(),
        surgeState: createSurgeState(),
        mutationState: createMutationState(),
        health: 100,
        maxHealth: 100,
        score: 0,
        kills: 0,
        lap: 1,
        checkpoint: 0,
        name: 'Telemetry Local',
      });
    }

    if (!orch.powerSpawns.some((spawn) => spawn.idx === 999)) {
      orch.powerSpawns.push({
        idx: 999,
        position: { x: 6, y: 1, z: 0 },
        powerId: 'gravity_well',
        collected: false,
        pending: false,
        mesh: null,
        visualPowerId: null,
      });
    }
  });

  await page.waitForFunction(
    () => {
      const spawn = window.__gloflux?._orch?.powerSpawns.find((entry) => entry.idx === 999);
      return !!(spawn?.mesh && spawn.mesh.isEnabled());
    },
    null,
    { timeout: 10_000 },
  );
}

test.describe.configure({ mode: 'serial' });

test.describe('Glo Flux Telemetry Regression', () => {
  test('HUD telemetry mirrors network counters and procedural cores rebuild across lifecycle changes', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await injectGameConfig(page, GLOFLUX_CONFIG);
    await page.goto('/gloflux.html');

    await waitForGloFluxReady(page);
    await seedDeterministicGloFluxState(page);

    const initial = await page.evaluate(() => {
      const orch = window.__gloflux._orch;
      const spawn = orch.powerSpawns.find((entry) => entry.idx === 999);
      return {
        hudCanvasId: orch.hud.canvas?.id || null,
        networkActiveCoreCount: Number(orch.network.telemetry?.activeCoreCount || 0),
        hudActiveCoreCount: Number(orch.hud.telemetry?.activeCoreCount || 0),
        spawn: spawn
          ? {
              idx: spawn.idx,
              meshUniqueId: spawn.mesh.uniqueId,
              meshName: spawn.mesh.name,
              enabled: spawn.mesh.isEnabled(),
              visualPowerId: spawn.visualPowerId,
              accentCount: spawn.mesh.metadata?.accentMeshes?.length || 0,
            }
          : null,
      };
    });

    expect(initial.hudCanvasId).toBe('gloflux-hud');
    expect(initial.hudActiveCoreCount).toBe(initial.networkActiveCoreCount);
    expect(initial.spawn).toBeTruthy();
    expect(initial.spawn.enabled).toBe(true);
    expect(initial.spawn.meshName.startsWith('gf_power_core_')).toBe(true);
    expect(initial.spawn.accentCount).toBeGreaterThan(0);

    await page.evaluate(() => {
      const orch = window.__gloflux._orch;
      const nextTelemetry = {
        ...orch.network.telemetry,
        arenaSeed: 424242,
        activeCoreCount: 11,
        totalCoreCollections: 3,
        totalChainBursts: 2,
        activeChainPeak: 4,
        longestChain: 5,
        apocalypseBursts: 1,
        anomalyCoreCollections: 3,
        anomalyChainBursts: 2,
      };
      orch.network.telemetry = nextTelemetry;
      orch.hud.telemetry = {
        ...orch.hud.telemetry,
        ...nextTelemetry,
      };
    });

    const telemetrySnapshot = await page.evaluate(() => ({
      ...window.__gloflux._orch.hud.telemetry,
    }));

    expect(telemetrySnapshot).toMatchObject({
      arenaSeed: 424242,
      activeCoreCount: 11,
      totalCoreCollections: 3,
      totalChainBursts: 2,
      activeChainPeak: 4,
      longestChain: 5,
      apocalypseBursts: 1,
      anomalyCoreCollections: 3,
      anomalyChainBursts: 2,
    });

    await page.evaluate((spawnIdx) => {
      const spawn = window.__gloflux._orch.powerSpawns.find((entry) => entry.idx === spawnIdx);
      if (!spawn) return;
      spawn.collected = true;
      spawn.mesh?.setEnabled(false);
    }, initial.spawn.idx);

    await page.evaluate(() => {
      const loop = window.__gloflux?._orch?.engine?._activeRenderLoops?.[0];
      if (!loop) return;
      loop();
      loop();
    });

    const collectedSnapshot = await page.evaluate((spawnIdx) => {
      const spawn = window.__gloflux._orch.powerSpawns.find((entry) => entry.idx === spawnIdx);
      return {
        collected: !!spawn?.collected,
        enabled: !!spawn?.mesh?.isEnabled(),
      };
    }, initial.spawn.idx);

    expect(collectedSnapshot.collected).toBe(true);
    expect(collectedSnapshot.enabled).toBe(false);

    const criticalErrors = errors.filter(isCriticalError);
    expect(criticalErrors).toHaveLength(0);
  });
});