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
    this.arenaSeed = 0;
    this.hostSessionId = "";
    this.started = false;
    this.serverTime = 0;
    this.elapsed = 0;
    this.shrinkRadius = 60;
    this.activeCoreCount = 0;
    this.totalCoreCollections = 0;
    this.totalChainBursts = 0;
    this.activeChainPeak = 0;
    this.longestChain = 0;
    this.patchVersion = 0;
    this.totalSurgeEvents = 0;
    this.highestSurgeMeter = 0;

    // 20.15 — match lifecycle
    this.matchPhase = "waiting";     // waiting | prematch | countdown | live | results | rematch
    this.rematchVotes = 0;
    this.rematchTarget = 0;

    // 20.16 — session reliability
    this.spectatorCount = 0;

    // 20.22 — social / party
    this.partyCode = "";

    // 20.23 — persistence seed badge
    this.seedBadge = "";

    this.players = new MapSchema();
    this.entities = new MapSchema();
    this.powerSpawns = new ArraySchema();
  }
}

type("string")(GloFluxState.prototype, "mode");
type("string")(GloFluxState.prototype, "variant");
type("string")(GloFluxState.prototype, "arenaTheme");
type("number")(GloFluxState.prototype, "arenaSeed");
type("string")(GloFluxState.prototype, "hostSessionId");
type("boolean")(GloFluxState.prototype, "started");
type("number")(GloFluxState.prototype, "serverTime");
type("number")(GloFluxState.prototype, "elapsed");
type("number")(GloFluxState.prototype, "shrinkRadius");
type("number")(GloFluxState.prototype, "activeCoreCount");
type("number")(GloFluxState.prototype, "totalCoreCollections");
type("number")(GloFluxState.prototype, "totalChainBursts");
type("number")(GloFluxState.prototype, "activeChainPeak");
type("number")(GloFluxState.prototype, "longestChain");
type("number")(GloFluxState.prototype, "patchVersion");
type("number")(GloFluxState.prototype, "totalSurgeEvents");
type("number")(GloFluxState.prototype, "highestSurgeMeter");
type("string")(GloFluxState.prototype, "matchPhase");
type("number")(GloFluxState.prototype, "rematchVotes");
type("number")(GloFluxState.prototype, "rematchTarget");
type("number")(GloFluxState.prototype, "spectatorCount");
type("string")(GloFluxState.prototype, "partyCode");
type("string")(GloFluxState.prototype, "seedBadge");
type({ map: PlayerState })(GloFluxState.prototype, "players");
type({ map: EntityState })(GloFluxState.prototype, "entities");
type([GloFluxPowerSpawn])(GloFluxState.prototype, "powerSpawns");
