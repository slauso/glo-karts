const fs = require('fs');
let p = 'C:/Users/laptop/twistedkart/frontend/src/modules/realtime/colyseus-babylon-client.js';
let c = fs.readFileSync(p, 'utf8');

let spawnOld = `        // Phase 4: Invisible Solid Physics Kart Body to fix void falling
        this.localMesh = MeshBuilder.CreateBox("local-player-phys", { width: 1.5, height: 1.0, depth: 2.0 }, this.scene);
        this.localMesh.position = new Vector3(0, 5, 0); // Drop safely on track
        this.localMesh.visibility = 0; // invisible collider`;

let spawnNew = `        // Phase 4: Invisible Solid Physics Kart Body to fix void falling
        this.localMesh = MeshBuilder.CreateBox("local-player-phys", { width: 1.5, height: 1.0, depth: 2.0 }, this.scene);
        
        let startPos = {x: 0, y: 15, z: 0};
        if (trackInfo && trackInfo.startPositions && trackInfo.startPositions.length > 0) {
            startPos = trackInfo.startPositions[0];
            // Random offset so they don't exactly stack
            startPos = { x: startPos.x + (Math.random() * 4 - 2), y: startPos.y + 2, z: startPos.z + (Math.random() * 4 - 2) };
        }
        
        this.localMesh.position = new Vector3(startPos.x, startPos.y, startPos.z);
        this.localMesh.visibility = 0; // invisible collider`;

c = c.replace(spawnOld, spawnNew);
fs.writeFileSync(p, c);
console.log("Fixed spawn!");
