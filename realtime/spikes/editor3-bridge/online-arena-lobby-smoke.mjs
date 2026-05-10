/**
 * online-arena-lobby-smoke.mjs — Phase 2.4 end-to-end probe.
 *
 * Boots both LobbyRoom and Editor3RaceRoom on a local Colyseus server,
 * has 2 clients create+join a lobby with modeId="online_arena", host
 * starts the match, and verifies:
 *   - matchStart fires with roomName === "editor3_race_room"
 *   - gameConfig carries trackId, totalLaps, modeId="online_arena"
 *   - both clients can then join editor3_race_room and receive snapshots
 */
import http from "node:http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client } from "colyseus.js";
import { LobbyRoom } from "../../src/rooms/LobbyRoom.js";
import { Editor3RaceRoom } from "../../src/rooms/Editor3RaceRoom.js";

const PORT = 2570;
const TUTORIAL_LOOP_ID = "11111111-1111-1111-1111-111111111111";

function timeout(ms, label) {
  return new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout: ${label}`)), ms));
}

async function main() {
  const server = http.createServer();
  const gameServer = new Server({ transport: new WebSocketTransport({ server }) });
  gameServer.define("lobby_room", LobbyRoom);
  gameServer.define("editor3_race_room", Editor3RaceRoom);
  await gameServer.listen(PORT);
  console.log(`[smoke] server listening on ws://localhost:${PORT}`);

  const url = `ws://localhost:${PORT}`;
  const c1 = new Client(url);
  const c2 = new Client(url);

  const host = await c1.joinOrCreate("lobby_room", {
    lobbyCode: "TEST-ONLINE-ARENA",
    privacy: "private",
    gameMode: "race",
    modeId: "online_arena",
    trackId: TUTORIAL_LOOP_ID,
    totalLaps: 5,
    maxPlayers: 8,
    playerName: "Host",
  });
  console.log(`[smoke] host joined lobby sid=${host.sessionId}`);

  const guest = await c2.joinOrCreate("lobby_room", {
    lobbyCode: "TEST-ONLINE-ARENA",
    privacy: "private",
    gameMode: "race",
    modeId: "online_arena",
    trackId: TUTORIAL_LOOP_ID,
    totalLaps: 5,
    playerName: "Guest",
  });
  console.log(`[smoke] guest joined lobby sid=${guest.sessionId}`);

  const matchStartPromise = Promise.race([
    new Promise((res) => host.onMessage("matchStart", res)),
    timeout(6000, "matchStart"),
  ]);

  // Host starts.
  host.send("startMatch", {});

  const payload = await matchStartPromise;
  console.log("[smoke] matchStart received", {
    roomName: payload.roomName,
    modeId: payload.gameConfig?.modeId,
    trackId: payload.gameConfig?.trackId,
    totalLaps: payload.gameConfig?.totalLaps,
    players: payload.gameConfig?.players?.length || 0,
  });

  if (payload.roomName !== "editor3_race_room") throw new Error(`roomName=${payload.roomName}`);
  if (payload.gameConfig?.modeId !== "online_arena") throw new Error("modeId mismatch");
  if (payload.gameConfig?.totalLaps !== 5) throw new Error("totalLaps mismatch");
  if (payload.gameConfig?.trackId !== TUTORIAL_LOOP_ID) throw new Error("trackId mismatch");

  // Drop lobby and re-join into the race room (mirrors what multiplayer-editor3-main.js does).
  await host.leave();
  await guest.leave();

  const r1 = await c1.joinOrCreate("editor3_race_room", {
    trackId: TUTORIAL_LOOP_ID,
    totalLaps: 5,
    lobbyCode: "TEST-ONLINE-ARENA",
    playerName: "Host",
  });
  const r2 = await c2.joinOrCreate("editor3_race_room", {
    trackId: TUTORIAL_LOOP_ID,
    totalLaps: 5,
    lobbyCode: "TEST-ONLINE-ARENA",
    playerName: "Guest",
  });

  await new Promise((res) => setTimeout(res, 1500));

  let snapshots = 0;
  r1.onStateChange(() => { snapshots++; });
  await new Promise((res) => setTimeout(res, 1500));
  console.log(`[smoke] r1 karts=${r1.state.karts.size} totalLaps=${r1.state.totalLaps} snapshots>=${snapshots}`);
  if (r1.state.karts.size !== 2) throw new Error(`expected 2 karts, got ${r1.state.karts.size}`);
  if (r1.state.totalLaps !== 5) throw new Error(`expected totalLaps=5, got ${r1.state.totalLaps}`);

  await r1.leave();
  await r2.leave();
  await gameServer.gracefullyShutdown(false);
  console.log("[smoke] PASS");
  process.exit(0);
}

main().catch((err) => {
  console.error("[smoke] FAIL", err);
  process.exit(1);
});
