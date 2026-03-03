const fs = require('fs');
let p = 'C:/Users/laptop/twistedkart/frontend/src/modules/realtime/colyseus-babylon-client.js';
let c = fs.readFileSync(p, 'utf8');

c = c.replace(
"        this.localKartAggregate = new PhysicsAggregate(this.localMesh, PhysicsShapeType.BOX, { mass: 500, friction: 0.1, restitution: 0.1 }, this.scene);",
"        this.localKartAggregate = new PhysicsAggregate(this.localMesh, PhysicsShapeType.BOX, { mass: 500, friction: 0.1, restitution: 0.1 }, this.scene);\n        this.localKartAggregate.body.disablePreStep = false; // Allow manual positioning overrides for grids");

let evOld = `      this.room.onMessage("joined", () => {
        // Don't start immediately, wait for startSequence
        // Default to true if no start sequence fired (for debugging) but normally false.
        this.started = false;
      });`;
let evNew = `      this.room.onMessage("joined", (msg) => {
        this.started = false;
        
        // Spawn grid sorting
        if (msg && msg.room) {
            let slot = 0;
            if (this.room.state && this.room.state.players) {
                 let ids = Array.from(this.room.state.players.keys()).sort();
                 slot = ids.indexOf(this.room.sessionId);
                 if(slot < 0) slot = 0;
            }
            // Fetch track info to get start positions
            const gMode = msg.mode || "race";
            const currentTrackId = this.room.state.trackId || (gMode === "battle" ? "battleisland" : "map1");
            let tInfo = gMode === "battle" ? resolveArenaAsset(currentTrackId) : resolveTrackAsset(currentTrackId);
            
            if (tInfo && tInfo.startPositions && tInfo.startPositions.length > 0) {
                 let pos = tInfo.startPositions[slot % tInfo.startPositions.length];
                 if (this.localMesh) {
                     this.localMesh.position = new Vector3(pos.x, pos.y + 0.5, pos.z);
                     this.localKartAggregate.body.setLinearVelocity(new Vector3(0,0,0));
                     this.localKartAggregate.body.setAngularVelocity(new Vector3(0,0,0));
                 }
            }
        }
      });`;
      
c = c.replace(evOld, evNew);
fs.writeFileSync(p, c);
console.log("Spawn grid logic injected");