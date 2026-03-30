import { Room } from "@colyseus/core";
import { LobbyState } from "../schema/LobbyState.js";
import { LobbyPlayerState } from "../schema/LobbyPlayerState.js";
import { log } from "../logger.js";

const DEFAULT_TRACK = "test_box";
const DEFAULT_ARENA = "test_box";
const DEFAULT_BATTLE_TYPE = "deathmatch";
const DEFAULT_MAX_PLAYERS = 12;
const MAX_CONCURRENT_LOBBY_PLAYERS = 100;
const PARTY_CODE_FIRST_WORDS = [
  "NEON", "TURBO", "NOVA", "LUNAR", "SOLAR", "RAPID", "HYPER", "WILD",
  "GOLD", "SILVER", "CRIMSON", "ELECTRIC", "GLASS", "MIDNIGHT", "RADAR", "COMET",
  "ROCKET", "PIXEL", "FROST", "EMBER", "THUNDER", "BLAZING", "COSMIC", "PHANTOM",
];
const PARTY_CODE_SECOND_WORDS = [
  "FOX", "WOLF", "TIGER", "RACER", "VIPER", "RIDER", "PILOT", "DRIVER",
  "FALCON", "PANTHER", "OTTER", "COBRA", "JAGUAR", "COMET", "BLADE", "EAGLE",
  "RHINO", "BADGER", "HAWK", "RAVEN", "ORBIT", "NITRO", "KART", "THRUSTER",
];
const PARTY_CODE_THIRD_WORDS = [
  "BOOST", "DRIFT", "DASH", "BLITZ", "CHASE", "SPRINT", "RALLY", "CIRCUIT",
  "ARENA", "ROCKET", "FUSION", "STORM", "CLUTCH", "VICTORY", "CHARGE", "GLIDE",
  "FLASH", "RUMBLE", "SKID", "TURN", "VAULT", "BURST", "GRID", "START",
];

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function normalizeLobbyCode(value) {
  const tokens = String(value || "").trim().toUpperCase().match(/[A-Z0-9]+/g) || [];
  if (!tokens.length) return "";

  const looksLegacyCode = tokens.every((token) => token.length <= 3) && tokens.some((token) => /\d/.test(token));
  if (looksLegacyCode) {
    return tokens.slice(0, 3).join("-");
  }

  return tokens
    .map((token) => token.replace(/\d+/g, ""))
    .filter(Boolean)
    .slice(0, 3)
    .join("-");
}

function generateLobbyCode() {
  return `${pickRandom(PARTY_CODE_FIRST_WORDS)}-${pickRandom(PARTY_CODE_SECOND_WORDS)}-${pickRandom(PARTY_CODE_THIRD_WORDS)}`;
}

function normalizeGameMode(value) {
  if (value === "battle") return "battle";
  if (value === "gloflux") return "gloflux";
  return "race";
}

function defaultModeId(gameMode) {
  if (gameMode === "battle") return "battle_online";
  if (gameMode === "gloflux") return "gloflux_arena";
  return "race_online";
}

export class LobbyRoom extends Room {
  static activeLobbyPlayers = 0;

