const fs = require('fs');
let code = fs.readFileSync('src/game-modes.js', 'utf8');

code = code.replace(/id:\s*'gloflux',\s*category:\s*'gloflux',/, "id:       'gloflux',\n    category: 'online',");

fs.writeFileSync('src/game-modes.js', code);
console.log('done replacing category parameter');