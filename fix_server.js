const fs = require('fs');

const files = ['C:/Users/laptop/GLOKarts/realtime/src/rooms/RaceRoom.js', 'C:/Users/laptop/GLOKarts/realtime/src/rooms/BattleRoom.js'];

files.forEach(p => {
  let text = fs.readFileSync(p, 'utf8');
  
  let inputStart = text.indexOf('this.onMessage("input"');
  if (inputStart !== -1) {
    let inputEnd = text.indexOf('});', inputStart) + 3;
    let sub1 = text.substring(inputStart, inputEnd);
    let rep1 = `this.onMessage("input", (client, data) => {
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
    });`;
    text = text.replace(sub1, rep1);
  }

  let rep2Match = text.match(/this\.state\.players\.forEach\(\(p, id\) => \{[\s\S]*?\}\);/);
  if (rep2Match) {
    let rep2 = `this.state.players.forEach((p, id) => {
      const input = this.inputBySession.get(id);
      if (input && this.state.started) {
        // Phase 3: Update directly from client-authoritative Havok physics engine
        p.x = input.x; 
        p.y = input.y; 
        p.z = input.z;
        p.rx = input.rx; 
        p.ry = input.ry; 
        p.rz = input.rz; 
        p.rw = input.rw;
        p.lastProcessedInput = input.seq;
      }
    });`;
    text = text.replace(rep2Match[0], rep2);
  }
  
  fs.writeFileSync(p, text);
});
console.log('done via create_file js script');