  onCreate(options = {}) {
    const state = new LobbyState();
    const initialLoadoutId = String(options.loadoutId || "random-all");
    const initialWeaponPool = Array.isArray(options.weaponPool) && initialLoadoutId === "custom"
      ? [...new Set(options.weaponPool.map((weaponId) => String(weaponId || "").trim()).filter(Boolean))].slice(0, 24)
      : [];

    state.lobbyCode = normalizeLobbyCode(options.lobbyCode);
    state.privacy = options.privacy === "open" ? "open" : "private";
    state.gameMode = normalizeGameMode(options.gameMode);
    state.modeId = String(options.modeId || defaultModeId(state.gameMode));
    state.trackId = String(options.trackId || DEFAULT_TRACK);
    state.arenaId = String(options.arenaId || DEFAULT_ARENA);
    state.arenaTheme = String(options.arenaTheme || "nuclear_desert");
    state.battleType = options.battleType === "ctf" ? "ctf" : DEFAULT_BATTLE_TYPE;
    state.maxPlayers = Math.min(Math.max(Number(options.maxPlayers) || DEFAULT_MAX_PLAYERS, 1), 12);
    state.loadoutId = initialLoadoutId;
    initialWeaponPool.forEach((weaponId) => state.weaponPool.push(weaponId));
    state.status = "waiting";
    state.countdown = 0;

    this.maxClients = MAX_CONCURRENT_LOBBY_PLAYERS;
    this.setState(state);
    this.setMetadata({
      lobbyCode: state.lobbyCode,
      privacy: state.privacy,
      gameMode: state.gameMode,
      status: state.status,
    });

    this.onMessage("playerUpdate", (client, data = {}) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      player.name = String(data.playerName || player.name || "Player").slice(0, 24);
      player.playerColor = String(data.playerColor || player.playerColor || "red");
      player.playerKart = String(data.playerKart || player.playerKart || "tux");
      player.gloEffect = String(data.gloEffect || player.gloEffect || "solid");
      player.gloColor = String(data.gloColor || player.gloColor || "#ff0080");
      player.gloColor2 = String(data.gloColor2 || player.gloColor2 || "#00e5ff");
    });

    this.onMessage("settingsUpdate", (client, data = {}) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.isHost || this.state.status !== "waiting") return;

      this.state.gameMode = normalizeGameMode(data.gameMode);
      this.state.modeId = String(data.modeId || this.state.modeId || defaultModeId(this.state.gameMode));
      this.state.trackId = String(data.trackId || this.state.trackId || DEFAULT_TRACK);
      this.state.arenaId = String(data.arenaId || this.state.arenaId || DEFAULT_ARENA);
      this.state.arenaTheme = String(data.arenaTheme || this.state.arenaTheme || "nuclear_desert");
      this.state.battleType = data.battleType === "ctf" ? "ctf" : "deathmatch";
      this.state.loadoutId = String(data.loadoutId || this.state.loadoutId || "random-all");
      this.state.maxPlayers = Math.min(Math.max(Number(data.maxPlayers) || this.state.maxPlayers || DEFAULT_MAX_PLAYERS, 1), 12);
      this.maxClients = this.state.maxPlayers;

      this.state.weaponPool.splice(0, this.state.weaponPool.length);
      if (Array.isArray(data.weaponPool) && this.state.loadoutId === "custom") {
        const sanitizedPool = [...new Set(data.weaponPool.map((weaponId) => String(weaponId || "").trim()).filter(Boolean))].slice(0, 24);
        sanitizedPool.forEach((weaponId) => this.state.weaponPool.push(weaponId));
      }

      // Custom track data (max 64KB)
      if (typeof data.customTrackData === 'string') {
        this.state.customTrackData = data.customTrackData.slice(0, 65536);
      }

