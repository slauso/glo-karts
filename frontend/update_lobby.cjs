const fs = require('fs');
const path = 'C:/Users/laptop/twistedkart/frontend/src/lobby.js';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(/gameMode: 'battle',\r?\n\s*arenaId,\r?\n\s*weaponsEnabled,/g, 
  'gameMode: \'battle\',\n' +
  '        arenaId,\n' +
  '        weaponSet: document.getElementById(\'battle-weapon-set\')?.value || this.recommendedWeaponSet,\n' +
  '        parityEnabled: true,\n' +
  '        starterWeapon: \'bowling\',\n' +
  '        starterAmmo: 1,\n' +
  '        weaponsEnabled,'
);

fs.writeFileSync(path, content, 'utf8');
