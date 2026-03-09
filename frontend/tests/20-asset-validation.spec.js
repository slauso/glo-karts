/**
 * 20-asset-validation.spec.js — Phase 14.1.5 Asset/Dependency checkpoint
 *
 * Validates:
 *   - All kart entries have modelPath and scale
 *   - All tracks/arenas have type and startPositions
 *   - Cup tracks reference valid track IDs
 *   - resolveKartAsset falls back to default for unknown IDs
 *   - validateAssetAvailability returns no errors
 */
import { test, expect } from '@playwright/test';

const VITE = 'http://localhost:5173';

test.describe('Phase 14.1.5 — Asset Validation', () => {

  test('validateAssetAvailability returns valid with no errors', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async () => {
      const mod = await import('/src/modules/content-registry.js');
      return mod.validateAssetAvailability();
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('every kart has modelPath and numeric scale', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const karts = await page.evaluate(async () => {
      const mod = await import('/src/modules/content-registry.js');
      return Object.entries(mod.ALL_KARTS).map(([id, k]) => ({
        id, hasModelPath: !!k.modelPath, hasScale: typeof k.scale === 'number',
      }));
    });

    for (const k of karts) {
      expect(k.hasModelPath).toBe(true);
      expect(k.hasScale).toBe(true);
    }
  });

  test('every track has type and startPositions', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const tracks = await page.evaluate(async () => {
      const mod = await import('/src/modules/content-registry.js');
      return Object.entries(mod.ALL_TRACKS).map(([id, t]) => ({
        id, hasType: !!t.type, hasStart: Array.isArray(t.startPositions) && t.startPositions.length > 0,
      }));
    });

    for (const t of tracks) {
      expect(t.hasType).toBe(true);
      expect(t.hasStart).toBe(true);
    }
  });

  test('every arena has type and startPositions', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const arenas = await page.evaluate(async () => {
      const mod = await import('/src/modules/content-registry.js');
      return Object.entries(mod.ALL_ARENAS).map(([id, a]) => ({
        id, hasType: !!a.type, hasStart: Array.isArray(a.startPositions) && a.startPositions.length > 0,
      }));
    });

    for (const a of arenas) {
      expect(a.hasType).toBe(true);
      expect(a.hasStart).toBe(true);
    }
  });

  test('resolveKartAsset falls back to default for unknown ID', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async () => {
      const mod = await import('/src/modules/content-registry.js');
      const kart = mod.resolveKartAsset('nonexistent_kart_xyz');
      return kart.id;
    });

    expect(result).toBe('default');
  });

  test('resolveTrackAsset falls back to test_box for unknown ID', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async () => {
      const mod = await import('/src/modules/content-registry.js');
      const track = mod.resolveTrackAsset('nonexistent_track_xyz');
      return track.id;
    });

    expect(result).toBe('test_box');
  });

  test('cup tracks all reference valid track IDs', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const missing = await page.evaluate(async () => {
      const mod = await import('/src/modules/content-registry.js');
      const errors = [];
      for (const [cupId, cup] of Object.entries(mod.SINGLE_PLAYER_CUPS)) {
        for (const trackId of cup.trackIds) {
          if (!mod.ALL_TRACKS[trackId]) errors.push(`${cupId}:${trackId}`);
        }
      }
      return errors;
    });

    expect(missing).toEqual([]);
  });
});