      this.setMetadata({
        lobbyCode: this.state.lobbyCode,
        privacy: this.state.privacy,
        gameMode: this.state.gameMode,
        status: this.state.status,
      });
    });

    this.onMessage("setReady", (client, data = {}) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || this.state.status !== "waiting") return;
      player.isReady = !!data.isReady;
    });

    this.onMessage("startMatch", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.isHost || this.state.status !== "waiting") return;

      const playerCount = this.state.players.size;
      if (playerCount < 1) return;

      // Auto-ready the host when they initiate start
      player.isReady = true;

      if (this.state.gameMode === "battle") {
        const everyoneReady = [...this.state.players.values()].every((p) => p.isReady);
        if (!everyoneReady) {
          const notReady = [...this.state.players.values()].filter(p => !p.isReady).map(p => p.name);
          client.send("matchError", { message: `Waiting for: ${notReady.join(", ")}` });
          return;
        }
      }

      this.beginCountdown();
    });
  }

  onJoin(client, options = {}) {
    if (LobbyRoom.activeLobbyPlayers >= MAX_CONCURRENT_LOBBY_PLAYERS) {
      throw new Error("Lobby server at capacity. Please retry in a moment.");
    }

    const isFirst = this.state.players.size === 0;
    const player = new LobbyPlayerState();
    player.id = client.sessionId;
    player.name = String(options.playerName || `Player_${client.sessionId.slice(0, 4)}`).slice(0, 24);
    player.playerColor = String(options.playerColor || "red");
    player.playerKart = String(options.playerKart || options.kartId || "tux");
    player.gloEffect = String(options.gloEffect || "solid");
    player.gloColor = String(options.gloColor || "#ff0080");
    player.gloColor2 = String(options.gloColor2 || "#00e5ff");
    player.isHost = isFirst;
    player.isReady = false;

    this.state.players.set(client.sessionId, player);
    LobbyRoom.activeLobbyPlayers += 1;

    if (isFirst && this.state.lobbyCode === "") {
      this.state.lobbyCode = generateLobbyCode();
      this.setMetadata({
        lobbyCode: this.state.lobbyCode,
        privacy: this.state.privacy,
        gameMode: this.state.gameMode,
        status: this.state.status,
      });
    }

    client.send("joined", {
      sessionId: client.sessionId,
      roomId: this.roomId,
      lobbyCode: this.state.lobbyCode,
      privacy: this.state.privacy,
      gameMode: this.state.gameMode,
      isHost: isFirst,
    });
    log('info', 'room_join', { room: 'lobby_room', roomId: this.roomId, sessionId: client.sessionId, players: this.state.players.size });
  }

  onLeave(client) {
    const wasHost = this.state.players.get(client.sessionId)?.isHost;
    this.state.players.delete(client.sessionId);
    LobbyRoom.activeLobbyPlayers = Math.max(0, LobbyRoom.activeLobbyPlayers - 1);
    log('info', 'room_leave', { room: 'lobby_room', roomId: this.roomId, sessionId: client.sessionId, players: this.state.players.size });

    if (this.state.players.size === 0) {
      this.disconnect();
      return;
    }

    if (wasHost) {
      const nextHost = this.state.players.values().next().value;
      if (nextHost) {
        nextHost.isHost = true;
        nextHost.isReady = false;
      }
    }
  }

  beginCountdown() {
    this.state.status = "starting";
    this.state.countdown = 3;
    this.setMetadata({
      lobbyCode: this.state.lobbyCode,
      privacy: this.state.privacy,
      gameMode: this.state.gameMode,
      status: this.state.status,
    });

    this.broadcast("countdown", { t: this.state.countdown });

    this.clock.setInterval(() => {
      this.state.countdown -= 1;
      if (this.state.countdown > 0) {
        this.broadcast("countdown", { t: this.state.countdown });
        return;
      }

      this.state.status = "in_match";
      this.setMetadata({
        lobbyCode: this.state.lobbyCode,
        privacy: this.state.privacy,
        gameMode: this.state.gameMode,
        status: this.state.status,
      });

      const players = [...this.state.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        isHost: p.isHost,
        playerColor: p.playerColor,
        playerKart: p.playerKart,
      }));

      const gameConfig = {
        type: "startGame",
        modeId: this.state.modeId,
        gameMode: this.state.gameMode,
        trackId: this.state.trackId,
        arenaId: this.state.arenaId,
        arenaTheme: this.state.arenaTheme,
        battleType: this.state.battleType,
        loadoutId: this.state.loadoutId,
        weaponPool: Array.from(this.state.weaponPool),
        maxPlayers: this.state.maxPlayers,
        lobbyCode: this.state.lobbyCode,
        customTrackData: this.state.customTrackData || "",
        players,
        multiplayer: true,
        multiplayerProvider: "colyseus",
      };

      const roomName = this.state.gameMode === "gloflux"
        ? "gloflux"
        : (this.state.gameMode === "battle" ? "battle_room" : "race_room");
      console.log(
        `[lobby_room] matchStart roomId=${this.roomId} mode=${this.state.gameMode} trackId=${gameConfig.trackId} arenaId=${gameConfig.arenaId} customTrackBytes=${gameConfig.customTrackData?.length || 0}`
      );
      this.broadcast("matchStart", { roomName, gameConfig });
      this.disconnect();
    }, 1000, 3);
  }
}
