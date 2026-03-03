import fs from 'fs';

const p = 'C:/Users/laptop/twistedkart/frontend/src/modules/realtime/colyseus-babylon-client.js';
let file = fs.readFileSync(p, 'utf8');

file = file.replace(/this\.localMesh\.position\.x = self\.x;[\s\S]*?for \(const pending of this\.pendingInputs\) {\s*this\.applyLocalPrediction\(pending\);\s*}/g,
\      // Phase 3: Kinematic Server Authority
      const posDiff = new Vector3(self.x, self.y, self.z).subtract(this.localMesh.position).length();
      if (posDiff > 15.0) { // Only snap if drift is extreme (e.g. respawns)
        this.localMesh.position.x = self.x;
        this.localMesh.position.y = self.y;
        this.localMesh.position.z = self.z;
        this.localMesh.rotationQuaternion = new Quaternion(self.rx, self.ry, self.rz, self.rw);
      }

      const ackSeq = self.lastProcessedInput || 0;
      this.pendingInputs = this.pendingInputs.filter((i) => i.seq > ackSeq);\
);

// ALSO update syncRemoteMeshes interpolation
file = file.replace(/\} else if \(mesh && mesh\.position\) \{[\s\S]*?\}/g,
\} else if (mesh && mesh.position) {
          // Phase 3: Network Tweening (Slerp and Lerp) over 60hz TICK_RATE (approx 16ms)
          const targetPos = new Vector3(player.x, player.y, player.z);
          const targetRot = new Quaternion(player.rx, player.ry, player.rz, player.rw);
          
          mesh.position = Vector3.Lerp(mesh.position, targetPos, 0.3);
          if (mesh.rotationQuaternion) {
            mesh.rotationQuaternion = Quaternion.Slerp(mesh.rotationQuaternion, targetRot, 0.3);
          } else {
            mesh.rotationQuaternion = targetRot;
          }
        }\
);

fs.writeFileSync(p, file);
console.log('done edit frontend client');
