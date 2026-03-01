import { Client } from 'colyseus.js';
import { getColyseusEndpoint } from './modules/realtime/feature-flag.js';

const STK_TRACKS = [
  { id: 'cocoa_temple', name: 'Pompeii Ruins' },
  { id: 'hacienda', name: 'Tuscan Villa' },
  { id: 'minigolf', name: 'Portofino Green' },
  { id: 'sandtrack', name: 'Sardinia Dunes' },
  { id: 'snowtuxpeak', name: 'Monte Cervino' },
  { id: 'zengarden', name: 'Giardini di Boboli' },
  { id: 'lighthouse', name: 'Faro di Capri' },
  { id: 'olivermath', name: 'Piazza Navona' },
  { id: 'black_forest', name: 'Val di Non' },
  { id: 'xr591', name: 'Circuito di Monza' },
  { id: 'oasis', name: 'Oasi di Vendicari' },
  { id: 'gran_paradiso_island', name: 'Gran Paradiso' },
  { id: 'mines', name: 'Miniere di Carrara' },
  { id: 'snowmountain', name: 'Monte Bianco' },
  { id: 'abyss', name: 'Grotta Azzurra' },
  { id: 'cornfield_crossing', name: 'Campagna Toscana' },
  { id: 'volcano_island', name: 'Isola di Stromboli' },
  { id: 'ravenbridge_mansion', name: 'Villa Borghese' },
];

const STK_ARENAS = [
  { id: 'battleisland', name: 'Isola di Murano' },
  { id: 'lasdunasarena', name: 'Arena di Verona' },
  { id: 'cave', name: 'Grotta di Castellana' },
  { id: 'pumpkin_park', name: 'Parco dei Mostri' },
  { id: 'arena_candela_city', name: 'Piazza San Marco' },
  { id: 'ancient_colosseum_labyrinth', name: 'Colosseo' },
  { id: 'stadium', name: 'San Siro' },
  { id: 'alien_signal', name: 'Matera' },
  { id: 'temple', name: 'Tempio di Agrigento' },
];

const DEFAULTS = {
  mode: 'race',
  battleType: 'deathmatch',
  maxPlayers: 12,
  botCount: 6,
  loadoutId: 'random-all',
  scoreLimit: 5,
  arenaId: 'battleisland',
  trackId: STK_TRACKS[0].id,
};

function normalizeLobbyCode(raw) {
  return String(raw || '').trim().replace(/\s+/g, '-').toUpperCase();
}

function randomCodePart(len = 3) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function generateLobbyCode() {
  return `${randomCodePart(3)}-${randomCodePart(3)}-${randomCodePart(3)}`;
}

function getStoredGlo() {
  return {
    gloEffect: sessionStorage.getItem('gloEffect') || 'solid',
    gloColor: sessionStorage.getItem('gloColor') || '#ff0080',
    gloColor2: sessionStorage.getItem('gloColor2') || '#00e5ff',
  };
}

class RacingLobby {
  constructor() {
    this.realtimeEndpoint = getColyseusEndpoint();
    this.client = new Client(this.realtimeEndpoint);
    this.room = null;

    this.playerId = null;
    this.playerName = `Player_${Math.floor(Math.random() * 10000)}`;
    this.players = [];
    this.isHost = false;
    this.isReady = false;

    this.selectedMode = DEFAULTS.mode;
    this.selectedMap = DEFAULTS.trackId;
    this.selectedBattleType = DEFAULTS.battleType;
    this.selectedMaxPlayers = DEFAULTS.maxPlayers;
    this.selectedBotCount = DEFAULTS.botCount;
    this.selectedLoadout = DEFAULTS.loadoutId;

    this.currentLobbyCode = '';
    this.currentLobbyPrivacy = 'private';

    this.initUIElements();
    this.attachEventListeners();
    this.initMapSelector();
    this.initModeSelector();
    this.initWeaponLoadout();
    this.populateArenaSelector();
    this.refreshBattleControls();
  }

