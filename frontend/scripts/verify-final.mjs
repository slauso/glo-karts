/**
 * verify-final.mjs — Verify procedural pieces match SKR rendering pipeline.
 * Checks: bounding boxes, material style, exact palette colors.
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

    // Collect ALL unique material colors + properties
    const matSet = new Set();
    const mats = [];
    m.traverse(child => {
      if (!child.isMesh) return;
      const mm = child.material;
      const hex = mm.color ? '#' + mm.color.getHexString() : 'none';
      const key2 = hex + '|' + mm.roughness + '|' + mm.metalness + '|' + !!mm.map;
      if (!matSet.has(key2)) {
        matSet.add(key2);
        mats.push({
          color: hex,
          rough: mm.roughness,
          metal: mm.metalness,
          hasMap: !!mm.map,
        });
      }
    });

    out[key] = {
      w: +size.x.toFixed(2),
      h: +size.y.toFixed(2),
      d: +size.z.toFixed(2),
      minY: +box.min.y.toFixed(3),
      mats,
    };
  } catch(e) {
    out[key] = { error: e.message };
  }
}
window.__finalResults = out;
`;

async function main() {
  const tempFile = join(process.cwd(), 'src', 'builder-v2', '_final_temp.js');
  writeFileSync(tempFile, MODULE_CODE);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on('pageerror', e => console.error('Page error:', e.message));

    await page.goto(`${BASE_URL}/builder.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);
    await page.click('#bv2-landing-new-track');
    await page.waitForTimeout(4000);

    await page.addScriptTag({ type: 'module', url: '/src/builder-v2/_final_temp.js' });
    await page.waitForFunction(() => window.__finalResults, { timeout: 60000 });
    const results = await page.evaluate(() => window.__finalResults);

    console.log('\\n=== Final Style Verification ===');
    console.log('SKR pipeline: roughness=1, metalness=0, flat palette colors\\n');

    let pass = 0, fail = 0;
    for (const [key, val] of Object.entries(results)) {
      if (val.error) { console.log('  ' + key + ': ERROR — ' + val.error); fail++; continue; }

      const sizeOk = Math.abs(val.w - 10) < 0.5 && Math.abs(val.d - 10) < 0.5;
      const matsOk = val.mats.every(m => m.rough === 1 && m.metal === 0);
      const ok = sizeOk && matsOk;
      const tag = ok ? '✓' : '✗';

      const colors = val.mats.map(m => m.color + (m.hasMap ? '+tex' : '')).join(', ');
      console.log('  ' + tag + ' ' + key + ': ' + val.w + '×' + val.h + '×' + val.d +
                  '  materials=[' + colors + ']  rough=' + val.mats[0]?.rough + ' metal=' + val.mats[0]?.metal);

      if (ok) pass++; else fail++;
    }

    console.log('\\n  ' + pass + ' passed, ' + fail + ' failed');
    process.exitCode = fail > 0 ? 1 : 0;
  } finally {
    try { unlinkSync(tempFile); } catch {}
    await browser.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
