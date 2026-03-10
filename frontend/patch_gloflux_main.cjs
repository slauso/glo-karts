const fs = require('fs');
const path = 'src/gloflux-main.js';
let code = fs.readFileSync(path, 'utf8');

const importStatement = import * as prematchLobby from './modules/realtime/prematch-lobby.js';\n;
if(!code.includes('prematchLobby')) {
    code = code.replace("import { publishDebugSnapshot", importStatement + "import { publishDebugSnapshot");
}

const triggerStr = 
        await networkClient.connect(colyseusClient);
        console.log('[gloFLUX] Connected to multiplayer room');

        const room = networkClient.room;
        prematchLobby.show(room.state, room.sessionId, preConfig);
        room.state.players.onAdd(() => prematchLobby.updatePlayers(room.state, room.sessionId));
        room.state.players.onRemove(() => prematchLobby.updatePlayers(room.state, room.sessionId));

        room.onMessage('countdown', (msg) => {
          prematchLobby.startCountdown(msg.durationMs / 1000);
        });

        room.onMessage('matchLive', () => {
          prematchLobby.hide();
        });

        // Trigger start automatically after short delay (acts like lobby auto-ready)
        setTimeout(() => {
          networkClient.triggerStart();
        }, 4000); 
;

code = code.replace("await networkClient.connect(colyseusClient);\n        console.log('[gloFLUX] Connected to multiplayer room');", triggerStr);

fs.writeFileSync(path, code);
console.log('Main patched');
