const fs = require('fs');
let t = fs.readFileSync('src/game-modes.js', 'utf8');

// Remove three_strikes mode
t = t.replace(/  three_strikes: \{[\s\S]*?^  \},/m, '');

// Remove tools category
t = t.replace(/  tools: \{[\s\S]*?^  \},/m, '');

// Remove gloflux category
t = t.replace(/  gloflux: \{[\s\S]*?^  \},/m, '');

fs.writeFileSync('src/game-modes.js', t);
