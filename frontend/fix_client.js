const fs=require('fs'); 
let b=fs.readFileSync('src/modules/realtime/colyseus-babylon-client.js', 'utf8');
const replacement = \startCountdown() {
    const el = document.getElementById('splash-countdown');
    const splashScreen = document.getElementById('splash-screen');
    let count = 3;

    if (el) el.innerText = count;

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
          this.room.send("start", {});

          if (splashScreen) {
              splashScreen.style.opacity = '0';
          }
          setTimeout(() => { if (splashScreen) splashScreen.style.display = 'none'; }, 500);
          clearInterval(timer);
       }
    }, 1000);
  }

  startMatch()\;
b = b.replace(/startCountdown\(\)\s*\{[\s\S]*?startMatch\(\)/, replacement);
fs.writeFileSync('src/modules/realtime/colyseus-babylon-client.js', b);
console.log("Fixed syntax");
