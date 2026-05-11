import { Client } from 'colyseus.js';
import { getColyseusEndpoint } from './modules/realtime/feature-flag.js';
import {
  MODE_STATUS,
  MODE_REGISTRY,
  getVisibleModes,
  getPageForMode,
  requiresLobby,
  isPlayable,
  getMode,
} from './game-modes.js';
import {
  CUSTOM_TRACK_ID,
} from './modules/content-registry.js';
import { initPageTransitions, navigateWithTransition } from './ui/page-transition.js';
import { mountLobbyStudioPicker, getLobbyStudioPicker } from './lobby-studio-picker.js';
import {
  DEFAULTS,
  BUILDER_LAUNCH_INTENT_KEY,
  PERFORMANCE_MODE_STORAGE_KEY,
  PERFORMANCE_MODE,
  normalizePerformanceMode,
  getPerformanceModeMeta,
  BATTLE_WEAPON_LIBRARY,
  BATTLE_RULE_PRESETS,
  getLegacyModeFamily,
  usesArenaSelection,
  usesTrackSelection,
  usesStudioTracks,
  getSelectableContentList,
  loadStudioTracks,
  LOCAL_DRAFT_TRACK_ID,
  readLocalDraftTrack,
  pickRandom,
  normalizeLobbyCode,
  generateLobbyCode,
  getStoredGlo,
} from './lobby/constants.js';

initPageTransitions();

