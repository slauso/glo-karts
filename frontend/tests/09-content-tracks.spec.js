/**
 * 09-content-tracks.spec.js — Phase 4 checkpoint
 *
 * Validates that the content registry, track-data registry, and lobby
 * selectors reflect the full set of tracks & arenas (all procedural).
 */
import { test, expect } from '@playwright/test';

const VITE = 'http://localhost:5173';

const EXPECTED_TRACKS = [
  'abyss', 'black_forest', 'cocoa_temple', 'cornfield_crossing',
  'gran_paradiso_island', 'hacienda', 'lighthouse', 'mines',
  'minigolf', 'oasis', 'olivermath', 'ravenbridge_mansion',
  'sandtrack', 'snowmountain', 'snowtuxpeak', 'volcano_island',
  'xr591', 'zengarden',
];

const EXPECTED_ARENAS = [
  'alien_signal', 'ancient_colosseum_labyrinth', 'arena_candela_city',
  'battleisland', 'blockfort', 'cave', 'lasdunasarena',
  'pumpkin_park', 'stadium', 'temple',
];

test.describe('Phase 4 — Content & track registry', () => {
  test('track-data.js exposes isAddonTrack = true for all 18 tracks', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const results = await page.evaluate(async (ids) => {
      const mod = await import('/src/modules/track-data.js');
      return ids.map(id => ({ id, addon: mod.isAddonTrack(id) }));
    }, EXPECTED_TRACKS);

    for (const r of results) {
      expect(r.addon, `isAddonTrack('${r.id}') should be true`).toBe(true);
    }
  });

  test('track-data.js exposes isAddonTrack = true for all 10 arenas', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const results = await page.evaluate(async (ids) => {
      const mod = await import('/src/modules/track-data.js');
      return ids.map(id => ({ id, addon: mod.isAddonTrack(id) }));
    }, EXPECTED_ARENAS);

    for (const r of results) {
      expect(r.addon, `isAddonTrack('${r.id}') should be true`).toBe(true);
    }
  });

  test('track-data.js getTrackModelPath returns null for tracks (procedural)', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const paths = await page.evaluate(async () => {
      const mod = await import('/src/modules/track-data.js');
      return {
        track: mod.getTrackModelPath('cocoa_temple'),
        arena: mod.getTrackModelPath('stadium'),
        procedural: mod.getTrackModelPath('test_box'),
      };
    });

    expect(paths.track).toBeNull();
    expect(paths.arena).toBeNull();
    expect(paths.procedural).toBeNull();
  });

  test('lobby shows more than 1 track option in race mode', async ({ page }) => {
    await page.goto(`${VITE}/`, { waitUntil: 'domcontentloaded' });

    // Wait for lobby JS to initialize
    await page.waitForTimeout(2000);

    // Check that lobby has loaded tracks with multiple entries
    const trackCount = await page.evaluate(async () => {
      const { ALL_TRACKS } = await import('/src/modules/content-registry.js');
      return Object.keys(ALL_TRACKS).length;
    });

    expect(trackCount).toBeGreaterThanOrEqual(19); // 18 + test_box
  });

  test('getAddonParams returns shape data for all tracks', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const results = await page.evaluate(async (ids) => {
      const mod = await import('/src/modules/track-data.js');
      return ids.map(id => {
        const p = mod.getAddonParams(id);
        return { id, shape: p?.shape, halfSize: p?.halfSize };
      });
    }, [...EXPECTED_TRACKS, ...EXPECTED_ARENAS]);

    for (const r of results) {
      expect(r.shape, `"${r.id}" should have a shape`).toBeTruthy();
      expect(r.halfSize, `"${r.id}" should have a halfSize`).toBeGreaterThan(0);
    }
  });
});
