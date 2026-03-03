const fs = require('fs');
let p = 'C:/Users/laptop/twistedkart/frontend/src/modules/realtime/colyseus-babylon-client.js';
let content = fs.readFileSync(p, 'utf8');

// The file got completely borked in the sendInput through reconcile section. Let's find start and end of that mess.
let startIndex = content.indexOf('    sendInput(input) {');
let syncIndex = content.indexOf('    syncRemoteMeshes(state) {');
if (startIndex !== -1 && syncIndex !== -1) {
  let toReplace = content.substring(startIndex, syncIndex);
  let rep = `    sendInput(input) {
      if (!this.room || !this.localMesh || !this.localMesh.rotationQuaternion) return;
      const seq = ++this.inputSeq;
      const payload = {
        seq,
        throttle: Number(input.throttle || 0),
        steer: Number(input.steer || 0),
        brake: Number(input.brake || 0),
        fire: !!input.fire,
        x: this.localMesh.position.x,
        y: this.localMesh.position.y,
        z: this.localMesh.position.z,
        rx: this.localMesh.rotationQuaternion.x || 0,
        ry: this.localMesh.rotationQuaternion.y || 0,
        rz: this.localMesh.rotationQuaternion.z || 0,
        rw: this.localMesh.rotationQuaternion.w || 1
      };
      this.applyLocalPrediction(payload);
      this.pendingInputs.push(payload);
      this.room.send("input", payload);
    }

    applyLocalPrediction(input) {
      if (!this.localMesh || !this.localKartAggregate) return;

      const body = this.localKartAggregate.body;
      const transform = this.localMesh;
      const dt = 1 / 60;

      if (input.steer !== 0) {
          transform.rotate(Vector3.Up(), input.steer * 2.5 * dt);
      }

      if (input.throttle !== 0) {
          const forwardSpeed = 30; 
          const force = transform.forward.scale(-input.throttle * forwardSpeed);
          let currentVel = body.getLinearVelocity();
          body.setLinearVelocity(new Vector3(force.x, currentVel.y, force.z));  
      } else {
          let currentVel = body.getLinearVelocity();
          body.setLinearVelocity(new Vector3(currentVel.x * 0.95, currentVel.y, currentVel.z * 0.95));
      }
    }

    reconcile(state) {
      if (!this.localMesh || !state?.players || !this.room) return;
      const self = state.players.get(this.room.sessionId);
      if (!self) return;

      const posDiff = new Vector3(self.x, self.y, self.z).subtract(this.localMesh.position).length();
      if (posDiff > 15.0) { 
        this.localMesh.position.x = self.x;
        this.localMesh.position.y = self.y;
        this.localMesh.position.z = self.z;
        this.localMesh.rotationQuaternion = new Quaternion(self.rx, self.ry, self.rz, self.rw);
      }

      const ackSeq = self.lastProcessedInput || 0;
      this.pendingInputs = this.pendingInputs.filter((i) => i.seq > ackSeq);
    }

`;
  content = content.replace(toReplace, rep);
}

// now fix syncRemoteMeshes interpolation instead of snapping
let meshSnapRegex = /\} else if \(mesh && mesh\.position\) \{[\s\S]*?\}/g;
content = content.replace(meshSnapRegex, `} else if (mesh && mesh.position) {
          const targetPos = new Vector3(player.x, player.y, player.z);
          const targetRot = new Quaternion(player.rx, player.ry, player.rz, player.rw);
          
          mesh.position = Vector3.Lerp(mesh.position, targetPos, 0.3);
          if (mesh.rotationQuaternion) {
            mesh.rotationQuaternion = Quaternion.Slerp(mesh.rotationQuaternion, targetRot, 0.3);
          } else {
            mesh.rotationQuaternion = targetRot;
          }
        }`);

fs.writeFileSync(p, content);
console.log('fixed client!');
