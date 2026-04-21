/**
 * inspect-skr-style.mjs — Dump geometry & material details from SKR models.
 * Usage: node scripts/inspect-skr-style.mjs http://localhost:5175
 */
import { chromium } from 'playwright';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

const BASE_URL = process.argv[2] || 'http://localhost:5175';

const MODULE_CODE = `
import * as THREE from 'three';
import { loadModel } from './asset-loader.js';

const keys = ['skr-straight', 'skr-corner', 'skr-finish'];
const out = {};

for (const key of keys) {
  try {
    const m = await loadModel(key);
    const meshes = [];
    m.traverse((child) => {
      if (!child.isMesh) return;
      const geo = child.geometry;
      const mat = child.material;
      const box = new THREE.Box3().setFromObject(child);
      const size = box.getSize(new THREE.Vector3());
      const pos = child.position.clone();
      const worldPos = new THREE.Vector3();
      child.getWorldPosition(worldPos);

      const matInfo = Array.isArray(mat) ? mat.map(extractMat) : extractMat(mat);

      meshes.push({
        name: child.name || '(unnamed)',
        geoType: geo.type,
        vertexCount: geo.attributes.position?.count || 0,
        size: { x: +size.x.toFixed(3), y: +size.y.toFixed(3), z: +size.z.toFixed(3) },
        localPos: { x: +pos.x.toFixed(3), y: +pos.y.toFixed(3), z: +pos.z.toFixed(3) },
        worldPos: { x: +worldPos.x.toFixed(3), y: +worldPos.y.toFixed(3), z: +worldPos.z.toFixed(3) },
        material: matInfo,
      });
    });
    out[key] = meshes;
  } catch(e) {
    out[key] = { error: e.message };
  }
}

function extractMat(m) {
  return {
    type: m.type,
    color: m.color ? '#' + m.color.getHexString() : null,
    roughness: m.roughness,
    metalness: m.metalness,
    map: m.map ? 'yes' : 'no',
    normalMap: m.normalMap ? 'yes' : 'no',
    emissive: m.emissive ? '#' + m.emissive.getHexString() : null,
    opacity: m.opacity,
    transparent: m.transparent,
    name: m.name || null,
  };
}

window.__inspectResults = out;
`;

async function main() {
  const tempFile = join(process.cwd(), 'src', 'builder-v2', '_inspect_temp.js');
  writeFileSync(tempFile, MODULE_CODE);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto(`${BASE_URL}/builder.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });
    await page.waitForTimeout(2000);
    await page.click('#bv2-landing-new-track');
    await page.waitForTimeout(4000);

    await page.addScriptTag({ type: 'module', url: '/src/builder-v2/_inspect_temp.js' });
    await page.waitForFunction(() => window.__inspectResults, { timeout: 60000 });
    const results = await page.evaluate(() => window.__inspectResults);

    for (const [key, meshes] of Object.entries(results)) {
      console.log(`\\n=== ${key} ===`);
      if (meshes.error) { console.log('  ERROR:', meshes.error); continue; }
      for (const m of meshes) {
        console.log(`  Mesh: "${m.name}" (${m.geoType}, ${m.vertexCount} verts)`);
        console.log(`    Size: ${m.size.x} × ${m.size.y} × ${m.size.z}`);
        console.log(`    WorldPos: (${m.worldPos.x}, ${m.worldPos.y}, ${m.worldPos.z})`);
        const mat = Array.isArray(m.material) ? m.material : [m.material];
        for (const mi of mat) {
          console.log(`    Mat: ${mi.type} color=${mi.color} rough=${mi.roughness} metal=${mi.metalness} map=${mi.map} name="${mi.name}"`);
        }
      }
    }

    if (errors.length) console.log('\\nJS Errors:', errors.join('; '));
  } finally {
    try { unlinkSync(tempFile); } catch {}
    await browser.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
