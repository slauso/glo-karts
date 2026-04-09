import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';
const HEADLESS = String(process.env.HEADLESS || 'false').toLowerCase() === 'true';
const REPORT_DIR = path.resolve(process.cwd(), 'reports', 'manual-spotcheck');
const TIMESTAMP = new Date().toISOString().split('T')[0];
const AUTOSAVE_KEY = 'builderV2_autosave';
const SELECTED_KART = 'mechatux';

const CUSTOM_ARENA_DATA = Object.freeze({
  version: 1,
  name: 'Complex Arena Test',
  author: 'E2E Tester',
  roadCells: [
    { id: 1, position: { x: -30, y: 0, z: 0 } },
    { id: 2, position: { x: -20, y: 0, z: 0 } },
    { id: 3, position: { x: -10, y: 0, z: 0 } },
    { id: 4, position: { x: 0, y: 0, z: 0 } },
    { id: 5, position: { x: 10, y: 0, z: 0 } },
    { id: 6, position: { x: 20, y: 0, z: 0 } },
    { id: 7, position: { x: 30, y: 0, z: 0 } },
  ],
  segments: [
    { id: 8, type: 'straight', position: { x: -30, y: 0, z: 0 }, rotation: 0, scale: 1 },
    { id: 9, type: 'straight', position: { x: -20, y: 0, z: 0 }, rotation: 0, scale: 1 },
    { id: 10, type: 'straight', position: { x: -10, y: 0, z: 0 }, rotation: 0, scale: 1 },
    { id: 11, type: 'wide', position: { x: 0, y: 0, z: 0 }, rotation: 0, scale: 1 },
    { id: 12, type: 'straight', position: { x: 10, y: 0, z: 0 }, rotation: 0, scale: 1 },
    { id: 13, type: 'straight', position: { x: 20, y: 0, z: 0 }, rotation: 0, scale: 1 },
    { id: 14, type: 'straight', position: { x: 30, y: 0, z: 0 }, rotation: 0, scale: 1 },
    { id: 15, type: 'hill-beginning', position: { x: -20, y: 0, z: 10 }, rotation: 0, scale: 1 },
    { id: 16, type: 'hill-end', position: { x: 20, y: 0, z: -10 }, rotation: 180, scale: 1 },
    { id: 17, type: 'corner-large', position: { x: -10, y: 0, z: 10 }, rotation: 0, scale: 1 },
    { id: 18, type: 'corner-small', position: { x: 10, y: 0, z: -10 }, rotation: 0, scale: 1 },
  ],
  checkpoints: [],
  startPositions: [
    { id: 19, position: { x: -25, y: 1, z: 0 }, heading: 0 },
    { id: 20, position: { x: 25, y: 1, z: 0 }, heading: Math.PI },
  ],
  obstacles: [
    { id: 21, type: 'item_box', position: { x: 0, y: 2.6, z: 0 } },
    { id: 22, type: 'boost_pad', position: { x: -20, y: 0.3, z: 0 } },
    { id: 23, type: 'boost_pad', position: { x: 20, y: 0.3, z: 0 } },
    { id: 24, type: 'banana', position: { x: -20, y: 1.7, z: 10 } },
    { id: 25, type: 'banana', position: { x: 20, y: 1.7, z: -10 } },
    { id: 26, type: 'barrier', position: { x: -10, y: 2.75, z: 10 } },
    { id: 27, type: 'barrier', position: { x: 10, y: 2.75, z: -10 } },
  ],
  bounds: {
    min: { x: -50, y: 0, z: -30 },
    max: { x: 40, y: 10, z: 20 },
  },
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function captureScreenshot(page, filename) {
  const path = `${REPORT_DIR}/${filename}`;
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  await page.screenshot({ path, fullPage: false });
  console.log(`✓ Screenshot: ${filename}`);
  return path;
}

async function run() {
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await context.addInitScript(({ autosaveKey, autosaveData, selectedKart }) => {
      localStorage.setItem(autosaveKey, JSON.stringify(autosaveData));
      sessionStorage.setItem('selectedKart', selectedKart);
    }, { autosaveKey: AUTOSAVE_KEY, autosaveData: CUSTOM_ARENA_DATA, selectedKart: SELECTED_KART });

    // === BUILDER: Load staged complex arena ===
    console.log('[Builder] Loading builder.html...');
    await page.goto(`${BASE_URL}/builder.html`, { waitUntil: 'domcontentloaded' });

    await page.waitForSelector('#bv2-land-continue:not([disabled])', { timeout: 15000 });
    await page.click('#bv2-land-continue');
    await page.waitForSelector('#bv2-play', { timeout: 15000 });
    await page.waitForFunction(() => {
      const root = document.getElementById('builder-root');
      return !!root && getComputedStyle(root).display !== 'none';
    }, undefined, { timeout: 15000 });

    // Capture builder 3D view
    console.log('[Builder] Capturing 3D view screenshot...');
    await captureScreenshot(page, `complex-arena-builder-3d-${TIMESTAMP}.png`);

    await page.evaluate(() => {
      window.open = (url) => {
        window.location.href = String(url);
        return window;
      };
    });

    // === PLAYTEST: Launch direct playtest ===
    console.log('[Playtest] Launching direct playtest...');
    await page.click('#bv2-play');
    const playtestPage = page;

    await playtestPage.waitForURL(/realtime\.html/, { timeout: 30000 });
    await playtestPage.waitForFunction(() => {
      const config = JSON.parse(sessionStorage.getItem('gameConfig') || '{}');
      return config.builderPlaytest === true
        && config.customTrackData?.length > 100;
    }, undefined, { timeout: 15000 });

    // Wait for arena to build and match to start
    await playtestPage.waitForFunction(() => window.__gloDebug?.customArenaBuilt === true, undefined, { timeout: 45000 });
    await playtestPage.waitForFunction(() => window.__gloDebug?.matchLive === true, undefined, { timeout: 45000 });

    // Wait for loading screen to disappear
    await playtestPage.waitForFunction(() => {
      const loading = document.getElementById('loading-screen');
      return !!loading && getComputedStyle(loading).display === 'none';
    }, undefined, { timeout: 10000 });

    // Short delay for scene stabilization
    await playtestPage.waitForTimeout(1000);

    // Capture playtest 3D view (default camera mode)
    console.log('[Playtest] Capturing 3D view screenshot (default camera)...');
    await captureScreenshot(playtestPage, `complex-arena-playtest-3d-${TIMESTAMP}.png`);

    // Cycle to overhead camera
    console.log('[Playtest] Cycling to overhead camera mode...');
    await playtestPage.press('body', 'c');
    await playtestPage.waitForTimeout(500);
    await playtestPage.press('body', 'c');
    await playtestPage.waitForTimeout(500);
    await playtestPage.press('body', 'c');
    await playtestPage.waitForTimeout(500); 

    // Try to identify which camera mode we're at (third cycle is typically overhead)
    const cameraMode = await playtestPage.evaluate(() => {
      const idx = window.__activeCameraModeIndex ?? 0;
      const modes = window.__CAMERA_MODES || [];
      return modes[idx]?.name || `mode-${idx}`;
    });
    console.log(`[Playtest] Active camera mode: ${cameraMode}`);

    await captureScreenshot(playtestPage, `complex-arena-playtest-overhead-${TIMESTAMP}.png`);

    console.log('✓ Manual spot-check complete. Screenshots saved to reports/manual-spotcheck/');
  } catch (error) {
    console.error('✗ Manual spot-check failed:', error.message);
    process.exitCode = 1;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

run().catch((error) => {
  console.error('Fatal error:', error);
  process.exitCode = 1;
});
