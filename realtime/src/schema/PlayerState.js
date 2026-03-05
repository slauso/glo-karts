import { Schema, type } from "@colyseus/schema";

export class PlayerState extends Schema {
  constructor() {
    super();
    this.id = "";
    this.name = "Player";
    this.team = "none";
    this.kartId = "tux";
    this.playerColor = "red";
    this.gloEffect = "solid";
    this.gloColor = "#ff0080";
    this.gloColor2 = "#00e5ff";

    this.x = 0;
    this.y = 0;
    this.z = 0;

    this.vx = 0;
    this.vy = 0;
    this.vz = 0;

    this.rx = 0;
    this.ry = 0;
    this.rz = 0;
    this.rw = 1;

    this.health = 100;
    this.score = 0;
    this.lastProcessedInput = 0;

    // Race lap tracking (synced to all clients for leaderboard)
    this.lap = 0;             // current lap number (1-based once race starts)
    this.checkpointIdx = -1;  // last validated checkpoint index; -1 = not yet started
    this.finished = false;    // true once player completes all laps
    this.raceFinishTime = 0;  // server time (ms) when this player finished

    // Weapon inventory (synced so HUD can display)
    this.weapon = "";        // current weapon id ("" = none)
    this.ammo = 0;           // how many uses remain
    this.fireCooldown = 0;   // ms until next fire allowed

    // Active effects (synced to clients for physics + visual)
    this.speedMultiplier = 1.0;   // 1.0 = normal, >1 boost, <1 slow
    this.steerMultiplier = 1.0;   // 1.0 = normal, 0 = locked
    this.effectType = "";         // "boost"|"stuck"|"spinout"|"blind"|"slow"|"heavy"|"squash"|""
    this.effectTimer = 0;         // ms remaining for active effect
    this.shielded = false;        // absorbs next incoming hit
  }
}

type("string")(PlayerState.prototype, "id");
type("string")(PlayerState.prototype, "name");
type("string")(PlayerState.prototype, "team");
type("string")(PlayerState.prototype, "kartId");
type("string")(PlayerState.prototype, "playerColor");
type("string")(PlayerState.prototype, "gloEffect");
type("string")(PlayerState.prototype, "gloColor");
type("string")(PlayerState.prototype, "gloColor2");

type("number")(PlayerState.prototype, "x");
type("number")(PlayerState.prototype, "y");
type("number")(PlayerState.prototype, "z");

type("number")(PlayerState.prototype, "vx");
type("number")(PlayerState.prototype, "vy");
type("number")(PlayerState.prototype, "vz");

type("number")(PlayerState.prototype, "rx");
type("number")(PlayerState.prototype, "ry");
type("number")(PlayerState.prototype, "rz");
type("number")(PlayerState.prototype, "rw");

type("number")(PlayerState.prototype, "health");
type("number")(PlayerState.prototype, "score");
type("number")(PlayerState.prototype, "lastProcessedInput");
type("string")(PlayerState.prototype, "weapon");
type("number")(PlayerState.prototype, "ammo");
type("number")(PlayerState.prototype, "fireCooldown");
type("number")(PlayerState.prototype, "speedMultiplier");
type("number")(PlayerState.prototype, "steerMultiplier");
type("string")(PlayerState.prototype, "effectType");
type("number")(PlayerState.prototype, "effectTimer");
type("boolean")(PlayerState.prototype, "shielded");

type("number")(PlayerState.prototype, "lap");
type("number")(PlayerState.prototype, "checkpointIdx");
type("boolean")(PlayerState.prototype, "finished");
type("number")(PlayerState.prototype, "raceFinishTime");