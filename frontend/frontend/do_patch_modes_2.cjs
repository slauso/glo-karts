const fs = require('fs');
let t = fs.readFileSync('src/game-modes.js', 'utf8');
t = t.replace(/.*solo.*quick_race.*\n/g, '');
t = t.replace(/.*solo.*follow_the_leader.*\n/g, '');
t = t.replace(/.*solo.*soccer.*\n/g, '');
t = t.replace(/.*solo.*battle_solo.*\n/g, '');
t = t.replace(/.*solo.*three_strikes.*\n/g, '');
fs.writeFileSync('src/game-modes.js', t);
