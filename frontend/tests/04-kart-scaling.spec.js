import { test, expect } from '@playwright/test';
import {
  injectGameConfig,
  waitForDebug,
  readDebug,
  BATTLE_CONFIG,
  RACE_CONFIG,
} from './helpers/game-helpers.js';

const SCALE_CASES = [
  { id: 'glo_arena', label: 'Glo Arena', expectedScale: 2.2, mode: 'battle', kartId: 'tux' },
  { id: 'test_box', label: 'Test Box', expectedScale: 2.8, mode: 'race', kartId: 'default' },
];

test.describe('Kart Scaling per Active Content', () => {
  for (const entry of SCALE_CASES) {
    test(`${entry.label} (${entry.id}) keeps the kart asset scale`, async ({ page }) => {
      const cfg = entry.mode === 'battle'
        ? { ...BATTLE_CONFIG, trackId: entry.id, selectedKart: entry.kartId }
        : { ...RACE_CONFIG, trackId: entry.id, selectedKart: entry.kartId };

      await injectGameConfig(page, cfg);
      await page.goto('/realtime.html');

      await waitForDebug(page, (d) => d.kartLoaded === true && d.effectiveKartScale !== null, 20_000);
      const debug = await readDebug(page);

      expect(debug.effectiveKartScale, `${entry.label} kart scale`).toBeCloseTo(entry.expectedScale, 2);

      const meshScale = await page.evaluate(() => {
        const m = window.__gloClient?.localMesh;
        if (!m) return null;
        return { x: m.scaling.x, y: m.scaling.y, z: m.scaling.z };
      });

      expect(meshScale).toBeTruthy();
      expect(meshScale.x, `${entry.label} mesh.scaling.x matches`).toBeCloseTo(entry.expectedScale, 1);
      expect(meshScale.y, `${entry.label} mesh.scaling.y matches`).toBeCloseTo(entry.expectedScale, 1);
      expect(meshScale.z, `${entry.label} mesh.scaling.z matches`).toBeCloseTo(entry.expectedScale, 1);

      const physExtents = await page.evaluate(() => {
        const c = window.__gloClient;
        if (!c?._localKartExtents) return null;
        const e = c._localKartExtents;
        return { x: e.x, y: e.y, z: e.z };
      });

      expect(physExtents).toBeTruthy();
      expect(physExtents.x, `${entry.label} physics width ≈ 1.8 × scale`).toBeCloseTo(1.8 * entry.expectedScale, 0);
      expect(physExtents.z, `${entry.label} physics length ≈ 3.2 × scale`).toBeCloseTo(3.2 * entry.expectedScale, 0);
    });
  }

  test('active content keeps kart physics extents within sane bounds', async ({ page }) => {
    for (const entry of SCALE_CASES) {
      const cfg = entry.mode === 'battle'
        ? { ...BATTLE_CONFIG, trackId: entry.id, selectedKart: entry.kartId }
        : { ...RACE_CONFIG, trackId: entry.id, selectedKart: entry.kartId };

      await injectGameConfig(page, cfg);
      await page.goto('/realtime.html');

      await waitForDebug(page, (d) => d.kartLoaded === true, 20_000);
      await page.waitForFunction(() => !!window.__gloClient?._localKartExtents, null, { timeout: 10_000 });

      const physExtents = await page.evaluate(() => {
        const c = window.__gloClient;
        if (!c?._localKartExtents) return null;
        return { x: c._localKartExtents.x, z: c._localKartExtents.z };
      });

      expect(physExtents).toBeTruthy();
      expect(physExtents.x, `${entry.label} kart width ≤ 6 m`).toBeLessThanOrEqual(6.2);
      expect(physExtents.z, `${entry.label} kart length ≤ 9 m`).toBeLessThanOrEqual(9.0);
    }
  });
});
