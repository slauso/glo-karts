const fs = require('fs');
let c = fs.readFileSync('src/lobby.js', 'utf8');
c = c.replace(/state\.modeId \|\| 'gloflux_arena'/g, "state.modeId || 'gloflux'");
fs.writeFileSync('src/lobby.js', c);
console.log('Fixed lobby.js fallback');