const fs = require('fs');
let t = fs.readFileSync('src/game-modes.js', 'utf8');

// Rename categories
t = t.replace(/id:\s*'shop'/g, "id:    'garage'");
t = t.replace(/label:\s*'SHOP'/g, "label: 'GARAGE'");
t = t.replace(/category:\s*'shop'/g, "category: 'garage'");

t = t.replace(/label:\s*'LOCAL'/g, "label: '2 PLAYER SPLITSCREEN'");

// Rename Modes
t = t.replace(/label:\s*'Time Trial'/g, "label:    'Rally'");
t = t.replace(/label:\s*'Grand Prix'/g, "label:    'Glo Prix'");

// Remove modes safely by matching the objects directly until the closing   },
t = t.replace(/  quick_race: \{[\s\S]*?^  \},/m, '');
t = t.replace(/  battle_solo: \{[\s\S]*?^  \},/m, '');
t = t.replace(/  follow_the_leader: \{[\s\S]*?^  \},/m, '');
t = t.replace(/  soccer: \{[\s\S]*?^  \},/m, '');

// Clean up some newlines
t = t.replace(/\n\s*\n\s*\n/g, '\n\n');

fs.writeFileSync('src/game-modes.js', t);
