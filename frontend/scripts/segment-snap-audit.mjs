// Place each segment with a straight on either side along Z and screenshot
// from above to confirm clean edge-to-edge snap.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve('dev-snapshots/seg-snap');
await fs.mkdir(OUT, { recursive: true });

let browser, ctx;
try { browser = await chromium.connectOverCDP('http://127.0.0.1:9222'); ctx = browser.contexts()[0]; }
catch { browser = await chromium.launch(); ctx = await browser.newContext({ viewport: { width: 1200, height: 1200 } }); }
let page = ctx.pages().find(p => p.url().includes('127.0.0.1:5173/editor.html'));
if (!page) page = await ctx.newPage();
await page.setViewportSize({ width: 1200, height: 1200 });
await page.goto('http://127.0.0.1:5173/editor.html', { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__studio, null, { timeout: 15000 });

const keys = await page.evaluate(() => window.__studio.SEGMENT_KEYS);

for (const key of keys) {
  const result = await page.evaluate((k) => {
    const s = window.__studio;
    const def = s.SEGMENTS[k];
    if (!def) return { skip: true };
    s.track.clear(); s.decor.clear();
    const span = def.span || { x: 1, z: 1 };
    // Place under-test piece at gz = 0..(span.z-1)
    s.track.place(k, 0, 0, 0);
    // Straights before and after the piece
    s.track.place('straight', 0, -1, 0);
    s.track.place('straight', 0, span.z, 0);
    s.rebuildAll();
    return { spanZ: span.z };
  }, key);
  if (result.skip) continue;
  await page.evaluate((spanZ) => {
    const s = window.__studio;
    const cellMM = 12000;
    const z = (spanZ - 1) * cellMM / 2;
    const max = (spanZ + 2) * cellMM;
    s.camera.position.set(0, max * 1.4, z + 1);
    s.camera.lookAt(0, 0, z);
  }, result.spanZ);
  await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(OUT, `${key}.png`) });
  console.log('[snap]', key);
}
console.log('[done]');
await browser.close();
