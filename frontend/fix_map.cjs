const fs = require('fs');
let p = 'C:/Users/laptop/twistedkart/frontend/src/modules/realtime/colyseus-babylon-client.js';
let content = fs.readFileSync(p, 'utf8');

// wait, it's safer to just replace using string indices.
let idx = content.indexOf('if (arenaResult && arenaResult.meshes) {');
let idxElse = content.indexOf('} else if (trackInfo.trackPath) {', idx);

if (idx !== -1 && idxElse !== -1) {
   let replaceFrom = content.substring(idx, idxElse);
   let replaceTo = `if (arenaResult && arenaResult.meshes) {
            arenaResult.meshes.forEach(mesh => {
               if (mesh.getTotalVertices() > 0) {
                  mesh.computeWorldMatrix(true);
                  new PhysicsAggregate(mesh, PhysicsShapeType.MESH, { mass: 0, friction: 0.5, restitution: 0.1 }, this.scene);
               }
            });
         }
       `;
   content = content.replace(replaceFrom, replaceTo);
   fs.writeFileSync(p, content);
   console.log('Fixed block ' + replaceFrom.length + ' bytes');
} else { console.log('not found'); }

