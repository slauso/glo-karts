/**
 * verify-style-match.mjs — Verify procedural pieces match SKR material style.
 * Checks: bounding boxes, material type, roughness, metalness, texture usage.
 */
import { chromium } from 'playwright';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

const BASE_URL = process.argv[2] || 'http://localhost:5175';

const KEYS = [
  'straight','corner-small','corner-large','curve','bump-up','bump-down',
  'hill-beginning','hill-end','hill-complete','hill-complete-half',
  'corner-small-ramp','corner-large-ramp','bend','bend-large',
  'skew-left','skew-right','skew-left-side','skew-right-side',
  'cap-front','cap-back','wide','end','skr-straight','skr-corner',
];

const MODULE_CODE = `
import * as THREE from 'three';
import { loadModel } from './asset-loader.js';

const keys = ${JSON.stringify(KEYS)};
const out = {};
for (const key of keys) {
  try {
    const m = await loadModel(key);
    const box = new THREE.Box3().setFromObject(m);
    const size = box.getSize(new THREE.Vector3());
    
    // Collect material info from first mesh
    const mats = [];
    m.traverse((child) => {
      if (!child.isMesh || mats.length >= 3) return;
      const mat = child.material;
      mats.push({
        type: mat.type,
        color: mat.color ? '#' + mat.color.getHexString() : null,
        roughness: mat.roughness,
        metalness: mat.metalness,
        hasMap: !!mat.map,
        mapName: mat.map?.name || null,
      });
    });

    out[key] = {
      w: +size.x.toFixed(2),
      h: +size.y.toFixed(2),
      d: +size.z.toFixed(2),
      minY: +box.min.y.toFixed(3),
      mat: mats[0] || null,
    };
  } catch(e) {
    out[key] = { error: e.message };
  }
}
window.__styleResults = out;
`;

async function main() {
  const tempFile = join(process.cwd(), 'src', 'builder-v2', '_style_temp.js');
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

    await page.addScriptTag({ type: 'module', url: '/src/builder-v2/_style_temp.js' });
    await page.waitForFunction(() => window.__styleResults, { timeout: 60000 });
    const results = await page.evaluate(() => window.__styleResults);

    console.log('\\n=== Style Match Verification ===');
    console.log('Target material: MeshStandardMaterial color=#ffffff rough=1 metal=0 map=yes\\n');

    let pass = 0, fail = 0;
    for (const [key, val] of Object.entries(results)) {
      if (val.error) {
        console.log(`  ${key}: ERROR — ${val.error}`);
        fail++;
        continue;
      }

      const mat = val.mat;
      const sizeOk = Math.abs(val.w - 10) < 0.5 && Math.abs(val.d - 10) < 0.5;
      const matOk = mat && mat.color === '#ffffff' && mat.roughness === 1 && mat.metalness === 0 && mat.hasMap;
      const ok = sizeOk && matOk;
      const tag = ok ? '✓' : '✗';

      const matStr = mat
        ? `color=${mat.color} rough=${mat.roughness} metal=${mat.metalness} map=${mat.hasMap}`
        : 'NO MATERIAL';

      console.log(`  ${tag} ${key}: ${val.w}×${val.h}×${val.d}  ${matStr}`);
      if (ok) pass++; else fail++;
    }

    console.log(`\\n  ${pass} passed, ${fail} failed`);
    if (errors.length) console.log('\\n  JS Errors:', errors.join('; '));
    process.exitCode = fail > 0 ? 1 : 0;
  } finally {
    try { unlinkSync(tempFile); } catch {}
    await browser.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
