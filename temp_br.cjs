const fs = require('fs');
let p = 'C:/Users/laptop/twistedkart/realtime/src/rooms/BattleRoom.js';
if (fs.existsSync(p)) {
  let content = fs.readFileSync(p, 'utf8');
  let oldStr = `    this.onMessage("start", () => {
      this.state.started = true;
    });`;
  let newStr = `    this.onMessage("triggerStart", () => {
      this.broadcast("startSequence", {});
    });

    this.onMessage("start", () => {
      this.state.started = true;
    });`;
  if (content.indexOf(oldStr) !== -1) {
     content = content.replace(oldStr, newStr);
     fs.writeFileSync(p, content);
     console.log('BattleRoom updated');
  }
}