  initUIElements() {
    this.createPartyBtn = document.getElementById('create-party-btn');
    this.quickMatchBtn = document.getElementById('quick-match-btn');
    this.hostInfo = document.getElementById('host-info');
    this.partyCodeDisplay = document.getElementById('party-code');
    this.copyCodeBtn = document.getElementById('copy-code-btn');
    this.hostStopBtn = document.getElementById('host-stop-btn');
    this.privacySelect = document.getElementById('lobby-privacy-select');

    this.mapSelectorContainer = document.querySelector('.map-selector-container');
    this.playerNameInput = document.getElementById('player-name-input');
    this.playBtn = document.getElementById('play-btn');
    this.battleStartBtn = document.getElementById('battle-start-btn');

    this.joinCodeInput = document.getElementById('join-code-input');
    this.joinPartyBtn = document.getElementById('join-party-btn');
    this.joinStatus = document.getElementById('join-status');
    this.joinSection = document.querySelector('.join-section');

    this.playerList = document.getElementById('player-list');
    this.readyStatesEl = document.getElementById('ready-states');
    this.racersTitle = document.querySelector('.right-panel .panel-title');
    this.playersContainer = document.querySelector('.players-container');

    this.playerNameInput.value = this.playerName;
    this.racersTitle.classList.add('hidden');
    this.playersContainer.classList.add('hidden');
  }

