const fs = require('fs');
let code = fs.readFileSync('src/game-modes.js', 'utf8');

const regex = /gloflux:\s*\{\s*id:\s*'gloflux',\s*label:\s*'gloFLUX',[\s\S]*?icon:\s*'fa-radiation',\s*\},\s*\};/m;
if (code.match(regex)) {
    code = code.replace(regex, '};');
    fs.writeFileSync('src/game-modes.js', code);
    console.log('Category patched.');
} else {
    console.log('Category not found.');
}
