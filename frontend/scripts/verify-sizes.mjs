/**
 * verify-sizes.mjs — Measure bounding boxes of all models in the builder.
 * Usage: node scripts/verify-sizes.mjs http://localhost:5175
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
    out[key] = {
      w: +size.x.toFixed(2),
      h: +size.y.toFixed(2),
      d: +size.z.toFixed(2),
      minY: +box.min.y.toFixed(3),
    };
  } catch(e) {
    out[key] = { error: e.message };
  }
}
window.__verifyResults = out;
`;

async function main() {
  // Write a temp module file that Vite can serve
  const tempFile = join(process.cwd(), 'src', 'builder-v2', '_verify_temp.js');
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

    // Load the temp module via Vite (resolves 'three' through Vite's dep graph)
    await page.addScriptTag({ type: 'module', url: '/src/builder-v2/_verify_temp.js' });
    await page.waitForFunction(() => window.__verifyResults, { timeout: 60000 });
    const results = await page.evaluate(() => window.__verifyResults);

    console.log('\n=== Model Bounding Box Verification ===');
    console.log('Target: 10.00 x _ x 10.00 (matching SKR straight/corner)\n');

    let pass = 0, fail = 0;
    for (const [key, val] of Object.entries(results)) {
      if (val.error) {
        console.log(`  ${key}: ERROR — ${val.error}`);
        fail++;
      } else {
        const xzOk = Math.abs(val.w - 10) < 0.5 && Math.abs(val.d - 10) < 0.5;
        const tag = xzOk ? '✓' : '✗';
        console.log(`  ${tag} ${key}: ${val.w} × ${val.h} × ${val.d}  minY=${val.minY}`);
        if (xzOk) pass++; else fail++;
      }
    }

    console.log(`\n  ${pass} passed, ${fail} failed`);
    if (errors.length) console.log('\n  JS Errors:', errors.join('; '));
    process.exitCode = fail > 0 ? 1 : 0;
  } finally {
    try { unlinkSync(tempFile); } catch {}
    await browser.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
