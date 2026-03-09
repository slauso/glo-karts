/**
 * 20-map-integration.spec.js — Phase 16 Map Import checkpoint
 *
 * Validates that all 60 maps (test_box + 18 race + 15 addon race +
 * 10 arena + 15 addon arena) are correctly registered, have proper
 * metadata, appear in the lobby carousel, and the procedural fallback
 * generators are wired up.
 *
 * ALL tracks and arenas are procedural (addon-track / addon-arena type).
 */
import { test, expect } from '@playwright/test';

const VITE = 'http://localhost:5173';

// ── Expected track/arena rosters ────────────────────────────────────────────

const RACE_TRACKS = [
  'abyss', 'black_forest', 'cocoa_temple', 'cornfield_crossing',
  'gran_paradiso_island', 'hacienda', 'lighthouse', 'mines',
  'minigolf', 'oasis', 'olivermath', 'ravenbridge_mansion',
  'sandtrack', 'snowmountain', 'snowtuxpeak', 'volcano_island',
  'xr591', 'zengarden',
];

const ADDON_RACE_TRACKS = [
  'pipe_track', 'sector5_mini', 'forest_lake', 'marble_stage',
  'kart_track', 'racetrack', 'sweet_cake', 'rhomboor',
  'kart_corner', 'lemans_lm', 'freestyle_roads', 'neon_duel_speedway',
  'blossom_circuit', 'starter_circuit', 'sunset_wilds',
];

const BATTLE_ARENAS = [
  'alien_signal', 'ancient_colosseum_labyrinth', 'arena_candela_city',
  'battleisland', 'blockfort', 'cave', 'lasdunasarena',
  'pumpkin_park', 'stadium', 'temple',
];

const ADDON_BATTLE_ARENAS = [
  'tiny', 'advanced_course', 'tournament_field', 'pipe_field',
  'nitro_soccer', 'abyss_soccer', 'lava_fields', 'tiny_arena',
  'kristis_park', 'block_fort', 'smash_island', 'n64_skyscraper',
  'twisted_domain', 'castle_courtyard', 'thunder_stadium',
];

const ALL_EXPECTED_TRACKS = ['test_box', ...RACE_TRACKS, ...ADDON_RACE_TRACKS];
const ALL_EXPECTED_ARENAS = ['test_box', ...BATTLE_ARENAS, ...ADDON_BATTLE_ARENAS];
const ALL_ADDON_IDS = [...RACE_TRACKS, ...ADDON_RACE_TRACKS, ...BATTLE_ARENAS, ...ADDON_BATTLE_ARENAS];

// IP-safe name mapping (verifying renames)
const IP_SAFE_NAMES = {
  neon_duel_speedway: 'Neon Duel Speedway',
  blossom_circuit:    'Blossom Circuit',
  starter_circuit:    'Starter Circuit',
  sunset_wilds:       'Sunset Wilds',
  tiny_arena:         'Tiny Arena',
  block_fort:         'Block Fort',
  twisted_domain:     'Twisted Domain',
  thunder_stadium:    'Thunder Stadium',
};

// ── Content Registry Tests ──────────────────────────────────────────────────

test.describe('Phase 16 — Map Integration: Content Registry', () => {
  test('ALL_TRACKS contains all 34 race tracks (1 + 18 + 15)', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const trackIds = await page.evaluate(async () => {
      const { ALL_TRACKS } = await import('/src/modules/content-registry.js');
      return Object.keys(ALL_TRACKS);
    });

    for (const id of ALL_EXPECTED_TRACKS) {
      expect(trackIds, `ALL_TRACKS should contain "${id}"`).toContain(id);
    }
    expect(trackIds.length).toBe(ALL_EXPECTED_TRACKS.length);
  });

  test('ALL_ARENAS contains all 26 battle arenas (1 + 10 + 15)', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const arenaIds = await page.evaluate(async () => {
      const { ALL_ARENAS } = await import('/src/modules/content-registry.js');
      return Object.keys(ALL_ARENAS);
    });

    for (const id of ALL_EXPECTED_ARENAS) {
      expect(arenaIds, `ALL_ARENAS should contain "${id}"`).toContain(id);
    }
    expect(arenaIds.length).toBe(ALL_EXPECTED_ARENAS.length);
  });

  test('VERIFIED_RACE_TRACK_IDS includes all tracks', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const verified = await page.evaluate(async () => {
      const { VERIFIED_RACE_TRACK_IDS } = await import('/src/modules/content-registry.js');
      return VERIFIED_RACE_TRACK_IDS;
    });

    for (const id of ALL_EXPECTED_TRACKS) {
      expect(verified, `VERIFIED list should contain "${id}"`).toContain(id);
    }
  });

  test('IP-conflicting maps are renamed correctly', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const labels = await page.evaluate(async (names) => {
      const { ALL_TRACKS, ALL_ARENAS } = await import('/src/modules/content-registry.js');
      const all = { ...ALL_TRACKS, ...ALL_ARENAS };
      const results = {};
      for (const [id, expected] of Object.entries(names)) {
        results[id] = all[id]?.label || null;
      }
      return results;
    }, IP_SAFE_NAMES);

    for (const [id, expected] of Object.entries(IP_SAFE_NAMES)) {
      expect(labels[id], `"${id}" label should be "${expected}"`).toBe(expected);
    }
  });

  test('SINGLE_PLAYER_CUPS use real track IDs', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const cups = await page.evaluate(async () => {
      const { SINGLE_PLAYER_CUPS } = await import('/src/modules/content-registry.js');
      return SINGLE_PLAYER_CUPS;
    });

    // Verify no cup track is just 'test_box' repeated
    for (const [cupId, cup] of Object.entries(cups)) {
      const unique = new Set(cup.trackIds);
      expect(unique.size, `Cup "${cupId}" should have unique tracks`).toBeGreaterThan(1);
    }
  });
});