// NOTE: Phase 1.x refactor — constants & pure helpers moved to ./lobby/constants.js.
// A previous duplicate `_initLensEngine` definition (Apple `.lens-card` tilt) was removed
// here: the second definition further down (operating on `.lens-stack`) silently overrode
// it at class evaluation time, so the Apple-card code never ran. See git log for history.

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
    this.selectedModeId = null;
    this.selectedMap = DEFAULTS.arenaId;
    this.selectedBattleType = DEFAULTS.battleType;
    this.selectedMaxPlayers = DEFAULTS.maxPlayers;
    this.selectedBotCount = DEFAULTS.botCount;
    this.selectedLaps = 3;
    this.selectedLoadout = DEFAULTS.loadoutId;
    this.selectedCustomWeapons = new Set(['bowling_ball', 'plunger', 'cake', 'bubblegum', 'shield']);
    this.activeBattleView = 'core';
    this.selectedCup = 'starter';
    this.selectedGlofluxTheme = 'nuclear_desert';
    this.splitScreenType = 'race';
    this.performanceMode = normalizePerformanceMode(localStorage.getItem(PERFORMANCE_MODE_STORAGE_KEY) || sessionStorage.getItem(PERFORMANCE_MODE_STORAGE_KEY));

    this.currentLobbyCode = '';
    this.currentLobbyPrivacy = 'private';

    this.initUIElements();
    this.attachEventListeners();
    this.initMapSelector();
    this.initModeSelector();
    this.initRaceSettings();
    this.initGlofluxSettings();
    this.initWeaponLoadout();
    this.initBattleCustomizationLab();
    this.populateArenaSelector();
    this.refreshBattleControls();
    this._initLensEngine();
    this._consumeBuilderLaunchIntent();

    // Phase 2.4: kick off Track Studio course fetch for the unified online
    // mode. The dropdown is seeded with Tutorial Loop synchronously and
    // re-rendered once the full template/community/mine list resolves.
    loadStudioTracks().then(() => {
      try {
        if (usesStudioTracks(this.selectedModeId)) {
          this._rebuildMapDropdown();
          window.__trackPreview?.refreshStudioList?.();
          if (this.selectedMap) window.__trackPreview?.setById?.(this.selectedMap);
          getLobbyStudioPicker()?.refresh();
        }
      } catch { /* ignore */ }
    }).catch(() => { /* offline / backend down — keep seed */ });
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
    this.performanceSettingsBtn = document.getElementById('performance-settings-btn');
    this.performanceSettingsPanel = document.getElementById('performance-settings-panel');
    this.performanceSettingsBackdrop = document.getElementById('performance-settings-backdrop');
    this.performanceSettingsClose = document.getElementById('performance-settings-close');
    this.performanceSettingsSummary = document.getElementById('performance-settings-summary');
    this.performanceModeNote = document.getElementById('performance-mode-note');
    this.performanceModeCards = Array.from(document.querySelectorAll('[data-performance-mode]'));

    this.playerList = document.getElementById('player-list');
    this.readyCountEl = document.getElementById('ready-count');
    this.racersTitle = document.querySelector('.lens-stack-right .panel-title');
    this.rightPanel = document.querySelector('.lens-stack-right');

    this.playerNameInput.value = '';
    this.playerNameInput.placeholder = this.playerName;
    // Cycle placeholder between default name and prompt
    this._placeholderTexts = [this.playerName, 'Enter Your Nickname'];
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

    this._syncPerformanceModeUI();

    // Phase 2.5e: condensed Studio picker (templates / community / mine)
    // for online_arena. Visibility is toggled by _selectMode/applyStateToUI.
    const studioPickerRoot = document.getElementById('lobby-studio-picker');
    if (studioPickerRoot) mountLobbyStudioPicker(studioPickerRoot);
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

    // Auto-fill from URL invite link: ?code=ABCD&mode=race_editor3
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const inviteCode = urlParams.get('code');
      if (inviteCode && this.joinCodeInput) {
        this.joinCodeInput.value = inviteCode;
        const inviteMode = urlParams.get('mode');
        if (inviteMode) this.selectedModeId = inviteMode;
        // Defer one tick so the rest of the lobby UI has finished wiring up.
        setTimeout(() => { try { this.joinLobbyByCode(); } catch {} }, 250);
      }
    } catch { /* ignore */ }

    this.playerNameInput?.addEventListener('input', () => {
      this.playerName = this.playerNameInput.value.trim() || this.playerName;
      this.sendPlayerUpdate();
    });

    const backBtn = document.getElementById('back-to-modes-btn');
    backBtn?.addEventListener('click', () => this.resetToModeSelection());

    this.playBtn?.addEventListener('click', () => this.onPlayClicked());
    this.readyBtn?.addEventListener('click', () => this.toggleReady());
    this.startMatchBtn?.addEventListener('click', () => this.startMatch());
    this.performanceSettingsBtn?.addEventListener('click', () => this._togglePerformanceSettings());
    this.performanceSettingsBackdrop?.addEventListener('click', () => this._togglePerformanceSettings(false));
    this.performanceSettingsClose?.addEventListener('click', () => this._togglePerformanceSettings(false));
    this.performanceModeCards.forEach((card) => {
      card.addEventListener('click', () => {
        this._setPerformanceMode(card.getAttribute('data-performance-mode'));
      });
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this._togglePerformanceSettings(false);
    });

    document.addEventListener('kartChanged', (event) => {
      if (!event.detail?.kartId) return;
      sessionStorage.setItem('selectedKart', event.detail.kartId);
      // Mirror to editor3's storage so TinkerTracks picks up the lobby kart.
      try {
        sessionStorage.setItem('studioSelectedKart', event.detail.kartId);
        localStorage.setItem('studioSelectedKart', event.detail.kartId);
      } catch {}
      this.sendPlayerUpdate();
    });

    // Track carousel integration
    document.addEventListener('trackCarouselChanged', (event) => {
      if (!event.detail?.trackId) return;
      const trackId = event.detail.trackId;
      this.selectedMap = trackId;
      // Phase 2.5: keep customTrackData in sync when the carousel lands on
      // the host's local browser draft so multiplayer-editor3 can ship it
      // through the LobbyRoom -> Editor3RaceRoom path.
      if (trackId === LOCAL_DRAFT_TRACK_ID) {
        const draft = readLocalDraftTrack();
        if (draft?.raw) sessionStorage.setItem('customTrackData', draft.raw);
      } else if (trackId !== CUSTOM_TRACK_ID) {
        sessionStorage.removeItem('customTrackData');
      }
      // Sync hidden dropdown for compatibility
      const mapName = document.querySelector('.selected-map-name');
      if (mapName) mapName.textContent = event.detail.trackName || trackId;
      document.querySelectorAll('.dropdown-option').forEach((opt) =>
        opt.classList.toggle('selected', opt.getAttribute('data-map-id') === trackId)
      );
      getLobbyStudioPicker()?.setSelectedId(trackId);
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
        sessionStorage.setItem('customTrackData', json);
        if (status) {
          status.textContent = `Imported: ${trackData.name || 'Custom Track'} (saved for builder only)`;
          status.style.color = '#44ff88';
        }
        if (input) input.value = '';
      } catch {
        if (status) status.textContent = 'Failed to parse track data.';
      }
    });
  }

  _openBuilder() {
    void navigateWithTransition('editor.html');
  }

  _togglePerformanceSettings(forceOpen) {
    if (!this.performanceSettingsPanel) return;
    const shouldOpen = typeof forceOpen === 'boolean'
      ? forceOpen
      : this.performanceSettingsPanel.classList.contains('hidden');
    this.performanceSettingsPanel.classList.toggle('hidden', !shouldOpen);
    this.performanceSettingsPanel.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
    this.performanceSettingsBtn?.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
  }

  _setPerformanceMode(nextMode, { persist = true, sync = true } = {}) {
    const normalized = normalizePerformanceMode(nextMode);
    this.performanceMode = normalized;

    if (persist) {
      localStorage.setItem(PERFORMANCE_MODE_STORAGE_KEY, normalized);
      sessionStorage.setItem(PERFORMANCE_MODE_STORAGE_KEY, normalized);
    }

    this._syncPerformanceModeUI();

    if (sync && this.room && this.isHost) {
      this.sendSettingsUpdate();
    }
  }

  _syncPerformanceModeUI() {
    const meta = getPerformanceModeMeta(this.performanceMode);
    if (this.performanceSettingsSummary) this.performanceSettingsSummary.textContent = meta.summary;
    if (this.performanceModeNote) this.performanceModeNote.textContent = meta.note;
    this.performanceModeCards.forEach((card) => {
      const selected = normalizePerformanceMode(card.getAttribute('data-performance-mode')) === this.performanceMode;
      card.classList.toggle('is-selected', selected);
      card.setAttribute('aria-checked', selected ? 'true' : 'false');
    });
  }

  _syncSelectedMapUI(mapId) {
    const items = getSelectableContentList(this.selectedModeId);
    const selectedEntry = items.find((entry) => entry.id === mapId);
    if (!selectedEntry) return false;

    this.selectedMap = mapId;

    const mapName = document.querySelector('.selected-map-name');
    if (mapName) mapName.textContent = selectedEntry.name;

    document.querySelectorAll('.dropdown-option').forEach((option) => {
      option.classList.toggle('selected', option.getAttribute('data-map-id') === mapId);
    });

    if (window.__trackPreview) {
      window.__trackPreview.setMode(usesStudioTracks(this.selectedModeId) ? 'studio' : (usesArenaSelection(this.selectedModeId) ? 'battle' : 'race'));
      window.__trackPreview.setById(mapId);
    }

    return true;
  }

  _consumeBuilderLaunchIntent() {
    const rawIntent = sessionStorage.getItem(BUILDER_LAUNCH_INTENT_KEY);
    if (!rawIntent) return;

    sessionStorage.removeItem(BUILDER_LAUNCH_INTENT_KEY);

    let intent;
    try {
      intent = JSON.parse(rawIntent);
    } catch {
      return;
    }

    if (!intent || typeof intent !== 'object') return;

    if (intent.customTrackData) {
      const serialized = typeof intent.customTrackData === 'string'
        ? intent.customTrackData
        : JSON.stringify(intent.customTrackData);
      sessionStorage.setItem('customTrackData', serialized);
    }

    this._selectMode(intent.modeId || 'online_arena');

    this.selectedBattleType = intent.battleType || this.selectedBattleType;
    this.selectedMaxPlayers = Math.max(1, Math.min(12, Number(intent.maxPlayers || this.selectedMaxPlayers || DEFAULTS.maxPlayers)));
    this.selectedLoadout = intent.loadoutId || this.selectedLoadout;
    this._setPerformanceMode(intent.performanceMode || this.performanceMode, { persist: true, sync: false });

    const battleTypeEl = document.getElementById('battle-type-select');
    if (battleTypeEl) battleTypeEl.value = this.selectedBattleType;
    this._syncGlassDropdown(battleTypeEl);
    this._syncBattleTypePills();

    const maxPlayersEl = document.getElementById('battle-max-players');
    if (maxPlayersEl) maxPlayersEl.value = String(this.selectedMaxPlayers);
    this._syncGlassDropdown(maxPlayersEl);

    const scoreLimit = Number(intent.scoreLimit || DEFAULTS.scoreLimit) || DEFAULTS.scoreLimit;
    const scoreLimitEl = document.getElementById('battle-score-limit');
    if (scoreLimitEl) scoreLimitEl.value = String(scoreLimit);

    this._syncLoadoutButtons();
    this._syncCustomWeaponPanel();
    this._syncSelectedMapUI(intent.selectedMap || CUSTOM_TRACK_ID);
    this._updateBattleSummary();
    this.refreshBattleControls();
    this.sendSettingsUpdate();

    if (intent.autoCreateLobby) {
      window.setTimeout(async () => {
        await this.createLobby();
        if (intent.autoStart) {
          window.setTimeout(() => this.startMatch(), 900);
        }
      }, 0);
    }
  }

  async createLobby() {
    const privacy = 'private';
    const code = generateLobbyCode();
    this.currentLobbyCode = code;
    this._showConnectingState(code);

    const maxRetries = 2;
    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`[lobby] Retry ${attempt}/${maxRetries} connecting to lobby...`);
          if (this.lobbyStatusDetail) this.lobbyStatusDetail.textContent = `Retrying (${attempt}/${maxRetries})\u2026`;
          await new Promise(r => setTimeout(r, 1200 * attempt));
        }
        await this.connectLobby('joinOrCreate', {
          lobbyCode: code,
          privacy,
          gameMode: this.selectedMode,
          ...this.buildSettingsPayload(),
          ...this.buildPlayerPayload(),
        });
        return; // success
      } catch (error) {
        lastError = error;
        console.warn(`[lobby] Attempt ${attempt + 1} failed:`, error?.message || error);
        if (attempt === maxRetries) break;
      }
    }
    this._showLobbyError('Connection failed. Diagnosing\u2026');
    const msg = await this.getLobbyErrorMessage(lastError, 'Create failed');
    this._showLobbyError(msg);
  }

  async quickMatch() {
    this._showConnectingState('');
    const maxRetries = 2;
    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`[lobby] Quick match retry ${attempt}/${maxRetries}...`);
          if (this.lobbyStatusDetail) this.lobbyStatusDetail.textContent = `Retrying (${attempt}/${maxRetries})\u2026`;
          await new Promise(r => setTimeout(r, 1200 * attempt));
        }
        await this.connectLobby('joinOrCreate', {
          lobbyCode: '',
          privacy: 'open',
          gameMode: this.selectedMode,
          ...this.buildSettingsPayload(),
          ...this.buildPlayerPayload(),
        });
        return; // success
      } catch (error) {
        lastError = error;
        console.warn(`[lobby] Quick match attempt ${attempt + 1} failed:`, error?.message || error);
        if (attempt === maxRetries) break;
      }
    }
    this._showLobbyError('Connection failed. Diagnosing\u2026');
    const msg = await this.getLobbyErrorMessage(lastError, 'Quick match failed');
    this._showLobbyError(msg);
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
      const syncedWeaponPool = state.weaponPool && typeof state.weaponPool[Symbol.iterator] === 'function'
        ? Array.from(state.weaponPool).map((weaponId) => String(weaponId || '').trim()).filter(Boolean)
        : [];
      const serverSelectedMap = state.gameMode === 'battle'
        ? (state.arenaId || state.trackId || this.selectedMap)
        : (state.trackId || this.selectedMap);

      this.currentLobbyCode = state.lobbyCode || this.currentLobbyCode;
      this.currentLobbyPrivacy = state.privacy || this.currentLobbyPrivacy;
      this.selectedMode = state.gameMode || this.selectedMode;
      this.selectedModeId = state.modeId || this.selectedModeId;
      this.selectedMap = serverSelectedMap;
      this.selectedBattleType = state.battleType || this.selectedBattleType;
      this.selectedMaxPlayers = Number(state.maxPlayers || this.selectedMaxPlayers || 12);
      this.selectedLoadout = state.loadoutId || this.selectedLoadout;
      this.performanceMode = normalizePerformanceMode(state.performanceMode || this.performanceMode);
      if (this.selectedLoadout === 'custom') {
        this.selectedCustomWeapons = new Set(syncedWeaponPool);
      }

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
      this._applyGuestLock();
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
      console.info('[custom-arena-debug] lobby matchStart received', {
        roomCode: this.currentLobbyCode || null,
        modeId: gameConfig?.modeId || null,
        gameMode: gameConfig?.gameMode || null,
        trackId: gameConfig?.trackId || null,
        arenaId: gameConfig?.arenaId || null,
        customTrackBytes: gameConfig?.customTrackData?.length || 0,
        selectedMap: this.selectedMap || null,
      });
      sessionStorage.setItem('gameConfig', JSON.stringify(gameConfig));
      // Carry the local player's identity so multiplayer pages (e.g.
      // multiplayer-editor3) can pass it as joinOrCreate options.
      try {
        const mySid = this.room?.sessionId;
        const me = (gameConfig.players || []).find((p) => p.id === mySid);
        if (me) {
          gameConfig.localPlayerName = me.name;
          gameConfig.localPlayerColor = me.playerColor;
          gameConfig.localPlayerKart = me.playerKart;
          // Carry the local player's GLO selection so the multiplayer
          // page can render their chosen underglow pattern + colour and
          // forward it to the race room (which broadcasts it to peers).
          gameConfig.localGloEffect = me.gloEffect;
          gameConfig.localGloColor = me.gloColor;
          gameConfig.localGloColor2 = me.gloColor2;
          sessionStorage.setItem('gameConfig', JSON.stringify(gameConfig));
        }
      } catch { /* best-effort */ }
      // If host set a custom track, store it so game pages can load it
      if (gameConfig.customTrackData) {
        sessionStorage.setItem('customTrackData', gameConfig.customTrackData);
      }
      // Online modes always go to realtime.html
      void navigateWithTransition(getPageForMode(this.selectedModeId) || 'realtime.html');
    });

    room.onLeave(() => {
      this.resetLobbyState('Lobby closed.');
    });

    this.sendPlayerUpdate();
  }

  /**
   * Toggle a "read-only mirror" presentation of the left setup panel for
   * non-host players in an active lobby. Connected guests should see the
   * host's selections (mode / track / race settings) but not be able to
   * change them; the back / Main Menu button stays interactive so they
   * can still leave. Cleared automatically when the room closes or when
   * the local client is the host.
   *
   * Also toggles a global `.in-lobby` class on the left panel: while
   * connected (host OR guest), the giant initial mode cards are hidden
   * — the active mode is already implied by the lobby state, so the
   * panel collapses to just the active mode setup + a compact mode
   * status strip.
   */
  _applyGuestLock() {
    const leftPanel = document.querySelector('.simplified-left-panel');
    if (!leftPanel) return;
    const inLobby = !!this.room;
    const isGuest = inLobby && !this.isHost;

    leftPanel.classList.toggle('in-lobby', inLobby);
    leftPanel.classList.toggle('is-guest-locked', isGuest);
    if (inLobby) {
      // Collapse the "pick a mode" initial state — mode is set by the lobby.
      leftPanel.classList.remove('mode-initial');
    }

    const setup = document.getElementById('inline-setup');
    if (!setup) return;

    // When in a lobby, force the inline setup section visible so the
    // active-mode title + track picker + settings actually render even
    // if the user never clicked a mode card locally.
    if (inLobby) setup.classList.remove('hidden');

    // Compact mode-status strip: replaces the giant mode cards while
    // connected. Shows the active mode name + role chip (HOST / GUEST)
    // so the panel still communicates what the user is in.
    let strip = leftPanel.querySelector('.lobby-mode-strip');
    if (inLobby) {
      const modeEntry = getMode(this.selectedModeId);
      const modeLabel = (modeEntry?.label || this.selectedModeId || 'LOBBY').toUpperCase();
      const roleLabel = this.isHost ? 'HOST' : 'GUEST';
      if (!strip) {
        strip = document.createElement('div');
        strip.className = 'lobby-mode-strip';
        // Insert above the mode-selector-container so it sits at the top.
        const modeCards = leftPanel.querySelector('.mode-selector-container');
        if (modeCards) leftPanel.insertBefore(strip, modeCards);
        else leftPanel.prepend(strip);
      }
      strip.innerHTML =
        `<span class="lms-mode"><i class="fas fa-circle-nodes"></i> ${modeLabel}</span>` +
        `<span class="lms-role lms-role--${this.isHost ? 'host' : 'guest'}">${roleLabel}</span>`;
    } else if (strip) {
      strip.remove();
    }

    // Guest-only read-only banner inside the inline setup.
    let banner = setup.querySelector('.guest-lock-banner');
    if (isGuest) {
      if (!banner) {
        banner = document.createElement('div');
        banner.className = 'guest-lock-banner';
        banner.innerHTML = '<i class="fas fa-lock"></i> READ-ONLY \u00B7 HOST CONTROLS THIS LOBBY';
        const header = setup.querySelector('.setup-header');
        if (header && header.nextSibling) {
          setup.insertBefore(banner, header.nextSibling);
        } else {
          setup.prepend(banner);
        }
      }
    } else if (banner) {
      banner.remove();
    }
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
    this._applyGuestLock();
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
      playerKart: sessionStorage.getItem('selectedKart') || 'amanda',
      gloEffect: glo.gloEffect,
      gloColor: glo.gloColor,
      gloColor2: glo.gloColor2,
    };
  }

  buildSettingsPayload() {
    const customTrackData = (this.selectedMap === CUSTOM_TRACK_ID || this.selectedMap === LOCAL_DRAFT_TRACK_ID)
      ? (sessionStorage.getItem('customTrackData') || readLocalDraftTrack()?.raw || '')
      : '';

    const matchLength = document.getElementById('battle-match-length')?.value || '8';
    const healthMultiplier = document.getElementById('battle-health-multiplier')?.value || '1';
    const respawnTime = document.getElementById('battle-respawn-time')?.value || '4';
    const randomSpawns = !!document.getElementById('battle-random-spawns')?.checked;
    const powerWeapons = !!document.getElementById('battle-power-weapons')?.checked;
    const friendlyFire = !!document.getElementById('battle-friendly-fire')?.checked;
    const radarEnabled = !!document.getElementById('battle-radar-enabled')?.checked;
    const autoAim = !!document.getElementById('battle-auto-aim')?.checked;
    const oneHitKills = !!document.getElementById('battle-one-hit-kills')?.checked;

    const weaponPool = this.selectedLoadout === 'custom'
      ? Array.from(this.selectedCustomWeapons)
      : [];

    return {
      modeId: this.selectedModeId,
      trackId: this.selectedMap,
      arenaId: this.selectedMap || DEFAULTS.arenaId,
      arenaTheme: this.selectedGlofluxTheme,
      battleType: this.selectedBattleType,
      maxPlayers: this.selectedMaxPlayers,
      totalLaps: Number(this.selectedLaps) || 3,
      scoreLimit: parseInt(document.getElementById('battle-score-limit')?.value || '5', 10) || 5,
      loadoutId: this.selectedLoadout,
      collisionDamage: !!document.getElementById('battle-collision-damage')?.checked,
      botCount: this.selectedBotCount,
      matchLength,
      healthMultiplier: Number.parseFloat(healthMultiplier) || 1,
      respawnTime: Number.parseInt(respawnTime, 10) || 4,
      randomSpawns,
      powerWeapons,
      friendlyFire,
      radarEnabled,
      autoAim,
      oneHitKills,
      performanceMode: this.performanceMode,
      weaponPool,
      customTrackData,
    };
  }

  sendPlayerUpdate() {
    if (!this.room) return;
    this.room.send('playerUpdate', this.buildPlayerPayload());
  }

  sendSettingsUpdate() {
    this._updateBattleSummary();
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
      this._openBuilder();
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
      }
      return;
    }
  }

  copyCode() {
    const code = this.currentLobbyCode || this.partyCodeDisplay?.textContent || '';
    if (!code) return;
    // Copy the bare three-word lobby phrase so users can paste it into
    // chat / voice without the recipient also picking up the URL. The
    // invite-URL form lives on the dedicated Share button instead.
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
      case 'online_arena':
        icon = 'fa-globe'; label = 'HOST ONLINE LOBBY';
        indicator = 'Click to host on a Track Studio course';
        break;
      case 'battle_online':
        icon = 'fa-crosshairs'; label = 'CREATE BATTLE LOBBY';
        indicator = 'Click to host an online battle';
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

  /** Phase 2.5e: show the condensed Studio picker for online_arena-class
   * modes and hide the legacy carousel/dropdown so the user gets the same
   * tabbed Templates / Remix / My Saves browser they have in the Studio
   * landing. Hides the picker (and restores carousel) for arena/race modes.
   */
  _syncStudioPickerVisibility() {
    const picker = getLobbyStudioPicker();
    const usesStudio = usesStudioTracks(this.selectedModeId);
    const carousel = document.querySelector('.track-carousel');
    if (picker) {
      if (usesStudio) {
        picker.show();
        if (this.selectedMap) picker.setSelectedId(this.selectedMap);
      } else {
        picker.hide();
      }
    }
    if (carousel) carousel.style.display = usesStudio ? 'none' : '';
  }

  _getLeftSetupState() {
    const modeEntry = getMode(this.selectedModeId);
    const showBattle = !!(modeEntry?.selectors?.battleSettings);
    const showRace = !!(modeEntry?.selectors?.raceSettings);
    const isGloflux = modeEntry?.id === 'gloflux' || modeEntry?.id?.startsWith('gloflux_');
    const showTrack = usesTrackSelection(this.selectedModeId) || usesArenaSelection(this.selectedModeId);

    return {
      showBattle,
      isGloflux,
      showTrack,
      isRaceWithBots: showRace,
      showSetup: showTrack || showBattle || isGloflux || showRace,
    };
  }

  refreshBattleControls() {
    const battleSettings = document.getElementById('battle-settings');
    const raceSettings = document.getElementById('race-settings');
    const glofluxSettings = document.getElementById('gloflux-settings');
    const modeEntry = getMode(this.selectedModeId);
    const { showBattle, isGloflux, showTrack, isRaceWithBots, showSetup } = this._getLeftSetupState();
    const hasModeSelection = !!modeEntry;

    // Show/hide the inline setup section
    if (this.inlineSetup) {
      this.inlineSetup.classList.toggle('hidden', !hasModeSelection || !showSetup);
    }

    // Panel visibility
    battleSettings?.classList.toggle('hidden', !showBattle);
    raceSettings?.classList.toggle('hidden', !isRaceWithBots);
    glofluxSettings?.classList.toggle('hidden', !isGloflux);
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
    // Sync selectedModeId from server gameMode (battle / gloflux / race)
    const serverIsBattle = state.gameMode === 'battle';
    // If we're in a lobby, derive the modeId from server state. Prefer the
    // explicit state.modeId if it's a known mode (Phase 2.4: online_arena);
    // otherwise fall back to legacy gameMode mapping.
    if (this.room) {
      if (state.modeId && getMode(state.modeId)) {
        this.selectedModeId = state.modeId;
      } else {
        this.selectedModeId = state.gameMode === 'gloflux'
          ? (state.modeId || 'gloflux')
          : (state.gameMode === 'race' ? 'online_arena' : 'battle_online');
      }
      this.selectedMode = state.gameMode || 'battle';
    }

    // Re-render mode selector UI
    this._renderModeCards();

    const mapName = document.querySelector('.selected-map-name');
    const selectedTrack = getSelectableContentList(this.selectedModeId).find((t) => t.id === this.selectedMap);
    if (mapName && selectedTrack) mapName.textContent = selectedTrack.name;

    // Sync the 3D track carousel to server state
    if (window.__trackPreview) {
      window.__trackPreview.setMode(usesStudioTracks(this.selectedModeId) ? 'studio' : (usesArenaSelection(this.selectedModeId) ? 'battle' : 'race'));
      window.__trackPreview.setById(this.selectedMap);
    }

    document.querySelectorAll('.dropdown-option').forEach((option) => {
      option.classList.toggle('selected', option.getAttribute('data-map-id') === this.selectedMap);
    });

    const battleTypeEl = document.getElementById('battle-type-select');
    if (battleTypeEl && battleTypeEl.value !== this.selectedBattleType) battleTypeEl.value = this.selectedBattleType;
    this._syncGlassDropdown(battleTypeEl);
    this._syncBattleTypePills();

    const maxPlayersEl = document.getElementById('battle-max-players');
    if (maxPlayersEl) maxPlayersEl.value = String(this.selectedMaxPlayers);
    this._syncGlassDropdown(maxPlayersEl);

    const scoreLimitEl = document.getElementById('battle-score-limit');
    if (scoreLimitEl && state.scoreLimit) scoreLimitEl.value = String(state.scoreLimit);

    if (state.totalLaps) {
      this.selectedLaps = Number(state.totalLaps) || 3;
      const lapsEl = document.getElementById('race-laps');
      if (lapsEl) {
        lapsEl.value = String(this.selectedLaps);
        this._syncGlassDropdown(lapsEl);
      }
    }

    if (state.loadoutId) {
      this.selectedLoadout = state.loadoutId;
      this._syncLoadoutButtons();
      this._syncCustomWeaponPanel();
    }

    this._setPerformanceMode(state.performanceMode || this.performanceMode, { persist: true, sync: false });

    this._updateBattleSummary();

    const glofluxMaxPlayersEl = document.getElementById('gloflux-player-cap');
    if (glofluxMaxPlayersEl) glofluxMaxPlayersEl.value = String(this.selectedMaxPlayers);
    this._syncGlassDropdown(glofluxMaxPlayersEl);

    const glofluxThemeEl = document.getElementById('gloflux-theme');
    this._syncGlassDropdown(glofluxThemeEl);

    if (this.partyCodeDisplay) {
      this.partyCodeDisplay.textContent = state.lobbyCode || this.currentLobbyCode || '------';
    }
    this._syncStudioPickerVisibility();
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
      const willOpen = !mapDropdown?.classList.contains('open');
      mapDropdown?.classList.toggle('open');
      // Phase 2.5: re-fetch Studio tracks every time the dropdown opens so
      // the host sees their freshest cloud saves / community publishes
      // without reloading the lobby tab.
      if (willOpen && usesStudioTracks(this.selectedModeId)) {
        loadStudioTracks({ force: true })
          .then(() => this._rebuildMapDropdown())
          .catch(() => { /* offline */ });
      }
    });

    document.addEventListener('click', () => mapDropdown?.classList.remove('open'));

    dropdownContent?.addEventListener('click', (event) => {
      const option = event.target.closest('.dropdown-option');
      if (!option) return;

      const mapId = option.getAttribute('data-map-id');
      this.selectedMap = mapId;
      // Phase 2.5: if user picked their local browser draft, push the
      // raw editor JSON into sessionStorage so buildSettingsPayload's
      // customTrackData branch (CUSTOM_TRACK_ID || LOCAL_DRAFT_TRACK_ID)
      // ships it to the LobbyRoom and downstream Editor3RaceRoom.
      if (mapId === LOCAL_DRAFT_TRACK_ID) {
        const draft = readLocalDraftTrack();
        if (draft?.raw) sessionStorage.setItem('customTrackData', draft.raw);
      } else if (mapId !== CUSTOM_TRACK_ID) {
        sessionStorage.removeItem('customTrackData');
      }
      document.querySelectorAll('.dropdown-option').forEach((opt) => opt.classList.toggle('selected', opt === option));
      const selectedMapName = document.querySelector('.selected-map-name');
      if (selectedMapName) selectedMapName.textContent = option.textContent;
      mapDropdown?.classList.remove('open');

    // Sync the 3D track carousel to the dropdown selection
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

    const items = getSelectableContentList(this.selectedModeId);
    if (dropdownContent) {
      dropdownContent.innerHTML = '';
      items.forEach((track, index) => {
        const option = document.createElement('div');
        if (track.header) {
          option.className = 'dropdown-section-header';
          option.style.cssText = 'padding:6px 12px;font-size:11px;letter-spacing:.08em;color:#ff3aa1;text-transform:uppercase;pointer-events:none;opacity:.85;';
          option.textContent = track.name;
        } else {
          const isSelected = track.id === this.selectedMap || (!this.selectedMap && index === 0);
          option.className = `dropdown-option${isSelected ? ' selected' : ''}`;
          option.setAttribute('data-map-id', track.id);
          option.textContent = track.name;
        }
        dropdownContent.appendChild(option);
      });
    }

    const firstSelectable = items.find((t) => !t.header);
    if (firstSelectable && !items.some((t) => !t.header && t.id === this.selectedMap)) {
      this.selectedMap = firstSelectable.id;
      if (selectedMapName) selectedMapName.textContent = firstSelectable.name;
    } else if (firstSelectable && selectedMapName) {
      const cur = items.find((t) => !t.header && t.id === this.selectedMap);
      selectedMapName.textContent = cur?.name || firstSelectable.name;
    }
  }

  initModeSelector() {
    const cardsContainer = document.getElementById('mode-cards');
    const battleTypeEl = document.getElementById('battle-type-select');
    const maxPlayersEl = document.getElementById('battle-max-players');
    const botCountEl = document.getElementById('battle-bot-count');
    const scoreLimitEl = document.getElementById('battle-score-limit');
    const matchLengthEl = document.getElementById('battle-match-length');
    const healthMultiplierEl = document.getElementById('battle-health-multiplier');
    const respawnTimeEl = document.getElementById('battle-respawn-time');

    this._renderModeCards();

    // Battle settings listeners
    battleTypeEl?.addEventListener('change', () => {
      this.selectedBattleType = battleTypeEl.value === 'ctf' ? 'ctf' : 'deathmatch';
      this._syncBattleTypePills();
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
      this.sendSettingsUpdate();
    });

    scoreLimitEl?.addEventListener('change', () => this.sendSettingsUpdate());
    matchLengthEl?.addEventListener('change', () => this.sendSettingsUpdate());
    healthMultiplierEl?.addEventListener('change', () => this.sendSettingsUpdate());
    respawnTimeEl?.addEventListener('change', () => this.sendSettingsUpdate());

    this._initGlassDropdown(battleTypeEl);
    this._initGlassDropdown(maxPlayersEl);
    this._initGlassDropdown(matchLengthEl);
    this._initGlassDropdown(healthMultiplierEl);
    this._initGlassDropdown(respawnTimeEl);

  }

  _selectMode(modeId) {
    const mode = getMode(modeId);
    if (!mode || !isPlayable(modeId)) return;

    // Collapse initial big-card state on first mode selection
    const leftPanel = document.querySelector('.simplified-left-panel');
    if (leftPanel?.classList.contains('mode-initial')) {
      leftPanel.classList.remove('mode-initial');
    }

    const activeModeTitle = document.getElementById('active-mode-title');
    if (activeModeTitle) {
      activeModeTitle.textContent = mode.label;
    }

    this.selectedModeId = modeId;

    // Derive legacy selectedMode for backward compat with Colyseus payloads
    this.selectedMode = getLegacyModeFamily(modeId);

    // Sync track carousel to the right list
    if (window.__trackPreview) {
      window.__trackPreview.setMode(usesStudioTracks(modeId) ? 'studio' : (usesArenaSelection(modeId) ? 'battle' : 'race'));
    }

    // Reset map to defaults when switching race↔battle
    this._rebuildMapDropdown();

    // Sync carousel to the newly selected default map
    if (window.__trackPreview && this.selectedMap) {
      window.__trackPreview.setById(this.selectedMap);
    }
    this._syncStudioPickerVisibility();
    this.refreshBattleControls();
    this._renderModeCards();
    if (this.playBtn) {
      this.playBtn.disabled = false;
      this._pulsePlayButton();
    }
    this.sendSettingsUpdate();
  }

  resetToModeSelection() {
    const leftPanel = document.querySelector('.simplified-left-panel');
    if (leftPanel) {
      leftPanel.classList.add('mode-initial');
    }
    
    this.selectedModeId = null;
    this.selectedMode = null;
    
    if (this.playBtn) {
      this.playBtn.disabled = true;
      if (this.playIndicator) {
        this.playIndicator.classList.remove('hidden');
        if (this.playIndicatorLabel) this.playIndicatorLabel.textContent = 'Select a mode';
        const dot = this.playIndicator.querySelector('.play-indicator-dot');
        if (dot) {
          dot.style.background = '#888';
          dot.style.boxShadow = 'none';
        }
      }
    }
    
    this.refreshBattleControls();
    this._renderModeCards();
  }

  _renderModeCards() {
    const cardsContainer = document.getElementById('mode-cards');
    if (!cardsContainer) return;

    const modes = getVisibleModes();
    const leftPanel = document.querySelector('.simplified-left-panel');
    const isInitial = leftPanel?.classList.contains('mode-initial');

    const MODE_TAGLINES = {};

    const MODE_SHORT_LABELS = {
      online_arena: 'ONLINE',
      battle_online: 'ONLINE',
      track_builder: 'STUDIO',
    };

    cardsContainer.innerHTML = '';
    modes.forEach((mode) => {
      const card = document.createElement('div');
      card.className = 'mode-card';
      if (mode.id === this.selectedModeId) card.classList.add('active');
      if (mode.id === 'track_builder') card.classList.add('mode-card-studio');
      card.setAttribute('data-mode-id', mode.id);

      let badgeHTML = '';
      if (mode.status === MODE_STATUS.BETA) {
        badgeHTML = '<span class="mode-card-badge beta">BETA</span>';
      }

      const tagline = MODE_TAGLINES[mode.id] || '';
      const taglineHTML = tagline
        ? `<div class="mode-card-tagline">${tagline}</div>`
        : '';
      const shortLabel = MODE_SHORT_LABELS[mode.id] || mode.label;

      card.innerHTML = `
        <div class="mode-card-icon"><i class="fas ${mode.icon}"></i></div>
        <div class="mode-card-info">
          <div class="mode-card-label">${shortLabel}</div>
          ${taglineHTML}
        </div>
        ${badgeHTML}
        <div class="mode-card-arrow" aria-hidden="true"><i class="fas fa-chevron-right"></i></div>
        <span class="mode-card-tap-ring" aria-hidden="true"></span>
        <span class="mode-card-tap-ring mode-card-tap-ring--2" aria-hidden="true"></span>
      `;

      if (mode.page && mode.category === 'tools') {
        card.addEventListener('click', () => { void navigateWithTransition(mode.page); });
      } else {
        card.addEventListener('click', () => this._selectMode(mode.id));
      }

      cardsContainer.appendChild(card);
    });

    this._installModeAttractLoop(cardsContainer);
  }

  _installModeAttractLoop(cardsContainer) {
    if (!cardsContainer) return;
    let alreadyOnboarded = false;
    try { alreadyOnboarded = localStorage.getItem('gloKarts.firstModeChosen') === '1'; } catch {}
    if (alreadyOnboarded) return;
    if (this._modeAttractInstalled) {
      // Re-render of cards: keep class in sync but don't double-bind listeners
      cardsContainer.classList.add('is-attracting');
      return;
    }
    this._modeAttractInstalled = true;
    cardsContainer.classList.add('is-attracting');
    const dismiss = () => {
      cardsContainer.classList.remove('is-attracting');
      try { localStorage.setItem('gloKarts.firstModeChosen', '1'); } catch {}
      cardsContainer.removeEventListener('pointerenter', dismiss);
      cardsContainer.removeEventListener('pointerdown',  dismiss);
      cardsContainer.removeEventListener('focusin',      dismiss);
    };
    cardsContainer.addEventListener('pointerenter', dismiss, { once: true });
    cardsContainer.addEventListener('pointerdown',  dismiss, { once: true });
    cardsContainer.addEventListener('focusin',      dismiss, { once: true });
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
      this.sendSettingsUpdate();
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
    if (selectEl.classList.contains('hidden')) return;

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
      { id: 'custom', label: 'Custom', icon: '🧪' },
      { id: 'none', label: 'No Weapons', icon: '🚫' },
    ];

    const row = document.getElementById('weapon-loadout-row');
    if (!row) return;

    row.innerHTML = '';
    LOADOUTS.forEach((loadout) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `weapon-loadout-btn${loadout.id === this.selectedLoadout ? ' active' : ''}`;
      btn.setAttribute('data-loadout', loadout.id);
      btn.innerHTML = `<span class="loadout-icon">${loadout.icon}</span><span class="loadout-label">${loadout.label}</span>`;
      btn.addEventListener('click', () => {
        row.querySelectorAll('.weapon-loadout-btn').forEach((node) => node.classList.remove('active'));
        btn.classList.add('active');
        this.selectedLoadout = loadout.id;
        this._syncCustomWeaponPanel();
        this.sendSettingsUpdate();
      });
      row.appendChild(btn);
    });

    this._syncLoadoutButtons();
    this._syncCustomWeaponPanel();
  }

  _syncLoadoutButtons() {
    const row = document.getElementById('weapon-loadout-row');
    if (!row) return;
    row.querySelectorAll('.weapon-loadout-btn').forEach((node) => {
      node.classList.toggle('active', node.getAttribute('data-loadout') === this.selectedLoadout);
    });
    this._updateBattleSummary();
  }

  _setBattleView(viewId = 'core') {
    this.activeBattleView = viewId;

    const tabs = document.querySelectorAll('.battle-view-tab');
    tabs.forEach((tab) => {
      const active = tab.getAttribute('data-battle-view') === viewId;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    const panels = document.querySelectorAll('.battle-view-panel');
    panels.forEach((panel) => {
      const active = panel.id === `battle-view-${viewId}`;
      panel.classList.toggle('active', active);
      panel.setAttribute('aria-hidden', active ? 'false' : 'true');
    });
  }

  _updateBattleSummary() {
    const isCtf = this.selectedBattleType === 'ctf';
    const type = isCtf ? 'Capture the Flag' : 'Kart Tag';
    const scoreLimit = document.getElementById('battle-score-limit')?.value || String(DEFAULTS.scoreLimit);
    const maxPlayers = this.selectedMaxPlayers || DEFAULTS.maxPlayers;
    const loadoutMap = {
      'random-all': 'ALL',
      combat: 'COMBAT',
      chaos: 'CHAOS',
      custom: 'CUSTOM',
      sneaky: 'SNEAKY',
      none: 'NONE',
    };
    const loadout = loadoutMap[this.selectedLoadout] || String(this.selectedLoadout || 'ALL').toUpperCase();
    const compactTarget = isCtf ? `${scoreLimit} Captures` : `${scoreLimit} KOs`;

    const typeEl = document.getElementById('battle-summary-type');
    const targetEl = document.getElementById('battle-summary-target');
    const popEl = document.getElementById('battle-summary-pop');
    const loadoutEl = document.getElementById('battle-summary-loadout');
    const heroTypeEl = document.getElementById('battle-hero-type');
    const heroPopEl = document.getElementById('battle-hero-pop');
    const heroTargetEl = document.getElementById('battle-hero-target');
    const targetUnitEl = document.getElementById('battle-score-limit-unit');

    if (typeEl) typeEl.textContent = type;
    if (targetEl) targetEl.textContent = isCtf ? `${scoreLimit} Captures` : `${scoreLimit} KOs`;
    if (popEl) popEl.textContent = `${maxPlayers} Players`;
    if (loadoutEl) {
      if (this.selectedLoadout === 'custom') {
        loadoutEl.textContent = `${loadout} (${this.selectedCustomWeapons.size})`;
      } else {
        loadoutEl.textContent = loadout;
      }
    }

    if (heroTypeEl) heroTypeEl.textContent = type;
    if (heroPopEl) heroPopEl.textContent = `${maxPlayers} Players`;
    if (heroTargetEl) heroTargetEl.textContent = compactTarget;
    if (targetUnitEl) targetUnitEl.textContent = isCtf ? 'Captures' : 'Knockouts';
  }

  _syncBattleTypePills() {
    const pills = document.querySelectorAll('.battle-type-pill');
    pills.forEach((pill) => {
      const active = pill.getAttribute('data-battle-type') === this.selectedBattleType;
      pill.classList.toggle('active', active);
      pill.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    this._updateBattleSummary();
  }

  _syncCustomWeaponPanel() {
    const panel = document.getElementById('custom-weapon-panel');
    if (!panel) return;

    const isCustom = this.selectedLoadout === 'custom';
    panel.classList.toggle('hidden', !isCustom);

    const countEl = document.getElementById('custom-weapon-count');
    if (countEl) {
      const count = this.selectedCustomWeapons.size;
      countEl.textContent = `${count} selected`;
      countEl.classList.toggle('warn', count === 0);
    }

    const chips = document.querySelectorAll('.custom-weapon-chip');
    chips.forEach((chip) => {
      const weaponId = chip.getAttribute('data-weapon-id');
      chip.classList.toggle('active', this.selectedCustomWeapons.has(weaponId));
    });

    this._updateBattleSummary();
  }

  _applyBattlePreset(presetId) {
    const preset = BATTLE_RULE_PRESETS[presetId];
    if (!preset) return;

    const battleTypeEl = document.getElementById('battle-type-select');
    const scoreEl = document.getElementById('battle-score-limit');
    const maxPlayersEl = document.getElementById('battle-max-players');
    const matchLengthEl = document.getElementById('battle-match-length');
    const healthEl = document.getElementById('battle-health-multiplier');
    const respawnEl = document.getElementById('battle-respawn-time');
    const randomSpawnsEl = document.getElementById('battle-random-spawns');
    const powerWeaponsEl = document.getElementById('battle-power-weapons');
    const collisionEl = document.getElementById('battle-collision-damage');
    const friendlyFireEl = document.getElementById('battle-friendly-fire');
    const radarEl = document.getElementById('battle-radar-enabled');
    const autoAimEl = document.getElementById('battle-auto-aim');
    const oneHitEl = document.getElementById('battle-one-hit-kills');
    const maxPlayersRangeEl = document.getElementById('battle-max-players-range');
    const maxPlayersOutputEl = document.getElementById('battle-max-players-output');
    const scoreRangeEl = document.getElementById('battle-score-limit-range');
    const scoreOutputEl = document.getElementById('battle-score-limit-output');

    this.selectedBattleType = preset.battleType;
    this.selectedLoadout = preset.loadoutId;
    this.selectedMaxPlayers = Math.min(8, Number.parseInt(String(preset.maxPlayers), 10) || this.selectedMaxPlayers);

    if (battleTypeEl) {
      battleTypeEl.value = preset.battleType;
      this._syncGlassDropdown(battleTypeEl);
    }
    if (scoreEl) scoreEl.value = String(preset.scoreLimit);
    if (maxPlayersEl) {
      maxPlayersEl.value = String(this.selectedMaxPlayers);
      this._syncGlassDropdown(maxPlayersEl);
    }
    if (maxPlayersRangeEl) maxPlayersRangeEl.value = String(this.selectedMaxPlayers);
    if (maxPlayersOutputEl) maxPlayersOutputEl.textContent = String(this.selectedMaxPlayers);
    if (scoreRangeEl) scoreRangeEl.value = String(preset.scoreLimit);
    if (scoreOutputEl) scoreOutputEl.textContent = String(preset.scoreLimit);
    if (matchLengthEl) {
      matchLengthEl.value = preset.matchLength;
      this._syncGlassDropdown(matchLengthEl);
    }
    if (healthEl) {
      healthEl.value = preset.healthMultiplier;
      this._syncGlassDropdown(healthEl);
    }
    if (respawnEl) {
      respawnEl.value = preset.respawnTime;
      this._syncGlassDropdown(respawnEl);
    }

    if (randomSpawnsEl) randomSpawnsEl.checked = !!preset.randomSpawns;
    if (powerWeaponsEl) powerWeaponsEl.checked = !!preset.powerWeapons;
    if (collisionEl) collisionEl.checked = !!preset.collisionDamage;
    if (friendlyFireEl) friendlyFireEl.checked = !!preset.friendlyFire;
    if (radarEl) radarEl.checked = !!preset.radarEnabled;
    if (autoAimEl) autoAimEl.checked = !!preset.autoAim;
    if (oneHitEl) oneHitEl.checked = !!preset.oneHitKills;

    if (Array.isArray(preset.customWeapons)) {
      this.selectedCustomWeapons = new Set(preset.customWeapons);
    }

    document.querySelectorAll('.battle-preset-btn').forEach((btn) => {
      const isActive = btn.getAttribute('data-rule-preset') === presetId;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    this._syncBattleTypePills();
    this._syncLoadoutButtons();
    this._syncCustomWeaponPanel();
    this.sendSettingsUpdate();
  }

  initBattleCustomizationLab() {
    const battleTypeEl = document.getElementById('battle-type-select');
    const typePills = document.querySelectorAll('.battle-type-pill');
    const presetButtons = document.querySelectorAll('.battle-preset-btn');
    const weaponGrid = document.getElementById('custom-weapon-grid');
    const maxPlayersRangeEl = document.getElementById('battle-max-players-range');
    const maxPlayersOutputEl = document.getElementById('battle-max-players-output');
    const scoreRangeEl = document.getElementById('battle-score-limit-range');
    const scoreOutputEl = document.getElementById('battle-score-limit-output');
    const maxPlayersEl = document.getElementById('battle-max-players');
    const scoreLimitEl = document.getElementById('battle-score-limit');

    typePills.forEach((pill) => {
      pill.addEventListener('click', () => {
        const nextType = pill.getAttribute('data-battle-type') || 'deathmatch';
        this.selectedBattleType = nextType;
        if (battleTypeEl) {
          battleTypeEl.value = nextType;
          battleTypeEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
        this._syncBattleTypePills();
      });
    });

    presetButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const presetId = btn.getAttribute('data-rule-preset');
        this._applyBattlePreset(presetId);
      });
    });

    const syncPlayersRange = () => {
      if (!maxPlayersRangeEl) return;
      const next = Number.parseInt(maxPlayersRangeEl.value || '8', 10) || 8;
      this.selectedMaxPlayers = Math.max(2, Math.min(8, next));
      if (maxPlayersOutputEl) maxPlayersOutputEl.textContent = String(this.selectedMaxPlayers);
      if (maxPlayersEl) {
        maxPlayersEl.value = String(this.selectedMaxPlayers);
        maxPlayersEl.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        this._updateBattleSummary();
      }
    };

    const syncScoreRange = () => {
      if (!scoreRangeEl) return;
      const next = Number.parseInt(scoreRangeEl.value || '5', 10) || 5;
      const score = Math.max(1, Math.min(20, next));
      if (scoreOutputEl) scoreOutputEl.textContent = String(score);
      if (scoreLimitEl) {
        scoreLimitEl.value = String(score);
        scoreLimitEl.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        this._updateBattleSummary();
      }
    };

    maxPlayersRangeEl?.addEventListener('input', syncPlayersRange);
    scoreRangeEl?.addEventListener('input', syncScoreRange);

    if (weaponGrid) {
      weaponGrid.innerHTML = '';
      BATTLE_WEAPON_LIBRARY.forEach((weapon) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'custom-weapon-chip';
        chip.setAttribute('data-weapon-id', weapon.id);
        chip.innerHTML = `<span class="custom-weapon-icon">${weapon.icon}</span><span class="custom-weapon-label">${weapon.label}</span>`;
        chip.addEventListener('click', () => {
          if (this.selectedCustomWeapons.has(weapon.id)) {
            this.selectedCustomWeapons.delete(weapon.id);
          } else {
            this.selectedCustomWeapons.add(weapon.id);
          }
          this._syncCustomWeaponPanel();
          this.sendSettingsUpdate();
        });
        weaponGrid.appendChild(chip);
      });
    }

    [
      'battle-random-spawns',
      'battle-power-weapons',
      'battle-friendly-fire',
      'battle-radar-enabled',
      'battle-auto-aim',
      'battle-one-hit-kills',
      'battle-collision-damage',
      'battle-match-length',
      'battle-health-multiplier',
      'battle-respawn-time',
      'battle-score-limit',
    ].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', () => {
        this._updateBattleSummary();
        this.sendSettingsUpdate();
      });
    });

    this.selectedMaxPlayers = Math.max(2, Math.min(8, this.selectedMaxPlayers || DEFAULTS.maxPlayers));
    if (maxPlayersRangeEl) maxPlayersRangeEl.value = String(this.selectedMaxPlayers || DEFAULTS.maxPlayers);
    if (maxPlayersOutputEl) maxPlayersOutputEl.textContent = String(this.selectedMaxPlayers || DEFAULTS.maxPlayers);
    if (scoreRangeEl && scoreLimitEl) scoreRangeEl.value = String(scoreLimitEl.value || DEFAULTS.scoreLimit);
    if (scoreOutputEl && scoreLimitEl) scoreOutputEl.textContent = String(scoreLimitEl.value || DEFAULTS.scoreLimit);

    this._syncBattleTypePills();
    this._syncCustomWeaponPanel();
    this._updateBattleSummary();
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
