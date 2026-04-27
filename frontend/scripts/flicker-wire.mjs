// Render with wireframe + dump material side/transparency for road meshes.
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

const dump = await page.evaluate(() => {
  const s = window.__studio;
  s.track.clear();
  for (let z = -3; z <= 3; z++) s.track.place('straight', 0, z, 0);
  s.rebuildAll();
  const out = [];
  let i = 0;
  s.scene.traverse(o => {
    if (!o.isMesh) return;
    const m = o.material;
    const c = m?.color?.getHex?.();
    // Only collect dark asphalt-ish meshes.
    if (c == null) return;
    if (c === 0x2a2d33 || c === 0x1a1c20) {
      o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox;
      o.updateWorldMatrix(true, false);
      const wpos = new (o.position.constructor)(0, 0, 0).setFromMatrixPosition(o.matrixWorld);
      out.push({
        i: i++,
        color: '#' + c.toString(16),
        side: m.side, // 0=Front 1=Back 2=Double
        transparent: m.transparent,
        depthWrite: m.depthWrite,
        wpos: { x: +wpos.x.toFixed(0), y: +wpos.y.toFixed(0), z: +wpos.z.toFixed(0) },
        bb: { min: [+bb.min.x.toFixed(2), +bb.min.y.toFixed(2), +bb.min.z.toFixed(2)], max: [+bb.max.x.toFixed(2), +bb.max.y.toFixed(2), +bb.max.z.toFixed(2)] },
        triCount: o.geometry.index ? o.geometry.index.count / 3 : (o.geometry.attributes.position.count / 3),
      });
    }
    // Force wireframe to see geometry.
    if (m && 'wireframe' in m) m.wireframe = true;
  });
  s.scene.traverse(o => { if (o.name === 'workplane-plate' || o.type === 'GridHelper') o.visible = false; });
  s.camera.position.set(0, 80000, 0.001); s.camera.lookAt(0, 0, 0);
  return out;
});
console.log('[asphalt meshes]:', JSON.stringify(dump, null, 1));

await page.waitForTimeout(200);
await page.screenshot({ path: path.join(OUT, `wire-top-${ts}.png`) });
console.log('wire:', path.join(OUT, `wire-top-${ts}.png`));

await browser.close();
