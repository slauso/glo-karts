const fs = require('fs');
let code = fs.readFileSync('src/game-modes.js', 'utf8');

// Remove gloflux category
code = code.replace(/gloflux:\s*\{\s*id:\s*'gloflux',\s*label:\s*'gloFLUX',[\s\S]*?icon:\s*'fa-radiation',\s*\},/m, '');

// Rename gloflux_arena to gloflux and change category
code = code.replace(/gloflux_arena:\s*\{/, 'gloflux: {');
code = code.replace(/id:\s*'gloflux_arena'/, "id:       'gloflux'");
code = code.replace(/category:\s*'gloflux'/, "category: 'online'");
code = code.replace(/label:\s*'Flux Arena'/, "label:    'gloFLUX'");

// Remove gloflux_race
code = code.replace(/gloflux_race:\s*\{[\s\S]*?buildConfig\(lobby\) \{[\s\S]*?\},[\s\n\r]*\},/m, '');

fs.writeFileSync('src/game-modes.js', code);
console.log('done replacing game-modes');