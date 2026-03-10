@
const fs = require('fs');
let code = fs.readFileSync('src/gloflux-main.js', 'utf8');

const targetRegex = /const room = networkClient\.room;([\s\S]*?)setTimeout\(\(\) => \{/m;
const replacement = 
          const mockState = { players: networkClient.players };
          prematchLobby.show(mockState, networkClient.sessionId, preConfig);
          
          networkClient.on('playerJoin', () => prematchLobby.updatePlayers(mockState, networkClient.sessionId));
          networkClient.on('playerLeave', () => prematchLobby.updatePlayers(mockState, networkClient.sessionId));

          networkClient.on('countdown', (msg) => {
              console.log('Countdown', msg);
              prematchLobby.startCountdown(msg.durationMs / 1000);
          });

          networkClient.on('matchLive', () => {
               console.log('Match live!');
               prematchLobby.hide();
          });

          // Trigger start automatically for now
          setTimeout(() => {
;

if (code.match(targetRegex)) {
    code = code.replace(targetRegex, replacement);
    fs.writeFileSync('src/gloflux-main.js', code);
    console.log('Main file patched');
} else {
    console.log('Regex not matched');
}
@
