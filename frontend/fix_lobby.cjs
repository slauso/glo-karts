const fs = require('fs');
let code = fs.readFileSync('src/lobby.js', 'utf8');

code = code.replace(/const isGloflux = modeEntry\?\.category === 'gloflux';/g, "const isGloflux = modeEntry?.id === 'gloflux' || modeEntry?.id?.startsWith('gloflux_');");

fs.writeFileSync('src/lobby.js', code);
console.log('Fixed lobby.js isGloflux check');
