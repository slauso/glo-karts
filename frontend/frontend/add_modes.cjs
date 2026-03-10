const fs = require('fs');
let c = fs.readFileSync('src/game-modes.js', 'utf8');

c = c.replace(/  race_online: {/g, 
  create_party: {
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

  race_online: {);

c = c.replace(/  local_2p_race: {/g, 
  track_builder: {
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

  local_2p_race: {);

fs.writeFileSync('src/game-modes.js', c);