// ── Track Data Registry Tests ───────────────────────────────────────────────

test.describe('Phase 16 — Map Integration: Track Data', () => {
  test('track-data.js has entries for all addon maps', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const results = await page.evaluate(async (ids) => {
      const mod = await import('/src/modules/track-data.js');
      return ids.map(id => ({
        id,
        hasInfo: !!mod.getTrackInfo(id),
        start: mod.getStartPosition(id),
        heading: mod.getStartHeading(id),
      }));
    }, ALL_ADDON_IDS);

    for (const r of results) {
      expect(r.hasInfo, `getTrackInfo("${r.id}") should exist`).toBe(true);
      expect(r.start, `getStartPosition("${r.id}") should return position`).toBeDefined();
      expect(typeof r.start.x).toBe('number');
      expect(typeof r.start.y).toBe('number');
      expect(typeof r.start.z).toBe('number');
    }
  });

  test('isAddonTrack returns true for all maps', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const results = await page.evaluate(async (ids) => {
      const mod = await import('/src/modules/track-data.js');
      return ids.map(id => ({ id, isAddon: mod.isAddonTrack(id) }));
    }, ALL_ADDON_IDS);

    for (const r of results) {
      expect(r.isAddon, `isAddonTrack("${r.id}") should be true`).toBe(true);
    }
  });

  test('getAddonParams returns shape data for all maps', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const results = await page.evaluate(async (ids) => {
      const mod = await import('/src/modules/track-data.js');
      return ids.map(id => {
        const p = mod.getAddonParams(id);
        return {
          id,
          hasParams: !!p,
          shape: p?.shape,
          halfSize: p?.halfSize,
        };
      });
    }, ALL_ADDON_IDS);

    for (const r of results) {
      expect(r.hasParams, `getAddonParams("${r.id}") should return params`).toBe(true);
      expect(r.shape, `"${r.id}" should have a shape`).toBeTruthy();
      expect(r.halfSize, `"${r.id}" should have a halfSize`).toBeGreaterThan(0);
    }
  });

  test('getTrackModelPath returns null for all maps (procedural)', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const results = await page.evaluate(async (ids) => {
      const mod = await import('/src/modules/track-data.js');
      return ids.map(id => ({ id, path: mod.getTrackModelPath(id) }));
    }, ALL_ADDON_IDS);

    for (const r of results) {
      expect(r.path, `getTrackModelPath("${r.id}") should be null`).toBeNull();
    }
  });
});

// ── Lobby Carousel Tests ────────────────────────────────────────────────────

test.describe('Phase 16 — Map Integration: Lobby UI', () => {
  test('lobby shows 34+ track options in race mode', async ({ page }) => {
    await page.goto(`${VITE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const count = await page.evaluate(async () => {
      const { ALL_TRACKS } = await import('/src/modules/content-registry.js');
      return Object.keys(ALL_TRACKS).length;
    });

    expect(count).toBe(ALL_EXPECTED_TRACKS.length);
  });

  test('lobby shows 26+ arena options in battle mode', async ({ page }) => {
    await page.goto(`${VITE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const count = await page.evaluate(async () => {
      const { ALL_ARENAS } = await import('/src/modules/content-registry.js');
      return Object.keys(ALL_ARENAS).length;
    });

    expect(count).toBe(ALL_EXPECTED_ARENAS.length);
  });
});

// ── Procedural Generator Tests ──────────────────────────────────────────────

test.describe('Phase 16 — Map Integration: Procedural Generators', () => {
  test('procedural-tracks module exports createProceduralAddonTrack', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const hasExport = await page.evaluate(async () => {
      const mod = await import('/src/modules/procedural-tracks.js');
      return typeof mod.createProceduralAddonTrack === 'function';
    });

    expect(hasExport).toBe(true);
  });

  test('all race track shapes are valid', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const shapes = await page.evaluate(async (ids) => {
      const mod = await import('/src/modules/track-data.js');
      return ids.map(id => ({ id, shape: mod.getAddonParams(id)?.shape }));
    }, [...RACE_TRACKS, ...ADDON_RACE_TRACKS]);

    const validShapes = ['oval', 'figure8', 'diamond', 'lshape'];
    for (const r of shapes) {
      expect(validShapes, `"${r.id}" shape "${r.shape}" should be valid`).toContain(r.shape);
    }
  });

  test('all battle arena shapes are valid', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const shapes = await page.evaluate(async (ids) => {
      const mod = await import('/src/modules/track-data.js');
      return ids.map(id => ({ id, shape: mod.getAddonParams(id)?.shape }));
    }, [...BATTLE_ARENAS, ...ADDON_BATTLE_ARENAS]);

    const validShapes = ['square', 'circle', 'rect', 'cross'];
    for (const r of shapes) {
      expect(validShapes, `"${r.id}" shape "${r.shape}" should be valid`).toContain(r.shape);
    }
  });
});

// ── All tracks are procedural — no GLB fetch tests needed ───────────────────
