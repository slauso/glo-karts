import { chromium } from '@playwright/test';
const URL = process.env.EDITOR_URL || 'http://localhost:5173/editor.html';
let b; try { b = await chromium.connectOverCDP('http://127.0.0.1:9222'); } catch { b = await chromium.launch({ headless: true }); }
const ctx = b.contexts()[0] ?? await b.newContext();
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__studio, null, { timeout: 15000 });
// Force reload to flush HMR cache
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => !!window.__studio, null, { timeout: 15000 });
const data = await page.evaluate(() => {
  const { track, rebuildAll, scene, THREE } = window.__studio;
  track.clear();
  const ids = [];
  ids.push(track.place('straight', 0, 0, 0).id);
  ids.push(track.place('straight', 0, 1, 0).id);
  ids.push(track.place('corner', 0, 2, 0).id);
  ids.push(track.place('straight', -1, 2, 1).id);
  ids.push(track.place('straight', -2, 2, 1).id);
  rebuildAll();
  const out = [];
  for (const id of ids) {
    let node = null;
    scene.traverse(o => { if (o.userData?.placementId === id) node = o; });
    if (!node) { out.push({ id, missing: true }); continue; }
    node.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(node);
    const p = track.getById(id);
    out.push({ id, key: p.key, gx: p.gx, gz: p.gz, rot: p.rot, rotY: node.rotation.y,
      pos: [node.position.x, node.position.y, node.position.z],
      bbox: [box.min.x, box.max.x, box.min.z, box.max.z].map(v => Number.isFinite(v) ? +v.toFixed(1) : 'NaN') });
  }
  return out;
});
console.log(JSON.stringify(data, null, 2));
await b.close();
