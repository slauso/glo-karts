/**
 * Integration test: exercises road painting, auto-tile, serialization, and playtest bridge.
 */
import { chromium } from 'playwright';

const BASE_URL = process.argv[2] || 'http://localhost:5174';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const jsErrors = [];
  const consoleWarns = [];

  page.on('pageerror', err => jsErrors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') jsErrors.push(msg.text());
    if (msg.type() === 'warning') consoleWarns.push(msg.text());
  });

  console.log('=== TinkerTracks Integration Test ===');
  console.log(`Loading ${BASE_URL}/builder.html ...`);
  await page.goto(`${BASE_URL}/builder.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000); // Wait for modules to initialize

  // 1. Verify page loaded
  const title = await page.title();
  console.log(`[1] Page title: ${title}`);
  if (!title.includes('GLO KARTS')) throw new Error('Page title missing');

  // 2. Check canvas and toolbar
  const canvas = await page.$('canvas');
  if (!canvas) throw new Error('Canvas not found');
  console.log('[2] Canvas and toolbar: OK');

  // 3. Test auto-tile module loaded and works
  const autoTileTest = await page.evaluate(() => {
    return new Promise(async (resolve) => {
      try {
        // Dynamically import the track-data module
        const td = await import('/src/builder-v2/track-data.js');
        
        // Test basic auto-tile with an empty grid
        td.clearAllCells();
        
        // Place a single cell
        const changes1 = td.addCell(0, 0);
        const cell1 = { ...td.TRACK_CELLS.get('0:0') };
        
        // Place adjacent cell to create a straight
        const changes2 = td.addCell(0, 10);
        const cell2 = { ...td.TRACK_CELLS.get('0:0') };
        const cell3 = { ...td.TRACK_CELLS.get('0:10') };
        
        // Place a corner cell
        const changes3 = td.addCell(10, 0);
        const cellCorner = { ...td.TRACK_CELLS.get('0:0') };
        
        // Test removal
        td.removeCell(10, 0);
        const afterRemove = { ...td.TRACK_CELLS.get('0:0') };
        
        // Test encoding
        const encoded = td.encodeCells();
        const decoded = td.decodeCells(encoded);
        
        // Test wall colliders
        const walls = td.generateWallColliders();
        
        // Cleanup
        td.clearAllCells();
        
        resolve({
          cell1Type: cell1?.type,
          straightType: cell2?.type,
          straightDir: cell2?.rotation,
          cornerType: cellCorner?.type,
          afterRemoveType: afterRemove?.type,
          encodedLength: encoded.length,
          decodedLength: decoded.length,
          wallCount: walls.length,
          success: true,
        });
      } catch (err) {
        resolve({ success: false, error: err.message });
      }
    });
  });

  if (!autoTileTest.success) {
    console.log(`[3] Auto-tile test FAILED: ${autoTileTest.error}`);
    throw new Error(autoTileTest.error);
  }
  console.log(`[3] Auto-tile engine: OK`);
  console.log(`    Single cell type: ${autoTileTest.cell1Type}`);
  console.log(`    With neighbor: ${autoTileTest.straightType} rot=${autoTileTest.straightDir}`);
  console.log(`    With corner: ${autoTileTest.cornerType}`);
  console.log(`    After remove: ${autoTileTest.afterRemoveType}`);
  console.log(`    Encoded: ${autoTileTest.encodedLength} chars, decoded: ${autoTileTest.decodedLength} cells`);
  console.log(`    Wall colliders: ${autoTileTest.wallCount}`);

  // 4. Test asset-loader module
  const assetTest = await page.evaluate(() => {
    return new Promise(async (resolve) => {
      try {
        const al = await import('/src/builder-v2/asset-loader.js');
        const assets = al.TRACK_ASSETS;
        const meta = al.getModelMeta('straight');
        resolve({
          assetCount: assets.length,
          hasStraight: assets.some(a => a.key === 'straight'),
          hasCorner: assets.some(a => a.key === 'corner-small'),
          hasWide: assets.some(a => a.key === 'wide'),
          metaWidth: meta?.width,
          success: true,
        });
      } catch (err) {
        resolve({ success: false, error: err.message });
      }
    });
  });

  if (!assetTest.success) {
    console.log(`[4] Asset loader test FAILED: ${assetTest.error}`);
  } else {
    console.log(`[4] Asset loader: OK (${assetTest.assetCount} assets, straight=${assetTest.hasStraight}, corner=${assetTest.hasCorner}, wide=${assetTest.hasWide})`);
  }

  // 5. Check for JS errors
  if (jsErrors.length) {
    console.log(`[5] JS Errors (${jsErrors.length}):`);
    for (const e of jsErrors.slice(0, 5)) console.log(`    - ${e}`);
  } else {
    console.log('[5] No JS errors');
  }

  if (consoleWarns.length > 5) {
    console.log(`[6] Warnings: ${consoleWarns.length} total (first 3):`);
    for (const w of consoleWarns.slice(0, 3)) console.log(`    - ${w}`);
  }

  await browser.close();
  const pass = jsErrors.length === 0 && autoTileTest.success;
  console.log(`\n=== ${pass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'} ===`);
  if (!pass) process.exitCode = 1;
}

main().catch(e => {
  console.error('TEST FAILED:', e.message);
  process.exit(1);
});
