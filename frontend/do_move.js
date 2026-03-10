const fs = require('fs');
let code = fs.readFileSync('src/game-modes.js', 'utf8');
code = code.replace(/gloflux_race: \{[\s\S]*?\},/m, '');
code = code.replace(/gloflux_arena: \{/, 'gloflux: {');
code = code.replace(/id:\s*'gloflux_arena'/, "id: 'gloflux'");
code = code.replace(/category:\s*'gloflux'/, "category: 'online'");
code = code.replace(/label:\s*'Flux Arena'/, "label: 'gloFLUX'");
fs.writeFileSync('src/game-modes.js', code);
