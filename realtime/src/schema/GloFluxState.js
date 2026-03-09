/**
 * GloFluxState.js — Colyseus schema for gloFLUX room state.
 */

import { Schema, MapSchema, ArraySchema, type } from "@colyseus/schema";
import { PlayerState } from "./PlayerState.js";
import { EntityState } from "./EntityState.js";

export class GloFluxPowerSpawn extends Schema {
  constructor() {
    super();
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.powerId = "";
    this.collected = false;
  }
}

type("number")(GloFluxPowerSpawn.prototype, "x");
type("number")(GloFluxPowerSpawn.prototype, "y");
type("number")(GloFluxPowerSpawn.prototype, "z");
type("string")(GloFluxPowerSpawn.prototype, "powerId");
type("boolean")(GloFluxPowerSpawn.prototype, "collected");

export class GloFluxState extends Schema {
  constructor() {
    super();
    this.mode = "gloflux";
    this.variant = "arena";        // 'arena' | 'race'
    this.arenaTheme = "nuclear_desert";
    this.hostSessionId = "";
    this.started = false;
    this.serverTime = 0;
    this.elapsed = 0;
    this.shrinkRadius = 60;

    this.players = new MapSchema();
    this.entities = new MapSchema();
    this.powerSpawns = new ArraySchema();
  }
}

type("string")(GloFluxState.prototype, "mode");
type("string")(GloFluxState.prototype, "variant");
type("string")(GloFluxState.prototype, "arenaTheme");
type("string")(GloFluxState.prototype, "hostSessionId");
type("boolean")(GloFluxState.prototype, "started");
type("number")(GloFluxState.prototype, "serverTime");
type("number")(GloFluxState.prototype, "elapsed");
type("number")(GloFluxState.prototype, "shrinkRadius");
type({ map: PlayerState })(GloFluxState.prototype, "players");
type({ map: EntityState })(GloFluxState.prototype, "entities");
type([GloFluxPowerSpawn])(GloFluxState.prototype, "powerSpawns");