  attachEventListeners() {
    this.createPartyBtn?.addEventListener('click', () => this.createLobby());
    this.quickMatchBtn?.addEventListener('click', () => this.quickMatch());
    this.joinPartyBtn?.addEventListener('click', () => this.joinLobbyByCode());
    this.copyCodeBtn?.addEventListener('click', () => this.copyCode());
    this.hostStopBtn?.addEventListener('click', () => this.leaveLobby(true));

    this.joinCodeInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.joinLobbyByCode();
    });

    this.playerNameInput?.addEventListener('input', () => {
      this.playerName = this.playerNameInput.value.trim() || this.playerName;
      this.sendPlayerUpdate();
    });

    this.playBtn?.addEventListener('click', () => this.onPlayClicked());
    this.battleStartBtn?.addEventListener('click', () => this.startMatch());

    document.addEventListener('kartChanged', (event) => {
      if (!event.detail?.kartId) return;
      sessionStorage.setItem('selectedKart', event.detail.kartId);
      this.sendPlayerUpdate();
    });

    document.querySelectorAll('.color-option').forEach((option) => {
      option.addEventListener('click', () => {
        const color = option.getAttribute('data-color') || 'red';
        document.querySelectorAll('.color-option').forEach((opt) => opt.classList.remove('active'));
        option.classList.add('active');
        sessionStorage.setItem('carColor', color);
        this.sendPlayerUpdate();
      });
    });

    const observer = new MutationObserver(() => this.sendPlayerUpdate());
    const gloPicker = document.getElementById('glo-picker-container');
    if (gloPicker) observer.observe(gloPicker, { attributes: true, subtree: true, childList: true });
  }

  async createLobby() {
    const privacy = this.privacySelect?.value === 'open' ? 'open' : 'private';
    const code = generateLobbyCode();
    try {
      await this.connectLobby('joinOrCreate', {
        lobbyCode: code,
        privacy,
        gameMode: this.selectedMode,
        ...this.buildSettingsPayload(),
        ...this.buildPlayerPayload(),
      });
    } catch (error) {
      this.setJoinStatus(await this.getLobbyErrorMessage(error, 'Create failed'));
    }
  }

  async quickMatch() {
    try {
      await this.connectLobby('joinOrCreate', {
        lobbyCode: '',
        privacy: 'open',
        gameMode: this.selectedMode,
        ...this.buildSettingsPayload(),
        ...this.buildPlayerPayload(),
      });
    } catch (error) {
      this.setJoinStatus(await this.getLobbyErrorMessage(error, 'Quick match failed'));
    }
  }

  async joinLobbyByCode() {
    const code = normalizeLobbyCode(this.joinCodeInput?.value || '');
    if (!code) {
      this.setJoinStatus('Enter a lobby code.');
      return;
    }

    this.setJoinStatus('Joining lobby...');
    const attempts = [
      { privacy: 'private', gameMode: 'race' },
      { privacy: 'private', gameMode: 'battle' },
      { privacy: 'open', gameMode: 'race' },
      { privacy: 'open', gameMode: 'battle' },
    ];
    let lastError = null;

    for (const attempt of attempts) {
      try {
        await this.connectLobby('join', {
          lobbyCode: code,
          ...attempt,
          ...this.buildPlayerPayload(),
        }, false);
        return;
      } catch (error) {
        lastError = error;
        // try next variant
      }
    }

    const connectionMessage = await this.getLobbyErrorMessage(lastError, 'Join failed');
    if (/offline|unreachable|refused|not defined/i.test(connectionMessage)) {
      this.setJoinStatus(connectionMessage);
      return;
    }
    this.setJoinStatus('Lobby not found. Check the code and retry.');
  }

  getRealtimeHealthUrl() {
    try {
      const ws = new URL(this.realtimeEndpoint);
      const protocol = ws.protocol === 'wss:' ? 'https:' : 'http:';
      return `${protocol}//${ws.host}/health`;
    } catch {
      return 'http://localhost:2567/health';
    }
  }

  async probeRealtimeHealth() {
    const healthUrl = this.getRealtimeHealthUrl();
    try {
      const response = await fetch(healthUrl, { method: 'GET' });
      if (!response.ok) {
        return { ok: false, healthUrl, reason: `HTTP ${response.status}` };
      }
      return { ok: true, healthUrl };
    } catch (error) {
      return { ok: false, healthUrl, reason: String(error?.message || error || 'unreachable') };
    }
  }

  async getLobbyErrorMessage(error, prefix = 'Connection failed') {
    const raw = String(error?.message || '').trim();
    const isUsefulRaw = raw && raw !== '[object Event]' && !/unknown error/i.test(raw);

    if (isUsefulRaw && /provided room name "lobby_room" not defined/i.test(raw)) {
      return `${prefix}: realtime server is running outdated code. Restart it from realtime/: npm run start`;
    }

    if (isUsefulRaw && /refused|networkerror|failed to fetch|timeout/i.test(raw.toLowerCase())) {
      return `${prefix}: realtime server unreachable at ${this.realtimeEndpoint}. Start it with: cd realtime && npm run start`;
    }

    if (isUsefulRaw) {
      return `${prefix}: ${raw}`;
    }

    const probe = await this.probeRealtimeHealth();
    if (!probe.ok) {
      return `${prefix}: realtime server offline at ${probe.healthUrl}. Start it with: cd realtime && npm run start`;
    }

    return `${prefix}: unexpected networking error. Check browser console and retry.`;
  }

  async connectLobby(method, options, setConnectingStatus = true) {
    if (this.room) {
      await this.leaveLobby(false);
    }

    if (setConnectingStatus) this.setJoinStatus('Connecting to lobby...');

    let room;
    try {
      if (method === 'join') {
        room = await this.client.join('lobby_room', options);
      } else {
        room = await this.client.joinOrCreate('lobby_room', options);
      }
    } catch (error) {
      this.resetLobbyState('');
      throw error;
    }

    this.room = room;
    this.playerId = room.sessionId;
    sessionStorage.setItem('myPlayerId', room.sessionId);
    localStorage.setItem('myPlayerId', room.sessionId);

    room.onStateChange((state) => {
      this.currentLobbyCode = state.lobbyCode || this.currentLobbyCode;
      this.currentLobbyPrivacy = state.privacy || this.currentLobbyPrivacy;
      this.selectedMode = state.gameMode || this.selectedMode;
      this.selectedMap = state.trackId || this.selectedMap;
      this.selectedBattleType = state.battleType || this.selectedBattleType;
      this.selectedMaxPlayers = Number(state.maxPlayers || this.selectedMaxPlayers || 12);

      this.players = [];
      state.players.forEach((player, id) => {
        this.players.push({
          id,
          name: player.name,
          isHost: !!player.isHost,
          isReady: !!player.isReady,
          playerColor: player.playerColor,
          playerKart: player.playerKart,
        });
      });

      const me = this.players.find((p) => p.id === this.playerId);
      this.isHost = !!me?.isHost;
      this.isReady = !!me?.isReady;

      this.applyStateToUI(state);
      this.updatePlayerList();
      this.updateReadyStates();
      this.refreshBattleControls();
    });

    room.onMessage('joined', (payload) => {
      this.currentLobbyCode = payload?.lobbyCode || this.currentLobbyCode;
      this.currentLobbyPrivacy = payload?.privacy || this.currentLobbyPrivacy;
      this.setJoinStatus(`Connected (${this.currentLobbyPrivacy}).`);
      this.showPartyPanels();
      if (this.partyCodeDisplay) this.partyCodeDisplay.textContent = this.currentLobbyCode || '------';
    });

    room.onMessage('countdown', ({ t }) => {
      if (this.readyStatesEl) {
        this.readyStatesEl.classList.remove('hidden');
        this.readyStatesEl.innerHTML = `<div><strong>Match starts in:</strong> ${t}</div>`;
      }
    });

    room.onMessage('matchError', ({ message }) => {
      if (message) alert(message);
    });

    room.onMessage('matchStart', ({ gameConfig }) => {
      sessionStorage.setItem('gameConfig', JSON.stringify(gameConfig));
      window.location.href = this.getGamePage({ multiplayer: true });
    });

    room.onLeave(() => {
      this.resetLobbyState('Lobby closed.');
    });

    this.sendPlayerUpdate();
  }

  async leaveLobby(showMessage = true) {
    if (!this.room) return;
    try {
      await this.room.leave();
    } catch {
      // ignore
    }
    this.resetLobbyState(showMessage ? 'Left lobby.' : '');
  }

  resetLobbyState(statusText = '') {
    this.room = null;
    this.isHost = false;
    this.isReady = false;
    this.players = [];
    this.currentLobbyCode = '';

    this.hostInfo?.classList.add('hidden');
    this.createPartyBtn?.classList.remove('hidden');
    this.quickMatchBtn?.classList.remove('hidden');
    this.joinSection?.classList.remove('hidden');
    this.racersTitle?.classList.add('hidden');
    this.playersContainer?.classList.add('hidden');

    this.updatePlayerList();
    this.updateReadyStates();
    this.refreshBattleControls();
    this.setJoinStatus(statusText);
  }

  showPartyPanels() {
    this.hostInfo?.classList.remove('hidden');
    this.createPartyBtn?.classList.add('hidden');
    this.quickMatchBtn?.classList.add('hidden');
    this.joinSection?.classList.add('hidden');
    this.racersTitle?.classList.remove('hidden');
    this.playersContainer?.classList.remove('hidden');
  }

  setJoinStatus(text) {
    if (this.joinStatus) this.joinStatus.textContent = text || '';
  }

  buildPlayerPayload() {
    const glo = getStoredGlo();
    return {
      playerName: this.playerName,
      playerColor: sessionStorage.getItem('carColor') || 'red',
      playerKart: sessionStorage.getItem('selectedKart') || 'tux',
      gloEffect: glo.gloEffect,
      gloColor: glo.gloColor,
      gloColor2: glo.gloColor2,
    };
  }

  buildSettingsPayload() {
    return {
      trackId: this.selectedMap,
      arenaId: document.getElementById('battle-arena-select')?.value || DEFAULTS.arenaId,
      battleType: this.selectedBattleType,
      maxPlayers: this.selectedMaxPlayers,
      scoreLimit: parseInt(document.getElementById('battle-score-limit')?.value || '5', 10) || 5,
      loadoutId: this.selectedLoadout,
      collisionDamage: !!document.getElementById('battle-collision-damage')?.checked,
      botCount: this.selectedBotCount,
    };
  }

  sendPlayerUpdate() {
    if (!this.room) return;
    this.room.send('playerUpdate', this.buildPlayerPayload());
  }

  sendSettingsUpdate() {
    if (!this.room || !this.isHost) return;
    this.room.send('settingsUpdate', {
      gameMode: this.selectedMode,
      ...this.buildSettingsPayload(),
    });
  }

  toggleReady() {
    if (!this.room) return;
    this.isReady = !this.isReady;
    this.room.send('setReady', { isReady: this.isReady });
  }

  startMatch() {
    if (!this.room || !this.isHost) return;
    this.sendSettingsUpdate();
    this.room.send('startMatch', {});
  }

  onPlayClicked() {
    if (!this.room) {
      this.startSinglePlayerGame();
      return;
    }

    if (this.selectedMode === 'race' && this.isHost) {
      this.startMatch();
      return;
    }

    this.toggleReady();
  }

  getGamePage({ multiplayer = false } = {}) {
    if (multiplayer) return 'realtime.html';
    return this.selectedMode === 'battle' ? 'battle.html' : 'game.html';
  }

  startSinglePlayerGame() {
    const isBattle = this.selectedMode === 'battle';
    const gameConfig = {
      type: 'startGame',
      trackId: this.selectedMap,
      gameMode: this.selectedMode,
      selectedKart: sessionStorage.getItem('selectedKart') || 'tux',
      arenaId: isBattle ? (document.getElementById('battle-arena-select')?.value || DEFAULTS.arenaId) : undefined,
      battleType: isBattle ? this.selectedBattleType : undefined,
      maxPlayers: isBattle ? this.selectedMaxPlayers : undefined,
      botCount: isBattle ? this.selectedBotCount : undefined,
      loadoutId: isBattle ? this.selectedLoadout : undefined,
      collisionDamage: isBattle ? !!document.getElementById('battle-collision-damage')?.checked : undefined,
      scoreLimit: isBattle ? (parseInt(document.getElementById('battle-score-limit')?.value || '5', 10) || 5) : undefined,
      players: [{
        id: this.playerId || 'solo-player',
        name: this.playerName,
        isHost: true,
        playerColor: sessionStorage.getItem('carColor') || 'red',
        playerKart: sessionStorage.getItem('selectedKart') || 'tux',
      }],
      isSinglePlayer: true,
      multiplayerProvider: 'colyseus',
    };

    sessionStorage.setItem('gameConfig', JSON.stringify(gameConfig));
    window.location.href = this.getGamePage({ multiplayer: false });
  }

  copyCode() {
    const code = this.currentLobbyCode || this.partyCodeDisplay?.textContent || '';
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      this.copyCodeBtn.textContent = 'Copied!';
      setTimeout(() => { this.copyCodeBtn.textContent = 'Copy'; }, 1500);
    }).catch(() => {
      this.setJoinStatus('Copy failed.');
    });
  }

  updatePlayerList() {
    if (!this.playerList) return;
    this.playerList.innerHTML = '';

    if (!this.players.length) {
      const li = document.createElement('li');
      li.className = 'no-players';
      li.textContent = 'No players in lobby';
      this.playerList.appendChild(li);
      return;
    }

    this.players.forEach((player) => {
      const li = document.createElement('li');
      li.style.display = 'flex';
      li.style.alignItems = 'center';
      li.style.gap = '8px';

      const readyDot = document.createElement('span');
      readyDot.textContent = player.isReady ? '●' : '○';
      readyDot.style.color = player.isReady ? '#7CFC00' : '#888';
      readyDot.style.fontSize = '18px';
      li.appendChild(readyDot);

      const name = document.createElement('span');
      name.textContent = player.name;
      li.appendChild(name);

      if (player.isHost) {
        const badge = document.createElement('span');
        badge.textContent = 'HOST';
        badge.className = 'host-badge';
        li.appendChild(badge);
      }

      this.playerList.appendChild(li);
    });
  }

  updateReadyStates() {
    if (!this.readyStatesEl) return;

    if (this.selectedMode !== 'battle') {
      this.readyStatesEl.classList.add('hidden');
      this.readyStatesEl.innerHTML = '';
      return;
    }

    this.readyStatesEl.classList.remove('hidden');
    const total = this.players.length;
    const ready = this.players.filter((p) => p.isReady).length;
    const rows = this.players.map((p) => `<div>${p.isReady ? '●' : '○'} ${p.name}${p.isHost ? ' (HOST)' : ''}</div>`).join('');
    this.readyStatesEl.innerHTML = `<div><strong>Ready:</strong> ${ready}/${total}</div>${rows}`;
  }

  refreshBattleControls() {
    const battleSettings = document.getElementById('battle-settings');
    const inLobby = !!this.room;
    const isBattleMode = this.selectedMode === 'battle';

    battleSettings?.classList.toggle('hidden', !isBattleMode);

    if (!isBattleMode) {
      this.battleStartBtn?.classList.add('hidden');
      if (this.playBtn) this.playBtn.textContent = inLobby && this.isHost ? 'START RACE' : (inLobby ? 'READY UP' : 'PLAY GAME');
      return;
    }

    if (this.playBtn) this.playBtn.textContent = inLobby ? (this.isReady ? 'CANCEL READY' : 'READY UP') : 'PLAY GAME';

    const everyoneReady = this.players.length > 0 && this.players.every((p) => p.isReady);
    if (this.battleStartBtn) {
      this.battleStartBtn.classList.toggle('hidden', !(inLobby && this.isHost));
      this.battleStartBtn.disabled = !everyoneReady;
    }
  }

  applyStateToUI(state) {
    const modeButtons = document.querySelectorAll('.mode-btn');
    modeButtons.forEach((button) => {
      button.classList.toggle('active', button.getAttribute('data-mode') === this.selectedMode);
    });

    const mapName = document.querySelector('.selected-map-name');
    const selectedTrack = STK_TRACKS.find((t) => t.id === this.selectedMap);
    if (mapName && selectedTrack) mapName.textContent = selectedTrack.name;

    document.querySelectorAll('.dropdown-option').forEach((option) => {
      option.classList.toggle('selected', option.getAttribute('data-map-id') === this.selectedMap);
    });

    const battleTypeEl = document.getElementById('battle-type-select');
    if (battleTypeEl && battleTypeEl.value !== this.selectedBattleType) battleTypeEl.value = this.selectedBattleType;

    const maxPlayersEl = document.getElementById('battle-max-players');
    if (maxPlayersEl) maxPlayersEl.value = String(this.selectedMaxPlayers);

    if (this.partyCodeDisplay) {
      this.partyCodeDisplay.textContent = state.lobbyCode || this.currentLobbyCode || '------';
    }
  }

  initMapSelector() {
    const mapDropdown = document.querySelector('.map-dropdown');
    const dropdownButton = document.querySelector('.dropdown-button');
    const selectedMapName = document.querySelector('.selected-map-name');
    const dropdownContent = document.getElementById('track-dropdown-options');

    if (dropdownContent) {
      dropdownContent.innerHTML = '';
      STK_TRACKS.forEach((track, index) => {
        const option = document.createElement('div');
        option.className = `dropdown-option${index === 0 ? ' selected' : ''}`;
        option.setAttribute('data-map-id', track.id);
        option.textContent = track.name;
        dropdownContent.appendChild(option);
      });
    }

    this.selectedMap = STK_TRACKS[0].id;
    if (selectedMapName) selectedMapName.textContent = STK_TRACKS[0].name;

    dropdownButton?.addEventListener('click', (event) => {
      event.stopPropagation();
      mapDropdown?.classList.toggle('open');
    });

    document.addEventListener('click', () => mapDropdown?.classList.remove('open'));

    dropdownContent?.addEventListener('click', (event) => {
      const option = event.target.closest('.dropdown-option');
      if (!option) return;

      const mapId = option.getAttribute('data-map-id');
      this.selectedMap = mapId;
      document.querySelectorAll('.dropdown-option').forEach((opt) => opt.classList.toggle('selected', opt === option));
      if (selectedMapName) selectedMapName.textContent = option.textContent;
      mapDropdown?.classList.remove('open');

      document.dispatchEvent(new CustomEvent('mapChanged', { detail: { mapId } }));
      this.sendSettingsUpdate();
    });
  }

  initModeSelector() {
    const modeButtons = document.querySelectorAll('.mode-btn');
    const battleTypeEl = document.getElementById('battle-type-select');
    const maxPlayersEl = document.getElementById('battle-max-players');
    const botCountEl = document.getElementById('battle-bot-count');

    modeButtons.forEach((button) => {
      button.addEventListener('click', () => {
        this.selectedMode = button.getAttribute('data-mode') === 'battle' ? 'battle' : 'race';
        this.refreshBattleControls();
        this.sendSettingsUpdate();
      });
    });

    battleTypeEl?.addEventListener('change', () => {
      this.selectedBattleType = battleTypeEl.value === 'ctf' ? 'ctf' : 'deathmatch';
      this.sendSettingsUpdate();
    });

    maxPlayersEl?.addEventListener('change', () => {
      const parsed = parseInt(maxPlayersEl.value || '12', 10);
      this.selectedMaxPlayers = Number.isFinite(parsed) ? Math.max(2, Math.min(12, parsed)) : 12;
      maxPlayersEl.value = String(this.selectedMaxPlayers);
      this.sendSettingsUpdate();
    });

    botCountEl?.addEventListener('change', () => {
      const parsed = parseInt(botCountEl.value || '0', 10);
      this.selectedBotCount = Number.isFinite(parsed) ? Math.max(0, Math.min(11, parsed)) : 0;
      botCountEl.value = String(this.selectedBotCount);
    });
  }

  populateArenaSelector() {
    const arenaSelectEl = document.getElementById('battle-arena-select');
    if (!arenaSelectEl) return;

    arenaSelectEl.innerHTML = '';
    STK_ARENAS.forEach((arena, index) => {
      const option = document.createElement('option');
      option.value = arena.id;
      option.textContent = arena.name;
      if (index === 0) option.selected = true;
      arenaSelectEl.appendChild(option);
    });

    arenaSelectEl.addEventListener('change', () => this.sendSettingsUpdate());
  }

  initWeaponLoadout() {
    const LOADOUTS = [
      { id: 'random-all', label: 'All Weapons', icon: '🎲' },
      { id: 'combat', label: 'Combat', icon: '💥' },
      { id: 'chaos', label: 'Chaos', icon: '🌀' },
      { id: 'sneaky', label: 'Sneaky', icon: '👻' },
      { id: 'none', label: 'No Weapons', icon: '🚫' },
    ];

    const row = document.getElementById('weapon-loadout-row');
    if (!row) return;

    row.innerHTML = '';
    LOADOUTS.forEach((loadout) => {
      const btn = document.createElement('button');
      btn.className = `weapon-loadout-btn${loadout.id === this.selectedLoadout ? ' active' : ''}`;
      btn.setAttribute('data-loadout', loadout.id);
      btn.innerHTML = `<span class="loadout-icon">${loadout.icon}</span><span class="loadout-label">${loadout.label}</span>`;
      btn.addEventListener('click', () => {
        row.querySelectorAll('.weapon-loadout-btn').forEach((node) => node.classList.remove('active'));
        btn.classList.add('active');
        this.selectedLoadout = loadout.id;
        this.sendSettingsUpdate();
      });
      row.appendChild(btn);
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const lobby = new RacingLobby();

  const menuMusic = document.getElementById('menu-music');
  const muteBtn = document.getElementById('mute-btn');
  const muteIcon = document.getElementById('mute-icon');
  let musicStarted = false;

  const tryPlayMusic = () => {
    if (!menuMusic || musicStarted) return;
    menuMusic.volume = 0.42;
    menuMusic.play().then(() => { musicStarted = true; }).catch(() => {});
  };

  tryPlayMusic();
  document.addEventListener('click', tryPlayMusic, { once: true });
  document.addEventListener('keydown', tryPlayMusic, { once: true });

  muteBtn?.addEventListener('click', () => {
    if (!menuMusic) return;
    menuMusic.muted = !menuMusic.muted;
    if (muteIcon) muteIcon.className = menuMusic.muted ? 'fas fa-volume-mute' : 'fas fa-music';
  });

  const clickSfx = new Audio('/audio/sfx/grab_collectable.ogg');
  clickSfx.volume = 0.5;
  document.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => {
      const sfx = clickSfx.cloneNode();
      sfx.volume = 0.45;
      sfx.play().catch(() => {});
    }, { passive: true });
  });

  window.addEventListener('orientationchange', handleOrientationChange);
  window.addEventListener('resize', handleOrientationChange);
  handleOrientationChange();

  const infoBtn = document.getElementById('info-btn');
  const infoPopup = document.getElementById('info-popup');
  const closeInfoBtn = document.getElementById('close-info-btn');

  if (infoBtn && infoPopup && closeInfoBtn) {
    infoBtn.addEventListener('click', () => infoPopup.classList.remove('hidden'));
    closeInfoBtn.addEventListener('click', () => infoPopup.classList.add('hidden'));
    infoPopup.addEventListener('click', (event) => {
      if (event.target === infoPopup || event.target.classList.contains('info-overlay')) {
        infoPopup.classList.add('hidden');
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !infoPopup.classList.contains('hidden')) {
        infoPopup.classList.add('hidden');
      }
    });
  }

  window.__lobby = lobby;
});

function handleOrientationChange() {
  const rotateMessage = document.getElementById('rotate-message');
  const gameContainer = document.querySelector('.game-container');

  if (window.innerHeight > window.innerWidth) {
    if (rotateMessage) rotateMessage.style.display = 'flex';
    if (gameContainer) gameContainer.style.display = 'none';
  } else {
    if (rotateMessage) rotateMessage.style.display = 'none';
    if (gameContainer) gameContainer.style.display = 'flex';
  }
}
