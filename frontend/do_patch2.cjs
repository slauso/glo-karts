const fs = require('fs');
let b = fs.readFileSync('C:/Users/laptop/twistedkart/frontend/src/realtime-main.js', 'utf8');

b = b.replace('const input = createInputState();', `  const splashMode = document.getElementById('splash-mode');
  if (splashMode) {
      const modeStr = (config?.gameMode || 'race').toUpperCase();
      const trackStr = (config?.trackId || 'COCOA TEMPLE').replace(/_/g, ' ').toUpperCase();
      splashMode.textContent = modeStr + ' - ' + trackStr;
  }

  const input = createInputState();`);

b = b.replace('if (client.started) {', `    const splashScreen = document.getElementById('splash-screen');
    if (client.started) {
        if (splashScreen) splashScreen.style.display = 'none';
    } else if (client.room && client.room.state && client.room.state.players) {
        const plDiv = document.getElementById('splash-players');
        if (plDiv) {
            let html = '';
            client.room.state.players.forEach(p => {
                html += '<div class="splash-player" style="color: ' + (p.gloColor || p.playerColor || '#fff') + '">' + (p.name || 'Player') + ' (' + (p.kartId || 'Default') + ')</div>';
            });
            if (plDiv.innerHTML !== html) {
                plDiv.innerHTML = html;
            }
        }
    }

    if (client.started) {`);

fs.writeFileSync('C:/Users/laptop/twistedkart/frontend/src/realtime-main.js', b);
console.log("Done");