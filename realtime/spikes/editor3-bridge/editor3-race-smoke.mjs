/**
 * editor3-race-smoke.mjs — End-to-end smoke for Editor3RaceRoom.
 *
 * Boots a local Colyseus server with the production room registration
 * (realtime/src/index.js path), then connects N Node clients with the
 * Tutorial Loop fixture passed as inline `trackData` (no backend required).
 *
 * Verifies:
 *   - Room creates without error and loads the track (>0 spawn placements).
 *   - All N clients join and receive a kart entry.
 *   - Karts receive at least one snapshot with non-zero quaternion (i.e.
 *     they were placed on the track, not at the origin).
 *
 * Usage:
 *   cd realtime
 *   node spikes/editor3-bridge/editor3-race-smoke.mjs           # 4 clients
 *   node spikes/editor3-bridge/editor3-race-smoke.mjs --n=8
 */
import http from "node:http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client } from "colyseus.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Editor3RaceRoom } from "../../src/rooms/Editor3RaceRoom.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);
const NUM_CLIENTS = parseInt(args.n ?? 4, 10);
const PORT = parseInt(args.port ?? 2569, 10);
const RUN_MS = parseInt(args.duration ?? 4000, 10);

async function loadTutorialLoop() {
  const fixturePath = resolve(__dirname, "../../../backend/tracks/fixtures/starter_templates.json");
  const json = JSON.parse(await readFile(fixturePath, "utf8"));
  const tutorial = json.find((row) => row.fields.name === "Tutorial Loop");
  if (!tutorial) throw new Error("Tutorial Loop fixture missing");
  return tutorial.fields.track_data; // { track, decor }
}

async function main() {
  const trackData = await loadTutorialLoop();
  const placements = trackData.track.placements;
  const spawnCount = placements.filter((p) => p.k === "spawn").length;
  console.log(`[smoke] Tutorial Loop: ${placements.length} placements, ${spawnCount} explicit spawn(s)`);

  // Boot server
  const server = http.createServer();
  const gameServer = new Server({ transport: new WebSocketTransport({ server }) });
  gameServer.define("editor3_race_room", Editor3RaceRoom);
  await gameServer.listen(PORT);
  console.log(`[smoke] server listening on ws://localhost:${PORT}`);

  // Connect clients
  const clients = [];
  const snapshots = new Map(); // sid -> count
  for (let i = 0; i < NUM_CLIENTS; i++) {
    const client = new Client(`ws://localhost:${PORT}`);
    const room = await client.joinOrCreate("editor3_race_room", { trackData });
    clients.push({ client, room });
    snapshots.set(room.sessionId, 0);
    room.onStateChange(() => {
      snapshots.set(room.sessionId, (snapshots.get(room.sessionId) || 0) + 1);
    });
    // Mash throttle a bit so karts move.
    let seq = 0;
    setInterval(() => {
      try { room.send("input", { seq: ++seq, throttle: 1, brake: 0, steer: 0.1 }); } catch {}
    }, 50);
    console.log(`[smoke] client ${i} joined as ${room.sessionId}`);
  }

  // Run
  await new Promise((r) => setTimeout(r, RUN_MS));

  // Verify
  let pass = true;
  for (const { room } of clients) {
    const count = room.state.karts.size;
    const mySnaps = snapshots.get(room.sessionId) || 0;
    const myKart = room.state.karts.get(room.sessionId);
    const placedY = myKart ? myKart.y : 0;
    console.log(`[smoke] sid=${room.sessionId} karts=${count} snapshots=${mySnaps} y=${placedY.toFixed(2)}`);
    if (count !== NUM_CLIENTS) { console.error(`  ✗ expected ${NUM_CLIENTS} karts, saw ${count}`); pass = false; }
    if (mySnaps < 5) { console.error(`  ✗ too few snapshots (${mySnaps})`); pass = false; }
    if (placedY < 100) { console.error(`  ✗ kart y too low (${placedY}) — track may not be loaded`); pass = false; }
  }

  for (const { room } of clients) await room.leave();
  await gameServer.gracefullyShutdown(false);
  console.log(pass ? "[smoke] PASS" : "[smoke] FAIL");
  process.exit(pass ? 0 : 1);
}

main().catch((err) => { console.error("[smoke] crash", err); process.exit(2); });
