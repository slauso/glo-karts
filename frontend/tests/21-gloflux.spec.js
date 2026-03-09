/**
 * 21-gloflux.spec.js — Phase 20 checkpoint
 *
 * Validates the gloFLUX game mode: module exports, power-up system,
 * surge meter, mutations, arena generation, HUD, menu, VFX, AI,
 * network client, and page integration.
 */
import { test, expect } from '@playwright/test';

const VITE = 'http://localhost:5173';

test.describe('gloFLUX Module Exports', () => {

  test('glo-flux-powers exports all core functions', async ({ page }) => {
    await page.goto(`${VITE}/gloflux.html`, { waitUntil: 'domcontentloaded' });

    const exports = await page.evaluate(async () => {
      const mod = await import('/src/modules/gloflux/glo-flux-powers.js');
      return {
        FAMILY: typeof mod.FAMILY === 'object',
        FAMILY_META: typeof mod.FAMILY_META === 'object',
        POWERS: typeof mod.POWERS === 'object',
        SYNERGIES: typeof mod.SYNERGIES === 'object',
        drawPower: typeof mod.drawPower === 'function',
        drawFamilyPower: typeof mod.drawFamilyPower === 'function',
        detectSynergies: typeof mod.detectSynergies === 'function',
        calculateSurgeGain: typeof mod.calculateSurgeGain === 'function',
        createPowerState: typeof mod.createPowerState === 'function',
        activatePower: typeof mod.activatePower === 'function',
        tickPowers: typeof mod.tickPowers === 'function',
        awardEchoShards: typeof mod.awardEchoShards === 'function',
      };
    });

    for (const [name, ok] of Object.entries(exports)) {
      expect(ok, `${name} should be exported`).toBe(true);
    }
  });

  test('glo-flux-arena exports generator functions', async ({ page }) => {
    await page.goto(`${VITE}/gloflux.html`, { waitUntil: 'domcontentloaded' });

    const exports = await page.evaluate(async () => {
      const mod = await import('/src/modules/gloflux/glo-flux-arena.js');
      return {
        ARENA_VARIANT: typeof mod.ARENA_VARIANT === 'object',
        generateGloFluxArenaData: typeof mod.generateGloFluxArenaData === 'function',
        createShrinkState: typeof mod.createShrinkState === 'function',
        tickShrinkBoundary: typeof mod.tickShrinkBoundary === 'function',
        isOutsideBoundary: typeof mod.isOutsideBoundary === 'function',
        computeArenaMutations: typeof mod.computeArenaMutations === 'function',
      };
    });

    for (const [name, ok] of Object.entries(exports)) {
      expect(ok, `${name} should be exported`).toBe(true);
    }
  });

  test('glo-flux-surge exports surge system', async ({ page }) => {
    await page.goto(`${VITE}/gloflux.html`, { waitUntil: 'domcontentloaded' });

    const exports = await page.evaluate(async () => {
      const mod = await import('/src/modules/gloflux/glo-flux-surge.js');
      return {
        SURGE_TIER: typeof mod.SURGE_TIER === 'object',
        createSurgeState: typeof mod.createSurgeState === 'function',
        surgeFromChain: typeof mod.surgeFromChain === 'function',
        surgeFromKill: typeof mod.surgeFromKill === 'function',
        triggerApocalypseBurst: typeof mod.triggerApocalypseBurst === 'function',
        tickSurge: typeof mod.tickSurge === 'function',
        getSurgePercent: typeof mod.getSurgePercent === 'function',
        getSurgeTier: typeof mod.getSurgeTier === 'function',
        isBursting: typeof mod.isBursting === 'function',
      };
    });

    for (const [name, ok] of Object.entries(exports)) {
      expect(ok, `${name} should be exported`).toBe(true);
    }
  });

  test('glo-flux-mutations exports mutation system', async ({ page }) => {
    await page.goto(`${VITE}/gloflux.html`, { waitUntil: 'domcontentloaded' });

    const exports = await page.evaluate(async () => {
      const mod = await import('/src/modules/gloflux/glo-flux-mutations.js');
      return {
        MUTATION_TIER: typeof mod.MUTATION_TIER === 'object',
        createMutationState: typeof mod.createMutationState === 'function',
        infectKart: typeof mod.infectKart === 'function',
        computeDeformedPositions: typeof mod.computeDeformedPositions === 'function',
        serializeMutation: typeof mod.serializeMutation === 'function',
        deserializeMutation: typeof mod.deserializeMutation === 'function',
        isMutated: typeof mod.isMutated === 'function',
        isApex: typeof mod.isApex === 'function',
      };
    });

    for (const [name, ok] of Object.entries(exports)) {
      expect(ok, `${name} should be exported`).toBe(true);
    }
  });

  test('glo-flux-vfx exports VFX system', async ({ page }) => {
    await page.goto(`${VITE}/gloflux.html`, { waitUntil: 'domcontentloaded' });

    const exports = await page.evaluate(async () => {
      const mod = await import('/src/modules/gloflux/glo-flux-vfx.js');
      return {
        createVFXState: typeof mod.createVFXState === 'function',
        requestPowerVFX: typeof mod.requestPowerVFX === 'function',
        releasePowerVFX: typeof mod.releasePowerVFX === 'function',
        tickPostProcess: typeof mod.tickPostProcess === 'function',
        getApocalypseBurstVFX: typeof mod.getApocalypseBurstVFX === 'function',
        disposeVFX: typeof mod.disposeVFX === 'function',
      };
    });

    for (const [name, ok] of Object.entries(exports)) {
      expect(ok, `${name} should be exported`).toBe(true);
    }
  });

  test('glo-flux-hud exports HUD system', async ({ page }) => {
    await page.goto(`${VITE}/gloflux.html`, { waitUntil: 'domcontentloaded' });

    const exports = await page.evaluate(async () => {
      const mod = await import('/src/modules/gloflux/glo-flux-hud.js');
      return {
        createHUDState: typeof mod.createHUDState === 'function',
        updateSurge: typeof mod.updateSurge === 'function',
        updatePowerSlots: typeof mod.updatePowerSlots === 'function',
        renderHUD: typeof mod.renderHUD === 'function',
        disposeHUD: typeof mod.disposeHUD === 'function',
      };
    });

    for (const [name, ok] of Object.entries(exports)) {
      expect(ok, `${name} should be exported`).toBe(true);
    }
  });

  test('glo-flux-menu exports menu system', async ({ page }) => {
    await page.goto(`${VITE}/gloflux.html`, { waitUntil: 'domcontentloaded' });

    const exports = await page.evaluate(async () => {
      const mod = await import('/src/modules/gloflux/glo-flux-menu.js');
      return {
        MENU_SCREEN: typeof mod.MENU_SCREEN === 'object',
        createMenuState: typeof mod.createMenuState === 'function',
        mountMenu: typeof mod.mountMenu === 'function',
        hideMenu: typeof mod.hideMenu === 'function',
        disposeMenu: typeof mod.disposeMenu === 'function',
      };
    });

    for (const [name, ok] of Object.entries(exports)) {
      expect(ok, `${name} should be exported`).toBe(true);
    }
  });

  test('glo-flux-ai exports bot fleet', async ({ page }) => {
    await page.goto(`${VITE}/gloflux.html`, { waitUntil: 'domcontentloaded' });

    const exports = await page.evaluate(async () => {
      const mod = await import('/src/modules/gloflux/glo-flux-ai.js');
      return {
        createBotFleet: typeof mod.createBotFleet === 'function',
        tickBots: typeof mod.tickBots === 'function',
        disposeBots: typeof mod.disposeBots === 'function',
      };
    });

    for (const [name, ok] of Object.entries(exports)) {
      expect(ok, `${name} should be exported`).toBe(true);
    }
  });

  test('glo-flux-network exports client adapter', async ({ page }) => {
    await page.goto(`${VITE}/gloflux.html`, { waitUntil: 'domcontentloaded' });

    const exports = await page.evaluate(async () => {
      const mod = await import('/src/modules/gloflux/glo-flux-network.js');
      return {
        createGloFluxClient: typeof mod.createGloFluxClient === 'function',
      };
    });

    expect(exports.createGloFluxClient).toBe(true);
  });
});

