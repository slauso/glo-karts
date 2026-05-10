// Per-segment screenshot audit for `*_walled` variants.
// Loads segments.js + segment-builder.js in a chromium page, builds a
// dedicated three.js scene with one segment, orbits the camera to a
// 3/4 view, and screenshots into screenshots/walled/<key>.png.
//
// Usage: vite must already be running on http://127.0.0.1:5174.
//        node scripts/walled-screenshot-audit.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const URL = 'http://127.0.0.1:5174/editor.html';
const OUT_DIR = resolve(process.cwd(), 'screenshots', 'walled');
await mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[c] ${m.text()}`); });

await page.goto(URL, { waitUntil: 'networkidle' });

// Build the standalone scene + capture every walled key as a PNG.
const keys = await page.evaluate(async () => {
  const THREE = await import('/node_modules/three/build/three.module.js');
  const segs = await import('/src/editor3/segments.js');
  const builder = await import('/src/editor3/segment-builder.js');
  const units = await import('/src/editor3/units.js');
  const S = units.WORLD_UNITS_PER_M;
  const TILE_W = segs.TILE * S;

  // Tear down editor canvas & install our own.
  for (const c of [...document.querySelectorAll('canvas')]) c.remove();
  const canvas = document.createElement('canvas');
  canvas.width = 800; canvas.height = 600;
  canvas.style.position = 'fixed'; canvas.style.inset = '0';
  canvas.style.zIndex = '9999';
  document.body.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(800, 600, false);
  renderer.setClearColor(0xdbe7f2);
  renderer.shadowMap.enabled = true;

  const scene = new THREE.Scene();
  // Ground plane grid for reference.
  const grid = new THREE.GridHelper(TILE_W * 12, 12, 0x9aaabb, 0xbecbd8);
  scene.add(grid);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const sun = new THREE.DirectionalLight(0xffffff, 0.95);
  sun.position.set(TILE_W * 4, TILE_W * 8, TILE_W * 5);
  sun.castShadow = true;
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(35, 800 / 600, 0.1, TILE_W * 80);

  const allKeys = Object.keys(segs.SEGMENTS).filter((k) => k.endsWith('_walled')).sort();
  window.__audit = { THREE, segs, builder, scene, camera, renderer, current: null, keys: allKeys, S };
  return allKeys;
});

console.log(`Found ${keys.length} walled variants`);

for (const key of keys) {
  const meta = await page.evaluate((k) => {
    const a = window.__audit;
    if (a.current) a.scene.remove(a.current);
    const g = a.builder.buildSegmentMesh(k);
    a.scene.add(g);
    a.current = g;
    // Compute bounds → frame the camera.
    const box = new a.THREE.Box3().setFromObject(g);
    const c = box.getCenter(new a.THREE.Vector3());
    const sz = box.getSize(new a.THREE.Vector3());
    const r = Math.max(sz.x, sz.y, sz.z);
    // 3/4 perspective: from +X +Y +Z direction, distance scaled by size.
    const d = r * 1.9;
    a.camera.position.set(c.x + d, c.y + d * 0.85, c.z + d);
    a.camera.lookAt(c);
    a.renderer.render(a.scene, a.camera);
    return { center: [c.x, c.y, c.z], size: [sz.x, sz.y, sz.z] };
  }, key);

  // Wait a tick for the GPU then snap.
  await page.waitForTimeout(60);
  const buf = await page.screenshot({ clip: { x: 0, y: 0, width: 800, height: 600 } });
  const path = resolve(OUT_DIR, `${key}.png`);
  await (await import('node:fs/promises')).writeFile(path, buf);
  console.log(`  ${key}  bbox=${meta.size.map((n) => n.toFixed(0)).join('×')}`);
}

await browser.close();
if (errors.length) {
  console.error('\nERRORS:');
  for (const e of errors) console.error('  ' + e);
  process.exit(1);
}
console.log(`\nWrote ${keys.length} screenshots to ${OUT_DIR}`);
