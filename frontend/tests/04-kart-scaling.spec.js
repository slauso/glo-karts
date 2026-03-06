/**
 * GLO KARTS — Kart Scaling Tests
 *
 * Verifies that kart physics extents and visual scale are sensible for each arena.
 * Uses the __gloDebug.effectiveKartScale to assert per-arena rules:
 *
 *  - blockfort : 0.4  (tight corridors)
 *  - battleisland: 0.55 (mid-size)
 *  - stadium   : 0.55
 *  - race tracks: use kart's own scale (2.2 for STK, 2.8 for default)
 *
 * Also reads actual Babylon.js mesh scaling from the live client to confirm
 * the visual mesh is consistently scaled with the physics box.
 */
import { test, expect } from '@playwright/test';
import {
  injectGameConfig,
  waitForDebug,
  readDebug,
  BATTLE_CONFIG,
  RACE_CONFIG,
} from './helpers/game-helpers.js';

const ARENA_SCALE_TABLE = [
  { id: 'blockfort',    label: 'Block Fort',    expectedScale: 0.40,  mode: 'battle' },
  { id: 'battleisland', label: 'Battle Island',  expectedScale: 0.55,  mode: 'battle' },
  { id: 'stadium',      label: 'Stadium',        expectedScale: 0.55,  mode: 'battle' },
  { id: 'cocoa_temple', label: 'Cocoa Temple',   expectedScale: null,  mode: 'race',  minScale: 1.0, maxScale: 5.0 },
  { id: 'map1',         label: 'Amalfi Coast',   expectedScale: null,  mode: 'race',  minScale: 1.0, maxScale: 5.0 },
];

test.describe('Kart Scaling per Arena', () => {
  for (const entry of ARENA_SCALE_TABLE) {
    test(`${entry.label} (${entry.id}) — effective kart scale`, async ({ page }) => {
      const cfg = entry.mode === 'battle'
        ? { ...BATTLE_CONFIG, trackId: entry.id }
        : { ...RACE_CONFIG,   trackId: entry.id };

      await injectGameConfig(page, cfg);
      await page.goto('/realtime.html');

      await waitForDebug(page, (d) => d.kartLoaded === true, 20_000);
      const debug = await readDebug(page);

      const scale = debug.effectiveKartScale;

      if (entry.expectedScale !== null) {
        // Exact scale assertionfrom content-registry kartScale override
        expect(scale, `${entry.label} kart scale`).toBeCloseTo(entry.expectedScale, 2);
      } else {
        // Range assertion for race tracks (no kartScale override — uses kart's own scale)
        if (scale !== null) {
          expect(scale, `${entry.label} scale within valid range`).toBeGreaterThanOrEqual(entry.minScale);
          expect(scale, `${entry.label} scale within valid range`).toBeLessThanOrEqual(entry.maxScale);
        }
      }

      // Confirm visual mesh.scaling matches effectiveKartScale
      const meshScale = await page.evaluate(() => {
        const m = window.__gloClient?.localMesh;
        if (!m) return null;
        return { x: m.scaling.x, y: m.scaling.y, z: m.scaling.z };
      });

      if (meshScale && scale !== null) {
        expect(meshScale.x, `${entry.label} mesh.scaling.x matches`).toBeCloseTo(scale, 1);
        expect(meshScale.y, `${entry.label} mesh.scaling.y matches`).toBeCloseTo(scale, 1);
        expect(meshScale.z, `${entry.label} mesh.scaling.z matches`).toBeCloseTo(scale, 1);
      }

      // Physics extents should be: 1.8 × scale (roughly)
      const physExtents = await page.evaluate(() => {
        const c = window.__gloClient;
        if (!c?._localKartExtents) return null;
        const e = c._localKartExtents;
        return { x: e.x, y: e.y, z: e.z };
      });

      if (physExtents && scale !== null) {
        const expectedW = 1.8 * scale;
        expect(physExtents.x, `${entry.label} physics width ≈ 1.8 × scale`).toBeCloseTo(expectedW, 0);
      }
    });
  }

  test('no arena produces a physics box wider than 6 m', async ({ page }) => {
    // Regression: STK karts at scale 2.2 → width 3.96 m; arena overrides should prevent worse
    for (const entry of ARENA_SCALE_TABLE) {
      const cfg = entry.mode === 'battle'
        ? { ...BATTLE_CONFIG, trackId: entry.id }
        : { ...RACE_CONFIG,   trackId: entry.id };

      await injectGameConfig(page, cfg);
      await page.goto('/realtime.html');

      await waitForDebug(page, (d) => d.kartLoaded === true, 20_000);

      const physExtents = await page.evaluate(() => {
        const c = window.__gloClient;
        if (!c?._localKartExtents) return null;
        return { x: c._localKartExtents.x, z: c._localKartExtents.z };
      });

      if (physExtents) {
        expect(physExtents.x, `${entry.label} kart width ≤ 6 m`).toBeLessThanOrEqual(6.2);
        expect(physExtents.z, `${entry.label} kart length ≤ 9 m`).toBeLessThanOrEqual(9.0);
      }
    }
  });
});
