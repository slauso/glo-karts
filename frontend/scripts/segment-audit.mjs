// Audit every track segment by placing it alone, snapping top + perspective,
// and dumping mesh stats so we can spot broken / primitive ones.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve('dev-snapshots/seg-audit');
await fs.mkdir(OUT, { recursive: true });

let browser, ctx;
try {
  browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  ctx = browser.contexts()[0];
} catch {
  browser = await chromium.launch();
  ctx = await browser.newContext({ viewport: { width: 1200, height: 1200 } });
}
let page = ctx.pages().find((p) => p.url().includes('127.0.0.1:5173/editor.html'));
if (!page) page = await ctx.newPage();
await page.setViewportSize({ width: 1200, height: 1200 });
await page.goto('http://127.0.0.1:5173/editor.html', { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__studio, null, { timeout: 15000 });
await page.waitForTimeout(400);

const keys = await page.evaluate(() => window.__studio.SEGMENT_KEYS);

const report = [];
for (const key of keys) {
  const info = await page.evaluate(async (k) => {
    const s = window.__studio;
    s.track.clear();
    s.decor.clear();
    s.track.place(k, 0, 0, 0);
    s.rebuildAll();
    // Compute bounding box of just this segment group.
    const THREE = window.__studio.THREE;
    const box = new THREE.Box3();
    let meshCount = 0;
    let triCount = 0;
    let materials = new Set();
    s.scene.traverse((o) => {
      if (o.name && o.name.startsWith('seg:')) {
        o.updateMatrixWorld(true);
        box.expandByObject(o);
        o.traverse((c) => {
          if (c.isMesh) {
            meshCount++;
            const g = c.geometry;
            if (g && g.index) triCount += g.index.count / 3;
            else if (g && g.attributes && g.attributes.position) triCount += g.attributes.position.count / 3;
            if (c.material) materials.add(c.material.uuid);
          }
        });
      }
    });
    const sz = box.getSize(new THREE.Vector3());
    const ctr = box.getCenter(new THREE.Vector3());
    return {
      meshCount,
      triCount: Math.round(triCount),
      materials: materials.size,
      bbox: { sx: +sz.x.toFixed(0), sy: +sz.y.toFixed(0), sz: +sz.z.toFixed(0) },
      center: { x: +ctr.x.toFixed(0), y: +ctr.y.toFixed(0), z: +ctr.z.toFixed(0) },
    };
  }, key);

  // Frame two camera shots
  await page.evaluate((bb) => {
    const s = window.__studio;
    const max = Math.max(bb.sx, bb.sy, bb.sz, 6000);
    const d = max * 1.6;
    s.camera.position.set(d, d * 0.85, d);
    s.camera.lookAt(bb.cx, bb.cy * 0.5, bb.cz);
  }, { sx: info.bbox.sx, sy: info.bbox.sy, sz: info.bbox.sz, cx: info.center.x, cy: info.center.y, cz: info.center.z });
  await page.waitForTimeout(120);
  const persp = path.join(OUT, `${key}-persp.png`);
  await page.screenshot({ path: persp });

  await page.evaluate((bb) => {
    const s = window.__studio;
    const max = Math.max(bb.sx, bb.sz, 6000);
    s.camera.position.set(bb.cx, max * 2.2, bb.cz + 1);
    s.camera.lookAt(bb.cx, 0, bb.cz);
  }, { sx: info.bbox.sx, sy: info.bbox.sy, sz: info.bbox.sz, cx: info.center.x, cy: info.center.y, cz: info.center.z });
  await page.waitForTimeout(120);
  const top = path.join(OUT, `${key}-top.png`);
  await page.screenshot({ path: top });

  report.push({ key, ...info });
  console.log('[seg]', key.padEnd(20), 'mesh=', info.meshCount, 'tri=', info.triCount, 'bb=', info.bbox);
}

await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log('[done]', report.length, 'segments');
await browser.close();
