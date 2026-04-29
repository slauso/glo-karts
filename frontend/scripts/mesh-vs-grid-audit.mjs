// Visual mesh bbox vs grid claim audit. For every multi-cell segment at
// every rotation, render the placement mesh and verify the world-space
// bounding box stays within the claimed cells (with a small overhang
// tolerance for curbs / walls / roof eaves).
import { chromium } from '@playwright/test';

const URL_BASE = process.env.EDITOR_URL || 'http://localhost:5174/editor.html';
let b;
try { b = await chromium.connectOverCDP('http://127.0.0.1:9222'); }
catch { b = await chromium.launch({ headless: true }); }
const ctx = b.contexts()[0] ?? await b.newContext();
const p = await ctx.newPage();
await p.setViewportSize({ width: 1280, height: 800 });
await p.goto(URL_BASE, { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__studio?.track && !!window.__studio?.rebuildAll, null, { timeout: 15000 });

const out = await p.evaluate(() => {
  const { track, scene, THREE, rebuildAll, SEGMENT_KEYS } = window.__studio;
  const TILE = 12000;
  // Curb / wall / roof eaves are allowed to extend up to ~10% of a tile
  // beyond the claimed cells before we consider it a real misalignment.
  const TOL = TILE * 0.10;
  const results = [];
  for (const key of SEGMENT_KEYS) {
    if (key === 'spawn') continue;
    for (const rot of [0, 1, 2, 3]) {
      track.clear();
      const pl = track.place(key, 0, 0, rot);
      if (!pl) continue;
      rebuildAll();
      let mesh = null;
      scene.traverse(o => { if (o.userData?.placementId === pl.id && !mesh) mesh = o; });
      if (!mesh) { results.push({ key, rot, error: 'no mesh' }); continue; }
      const box = new THREE.Box3().setFromObject(mesh);
      const claimed = track.occupiedCells(key, 0, 0, rot);
      const claimXs = claimed.map(c => c[0]); const claimZs = claimed.map(c => c[1]);
      const cMinX = Math.min(...claimXs), cMaxX = Math.max(...claimXs);
      const cMinZ = Math.min(...claimZs), cMaxZ = Math.max(...claimZs);
      const allowMinX = (cMinX - 0.5) * TILE - TOL;
      const allowMaxX = (cMaxX + 0.5) * TILE + TOL;
      const allowMinZ = (cMinZ - 0.5) * TILE - TOL;
      const allowMaxZ = (cMaxZ + 0.5) * TILE + TOL;
      const okMinX = box.min.x >= allowMinX;
      const okMaxX = box.max.x <= allowMaxX;
      const okMinZ = box.min.z >= allowMinZ;
      const okMaxZ = box.max.z <= allowMaxZ;
      const match = okMinX && okMaxX && okMinZ && okMaxZ;
      results.push({
        key, rot,
        box: `x[${Math.round(box.min.x)},${Math.round(box.max.x)}] z[${Math.round(box.min.z)},${Math.round(box.max.z)}]`,
        overhang: {
          minX: Math.round(allowMinX - box.min.x),
          maxX: Math.round(box.max.x - allowMaxX),
          minZ: Math.round(allowMinZ - box.min.z),
          maxZ: Math.round(box.max.z - allowMaxZ),
        },
        match,
      });
    }
  }
  return results;
});

const fails = out.filter(r => !r.match || r.error);
for (const r of out) {
  if (r.error) console.log(`x ${r.key} rot=${r.rot} ERROR ${r.error}`);
  else if (!r.match) {
    const o = r.overhang;
    const bad = [];
    if (o.minX > 0) bad.push(`-X by ${o.minX}`);
    if (o.maxX > 0) bad.push(`+X by ${o.maxX}`);
    if (o.minZ > 0) bad.push(`-Z by ${o.minZ}`);
    if (o.maxZ > 0) bad.push(`+Z by ${o.maxZ}`);
    console.log(`FAIL ${r.key.padEnd(18)} rot=${r.rot} BBOX OUT OF GRID: ${bad.join(', ')}  bbox=${r.box}`);
  } else console.log(`ok   ${r.key.padEnd(18)} rot=${r.rot}`);
}
await b.close();
console.log(`\n${fails.length === 0 ? 'OK ALL ALIGNED (within 10% tile tolerance)' : `FAIL ${fails.length}/${out.length} mismatches`}`);
process.exit(fails.length === 0 ? 0 : 1);
