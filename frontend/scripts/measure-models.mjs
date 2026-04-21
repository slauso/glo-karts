/**
 * Measures actual bounding box sizes of track GLB models in the browser.
 */
import { chromium } from 'playwright';

const BASE_URL = process.argv[2] || 'http://localhost:5174';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('pageerror', err => console.error('JS ERROR:', err.message));

  await page.goto(`${BASE_URL}/builder.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  const results = await page.evaluate(() => {
    return new Promise(async (resolve) => {
      try {
        const al = await import('/src/builder-v2/asset-loader.js');
        const { loadModel, getModelMeta, TRACK_ASSETS, preloadAll } = al;

        // Preload all models so getModelMeta works
        await preloadAll();

        const measurements = [];
        for (const asset of TRACK_ASSETS) {
          const meta = getModelMeta(asset.key);
          if (meta) {
            measurements.push({
              key: asset.key,
              file: asset.file,
              width: Math.round(meta.size.x * 1000) / 1000,
              height: Math.round(meta.size.y * 1000) / 1000,
              depth: Math.round(meta.size.z * 1000) / 1000,
              centerX: Math.round(meta.center.x * 1000) / 1000,
              centerY: Math.round(meta.center.y * 1000) / 1000,
              centerZ: Math.round(meta.center.z * 1000) / 1000,
              minX: Math.round(meta.min.x * 1000) / 1000,
              minY: Math.round(meta.min.y * 1000) / 1000,
              minZ: Math.round(meta.min.z * 1000) / 1000,
              maxX: Math.round(meta.max.x * 1000) / 1000,
              maxY: Math.round(meta.max.y * 1000) / 1000,
              maxZ: Math.round(meta.max.z * 1000) / 1000,
            });
          } else {
            measurements.push({ key: asset.key, file: asset.file, error: 'no meta' });
          }
        }
        resolve(measurements);
      } catch (err) {
        resolve({ error: err.message });
      }
    });
  });

  console.log('=== Track Model Measurements ===');
  console.log('GRID_SIZE = 10 (expected cell size)');
  console.log('');

  if (Array.isArray(results)) {
    for (const m of results) {
      if (m.error) {
        console.log(`${m.key} (${m.file}): ERROR - ${m.error}`);
      } else {
        console.log(`${m.key} (${m.file}):`);
        console.log(`  Size: ${m.width} x ${m.height} x ${m.depth}`);
        console.log(`  Center: (${m.centerX}, ${m.centerY}, ${m.centerZ})`);
        console.log(`  Bounds: (${m.minX},${m.minY},${m.minZ}) to (${m.maxX},${m.maxY},${m.maxZ})`);
        console.log(`  Scale needed for 10-unit grid: ${(10 / Math.max(m.width, m.depth)).toFixed(3)}x`);
      }
    }
  } else {
    console.log('Error:', results);
  }

  await browser.close();
}

main().catch(err => { console.error(err); process.exit(1); });
