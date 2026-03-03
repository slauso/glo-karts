import fs from 'fs';
let p = 'C:/Users/laptop/twistedkart/realtime/src/rooms/RaceRoom.js';
let file = fs.readFileSync(p, 'utf8');

let startIndex = file.indexOf('this.state.players.forEach((p, id) => {');
let endIndex = file.lastIndexOf('});') + 3;

if(startIndex > -1) {
  let toReplace = file.substring(startIndex, endIndex);
  file = file.replace(toReplace,
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
  
  let iStart = file.indexOf('this.onMessage("input", (client, data) => {');
  let iEnd = file.indexOf('});', iStart) + 3;
  let iReplace = file.substring(iStart, iEnd);
  file = file.replace(iReplace,
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
  
  fs.writeFileSync(p, file);
  console.log('RaceRoom updated');
}

p = 'C:/Users/laptop/twistedkart/realtime/src/rooms/BattleRoom.js';
file = fs.readFileSync(p, 'utf8');

startIndex = file.indexOf('this.state.players.forEach((p, id) => {');
endIndex = file.lastIndexOf('});') + 3;

if(startIndex > -1) {
  let toReplace = file.substring(startIndex, endIndex);
  file = file.replace(toReplace,
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
  
  let iStart = file.indexOf('this.onMessage("input", (client, data) => {');
  let iEnd = file.indexOf('});', iStart) + 3;
  let iReplace = file.substring(iStart, iEnd);
  file = file.replace(iReplace,
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
  fs.writeFileSync(p, file);
  console.log('BattleRoom updated');
}
