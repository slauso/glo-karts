// Multi-shape gallery snap: render each new shape (roof/star/tube/half_cyl/arch)
// in a clean scene and capture a side-front view for visual verification.
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
  s.decor.clear();
  // Lay 5 shapes in a row.
  const shapes = ['heart', 'octahedron', 'dodecahedron', 'icosahedron'];
  for (let i = 0; i < shapes.length; i++) {
    s.decor.add({ type: shapes[i], x: (i - 1.5) * 8000, y: 0, z: 0, sx: 5000, sy: 5000, sz: 5000 });
  }
  s.rebuildAllDecor();
  s.camera.position.set(0, 18000, 28000);
  s.camera.lookAt(0, 2500, 0);
});
await page.waitForTimeout(300);

const shot = path.join(OUT, `gallery-${ts}-new-shapes.png`);
await page.screenshot({ path: shot });
console.log('[shot]', shot);

await browser.close();
console.log('[done]');
