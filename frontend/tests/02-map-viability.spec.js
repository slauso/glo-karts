import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  injectGameConfig,
  waitForDebug,
  readDebug,
  isCriticalError,
} from './helpers/game-helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = path.join(__dirname, 'reports', 'map-viability.json');

const RACE_TRACKS = [
  { id: 'test_box', label: 'Test Box' },
];

const BATTLE_ARENAS = [
  { id: 'glo_arena', label: 'Glo Arena' },
];

function assessViability(debug, errors, fallbackGround) {
  const critErrors = errors.filter(isCriticalError);
  const reasons = [];

  if (!debug.kartLoaded) reasons.push('kart GLB failed to load');
  if (debug.trackPhysicsCount === 0 && !fallbackGround) reasons.push('no track physics or fallback ground');
  if (critErrors.length > 0) reasons.push(`${critErrors.length} critical JS error(s): ${critErrors.slice(0, 2).join('; ')}`);

  const sp = debug.spawnPos;
  if (!sp || !Number.isFinite(sp.x) || !Number.isFinite(sp.y) || !Number.isFinite(sp.z)) {
    reasons.push('spawn position is not finite');
  }

  return { viable: reasons.length === 0, reasons };
}

const results = [];

test.afterAll(async () => {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    results,
    summary: {
      total: results.length,
      viable: results.filter((r) => r.viable).length,
      nonViable: results.filter((r) => !r.viable).length,
    },
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`\n[map-audit] Report written to ${REPORT_PATH}`);
  console.log(`[map-audit] Viable: ${report.summary.viable} / ${report.summary.total}`);
});

test.describe('Race Tracks — Map Viability', () => {
  for (const track of RACE_TRACKS) {
    test(`[race] ${track.label} (${track.id})`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', (err) => errors.push(err.message));

      await injectGameConfig(page, {
        gameMode: 'race',
        trackId:  track.id,
        maxPlayers: 1,
      });
      await page.goto('/realtime.html');

      await waitForDebug(page, (d) => d.kartLoaded === true, 25_000);

      const debug = await readDebug(page);
      const fallbackGround = await page.evaluate(() => !!window.__gloClient?.scene?.getMeshByName('test-box-floor'));
      const { viable, reasons } = assessViability(debug, errors, fallbackGround);

      results.push({
        id: track.id,
        label: track.label,
        type: 'race',
        viable,
        reasons,
        debug: {
          trackPhysicsCount: debug.trackPhysicsCount,
          kartLoaded: debug.kartLoaded,
          spawnPos: debug.spawnPos,
          effectiveKartScale: debug.effectiveKartScale,
          fallbackGround,
        },
      });

      expect(viable, `${track.label} should remain playable in the current procedural roster`).toBe(true);
      await expect(page.locator('#realtime-canvas')).toBeAttached();
    });
  }
});

test.describe('Battle Arenas — Map Viability', () => {
  for (const arena of BATTLE_ARENAS) {
    test(`[battle] ${arena.label} (${arena.id})`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', (err) => errors.push(err.message));

      await injectGameConfig(page, {
        gameMode: 'battle',
        trackId:  arena.id,
        maxPlayers: 1,
      });
      await page.goto('/realtime.html');

      await waitForDebug(page, (d) => d.kartLoaded === true, 25_000);

      const debug = await readDebug(page);
      const fallbackGround = await page.evaluate(() => !!window.__gloClient?.scene?.getMeshByName('test-box-floor'));
      const { viable, reasons } = assessViability(debug, errors, fallbackGround);

      results.push({
        id: arena.id,
        label: arena.label,
        type: 'battle',
        viable,
        reasons,
        debug: {
          trackPhysicsCount: debug.trackPhysicsCount,
          kartLoaded: debug.kartLoaded,
          spawnPos: debug.spawnPos,
          effectiveKartScale: debug.effectiveKartScale,
          fallbackGround,
        },
      });

      expect(viable, `${arena.label} should remain playable in the current procedural roster`).toBe(true);
      await expect(page.locator('#realtime-canvas')).toBeAttached();
    });
  }
});
