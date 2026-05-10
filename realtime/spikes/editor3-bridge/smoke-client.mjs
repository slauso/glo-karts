/**
 * Editor3 → Multiplayer Bridge — smoke client (Phase 1.5)
 *
 * Spawns N synthetic clients that connect to the spike server, send pulsed
 * throttle+steer inputs for DURATION seconds, and print the final per-kart
 * positions plus snapshot stats.
 *
 * Verifies end-to-end:
 *   - WS connect + Colyseus join
 *   - Schema-driven state replication (positions move from spawn)
 *   - Input → server → state-write → client-receive round trip
 *
 * Usage:
 *   node realtime/spikes/editor3-bridge/smoke-client.mjs
 *   node realtime/spikes/editor3-bridge/smoke-client.mjs --clients=4 --duration=8
 */

import { Client } from 'colyseus.js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const N_CLIENTS = parseInt(args.clients ?? 2, 10);
const DURATION_S = parseInt(args.duration ?? 5, 10);
const ENDPOINT = args.endpoint ?? 'ws://localhost:2568';
const INPUT_HZ = parseInt(args['input-hz'] ?? 30, 10);

async function spawnClient(idx) {
  const client = new Client(ENDPOINT);
  const room = await client.joinOrCreate('editor3_bridge');
  console.log(`[client ${idx}] joined sessionId=${room.sessionId}`);

  let lastSnapshotTs = 0;
  let snapshotCount = 0;

  // Listen for state changes (Colyseus 0.16+ schema callbacks)
  room.onStateChange((state) => {
    snapshotCount++;
    lastSnapshotTs = Date.now();
  });

  // Send pulsed inputs at INPUT_HZ
  let seq = 0;
  const inputTimer = setInterval(() => {
    seq++;
    const t = seq / INPUT_HZ;
    const throttle = 1.0;
    const steer = Math.sin(t * 0.8) * 0.5; // gentle sine sweep
    room.send('input', { seq, throttle, brake: 0, steer });
  }, 1000 / INPUT_HZ);

  await new Promise((r) => setTimeout(r, DURATION_S * 1000));
  clearInterval(inputTimer);

  const myKart = room.state.karts?.get(room.sessionId);
  const result = {
    sessionId: room.sessionId,
    snapshots: snapshotCount,
    lastSeq: myKart?.lastSeq ?? 0,
    pos: myKart ? { x: +myKart.x.toFixed(2), y: +myKart.y.toFixed(2), z: +myKart.z.toFixed(2) } : null,
    vel: myKart ? Math.hypot(myKart.vx, myKart.vy, myKart.vz).toFixed(2) : 'n/a',
    inputsSent: seq,
  };

  await room.leave();
  return result;
}

async function main() {
  console.log(`[spike] smoke-client → ${ENDPOINT}, clients=${N_CLIENTS}, duration=${DURATION_S}s`);
  const results = await Promise.all(
    Array.from({ length: N_CLIENTS }, (_, i) => spawnClient(i)),
  );
  console.log('\n=== RESULTS ===');
  for (const r of results) {
    console.log(JSON.stringify(r));
  }

  // Smoke verdict
  const moved = results.filter((r) => r.pos && (Math.abs(r.pos.x - 8) > 1 || Math.abs(r.pos.z - 8) > 1)).length;
  const acked = results.filter((r) => r.lastSeq > 0).length;
  console.log('\n=== VERDICT ===');
  console.log(`clients moved: ${moved}/${results.length}`);
  console.log(`clients with input ack:  ${acked}/${results.length}`);
  console.log(`avg snapshots/client:    ${(results.reduce((s, r) => s + r.snapshots, 0) / results.length).toFixed(1)}`);
  if (moved === results.length && acked === results.length) {
    console.log('PASS — bridge round-trip verified');
    process.exit(0);
  } else {
    console.log('FAIL — see results above');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[spike] error:', err);
  process.exit(2);
});
