const fs = require('fs');
const path = 'C:/Users/laptop/GLOKarts/frontend/src/modules/battle/weapons.js';
let content = fs.readFileSync(path, 'utf8');

// 1. Import resolveWeaponSet
content = content.replace(/import \* as THREE from 'three';/, 
  'import * as THREE from \'three\';\nimport { resolveWeaponSet } from \'../content-registry.js\';'
);

// 2. Replace WEAPON_TYPES
content = content.replace(/const WEAPON_TYPES = \{[\s\S]*?\};\n/, 
  'let weaponTypes = {};\n'
);

// 3. Add texture loader
content = content.replace(/const state = \{[\s\S]*?\};\n/, 
  '$&\nconst textureLoader = new THREE.TextureLoader();\nconst giftTexture = textureLoader.load(\'/textures/items/gift.png\');\nconst giftMaterial = new THREE.SpriteMaterial({ map: giftTexture, color: 0xffffff });\n'
);

// 4. Update initWeapons
content = content.replace(/export function initWeapons\(opts\) \{[\s\S]*?console\.log\('\[Weapons\] Initialized\. Host:', state\.isHost\);/, 
  'export function initWeapons(opts) {\n  state.isHost = !!opts.isHost;\n  state.scene = opts.scene;\n  state.multiplayerState = opts.multiplayerState;\n  state.arenaInfo = opts.arenaInfo;\n  weaponTypes = resolveWeaponSet(opts.weaponSet || \'stk-classic\').weapons;\n  console.log(\'[Weapons] STK Weapons Initialized. Host:\', state.isHost);'
);

// 5. Update spawnPickup
content = content.replace(/function spawnPickup\(type\) \{[\s\S]*?broadcastPickups\(\);\n\}/, 
  \unction spawnPickup() {
  const type = 'random';
  let pos;
  if (state.arenaInfo && Array.isArray(state.arenaInfo.spawnPoints) && state.arenaInfo.spawnPoints.length) {
    const sp = state.arenaInfo.spawnPoints[Math.floor(Math.random()*state.arenaInfo.spawnPoints.length)];
    pos = new THREE.Vector3(sp.x + (Math.random()-0.5)*6, (sp.y ?? 0) + 1.0, sp.z + (Math.random()-0.5)*6);
  } else {
    pos = new THREE.Vector3((Math.random()-0.5)*40, 1.0, (Math.random()-0.5)*40);
  }

  const mesh = new THREE.Sprite(giftMaterial);
  mesh.scale.set(2.5, 2.5, 1);
  mesh.position.copy(pos);
  mesh.userData.isPickup = true;
  state.scene.add(mesh);

  const pickup = { id: genId('pickup'), type, mesh };
  state.pickups.push(pickup);
  broadcastPickups();
}\
);

// 6. Update collectPickups
content = content.replace(/if \(!battleState\.currentWeapon\) battleState\.currentWeapon = WEAPON_TYPES\[p\.type\];/, 
  \const weaponKeys = Object.keys(weaponTypes);
        const randomWeapon = weaponKeys[Math.floor(Math.random() * weaponKeys.length)];
        battleState.currentWeapon = randomWeapon;
        battleState.weaponAmmo = 1;\
);

// 7. Update fireWeapon
content = content.replace(/const weaponDef = WEAPON_TYPES\[weaponId\];/, 
  'const weaponDef = weaponTypes[weaponId];'
);

// 8. Update fireFromActor
content = content.replace(/const def = WEAPON_TYPES\[weaponId\];/, 
  'const def = weaponTypes[weaponId];'
);

// 9. Update update
content = content.replace(/spawnPickup\('rocket'\);/, 
  'spawnPickup();'
);
content = content.replace(/p\.mesh\.rotation\.x \+= dt \* 2\.0;/, 
  'p.mesh.position.y += Math.sin(performance.now() * 0.005 + p.mesh.position.x) * 0.01;'
);

// 10. Add getWeaponDef
content += '\nexport function getWeaponDef(id) { return weaponTypes[id]; }\n';
content += 'export function attemptFire(carModel, battleState) { fireWeapon(carModel, battleState); return true; }\n';
content += 'export function hostBroadcastPickups() { broadcastPickups(); }\n';

fs.writeFileSync(path, content, 'utf8');
