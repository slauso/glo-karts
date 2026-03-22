import { Schema, MapSchema, type } from "@colyseus/schema";
import { PlayerState } from "./PlayerState.js";
import { EntityState } from "./EntityState.js";

export class BattleState extends Schema {
  constructor() {
    super();
    this.mode = "battle";
    this.gameType = "deathmatch";
    this.started = false;
    this.serverTime = 0;
    this.scoreLimit = 5;
    this.syncPatchRateMs = 0;
    this.syncSimulationHz = 0;
    this.syncStaleInputMs = 0;
    this.syncInterpolationBaseDelayMs = 0;
    this.syncAuthoritative = false;
    this.countdownActive = false;
    this.countdownDurationMs = 0;
    this.countdownStartAt = 0;
    this.readyCount = 0;
    this.readyRequiredCount = 0;

    this.redScore = 0;
    this.blueScore = 0;
    this.arenaEffectType = "";
    this.arenaEffectTimer = 0;

    this.players = new MapSchema();
    this.entities = new MapSchema();
  }
}

type("string")(BattleState.prototype, "mode");
type("string")(BattleState.prototype, "gameType");
type("boolean")(BattleState.prototype, "started");
type("number")(BattleState.prototype, "serverTime");
type("number")(BattleState.prototype, "scoreLimit");
type("number")(BattleState.prototype, "syncPatchRateMs");
type("number")(BattleState.prototype, "syncSimulationHz");
type("number")(BattleState.prototype, "syncStaleInputMs");
type("number")(BattleState.prototype, "syncInterpolationBaseDelayMs");
type("boolean")(BattleState.prototype, "syncAuthoritative");
type("boolean")(BattleState.prototype, "countdownActive");
type("number")(BattleState.prototype, "countdownDurationMs");
type("number")(BattleState.prototype, "countdownStartAt");
type("number")(BattleState.prototype, "readyCount");
type("number")(BattleState.prototype, "readyRequiredCount");
type("number")(BattleState.prototype, "redScore");
type("number")(BattleState.prototype, "blueScore");
type("string")(BattleState.prototype, "arenaEffectType");
type("number")(BattleState.prototype, "arenaEffectTimer");
type({ map: PlayerState })(BattleState.prototype, "players");
type({ map: EntityState })(BattleState.prototype, "entities");