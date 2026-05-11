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

const args = Object.fromEntries(argv.slice(2).map((s) => {
  const [k, v] = s.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const REALTIME = args.realtime || 'ws://127.0.0.1:2567';
const FRONTEND = args.frontend || 'http://127.0.0.1:5173';
const RTT_MS = Number(args.rtt ?? 100);
const LOSS_PCT = Number(args.loss ?? 0.05);

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
  console.error('[online-feel-probe] (Phase B5: full Playwright run pending; this scaffold blocks regressions in the boot path.)');
  exit(1);
}

console.log('[online-feel-probe] PASS (prereq scaffold)');
console.log('[online-feel-probe] TODO: launch 2 chromium clients, set Network.emulateNetworkConditions, drive an autostart race, parse __gloDebug.network.');
exit(0);
