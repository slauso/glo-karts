const fs = require('fs');
const path = 'c:/Users/laptop/twistedkart/frontend/src/gloflux-main.js';
let code = fs.readFileSync(path, 'utf8');

const importStatement = "import * as prematchLobby from './modules/realtime/prematch-lobby.js';\n";

if (!code.includes('prematchLobby')) {
    code = code.replace('import { publishDebugSnapshot', importStatement + 'import { publishDebugSnapshot');
}

const targetLocation = "await networkClient.connect(colyseusClient);\n        console.log('[gloFLUX] Connected to multiplayer room');";
const replacement = targetLocation + 

        const room = networkClient.room;
        prematchLobby.show(room.state, room.sessionId, preConfig);
        
        room.state.players.onAdd(() => prematchLobby.updatePlayers(room.state, room.sessionId));
        room.state.players.onRemove(() => prematchLobby.updatePlayers(room.state, room.sessionId));

        room.onMessage('countdown', (msg) => {
            console.log('Countdown', msg);
            prematchLobby.startCountdown(msg.durationMs / 1000);
        });

        room.onMessage('matchLive', () => {
             console.log('Match live!');
             prematchLobby.hide();
        });

        // Trigger start automatically for now, normally Host clicks start
        setTimeout(() => {
            if (networkClient && networkClient.triggerStart) {
                console.log('Triggering start!');
                networkClient.triggerStart();
            }
        }, 4000);
;

if (!code.includes('prematchLobby.show')) {
    code = code.replace(targetLocation, replacement);
}

fs.writeFileSync(path, code);
console.log('Main file patched');
