/**
 * tinkercad-mirror.mjs — connect to user-launched Chrome via CDP, capture
 * a screenshot of the live Tinkercad editor, capture a screenshot of our
 * Track Studio at http://localhost:5173/editor.html, then write them
 * side-by-side as PNG into frontend/dev-snapshots/parity-<ts>.png.
 *
 * Prerequisites:
 *   1. Run scripts/tinkercad-launch-cdp.ps1 (one time per reboot).
 *   2. Log into Tinkercad in the spawned Chrome window.
 *   3. Open a 3D design (any). Leave that tab focused.
 *   4. Run vite at http://127.0.0.1:5173.
 *
 * Run:  node scripts/tinkercad-mirror.mjs
 *       node scripts/tinkercad-mirror.mjs --watch        (loop every 5s)
 *       node scripts/tinkercad-mirror.mjs --tc-only      (only Tinkercad)
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_FRONTEND = join(__dirname, '..');
const OUT_DIR = join(REPO_FRONTEND, 'dev-snapshots');
const CDP_URL = 'http://127.0.0.1:9222';
const STUDIO_URL = 'http://127.0.0.1:5173/editor.html';

const args = new Set(process.argv.slice(2));
const WATCH = args.has('--watch');
const TC_ONLY = args.has('--tc-only');

async function findTinkercadPage(browser) {
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      const url = p.url();
      if (url.includes('tinkercad.com')) return p;
    }
  }
  return null;
}

async function captureTinkercad(browser) {
  let tc = await findTinkercadPage(browser);
  if (!tc) {
    // Open dashboard in a new tab so the user can navigate from there.
    const ctx = browser.contexts()[0] || (await browser.newContext());
    tc = await ctx.newPage();
    await tc.goto('https://www.tinkercad.com/dashboard', { waitUntil: 'domcontentloaded' });
    console.log('[mirror] No Tinkercad tab was open — navigated to dashboard. Log in & open a design, then re-run.');
    return null;
  }
  if (tc.url().includes('login') || tc.url().includes('autodesk')) {
    console.log('[mirror] Tinkercad tab is on a login page. Sign in, then re-run.');
    console.log('         Current URL:', tc.url());
    return null;
  }
  // Wait briefly for canvas to settle.
  await tc.waitForTimeout(300);
  const buf = await tc.screenshot({ fullPage: false, type: 'png' });
  return { buf, url: tc.url() };
}

async function captureStudio() {
  // Use an ephemeral browser for the studio so we don't pollute CDP.
  const b = await chromium.launch({ headless: true });
  try {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const ok = await page.goto(STUDIO_URL, { waitUntil: 'domcontentloaded' }).catch(() => null);
    if (!ok) {
      console.log('[mirror] Track Studio not reachable at', STUDIO_URL);
      return null;
    }
    await page.waitForTimeout(800);
    const buf = await page.screenshot({ fullPage: false, type: 'png' });
    return { buf, url: STUDIO_URL };
  } finally {
    await b.close();
  }
}

async function makeSideBySide(leftBuf, rightBuf, outPath) {
  // Lazy-load sharp; fall back to writing two files if unavailable.
  let sharp;
  try { sharp = (await import('sharp')).default; }
  catch { sharp = null; }
  if (!sharp) {
    const a = outPath.replace(/\.png$/, '-tinkercad.png');
    const b = outPath.replace(/\.png$/, '-studio.png');
    await writeFile(a, leftBuf);
    if (rightBuf) await writeFile(b, rightBuf);
    return { sideBySide: false, files: [a, rightBuf ? b : null].filter(Boolean) };
  }
  const meta = await sharp(leftBuf).metadata();
  const H = meta.height;
  const left = sharp(leftBuf).resize({ height: H });
  const right = rightBuf ? sharp(rightBuf).resize({ height: H }) : null;
  const lBuf = await left.toBuffer();
  const lMeta = await sharp(lBuf).metadata();
  let rBuf = null, rMeta = null;
  if (right) {
    rBuf = await right.toBuffer();
    rMeta = await sharp(rBuf).metadata();
  }
  const totalW = lMeta.width + (rMeta?.width || 0) + 4;
  await sharp({ create: { width: totalW, height: H, channels: 3, background: { r: 32, g: 32, b: 32 } } })
    .composite([
      { input: lBuf, left: 0, top: 0 },
      ...(rBuf ? [{ input: rBuf, left: lMeta.width + 4, top: 0 }] : []),
    ])
    .png()
    .toFile(outPath);
  return { sideBySide: true, files: [outPath] };
}

async function runOnce(browser) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const tc = await captureTinkercad(browser);
  if (!tc) return;
  const studio = TC_ONLY ? null : await captureStudio();
  if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true });
  const out = join(OUT_DIR, `parity-${ts}.png`);
  const result = await makeSideBySide(tc.buf, studio?.buf, out);
  console.log('[mirror]', result.sideBySide ? 'wrote side-by-side' : 'wrote split', '→', result.files.join(', '));
  console.log('[mirror] tc =', tc.url, studio ? `| studio = ${studio.url}` : '');
}

async function main() {
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
  } catch (err) {
    console.error('[mirror] Could not connect to Chrome at', CDP_URL);
    console.error('         Run: pwsh -File scripts/tinkercad-launch-cdp.ps1');
    console.error('         Then keep that window open.');
    process.exit(1);
  }
  console.log('[mirror] Connected to Chrome via CDP.');

  if (!WATCH) {
    await runOnce(browser);
    await browser.close().catch(() => {});  // CDP close just detaches.
    return;
  }
  console.log('[mirror] Watch mode — capturing every 5s. Ctrl+C to stop.');
  process.on('SIGINT', () => { console.log('\n[mirror] Stopped.'); process.exit(0); });
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try { await runOnce(browser); }
    catch (e) { console.error('[mirror] capture failed:', e.message); }
    await new Promise(r => setTimeout(r, 5000));
  }
}

main().catch(err => { console.error(err); process.exit(1); });
