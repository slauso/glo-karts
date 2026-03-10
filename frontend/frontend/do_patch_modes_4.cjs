const fs = require('fs');
let t = fs.readFileSync('src/game-modes.js', 'utf8');

// remove tools category specifically from CATEGORIES
t = t.replace(/  tools: \{\s*id:\s*'tools',[\s\S]*?^  \},/m, '');

// remove gloflux category specifically from CATEGORIES
t = t.replace(/  gloflux: \{\s*id:\s*'gloflux',\s*label:\s*'gloFLUX',[\s\S]*?^  \},/m, '');

// remove three_strikes from MODE_REGISTRY
t = t.replace(/  three_strikes: \{\s*id:\s*'three_strikes',[\s\S]*?^  \},/m, '');

fs.writeFileSync('src/game-modes.js', t);
