import { Client } from 'colyseus.js';
import { getColyseusEndpoint } from './modules/realtime/feature-flag.js';
import {
  MODE_STATUS,
  MODE_REGISTRY,
  getVisibleModes,
  getPageForMode,
  requiresLobby,
  isPlayable,
  buildGameConfig,
  getMode,
} from './game-modes.js';
import {
  getLegacyModeFamily,
  getSelectableContentList,
  usesArenaSelection,
  usesTrackSelection,
} from './modules/single-player-routing.js';

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
  _initLensEngine() {
    // Apple card effect for all .lens-card, including the new unified lobby-join card
    const cards = document.querySelectorAll('.lens-card');
    cards.forEach(card => {
      let pressing = false;
      let tiltX = 0, tiltY = 0;
      let lastRAF = null;
      const updateTilt = (e) => {
        const rect = card.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        tiltX = (x - 0.5) * 24;
        tiltY = (y - 0.5) * 18;
        card.style.setProperty('--lens-tilt-x', tiltX.toFixed(2));
        card.style.setProperty('--lens-tilt-y', tiltY.toFixed(2));
      };
      const resetTilt = () => {
        card.style.setProperty('--lens-tilt-x', '0');
        card.style.setProperty('--lens-tilt-y', '0');
      };
      card.addEventListener('mousemove', updateTilt);
      card.addEventListener('mouseleave', () => {
        resetTilt();
        card.classList.remove('lens-pressing');
      });
      card.addEventListener('mousedown', () => {
        pressing = true;
        card.classList.add('lens-pressing');
      });
      card.addEventListener('mouseup', () => {
        pressing = false;
        card.classList.remove('lens-pressing');
      });
      card.addEventListener('touchstart', () => {
        pressing = true;
        card.classList.add('lens-pressing');
      }, { passive: true });
      card.addEventListener('touchend', () => {
        pressing = false;
        card.classList.remove('lens-pressing');
      });
      resetTilt();
    });
  }

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
    this.selectedModeId = null;
    this.selectedMap = DEFAULTS.trackId;
    this.selectedBattleType = DEFAULTS.battleType;
    this.selectedMaxPlayers = DEFAULTS.maxPlayers;
    this.selectedBotCount = DEFAULTS.botCount;
    this.selectedLoadout = DEFAULTS.loadoutId;
    this.selectedCup = 'starter';
    this.selectedGlofluxTheme = 'nuclear_desert';
    this.splitScreenType = 'race';

    this.currentLobbyCode = '';
    this.currentLobbyPrivacy = 'private';

    this.initUIElements();
    this.attachEventListeners();
    this.initMapSelector();
    this.initModeSelector();
    this.initRaceSettings();
    this.initGlofluxSettings();
    this.initWeaponLoadout();
    this.populateArenaSelector();
    this.refreshBattleControls();
    this._initLensEngine();
  }

  initUIElements() {
    this.createPartyBtn = document.getElementById('create-party-btn');
    this.quickMatchBtn = document.getElementById('quick-match-btn');
    this.hostInfo = document.getElementById('host-info');
    this.partyCodeDisplay = document.getElementById('party-code');
    this.copyCodeBtn = document.getElementById('copy-code-btn');
    this.hostStopBtn = document.getElementById('host-stop-btn');
    this.lobbyConnectionBadge = document.getElementById('lobby-connection-badge');
    this.lobbyRoleChip = document.getElementById('lobby-role-chip');
    this.lobbyPrivacyChip = document.getElementById('lobby-privacy-chip');
    this.lobbyPlayerChip = document.getElementById('lobby-player-chip');
    this.lobbyServerChip = document.getElementById('lobby-server-chip');
    this.lobbyStatusDetail = document.getElementById('lobby-status-detail');
    this.pillJoinHeader = document.querySelector('.lens-pill-join-header');

    this.mapSelectorContainer = document.querySelector('.map-selector-container');
    this.playerNameInput = document.getElementById('player-name-input');
    this.playBtn = document.getElementById('play-btn');
    this.playIndicator = document.getElementById('play-btn-indicator');
    this.playIndicatorLabel = document.getElementById('play-indicator-label');
    this.readyBtn = document.getElementById('ready-btn');
    this.startMatchBtn = document.getElementById('start-match-btn');

    this.joinCodeInput = document.getElementById('join-code-input');
    this.joinPartyBtn = document.getElementById('join-party-btn');
    this.joinStatus = document.getElementById('join-status');
    this.joinSection = document.querySelector('.join-section');
    this.modeSelectorContainer = document.querySelector('.mode-selector-container');
    this.inlineSetup = document.getElementById('inline-setup');

    this.playerList = document.getElementById('player-list');
    this.readyCountEl = document.getElementById('ready-count');
    this.racersTitle = document.querySelector('.lens-stack-right .panel-title');
    this.rightPanel = document.querySelector('.lens-stack-right');

    this.playerNameInput.value = '';
    this.playerNameInput.placeholder = this.playerName;
    // Cycle placeholder between default name and prompt
    this._placeholderTexts = [this.playerName, 'Enter Your Name'];
    this._placeholderIdx = 0;
    this._placeholderTimer = setInterval(() => {
      if (this.playerNameInput === document.activeElement) return;
      if (this.playerNameInput.value) return;
      this._placeholderIdx = (this._placeholderIdx + 1) % this._placeholderTexts.length;
      this.playerNameInput.classList.add('ph-fade');
      setTimeout(() => {
        this.playerNameInput.placeholder = this._placeholderTexts[this._placeholderIdx];
        this.playerNameInput.classList.remove('ph-fade');
      }, 300);
    }, 2800);
  }

  attachEventListeners() {
    this.createPartyBtn?.addEventListener('click', () => this.createLobby());
    this.quickMatchBtn?.addEventListener('click', () => this.quickMatch());
    this.joinPartyBtn?.addEventListener('click', () => this.joinLobbyByCode());
    this.copyCodeBtn?.addEventListener('click', () => this.copyCode());
    this.hostStopBtn?.addEventListener('click', () => {
      if (this.room) {
        this.leaveLobby(true);
      } else {
        this.resetLobbyState('');
      }
    });

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
      document.querySelectorAll('.dropdown-option').forEach((opt) =>
        opt.classList.toggle('selected', opt.getAttribute('data-map-id') === event.detail.trackId)
      );
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

    // Custom track import
    const importTrackBtn = document.getElementById('import-track-btn');
    const importTrackCode = document.getElementById('import-track-code');
    const importTrackStatus = document.getElementById('import-track-status');

    importTrackBtn?.addEventListener('click', () => this._importCustomTrack());
    importTrackCode?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._importCustomTrack();
    });
  }

  _importCustomTrack() {
    const input = document.getElementById('import-track-code');
    const status = document.getElementById('import-track-status');
    const code = input?.value?.trim();

    if (!code) {
      if (status) status.textContent = 'Paste a track share code.';
      return;
    }

    // Dynamically import track-editor to decode the share code
    import('./modules/track-editor.js').then(({ importTrackCode, saveCustomTrack }) => {
      const json = importTrackCode(code);
      if (!json) {
        if (status) status.textContent = 'Invalid share code.';
        return;
      }
      try {
        const trackData = JSON.parse(json);
        saveCustomTrack(trackData);
        if (status) {
          status.textContent = `Imported: ${trackData.name || 'Custom Track'}`;
          status.style.color = '#44ff88';
        }
        if (input) input.value = '';
      } catch {
        if (status) status.textContent = 'Failed to parse track data.';
      }
    });
  }

  async createLobby() {
    const privacy = 'private';
    const code = generateLobbyCode();
    this.currentLobbyCode = code;
    this._showConnectingState(code);
    try {
      await this.connectLobby('joinOrCreate', {
        lobbyCode: code,
        privacy,
        gameMode: this.selectedMode,
        ...this.buildSettingsPayload(),
        ...this.buildPlayerPayload(),
      });
    } catch (error) {
      this._showLobbyError('Connection failed. Diagnosing\u2026');
      const msg = await this.getLobbyErrorMessage(error, 'Create failed');
      this._showLobbyError(msg);
    }
  }

  async quickMatch() {
    this._showConnectingState('');
    try {
      await this.connectLobby('joinOrCreate', {
        lobbyCode: '',
        privacy: 'open',
        gameMode: this.selectedMode,
        ...this.buildSettingsPayload(),
        ...this.buildPlayerPayload(),
      });
    } catch (error) {
      this._showLobbyError('Connection failed. Diagnosing\u2026');
      const msg = await this.getLobbyErrorMessage(error, 'Quick match failed');
      this._showLobbyError(msg);
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
      { privacy: 'private', gameMode: 'gloflux' },
      { privacy: 'open', gameMode: 'race' },
      { privacy: 'open', gameMode: 'battle' },
      { privacy: 'open', gameMode: 'gloflux' },
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
      this.selectedModeId = state.modeId || this.selectedModeId;
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
      this.updateLobbyPresence(`Connected (${this.currentLobbyPrivacy}).`);
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
      // If host set a custom track, store it so game pages can load it
      if (gameConfig.customTrackData) {
        sessionStorage.setItem('customTrackData', gameConfig.customTrackData);
      }
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
    this.hostInfo?.classList.remove('is-error');
    this.joinSection?.classList.remove('hidden');
    // No longer toggling between separate cards; keep unified card visible
    this.rightPanel?.classList.remove('lobby-active', 'lobby-connecting');
    if (this.pillJoinHeader) this.pillJoinHeader.innerHTML = '<i class="fas fa-users"></i> LOBBY & JOIN';

    this.updatePlayerList();
    this.refreshActionButtons();
    this.refreshBattleControls();
    this.updateLobbyPresence(statusText);
    this.setJoinStatus(statusText);
  }

  showPartyPanels() {
    this.hostInfo?.classList.remove('hidden');
    this.hostInfo?.classList.remove('is-error');
    this.joinSection?.classList.add('hidden');
    // No longer toggling between separate cards; keep unified card visible
    this.rightPanel?.classList.add('lobby-active');
    this.rightPanel?.classList.remove('lobby-connecting');
    if (this.pillJoinHeader) this.pillJoinHeader.innerHTML = '<i class="fas fa-signal"></i> LOBBY ACTIVE';
    this.updateLobbyPresence();
  }

  /** Immediately show the lobby dashboard in a "connecting" state */
  _showConnectingState(code) {
    this.hostInfo?.classList.remove('hidden');
    this.hostInfo?.classList.remove('is-error');
    this.joinSection?.classList.add('hidden');
    this.rightPanel?.classList.add('lobby-active', 'lobby-connecting');
    if (this.pillJoinHeader) this.pillJoinHeader.innerHTML = '<i class="fas fa-spinner fa-spin"></i> CONNECTING\u2026';

    if (this.partyCodeDisplay) this.partyCodeDisplay.textContent = code || '\u2014\u2014\u2014';
    if (this.lobbyConnectionBadge) this.lobbyConnectionBadge.textContent = 'CONNECTING';
    if (this.lobbyRoleChip) this.lobbyRoleChip.textContent = '\u2014';
    if (this.lobbyServerChip) {
      this.lobbyServerChip.textContent = 'CONNECTING';
      this.lobbyServerChip.classList.remove('is-online');
    }
    if (this.lobbyPrivacyChip) this.lobbyPrivacyChip.textContent = 'PRIVATE';
    if (this.lobbyPlayerChip) this.lobbyPlayerChip.textContent = '\u2014';
    if (this.lobbyStatusDetail) this.lobbyStatusDetail.textContent = 'Connecting to lobby server\u2026';
    if (this.hostStopBtn) this.hostStopBtn.textContent = 'Cancel';
  }

  /** Show the dashboard with an error state after a failed connection */
  _showLobbyError(message) {
    this.hostInfo?.classList.remove('hidden');
    this.hostInfo?.classList.add('is-error');
    this.rightPanel?.classList.add('lobby-active');
    this.rightPanel?.classList.remove('lobby-connecting');
    if (this.pillJoinHeader) this.pillJoinHeader.innerHTML = '<i class="fas fa-exclamation-triangle"></i> CONNECTION FAILED';

    if (this.lobbyConnectionBadge) this.lobbyConnectionBadge.textContent = 'ERROR';
    if (this.lobbyRoleChip) this.lobbyRoleChip.textContent = 'OFFLINE';
    if (this.lobbyServerChip) {
      this.lobbyServerChip.textContent = 'UNREACHABLE';
      this.lobbyServerChip.classList.remove('is-online');
    }
    if (this.lobbyStatusDetail) this.lobbyStatusDetail.textContent = message;
    if (this.hostStopBtn) this.hostStopBtn.textContent = 'Dismiss';
    this.setJoinStatus(message);
  }

  setJoinStatus(text) {
    if (this.joinStatus) this.joinStatus.textContent = text || '';
    if (this.room && text) this.updateLobbyPresence(text);
  }

  updateLobbyPresence(statusText = '') {
    if (this.partyCodeDisplay) {
      this.partyCodeDisplay.textContent = this.currentLobbyCode || '------';
    }

    if (!this.room) {
      if (this.lobbyConnectionBadge) this.lobbyConnectionBadge.textContent = 'LOBBY IDLE';
      if (this.lobbyRoleChip) this.lobbyRoleChip.textContent = 'OFFLINE';
      if (this.lobbyPrivacyChip) this.lobbyPrivacyChip.textContent = 'NO LOBBY';
      if (this.lobbyPlayerChip) this.lobbyPlayerChip.textContent = '0 PLAYERS';
      if (this.lobbyServerChip) {
        this.lobbyServerChip.textContent = 'STANDBY';
        this.lobbyServerChip.classList.remove('is-online');
      }
      if (this.lobbyStatusDetail) {
        this.lobbyStatusDetail.textContent = statusText || 'Create or join a lobby to see live party status here.';
      }
      if (this.hostStopBtn) this.hostStopBtn.textContent = 'Leave Lobby';
      return;
    }

    const playerCount = Math.max(this.players.length, 1);
    const detail = statusText || (this.isHost
      ? 'Your lobby is live. Share the code and wait for friends to join.'
      : 'You are connected to an active lobby. Ready up when you are set.');

    if (this.lobbyConnectionBadge) {
      this.lobbyConnectionBadge.textContent = this.isHost ? 'LOBBY LIVE' : 'CONNECTED';
    }
    if (this.lobbyRoleChip) this.lobbyRoleChip.textContent = this.isHost ? 'HOST' : 'MEMBER';
    if (this.lobbyPrivacyChip) this.lobbyPrivacyChip.textContent = (this.currentLobbyPrivacy || 'private').toUpperCase();
    if (this.lobbyPlayerChip) this.lobbyPlayerChip.textContent = `${playerCount} PLAYER${playerCount === 1 ? '' : 'S'}`;
    if (this.lobbyServerChip) {
      this.lobbyServerChip.textContent = 'SERVER ONLINE';
      this.lobbyServerChip.classList.add('is-online');
    }
    if (this.lobbyStatusDetail) this.lobbyStatusDetail.textContent = detail;
    if (this.hostStopBtn) this.hostStopBtn.textContent = this.isHost ? 'Stop Hosting' : 'Leave Lobby';
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
    const modeEntry = getMode(this.selectedModeId);
    const isSoloMode = modeEntry?.category === 'solo';

    return {
      modeId: this.selectedModeId,
      singlePlayerMode: isSoloMode,
      trackId: this.selectedMap,
      arenaId: document.getElementById('battle-arena-select')?.value || DEFAULTS.arenaId,
      arenaTheme: this.selectedGlofluxTheme,
      battleType: this.selectedBattleType,
      maxPlayers: isSoloMode ? 1 : this.selectedMaxPlayers,
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

    // Track Builder navigates directly — no game config needed
    if (modeId === 'track_builder') {
      window.location.href = getPageForMode(modeId) || 'builder.html';
      return;
    }
    
    // Create Party mode directly creates a lobby
    if (modeId === 'create_party') {
      this.createLobby();
      return;
    }

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

    this.updateLobbyPresence();
  }

  refreshActionButtons() {
    const inLobby = !!this.room;
    const total = this.players.length;
    const readyCount = this.players.filter(p => p.isReady).length;
    const allReady = total > 0 && readyCount === total;

    // PLAY GAME button + indicator: visible only when NOT in a lobby
    if (this.playBtn) {
      this.playBtn.classList.toggle('hidden', inLobby);
    }
    if (this.playIndicator) {
      this.playIndicator.classList.toggle('hidden', inLobby || this.playBtn?.disabled);
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

  /** Update play-button label and the mode indicator chip beneath it */
  _syncPlayButton(modeEntry, isToolMode, isGloflux) {
    if (!this.playBtn || this.room) return;

    let icon, label, indicator;
    if (!this.selectedModeId) {
      icon = 'fa-hand-pointer';
      label = 'SELECT MODE';
      indicator = 'Choose a game mode first';
      this.playBtn.innerHTML = `<i class="fas ${icon}"></i> ${label}`;
      if (this.playIndicator && this.playIndicatorLabel) {
        this.playIndicator.classList.add('hidden');
        this.playIndicatorLabel.textContent = indicator;
      }
      return;
    }

    switch (this.selectedModeId) {
      case 'battle_online':
        icon = 'fa-globe';      label = 'GO ONLINE';
        indicator = 'Click to find a match';
        break;
      case 'quick_race':
        icon = 'fa-flag-checkered'; label = 'START RACE';
        indicator = 'Click to race';
        break;
      case 'local_2p_race':
      case 'local_2p_battle':
        icon = 'fa-columns';    label = 'START SPLIT SCREEN';
        indicator = 'Click to start';
        break;
      default:
        if (isGloflux) {
          icon = 'fa-atom';     label = 'CREATE FLUX LOBBY';
          indicator = 'Click to create';
        } else {
          icon = 'fa-play';     label = 'PLAY GAME';
          indicator = 'Click to play';
        }
        break;
    }

    this.playBtn.innerHTML = `<i class="fas ${icon}"></i> ${label} <i class="fas fa-chevron-right play-btn-arrow"></i>`;

    // Show indicator chip below button
    if (this.playIndicator && this.playIndicatorLabel) {
      const enabled = !this.playBtn.disabled;
      this.playIndicator.classList.toggle('hidden', !enabled);
      this.playIndicatorLabel.textContent = indicator;
    }
  }

  /** Brief attention-drawing pulse when a mode is selected */
  _pulsePlayButton() {
    if (!this.playBtn) return;
    this.playBtn.classList.remove('play-attention');
    void this.playBtn.offsetWidth;
    this.playBtn.classList.add('play-attention');
  }

  _getLeftSetupState() {
    const modeEntry = getMode(this.selectedModeId);
    const showBattle = !!(modeEntry?.selectors?.battleSettings);
    const isGloflux = modeEntry?.id === 'gloflux' || modeEntry?.id?.startsWith('gloflux_');
    const isSplitScreen = modeEntry?.id === 'local_2p_race' || modeEntry?.id === 'local_2p_battle';
    const showTrack = usesTrackSelection(this.selectedModeId) || usesArenaSelection(this.selectedModeId);
    const isRaceWithBots = usesTrackSelection(this.selectedModeId)
      && this.selectedModeId !== 'time_trial' && this.selectedModeId !== 'free_roam'
      && !isSplitScreen;

    return {
      showBattle,
      isGloflux,
      isSplitScreen,
      showTrack,
      isRaceWithBots,
      showSetup: showTrack || showBattle || isGloflux || isSplitScreen,
    };
  }

  refreshBattleControls() {
    const battleSettings = document.getElementById('battle-settings');
    const raceSettings = document.getElementById('race-settings');
    const glofluxSettings = document.getElementById('gloflux-settings');
    const splitscreenSettings = document.getElementById('splitscreen-settings');
    const modeEntry = getMode(this.selectedModeId);
    const { showBattle, isGloflux, isSplitScreen, showTrack, isRaceWithBots, showSetup } = this._getLeftSetupState();
    const hasModeSelection = !!modeEntry;

    // Show/hide the inline setup section
    if (this.inlineSetup) {
      this.inlineSetup.classList.toggle('hidden', !hasModeSelection || !showSetup);
    }

    // Panel visibility
    battleSettings?.classList.toggle('hidden', !showBattle);
    raceSettings?.classList.toggle('hidden', !isRaceWithBots);
    glofluxSettings?.classList.toggle('hidden', !isGloflux);
    splitscreenSettings?.classList.toggle('hidden', !isSplitScreen);

    // Hide track/map selector for modes that don't need it
    if (this.mapSelectorContainer) {
      this.mapSelectorContainer.classList.toggle('hidden', !showTrack);
    }

    // Update track carousel title for battle vs race
    const carouselTitle = document.querySelector('.track-carousel-title');
    if (carouselTitle && showTrack) {
      carouselTitle.textContent = usesArenaSelection(this.selectedModeId) ? 'SELECT ARENA' : 'SELECT TRACK';
    }

    // Sync the play button label, icon and indicator
    this._syncPlayButton(modeEntry, false, isGloflux);

    // Action buttons are handled by refreshActionButtons()
    this.refreshActionButtons();
  }

  applyStateToUI(state) {
    // Sync selectedModeId from server gameMode (race/battle)
    const serverIsBattle = state.gameMode === 'battle';
    // If we're in a lobby, derive the modeId from server state
    if (this.room) {
      if (state.singlePlayerMode && state.modeId) {
        this.selectedModeId = state.modeId;
      } else {
        this.selectedModeId = state.gameMode === 'gloflux'
          ? (state.modeId || 'gloflux')
          : (serverIsBattle ? 'battle_online' : 'race_online');
      }
      this.selectedMode = state.gameMode || (serverIsBattle ? 'battle' : 'race');
    }

    // Re-render mode selector UI
    this._renderModeCards();

    const mapName = document.querySelector('.selected-map-name');
    const selectedTrack = getSelectableContentList(this.selectedModeId).find((t) => t.id === this.selectedMap);
    if (mapName && selectedTrack) mapName.textContent = selectedTrack.name;

    // Sync the 3D track carousel to server state
    if (window.__trackPreview) {
      window.__trackPreview.setMode(usesArenaSelection(this.selectedModeId) ? 'battle' : 'race');
      window.__trackPreview.setById(this.selectedMap);
    }

    document.querySelectorAll('.dropdown-option').forEach((option) => {
      option.classList.toggle('selected', option.getAttribute('data-map-id') === this.selectedMap);
    });

    const battleTypeEl = document.getElementById('battle-type-select');
    if (battleTypeEl && battleTypeEl.value !== this.selectedBattleType) battleTypeEl.value = this.selectedBattleType;
    this._syncGlassDropdown(battleTypeEl);

    const maxPlayersEl = document.getElementById('battle-max-players');
    if (maxPlayersEl) maxPlayersEl.value = String(this.selectedMaxPlayers);
    this._syncGlassDropdown(maxPlayersEl);

    const glofluxMaxPlayersEl = document.getElementById('gloflux-player-cap');
    if (glofluxMaxPlayersEl) glofluxMaxPlayersEl.value = String(this.selectedMaxPlayers);
    this._syncGlassDropdown(glofluxMaxPlayersEl);

    const glofluxThemeEl = document.getElementById('gloflux-theme');
    this._syncGlassDropdown(glofluxThemeEl);

    if (this.partyCodeDisplay) {
      this.partyCodeDisplay.textContent = state.lobbyCode || this.currentLobbyCode || '------';
    }
  }

  initMapSelector() {
    const mapDropdown = document.querySelector('.map-dropdown');
    const dropdownButton = document.querySelector('.dropdown-button');
    const dropdownContent = document.getElementById('track-dropdown-options');

    // Populate the dropdown list for the current mode
    this._rebuildMapDropdown();

    // Attach event listeners only once
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
      const selectedMapName = document.querySelector('.selected-map-name');
      if (selectedMapName) selectedMapName.textContent = option.textContent;
      mapDropdown?.classList.remove('open');

      // Sync the 3D carousel to the dropdown selection
      if (window.__trackPreview) {
        window.__trackPreview.setById(mapId);
      }
      document.dispatchEvent(new CustomEvent('mapChanged', { detail: { mapId } }));
      this.sendSettingsUpdate();
    });
  }

  /** Rebuild the map dropdown list without re-attaching listeners. */
  _rebuildMapDropdown() {
    const selectedMapName = document.querySelector('.selected-map-name');
    const dropdownContent = document.getElementById('track-dropdown-options');

    if (dropdownContent) {
      dropdownContent.innerHTML = '';
      const items = getSelectableContentList(this.selectedModeId);
      items.forEach((track, index) => {
        const option = document.createElement('div');
        option.className = `dropdown-option${index === 0 ? ' selected' : ''}`;
        option.setAttribute('data-map-id', track.id);
        option.textContent = track.name;
        dropdownContent.appendChild(option);
      });
    }

    const items = getSelectableContentList(this.selectedModeId);
    const firstItem = items[0];
    if (firstItem) {
      this.selectedMap = firstItem.id;
      if (selectedMapName) selectedMapName.textContent = firstItem.name;
    }
  }

  initModeSelector() {
    const cardsContainer = document.getElementById('mode-cards');
    const battleTypeEl = document.getElementById('battle-type-select');
    const maxPlayersEl = document.getElementById('battle-max-players');
    const botCountEl = document.getElementById('battle-bot-count');

    this._renderModeCards();

    // Battle settings listeners
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

    this._initGlassDropdown(battleTypeEl);
    this._initGlassDropdown(maxPlayersEl);

    // Split screen type listener
    const splitTypeEl = document.getElementById('split-type-select');
    splitTypeEl?.addEventListener('change', () => {
      this.splitScreenType = splitTypeEl.value;
      // Swap track vs arena carousel
      if (window.__trackPreview) {
        window.__trackPreview.setMode(splitTypeEl.value === 'battle' ? 'battle' : 'race');
      }
      this._rebuildMapDropdown();
      const carouselTitle = document.querySelector('.track-carousel-title');
      if (carouselTitle) {
        carouselTitle.textContent = splitTypeEl.value === 'battle' ? 'SELECT ARENA' : 'SELECT TRACK';
      }
    });
    this._initGlassDropdown(splitTypeEl);
  }

  _selectMode(modeId) {
    const mode = getMode(modeId);
    if (!mode || !isPlayable(modeId)) return;

    // Collapse initial big-card state on first mode selection
    const leftPanel = document.querySelector('.simplified-left-panel');
    if (leftPanel?.classList.contains('mode-initial')) {
      leftPanel.classList.remove('mode-initial');
    }

    this.selectedModeId = modeId;

    // Derive legacy selectedMode for backward compat with Colyseus payloads
    this.selectedMode = getLegacyModeFamily(modeId);

    // Sync track carousel to the right list
    if (window.__trackPreview) {
      window.__trackPreview.setMode(usesArenaSelection(modeId) ? 'battle' : 'race');
    }

    // Reset map to defaults when switching race↔battle
    this._rebuildMapDropdown();

    // Sync carousel to the newly selected default map
    if (window.__trackPreview && this.selectedMap) {
      window.__trackPreview.setById(this.selectedMap);
    }
    this.refreshBattleControls();
    this._renderModeCards();
    if (this.playBtn) {
      this.playBtn.disabled = false;
      this._pulsePlayButton();
    }
    this.sendSettingsUpdate();
  }

  _renderModeCards() {
    const cardsContainer = document.getElementById('mode-cards');
    if (!cardsContainer) return;

    const modes = getVisibleModes();
    const leftPanel = document.querySelector('.simplified-left-panel');
    const isInitial = leftPanel?.classList.contains('mode-initial');

    // In initial landing state, append track_builder as 5th tile
    const allModes = [...modes];
    if (isInitial) {
      const builder = getMode('track_builder');
      if (builder) allModes.push(builder);
    }

    cardsContainer.innerHTML = '';
    allModes.forEach((mode) => {
      const card = document.createElement('div');
      card.className = 'mode-card';
      if (mode.id === this.selectedModeId) card.classList.add('active');
      card.setAttribute('data-mode-id', mode.id);

      let badgeHTML = '';
      if (mode.status === MODE_STATUS.BETA) {
        badgeHTML = '<span class="mode-card-badge beta">BETA</span>';
      }

      card.innerHTML = `
        <div class="mode-card-icon"><i class="fas ${mode.icon}"></i></div>
        <div class="mode-card-info">
          <div class="mode-card-label">${mode.label}</div>
        </div>
        ${badgeHTML}
      `;

      if (mode.page && mode.category === 'tools') {
        card.addEventListener('click', () => { window.location.href = mode.page; });
      } else {
        card.addEventListener('click', () => this._selectMode(mode.id));
      }
      cardsContainer.appendChild(card);
    });
  }

  initRaceSettings() {
    const botCountEl = document.getElementById('race-bot-count');
    const lapsEl = document.getElementById('race-laps');

    botCountEl?.addEventListener('change', () => {
      const parsed = parseInt(botCountEl.value || '5', 10);
      this.selectedBotCount = Number.isFinite(parsed) ? Math.max(0, Math.min(11, parsed)) : 5;
      botCountEl.value = String(this.selectedBotCount);
    });

    lapsEl?.addEventListener('change', () => {
      this.selectedLaps = parseInt(lapsEl.value || '3', 10);
    });

    this._initGlassDropdown(lapsEl);
  }

  initGlofluxSettings() {
    const themeEl = document.getElementById('gloflux-theme');
    const maxPlayersEl = document.getElementById('gloflux-player-cap');

    themeEl?.addEventListener('change', () => {
      this.selectedGlofluxTheme = themeEl.value || 'nuclear_desert';
      this.sendSettingsUpdate();
    });

    maxPlayersEl?.addEventListener('change', () => {
      const parsed = parseInt(maxPlayersEl.value || '8', 10);
      this.selectedMaxPlayers = Number.isFinite(parsed) ? Math.max(2, Math.min(12, parsed)) : 8;
      maxPlayersEl.value = String(this.selectedMaxPlayers);
      this._syncGlassDropdown(maxPlayersEl);
      this.sendSettingsUpdate();
    });

    this._initGlassDropdown(themeEl);
    this._initGlassDropdown(maxPlayersEl);
  }

  _initGlassDropdown(selectEl) {
    if (!selectEl || selectEl.dataset.glassDropdownInitialized === 'true') return;

    const wrapper = document.createElement('div');
    wrapper.className = 'glass-dropdown';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'glass-dropdown-button';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');

    const value = document.createElement('span');
    value.className = 'glass-dropdown-value';

    const arrow = document.createElement('span');
    arrow.className = 'glass-dropdown-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.innerHTML = '<i class="fas fa-chevron-down"></i>';

    button.appendChild(value);
    button.appendChild(arrow);

    const content = document.createElement('div');
    content.className = 'glass-dropdown-content';
    content.setAttribute('role', 'listbox');
    content.setAttribute('aria-label', selectEl.getAttribute('aria-label') || selectEl.id || 'Options');

    wrapper.appendChild(button);
    wrapper.appendChild(content);
    selectEl.insertAdjacentElement('afterend', wrapper);
    selectEl.classList.add('hidden');
    selectEl.tabIndex = -1;
    selectEl.setAttribute('aria-hidden', 'true');
    selectEl.dataset.glassDropdownInitialized = 'true';

    const sync = () => {
      const selectedOption = selectEl.options?.[selectEl.selectedIndex] || null;
      value.textContent = selectedOption?.textContent?.trim() || '';
      content.querySelectorAll('.glass-dropdown-option').forEach((option) => {
        option.classList.toggle('selected', option.getAttribute('data-value') === selectEl.value);
      });
    };

    content.innerHTML = '';
    [...selectEl.options].forEach((option) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'glass-dropdown-option';
      item.setAttribute('data-value', option.value);
      item.setAttribute('role', 'option');
      item.textContent = option.textContent || option.value;
      item.addEventListener('click', () => {
        selectEl.value = option.value;
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        wrapper.classList.remove('open');
        button.setAttribute('aria-expanded', 'false');
        sync();
      });
      content.appendChild(item);
    });

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const willOpen = !wrapper.classList.contains('open');
      document.querySelectorAll('.glass-dropdown.open').forEach((openDropdown) => {
        if (openDropdown !== wrapper) {
          openDropdown.classList.remove('open');
          openDropdown.querySelector('.glass-dropdown-button')?.setAttribute('aria-expanded', 'false');
        }
      });
      wrapper.classList.toggle('open', willOpen);
      button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });

    document.addEventListener('click', () => {
      wrapper.classList.remove('open');
      button.setAttribute('aria-expanded', 'false');
    });

    selectEl.addEventListener('change', sync);
    selectEl._syncGlassDropdown = sync;
    sync();
  }

  _syncGlassDropdown(selectOrId) {
    const selectEl = typeof selectOrId === 'string'
      ? document.getElementById(selectOrId)
      : selectOrId;
    selectEl?._syncGlassDropdown?.();
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

  /* ═══════════════════════════════════════════════════
     LENS ENGINE — 3D tilt, press-down, spring-bounce
     card switching inspired by Apple App Store cards
  ═══════════════════════════════════════════════════ */
  _initLensEngine() {
    const stacks = document.querySelectorAll('.lens-stack');
    stacks.forEach(stack => {
      const deck = stack.querySelector('.lens-deck');
      const cards = [...stack.querySelectorAll('.lens-card')];
      const pills = [...stack.querySelectorAll('.lens-pill[data-lens]')];
      if (!deck || cards.length < 2) return;

      // Init: first card active, rest peek
      cards.forEach((c, i) => {
        if (i === 0) { c.classList.add('active'); c.classList.remove('peek'); }
        else { c.classList.remove('active'); c.classList.add('peek'); }
      });

      // Switch card function with spring animation
      const switchCard = (targetLens) => {
        const current = stack.querySelector('.lens-card.active');
        const target = stack.querySelector(`.lens-card[data-lens="${targetLens}"]`);
        if (!target || target === current) return;

        // Animate current out
        if (current) {
          current.classList.remove('active', 'lens-pressing');
          current.classList.add('lens-leaving');
          current.style.removeProperty('--lens-tilt-x');
          current.style.removeProperty('--lens-tilt-y');
          current.addEventListener('animationend', () => {
            current.classList.remove('lens-leaving');
            current.classList.add('peek');
          }, { once: true });
        }

        // Animate target in
        target.classList.remove('peek');
        target.classList.add('active', 'lens-entering');
        target.addEventListener('animationend', () => {
          target.classList.remove('lens-entering');
        }, { once: true });

        // Update pills
        pills.forEach(p => p.classList.toggle('active', p.dataset.lens === targetLens));
      };

      stack._switchLensCard = switchCard;

      // Pill click
      pills.forEach(pill => {
        pill.addEventListener('click', () => switchCard(pill.dataset.lens));
      });

      // Peek card click
      cards.forEach(card => {
        card.addEventListener('click', (e) => {
          if (card.classList.contains('peek')) {
            e.stopPropagation();
            switchCard(card.dataset.lens);
          }
        });
      });

      // 3D tilt on mouse move (active card only)
      deck.addEventListener('mousemove', (e) => {
        const active = stack.querySelector('.lens-card.active');
        if (!active) return;
        const rect = deck.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        const tiltX = (x - 0.5) * 12;  // -6 to +6 degrees
        const tiltY = (y - 0.5) * -8;  // -4 to +4 degrees
        active.style.setProperty('--lens-tilt-x', tiltX);
        active.style.setProperty('--lens-tilt-y', tiltY);
      });

      // Reset tilt on mouse leave
      deck.addEventListener('mouseleave', () => {
        const active = stack.querySelector('.lens-card.active');
        if (!active) return;
        active.style.setProperty('--lens-tilt-x', 0);
        active.style.setProperty('--lens-tilt-y', 0);
      });

      // Press-down on mousedown (Apple App Store feel)
      deck.addEventListener('mousedown', (e) => {
        const active = stack.querySelector('.lens-card.active');
        if (!active || !active.contains(e.target)) return;
        if (e.target.closest('button, input, select, a, .kart-nav-btn, .mode-card, .cup-card, .glo-swatch, .weapon-loadout-btn, .icon-btn, .lens-pill')) return;
        active.classList.add('lens-pressing');
      });

      const releasePressing = () => {
        const active = stack.querySelector('.lens-card.active.lens-pressing');
        if (active) active.classList.remove('lens-pressing');
      };
      deck.addEventListener('mouseup', releasePressing);
      deck.addEventListener('mouseleave', releasePressing);

      // Touch support for mobile
      deck.addEventListener('touchstart', (e) => {
        const active = stack.querySelector('.lens-card.active');
        if (!active || !active.contains(e.target)) return;
        if (e.target.closest('button, input, select, a')) return;
        active.classList.add('lens-pressing');
      }, { passive: true });

      deck.addEventListener('touchend', releasePressing, { passive: true });
      deck.addEventListener('touchcancel', releasePressing, { passive: true });
    });

    // ─── Center panel 3D tilt + parallax ───
    this._initCenterCardEngine();

    // ─── GLO ripple on all button clicks ───
    this._initGloRipple();
  }

  /* Center panel — 3D perspective tilt following mouse,
     with parallax child layers and press-down response */
  _initCenterCardEngine() {
    const cp = document.querySelector('.center-panel');
    if (!cp) return;

    // Use the game-content as the perspective origin so tilt looks right
    const parent = cp.parentElement;
    if (parent) parent.style.perspective = '1200px';

    // 3D tilt on mouse move
    cp.addEventListener('mousemove', (e) => {
      const rect = cp.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      const tiltX = (x - 0.5) * 6;   // ±3 degrees
      const tiltY = (y - 0.5) * -5;  // ±2.5 degrees
      cp.style.setProperty('--cp-tilt-x', tiltX);
      cp.style.setProperty('--cp-tilt-y', tiltY);
    });

    // Reset tilt on leave with smooth spring-back
    cp.addEventListener('mouseleave', () => {
      cp.style.setProperty('--cp-tilt-x', 0);
      cp.style.setProperty('--cp-tilt-y', 0);
      cp.style.setProperty('--cp-press', 0);
    });

    // Press-down on center panel body
    cp.addEventListener('mousedown', (e) => {
      // Don't press-down when clicking interactive elements
      if (e.target.closest('button, input, select, a, .kart-nav-btn, .glo-swatch, .glo-drum-row')) return;
      cp.style.setProperty('--cp-press', 1);
      cp.style.transition = 'transform 0.10s ease';
    });

    const releaseCenter = () => {
      cp.style.setProperty('--cp-press', 0);
      cp.style.transition = 'transform 0.35s cubic-bezier(0.34,1.56,0.64,1)';
    };
    cp.addEventListener('mouseup', releaseCenter);
    cp.addEventListener('mouseleave', releaseCenter);

    // Touch press-down for center panel
    cp.addEventListener('touchstart', (e) => {
      if (e.target.closest('button, input, select, a')) return;
      cp.style.setProperty('--cp-press', 1);
      cp.style.transition = 'transform 0.10s ease';
    }, { passive: true });
    cp.addEventListener('touchend', releaseCenter, { passive: true });
    cp.addEventListener('touchcancel', releaseCenter, { passive: true });
  }

  /* GLO ripple — spawns a radial glow wave on button clicks,
     giving each interaction a physical "energy pulse" feel */
  _initGloRipple() {
    const selector = 'button, .mode-card, .mode-cat-tab, .cup-card, .lens-pill, .weapon-loadout-btn, .kart-nav-btn';
    document.addEventListener('click', (e) => {
      const target = e.target.closest(selector);
      if (!target) return;

      // Find the nearest panel-level container to position the ripple
      const container = target.closest('.lens-card, .center-panel');
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const size = Math.max(rect.width, rect.height) * 0.5;

      const ripple = document.createElement('div');
      ripple.className = 'glo-ripple';
      ripple.style.cssText = `width:${size}px;height:${size}px;left:${x - size / 2}px;top:${y - size / 2}px;`;

      container.appendChild(ripple);
      ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
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
