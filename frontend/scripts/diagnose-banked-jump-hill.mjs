// Headless render of banked_turn, jump_ramp, hill_complete in isolation so
// we can eyeball the geometry after the cleanup pass that:
//   - removed sweep / bend / chicane segments
//   - consolidated banked_turn{,R} into one 1×1 90° banked corner
//   - halved the rolling-hill peak height
//   - straightened the jump-ramp lip warning stripes
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.EDITOR_URL || 'http://localhost:5173/editor.html';
const OUT = path.resolve('dev-snapshots/banked-jump-hill-diag');
fs.mkdirSync(OUT, { recursive: true });

let browser;
try { browser = await chromium.connectOverCDP('http://127.0.0.1:9222'); }
catch { browser = await chromium.launch({ headless: true }); }
const ctx = browser.contexts()[0] ?? await browser.newContext();
const page = await ctx.newPage();
await page.setViewportSize({ width: 1600, height: 1000 });
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__studio, null, { timeout: 15000 });

const TILE_W = 12 * 1000;

async function shoot(name, layoutFn, camFn) {
  await page.evaluate(({ layoutSrc, camSrc }) => {
    const { track, rebuildAll, camera } = window.__studio;
    track.clear();
    // eslint-disable-next-line no-eval
    eval(layoutSrc);
    rebuildAll();
    // eslint-disable-next-line no-eval
    eval(camSrc);
  }, { layoutSrc: layoutFn, camSrc: camFn });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, name + '.png') });
}

// Banked turn between two straight runs
await shoot('banked-isolated',
  `track.place('straight', 0, 0);
   track.place('straight', 0, 1);
   track.place('banked_turn', 0, 2);
   track.place('straight', -1, 2, Math.PI / 2);
   track.place('straight', -2, 2, Math.PI / 2);`,
  `const TILE = 12000;
   camera.position.set(-1 * TILE, 1.6 * TILE, -0.5 * TILE);
   camera.lookAt(-0.5 * TILE, 0, 1.5 * TILE);`,
);

// Banked turn from below to confirm nothing floats
await shoot('banked-underside',
  `track.place('banked_turn', 0, 0);`,
  `const TILE = 12000;
   camera.position.set(1.2 * TILE, -0.4 * TILE, -1.0 * TILE);
   camera.lookAt(0, 0, 0);`,
);

// Rolling hill — side profile
await shoot('hill-side',
  `track.place('straight', 0, 0);
   track.place('hill_complete', 0, 1);
   track.place('straight', 0, 3);`,
  `const TILE = 12000;
   camera.position.set(2 * TILE, 0.7 * TILE, 1.5 * TILE);
   camera.lookAt(0, 0.3 * TILE, 1.5 * TILE);`,
);

// Jump ramp — overhead lip view (to confirm yellow stripes are straight)
await shoot('jump-lip-top',
  `track.place('jump_ramp', 0, 0);`,
  `const TILE = 12000;
   camera.position.set(0, 1.6 * TILE, 0.4 * TILE);
   camera.lookAt(0, 0, 0.4 * TILE);`,
);

await shoot('jump-side',
  `track.place('straight', 0, 0);
   track.place('jump_ramp', 0, 1);`,
  `const TILE = 12000;
   camera.position.set(1.6 * TILE, 0.5 * TILE, 0.5 * TILE);
   camera.lookAt(0, 0.2 * TILE, 0.5 * TILE);`,
);

await browser.close();
console.log('snapshots →', OUT);
