// Look straight down at the road from high altitude. Should show a continuous ribbon.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
const OUT = path.resolve('dev-snapshots');
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
  for (let z = -3; z <= 3; z++) s.track.place('straight', 0, z, 0);
  s.rebuildAll();
  s.scene.traverse(o => { if (o.name === 'workplane-plate' || o.type === 'GridHelper') o.visible = false; });
});

// Top-down — should show continuous ribbon if geometry is correct.
await page.evaluate(() => { const s = window.__studio; s.camera.position.set(0, 80000, 0.001); s.camera.lookAt(0, 0, 0); });
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(OUT, `top-down-${ts}.png`) });
console.log('top:', path.join(OUT, `top-down-${ts}.png`));

// 30° angle from above.
await page.evaluate(() => { const s = window.__studio; s.camera.position.set(20000, 30000, 50000); s.camera.lookAt(0, 0, 0); });
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(OUT, `mid-angle-${ts}.png`) });
console.log('mid:', path.join(OUT, `mid-angle-${ts}.png`));

await browser.close();
