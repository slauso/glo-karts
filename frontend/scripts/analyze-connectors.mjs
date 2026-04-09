/**
 * analyze-connectors.mjs
 * Inspect raw GLB boundary geometry to estimate connector centers.
 */
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5174';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(`${BASE_URL}/builder.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.click('#bv2-land-new');
  await page.waitForSelector('.bv2-asset-btn', { timeout: 15000 });
  await page.waitForTimeout(1200);

  const report = await page.evaluate(async () => {
    const { TRACK_ASSETS } = await import('/src/builder-v2/asset-loader.js');
    const { PIECE_DEFS, DIR } = await import('/src/builder-v2/grid-placement.js');
    const THREE = window.__THREE;
    const { GLTFLoader } = await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
    const loader = new GLTFLoader();

    function summarizeBoundary(root, dir) {
      root.updateMatrixWorld(true);
      const worldVerts = [];
      root.traverse((child) => {
        if (!child.isMesh || !child.geometry?.attributes?.position) return;
        const pos = child.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(child.matrixWorld);
          worldVerts.push(v);
        }
      });
      if (!worldVerts.length) return null;

      const xs = worldVerts.map(v => v.x);
      const zs = worldVerts.map(v => v.z);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minZ = Math.min(...zs), maxZ = Math.max(...zs);
      const eps = 0.16;

      let samples;
      if (dir === DIR.N) samples = worldVerts.filter(v => Math.abs(v.z - minZ) < eps);
      else if (dir === DIR.S) samples = worldVerts.filter(v => Math.abs(v.z - maxZ) < eps);
      else if (dir === DIR.E) samples = worldVerts.filter(v => Math.abs(v.x - maxX) < eps);
      else samples = worldVerts.filter(v => Math.abs(v.x - minX) < eps);

      if (!samples.length) return null;
      const avg = samples.reduce((acc, v) => ({ x: acc.x + v.x, y: acc.y + v.y, z: acc.z + v.z }), { x: 0, y: 0, z: 0 });
      avg.x /= samples.length;
      avg.y /= samples.length;
      avg.z /= samples.length;

      return {
        count: samples.length,
        avgX: +avg.x.toFixed(3),
        avgY: +avg.y.toFixed(3),
        avgZ: +avg.z.toFixed(3),
        minX: +minX.toFixed(3),
        maxX: +maxX.toFixed(3),
        minZ: +minZ.toFixed(3),
        maxZ: +maxZ.toFixed(3),
      };
    }

    const rows = [];
    for (const asset of TRACK_ASSETS) {
      const def = PIECE_DEFS[asset.key];
      if (!def) continue;
      const gltf = await new Promise((resolve, reject) => loader.load(`/models/track/${asset.file}`, resolve, undefined, reject));
      const root = gltf.scene;
      const ports = {};
      for (const dir of def.ports) {
        const label = ['N','E','S','W'][dir];
        ports[label] = summarizeBoundary(root, dir);
      }
      rows.push({ key: asset.key, ports });
    }
    return rows;
  });

  for (const row of report) {
    console.log(`\n${row.key}`);
    for (const [dir, value] of Object.entries(row.ports)) {
      console.log(`  ${dir}: ${JSON.stringify(value)}`);
    }
  }

  await browser.close();
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
