import { test, expect } from '@playwright/test';
import {
  injectGameConfig,
  isCriticalError,
} from './helpers/game-helpers.js';

const GLOFLUX_ARCH_CONFIG = {
  gameMode: 'gloflux',
  multiplayer: false,
  variant: 'arena',
  subMode: 'arena',
  botCount: 0,
  selectedKart: 'tux',
  playerName: 'Architecture Test',
};

async function waitForModeReady(page, timeout = 30_000) {
  await page.waitForFunction(
    () => {
      const orch = window.__gloflux?._orch;
      const mode = window.__glofluxMode;
      return !!(
        orch &&
        orch.scene &&
        orch.hud?.canvas &&
        orch.players?.length >= 1 &&
        mode &&
        mode.familyRegistry &&
        mode.coreManager &&
        mode.arenaEvolver?.initialized
      );
    },
    null,
    { timeout },
  );
}

async function seedDeterministicLocalPlayer(page) {
  await page.evaluate(async () => {
    const orch = window.__gloflux._orch;
    const mode = window.__glofluxMode;
    const [{ createPowerState }, { createSurgeState }, { createMutationState }] = await Promise.all([
      import('/src/modules/gloflux/glo-flux-powers.js'),
      import('/src/modules/gloflux/glo-flux-surge.js'),
      import('/src/modules/gloflux/glo-flux-mutations.js'),
    ]);

    orch.state = 'flux_active';

    let player = orch.players.find((entry) => entry.id === orch.localPlayerId);
    if (!player) {
      player = {
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
        health: 100,
        maxHealth: 100,
        score: 0,
        kills: 0,
        lap: 1,
        checkpoint: 0,
        name: 'Architecture Local',
      };
      orch.players.push(player);
    }

    player.powerState = createPowerState();
    player.surgeState = createSurgeState();
    player.mutationState = createMutationState();
    mode.registerPlayer(player);
  });
}

test.describe.configure({ mode: 'serial' });

test.describe('Glo Flux Mode Architecture', () => {
  test('initializes families, detects chains, updates surge, and mutates the arena', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await injectGameConfig(page, GLOFLUX_ARCH_CONFIG);
    await page.goto('/gloflux.html');

    await waitForModeReady(page);
    await seedDeterministicLocalPlayer(page);

    const sequenceSnapshot = await page.evaluate(() => {
      const orch = window.__gloflux._orch;
      const mode = window.__glofluxMode;
      const player = orch.players.find((entry) => entry.id === orch.localPlayerId);
      const baseNow = Date.now();
      const sequence = [
        'gravity_well',
        'dimensional_rift',
        'phase_shift',
        'bio_regen_cocoon',
      ];

      const results = sequence.map((powerId, index) => {
        const now = baseNow + index * 250;
        const result = mode.handleCoreCollected(player, powerId, now);
        mode.update(16, now);
        return {
          powerId,
          comboId: result?.chainEvent?.comboId || null,
          mutationTier: player.mutationState?.tier || 0,
          surgeMeter: mode.coreManager.players.get(player.id)?.surgeState?.meter || 0,
        };
      });

      return {
        familyCount: mode.familyRegistry.getFamilies().length,
        results,
      };
    });

    await page.waitForFunction(
      () => {
        const mode = window.__glofluxMode;
        if (!mode) return false;
        mode.update(16, Date.now());
        return mode.arenaEvolver.getDebugState().mutationStackVersion >= 2;
      },
      null,
      { timeout: 10_000 },
    );

    const finalSnapshot = await page.evaluate(() => {
      const orch = window.__gloflux._orch;
      const mode = window.__glofluxMode;
      const player = orch.players.find((entry) => entry.id === orch.localPlayerId);

      mode.update(16, Date.now());

      return {
        playerDebug: mode.coreManager.getPlayerDebugState(player.id),
        arenaDebug: mode.arenaEvolver.getDebugState(),
        hud: {
          comboCount: orch.hud.comboCount,
          comboMultiplier: orch.hud.comboMultiplier,
          surgePercent: orch.hud.surgePercent,
          surgeTier: orch.hud.surgeTier,
          surgeDominantFamily: orch.hud.surgeDominantFamily,
        },
      };
    });

    expect(sequenceSnapshot.familyCount).toBe(4);
    expect(sequenceSnapshot.results.map((entry) => entry.comboId).filter(Boolean)).toEqual([
      'void_portal',
      'fractal_cocoon',
    ]);

    expect(finalSnapshot.playerDebug.chainCount).toBeGreaterThanOrEqual(2);
    expect(finalSnapshot.playerDebug.mutationTier).toBeGreaterThan(0);
    expect(finalSnapshot.playerDebug.surgeMeter).toBeGreaterThan(0);

    expect(finalSnapshot.arenaDebug.mutationStackVersion).toBeGreaterThanOrEqual(2);
    expect(finalSnapshot.arenaDebug.patchCount).toBeGreaterThanOrEqual(2);
    expect(finalSnapshot.arenaDebug.hasMutationSurface).toBe(true);
    expect(finalSnapshot.arenaDebug.thinInstances.entropic_void).toBeGreaterThan(0);
    expect(finalSnapshot.arenaDebug.thinInstances.biofractal_aegis).toBeGreaterThan(0);
    expect(finalSnapshot.arenaDebug.vineParticleCount).toBeGreaterThan(0);

    expect(finalSnapshot.hud.comboCount).toBeGreaterThanOrEqual(2);
    expect(finalSnapshot.hud.comboMultiplier).toBeGreaterThan(1);

    const criticalErrors = errors.filter(isCriticalError);
    expect(criticalErrors).toHaveLength(0);
  });
});