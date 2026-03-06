import { Client } from 'colyseus.js';
import { getColyseusEndpoint } from './modules/realtime/feature-flag.js';
import {
  MODE_STATUS,
  CATEGORIES,
  MODE_REGISTRY,
  getCategoryTree,
  getPageForMode,
  requiresLobby,
  isPlayable,
  buildGameConfig,
  getMode,
} from './game-modes.js';

const STK_TRACKS = [
  { id: 'test_box', name: 'Test Box' },
];

const STK_ARENAS = [
  { id: 'test_box', name: 'Test Box' },
];

const DEFAULTS = {
  mode: 'race',
  battleType: 'deathmatch',
  maxPlayers: 12,
  botCount: 6,
  loadoutId: 'random-all',
  scoreLimit: 5,
  arenaId: 'test_box',
  trackId: 'test_box',
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
    this.selectedModeId = 'quick_race'; // default mode from game-modes.js
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

    this.mapSelectorContainer = document.querySelector('.map-selector-container');
    this.playerNameInput = document.getElementById('player-name-input');
    this.playBtn = document.getElementById('play-btn');
    this.readyBtn = document.getElementById('ready-btn');
    this.startMatchBtn = document.getElementById('start-match-btn');

    this.joinCodeInput = document.getElementById('join-code-input');
    this.joinPartyBtn = document.getElementById('join-party-btn');
    this.joinStatus = document.getElementById('join-status');
    this.joinSection = document.querySelector('.join-section');

    this.playerList = document.getElementById('player-list');
    this.readyCountEl = document.getElementById('ready-count');
    this.racersTitle = document.querySelector('.right-panel .panel-title');
    this.rightPanel = document.querySelector('.right-panel');

    this.playerNameInput.value = this.playerName;
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
    this.readyBtn?.addEventListener('click', () => this.toggleReady());
    this.startMatchBtn?.addEventListener('click', () => this.startMatch());

    document.addEventListener('kartChanged', (event) => {
      if (!event.detail?.kartId) return;
      sessionStorage.setItem('selectedKart', event.detail.kartId);
      this.sendPlayerUpdate();
    });

    // Track carousel integration
    document.addEventListener('trackCarouselChanged', (event) => {
      if (!event.detail?.trackId) return;
      this.selectedMap = event.detail.trackId;
      // Sync hidden dropdown for compatibility
      const mapName = document.querySelector('.selected-map-name');
      if (mapName) mapName.textContent = event.detail.trackName || event.detail.trackId;
      this.sendSettingsUpdate();
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
    const privacy = 'private';
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
      this.refreshActionButtons();
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
      if (this.readyCountEl) {
        this.readyCountEl.classList.remove('hidden');
        this.readyCountEl.innerHTML = `<span class="countdown-timer">Starting in ${t}…</span>`;
      }
    });

    room.onMessage('matchError', ({ message }) => {
      if (message) alert(message);
    });

    room.onMessage('matchStart', ({ gameConfig }) => {
      sessionStorage.setItem('gameConfig', JSON.stringify(gameConfig));
      // Online modes always go to realtime.html
      window.location.href = getPageForMode(this.selectedModeId) || 'realtime.html';
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
    this.rightPanel?.classList.remove('lobby-active');

    this.updatePlayerList();
    this.refreshActionButtons();
    this.refreshBattleControls();
    this.setJoinStatus(statusText);
  }

  showPartyPanels() {
    this.hostInfo?.classList.remove('hidden');
    this.createPartyBtn?.classList.add('hidden');
    this.quickMatchBtn?.classList.add('hidden');
    this.joinSection?.classList.add('hidden');
    this.rightPanel?.classList.add('lobby-active');
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
    const modeId = this.selectedModeId;

    // Not in a lobby — start solo or create lobby for online modes
    if (!this.room) {
      if (requiresLobby(modeId)) {
        // Auto-create a lobby when hitting PLAY GAME on an online mode
        this.createLobby();
        return;
      }
      this.startSinglePlayerGame();
      return;
    }
  }

  getGamePage({ multiplayer = false } = {}) {
    // Use the mode registry for routing
    if (multiplayer) return getPageForMode(this.selectedModeId) || 'realtime.html';
    return getPageForMode(this.selectedModeId) || 'game.html';
  }

  startSinglePlayerGame() {
    const lobbyState = {
      selectedMap: this.selectedMap,
      selectedBattleType: this.selectedBattleType,
      selectedMaxPlayers: this.selectedMaxPlayers,
      selectedBotCount: this.selectedBotCount,
      selectedLoadout: this.selectedLoadout,
      selectedCup: this.selectedCup || 'starter',
      playerId: this.playerId,
      playerName: this.playerName,
    };

    const gameConfig = buildGameConfig(this.selectedModeId, lobbyState);

    sessionStorage.setItem('gameConfig', JSON.stringify(gameConfig));
    window.location.href = getPageForMode(this.selectedModeId);
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
      li.textContent = this.room ? 'Waiting for players…' : '';
      this.playerList.appendChild(li);
      if (this.readyCountEl) this.readyCountEl.classList.add('hidden');
      return;
    }

    this.players.forEach((player) => {
      const li = document.createElement('li');
      li.className = 'player-row';
      if (player.isReady) li.classList.add('is-ready');

      // Ready indicator
      const indicator = document.createElement('span');
      indicator.className = `ready-indicator ${player.isReady ? 'ready' : 'not-ready'}`;
      li.appendChild(indicator);

      const name = document.createElement('span');
      name.className = 'player-name-text';
      name.textContent = player.name;
      li.appendChild(name);

      if (player.isHost) {
        const badge = document.createElement('span');
        badge.textContent = 'HOST';
        badge.className = 'host-badge';
        li.appendChild(badge);
      }

      if (player.id === this.playerId) {
        const youBadge = document.createElement('span');
        youBadge.textContent = 'YOU';
        youBadge.className = 'you-badge';
        li.appendChild(youBadge);
      }

      this.playerList.appendChild(li);
    });

    // Ready count summary
    if (this.readyCountEl && this.room) {
      const total = this.players.length;
      const ready = this.players.filter((p) => p.isReady).length;
      this.readyCountEl.classList.remove('hidden');
      this.readyCountEl.innerHTML = `<span class="ready-fraction">${ready}/${total}</span> ready`;
      this.readyCountEl.classList.toggle('all-ready', ready === total && total > 0);
    }
  }

  refreshActionButtons() {
    const inLobby = !!this.room;
    const total = this.players.length;
    const readyCount = this.players.filter(p => p.isReady).length;
    const allReady = total > 0 && readyCount === total;

    // PLAY GAME button: visible only when NOT in a lobby
    if (this.playBtn) {
      this.playBtn.classList.toggle('hidden', inLobby);
    }

    // READY UP button: visible when in lobby (for everyone)
    if (this.readyBtn) {
      this.readyBtn.classList.toggle('hidden', !inLobby);
      if (inLobby) {
        this.readyBtn.textContent = this.isReady ? '✓ READY' : 'READY UP';
        this.readyBtn.classList.toggle('is-ready', this.isReady);
      }
    }

    // START MATCH button: visible only for host, enabled when all ready
    if (this.startMatchBtn) {
      const showStart = inLobby && this.isHost;
      this.startMatchBtn.classList.toggle('hidden', !showStart);
      if (showStart) {
        this.startMatchBtn.disabled = false; // Host can always attempt — server auto-readies host
        if (total <= 1) {
          this.startMatchBtn.textContent = 'START MATCH';
          this.startMatchBtn.classList.remove('all-ready');
        } else if (allReady) {
          this.startMatchBtn.textContent = 'START MATCH';
          this.startMatchBtn.classList.add('all-ready');
        } else {
          this.startMatchBtn.textContent = `START (${readyCount}/${total} ready)`;
          this.startMatchBtn.classList.remove('all-ready');
        }
      }
    }
  }

  refreshBattleControls() {
    const battleSettings = document.getElementById('battle-settings');
    const modeEntry = getMode(this.selectedModeId);
    const showBattle = !!(modeEntry?.selectors?.battleSettings);

    battleSettings?.classList.toggle('hidden', !showBattle);

    // Action buttons are handled by refreshActionButtons()
    this.refreshActionButtons();
  }

  applyStateToUI(state) {
    // Sync selectedModeId from server gameMode (race/battle)
    const serverIsBattle = state.gameMode === 'battle';
    // If we're in a lobby, derive the modeId from server state
    if (this.room) {
      this.selectedModeId = serverIsBattle ? 'battle_online' : 'race_online';
      this.selectedMode = serverIsBattle ? 'battle' : 'race';
    }

    // Re-render mode selector UI
    this._selectCategory(this._activeCategory());

    const mapName = document.querySelector('.selected-map-name');
    const selectedTrack = ((this.selectedMode === 'battle') ? STK_ARENAS : STK_TRACKS).find((t) => t.id === this.selectedMap);
    if (mapName && selectedTrack) mapName.textContent = selectedTrack.name;

    // Sync the 3D track carousel to server state
    if (window.__trackPreview) {
      window.__trackPreview.setMode(this.selectedMode === 'battle' ? 'battle' : 'race');
      window.__trackPreview.setById(this.selectedMap);
    }

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
      ((this.selectedMode === 'battle') ? STK_ARENAS : STK_TRACKS).forEach((track, index) => {
        const option = document.createElement('div');
        option.className = `dropdown-option${index === 0 ? ' selected' : ''}`;
        option.setAttribute('data-map-id', track.id);
        option.textContent = track.name;
        dropdownContent.appendChild(option);
      });
    }

    this.selectedMap = ((this.selectedMode === 'battle') ? STK_ARENAS[0].id : STK_TRACKS[0].id);
    if (selectedMapName) selectedMapName.textContent = ((this.selectedMode === 'battle') ? STK_ARENAS[0].name : STK_TRACKS[0].name);

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
    // ── Build category tabs + mode cards from game-modes.js ──
    const tabsContainer = document.getElementById('mode-category-tabs');
    const cardsContainer = document.getElementById('mode-cards');
    const battleTypeEl = document.getElementById('battle-type-select');
    const maxPlayersEl = document.getElementById('battle-max-players');
    const botCountEl = document.getElementById('battle-bot-count');

    const tree = getCategoryTree();

    // Render category tabs
    if (tabsContainer) {
      tabsContainer.innerHTML = '';
      tree.forEach((cat) => {
        const tab = document.createElement('button');
        tab.className = `mode-cat-tab${cat.id === this._activeCategory() ? ' active' : ''}`;
        tab.setAttribute('data-cat', cat.id);
        tab.innerHTML = `<i class="fas ${cat.icon}"></i><span>${cat.label}</span>`;
        tab.addEventListener('click', () => this._selectCategory(cat.id));
        tabsContainer.appendChild(tab);
      });
    }

    this._renderModeCards();

    // Battle settings listeners (unchanged)
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

  /** Which category is active based on selectedModeId */
  _activeCategory() {
    const mode = getMode(this.selectedModeId);
    return mode ? mode.category : 'solo';
  }

  _selectCategory(catId) {
    // highlight tab
    document.querySelectorAll('.mode-cat-tab').forEach((tab) => {
      tab.classList.toggle('active', tab.getAttribute('data-cat') === catId);
    });

    // If the current mode isn't in this category, pick the first playable one
    const mode = getMode(this.selectedModeId);
    if (!mode || mode.category !== catId) {
      const tree = getCategoryTree();
      const cat = tree.find(c => c.id === catId);
      const first = cat?.modes.find(m => isPlayable(m.id)) || cat?.modes[0];
      if (first) this._selectMode(first.id);
    }

    this._renderModeCards();
  }

  _selectMode(modeId) {
    const mode = getMode(modeId);
    if (!mode || !isPlayable(modeId)) return;

    this.selectedModeId = modeId;

    // Derive legacy selectedMode for backward compat with Colyseus payloads
    const isBattle = modeId === 'battle_solo' || modeId === 'battle_online';
    this.selectedMode = isBattle ? 'battle' : 'race';

    // Sync track carousel to the right list
    if (window.__trackPreview) {
      window.__trackPreview.setMode(isBattle ? 'battle' : 'race');
    }

    // Reset map to defaults when switching race↔battle
    this.initMapSelector();
    this.refreshBattleControls();
    this._renderModeCards();
    this.sendSettingsUpdate();
  }

  _renderModeCards() {
    const cardsContainer = document.getElementById('mode-cards');
    if (!cardsContainer) return;

    const catId = this._activeCategory();
    const tree = getCategoryTree();
    const cat = tree.find(c => c.id === catId);
    if (!cat) return;

    cardsContainer.innerHTML = '';
    cat.modes.forEach((mode) => {
      const playable = isPlayable(mode.id);
      const card = document.createElement('div');
      card.className = 'mode-card';
      if (mode.id === this.selectedModeId) card.classList.add('active');
      if (!playable) card.classList.add('disabled');
      card.setAttribute('data-mode-id', mode.id);

      let badgeHTML = '';
      if (mode.status === MODE_STATUS.PLANNED) {
        badgeHTML = '<span class="mode-card-badge coming-soon">SOON</span>';
      } else if (mode.status === MODE_STATUS.BETA) {
        badgeHTML = '<span class="mode-card-badge beta">BETA</span>';
      }

      card.innerHTML = `
        <div class="mode-card-icon"><i class="fas ${mode.icon}"></i></div>
        <div class="mode-card-info">
          <div class="mode-card-label">${mode.label}</div>
        </div>
        ${badgeHTML}
      `;

      if (playable) {
        card.addEventListener('click', () => this._selectMode(mode.id));
      }
      cardsContainer.appendChild(card);
    });
  }

  populateArenaSelector() {
    // Arena selection is now handled by the 3D track carousel.
    // Keep the hidden input synced via the trackCarouselChanged event.
    const arenaInput = document.getElementById('battle-arena-select');
    if (arenaInput) {
      document.addEventListener('trackCarouselChanged', (event) => {
        if (event.detail?.mode === 'battle' && event.detail?.trackId) {
          arenaInput.value = event.detail.trackId;
        }
      });
    }
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
    if (muteIcon) muteIcon.className = menuMusic.muted ? 'fas fa-volume-mute' : 'fas fa-volume-up';
    if (muteBtn) muteBtn.dataset.muted = menuMusic.muted;
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
