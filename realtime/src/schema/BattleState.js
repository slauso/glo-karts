import { Schema, MapSchema, type } from "@colyseus/schema";
import { PlayerState } from "./PlayerState.js";

export class BattleState extends Schema {
  constructor() {
    super();
    this.mode = "battle";
    this.gameType = "deathmatch";
    this.started = false;
    this.serverTime = 0;
    this.scoreLimit = 5;

    this.redScore = 0;
    this.blueScore = 0;

    this.players = new MapSchema();
  }
}

type("string")(BattleState.prototype, "mode");
type("string")(BattleState.prototype, "gameType");
type("boolean")(BattleState.prototype, "started");
type("number")(BattleState.prototype, "serverTime");
type("number")(BattleState.prototype, "scoreLimit");
type("number")(BattleState.prototype, "redScore");
type("number")(BattleState.prototype, "blueScore");
type({ map: PlayerState })(BattleState.prototype, "players");