const fs = require('fs');
let b = fs.readFileSync('C:/Users/laptop/twistedkart/frontend/src/realtime-main.js', 'utf8');

const target = `    const splashScreen = document.getElementById('splash-screen');
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

    if (client.started) {
      setStatus(\`Connected (\${roomName}) â€¢ Match live\`);
    }`;

const target2 = `    const splashScreen = document.getElementById('splash-screen');
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

    if (client.started) {
      setStatus(\`Connected (\${roomName}) • Match live\`);
    }`;

const replacement = `    const splashScreen = document.getElementById('splash-screen');
    const isGameStarted = client.room && client.room.state && client.room.state.started;
    
    if (isGameStarted) {
        if (splashScreen) splashScreen.style.display = 'none';
        setStatus(\`Connected (\${roomName}) • Match live\`);
    } else if (client.room && client.room.state && client.room.state.players) { 
        const plDiv = document.getElementById('splash-players');
        const statusDiv = document.getElementById('splash-status');
        
        if (plDiv) {
            let html = '';
            let pCount = 0;
            client.room.state.players.forEach(p => {
                html += '<div class="splash-player" style="color: ' + (p.gloColor || p.playerColor || '#fff') + '; border: 1px solid ' + (p.gloColor || p.playerColor || '#fff') + '; padding: 10px; margin: 10px; font-weight: bold;">' + (p.name || 'Player') + ' [' + (p.kartId || 'Default') + ']</div>';
                pCount++;
            });
            if (plDiv.innerHTML !== html) {
                plDiv.innerHTML = html;
            }
            if (statusDiv) {
                if (pCount > 1) {
                    statusDiv.innerHTML = 'READY - HOST PRESS <span style="color:#0f0;">ENTER</span> TO START';
                } else {
                    statusDiv.textContent = 'WAITING FOR OTHERS...';
                }
            }
        }
    }`;

if (b.includes(target)) {
    b = b.replace(target, replacement);
} else if (b.includes(target2)) {
    b = b.replace(target2, replacement);
} else {
    // regex fallback
    b = b.replace(/const splashScreen = document\.getElementById\('splash-screen'\);[\s\S]*?(window\.requestAnimationFrame\(tick\);)/, replacement + "\n\n    $1");
}

fs.writeFileSync('C:/Users/laptop/twistedkart/frontend/src/realtime-main.js', b);
console.log("Done final splash patch");