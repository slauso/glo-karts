// Place a straight road segment and snap the inspector-clear view to confirm
// the workplane no longer slices through the tarmac.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
const OUT = path.resolve('dev-snapshots');
await fs.mkdir(OUT, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
let browser, ctx;
try { browser = await chromium.connectOverCDP('http://127.0.0.1:9222'); ctx = browser.contexts()[0]; }
catch { browser = await chromium.launch(); ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } }); }
let page = ctx.pages().find(p => p.url().includes('127.0.0.1:5173/editor.html'));
if (!page) page = await ctx.newPage();
await page.goto('http://127.0.0.1:5173/editor.html', { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__studio, null, { timeout: 10000 });
await page.waitForTimeout(400);

await page.evaluate(() => {
  const s = window.__studio;
  s.track.clear();
  s.decor.clear();
  for (let z = -2; z <= 2; z++) s.track.place('straight', 0, z, 0);
  s.rebuildAll();
  s.refreshHud();
  s.camera.position.set(20000, 14000, 22000);
  s.camera.lookAt(0, 250, 0);
});
await page.waitForTimeout(400);
const shot = path.join(OUT, `tarmac-zfight-${ts}.png`);
await page.screenshot({ path: shot });
console.log('[shot]', shot);
await browser.close();
console.log('[done]');
