const fs = require('fs');
const file = 'src/modules/realtime/colyseus-babylon-client.js';
let content = fs.readFileSync(file, 'utf8');

const regex = /let timer = setInterval\(\(\) => \{[\s\S]*?\}, 1000\);/m;
const replacement = \let timer = setInterval(() => {
       count--;
       if (count > 0) {
          if (el) el.innerText = count;
       } else if (count === 0) {
          if (el) {
             el.innerText = 'GO!';
             el.style.color = '#00ff00';
          }
          this.started = true;
          // Send to server that we are live      
          this.room.send("start", {});

          if (splashScreen) {
              splashScreen.style.opacity = '0';   
          }
          setTimeout(() => { if (splashScreen) splashScreen.style.display = 'none'; }, 500);
          clearInterval(timer);
       }
    }, 1000);\;

content = content.replace(regex, replacement);
fs.writeFileSync(file, content);
console.log('Fixed file');
