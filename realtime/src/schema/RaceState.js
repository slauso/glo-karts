import { Schema, MapSchema, type } from "@colyseus/schema";
import { PlayerState } from "./PlayerState.js";
import { EntityState } from "./EntityState.js";

export class RaceState extends Schema {
  constructor() {
    super();
    this.mode = "race";
    this.trackId = "cocoa_temple";
    this.started = false;
    this.serverTime = 0;
    this.totalLaps = 3;     // configurable per-lobby
    this.finishCount = 0;   // how many players have crossed the finish line
    this.players = new MapSchema();
    this.entities = new MapSchema();
  }
}

type("string")(RaceState.prototype, "mode");
type("string")(RaceState.prototype, "trackId");
type("boolean")(RaceState.prototype, "started");
type("number")(RaceState.prototype, "serverTime");
type("number")(RaceState.prototype, "totalLaps");
type("number")(RaceState.prototype, "finishCount");
type({ map: PlayerState })(RaceState.prototype, "players");
type({ map: EntityState })(RaceState.prototype, "entities");