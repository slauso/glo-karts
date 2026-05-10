/**
 * simulate-perf-audit.spec.mjs — Measures the editor3 playtest runtime
 * end-to-end and prints a perf report. Always passes; the artefact is
 * the console output (frame-time histogram, render stats, scene size,
 * physics bodies, GC pressure proxy).
 *
 * Run: npx playwright test tests/simulate-perf-audit.spec.mjs --reporter=line
 */
import { test } from '@playwright/test';

const BASE = 'http://127.0.0.1:5174';

test('simulate-mode perf audit', async ({ page, browserName }) => {
  test.setTimeout(60000);
  const consoleLines = [];
  page.on('pageerror', (e) => consoleLines.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => {
    const txt = `[${m.type()}] ${m.text()}`;
    consoleLines.push(txt);
  });

  // Build a moderately complex track so the merge / decor systems get
  // stressed (oval + a few pickups in the middle).
  await page.goto(`${BASE}/editor.html`, { waitUntil: 'domcontentloaded' });
  const code = await page.evaluate(async (base) => {
    const td = await import(`${base}/src/editor3/track-data.js`);
    const t = new td.Track();
    t.place('spawn', 0, 0, 0);
    for (let z = 1; z < 16; z++) t.place('straight', 0, z, 0);
    return td.encodeTrack(t);
  }, BASE);

  await page.goto(`${BASE}/play.html?track=${encodeURIComponent(code)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__play?.chassisBody && window.__play?.vehicle, { timeout: 20000 });

  // Install a frame-time recorder INSIDE the page's animation loop.
  await page.evaluate(() => {
    window.__perf = {
      frames: [],
      sections: [],
      lastT: performance.now(),
      maxFrames: 1200, // ~20s at 60fps
    };
    function loop() {
      const now = performance.now();
      window.__perf.frames.push(now - window.__perf.lastT);
      window.__perf.lastT = now;
      if (window.__perf.frames.length < window.__perf.maxFrames) {
        requestAnimationFrame(loop);
      }
    }
    requestAnimationFrame(loop);
    // Hook the play-main tick instrumentation.
    window.__perfTick = (s) => {
      if (window.__perf.sections.length < window.__perf.maxFrames) {
        window.__perf.sections.push(s);
      }
    };
  });

  // Settle.
  await page.waitForTimeout(500);

  // Drive forward for ~10s while sampling.
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' })));
  await page.waitForTimeout(10000);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' })));

  // Pull stats out of the page.
  const stats = await page.evaluate(() => {
    const p = window.__play;
    const renderer = p.renderer;
    const info = renderer.info;
    let meshCount = 0;
    let instancedCount = 0;
    let totalInstances = 0;
    let materialIds = new Set();
    p.scene.traverse((o) => {
      if (o.isMesh || o.isInstancedMesh) {
        meshCount++;
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) materialIds.add(m.uuid);
        }
      }
      if (o.isInstancedMesh) {
        instancedCount++;
        totalInstances += o.count;
      }
    });
    return {
      bodies: p.world?.bodies?.length ?? 0,
      contacts: p.world?.contacts?.length ?? 0,
      narrowphasePairs: p.world?.broadphase?.collisionMatrix?.length ?? 0,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      programs: info.programs?.length ?? 0,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      meshCount,
      instancedCount,
      totalInstances,
      uniqueMaterials: materialIds.size,
      shadowMapEnabled: renderer.shadowMap.enabled,
      pixelRatio: renderer.getPixelRatio(),
      canvasW: renderer.domElement.width,
      canvasH: renderer.domElement.height,
      perfTier: (window.__play && window.__play.PERF) ? window.__play.PERF.name : 'unknown',
    };
  });

  const frames = await page.evaluate(() => window.__perf.frames.slice());
  const sections = await page.evaluate(() => window.__perf.sections.slice());

  // ── Compute frame-time stats. Skip first 30 frames (warmup).
  const samples = frames.slice(30);
  samples.sort((a, b) => a - b);
  const n = samples.length;
  const pct = (p) => samples[Math.min(n - 1, Math.floor(p * n))];
  const mean = samples.reduce((a, b) => a + b, 0) / n;
  const fpsOf = (ms) => 1000 / ms;
  // Stutter = frames > 2× the median.
  const median = pct(0.5);
  let longFrames = 0;
  let veryLongFrames = 0;
  for (const f of samples) {
    if (f > median * 2) longFrames++;
    if (f > 33.4) veryLongFrames++; // below 30 fps
  }
  // Coefficient of variation (jitter proxy).
  const variance = samples.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n;
  const stddev = Math.sqrt(variance);
  const cv = stddev / mean;

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  SIMULATE-MODE PERF AUDIT');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`Browser            : ${browserName}`);
  console.log(`Frames sampled     : ${n} (after 30-frame warmup)`);
  console.log('-- Frame time (ms) --');
  console.log(`  mean             : ${mean.toFixed(2)} ms  (${fpsOf(mean).toFixed(1)} fps)`);
  console.log(`  median (p50)     : ${median.toFixed(2)} ms  (${fpsOf(median).toFixed(1)} fps)`);
  console.log(`  p75              : ${pct(0.75).toFixed(2)} ms`);
  console.log(`  p95              : ${pct(0.95).toFixed(2)} ms`);
  console.log(`  p99              : ${pct(0.99).toFixed(2)} ms  (${fpsOf(pct(0.99)).toFixed(1)} fps)`);
  console.log(`  max              : ${samples[n - 1].toFixed(2)} ms`);
  console.log(`  stddev           : ${stddev.toFixed(2)} ms`);
  console.log(`  jitter (cv)      : ${(cv * 100).toFixed(1)}%   ← <10% = silky, >25% = visible stutter`);
  console.log(`  long frames (>2× median) : ${longFrames}  (${((longFrames / n) * 100).toFixed(1)}%)`);
  console.log(`  hitches (>33ms / <30fps) : ${veryLongFrames}  (${((veryLongFrames / n) * 100).toFixed(1)}%)`);
  console.log('-- Renderer --');
  console.log(`  perf tier        : ${stats.perfTier}`);
  console.log(`  pixel ratio      : ${stats.pixelRatio}`);
  console.log(`  canvas size      : ${stats.canvasW}×${stats.canvasH} = ${(stats.canvasW * stats.canvasH / 1e6).toFixed(2)} Mpx`);
  console.log(`  shadowMap        : ${stats.shadowMapEnabled ? 'on' : 'off'}`);
  console.log(`  draw calls/frame : ${stats.drawCalls}`);
  console.log(`  triangles        : ${stats.triangles.toLocaleString()}`);
  console.log(`  programs         : ${stats.programs}`);
  console.log(`  geometries       : ${stats.geometries}`);
  console.log(`  textures         : ${stats.textures}`);
  console.log(`  unique materials : ${stats.uniqueMaterials}`);
  console.log(`  mesh count       : ${stats.meshCount}  (instanced: ${stats.instancedCount}, total instances: ${stats.totalInstances})`);
  console.log('-- Physics --');
  console.log(`  bodies           : ${stats.bodies}`);
  console.log(`  contacts/step    : ${stats.contacts}`);
  console.log('═══════════════════════════════════════════════════════\n');

  // Print build-time diagnostic console lines (segment merge / decor).
  const diag = consoleLines.filter((l) => /\[play\]/.test(l));
  if (diag.length) {
    console.log('-- Build diagnostics --');
    for (const l of diag) console.log('  ' + l);
    console.log('');
  }

  // Spit out the worst 10 frames so we can see WHEN the hitches happen.
  const indexed = frames.map((f, i) => ({ f, i })).sort((a, b) => b.f - a.f).slice(0, 10);
  console.log('-- Worst 10 frame indexes (frame# / ms) --');
  for (const e of indexed) console.log(`  #${e.i}  ${e.f.toFixed(2)} ms`);

  // Tick-loop section breakdown.
  if (sections.length > 30) {
    const warm = sections.slice(30);
    const avg = (k) => warm.reduce((a, b) => a + (b[k] || 0), 0) / warm.length;
    const max = (k) => warm.reduce((a, b) => Math.max(a, b[k] || 0), 0);
    console.log('\n-- Tick section averages (ms / max) --');
    for (const k of ['phys', 'visual', 'cam', 'hud', 'combat', 'render', 'total']) {
      console.log(`  ${k.padEnd(8)} avg ${avg(k).toFixed(2).padStart(6)}  max ${max(k).toFixed(2).padStart(6)}`);
    }
    const idle = warm.reduce((a, b) => a + Math.max(0, (frames[warm.indexOf(b) + 30] || 16) - b.total), 0) / warm.length;
    console.log(`  idle/wait avg ${idle.toFixed(2)}  ← time between tick end and next rAF`);
  }
});
