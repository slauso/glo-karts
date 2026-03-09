import { test, expect } from '@playwright/test';

const VITE = 'http://localhost:5173';

test.describe('Single-player routing recovery', () => {
  test('resolved mode pages match solo runtime families', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const pages = await page.evaluate(async () => {
      const mod = await import('/src/modules/single-player-routing.js');
      return {
        quickRace: mod.resolveModePage('quick_race'),
        grandPrix: mod.resolveModePage('grand_prix'),
        soccer: mod.resolveModePage('soccer'),
        battleSolo: mod.resolveModePage('battle_solo'),
        threeStrikes: mod.resolveModePage('three_strikes'),
        splitRace: mod.resolveModePage('local_2p_race'),
      };
    });

    expect(pages.quickRace).toBe('game.html');
    expect(pages.grandPrix).toBe('game.html');
    expect(pages.soccer).toBe('game.html');
    expect(pages.battleSolo).toBe('battle.html');
    expect(pages.threeStrikes).toBe('battle.html');
    expect(pages.splitRace).toBe('splitscreen.html');
  });

  test('grand prix resolves cup track and bot defaults without fake multiplayer', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const config = await page.evaluate(async () => {
      const mod = await import('/src/modules/single-player-routing.js');
      return mod.buildResolvedModeConfig('grand_prix', { selectedCup: 'starter' });
    });

    expect(config.subMode).toBe('grand_prix');
    expect(config.multiplayer).toBe(false);
    expect(config.botCount).toBeGreaterThan(0);
    expect(config.trackId).toBeTruthy();
    expect(config.trackId).not.toBe('test_box');
  });

  test('battle solo keeps chosen arena and battle defaults', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const config = await page.evaluate(async () => {
      const mod = await import('/src/modules/single-player-routing.js');
      return mod.buildResolvedModeConfig('battle_solo', {
        selectedMap: 'blockfort',
        selectedBattleType: 'deathmatch',
      });
    });

    expect(config.arenaId).toBe('blockfort');
    expect(config.trackId).toBe('blockfort');
    expect(config.multiplayer).toBe(false);
    expect(config.botCount).toBeGreaterThan(0);
  });

  test('fallback track metadata is synthesized for addon race tracks', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const data = await page.evaluate(async () => {
      const mod = await import('/src/modules/track-data-loader.js');
      const td = await mod.loadTrackData('starter_circuit', 'track');
      return {
        driveline: td?.driveline?.length || 0,
        checkpoints: td?.checkpoints?.length || 0,
        starts: td?.startPositions?.length || 0,
      };
    });

    expect(data.driveline).toBeGreaterThan(20);
    expect(data.checkpoints).toBeGreaterThan(1);
    expect(data.starts).toBeGreaterThan(1);
  });

  test('fallback arena metadata is synthesized for addon battle arenas', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const data = await page.evaluate(async () => {
      const mod = await import('/src/modules/track-data-loader.js');
      const td = await mod.loadTrackData('nitro_soccer', 'arena');
      return {
        faces: td?.navmesh?.faces?.length || 0,
        vertices: td?.navmesh?.vertices?.length || 0,
        spawns: td?.spawnPositions?.length || 0,
      };
    });

    expect(data.faces).toBeGreaterThan(0);
    expect(data.vertices).toBeGreaterThan(3);
    expect(data.spawns).toBeGreaterThan(3);
  });
});