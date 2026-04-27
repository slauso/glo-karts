// Inspector params smoke: place a cylinder + ring + paraboloid; snap each.
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
if (!page) page = await ctx.newPage();
await page.goto('http://127.0.0.1:5173/editor.html', { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__studio, null, { timeout: 10000 });
await page.waitForTimeout(400);

async function shotFor(type, label) {
  await page.evaluate((t) => {
    const s = window.__studio;
    s.decor.clear?.();
    const inst = s.decor.add({ type: t, x: 0, y: 0, z: 0 });
    s.rebuildAllDecor && s.rebuildAllDecor();
    s.selectDecor(inst.id);
  }, type);
  await page.waitForTimeout(250);
  const box = await page.evaluate(() => {
    const el = document.getElementById('inspectorPopup');
    if (!el || el.hidden) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) };
  });
  const full = path.join(OUT, `params-${ts}-${label}-full.png`);
  await page.screenshot({ path: full });
  console.log('[shot]', full);
  if (box) {
    const crop = path.join(OUT, `params-${ts}-${label}-crop.png`);
    await page.screenshot({ path: crop, clip: box });
    console.log('[shot]', crop, JSON.stringify(box));
  }
}

for (const t of ['box', 'cylinder', 'sphere', 'cone', 'pyramid', 'torus', 'polygon', 'ring', 'paraboloid']) {
  await shotFor(t, t);
}

// Mutate cylinder sides to verify live geom rebuild.
await page.evaluate(() => {
  const s = window.__studio;
  s.decor.clear?.();
  const inst = s.decor.add({ type: 'cylinder', x: 0, y: 0, z: 0 });
  s.rebuildAllDecor && s.rebuildAllDecor();
  s.selectDecor(inst.id);
  inst.params.sides = 6;
  const m = s.__decorMeshById?.get?.(inst.id);
  // Fallback path: import sync via a small re-render.
  if (s.refreshHud) s.refreshHud();
});
await page.waitForTimeout(200);
const slider = await page.$('#ipParams .ip-param-slider');
if (slider) {
  await slider.evaluate((el) => { el.value = '6'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(200);
  const full = path.join(OUT, `params-${ts}-cylinder-6sides-full.png`);
  await page.screenshot({ path: full });
  console.log('[shot]', full);
}

await browser.close();
console.log('[done]');
