import http from "http";
import express from "express";
import cors from "cors";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { monitor } from "@colyseus/monitor";
import { RaceRoom } from "./rooms/RaceRoom.js";
import { BattleRoom } from "./rooms/BattleRoom.js";
import { LobbyRoom } from "./rooms/LobbyRoom.js";

const port = Number(process.env.COLYSEUS_PORT || 2567);
const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "GLOKarts-realtime", port, ts: Date.now() });
});

const server = http.createServer(app);
const gameServer = new Server({ transport: new WebSocketTransport({ server }) });

gameServer.define("lobby_room", LobbyRoom)
  .filterBy(["privacy", "gameMode", "lobbyCode"]);
gameServer.define("race_room", RaceRoom)
  .filterBy(["partyCode"]);
gameServer.define("battle_room", BattleRoom)
  .filterBy(["partyCode"]);

app.use("/colyseus", monitor());

gameServer.listen(port);
console.log(`[realtime] Colyseus listening on ws://localhost:${port}`);
