import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';
const HEADLESS = String(process.env.HEADLESS || 'false').toLowerCase() === 'true';
const REPORT_DIR = path.resolve(process.cwd(), 'reports', 'manual-spotcheck');
const TIMESTAMP = new Date().toISOString().split('T')[0];

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
    // === BUILDER: Load and create complex arena ===
    console.log('[Builder] Loading builder.html...');
    await page.goto(`${BASE_URL}/builder.html`, { waitUntil: 'domcontentloaded' });

    await page.waitForSelector('#ab-play', { timeout: 15000 });
    await page.waitForFunction(() => {
      const stats = document.getElementById('ab-stats')?.textContent || '';
      return /tiles/.test(stats) && /spawns/.test(stats);
    }, undefined, { timeout: 20000 });

    // Generate a complex custom arena via JavaScript
    console.log('[Builder] Creating complex arena with ramps, pads, and obstacles...');
    await page.evaluate(() => {
      const app = window.__arenaBuilder;
      if (!app) {
        console.warn('Arena builder app not available in page context');
        return;
      }

      // Clear existing arena
      app.editor.clear();
      app.editor.trackName = 'Complex Arena Test';
      app.editor.trackAuthor = 'E2E Tester';

      // Build a more sophisticated layout:
      // - Straight road with flat_wide hub in center
      // - Ramp up on one side, ramp down on the other
      // - Curves connecting them
      // - Multiple obstacles (item_box, boost_pad, banana, barrier)

      // Base road grid (straight segments)
      [
        { x: -30, z: 0 },
        { x: -20, z: 0 },
        { x: -10, z: 0 },
        { x: 0, z: 0 },
        { x: 10, z: 0 },
        { x: 20, z: 0 },
        { x: 30, z: 0 },
      ].forEach((cell) => {
        const seg = app.editor.placeSegment('straight', cell.x, 0, cell.z, 0);
        if (seg) seg.builderRole = 'road';
      });

      // Left branch: ramp up
      app.editor.placeSegment('ramp_up', -20, 0, 10, 0);

      // Right branch: ramp down
      app.editor.placeSegment('ramp_down', 20, 0, -10, 180);

      // Center hub (flat_wide pad)
      const hub = app.editor.placeSegment('flat_wide', 0, 0, 0, 0);
      if (hub) hub.builderRole = 'manual';

      // Curves connecting to side lanes
      const curveLeft = app.editor.placeSegment('curve_left', -10, 0, 10, 0);
      if (curveLeft) curveLeft.builderRole = 'manual';

      const curveRight = app.editor.placeSegment('curve_right', 10, 0, -10, 0);
      if (curveRight) curveRight.builderRole = 'manual';

      // Obstacles scattered around
      app.editor.placeObstacle('item_box', 0, 2.6, 0);        // Center item box
      app.editor.placeObstacle('boost_pad', -20, 0.3, 0);     // Boost on left straight
      app.editor.placeObstacle('boost_pad', 20, 0.3, 0);      // Boost on right straight
      app.editor.placeObstacle('banana', -20, 1.7, 10);       // Banana on left ramp
      app.editor.placeObstacle('banana', 20, 1.7, -10);       // Banana on right ramp
      app.editor.placeObstacle('barrier', -10, 2.75, 10);     // Barrier on left curve
      app.editor.placeObstacle('barrier', 10, 2.75, -10);     // Barrier on right curve

      // Spawn points
      app.editor.addStartPosition(-25, 1, 0, 0);
      app.editor.addStartPosition(25, 1, 0, Math.PI);

      // Force updates
      app._afterImportedArena?.();
      app._persistDraft?.();

      console.log(`[Builder] Arena created: ${app.editor.segments.length} segments, ${app.editor.obstacles.length} obstacles, ${app.editor.startPositions.length} spawns`);
    });

    // Wait a moment for UI to refresh
    await page.waitForTimeout(500);

    // Capture builder 3D view
    console.log('[Builder] Capturing 3D view screenshot...');
    await captureScreenshot(page, `complex-arena-builder-3d-${TIMESTAMP}.png`);

    // === PLAYTEST: Launch direct playtest ===
    console.log('[Playtest] Launching direct playtest...');
    await page.click('#ab-play');

    await page.waitForURL(/realtime\.html\?builderPlaytest=1/, { timeout: 30000 });
    await page.waitForFunction(() => {
      const config = JSON.parse(sessionStorage.getItem('gameConfig') || '{}');
      return config.builderPlaytest === true
        && config.customTrackData?.length > 100;
    }, undefined, { timeout: 15000 });

    // Wait for arena to build and match to start
    await page.waitForFunction(() => window.__gloDebug?.customArenaBuilt === true, undefined, { timeout: 45000 });
    await page.waitForFunction(() => window.__gloDebug?.matchLive === true, undefined, { timeout: 45000 });

    // Wait for loading screen to disappear
    await page.waitForFunction(() => {
      const loading = document.getElementById('loading-screen');
      return !!loading && getComputedStyle(loading).display === 'none';
    }, undefined, { timeout: 10000 });

    // Short delay for scene stabilization
    await page.waitForTimeout(1000);

    // Capture playtest 3D view (default camera mode)
    console.log('[Playtest] Capturing 3D view screenshot (default camera)...');
    await captureScreenshot(page, `complex-arena-playtest-3d-${TIMESTAMP}.png`);

    // Cycle to overhead camera
    console.log('[Playtest] Cycling to overhead camera mode...');
    await page.press('body', 'c');
    await page.waitForTimeout(500);
    await page.press('body', 'c');
    await page.waitForTimeout(500);
    await page.press('body', 'c');
    await page.waitForTimeout(500); 

    // Try to identify which camera mode we're at (third cycle is typically overhead)
    const cameraMode = await page.evaluate(() => {
      const idx = window.__activeCameraModeIndex ?? 0;
      const modes = window.__CAMERA_MODES || [];
      return modes[idx]?.name || `mode-${idx}`;
    });
    console.log(`[Playtest] Active camera mode: ${cameraMode}`);

    await captureScreenshot(page, `complex-arena-playtest-overhead-${TIMESTAMP}.png`);

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
