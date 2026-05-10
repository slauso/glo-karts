// Burnout-streak GLO-color verification probe.
//
// 1. Set sessionStorage gloColor to a distinctive cyan (#00ffff) so
//    yellow drift contamination shows up cleanly in pixel sampling.
// 2. Open editor.html, build a 5-cell straight, click Play.
// 3. Hold Space + W for HOLD_MS to charge a stationary burnout.
// 4. Take screenshots at three checkpoints during the hold and one
//    final shot after release.
// 5. After release, read pixels from the lower half of the canvas,
//    classify the dominant bright-pixel hue, and PASS only if it
//    matches the test GLO (high B + G, low R for cyan).
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';
const HEADLESS = process.env.HEADLESS !== 'false';
const REPORT_DIR = join(__dirname, '..', 'playwright-report', 'burnout-streak-color');
const HOLD_MS = Number(process.env.HOLD_MS || 3500);
const TEST_GLO_COLOR = process.env.GLO_COLOR || '#00ffff';
const TEST_GLO_EFFECT = process.env.GLO_EFFECT || 'solid';

function classifyHue(r, g, b) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  if (max < 0.04) return 'black';
  if (rn > 0.55 && gn > 0.45 && bn < Math.min(rn, gn) * 0.55) return 'yellow';
  if (rn > 0.75 && gn > 0.75 && bn > 0.75) return 'white';
  // Cyan match for the default test colour: B and G dominate, R subdued.
  if (bn > 0.45 && gn > 0.35 && rn < bn * 0.7) return 'glo';
  return 'mixed';
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  const browser = await chromium.launch({
    headless: HEADLESS,
    args: [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('pageerror', (err) => console.error('[pageerror]', err.message));
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error') console.error(`[console:${t}]`, m.text());
  });

  try {
    await page.goto(`${BASE_URL}/editor.html`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForFunction(() => !!window.__studio?.track && !!window.__studio?.renderer, null, { timeout: 30000 });

    await page.evaluate(({ color, effect }) => {
      sessionStorage.setItem('gloColor', color);
      sessionStorage.setItem('gloEffect', effect);
    }, { color: TEST_GLO_COLOR, effect: TEST_GLO_EFFECT });

    await page.evaluate(() => {
      const t = window.__studio.track;
      t.clear();
      t.place('spawn', 0, 0, 0);
      for (let z = 1; z < 5; z++) t.place('straight', 0, z, 0);
      window.__studio.rebuildAll();
    });
    const sanity = await page.evaluate(() => ({
      btn: !!document.getElementById('playBtn'),
      placements: window.__studio?.track?.placements?.size ?? -1,
      hasSpawn: !!window.__studio?.track?.spawn?.(),
    }));
    console.log('[probe] pre-click sanity:', sanity);

    try {
      await Promise.all([
        page.waitForURL(/\/play\.html/, { timeout: 30000 }),
        page.evaluate(() => document.getElementById('playBtn').click()),
      ]);
    } catch (err) {
      console.error('[probe] navigation failed; current URL =', page.url());
      const code = await page.evaluate(() => sessionStorage.getItem('gloKartsStudio.playtest'));
      if (code) {
        await page.goto(`${BASE_URL}/play.html?track=${code}&from=editor`, { waitUntil: 'load', timeout: 30000 });
      } else {
        throw err;
      }
    }
    await page.waitForFunction(() => !!window.__play?.chassisBody && !!window.__play?.renderer && !!window.__play?.gloSkidMat, null, { timeout: 30000 });
    await page.bringToFront();
    await page.evaluate(() => { try { window.focus(); } catch {} });
    await page.waitForTimeout(1500);

    const initial = await page.evaluate(() => {
      const ug = window.__play?.underglow;
      const c = ug?.currentColor;
      return c ? { r: c.r, g: c.g, b: c.b } : null;
    });
    console.log('[probe] underglow.currentColor at t=0:', initial);

    await page.keyboard.down('Space');
    await page.keyboard.down('KeyW');

    const samples = [];
    const screenshots = [];
    const startedAt = Date.now();
    const checkpoints = [HOLD_MS * 0.30, HOLD_MS * 0.65, HOLD_MS * 0.95];
    let nextCheckpoint = 0;
    while (Date.now() - startedAt < HOLD_MS) {
      await page.waitForTimeout(250);
      const elapsed = Date.now() - startedAt;
      const sample = await page.evaluate(() => {
        const out = { ts: performance.now() };
        const ug = window.__play?.underglow;
        if (ug?.currentColor) out.uColor = { r: ug.currentColor.r, g: ug.currentColor.g, b: ug.currentColor.b };
        const mat = window.__play?.gloSkidMat;
        if (mat) out.matUColor = { r: mat.uniforms.uColor.value.r, g: mat.uniforms.uColor.value.g, b: mat.uniforms.uColor.value.b };
        const mesh = window.__play?.gloSkidMesh;
        if (mesh?.geometry?.drawRange) out.drawRange = { start: mesh.geometry.drawRange.start, count: mesh.geometry.drawRange.count };
        return out;
      });
      samples.push(sample);
      if (nextCheckpoint < checkpoints.length && elapsed >= checkpoints[nextCheckpoint]) {
        const shotPath = join(REPORT_DIR, `frame_${String(nextCheckpoint).padStart(2, '0')}_${Math.round(elapsed)}ms.png`);
        await page.screenshot({ path: shotPath });
        screenshots.push(shotPath);
        nextCheckpoint++;
      }
    }

    await page.keyboard.up('KeyW');
    await page.keyboard.up('Space');

    await page.waitForTimeout(400);
    const finalShot = join(REPORT_DIR, 'frame_final.png');
    await page.screenshot({ path: finalShot });
    screenshots.push(finalShot);

    const pixelVerdict = await page.evaluate(() => {
      const renderer = window.__play?.renderer;
      const canvas = renderer?.domElement;
      if (!canvas) return null;
      const w = canvas.width, h = canvas.height;
      const sw = Math.min(w, 800);
      const sh = Math.min(h, 320);
      const sx = Math.floor(w * 0.5 - sw / 2);
      const sy = Math.floor(h * 0.55);
      const gl = renderer.getContext();
      const buf = new Uint8Array(sw * sh * 4);
      gl.readPixels(sx, h - sy - sh, sw, sh, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let sumR = 0, sumG = 0, sumB = 0, brightCount = 0;
      let maxR = 0, maxG = 0, maxB = 0, maxL = 0;
      for (let p = 0; p < sw * sh; p++) {
        const r = buf[p * 4], g = buf[p * 4 + 1], b = buf[p * 4 + 2];
        const l = Math.max(r, g, b);
        if (l > maxL) { maxL = l; maxR = r; maxG = g; maxB = b; }
        if (l > 80) { sumR += r; sumG += g; sumB += b; brightCount++; }
      }
      return {
        brightAvg: brightCount > 0 ? { r: Math.round(sumR / brightCount), g: Math.round(sumG / brightCount), b: Math.round(sumB / brightCount), n: brightCount } : null,
        brightest: { r: maxR, g: maxG, b: maxB },
      };
    });

    const klass = pixelVerdict?.brightAvg
      ? classifyHue(pixelVerdict.brightAvg.r, pixelVerdict.brightAvg.g, pixelVerdict.brightAvg.b)
      : 'no-bright-pixels';
    const verdict = klass === 'glo'
      ? 'PASS \u2014 GLO colour dominates the streak'
      : `FAIL \u2014 streak class = ${klass} (avg=${JSON.stringify(pixelVerdict?.brightAvg)})`;

    const report = {
      baseUrl: BASE_URL,
      testGloColor: TEST_GLO_COLOR,
      testGloEffect: TEST_GLO_EFFECT,
      holdMs: HOLD_MS,
      pixelVerdict,
      verdict,
      samples,
      screenshots,
    };
    const reportPath = join(REPORT_DIR, 'report.json');
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log('[probe] verdict:', verdict);
    console.log('[probe] pixel data:', pixelVerdict);
    console.log('[probe] report written to', reportPath);

    if (verdict.startsWith('FAIL')) process.exitCode = 1;
  } finally {
    await ctx.close();
    await browser.close();
  }
}

main().catch((err) => { console.error(err); process.exit(2); });
