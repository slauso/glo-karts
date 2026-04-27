// Isolation: hide workplane plate + grids, snap road. If the stripe pattern
// vanishes, the bug is plate/grid z-fighting. If it persists, it's the road
// material/texture itself.
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
  for (let z = -3; z <= 3; z++) s.track.place('straight', 0, z, 0);
  s.rebuildAll();
  // Hide every plate + grid + line in the scene.
  s.scene.traverse(o => {
    if (o.name === 'workplane-plate' || o.type === 'GridHelper' || (o.type === 'LineSegments' && o !== o.parent?.userData?.gizmo)) {
      o.visible = false;
    }
  });
  s.camera.position.set(0, 2000, 60000);
  s.camera.lookAt(0, 250, 0);
});
await page.waitForTimeout(300);
const a = path.join(OUT, `iso-noplate-${ts}.png`);
await page.screenshot({ path: a });
console.log('[shot-noplate]', a);

// Now also remove paint+curbs to test pure asphalt mesh.
await page.evaluate(() => {
  const s = window.__studio;
  s.scene.traverse(o => {
    if (!o.isMesh) return;
    const c = o.material?.color;
    if (!c) return;
    const hex = c.getHex();
    // Hide curbs + paint + finish so we only see asphalt.
    if (hex === 0xd0312d || hex === 0xf2f2f2 || hex === 0xfbbf24 || hex === 0xeeeeee) o.visible = false;
  });
});
await page.waitForTimeout(200);
const b = path.join(OUT, `iso-asphalt-${ts}.png`);
await page.screenshot({ path: b });
console.log('[shot-asphalt-only]', b);

await browser.close();
console.log('[done]');
