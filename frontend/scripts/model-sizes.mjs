/**
 * model-sizes.mjs — Measure bounding boxes of all track GLB models.
 * Run: node scripts/model-sizes.mjs
 */
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5174';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

  await page.goto(`${BASE_URL}/builder.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.click('#bv2-land-new');
  await page.waitForSelector('.bv2-asset-btn', { timeout: 15000 });
  await page.waitForTimeout(2000);

  const data = await page.evaluate(async () => {
    const { TRACK_ASSETS, getModelMeta } = await import('/src/builder-v2/asset-loader.js');
    const { GRID_SIZE } = await import('/src/modules/track-placement.js');

    const results = [];
    for (const asset of TRACK_ASSETS) {
      const meta = getModelMeta(asset.key);
      if (!meta) continue;

      results.push({
        key: asset.key,
        rawMin: { x: +meta.min.x.toFixed(3), y: +meta.min.y.toFixed(3), z: +meta.min.z.toFixed(3) },
        rawMax: { x: +meta.max.x.toFixed(3), y: +meta.max.y.toFixed(3), z: +meta.max.z.toFixed(3) },
        rawSize: { x: +meta.size.x.toFixed(3), y: +meta.size.y.toFixed(3), z: +meta.size.z.toFixed(3) },
        rawCenter: { x: +meta.center.x.toFixed(3), y: +meta.center.y.toFixed(3), z: +meta.center.z.toFixed(3) },
        scale: { sx: +meta.scaleX.toFixed(4), sy: +meta.scaleY.toFixed(4), sz: +meta.scaleZ.toFixed(4) },
        gridSize: GRID_SIZE,
      });
    }
    return results;
  });

  console.log('\n=== GLB Model Bounding Boxes (Raw, unscaled) ===\n');
  console.log(`GRID_SIZE = ${data[0]?.gridSize}\n`);
  console.log(
    'Key'.padEnd(24) +
    'min.x'.padStart(8) + 'max.x'.padStart(8) + 'sz.x'.padStart(8) + '  |  ' +
    'min.z'.padStart(8) + 'max.z'.padStart(8) + 'sz.z'.padStart(8) + '  |  ' +
    'ctr.x'.padStart(8) + 'ctr.z'.padStart(8)
  );
  console.log('-'.repeat(105));

  for (const d of data) {
    console.log(
      d.key.padEnd(24) +
      d.rawMin.x.toString().padStart(8) +
      d.rawMax.x.toString().padStart(8) +
      d.rawSize.x.toString().padStart(8) + '  |  ' +
      d.rawMin.z.toString().padStart(8) +
      d.rawMax.z.toString().padStart(8) +
      d.rawSize.z.toString().padStart(8) + '  |  ' +
      d.rawCenter.x.toString().padStart(8) +
      d.rawCenter.z.toString().padStart(8)
    );
  }

  // Check reference: straight Z connection offset
  const strData = data.find(d => d.key === 'straight');
  const refZ = strData.rawSize.z;
  const refHalf = refZ / 2;
  console.log(`\n\nReference straight Z = ${refZ}, half = ${refHalf}`);
  console.log(`Uniform scale for GRID_SIZE match: ${(10 / refZ).toFixed(4)}`);
  console.log('\n--- At uniform scale (GRID_SIZE/straight_Z) ---\n');
  const uniScale = 10 / refZ;
  for (const d of data) {
    const scaledX = d.rawSize.x * uniScale;
    const scaledZ = d.rawSize.z * uniScale;
    console.log(
      d.key.padEnd(24) +
      `scaled: ${scaledX.toFixed(2)} × ${scaledZ.toFixed(2)}`.padStart(30) +
      `  connection Z half: ${(d.rawSize.z / 2 * uniScale).toFixed(2)}`.padStart(30)
    );
  }

  await browser.close();
}

run().catch(console.error);
