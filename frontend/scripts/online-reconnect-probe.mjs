#!/usr/bin/env node
/**
 * Phase D4 \u2014 reconnect/rejoin probe.
 *   - Two clients join an editor3 race
 *   - One client closes its socket mid-race
 *   - Same client reconnects within 15s using the same sessionId
 *   - Asserts: kart slot preserved, lap counter preserved, race finishes
 *
 * Scaffold; depends on Colyseus.allowReconnection (D3) which is already
 * wired in Editor3RaceRoom.onLeave. Full harness pending.
 */
import { argv, exit } from 'node:process';
const args = Object.fromEntries(argv.slice(2).map((s) => {
  const [k, v] = s.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const REALTIME = args.realtime || 'http://127.0.0.1:2567';
try {
  const r = await fetch(REALTIME + '/health');
  if (!r.ok) throw new Error('not ok');
  console.log('[online-reconnect-probe] realtime reachable');
} catch (e) {
  console.error('[online-reconnect-probe] realtime unreachable: ' + e.message);
  exit(1);
}
console.log('[online-reconnect-probe] PASS (prereq scaffold)');
console.log('[online-reconnect-probe] TODO: drive socket close + colyseus.js reconnect within 15s, assert state continuity.');
exit(0);
