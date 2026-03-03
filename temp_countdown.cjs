const fs = require('fs');
let p = 'C:/Users/laptop/twistedkart/frontend/src/modules/realtime/colyseus-babylon-client.js';
let content = fs.readFileSync(p, 'utf8');

// replace startMatch and connect event
let joinEnd = content.indexOf('      this.room.onMessage("joined", () => {');
let startMatchStr = content.indexOf('    startMatch() {');

if (joinEnd !== -1 && startMatchStr !== -1) {
    let toRepl = content.substring(joinEnd, startMatchStr);

    let newCode = `      this.room.onMessage("joined", () => {
        console.log("[colyseus] joined match");
      });

      this.room.onMessage("startSequence", () => {
         this.startCountdown();
      });

      this.room.onMessage("matchEnd", (msg) => {
        console.log("[colyseus] matchEnd", msg);
      });

      return this.room;
    }

    startCountdown() {
      if (this.countdownActive) return;
      this.countdownActive = true;
      let count = 3;
      const el = document.getElementById('countdown-overlay');
      if (el) {
        el.style.display = 'block';
        el.innerText = count;
      }
      
      let timer = setInterval(() => {
         count--;
         if (count > 0) {
            if (el) el.innerText = count;
         } else if (count === 0) {
            if (el) {
               el.innerText = 'GO!';
               el.style.color = '#00ff00';
            }
            this.started = true;
         } else {
            clearInterval(timer);
            if (el) el.style.display = 'none';
            this.countdownActive = false;
         }
      }, 1000);
    }

`;

    content = content.replace(toRepl, newCode);
} else {
    console.log("Could not find joined/startMatch");
}

let startOld = `    startMatch() {
      if (this.room) Object.keys(this.room.state.players).length > 1 ? this.room.send("start", {}) : this.room.send("start", {});
    }`;
let startNew = `    startMatch() {
      if (this.room) this.room.send("startSequence", {});
    }`;

// Wait, the client right now has:
//     startMatch() {
//      if (this.room) this.room.send("start", {});
//    }

content = content.replace('    startMatch() {\n      if (this.room) this.room.send("start", {});\n    }', `    startMatch() {
      if (this.room) this.room.send("startSequence", {});
    }`);

let applyOld = 'if (!this.localMesh || !this.localKartAggregate) return;';
let applyNew = 'if (!this.localMesh || !this.localKartAggregate || !this.started) return;';
content = content.replace(applyOld, applyNew);

let applyOld2 = 'applyLocalPrediction() {';
let applyNew2 = `applyLocalPrediction() {
      if (!this.started && this.localKartAggregate) {
         this.localKartAggregate.body.setLinearVelocity(new BABYLON.Vector3(0,0,0));
         this.localKartAggregate.body.setAngularVelocity(new BABYLON.Vector3(0,0,0));
         return;
      }`;
content = content.replace(applyOld2, applyNew2);

let camOld = `      this.camera.radius = 10;
      this.camera.heightOffset = 4;
      this.camera.rotationOffset = 180;
      this.camera.cameraAcceleration = 0.05;
      this.camera.maxCameraSpeed = 20;
      // this.camera.attachControl(canvas, true);`;

let camNew = `      this.camera.radius = 8;
      this.camera.heightOffset = 3;
      this.camera.rotationOffset = 180;
      this.camera.cameraAcceleration = 0.1;
      this.camera.maxCameraSpeed = 50; 
      
      if (!this.camToggleBound) {
          window.addEventListener('keydown', (e) => {
             if (e.key.toLowerCase() === 'c' && this.camera) {
                this.camera.rotationOffset = this.camera.rotationOffset === 180 ? 0 : 180;
             }
          });
          this.camToggleBound = true;
      }`;
content = content.replace(camOld, camNew);

fs.writeFileSync(p, content);
console.log('Client updated');
