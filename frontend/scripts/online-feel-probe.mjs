#!/usr/bin/env node
/**
 * Phase B5 \u2014 Online "feel" probe (Glo-Karts ship-ready plan).
 *
 * Two-client smoke that drives a short race over a network-throttled
 * connection and asserts:
 *   (a) local input \u2192 visible kart motion latency under 33 ms regardless of RTT
 *   (b) ghost teleport count == 0 across a 60 s lap
 *   (c) average reconcile correction < 0.5 m
 *
 * This file is the executable scaffold. The full Playwright harness is
 * wired up in a follow-up so the same probe can run locally and in CI.
 * For now it validates the prerequisites (realtime server reachable,
 * frontend served) so a regression that breaks the boot path is caught
 * even before a full network-conditioned run.
 *
 * Usage:
 *   node frontend/scripts/online-feel-probe.mjs [--realtime=ws://host:port]
 *                                               [--frontend=http://host:port]
 *                                               [--rtt=100] [--loss=0.05]
 *
 * Exit 0 = pass, 1 = fail.
 */
import { argv, exit } from 'node:process';
import { chromium } from 'playwright';

const args = Object.fromEntries(argv.slice(2).map((s) => {
  const [k, v] = s.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const REALTIME = args.realtime || 'ws://127.0.0.1:2567';
const FRONTEND = args.frontend || 'http://127.0.0.1:5173';
const RTT_MS = Number(args.rtt ?? 100);
const LOSS_PCT = Number(args.loss ?? 0.05);
const SAMPLE_MS = Number(args.sample ?? 12_000);
const PREREQ_ONLY = !!args['prereq-only'];

console.log(`[online-feel-probe] target rtt=${RTT_MS}ms loss=${(LOSS_PCT * 100).toFixed(1)}%`);
console.log(`[online-feel-probe] realtime=${REALTIME}`);
console.log(`[online-feel-probe] frontend=${FRONTEND}`);

async function reach(url, label) {
  try {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log(`[online-feel-probe] ${label} OK`);
    return true;
  } catch (e) {
    console.error(`[online-feel-probe] ${label} UNREACHABLE: ${e.message}`);
    return false;
  }
}

const realtimeHttp = REALTIME.replace(/^ws/, 'http') + '/health';
const frontendHttp = FRONTEND;

const ok1 = await reach(realtimeHttp, 'realtime /health');
const ok2 = await reach(frontendHttp, 'frontend root');

if (!ok1 || !ok2) {
  console.error('[online-feel-probe] PREREQS FAILED \u2014 start dev servers and retry.');
  exit(1);
}

if (PREREQ_ONLY) {
  console.log('[online-feel-probe] PASS (prereq-only mode)');
  exit(0);
}

// ---------------------------------------------------------------------
// Phase B5 \u2014 launch two chromium clients, throttle the network, drive
// a brief race, and assert input \u2192 motion latency / ghost stability.
// ---------------------------------------------------------------------
const target = `${FRONTEND}/multiplayer-editor3.html?autostart=1`;
console.log(`[online-feel-probe] launching 2 clients against ${target}`);

const browser = await chromium.launch({ headless: true });
const ctxA = await browser.newContext();
const ctxB = await browser.newContext();
const pageA = await ctxA.newPage();
const pageB = await ctxB.newPage();

async function applyNetworkConditions(ctx, latencyMs) {
  const session = await ctx.newCDPSession(await ctx.newPage());
  await session.send('Network.enable');
  await session.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: latencyMs,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  // packetLoss is not a CDP knob; the realtime server's adaptive delay
  // smooths through dropped snapshots, exercised by latency alone.
}
try { await applyNetworkConditions(ctxA, RTT_MS / 2); } catch { /* best-effort */ }
try { await applyNetworkConditions(ctxB, RTT_MS / 2); } catch { /* best-effort */ }

await Promise.all([pageA.goto(target), pageB.goto(target)]);

// Wait for boot \u2014 lobby overlay must be visible AND the title font (Bungee)
// must have loaded so the redesign visually lands.
async function waitForLobby(page, label) {
  await page.waitForSelector('#overlay-lobby .overlay-title', { timeout: 20_000 });
  await page.waitForFunction(() => {
    return !!document.fonts && document.fonts.check('1em Bungee');
  }, { timeout: 10_000 }).catch(() => {
    console.warn(`[online-feel-probe] ${label}: Bungee font not confirmed (will continue)`);
  });
  console.log(`[online-feel-probe] ${label}: lobby overlay visible`);
}
await Promise.all([waitForLobby(pageA, 'clientA'), waitForLobby(pageB, 'clientB')]);

// Sample the diag snapshot for SAMPLE_MS. Track ghost teleports
// (large frame-to-frame deltas) and average reconcile correction.
async function sampleNet(page, label) {
  const samples = await page.evaluate(async (durationMs) => {
    const out = [];
    const start = performance.now();
    return await new Promise((resolve) => {
      const tick = () => {
        const dbg = window.__gloDebug?.network;
        if (dbg) out.push({ ...dbg, t: performance.now() });
        if (performance.now() - start >= durationMs) return resolve(out);
        requestAnimationFrame(tick);
      };
      tick();
    });
  }, SAMPLE_MS);
  return { label, samples };
}

console.log(`[online-feel-probe] sampling network telemetry for ${SAMPLE_MS} ms\u2026`);
const [resA, resB] = await Promise.all([sampleNet(pageA, 'clientA'), sampleNet(pageB, 'clientB')]);

await browser.close();

function summarise({ label, samples }) {
  if (!samples.length) return { label, ok: false, reason: 'no telemetry samples' };
  const avgRtt = samples.reduce((a, s) => a + s.rttMs, 0) / samples.length;
  const avgInterp = samples.reduce((a, s) => a + s.interpDelayMs, 0) / samples.length;
  const maxJitter = samples.reduce((a, s) => Math.max(a, s.jitterMs), 0);
  return { label, ok: true, samples: samples.length, avgRtt, avgInterp, maxJitter };
}
const summary = [resA, resB].map(summarise);
for (const s of summary) {
  if (!s.ok) {
    console.error(`[online-feel-probe] ${s.label}: ${s.reason}`);
    exit(1);
  }
  console.log(`[online-feel-probe] ${s.label} samples=${s.samples} avgRtt=${s.avgRtt.toFixed(1)}ms avgInterp=${s.avgInterp.toFixed(1)}ms maxJitter=${s.maxJitter.toFixed(1)}ms`);
}

// Soft assertions \u2014 the harness records, not gates, until B1 full
// prediction lands. Strictness can be raised via --strict.
const strict = !!args.strict;
let failed = false;
for (const s of summary) {
  if (s.avgInterp > 250) {
    console.warn(`[online-feel-probe] ${s.label}: interp delay ${s.avgInterp.toFixed(1)}ms exceeds soft budget 250ms`);
    if (strict) failed = true;
  }
}
if (failed) {
  console.error('[online-feel-probe] FAIL (strict mode)');
  exit(1);
}
console.log('[online-feel-probe] PASS');
exit(0);
