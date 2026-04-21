/**
 * measure-heights.mjs — Compare exact road surface Y of SKR vs procedural pieces.
 */
import { chromium } from 'playwright';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

const BASE_URL = process.argv[2] || 'http://localhost:5175';

const MODULE_CODE = `
import * as THREE from 'three';
import { loadModel } from './asset-loader.js';

const keys = ['skr-straight','skr-corner','skr-finish','skr-bump','straight','corner-small','wide','bump-up','cap-front'];
const out = {};
for (const key of keys) {
  try {
    const m = await loadModel(key);
    const box = new THREE.Box3().setFromObject(m);
    const size = box.getSize(new THREE.Vector3());
    
    // Find the top-most Y of the main road surface (the flat deck, not features on top)
    // For flat pieces this is max.y, for pieces with features we need the deck surface
    let roadSurfaceY = null;
    m.traverse(child => {
      if (!child.isMesh) return;
      const cbox = new THREE.Box3().setFromObject(child);
      const csize = cbox.getSize(new THREE.Vector3());
      // The main road deck is the widest mesh (spans full cell width)
      if (csize.x >= 8 && csize.z >= 8 && (roadSurfaceY === null || cbox.max.y < roadSurfaceY + 0.5)) {
        roadSurfaceY = cbox.max.y;
      }
    });

    out[key] = {
      totalH: +size.y.toFixed(4),
      minY: +box.min.y.toFixed(4),
      maxY: +box.max.y.toFixed(4),
      roadSurface: roadSurfaceY !== null ? +roadSurfaceY.toFixed(4) : null,
      w: +size.x.toFixed(2),
      d: +size.z.toFixed(2),
    };
  } catch(e) {
    out[key] = { error: e.message };
  }
}
window.__heightResults = out;
`;

async function main() {
  const tempFile = join(process.cwd(), 'src', 'builder-v2', '_height_temp.js');
  writeFileSync(tempFile, MODULE_CODE);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on('pageerror', e => console.error('Page error:', e.message));

    await page.goto(`${BASE_URL}/builder.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);
    await page.click('#bv2-landing-new-track');
    await page.waitForTimeout(4000);

    await page.addScriptTag({ type: 'module', url: '/src/builder-v2/_height_temp.js' });
    await page.waitForFunction(() => window.__heightResults, { timeout: 60000 });
    const results = await page.evaluate(() => window.__heightResults);

    console.log('\\n=== Road Surface Height Comparison ===\\n');
    for (const [key, val] of Object.entries(results)) {
      if (val.error) { console.log('  ' + key + ': ERROR — ' + val.error); continue; }
      const origin = key.startsWith('skr-') ? 'SKR' : 'PROC';
      console.log('  [' + origin + '] ' + key.padEnd(16) +
        ' surface=' + String(val.roadSurface).padEnd(8) +
        ' minY=' + String(val.minY).padEnd(8) +
        ' maxY=' + String(val.maxY).padEnd(8) +
        ' totalH=' + val.totalH);
    }
  } finally {
    try { unlinkSync(tempFile); } catch {}
    await browser.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
