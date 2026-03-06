import { Schema, MapSchema, type } from "@colyseus/schema";
import { LobbyPlayerState } from "./LobbyPlayerState.js";

export class LobbyState extends Schema {
  constructor() {
    super();
    this.lobbyCode = "";
    this.privacy = "private";
    this.gameMode = "race";
    this.trackId = "test_box";
    this.arenaId = "test_box";
    this.battleType = "deathmatch";
    this.maxPlayers = 12;
    this.status = "waiting";
    this.countdown = 0;
    this.players = new MapSchema();
  }
}

type("string")(LobbyState.prototype, "lobbyCode");
type("string")(LobbyState.prototype, "privacy");
type("string")(LobbyState.prototype, "gameMode");
type("string")(LobbyState.prototype, "trackId");
type("string")(LobbyState.prototype, "arenaId");
type("string")(LobbyState.prototype, "battleType");
type("number")(LobbyState.prototype, "maxPlayers");
type("string")(LobbyState.prototype, "status");
type("number")(LobbyState.prototype, "countdown");
type({ map: LobbyPlayerState })(LobbyState.prototype, "players");
