// Inspector floater visual smoke. Adds a primitive via window.__studio,
// selects it, and snaps the floater for visual inspection.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve('dev-snapshots');
await fs.mkdir(OUT, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

let browser, ctx;
try {
  browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  ctx = browser.contexts()[0];
} catch {
  browser = await chromium.launch();
  ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
}
let page = ctx.pages().find(p => p.url().includes('127.0.0.1:5173/editor.html'));
if (!page) {
  page = await ctx.newPage();
}
await page.goto('http://127.0.0.1:5173/editor.html', { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__studio, null, { timeout: 10000 });
await page.waitForTimeout(500);

await page.evaluate(() => {
  const s = window.__studio;
  // Place a box primitive and select it so the inspector surfaces.
  const inst = s.decor.add({ type: 'box', x: 0, y: 0, z: 0, color: 0x2e9bd6 });
  s.rebuildAllDecor && s.rebuildAllDecor();
  s.selectDecor(inst.id);
});
await page.waitForTimeout(400);

const shotAll = path.join(OUT, `inspector-${ts}-full.png`);
await page.screenshot({ path: shotAll });
console.log('[shot]', shotAll);

// Crop to the inspector floater for a tight comparison shot.
const box = await page.evaluate(() => {
  const el = document.getElementById('inspectorPopup');
  if (!el || el.hidden) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) };
});
if (box) {
  const shotCrop = path.join(OUT, `inspector-${ts}-crop.png`);
  await page.screenshot({ path: shotCrop, clip: box });
  console.log('[shot]', shotCrop, JSON.stringify(box));
} else {
  console.log('[warn] inspector hidden — no crop');
}

await browser.close();
console.log('[done]');
