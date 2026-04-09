/**
 * builder-visual-smoke.mjs — Playwright visual test: place a chain of
 * 3 straights + 1 corner + 1 straight and capture a screenshot.
 *
 * Run:  HEADLESS=false node scripts/builder-visual-smoke.mjs
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL  = process.env.BASE_URL || 'http://127.0.0.1:5174';
const HEADLESS  = String(process.env.HEADLESS ?? 'true').toLowerCase() !== 'false';

async function run() {
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page    = await context.newPage();

  try {
    await page.goto(`${BASE_URL}/builder.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1500);
    await page.click('#bv2-land-new');
    await page.waitForSelector('#builder-root:not([style*="display:none"])', { timeout: 10000 });
    await page.waitForSelector('.bv2-asset-btn', { timeout: 15000 });
    await page.waitForTimeout(1000);

    // Switch to ortho top-down view for clearer grid visibility
    await page.click('#bv2-cam-toggle');
    await page.waitForTimeout(500);

    // Select Place + Straight
    await page.click('#bv2-tool-place');
    await page.click('.bv2-asset-btn[data-key="straight"]');
    await page.waitForTimeout(300);

    const box = await page.locator('#bv2-viewport').boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Place 3 straights vertically
    for (let i = -1; i <= 1; i++) {
      await page.mouse.click(cx, cy + i * 20);
      await page.waitForTimeout(800);
    }

    // Place corner at the end  
    await page.click('.bv2-asset-btn[data-key="corner-large"]');
    await page.waitForTimeout(300);
    await page.mouse.click(cx, cy - 40);
    await page.waitForTimeout(800);

    // Place straight extending from corner
    await page.click('.bv2-asset-btn[data-key="straight"]');
    await page.waitForTimeout(300);
    await page.mouse.click(cx + 20, cy - 40);
    await page.waitForTimeout(800);

    // Deselect to clear ghost
    await page.click('#bv2-tool-select');
    await page.waitForTimeout(500);

    // Get grid cells summary
    const summary = await page.evaluate(() => {
      const gs = window.__builderDebug?.gridState;
      if (!gs) return { error: 'no grid' };
      const cells = [];
      for (const [key, val] of gs.cells) {
        cells.push({ cell: key, piece: val.pieceKey, rot: val.rotation });
      }
      return {
        entityCount: window.__builderDebug?.sceneGraph?.entities?.size ?? 0,
        cells,
      };
    });

    console.log('\nPlacement Summary:');
    console.log(JSON.stringify(summary, null, 2));

    // Take screenshot
    const screenshotPath = join(__dirname, '..', 'builder-visual-smoke.png');
    await page.screenshot({ path: screenshotPath });
    console.log(`\nScreenshot saved: ${screenshotPath}`);

    // Validate — at least 2 placed entities confirms rendering + snapping works
    const ok = summary.entityCount >= 2;
    console.log(`\n${ok ? '✓ PASS' : '✗ FAIL'}: Placed ${summary.entityCount} entities, ${summary.cells.length} grid cells`);
    process.exitCode = ok ? 0 : 1;

  } catch (err) {
    console.error(`FATAL: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
  }
}

run();
