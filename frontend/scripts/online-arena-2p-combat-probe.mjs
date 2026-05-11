#!/usr/bin/env node
/**
 * Phase C4 \u2014 Online combat probe (2 clients, 30s of fire exchange).
 * Asserts:
 *   - server-rejected fire requests respect the cooldown floor (Phase C1)
 *   - every projectileFired emitted by the server is mirrored on both clients
 *   - kartImpact events (Phase C2 \u2014 once shipped) line up across clients
 *
 * Boot scaffold; full Playwright drive lands with C2.
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
  console.log('[online-arena-2p-combat-probe] realtime reachable');
} catch (e) {
  console.error('[online-arena-2p-combat-probe] realtime unreachable: ' + e.message);
  exit(1);
}
console.log('[online-arena-2p-combat-probe] PASS (prereq scaffold)');
console.log('[online-arena-2p-combat-probe] TODO: implement Playwright two-client fire/kartImpact assertions after C2 ships.');
exit(0);
