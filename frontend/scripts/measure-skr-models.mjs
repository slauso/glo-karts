/**
 * Measures both existing track models and new SKR models for size comparison.
 */
import { chromium } from 'playwright';

const BASE_URL = process.argv[2] || 'http://localhost:5174';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('pageerror', err => console.error('JS ERROR:', err.message));

  await page.goto(`${BASE_URL}/builder.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  // Add a helper script that uses dynamic import via the existing module system
  await page.evaluate(() => {
    const s = document.createElement('script');
    s.type = 'module';
    s.textContent = `
      import('/src/builder-v2/asset-loader.js').then(async (al) => {
        const m = await al.loadModel('straight');
        // Now THREE is loaded in the module graph, we can access Box3/Vector3 via the same module
        const { Box3, Vector3 } = await import('/node_modules/.vite/deps/three.js');
        window.__Box3 = Box3;
        window.__Vector3 = Vector3;
        
        // Re-export the GLTFLoader
        const { GLTFLoader } = await import('/node_modules/.vite/deps/three_addons_loaders_GLTFLoader__js.js');
        window.__GLTFLoader = GLTFLoader;
        window.__measureReady = true;
      });
    `;
    document.head.appendChild(s);
  });
  
  // Wait for ready
  await page.waitForFunction(() => window.__measureReady === true, { timeout: 20000 }).catch(() => {});
  
  // If that approach failed, just use the preload-based approach
  const isReady = await page.evaluate(() => window.__measureReady === true);
  
  let results;
  if (isReady) {
    const skrModels = [
      'skr/track-straight.glb',
      'skr/track-corner.glb',
      'skr/track-bump.glb',
      'skr/track-finish.glb',
      'skr/decoration-empty.glb',
      'skr/decoration-forest.glb',
      'skr/decoration-tents.glb',
    ];

    results = [];
    for (const file of skrModels) {
      try {
        const m = await page.evaluate(async (url) => {
          const loader = new window.__GLTFLoader();
          const gltf = await new Promise((res, rej) => loader.load(url, res, undefined, rej));
          const bbox = new window.__Box3().setFromObject(gltf.scene);
          const size = bbox.getSize(new window.__Vector3());
          const center = bbox.getCenter(new window.__Vector3());
          return {
            width: Math.round(size.x * 1000) / 1000,
            height: Math.round(size.y * 1000) / 1000,
            depth: Math.round(size.z * 1000) / 1000,
            centerX: Math.round(center.x * 1000) / 1000,
            centerY: Math.round(center.y * 1000) / 1000,
            centerZ: Math.round(center.z * 1000) / 1000,
            minX: Math.round(bbox.min.x * 1000) / 1000,
            minY: Math.round(bbox.min.y * 1000) / 1000,
            minZ: Math.round(bbox.min.z * 1000) / 1000,
            maxX: Math.round(bbox.max.x * 1000) / 1000,
            maxY: Math.round(bbox.max.y * 1000) / 1000,
            maxZ: Math.round(bbox.max.z * 1000) / 1000,
          };
        }, `/models/${file}`);
        results.push({ file, ...m });
      } catch (err) {
        results.push({ file, error: err.message });
      }
    }
  } else {
    results = { error: 'Could not initialize measurement in browser' };
  }

  console.log('=== SKR Model Measurements ===');
  console.log('SKR CELL_RAW = 9.99');
  console.log('');

  if (Array.isArray(results)) {
    for (const m of results) {
      if (m.error) {
        console.log(`${m.file}: ERROR - ${m.error}`);
      } else {
        console.log(`${m.file}:`);
        console.log(`  Size: ${m.width} x ${m.height} x ${m.depth}`);
        console.log(`  Center: (${m.centerX}, ${m.centerY}, ${m.centerZ})`);
        console.log(`  Bounds: (${m.minX},${m.minY},${m.minZ}) to (${m.maxX},${m.maxY},${m.maxZ})`);
      }
    }
  } else {
    console.log('Error:', results);
  }

  await browser.close();
}

main().catch(err => { console.error(err); process.exit(1); });
