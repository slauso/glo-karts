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
import { log } from "./logger.js";

const port = Number(process.env.PORT || process.env.COLYSEUS_PORT || 2567);
const app = express();

// Task 2.4: Restrict CORS in production — only allow configured origin.
const corsOrigin = process.env.CORS_ORIGIN;  // e.g. "https://glokarts.com"
app.use(cors(corsOrigin ? { origin: corsOrigin } : {}));
app.use(express.json());

app.get("/health", (_req, res) => {
  const rooms = gameServer.matchMaker?.stats?.local ?? {};
  res.json({ ok: true, service: "GLOKarts-realtime", port, rooms, uptime: process.uptime(), ts: Date.now() });
});

const server = http.createServer(app);
const gameServer = new Server({ transport: new WebSocketTransport({ server }) });

gameServer.define("lobby_room", LobbyRoom)
  .filterBy(["privacy", "gameMode", "lobbyCode"]);
gameServer.define("race_room", RaceRoom)
  .filterBy(["partyCode"]);
gameServer.define("battle_room", BattleRoom)
  .filterBy(["partyCode"]);
gameServer.define("gloflux", GloFluxRoom)
  .filterBy(["partyCode"]);

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