test.describe('gloFLUX Power-Up Logic', () => {

  test('20 power-ups across 4 families', async ({ page }) => {
    await page.goto(`${VITE}/gloflux.html`, { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async () => {
      const { POWERS, FAMILY, getAllPowerIds } = await import('/src/modules/gloflux/glo-flux-powers.js');
      const ids = getAllPowerIds();
      const families = new Set(Object.values(POWERS).map(p => p.family));
      return { count: ids.length, familyCount: families.size };
    });

    expect(result.count).toBe(20);
    expect(result.familyCount).toBe(4);
  });

  test('synergy detection works for known combo', async ({ page }) => {
    await page.goto(`${VITE}/gloflux.html`, { waitUntil: 'domcontentloaded' });

    const synergies = await page.evaluate(async () => {
      const { detectSynergies } = await import('/src/modules/gloflux/glo-flux-powers.js');
      return detectSynergies(['echo_phantom', 'quantum_duplicate']);
    });

    expect(synergies.length).toBeGreaterThan(0);
    expect(synergies[0].id).toBe('horde_split');
  });

  test('activatePower grants power and tracks state', async ({ page }) => {
    await page.goto(`${VITE}/gloflux.html`, { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async () => {
      const { createPowerState, activatePower } = await import('/src/modules/gloflux/glo-flux-powers.js');
      const state = createPowerState();
      const r = activatePower(state, 'echo_phantom', Date.now());
      return { hasPower: !!r.power, activeKeys: Object.keys(state.active) };
    });

    expect(result.hasPower).toBe(true);
    expect(result.activeKeys).toContain('echo_phantom');
  });
});

test.describe('gloFLUX Surge System', () => {

  test('surge accumulates from kills and chains', async ({ page }) => {
    await page.goto(`${VITE}/gloflux.html`, { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async () => {
      const { createSurgeState, surgeFromKill, surgeFromChain, getSurgePercent } = await import('/src/modules/gloflux/glo-flux-surge.js');
      const state = createSurgeState();
      const now = Date.now();
      surgeFromKill(state, now);
      surgeFromKill(state, now);
      surgeFromChain(state, ['echo_phantom', 'quantum_duplicate'], now);
      return { percent: getSurgePercent(state) };
    });

    expect(result.percent).toBeGreaterThan(0);
  });

  test('apocalypse burst triggers at max surge', async ({ page }) => {
    await page.goto(`${VITE}/gloflux.html`, { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async () => {
      const { createSurgeState, triggerApocalypseBurst, isBursting } = await import('/src/modules/gloflux/glo-flux-surge.js');
      const state = createSurgeState();
      state.current = 100;
      state.tier = 4;
      const burst = triggerApocalypseBurst(state);
      return { isBursting: isBursting(state), hasDuration: burst.duration > 0 };
    });

    expect(result.isBursting).toBe(true);
    expect(result.hasDuration).toBe(true);
  });
});

test.describe('gloFLUX Mutation System', () => {

  test('infectKart advances mutation tier', async ({ page }) => {
    await page.goto(`${VITE}/gloflux.html`, { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async () => {
      const { createMutationState, infectKart, isMutated } = await import('/src/modules/gloflux/glo-flux-mutations.js');
      const { FAMILY } = await import('/src/modules/gloflux/glo-flux-powers.js');
      const state = createMutationState();
      const now = Date.now();
      for (let i = 0; i < 8; i++) {
        infectKart(state, 'echo_phantom', FAMILY.PHANTOM_HORDE, now + i);
      }
      return { tier: state.tier, mutated: isMutated(state) };
    });

    expect(result.tier).toBeGreaterThanOrEqual(2);
    expect(result.mutated).toBe(true);
  });

  test('serialize/deserialize mutation state roundtrips', async ({ page }) => {
    await page.goto(`${VITE}/gloflux.html`, { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async () => {
      const { createMutationState, infectKart, serializeMutation, deserializeMutation } = await import('/src/modules/gloflux/glo-flux-mutations.js');
      const { FAMILY } = await import('/src/modules/gloflux/glo-flux-powers.js');
      const state = createMutationState();
      infectKart(state, 'gravity_well', FAMILY.ENTROPIC_VOID, Date.now());
      const ser = serializeMutation(state);
      const restored = deserializeMutation(ser);
      return { tierMatch: restored.tier === state.tier, familyMatch: restored.dominantFamily === state.dominantFamily };
    });

    expect(result.tierMatch).toBe(true);
    expect(result.familyMatch).toBe(true);
  });
});

test.describe('gloFLUX Arena Generation', () => {

  test('generateGloFluxArenaData produces valid arena data', async ({ page }) => {
    await page.goto(`${VITE}/gloflux.html`, { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async () => {
      const { generateGloFluxArenaData, ARENA_VARIANT } = await import('/src/modules/gloflux/glo-flux-arena.js');
      const data = generateGloFluxArenaData('nuclear_desert', { variant: ARENA_VARIANT.ARENA, halfSize: 60 });
      return {
        hasSpawnPoints: data.spawnPoints.length > 0,
        hasPowerUpSpawns: data.powerUpSpawns.length > 0,
        hasHazardZones: data.hazardZones.length > 0,
      };
    });

    expect(result.hasSpawnPoints).toBe(true);
    expect(result.hasPowerUpSpawns).toBe(true);
    expect(result.hasHazardZones).toBe(true);
  });

  test('shrink boundary damages outside players', async ({ page }) => {
    await page.goto(`${VITE}/gloflux.html`, { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async () => {
      const { createShrinkState, tickShrinkBoundary, isOutsideBoundary } = await import('/src/modules/gloflux/glo-flux-arena.js');
      const state = createShrinkState(60, 10);
      tickShrinkBoundary(state, 5); // shrink by 50
      return {
        outside: isOutsideBoundary(state, 20, 0),
        inside: !isOutsideBoundary(state, 3, 0),
      };
    });

    expect(result.outside).toBe(true);
    expect(result.inside).toBe(true);
  });
});

test.describe('gloFLUX VFX System', () => {

  test('VFX budget respects global cap', async ({ page }) => {
    await page.goto(`${VITE}/gloflux.html`, { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async () => {
      const { createVFXState, requestPowerVFX } = await import('/src/modules/gloflux/glo-flux-vfx.js');
      const state = createVFXState();
      const now = Date.now();
      let allowed = 0;
      let denied = 0;
      for (let i = 0; i < 20; i++) {
        const r = requestPowerVFX(state, 'echo_phantom', now + i);
        if (r.allowed) allowed++;
        else denied++;
      }
      return { allowed, denied, hasCap: denied > 0 };
    });

    expect(result.hasCap).toBe(true);
    expect(result.allowed).toBeLessThanOrEqual(12);
  });
});

test.describe('gloFLUX Page Integration', () => {

  test('gloflux.html loads without fatal errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(`${VITE}/gloflux.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // Filter out expected WebGL/Babylon startup noise
    const fatal = errors.filter(e =>
      !e.includes('WebGL') && !e.includes('BABYLON') && !e.includes('Havok')
    );
    // Allow Babylon/WebGL init errors on headless, but no JS syntax/import errors
    const syntaxErrors = fatal.filter(e =>
      e.includes('SyntaxError') || e.includes('Cannot find module') || e.includes('is not defined')
    );
    expect(syntaxErrors).toHaveLength(0);
  });

  test('gloflux menu renders on page load', async ({ page }) => {
    await page.goto(`${VITE}/gloflux.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const hasMenu = await page.evaluate(() => {
      return !!document.getElementById('gloflux-menu');
    });

    expect(hasMenu).toBe(true);
  });

  test('canvas element exists', async ({ page }) => {
    await page.goto(`${VITE}/gloflux.html`, { waitUntil: 'domcontentloaded' });

    const hasCanvas = await page.evaluate(() => {
      return !!document.getElementById('gloflux-canvas');
    });

    expect(hasCanvas).toBe(true);
  });

  test('lobby index.html has gloFLUX button', async ({ page }) => {
    await page.goto(`${VITE}/index.html`, { waitUntil: 'domcontentloaded' });

    const hasBtn = await page.evaluate(() => {
      return !!document.getElementById('gloflux-btn');
    });

    expect(hasBtn).toBe(true);
  });

  test('game-modes registry includes gloflux entries', async ({ page }) => {
    await page.goto(`${VITE}/index.html`, { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async () => {
      const { MODE_REGISTRY } = await import('/src/game-modes.js');
      return {
        hasRace: !!MODE_REGISTRY.gloflux_race,
        hasArena: !!MODE_REGISTRY.gloflux_arena,
        racePage: MODE_REGISTRY.gloflux_race?.page,
        arenaPage: MODE_REGISTRY.gloflux_arena?.page,
      };
    });

    expect(result.hasRace).toBe(true);
    expect(result.hasArena).toBe(true);
    expect(result.racePage).toBe('gloflux.html');
    expect(result.arenaPage).toBe('gloflux.html');
  });
});
