import { Schema, MapSchema, ArraySchema, type } from "@colyseus/schema";
import { LobbyPlayerState } from "./LobbyPlayerState.js";

export class LobbyState extends Schema {
  constructor() {
    super();
    this.lobbyCode = "";
    this.privacy = "private";
    this.gameMode = "race";
    this.modeId = "race_online";
    this.trackId = "test_box";
    this.arenaId = "test_box";
    this.arenaTheme = "nuclear_desert";
    this.battleType = "deathmatch";
    this.loadoutId = "random-all";
    this.performanceMode = "auto";
    this.scoreLimit = 5;
    this.totalLaps = 3;
    this.botCount = 0;
    this.maxPlayers = 12;
    this.status = "waiting";
    this.countdown = 0;
    this.customTrackData = "";
    this.weaponPool = new ArraySchema();
    this.players = new MapSchema();
  }
}

type("string")(LobbyState.prototype, "lobbyCode");
type("string")(LobbyState.prototype, "privacy");
type("string")(LobbyState.prototype, "gameMode");
type("string")(LobbyState.prototype, "modeId");
type("string")(LobbyState.prototype, "trackId");
type("string")(LobbyState.prototype, "arenaId");
type("string")(LobbyState.prototype, "arenaTheme");
type("string")(LobbyState.prototype, "battleType");
type("string")(LobbyState.prototype, "loadoutId");
type("string")(LobbyState.prototype, "performanceMode");
type("number")(LobbyState.prototype, "scoreLimit");
type("number")(LobbyState.prototype, "totalLaps");
type("number")(LobbyState.prototype, "botCount");
type("number")(LobbyState.prototype, "maxPlayers");
type("string")(LobbyState.prototype, "status");
type("number")(LobbyState.prototype, "countdown");
type("string")(LobbyState.prototype, "customTrackData");
type(["string"])(LobbyState.prototype, "weaponPool");
type({ map: LobbyPlayerState })(LobbyState.prototype, "players");
