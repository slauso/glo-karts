import http from "http";
import express from "express";
import cors from "cors";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { monitor } from "@colyseus/monitor";
import { RaceRoom } from "./rooms/RaceRoom.js";
import { BattleRoom } from "./rooms/BattleRoom.js";
import { LobbyRoom } from "./rooms/LobbyRoom.js";
import { GloFluxRoom } from "./rooms/GloFluxRoom.js";
import { FpsArenaRoom } from "./rooms/FpsArenaRoom.js";
import { StudioRoom } from "./rooms/StudioRoom.js";
import { Editor3RaceRoom } from "./rooms/Editor3RaceRoom.js";
import { log } from "./logger.js";

const port = Number(process.env.COLYSEUS_PORT || 2567);
const app = express();

// Task 2.4: Restrict CORS in production — only allow configured origin.
const corsOrigin = process.env.CORS_ORIGIN;  // e.g. "https://glokarts.com"
app.use(cors(corsOrigin ? { origin: corsOrigin } : {}));
app.use(express.json());

app.get("/health", (_req, res) => {
  const rooms = gameServer.matchMaker?.stats?.local ?? {};
  res.json({ ok: true, service: "GLOKarts-realtime", port, rooms, uptime: process.uptime(), ts: Date.now() });
});

// Phase E1 \u2014 Prometheus-format /metrics endpoint. Exports per-process
// uptime + room counters. Per-room tick metrics (tickDriftMs, snapshotBytes)
// are already collected at realtime-sync.js; we surface them aggregated.
// Scrape with prometheus-style: GET /metrics returns text/plain.
const _serverStartedAt = Date.now();
app.get("/metrics", (_req, res) => {
  const lines = [];
  const stats = gameServer.matchMaker?.stats?.local ?? {};
  const roomCount = Number(stats.roomCount ?? 0);
  const ccu = Number(stats.ccu ?? 0);
  lines.push('# HELP glokarts_uptime_seconds Process uptime in seconds.');
  lines.push('# TYPE glokarts_uptime_seconds counter');
  lines.push(`glokarts_uptime_seconds ${process.uptime().toFixed(1)}`);
  lines.push('# HELP glokarts_rooms Total active Colyseus rooms.');
  lines.push('# TYPE glokarts_rooms gauge');
  lines.push(`glokarts_rooms ${roomCount}`);
  lines.push('# HELP glokarts_clients Total connected clients across rooms.');
  lines.push('# TYPE glokarts_clients gauge');
  lines.push(`glokarts_clients ${ccu}`);
  const mem = process.memoryUsage();
  lines.push('# HELP glokarts_memory_rss_bytes Resident set size in bytes.');
  lines.push('# TYPE glokarts_memory_rss_bytes gauge');
  lines.push(`glokarts_memory_rss_bytes ${mem.rss}`);
  lines.push('# HELP glokarts_memory_heap_used_bytes V8 heap used.');
  lines.push('# TYPE glokarts_memory_heap_used_bytes gauge');
  lines.push(`glokarts_memory_heap_used_bytes ${mem.heapUsed}`);
  lines.push(`# server_started_at_ms ${_serverStartedAt}`);
  res.set('Content-Type', 'text/plain; version=0.0.4');
  res.send(lines.join('\n') + '\n');
});

const server = http.createServer(app);
const gameServer = new Server({ transport: new WebSocketTransport({ server }) });

gameServer.define("lobby_room", LobbyRoom)
  .filterBy(["privacy", "gameMode", "lobbyCode"]);
gameServer.define("race_room", RaceRoom)
  .filterBy(["partyCode"]);
gameServer.define("battle_room", BattleRoom)
  .filterBy(["partyCode"]);
gameServer.define("builder_race_playtest", RaceRoom)
  .filterBy(["partyCode"]);
gameServer.define("builder_battle_playtest", BattleRoom)
  .filterBy(["partyCode"]);
gameServer.define("gloflux", GloFluxRoom)
  .filterBy(["partyCode"]);
gameServer.define("fps_arena", FpsArenaRoom)

gameServer.define("studio_room", StudioRoom)
  .filterBy(["code"]);

// Phase 2 — Track Studio ↔ multiplayer bridge.
// Promoted from spikes/editor3-bridge. Accepts {trackId} or {trackData}.
gameServer.define("editor3_race_room", Editor3RaceRoom)
  .filterBy(["partyCode", "trackId"]);

// Task 2.4: Disable monitor in production to prevent information leakage.
if (process.env.NODE_ENV !== "production") {
  app.use("/colyseus", monitor());
}

gameServer.listen(port);
log('info', 'server_start', { port, env: process.env.NODE_ENV || 'development' });

// Graceful shutdown
process.on('SIGTERM', () => {
  log('info', 'server_shutdown', { signal: 'SIGTERM' });
  gameServer.gracefullyShutdown().then(() => process.exit(0));
});

process.on('uncaughtException', (err) => {
  log('error', 'uncaught_exception', { message: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  log('error', 'unhandled_rejection', { message: String(reason) });
});
