/**
 * GLO Karts — Map Viability Audit
 *
 * Tests every track and arena defined in content-registry for:
 *   ✓  Track physics colliders created (> 0)
 *   ✓  Kart GLB loaded without error
 *   ✓  Spawn position is finite and reasonable
 *   ✓  No critical JS runtime errors
 *
 * Results are written to tests/reports/map-viability.json.
 * Run `node scripts/apply-map-audit.mjs` afterwards to automatically
 * remove non-viable maps from content-registry.js.
 *
 * IMPORTANT: Each map test navigates to /realtime.html with the appropriate
 * sessionStorage config, waits for physics + kart load, then snapshots state.
 * The Colyseus join may succeed or fail — only asset-load errors count here.
 */
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

// ── Map manifest (mirrors lobby.js — all selectable maps) ─────────────────────
const RACE_TRACKS = [
  { id: 'map1',                 label: 'Amalfi Coast' },
  { id: 'map2',                 label: 'Desert Dunes' },
  { id: 'cocoa_temple',         label: 'Cocoa Temple' },
  { id: 'cornfield_crossing',   label: 'Cornfield Xing' },
  { id: 'zengarden',            label: 'Zen Garden' },
  { id: 'hacienda',             label: 'Hacienda' },
  { id: 'minigolf',             label: 'Minigolf' },
  { id: 'sandtrack',            label: 'Shifting Sands' },
  { id: 'snowtuxpeak',          label: 'Snow Peak' },
  { id: 'lighthouse',           label: 'Around the Lighthouse' },
  { id: 'olivermath',           label: "Oliver's Math Class" },
  { id: 'black_forest',         label: 'Black Forest' },
  { id: 'xr591',                label: 'XR591' },
  { id: 'oasis',                label: 'Oasis' },
  { id: 'gran_paradiso_island', label: 'Gran Paradiso Island' },
  { id: 'mines',                label: 'Old Mine' },
  { id: 'snowmountain',         label: 'Northern Resort' },
  { id: 'abyss',                label: 'Antediluvian Abyss' },
  { id: 'volcano_island',       label: 'Volcan Island' },
  { id: 'ravenbridge_mansion',  label: 'Ravenbridge Mansion' },
];

const BATTLE_ARENAS = [
  { id: 'blockfort',                   label: 'Block Fort' },
  { id: 'battleisland',                label: 'Battle Island' },
  { id: 'lasdunasarena',               label: 'Las Dunas Arena' },
  { id: 'cave',                        label: 'Cave X' },
  { id: 'pumpkin_park',                label: 'Pumpkin Park' },
  { id: 'arena_candela_city',          label: 'Candela City' },
  { id: 'ancient_colosseum_labyrinth', label: 'Ancient Colosseum' },
  { id: 'stadium',                     label: 'The Stadium' },
  { id: 'alien_signal',                label: 'Alien Signal' },
  { id: 'temple',                      label: 'Temple' },
];

/** Viability criteria */
function assessViability(debug, errors) {
  const critErrors = errors.filter(isCriticalError);
  const reasons = [];

  if (debug.trackPhysicsCount === 0) reasons.push('zero track physics colliders');
  if (!debug.kartLoaded) reasons.push('kart GLB failed to load');
  if (critErrors.length > 0) reasons.push(`${critErrors.length} critical JS error(s): ${critErrors.slice(0, 2).join('; ')}`);

  const sp = debug.spawnPos;
  if (sp) {
    // Allow large STK coordinate spaces (sandtrack y≈-137, abyss y≈-132, etc.)
    // Just ensure the value is finite and not astronomically wrong
    if (!Number.isFinite(sp.y) || Math.abs(sp.y) > 10000) {
      reasons.push(`spawn Y out of range: ${sp.y}`);
    }
  }

  return { viable: reasons.length === 0, reasons, critErrors };
}

/** Accumulate results across all tests then write report in afterAll */
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
  results.filter((r) => !r.viable).forEach((r) => {
    console.warn(`  ✗ ${r.label} (${r.id}): ${r.reasons.join(', ')}`);
  });
});

// ── Race track tests ──────────────────────────────────────────────────────────
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

      // Wait for physics + kart to load (up to 25 s for large GLBs)
      let timedOut = false;
      await waitForDebug(page, (d) => d.kartLoaded === true, 25_000)
        .catch(() => { timedOut = true; });

      const debug = timedOut ? await readDebug(page) : await readDebug(page);
      const { viable, reasons } = assessViability(debug, errors);

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
        },
        criticalErrorCount: errors.filter(isCriticalError).length,
        timedOut,
      });

      // Soft assertions — print failure info but don't block suite
      if (!viable) {
        console.warn(`[map-audit] ${track.label} NON-VIABLE: ${reasons.join('; ')}`);
      }
      // Hard assertion: must not have crashed entirely (page still alive)
      await expect(page.locator('#realtime-canvas')).toBeAttached();
    });
  }
});

// ── Battle arena tests ────────────────────────────────────────────────────────
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

      let timedOut = false;
      await waitForDebug(page, (d) => d.kartLoaded === true, 25_000)
        .catch(() => { timedOut = true; });

      const debug = await readDebug(page);
      const { viable, reasons } = assessViability(debug, errors);

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
        },
        criticalErrorCount: errors.filter(isCriticalError).length,
        timedOut,
      });

      if (!viable) {
        console.warn(`[map-audit] ${arena.label} NON-VIABLE: ${reasons.join('; ')}`);
      }
      await expect(page.locator('#realtime-canvas')).toBeAttached();
    });
  }
});
