import { Client } from 'colyseus.js';

const endpoint = process.env.COLYSEUS_URL || 'ws://localhost:2567';

const KARTS = [
  'tux', 'adiumy', 'nolok', 'wilber', 'xue', 'hexley', 'gavroche', 'emule', 'kiki', 'beastie',
  'amanda', 'suzanne', 'gnu', 'konqi', 'sara_the_racer', 'sara_the_wizard', 'puffy', 'pidgin'
];
const COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'white', 'black'];
const GLO_EFFECTS = ['solid', 'pulse', 'strobe', 'rainbow', 'two-color', 'chase'];
const GLO_COLORS = ['#ff0080', '#00e5ff', '#00ff44', '#ffee00', '#9933ff', '#ff4400', '#ffffff'];

const SCENARIOS = [
  { clients: 8, roomName: 'race_room', gameType: null, label: 'race_8' },
  { clients: 10, roomName: 'race_room', gameType: null, label: 'race_10' },
  { clients: 12, roomName: 'race_room', gameType: null, label: 'race_12' },
  { clients: 8, roomName: 'battle_room', gameType: 'deathmatch', label: 'dm_8' },
  { clients: 10, roomName: 'battle_room', gameType: 'deathmatch', label: 'dm_10' },
  { clients: 12, roomName: 'battle_room', gameType: 'deathmatch', label: 'dm_12' },
  { clients: 8, roomName: 'battle_room', gameType: 'ctf', label: 'ctf_8' },
  { clients: 10, roomName: 'battle_room', gameType: 'ctf', label: 'ctf_10' },
  { clients: 12, roomName: 'battle_room', gameType: 'ctf', label: 'ctf_12' },
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function makeJoinOptions(i, scenario) {
  return {
    playerName: `C${i}_${scenario.label}`,
    maxPlayers: scenario.clients,
    gameType: scenario.gameType || 'deathmatch',
    trackId: 'cocoa_temple',
    scoreLimit: 5,
    kartId: KARTS[i % KARTS.length],
    playerColor: COLORS[i % COLORS.length],
    gloEffect: GLO_EFFECTS[i % GLO_EFFECTS.length],
    gloColor: GLO_COLORS[i % GLO_COLORS.length],
    gloColor2: GLO_COLORS[(i + 2) % GLO_COLORS.length],
  };
}

async function runScenario(scenario) {
  const clients = [];
  const report = {
    label: scenario.label,
    roomName: scenario.roomName,
    gameType: scenario.gameType || 'race',
    clients: scenario.clients,
    joined: 0,
    perClient: {},
    movementLatencyMsByClient: {},
    packetRatePerSecByClient: {},
    customizationMismatches: [],
  };

  try {
    for (let i = 0; i < scenario.clients; i++) {
      const client = new Client(endpoint);
      const joinOptions = makeJoinOptions(i, scenario);
      const room = await client.joinOrCreate(scenario.roomName, joinOptions);
      room.onMessage('joined', () => {});

      const metrics = {
        stateChanges: 0,
        firstHostMovementAt: null,
        joinedAt: Date.now(),
        joinOptions,
      };

      room.onStateChange((state) => {
        metrics.stateChanges += 1;

        if (i !== 0) {
          const host = state.players.get(clients[0]?.room?.sessionId || '');
          if (host && !metrics.hostBaseline) {
            metrics.hostBaseline = { x: host.x, z: host.z, t: Date.now() };
          }

          if (host && metrics.hostBaseline && !metrics.firstHostMovementAt) {
            const moved = Math.abs(host.x - metrics.hostBaseline.x) > 0.05 || Math.abs(host.z - metrics.hostBaseline.z) > 0.05;
            if (moved) {
              metrics.firstHostMovementAt = Date.now();
            }
          }
        }
      });

      clients.push({ client, room, metrics });
      report.joined += 1;
    }

    const host = clients[0];
    host.room.send('start', {});

    const nowStart = Date.now();
    for (const entry of clients) {
      entry.metrics.hostMoveStartAt = nowStart;
    }

    const movingWindowMs = 5000;
    const tickMs = 50;

    const start = Date.now();
    while (Date.now() - start < movingWindowMs) {
      const elapsed = Date.now() - start;
      const phase = Math.sin(elapsed / 350);

      // Host drives a distinct motion pattern.
      host.room.send('input', {
        seq: elapsed,
        throttle: 1,
        steer: phase > 0 ? 0.9 : -0.9,
        brake: 0,
        fire: false,
      });

      // Others provide lighter varied input to keep room active.
      for (let i = 1; i < clients.length; i++) {
        clients[i].room.send('input', {
          seq: elapsed + i,
          throttle: 0.6,
          steer: ((i % 2) ? 0.5 : -0.5) * (phase > 0 ? 1 : -1),
          brake: 0,
          fire: false,
        });
      }

      await wait(tickMs);
    }

    await wait(500);

    // Snapshot state from each client for player count + customization fidelity.
    for (let i = 0; i < clients.length; i++) {
      const { room, metrics } = clients[i];
      const state = room.state;
      const players = [];
      state.players.forEach((player, sid) => {
        players.push({
          sid,
          name: player.name,
          kartId: player.kartId,
          playerColor: player.playerColor,
          gloEffect: player.gloEffect,
          gloColor: player.gloColor,
          gloColor2: player.gloColor2,
          x: player.x,
          z: player.z,
        });
      });

      const expectedCount = scenario.clients;
      const observedCount = players.length;

      // Check customization parity against join options.
      for (const p of players) {
        const expected = clients.find((c) => c.room.sessionId === p.sid)?.metrics?.joinOptions;
        if (!expected) continue;
        if (
          p.kartId !== expected.kartId
          || p.playerColor !== expected.playerColor
          || p.gloEffect !== expected.gloEffect
          || p.gloColor !== expected.gloColor
          || p.gloColor2 !== expected.gloColor2
        ) {
          report.customizationMismatches.push({
            observer: i,
            sid: p.sid,
            expected,
            observed: {
              kartId: p.kartId,
              playerColor: p.playerColor,
              gloEffect: p.gloEffect,
              gloColor: p.gloColor,
              gloColor2: p.gloColor2,
            },
          });
        }
      }

      const movementLatencyMs = i === 0
        ? 0
        : (metrics.firstHostMovementAt && metrics.hostMoveStartAt
          ? (metrics.firstHostMovementAt - metrics.hostMoveStartAt)
          : null);

      const packetRatePerSec = Number((metrics.stateChanges / ((movingWindowMs + 500) / 1000)).toFixed(2));

      report.movementLatencyMsByClient[`C${i}`] = movementLatencyMs;
      report.packetRatePerSecByClient[`C${i}`] = packetRatePerSec;
      report.perClient[`C${i}`] = {
        sessionId: room.sessionId,
        observedPlayers: observedCount,
        expectedPlayers: expectedCount,
        stateChanges: metrics.stateChanges,
        packetRatePerSec,
      };
    }

    const playerCountOk = Object.values(report.perClient).every((m) => m.observedPlayers === scenario.clients);
    const latencyVals = Object.values(report.movementLatencyMsByClient).filter((v) => typeof v === 'number' && v > 0);
    const latencyAvg = latencyVals.length ? latencyVals.reduce((a, b) => a + b, 0) / latencyVals.length : 0;
    report.avgMovementLatencyMs = Number(latencyAvg.toFixed(2));

    const rateVals = Object.values(report.packetRatePerSecByClient);
    const rateAvg = rateVals.length ? rateVals.reduce((a, b) => a + b, 0) / rateVals.length : 0;
    report.avgPacketRatePerSec = Number(rateAvg.toFixed(2));

    report.ok = playerCountOk && report.customizationMismatches.length === 0;
    return report;
  } finally {
    for (const entry of clients) {
      try { await entry.room.leave(); } catch {}
    }
  }
}

async function run() {
  const results = [];

  for (const scenario of SCENARIOS) {
    const result = await runScenario(scenario);
    results.push(result);
    console.log('COLYSEUS_SCENARIO', JSON.stringify(result, null, 2));
  }

  const summary = results.map((r) => ({
    label: r.label,
    ok: r.ok,
    clients: r.clients,
    mode: r.roomName,
    gameType: r.gameType,
    avgMovementLatencyMs: r.avgMovementLatencyMs,
    avgPacketRatePerSec: r.avgPacketRatePerSec,
    customizationMismatches: r.customizationMismatches.length,
  }));

  const ok = results.every((r) => r.ok);
  console.log('COLYSEUS_MATRIX_SUMMARY', JSON.stringify({ ok, summary }, null, 2));
  process.exitCode = ok ? 0 : 1;
}

run().catch((e) => {
  console.error('COLYSEUS_MATRIX_SUMMARY', JSON.stringify({ ok: false, error: String(e?.message || e) }, null, 2));
  process.exit(1);
});
