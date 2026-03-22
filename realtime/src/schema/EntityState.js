import { Schema, type } from "@colyseus/schema";

export class EntityState extends Schema {
  constructor() {
    super();
    this.id = "";
    this.type = "item_box";   // item_box | projectile
    this.subType = "";        // missile | bowling_ball | shield
    this.ownerId = "";
    
    this.x = 0;
    this.y = 0;
    this.z = 0;
    
    this.vx = 0;  // velocity (for projectiles)
    this.vy = 0;
    this.vz = 0;

    this.rx = 0;
    this.ry = 0;
    this.rz = 0;
    this.rw = 1;

    this.active = true;
    this.respawnTimer = 0;
    this.damage = 0;          // damage dealt on hit
    this.lifespan = 0;        // ms remaining before auto-despawn
    this.targetId = "";       // homing target player id (empty = no homing)
  }
}

type("string")(EntityState.prototype, "id");
type("string")(EntityState.prototype, "type");
type("string")(EntityState.prototype, "subType");
type("string")(EntityState.prototype, "ownerId");
type("string")(EntityState.prototype, "targetId");

type("number")(EntityState.prototype, "x");
type("number")(EntityState.prototype, "y");
type("number")(EntityState.prototype, "z");

type("number")(EntityState.prototype, "vx");
type("number")(EntityState.prototype, "vy");
type("number")(EntityState.prototype, "vz");

type("number")(EntityState.prototype, "rx");
type("number")(EntityState.prototype, "ry");
type("number")(EntityState.prototype, "rz");
type("number")(EntityState.prototype, "rw");

type("boolean")(EntityState.prototype, "active");
type("number")(EntityState.prototype, "respawnTimer");
type("number")(EntityState.prototype, "damage");
type("number")(EntityState.prototype, "lifespan");