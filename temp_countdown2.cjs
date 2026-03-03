const fs = require('fs');
let p = 'C:/Users/laptop/twistedkart/frontend/src/modules/realtime/colyseus-babylon-client.js';
let content = fs.readFileSync(p, 'utf8');

let mOld = `    this.room.onMessage("matchEnd", (msg) => {
      console.log("[colyseus] matchEnd", msg);
    });`;

let mNew = `    this.room.onMessage("startSequence", () => {
       console.log("Starting sequence");
       this.started = false;
       this.startCountdown();
    });
    
    this.room.onMessage("matchEnd", (msg) => {
      console.log("[colyseus] matchEnd", msg);
    });`;

content = content.replace(mOld, mNew);

let stOld = `  startMatch() {
    if (this.room) this.room.send("start", {});
  }`;

let stNew = `  startMatch() {
    if (this.room) this.room.send("startSequence", {});
  }

  startCountdown() {
    if (this.countdownActive) return;
    this.countdownActive = true;
    let count = 3;
    const el = document.getElementById('countdown-overlay');
    if (el) {
      el.style.display = 'block';
      el.innerText = count;
      el.style.color = '#fff';
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
          // When 0 hits, we actually tell server to put room into live state if we want, or the server coordinates it.
          // For now, let's just send "start" again to switch the server state.
          this.room.send("start", {});
       } else {
          clearInterval(timer);
          if (el) el.style.display = 'none';
          this.countdownActive = false;
       }
    }, 1000);
  }`;

content = content.replace(stOld, stNew);

// In applyLocalPrediction, ensure it aborts if not started
let apOld = `  applyLocalPrediction() {
      if (!this.started && this.localKartAggregate) {`;
      
// Wait, my previous script modified `applyLocalPrediction() {`. Let's check what it is now.
fs.writeFileSync(p, content);
