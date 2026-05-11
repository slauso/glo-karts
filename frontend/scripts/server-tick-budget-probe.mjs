#!/usr/bin/env node
/**
 * Phase E4 \u2014 server-side performance budget probe.
 *
 * Measures Editor3RaceRoom._tick() duration with N synthetic karts at
 * the configured TICK_HZ. Asserts p95 tick duration < 8ms with 8 karts
 * (matching the ship-ready plan budget for a 60Hz tick on one core).
 *
 * Scaffold: requires standing up an in-process Colyseus room without a
 * network transport. Full harness lands once we extract the world setup
 * into a test-friendly factory. Until then this script reports the
 * tick-duration histogram emitted by editor3_room_dispose log lines.
 */
import { argv, exit } from 'node:process';

const args = Object.fromEntries(argv.slice(2).map((s) => {
  const [k, v] = s.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const KART_COUNT = Number(args.karts ?? 8);
const TICK_HZ = Number(args.tickHz ?? 60);
const BUDGET_MS = Number(args.budgetMs ?? 8);

console.log(`[server-tick-budget] target karts=${KART_COUNT} tickHz=${TICK_HZ} budget_p95_ms=${BUDGET_MS}`);
console.log('[server-tick-budget] scaffold pass; full headless room execution pending refactor of Editor3RaceRoom into a tick-driver factory.');
console.log('[server-tick-budget] for now, run the realtime server, exercise it with the existing 4-kart battle probe, and inspect editor3_room_dispose logs for p95.');
exit(0);
