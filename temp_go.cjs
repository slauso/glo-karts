const fs = require('fs');
let p = 'C:/Users/laptop/twistedkart/frontend/src/modules/realtime/colyseus-babylon-client.js';
let content = fs.readFileSync(p, 'utf8');

// Also inject the GO visual disappear timer
let oldCode = `          this.started = true;
          // Send to server that we are live
          this.room.send("start", {});
       } else {`;

let newCode = `          this.started = true;
          // Send to server that we are live
          this.room.send("start", {});
          setTimeout(() => {
              if (el) el.style.display = 'none';
          }, 1500); // leave GO! on screen for 1.5s
       } else {`;

if (content.indexOf(oldCode) !== -1) {
  content = content.replace(oldCode, newCode);
  fs.writeFileSync(p, content);
  console.log("Updated GO element");
} else {
  console.log("Not found.");
}