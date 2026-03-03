const fs = require('fs');

let p = 'C:/Users/laptop/twistedkart/frontend/src/modules/realtime/colyseus-babylon-client.js';
let content = fs.readFileSync(p, 'utf8');

// Replace camera attach
content = content.replace('this.camera.attachControl(canvas, true);', '// this.camera.attachControl(canvas, true);');

// Fix track map physics hierarchy processing.
let mapPhysRegex = /if \(arenaResult && arenaResult\.meshes\) \{[\s\S]*?\}\s*\}/g;
let repMap = `if (arenaResult && arenaResult.meshes) {
             arenaResult.meshes.forEach(mesh => {
                if (mesh.getTotalVertices() > 0) {
                   mesh.computeWorldMatrix(true);
                   new PhysicsAggregate(mesh, PhysicsShapeType.MESH, { mass: 0, friction: 0.5, restitution: 0.1 }, this.scene);
                }
             });
          }`;
content = content.replace(mapPhysRegex, repMap);

let kartInitStart = content.indexOf('const pathParts = pathStr.split(\'/\');');
let kartInitEnd = content.indexOf('this.camera.lockedTarget = this.localMesh;', kartInitStart);
if (kartInitStart > 0 && kartInitEnd > 0) {
  let toReplace = content.substring(kartInitStart, kartInitEnd + 42);
  let rep = `const pathParts = pathStr.split('/');
        const filename = pathParts.pop();
        const result = await SceneLoader.ImportMeshAsync("", pathParts.join('/') + '/', filename, this.scene);
        
        // Phase 4: Invisible Solid Physics Kart Body to fix void falling
        this.localMesh = MeshBuilder.CreateBox("local-player-phys", { width: 1.5, height: 1.0, depth: 2.0 }, this.scene);
        this.localMesh.position = new Vector3(0, 5, 0); // Drop safely on track
        this.localMesh.visibility = 0; // invisible collider
        
        // Attach visual glTF to physics body
        let visualRoot = result.meshes[0];
        visualRoot.setParent(this.localMesh);
        visualRoot.position = new Vector3(0, -0.5, 0); // floor offset
        
        if (kartInfo.scale && kartInfo.scale !== 1) {
           visualRoot.scaling = new Vector3(kartInfo.scale, kartInfo.scale, kartInfo.scale);
        }

        this.localKartAggregate = new PhysicsAggregate(this.localMesh, PhysicsShapeType.BOX, { mass: 500, friction: 0.1, restitution: 0.1 }, this.scene);
        
        // Restrict unwanted tipping temporarily while mapping to primitive controls
        this.localKartAggregate.body.setMassProperties({ inertia: new Vector3(0, 500, 0) });

        this.camera.lockedTarget = this.localMesh;`;
  
  content = content.replace(toReplace, rep);
}

// Modify STK Physics applyLocalPrediction
let physStart = content.indexOf('    applyLocalPrediction(input) {');
let physEnd = content.indexOf('    reconcile(state)', physStart);
if (physStart > 0 && physEnd > 0) {
   let toReplace2 = content.substring(physStart, physEnd);
   let rep2 = `    applyLocalPrediction(input) {
      if (!this.localMesh || !this.localKartAggregate) return;

      const body = this.localKartAggregate.body;
      const transform = this.localMesh;
      const dt = 1 / 60;

      // STK Physics Dynamics: Smooth steering response
      if (input.steer !== 0) {
          transform.rotate(Vector3.Up(), input.steer * 2.5 * dt);
      }

      let currentVel = body.getLinearVelocity();
      
      // Acceleration via realistic force propagation
      if (input.throttle !== 0) {
          // Adjust power to track scale.
          const power = 1000; 
          const moveDir = transform.forward.scale(-input.throttle * power * dt); 
          body.applyImpulse(moveDir, transform.getAbsolutePosition());
      } 
      
      // Drag/Friction to stop sliding. Only dampen X/Z to preserve Y gravity!
      let newVel = body.getLinearVelocity();
      let drag = input.brake > 0 ? 0.90 : 0.98;
      body.setLinearVelocity(new Vector3(newVel.x * drag, newVel.y, newVel.z * drag));
    }

`;
   content = content.replace(toReplace2, rep2);
}

fs.writeFileSync(p, content);
console.log('Fixed Physics Script Applied!');
