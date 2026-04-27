// Reproduce the user's flickering: place a row of straight segments and view
// from a low oblique angle. Capture screenshots from several angles and dump
// scene Y heights to diagnose what's coplanar.
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

// Dump heights of every mesh in scene, then snap from 4 angles.
const heights = await page.evaluate(() => {
  const s = window.__studio;
  s.track.clear();
  s.decor.clear();
  for (let z = -3; z <= 3; z++) s.track.place('straight', 0, z, 0);
  s.rebuildAll();
  const out = [];
  s.scene.traverse(o => {
    if (o.isMesh || o.isLineSegments || o.isLine) {
      const box = new (o.geometry.constructor.name === 'BufferGeometry' || true ? Object.getPrototypeOf(o).constructor : null);
      // Just record world position Y and name + any geometry bbox y range.
      const py = o.position.y;
      let bymin = null, bymax = null;
      try {
        const g = o.geometry;
        g.computeBoundingBox?.();
        if (g.boundingBox) { bymin = g.boundingBox.min.y; bymax = g.boundingBox.max.y; }
      } catch {}
      // Convert local bbox y to approx world by sampling matrixWorld translation.
      o.updateWorldMatrix(true, false);
      const m = o.matrixWorld.elements;
      const wy = m[13];
      out.push({ name: o.name || o.type, py, wy: +wy.toFixed(3), bymin, bymax });
    }
  });
  return out.filter(r => r.name && (r.name.includes('plate') || r.name.includes('grid') || r.name.startsWith('seg') || r.name === 'Mesh' || r.name === 'GridHelper' || r.name === 'LineSegments'));
});
console.log('[heights]');
for (const h of heights.slice(0, 30)) console.log(' ', JSON.stringify(h));

// Move camera to user's low-angle view.
await page.evaluate(() => {
  const s = window.__studio;
  s.camera.position.set(8000, 6000, 32000);
  s.camera.lookAt(0, 250, 0);
});
await page.waitForTimeout(300);
const a = path.join(OUT, `flicker-low-${ts}.png`);
await page.screenshot({ path: a });
console.log('[shot-low]', a);

await page.evaluate(() => {
  const s = window.__studio;
  s.camera.position.set(0, 2000, 60000);
  s.camera.lookAt(0, 250, 0);
});
await page.waitForTimeout(300);
const b = path.join(OUT, `flicker-grazing-${ts}.png`);
await page.screenshot({ path: b });
console.log('[shot-grazing]', b);

await browser.close();
console.log('[done]');
