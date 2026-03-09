import { test, expect } from '@playwright/test';

const VITE = 'http://localhost:5173';

test.describe('Phase 19 — Demo course integration (STK tracks removed)', () => {

  // ── Track Registry: only procedural entries remain ─────────────────────
  test('track-data registry contains only glo_circuit, glo_arena, test_box', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const data = await page.evaluate(async () => {
      const mod = await import('/src/modules/track-data.js');
      const reg = mod.getTrackRegistry();
      const ids = Object.keys(reg);
      return {
        ids,
        count: ids.length,
        hasGloCircuit: 'glo_circuit' in reg,
        hasGloArena: 'glo_arena' in reg,
        hasTestBox: 'test_box' in reg,
        gloCircuitType: reg.glo_circuit?.type,
        gloArenaType: reg.glo_arena?.type,
      };
    });

    expect(data.count).toBe(3);
    expect(data.hasGloCircuit).toBe(true);
    expect(data.hasGloArena).toBe(true);
    expect(data.hasTestBox).toBe(true);
    expect(data.gloCircuitType).toBe('procedural');
    expect(data.gloArenaType).toBe('procedural-arena');
  });

  test('isSTKTrack / isSTKArena always return false (no STK content)', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const data = await page.evaluate(async () => {
      const mod = await import('/src/modules/track-data.js');
      return {
        stkTrack: mod.isSTKTrack('cocoa_temple'),
        stkArena: mod.isSTKArena('battleisland'),
        customMap: mod.isCustomMap('some_map'),
        addonTrack: mod.isAddonTrack('addon_something'),
        modelPath: mod.getTrackModelPath('glo_circuit'),
      };
    });

    expect(data.stkTrack).toBe(false);
    expect(data.stkArena).toBe(false);
    expect(data.customMap).toBe(false);
    expect(data.addonTrack).toBe(false);
    expect(data.modelPath).toBeNull();
  });

  // ── Content Registry: ALL_TRACKS / ALL_ARENAS ─────────────────────────
  test('ALL_TRACKS contains glo_circuit and test_box, ALL_ARENAS contains glo_arena', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const data = await page.evaluate(async () => {
      const mod = await import('/src/modules/content-registry.js');
      return {
        trackIds: Object.keys(mod.ALL_TRACKS),
        arenaIds: Object.keys(mod.ALL_ARENAS),
        verifiedIds: mod.VERIFIED_RACE_TRACK_IDS,
      };
    });

    expect(data.trackIds).toContain('glo_circuit');
    expect(data.arenaIds).toContain('glo_arena');
    expect(data.verifiedIds).toContain('glo_circuit');
    // No STK tracks should be present
    expect(data.trackIds).not.toContain('cocoa_temple');
    expect(data.trackIds).not.toContain('cornfield_crossing');
    expect(data.arenaIds).not.toContain('battleisland');
    expect(data.arenaIds).not.toContain('stadium');
  });

  test('SINGLE_PLAYER_CUPS has only starter cup with glo_circuit tracks', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const data = await page.evaluate(async () => {
      const mod = await import('/src/modules/content-registry.js');
      const cupOrder = mod.getSinglePlayerCupsInOrder();
      const starterCup = mod.SINGLE_PLAYER_CUPS.starter;
      return {
        cupOrderIds: cupOrder.map(c => c.id),
        cupCount: cupOrder.length,
        starterLabel: starterCup?.label,
        starterTrackIds: starterCup?.trackIds,
      };
    });

    expect(data.cupCount).toBe(1);
    expect(data.cupOrderIds).toEqual(['starter']);
    expect(data.starterLabel).toBe('Glo Cup');
    expect(data.starterTrackIds).toEqual(['glo_circuit', 'glo_circuit', 'glo_circuit', 'glo_circuit']);
  });

  // ── Procedural Demo Course generator ───────────────────────────────────
  test('procedural-demo-course exports data-only generators with valid structure', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const data = await page.evaluate(async () => {
      const mod = await import('/src/modules/procedural-demo-course.js');
      const course = mod.generateDemoCourseDataOnly(3);
      const arena = mod.generateDemoArenaDataOnly();
      return {
        // Course checks
        hasDriveline: Array.isArray(course.driveline) && course.driveline.length > 20,
        hasCheckpoints: Array.isArray(course.checkpoints) && course.checkpoints.length >= 4,
        hasStartPositions: Array.isArray(course.startPositions) && course.startPositions.length >= 4,
        courseLaps: course.laps,
        hasGraph: course.graph != null,
        hasSurfaces: Array.isArray(course.surfaceZones) && course.surfaceZones.length >= 1,
        hasBoostZone: Array.isArray(course.surfaceZones) && course.surfaceZones.some(z => z.type === 'boost'),
        hasItems: Array.isArray(course.items) && course.items.length >= 1,
        // Arena checks
        hasNavmesh: arena.navmesh != null,
        hasSpawnPositions: Array.isArray(arena.spawnPositions) && arena.spawnPositions.length >= 4,
        hasArenaStartPositions: Array.isArray(arena.startPositions) && arena.startPositions.length >= 4,
        arenaLaps: arena.laps,
        hasArenaItems: Array.isArray(arena.items) && arena.items.length >= 1,
      };
    });

    expect(data.hasDriveline).toBe(true);
    expect(data.hasCheckpoints).toBe(true);
    expect(data.hasStartPositions).toBe(true);
    expect(data.courseLaps).toBe(3);
    expect(data.hasGraph).toBe(true);
    expect(data.hasSurfaces).toBe(true);
    expect(data.hasBoostZone).toBe(true);
    expect(data.hasItems).toBe(true);

    expect(data.hasNavmesh).toBe(true);
    expect(data.hasSpawnPositions).toBe(true);
    expect(data.hasArenaStartPositions).toBe(true);
    expect(data.arenaLaps).toBe(1);
    expect(data.hasArenaItems).toBe(true);
  });

  // ── Track Data Loader: routes glo_circuit / glo_arena correctly ────────
  test('track-data-loader resolves glo_circuit via demo course generator', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const data = await page.evaluate(async () => {
      const mod = await import('/src/modules/track-data-loader.js');
      const td = await mod.loadTrackData('glo_circuit', 'track');
      return {
        hasDriveline: Array.isArray(td.driveline) && td.driveline.length > 10,
        hasCheckpoints: Array.isArray(td.checkpoints) && td.checkpoints.length >= 2,
        hasStartPositions: Array.isArray(td.startPositions) && td.startPositions.length >= 4,
        laps: td.laps,
      };
    });

    expect(data.hasDriveline).toBe(true);
    expect(data.hasCheckpoints).toBe(true);
    expect(data.hasStartPositions).toBe(true);
    expect(data.laps).toBe(3);
  });

  test('track-data-loader resolves glo_arena via demo arena generator', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const data = await page.evaluate(async () => {
      const mod = await import('/src/modules/track-data-loader.js');
      const ad = await mod.loadTrackData('glo_arena', 'arena');
      return {
        hasNavmesh: ad.navmesh != null,
        hasSpawnPositions: Array.isArray(ad.spawnPositions) && ad.spawnPositions.length >= 4,
        laps: ad.laps,
      };
    });

    expect(data.hasNavmesh).toBe(true);
    expect(data.hasSpawnPositions).toBe(true);
    expect(data.laps).toBe(1);
  });

  // ── Single Player Routing: arena fallback uses glo_arena ──────────────
  test('single-player-routing arena fallback resolves to glo_arena', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const data = await page.evaluate(async () => {
      const mod = await import('/src/modules/single-player-routing.js');
      // Pass an invalid arena to force fallback
      const list = mod.getSelectableContentList('battle_solo');
      return {
        ids: list.map(e => e.id),
        hasGloArena: list.some(e => e.id === 'glo_arena'),
        noSTKArenas: !list.some(e => e.id === 'battleisland' || e.id === 'stadium'),
      };
    });

    expect(data.hasGloArena).toBe(true);
    expect(data.noSTKArenas).toBe(true);
  });

  test('single-player-routing track list shows glo_circuit', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const data = await page.evaluate(async () => {
      const mod = await import('/src/modules/single-player-routing.js');
      const list = mod.getSelectableContentList('quick_race');
      return {
        ids: list.map(e => e.id),
        hasGloCircuit: list.some(e => e.id === 'glo_circuit'),
        noSTKTracks: !list.some(e =>
          e.id === 'cocoa_temple' || e.id === 'cornfield_crossing' || e.id === 'lighthouse'
        ),
      };
    });

    expect(data.hasGloCircuit).toBe(true);
    expect(data.noSTKTracks).toBe(true);
  });

  // ── Content Resolution: resolveArenaAsset / resolveTrackAsset ─────────
  test('resolveArenaAsset defaults to glo_arena', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const data = await page.evaluate(async () => {
      const mod = await import('/src/modules/content-registry.js');
      const defaultAsset = mod.resolveArenaAsset();
      const byId = mod.resolveArenaAsset('glo_arena');
      const invalidFallback = mod.resolveArenaAsset('nonexistent_arena');
      return {
        defaultId: defaultAsset?.id,
        byIdId: byId?.id,
        invalidFallbackId: invalidFallback?.id,
      };
    });

    expect(data.defaultId).toBe('glo_arena');
    expect(data.byIdId).toBe('glo_arena');
    expect(data.invalidFallbackId).toBe('glo_arena');
  });

  test('resolvePlayableRaceTrack falls back to glo_circuit', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const data = await page.evaluate(async () => {
      const mod = await import('/src/modules/content-registry.js');
      const result = mod.resolvePlayableRaceTrack('nonexistent_track');
      return { trackId: result };
    });

    expect(data.trackId).toBe('glo_circuit');
  });
});
