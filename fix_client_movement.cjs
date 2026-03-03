const fs = require('fs');
let p = 'C:/Users/laptop/twistedkart/frontend/src/modules/realtime/colyseus-babylon-client.js';
let c = fs.readFileSync(p, 'utf8');

// 1. Remove forced local reconciliation which causes the client to snap backward and break movement.
let recOld = `  reconcile(state) {
      if (!this.localMesh || !state?.players || !this.room) return;
      const self = state.players.get(this.room.sessionId);
      if (!self) return;

      this.localMesh.position.x = self.x;
      this.localMesh.position.y = self.y;
      this.localMesh.position.z = self.z;
      this.localMesh.rotationQuaternion = new Quaternion(self.rx, self.ry, self.rz, self.rw);

      const ackSeq = self.lastProcessedInput || 0;`;

let recNew = `  reconcile(state) {
      if (!this.localMesh || !state?.players || !this.room) return;
      const self = state.players.get(this.room.sessionId);
      if (!self) return;

      // DO NOT override position/rotation directly. Havok physics must run client-authoritatively!
      // Overriding position here causes severe jitter and ignores physics forces since the physics step overrides it.
      
      const ackSeq = self.lastProcessedInput || 0;`;

if (c.includes(recOld)) {
   c = c.replace(recOld, recNew);
   console.log("Fixed Reconcile Snap Bug");
}

// 2. Add spawn position logic
let spawnOld = `        // Phase 4: Invisible Solid Physics Kart Body to fix void falling     
        this.localMesh = MeshBuilder.CreateBox("local-player-phys", { width: 1.5, height: 1.0, depth: 2.0 }, this.scene);
        this.localMesh.position = new Vector3(0, 5, 0); // Drop safely on track
        this.localMesh.visibility = 0; // invisible collider`;

let spawnNew = `        // Phase 4: Invisible Solid Physics Kart Body to fix void falling     
        this.localMesh = MeshBuilder.CreateBox("local-player-phys", { width: 1.5, height: 1.0, depth: 2.0 }, this.scene);
        
        let startPos = {x: 0, y: 10, z: 0};
        if (trackInfo && trackInfo.startPositions && trackInfo.startPositions.length > 0) {
            // Pick a slot based on our current connected ID index
            let slot = 0;
            if (this.room && this.room.state && this.room.state.players) {
                let ids = Array.from(this.room.state.players.keys()).sort();
                slot = ids.indexOf(this.room.sessionId);
                if (slot < 0) slot = 0;
            }
            startPos = trackInfo.startPositions[slot % trackInfo.startPositions.length];
        }
        
        this.localMesh.position = new Vector3(startPos.x, startPos.y, startPos.z);
        this.localMesh.visibility = 0; // invisible collider`;

if (c.includes(spawnOld)) {
    c = c.replace(spawnOld, spawnNew);
    console.log("Added Spawn Code");
}

// 3. Optional: applyLocalPrediction refactor.
// Let's check how throttle works.
// Actually, wait, applying force every input is wrong because sendInput happens every ~16ms but physics ticks 60Hz asynchronously.
// If we use applyImpulse, it adds velocity correctly. But setLinearVelocity is fine if they want rigid arcade physics.
// Wait, one issue is `const dt = 1 / 60;` is hardcoded. So rotation is fixed.
// Is throttle logic preventing movement? 
// The problem was mostly likely `reconcile` snapping the player back every 50ms to strictly what the server processed, preventing smooth drive completely.

fs.writeFileSync(p, c);
