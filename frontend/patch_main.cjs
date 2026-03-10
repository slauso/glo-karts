const fs = require('fs');
let code = fs.readFileSync('src/gloflux-main.js', 'utf8');

const imp = "import * as prematchLobby from './modules/realtime/prematch-lobby.js';\n";
if (!code.includes('prematchLobby')) {
    code = code.replace('import { publishDebugSnapshot', imp + 'import { publishDebugSnapshot');
}

const loc = "await networkClient.connect(colyseusClient);\n        console.log('[gloFLUX] Connected to multiplayer room');";

const newLoc = loc + `

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

        // Trigger start automatically for now
        setTimeout(() => {
            if (networkClient && networkClient.triggerStart) {
                console.log('Triggering start!');
                networkClient.triggerStart();
            }
        }, 4000);
`;

if (!code.includes('prematchLobby.show')) {
    code = code.replace(loc, newLoc);
}

fs.writeFileSync('src/gloflux-main.js', code);
console.log('Done patching gloflux-main.js!');