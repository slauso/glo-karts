/**
 * bridge-traversal-probe.mjs — high-frequency telemetry over a
 * bridge_onramp → bridge → bridge_offramp chain. Measures:
 *   - chassis Y trajectory (smoothness)
 *   - vertical velocity vy (oscillation, airborne periods)
 *   - grounded count per sample (4 = all wheels in contact)
 *   - suspension lengths per wheel (compression / extension)
 *   - chassis pitch
 *   - "bounce events": >50ms with grounded < 2 OR vy spike > 4 m/s
 *
 * Usage: node scripts/bridge-traversal-probe.mjs
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.PLAY_BASE || 'http://localhost:5173';
const OUT = path.resolve('dev-snapshots/bridge-probe');

function buildTrack() {
  // Long approach so the kart hits ~top speed before the ramp,
  // bridge_onramp (6 cells) → bridge (2 cells) → bridge_offramp (6 cells),
  // then a long runout. NOTE: bridge ramps span BRIDGE_RAMP_CELLS=6.
  const RAMP = 6;
  const placements = [];
  let z = 0;
  placements.push({ k: 'spawn',           x: 0, z: z++, r: 0 });
  for (let i = 0; i < 6; i++) placements.push({ k: 'straight', x: 0, z: z++, r: 0 });
  placements.push({ k: 'bridge_onramp',   x: 0, z, r: 0 }); z += RAMP;
  placements.push({ k: 'bridge',          x: 0, z, r: 0 }); z += 2;
  placements.push({ k: 'bridge_offramp',  x: 0, z, r: 0 }); z += RAMP;
  for (let i = 0; i < 4; i++) placements.push({ k: 'straight', x: 0, z: z++, r: 0 });
  placements.push({ k: 'finish', x: 0, z: z++, r: 0 });
  return { v: 1, name: 'Bridge Traversal Probe', placements };
}

function encodeTrack(json) {
  return Buffer.from(JSON.stringify(json), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const track = buildTrack();
  const url = `${BASE}/play.html?track=${encodeTrack(track)}&from=editor`;
  page.on('pageerror', (e) => console.error('PAGEERR', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('CONSOLE-ERR', m.text()); });

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__play && !!window.__play.chassisBody && !!window.__play.vehicle, { timeout: 20000 });
  await page.waitForTimeout(800); // let physics settle

  const spawn = await page.evaluate(() => {
    const p = window.__play.chassisBody.position;
    return { x: p.x, y: p.y, z: p.z };
  });
  console.log(`spawn: x=${spawn.x.toFixed(0)} y=${spawn.y.toFixed(0)} z=${spawn.z.toFixed(0)} mm`);

  // Hold ArrowUp for ~24 seconds, sampling at 30 Hz.
  await page.evaluate(() => {
    const ev = new KeyboardEvent('keydown', { code: 'ArrowUp', key: 'ArrowUp', bubbles: true });
    window.dispatchEvent(ev);
  });

  const samples = [];
  const TICKS = 720;          // 720 * 33ms ≈ 24 s — track grew when BRIDGE_RAMP_CELLS bumped 4→6
  const TICK_MS = 33;
  // 24-cell track; finish triggers nav. Stop sampling once kart passes
  // cell 22 to keep the page alive.
  const STOP_Z = spawn.z + 22 * 36 * 1000;
  for (let i = 0; i < TICKS; i++) {
    let s;
    try {
      s = await page.evaluate(() => {
        if (!window.__play || !window.__play.chassisBody) return null;
        const p = window.__play.chassisBody.position;
        const v = window.__play.chassisBody.velocity;
        const q = window.__play.chassisBody.quaternion;
        const wheels = window.__play.vehicle.wheelInfos;
        const wheelData = [];
        let grounded = 0;
        for (let j = 0; j < wheels.length; j++) {
          const wi = wheels[j];
          const inContact = !!wi.isInContact;
          if (inContact) grounded++;
          wheelData.push({
            inContact,
            sus: Number.isFinite(wi.suspensionLength) ? wi.suspensionLength : 0,
          });
        }
        const x = q.x, y = q.y, z = q.z, w = q.w;
        const fwd = {
          x: 2*(x*z + w*y),
          y: 2*(y*z - w*x),
          z: 1 - 2*(x*x + y*y),
        };
        const pitch = Math.asin(Math.max(-1, Math.min(1, fwd.y)));
        const ev = new KeyboardEvent('keydown', { code: 'ArrowUp', key: 'ArrowUp', bubbles: true });
        window.dispatchEvent(ev);
        return { px: p.x, py: p.y, pz: p.z, vx: v.x, vy: v.y, vz: v.z, pitch, grounded, wheels: wheelData };
      });
    } catch (err) {
      console.log(`sample ${i}: page navigated (likely finish triggered) — stopping early`);
      break;
    }
    if (!s) { console.log(`sample ${i}: __play unavailable — stopping`); break; }
    samples.push({ t: i * TICK_MS, ...s });
    if (s.pz >= STOP_Z) { console.log(`sample ${i}: reached stop-z (${(s.pz/1000).toFixed(1)} m) — done`); break; }
    await page.waitForTimeout(TICK_MS);
  }
  try {
    await page.evaluate(() => {
      const ev = new KeyboardEvent('keyup', { code: 'ArrowUp', key: 'ArrowUp', bubbles: true });
      window.dispatchEvent(ev);
    });
  } catch { /* page may already be navigating */ }

  // Snapshot mid-bridge for inspection
  try { await page.screenshot({ path: path.join(OUT, 'bridge.png'), fullPage: false }); } catch { /* page navigated */ }

  // ── Analysis ──────────────────────────────────────────────
  // Convert mm → m for readability in printout.
  const M = 1000;
  const TILE_MM = 36 * M;
  // Identify segment phases by chassis Z (relative to spawn).
  // BRIDGE_RAMP_CELLS=6, deck span=2, with 6-cell approach. Layout:
  //   approach: 0..6 cells
  //   onramp:   6..12
  //   deck:    12..14
  //   offramp: 14..20
  //   runout:  20..24
  function phase(zRel) {
    const cell = zRel / TILE_MM;
    if (cell < 6) return 'approach';
    if (cell < 12) return 'onramp';
    if (cell < 14) return 'deck';
    if (cell < 20) return 'offramp';
    return 'runout';
  }

  let bounceEvents = 0;
  let airborneFrames = 0;
  let allFourCount = 0;
  const phaseStats = {};
  const ensure = (k) => phaseStats[k] || (phaseStats[k] = { n: 0, vyMin: Infinity, vyMax: -Infinity, yMin: Infinity, yMax: -Infinity, sumGrounded: 0, airborne: 0, vyAbsSum: 0 });

  for (let i = 1; i < samples.length; i++) {
    const s = samples[i];
    const ph = phase(s.pz - spawn.z);
    const ps = ensure(ph);
    ps.n++;
    ps.vyMin = Math.min(ps.vyMin, s.vy);
    ps.vyMax = Math.max(ps.vyMax, s.vy);
    ps.yMin = Math.min(ps.yMin, s.py);
    ps.yMax = Math.max(ps.yMax, s.py);
    ps.sumGrounded += s.grounded;
    ps.vyAbsSum += Math.abs(s.vy);
    if (s.grounded < 2) { ps.airborne++; airborneFrames++; }
    if (s.grounded === 4) allFourCount++;
    // Bounce event: |vy| spike > 4 m/s = 4000 mm/s while supposedly grounded
    if (Math.abs(s.vy) > 4 * M && s.grounded > 0) bounceEvents++;
  }

  console.log('\n──── PHASE STATS (mm units, divide /1000 for m) ────');
  console.log('phase     | n   | y range          | vy range         | mean grounded | airborne frames | mean |vy|');
  for (const ph of ['approach', 'onramp', 'deck', 'offramp', 'runout']) {
    const s = phaseStats[ph]; if (!s) continue;
    const meanGrounded = (s.sumGrounded / s.n).toFixed(2);
    const meanVyAbs = (s.vyAbsSum / s.n / M).toFixed(2);
    console.log(`${ph.padEnd(9)} | ${String(s.n).padStart(3)} | ${(s.yMin/M).toFixed(2).padStart(6)} → ${(s.yMax/M).toFixed(2).padStart(6)} m | ${(s.vyMin/M).toFixed(2).padStart(6)} → ${(s.vyMax/M).toFixed(2).padStart(6)} m/s | ${meanGrounded.padStart(13)} | ${String(s.airborne).padStart(15)} | ${meanVyAbs.padStart(8)} m/s`);
  }
  console.log(`\nTotal samples: ${samples.length}`);
  console.log(`All-four-grounded frames: ${allFourCount} (${(100*allFourCount/samples.length).toFixed(1)}%)`);
  console.log(`Airborne (grounded<2) frames: ${airborneFrames}`);
  console.log(`Bounce events (|vy|>4 m/s while grounded): ${bounceEvents}`);
  console.log(`Final position (mm): x=${samples[samples.length-1].px.toFixed(0)} y=${samples[samples.length-1].py.toFixed(0)} z=${samples[samples.length-1].pz.toFixed(0)}`);
  console.log(`Distance traveled along Z: ${((samples[samples.length-1].pz - spawn.z)/M).toFixed(1)} m (track length ≈ ${24*36} m, expected exit z ≈ ${20*36} m)`);

  await writeFile(path.join(OUT, 'samples.json'), JSON.stringify({ spawn, samples }, null, 2));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
