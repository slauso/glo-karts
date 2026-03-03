import { Schema, type } from "@colyseus/schema";

export class EntityState extends Schema {
  constructor() {
    super();
    this.id = "";
    this.type = "item_box";
    this.ownerId = "";
    
    this.x = 0;
    this.y = 0;
    this.z = 0;
    
    this.rx = 0;
    this.ry = 0;
    this.rz = 0;
    this.rw = 1;

    this.active = true;
    this.respawnTimer = 0;
  }
}

type("string")(EntityState.prototype, "id");
type("string")(EntityState.prototype, "type");
type("string")(EntityState.prototype, "ownerId");

type("number")(EntityState.prototype, "x");
type("number")(EntityState.prototype, "y");
type("number")(EntityState.prototype, "z");

type("number")(EntityState.prototype, "rx");
type("number")(EntityState.prototype, "ry");
type("number")(EntityState.prototype, "rz");
type("number")(EntityState.prototype, "rw");

type("boolean")(EntityState.prototype, "active");
type("number")(EntityState.prototype, "respawnTimer");