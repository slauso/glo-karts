const fs = require('fs');

let mainJs = fs.readFileSync('src/realtime-main.js', 'utf8');

if (!mainJs.includes('splash-players')) {
    const patchInit = \
  const splashMode = document.getElementById('splash-mode');
  if (splashMode) {
      const modeStr = (config?.gameMode || 'race').toUpperCase();
      const trackStr = (config?.trackId || 'COCOA TEMPLE').replace(/_/g, ' ').toUpperCase();
      splashMode.textContent = modeStr + ' - ' + trackStr;
  }
\;

    mainJs = mainJs.replace(
      "setStatus(\Connected (\). Waiting for match start...\);",
      "setStatus(\Connected (\). Waiting for match start...\);\n" + patchInit
    );

    const patchTick = \
    if (!client.started && client.room && client.room.state && client.room.state.players) {
        const plDiv = document.getElementById('splash-players');
        if (plDiv) {
            let html = '';
            let isEveryoneReady = true;
            client.room.state.players.forEach(p => {
                const isMe = p.id === client.room.sessionId;
                html += '<div class="splash-player" style="--pcolor:' + (p.gloColor || p.playerColor || '#fff') + '">' + (p.name || 'Player') + ' (' + (p.kartId || 'Default') + ')</div>';
            });
            if (plDiv.innerHTML !== html) {
                plDiv.innerHTML = html;
            }
        }
    }
\;

    mainJs = mainJs.replace(
      "if (client.started) {",
      patchTick + "\n    if (client.started) {"
    );

    fs.writeFileSync('src/realtime-main.js', mainJs, 'utf8');
    console.log("Patched realtime-main.js for splash screen!");
} else {
    console.log("Already patched realtime-main.js.");
}
