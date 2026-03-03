import fs from 'fs';

let p = 'C:/Users/laptop/twistedkart/realtime/src/rooms/RaceRoom.js';
let file = fs.readFileSync(p, 'utf8');

file = file.replace(/this\.onMessage\("input", \(client, data\) => \{[\s\S]*?\}\);/g,
\	his.onMessage("input", (client, data) => {
        this.inputBySession.set(client.sessionId, {
          seq: Number(data.seq || 0),
          throttle: Number(data.throttle || 0),
          steer: Number(data.steer || 0),
          brake: Number(data.brake || 0),
          x: Number(data.x || 0),
          y: Number(data.y || 0),
          z: Number(data.z || 0),
          rx: Number(data.rx || 0),
          ry: Number(data.ry || 0),
          rz: Number(data.rz || 0),
          rw: Number(data.rw !== undefined ? data.rw : 1)
        });
      });\
);

file = file.replace(/this\.state\.players\.forEach\(\(p, id\) => \{[\s\S]*?\}\);/g,
\	his.state.players.forEach((p, id) => {
        const input = this.inputBySession.get(id);
        if (input && this.state.started) {
          // Phase 3: Client-Authoritative Kinematics relay
          p.x = input.x;
          p.y = input.y;
          p.z = input.z;
          p.rx = input.rx;
          p.ry = input.ry;
          p.rz = input.rz;
          p.rw = input.rw;
          p.lastProcessedInput = input.seq;
        }
      });\
);

fs.writeFileSync(p, file);

p = 'C:/Users/laptop/twistedkart/realtime/src/rooms/BattleRoom.js';
file = fs.readFileSync(p, 'utf8');

file = file.replace(/this\.onMessage\("input", \(client, data\) => \{[\s\S]*?\}\);/g,
\	his.onMessage("input", (client, data) => {
        this.inputBySession.set(client.sessionId, {
          seq: Number(data.seq || 0),
          throttle: Number(data.throttle || 0),
          steer: Number(data.steer || 0),
          brake: Number(data.brake || 0),
          fire: !!data.fire,
          x: Number(data.x || 0),
          y: Number(data.y || 0),
          z: Number(data.z || 0),
          rx: Number(data.rx || 0),
          ry: Number(data.ry || 0),
          rz: Number(data.rz || 0),
          rw: Number(data.rw !== undefined ? data.rw : 1)
        });
      });\
);

file = file.replace(/this\.state\.players\.forEach\(\(p, id\) => \{[\s\S]*?\}\);/g,
\	his.state.players.forEach((p, id) => {
        const input = this.inputBySession.get(id);
        if (input && this.state.started) {
          p.x = input.x;
          p.y = input.y;
          p.z = input.z;
          p.rx = input.rx;
          p.ry = input.ry;
          p.rz = input.rz;
          p.rw = input.rw;
          p.lastProcessedInput = input.seq;
        }
      });\
);

fs.writeFileSync(p, file);
console.log('done edit rooms');
