const fs = require('fs');
let t = fs.readFileSync('src/modules/single-player-routing.js', 'utf8');

t = t.replace(/'three_strikes',\n\s*/g, '');
t = t.replace(/\s*case 'three_strikes':[\s\S]*?break;/g, '');
t = t.replace(/\s*case 'three_strikes':\n/g, '');

fs.writeFileSync('src/modules/single-player-routing.js', t);
