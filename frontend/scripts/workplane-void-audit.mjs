// Zoom into the workplane via OrbitControls and capture frames at multiple
// zoom levels to surface any white-void / clipping artifact on screen.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const CDP = 'http://127.0.0.1:9222';
const OUT = path.resolve('dev-snapshots');
await fs.mkdir(OUT, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

let browser, ctx, ownsBrowser = false;
try {
  browser = await chromium.connectOverCDP(CDP);
  ctx = browser.contexts()[0];
  console.log('[audit] using CDP Chrome');
} catch (e) {
  console.log('[audit] CDP unavailable, launching headless Chromium');
  browser = await chromium.launch();
  ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  ownsBrowser = true;
}
let page = ctx.pages().find(p => p.url().includes('127.0.0.1:5173/editor.html'));
if (!page) {
  page = await ctx.newPage();
  await page.goto('http://127.0.0.1:5173/editor.html');
}
await page.bringToFront();
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1500);

// Probe: snapshot scene background, ground material color, plate size,
// camera near/far/distance, and renderer clearColor at several zoom levels.
async function probe(label) {
  return await page.evaluate((lbl) => {
    const s = window.__studio;
    if (!s) return { label: lbl, err: 'no __studio' };
    const cam = s.camera;
    // walk scene for plate, ground, fineGrid, majorGrid
    const named = {};
    s.scene.traverse(o => {
      if (o.name) named[o.name] = o;
      if (o.isMesh && o.geometry?.parameters?.width && !o.name) {
        named['plane_w' + Math.round(o.geometry.parameters.width)] = o;
      }
    });
    const r = s.renderer;
    let clearHex = null;
    try {
      const C = (window.THREE && window.THREE.Color) || (s.THREE && s.THREE.Color);
      if (C && r.getClearColor) clearHex = '#' + r.getClearColor(new C()).getHexString();
    } catch {}
    return {
      label: lbl,
      bg: s.scene.background ? '#' + s.scene.background.getHexString() : null,
      fog: s.scene.fog ? { color: '#' + s.scene.fog.color.getHexString(), near: s.scene.fog.near, far: s.scene.fog.far } : null,
      clearHex,
      cam: {
        pos: cam.position.toArray().map(x => Math.round(x)),
        target: window.__studio.scene.userData?.controlsTarget || null,
        near: cam.near, far: cam.far, fov: cam.fov,
        distFromOrigin: Math.round(cam.position.length()),
      },
      ground: named.ground ? {
        color: '#' + named.ground.material.color.getHexString(),
        size: named.ground.geometry.parameters,
        y: named.ground.position.y,
      } : null,
      plate: named['workplane-plate'] ? {
        color: '#' + named['workplane-plate'].material.color.getHexString(),
        size: named['workplane-plate'].geometry.parameters,
        y: named['workplane-plate'].position.y,
      } : null,
      canvasSize: { w: r.domElement.width, h: r.domElement.height, cssH: r.domElement.clientHeight },
    };
  }, label);
}

// Apply zoom/orbit programmatically via OrbitControls dollyIn/Out then update.
async function setCameraDist(distMul) {
  await page.evaluate((mul) => {
    const s = window.__studio;
    const TILE = 12000;
    s.camera.position.set(TILE * mul, TILE * mul, TILE * mul);
    s.camera.lookAt(0, 0, 0);
  }, distMul);
  await page.waitForTimeout(150);
}

async function shot(name) {
  const p = path.join(OUT, `void-audit-${ts}-${name}.png`);
  await page.screenshot({ path: p });
  console.log('[shot]', name, '->', p);
  return p;
}

// 1. Default zoom
const p0 = await probe('default'); console.log(JSON.stringify(p0, null, 2));
await shot('01-default');
// 2. Zoom in 50% closer
await setCameraDist(1.8); const p1 = await probe('1.8x'); console.log(JSON.stringify(p1, null, 2));
await shot('02-zoomin');
// 3. Very close
await setCameraDist(0.6); const p2 = await probe('0.6x'); console.log(JSON.stringify(p2, null, 2));
await shot('03-veryclose');
// 4. Way out
await setCameraDist(8); const p3 = await probe('8x'); console.log(JSON.stringify(p3, null, 2));
await shot('04-far');

await browser.close();
console.log('\n[done] check shots in', OUT);
