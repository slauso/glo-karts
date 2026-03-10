const fs = require('fs');
let text = fs.readFileSync('src/game-modes.js', 'utf8');

text = text.replace(/  race_online:\s*\{/, 
\  create_party: {
    id:       'create_party',
    category: 'online',
    label:    'Create Party',
    desc:     'Create a custom multiplayer lobby and invite friends.',
    icon:     'fa-users',
    page:     '',
    status:   'ready',
    requiresLobby: false,
    selectors: { track: false, arena: false, battleSettings: false },
    buildConfig() { return {}; }
  },

  race_online: {\);

text = text.replace(/  local_2p_race:\s*\{/, 
\  track_builder: {
    id:       'track_builder',
    category: 'solo',
    label:    'Track Builder',
    desc:     'Build custom tracks and share them with friends.',
    icon:     'fa-tools',
    page:     'builder.html',
    status:   'ready',
    requiresLobby: false,
    selectors: { track: false, arena: false, battleSettings: false },
    buildConfig() { return {}; }
  },

  local_2p_race: {\);

fs.writeFileSync('src/game-modes.js', text);
console.log("Did create_party get added?", text.includes("create_party"));
