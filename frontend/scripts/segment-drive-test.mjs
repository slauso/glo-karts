/**
 * segment-drive-test.mjs — drive each forward-traversable segment in
 * the playtest scene, hold W for ~6s, and confirm the kart traverses it.
 *
 * For elevated/inclined segments (bridge / plateau / hill / ramps) we also
 * verify the kart didn't fall through (final Y stays sane).
 */

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = 'http://127.0.0.1:5173';
const OUT = path.resolve('dev-snapshots/seg-drive');

// segment-key → { spanZ, comboIntro?, comboOutro?, expectMinDeltaZ, requireYAbove }
//
// comboIntro/Outro lets us pad a segment with on/off ramps so the kart can
// reach an elevated deck (otherwise it would stop at the riser).
const TESTS = [
  { key: 'straight',       spanZ: 1 },
  { key: 'straight2',      spanZ: 2 },
  { key: 'ramp_up',        spanZ: 2, requireYAbove: 4 },
  { key: 'ramp_down',      spanZ: 2, comboIntro: 'ramp_up' }, // approach from a high deck
  { key: 'plateau',        spanZ: 1, comboIntro: 'ramp_up', comboOutro: 'ramp_down', requireYAbove: 4 },
  { key: 'bump_up',        spanZ: 1 },
  { key: 'hill_complete',  spanZ: 2 },
  { key: 'jump_ramp',      spanZ: 1 },
  { key: 'bridge',         spanZ: 2, comboIntro: 'bridge_onramp', comboOutro: 'bridge_offramp', requireYAbove: 4 },
  { key: 'bridge_onramp',  spanZ: 2, requireYAbove: 4 },
  { key: 'bridge_offramp', spanZ: 2, comboIntro: 'bridge_onramp' },
  { key: 'tunnel',         spanZ: 2 },
  { key: 'finish',         spanZ: 1 },
];

function spanOf(k) {
  const entry = TESTS.find(t => t.key === k);
  if (entry) return entry.spanZ;
  // fallbacks for intro/outro pieces
  if (k === 'straight') return 1;
  if (k === 'ramp_up' || k === 'ramp_down' || k === 'bridge_onramp' || k === 'bridge_offramp') return 2;
  return 1;
}

function buildTrackJSON(test) {
  const placements = [];
  let gz = 0;
  // Spawn
  placements.push({ k: 'spawn', x: 0, z: gz, r: 0 });
  gz += 1;
  // Straight runway so the kart hits speed
  placements.push({ k: 'straight2', x: 0, z: gz, r: 0 });
  gz += 2;
  // Optional intro
  if (test.comboIntro) {
    placements.push({ k: test.comboIntro, x: 0, z: gz, r: 0 });
    gz += spanOf(test.comboIntro);
  }
  // Segment under test
  placements.push({ k: test.key, x: 0, z: gz, r: 0 });
  gz += test.spanZ;
  // Optional outro
  if (test.comboOutro) {
    placements.push({ k: test.comboOutro, x: 0, z: gz, r: 0 });
    gz += spanOf(test.comboOutro);
  }
  // Outgoing straight + finish
  placements.push({ k: 'straight2', x: 0, z: gz, r: 0 });
  gz += 2;
  placements.push({ k: 'finish', x: 0, z: gz, r: 0 });
  return { v: 1, name: `Drive: ${test.key}`, placements };
}

function encodeTrack(json) {
  const s = JSON.stringify(json);
  return Buffer.from(s, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getBrowser() {
  try {
    return await chromium.connectOverCDP('http://127.0.0.1:9222');
  } catch {
    return await chromium.launch({ headless: true });
  }
}

async function driveOne(browser, test) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await context.newPage();
  const trackJSON = buildTrackJSON(test);
  const code = encodeTrack(trackJSON);
  const url = `${BASE}/play.html?track=${code}&from=editor`;
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`console: ${m.text()}`); });
  await page.goto(url, { waitUntil: 'load' });
  // Wait for play scene to construct __play
  await page.waitForFunction(() => !!window.__play && !!window.__play.chassisBody, { timeout: 10000 });
  // Capture spawn position
  const spawn = await page.evaluate(() => {
    const p = window.__play.chassisBody.position;
    return { x: p.x, y: p.y, z: p.z };
  });
  // Brief warmup so the physics world settles & the kart drops onto the deck
  await page.waitForTimeout(800);
  // Hold ArrowUp via dispatched events. The kart input listener is on
  // window with `e.code` checks, so synthesised KeyboardEvents work.
  // Dispatch every loop iteration so a missed event can't stall the test.
  const samples = [];
  for (let i = 0; i < 7; i++) {
    await page.evaluate(() => {
      const ev = new KeyboardEvent('keydown', { code: 'ArrowUp', key: 'ArrowUp', bubbles: true });
      window.dispatchEvent(ev);
    });
    await page.waitForTimeout(1000);
    const p = await page.evaluate(() => {
      const c = window.__play.chassisBody.position;
      const v = window.__play.chassisBody.velocity;
      return { x: c.x, y: c.y, z: c.z, vz: v.z, vx: v.x };
    });
    samples.push(p);
  }
  // Release key
  await page.evaluate(() => {
    const ev = new KeyboardEvent('keyup', { code: 'ArrowUp', key: 'ArrowUp', bubbles: true });
    window.dispatchEvent(ev);
  });
  // Mid-drive screenshot (last sample state)
  await page.screenshot({ path: path.join(OUT, `${test.key}.png`), fullPage: false });
  const final = samples[samples.length - 1];
  const dz = final.z - spawn.z;
  const yMin = Math.min(...samples.map(s => s.y));
  // Pass criteria: kart traversed at least the segment's nominal length (TILE * spanZ * 0.6)
  // and never fell beneath -2 (well below the ground plane).
  const TILE = 12;
  const minDz = TILE * test.spanZ * 0.6;
  const yFloor = -2;
  const yCheck = test.requireYAbove != null ? final.y > test.requireYAbove * 0.5 : true;
  const ok = dz >= minDz && yMin > yFloor && yCheck && errs.length === 0;
  await context.close();
  return { key: test.key, ok, spawn, final, dz, yMin, samples, errs };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await getBrowser();
  const results = [];
  for (const t of TESTS) {
    process.stdout.write(`[drive] ${t.key.padEnd(18)} `);
    let r;
    try {
      r = await driveOne(browser, t);
    } catch (err) {
      r = { key: t.key, ok: false, err: err.message };
    }
    results.push(r);
    if (r.ok) {
      console.log(`OK   dz=${r.dz.toFixed(1)}  yFinal=${r.final?.y?.toFixed(2)}`);
    } else {
      console.log(`FAIL ${r.err || ''} dz=${r.dz?.toFixed?.(1)} yMin=${r.yMin?.toFixed?.(2)} errs=${r.errs?.length || 0}`);
      if (r.errs?.length) console.log('       ' + r.errs.slice(0, 3).join('\n       '));
    }
  }
  await writeFile(path.join(OUT, 'report.json'), JSON.stringify(results, null, 2));
  const failed = results.filter(r => !r.ok);
  console.log(`\n[done] ${results.length - failed.length}/${results.length} segments passed`);
  if (failed.length) {
    console.log('FAILED:', failed.map(f => f.key).join(', '));
    process.exitCode = 1;
  }
  await browser.close().catch(() => {});
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
