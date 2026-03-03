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