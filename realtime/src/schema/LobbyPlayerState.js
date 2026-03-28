import { Schema, type } from "@colyseus/schema";

export class LobbyPlayerState extends Schema {
  constructor() {
    super();
    this.id = "";
    this.name = "Player";
    this.playerColor = "red";
    this.playerKart = "tux";
    this.gloEffect = "solid";
    this.gloColor = "#ff0080";
    this.gloColor2 = "#00e5ff";
    this.isHost = false;
    this.isReady = false;
  }
}

type("string")(LobbyPlayerState.prototype, "id");
type("string")(LobbyPlayerState.prototype, "name");
type("string")(LobbyPlayerState.prototype, "playerColor");
type("string")(LobbyPlayerState.prototype, "playerKart");
type("string")(LobbyPlayerState.prototype, "gloEffect");
type("string")(LobbyPlayerState.prototype, "gloColor");
type("string")(LobbyPlayerState.prototype, "gloColor2");
type("boolean")(LobbyPlayerState.prototype, "isHost");
type("boolean")(LobbyPlayerState.prototype, "isReady");
