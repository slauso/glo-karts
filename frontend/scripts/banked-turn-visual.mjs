// Capture top-down + side views of the banked turn for visual verification.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.EDITOR_BASE || 'http://127.0.0.1:5173';
const OUT  = path.resolve('dev-snapshots/banked-physics');

const TRACK = {
  v: 1, name: 'Banked turn visual',
  placements: [
    { k: 'spawn',       x: 1, z: -1, r: 0 },
    { k: 'banked_turn', x: 0, z:  1, r: 0 },
    { k: 'finish',      x: -2, z: 2, r: 1 },
  ],
};

const code = Buffer.from(JSON.stringify(TRACK), 'utf8').toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const browser = await (async () => {
  try { return await chromium.connectOverCDP('http://127.0.0.1:9222'); }
  catch { return await chromium.launch({ headless: true }); }
})();
const page = (await browser.contexts())[0]?.pages()[0] ?? await browser.newPage();

await mkdir(OUT, { recursive: true });
await page.goto(`${BASE}/play.html?track=${code}&from=editor`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__play && !!window.__play.chassisBody, { timeout: 15000 });
await page.waitForTimeout(1000);

// Pause the game's render loop so our custom camera angle isn't
// overwritten by the chase cam every frame.
await page.evaluate(() => {
  // Try common pause hooks; fall back to canceling RAF so render stops.
  if (window.__play.physicsBridge?.setPaused) window.__play.physicsBridge.setPaused(true);
  // Hide the kart so it doesn't obstruct the bowl.
  if (window.__play.scene && window.__play.chassisBody) {
    window.__play.chassisBody.position.x = 500000;
    window.__play.chassisBody.position.z = 500000;
    window.__play.chassisBody.interpolatedPosition.x = 500000;
    window.__play.chassisBody.interpolatedPosition.z = 500000;
  }
});
await page.waitForTimeout(300);

const shots = [
  { name: 'qp-top',   eye: [18000, 110000, 54000], target: [18000, 0, 54000] },
  { name: 'qp-iso',   eye: [80000, 50000, -20000], target: [0, 0, 60000] },
  { name: 'qp-front', eye: [40000, 12000, -30000], target: [-10000, 8000, 60000] },
];
for (const s of shots) {
  await page.evaluate(({ eye, target }) => {
    const c = window.__play.camera;
    c.position.set(eye[0], eye[1], eye[2]);
    c.lookAt(target[0], target[1], target[2]);
    c.updateProjectionMatrix();
    // Render multiple frames to outrun chase-cam overwriting.
    for (let i = 0; i < 3; i++) {
      window.__play.renderer.render(window.__play.scene, c);
    }
  }, s);
  await page.waitForTimeout(50);
  // One more render right before the screenshot
  await page.evaluate(({ eye, target }) => {
    const c = window.__play.camera;
    c.position.set(eye[0], eye[1], eye[2]);
    c.lookAt(target[0], target[1], target[2]);
    window.__play.renderer.render(window.__play.scene, c);
  }, s);
  await page.screenshot({ path: path.join(OUT, `${s.name}.png`), fullPage: false });
  console.log(`wrote ${s.name}.png`);
}
await browser.close();
