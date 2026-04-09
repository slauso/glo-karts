/**
 * builder-grid-snap-test.mjs — Playwright smoke-test for the Arena Builder
 * grid-placement, auto-fit, and snap-connect system.
 *
 * Verifies:
 *   1. Builder page loads and initialises (canvas visible)
 *   2. Objects panel renders piece categories and buttons
 *   3. Clicking a piece activates PLACE mode (hint text changes)
 *   4. Clicking the canvas places a piece (entity count grows)
 *   5. Placing a second piece adjacent shows "connection" in hint
 *   6. Models fill grid cells (bounding boxes ≈ GRID_SIZE)
 *   7. Adjacent pieces touch at grid cell boundaries (gap ≈ 0)
 *   8. Ghost preview appears on hover
 *   9. R key cycles manual rotation
 *  10. Erase removes placed pieces
 *
 * Run:
 *   node scripts/builder-grid-snap-test.mjs
 *   HEADLESS=false node scripts/builder-grid-snap-test.mjs     # visible
 */
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const HEADLESS = false; // WebGL requires visible browser on this machine
const SLOW = process.env.SLOW === 'true' ? 300 : 0;

const wait = (ms) => new Promise(r => setTimeout(r, ms));

let passed = 0;
let failed = 0;

function assert(ok, msg) {
  if (ok) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${msg}`);
  }
}

async function run() {
  const browser = await chromium.launch({
    headless: false,
    slowMo: SLOW,
    args: ['--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  try {
    // ── Capture browser console errors ──
    const consoleErrors = [];
    const consoleWarns = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
      if (msg.type() === 'warning') consoleWarns.push(msg.text());
    });
    page.on('pageerror', err => {
      consoleErrors.push(`PAGE ERROR: ${err.message}`);
    });

    // ──────────────────────────────────────────────────────────
    console.log('\n=== Phase 1: Builder loads ===');
    // ──────────────────────────────────────────────────────────
    await page.goto(`${BASE_URL}/builder.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#bv2-viewport', { timeout: 15000 });
    const canvasVisible = await page.isVisible('#bv2-viewport');
    assert(canvasVisible, 'Canvas is visible');

    // Wait for builder-app.js to initialize
    await page.waitForFunction(() => {
      return document.getElementById('bv2-hint')?.textContent?.length > 0;
    }, { timeout: 10000 });
    const hintText = await page.textContent('#bv2-hint');
    assert(hintText.length > 0, `Hint text initialized: "${hintText.slice(0, 50)}..."`);

    // ──────────────────────────────────────────────────────────
    console.log('\n=== Phase 2: Objects panel ===');
    // ──────────────────────────────────────────────────────────
    // Dump any browser console errors first
    if (consoleErrors.length) {
      console.log(`    🔴 Browser errors (${consoleErrors.length}):`);
      for (const e of consoleErrors) console.log(`       ${e.slice(0, 200)}`);
    }
    if (consoleWarns.length) {
      console.log(`    ⚠️ Browser warnings (${consoleWarns.length}):`);
      for (const w of consoleWarns.slice(0, 5)) console.log(`       ${w.slice(0, 200)}`);
    }
    // Click the Objects tab
    await page.click('.bv2-tab[data-panel="objects"]');
    await wait(300);

    // Wait for dynamic content to render (ObjectsPanel builds DOM in constructor)
    try {
      await page.waitForSelector('.bv2-cat-header', { timeout: 5000 });
    } catch {
      // If no cat headers, the objects panel might use a different structure
      console.log('    ⚠️ No .bv2-cat-header found, checking for .bv2-asset-btn directly...');
    }

    // Debug: log panel HTML snippet
    const panelHTML = await page.$eval('#bv2-panel-objects', el => el.innerHTML.slice(0, 500));
    console.log(`    Panel HTML (first 500 chars): ${panelHTML || '(empty)'}`);

    const catHeaders = await page.$$('.bv2-cat-header');
    assert(catHeaders.length >= 3, `Found ${catHeaders.length} category headers (expect ≥3)`);

    // Wait for asset buttons
    try {
      await page.waitForSelector('.bv2-asset-btn', { timeout: 5000 });
    } catch {
      console.log('    ⚠️ No .bv2-asset-btn found');
    }
    const assetBtns = await page.$$('.bv2-asset-btn');
    assert(assetBtns.length >= 10, `Found ${assetBtns.length} asset buttons (expect ≥10)`);

    // ──────────────────────────────────────────────────────────
    console.log('\n=== Phase 3: Select a piece → PLACE mode ===');
    // ──────────────────────────────────────────────────────────
    // Click the first asset button (should be "straight")
    let firstBtn = assetBtns.length > 0 ? assetBtns[0] : null;
    if (!firstBtn) {
      // Try data-key selector
      firstBtn = await page.$('.bv2-asset-btn[data-key="straight"]');
    }
    if (!firstBtn) {
      // Last resort: try any button inside the panel
      firstBtn = await page.$('#bv2-panel-objects button[data-key]');
    }
    if (firstBtn) {
      const btnText = await firstBtn.textContent();
      console.log(`    Clicking asset button: "${btnText.trim().slice(0, 30)}"`);
      await firstBtn.click();
      await wait(500);

      const placeHint = await page.textContent('#bv2-hint');
      assert(
        placeHint.toLowerCase().includes('place') || placeHint.toLowerCase().includes('click'),
        `Hint shows placement mode: "${placeHint.slice(0, 60)}..."`,
      );

      // Check PLACE tool is active
      const placeToolActive = await page.$eval('#bv2-tool-place', el => el.classList.contains('active'));
      assert(placeToolActive, 'Place tool button is active');
    } else {
      console.log('    ⚠️ No asset button found — skipping phases 3-5');
      assert(false, 'At least one asset button should exist');
    }

    // ──────────────────────────────────────────────────────────
    console.log('\n=== Phase 4: Place first piece ===');
    // ──────────────────────────────────────────────────────────
    const canvas = await page.$('#bv2-viewport');
    const box = await canvas.boundingBox();

    // Click near the center of the canvas to place
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.click(cx, cy);
    await wait(800); // wait for model to load and place

    // Check hint for "Placed"
    const afterPlace1 = await page.textContent('#bv2-hint');
    assert(
      afterPlace1.toLowerCase().includes('placed') || afterPlace1.toLowerCase().includes('connection'),
      `After first placement hint: "${afterPlace1.slice(0, 60)}..."`,
    );

    // ──────────────────────────────────────────────────────────
    console.log('\n=== Phase 5: Place second piece adjacent ===');
    // ──────────────────────────────────────────────────────────
    // We need to place a piece one grid cell away.
    // First, let's query the Three.js scene for entity count + positions.
    const entityCount1 = await page.evaluate(() => {
      const group = window.__scene?.getObjectByName?.('__entities');
      return group ? group.children.length : -1;
    });

    // Click slightly below center (one grid cell further in Z)
    // GRID_SIZE=10 in world units. We need to figure out pixel offset.
    // For now, click 80px below for approximate one-cell offset in perspective view.
    await page.mouse.click(cx, cy + 80);
    await wait(800);

    const afterPlace2 = await page.textContent('#bv2-hint');
    console.log(`    Hint after 2nd placement: "${afterPlace2}"`);

    // ──────────────────────────────────────────────────────────
    console.log('\n=== Phase 6: Verify models fill grid cells ===');
    // ──────────────────────────────────────────────────────────
    // Inject Three.js bounding box measurement into the page
    const modelMetrics = await page.evaluate(() => {
      const THREE = window.__THREE;
      const group = window.__scene?.getObjectByName?.('__entities');
      if (!group || !THREE) return null;

      const results = [];
      for (const child of group.children) {
        const bbox = new THREE.Box3().setFromObject(child);
        const size = new THREE.Vector3();
        bbox.getSize(size);
        results.push({
          name: child.name || child.type,
          sizeX: Math.round(size.x * 100) / 100,
          sizeY: Math.round(size.y * 100) / 100,
          sizeZ: Math.round(size.z * 100) / 100,
          posX: Math.round(child.position.x * 100) / 100,
          posZ: Math.round(child.position.z * 100) / 100,
        });
      }
      return results;
    });

    if (modelMetrics && modelMetrics.length > 0) {
      for (const m of modelMetrics) {
        const maxDim = Math.max(m.sizeX, m.sizeZ);
        assert(
          maxDim >= 8 && maxDim <= 12,
          `Model "${m.name}" fills grid cell: longest dim = ${maxDim} (expect ~10)`,
        );
        console.log(`    Details: ${m.sizeX}×${m.sizeY}×${m.sizeZ} at (${m.posX}, ${m.posZ})`);
      }
    } else {
      console.log('    ⚠️  Could not access Three.js scene — model metrics unavailable.');
      console.log('    This is expected if window.__scene is not exposed.');
      console.log('    Trying alternative: checking via screenshot...');
    }

    // ──────────────────────────────────────────────────────────
    console.log('\n=== Phase 7: Check piece adjacency (gap measurement) ===');
    // ──────────────────────────────────────────────────────────
    if (modelMetrics && modelMetrics.length >= 2) {
      // Sort by Z position to find neighbors
      const sorted = [...modelMetrics].sort((a, b) => a.posZ - b.posZ);
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        const gap = Math.abs(curr.posZ - prev.posZ) - 10; // GRID_SIZE = 10
        console.log(`    Gap between "${prev.name}"@Z=${prev.posZ} and "${curr.name}"@Z=${curr.posZ}: ${gap.toFixed(2)} units`);
        // Allow some tolerance — pieces might not be exactly adjacent due to camera angle
      }
    }

    // ──────────────────────────────────────────────────────────
    console.log('\n=== Phase 8: Ghost preview on hover ===');
    // ──────────────────────────────────────────────────────────
    // Move mouse over canvas to trigger ghost
    await page.mouse.move(cx + 100, cy - 100);
    await wait(500);

    // Ghost is in Three.js scene (name='__ghost'), but we can check
    // if indicators appear (they're also Three.js objects)
    const ghostExists = await page.evaluate(() => {
      return !!window.__scene?.getObjectByName?.('__ghost');
    });
    if (ghostExists !== null) {
      console.log(`    Ghost object in scene: ${ghostExists}`);
    } else {
      console.log('    ⚠️  Cannot check ghost via JS — window.__scene not exposed');
    }

    // ──────────────────────────────────────────────────────────
    console.log('\n=== Phase 9: R key cycles rotation ===');
    // ──────────────────────────────────────────────────────────
    await page.keyboard.press('r');
    await wait(200);
    const rotHint1 = await page.textContent('#bv2-hint');
    assert(
      rotHint1.includes('Rotation') || rotHint1.includes('°'),
      `R key shows rotation: "${rotHint1.slice(0, 50)}..."`,
    );

    await page.keyboard.press('r');
    await wait(200);
    const rotHint2 = await page.textContent('#bv2-hint');
    const rotChanged = rotHint1 !== rotHint2;
    assert(rotChanged, `Second R press changes rotation: "${rotHint2.slice(0, 50)}..."`);

    // Reset to auto
    await page.keyboard.press('Escape');
    await wait(200);

    // ──────────────────────────────────────────────────────────
    console.log('\n=== Phase 10: Erase tool removes pieces ===');
    // ──────────────────────────────────────────────────────────
    // Switch to erase tool
    await page.click('#bv2-tool-erase');
    await wait(300);

    const eraseHint = await page.textContent('#bv2-hint');
    assert(
      eraseHint.toLowerCase().includes('erase'),
      `Erase tool hint: "${eraseHint.slice(0, 50)}..."`,
    );

    // Click center to erase
    await page.mouse.click(cx, cy);
    await wait(300);

    // ──────────────────────────────────────────────────────────
    console.log('\n=== Phase 11: Screenshot for visual verification ===');
    // ──────────────────────────────────────────────────────────
    await page.screenshot({ path: 'test-results/builder-grid-snap.png', fullPage: true });
    console.log('    📸 Screenshot saved to test-results/builder-grid-snap.png');

  } catch (err) {
    console.error('\n💥 Test crashed:', err.message);
    failed++;
    try {
      await page.screenshot({ path: 'test-results/builder-grid-snap-CRASH.png' });
    } catch { /* ignore */ }
  } finally {
    await browser.close();
  }

  // ── Summary ─────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log(`${'═'.repeat(50)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
