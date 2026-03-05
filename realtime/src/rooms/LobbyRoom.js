import { Room } from "@colyseus/core";
import { LobbyState } from "../schema/LobbyState.js";
import { LobbyPlayerState } from "../schema/LobbyPlayerState.js";

const DEFAULT_TRACK = "cocoa_temple";
const DEFAULT_ARENA = "battleisland";
const DEFAULT_BATTLE_TYPE = "deathmatch";
const DEFAULT_MAX_PLAYERS = 12;
const MAX_CONCURRENT_LOBBY_PLAYERS = 100;

export class LobbyRoom extends Room {
  static activeLobbyPlayers = 0;

  onCreate(options = {}) {
    const state = new LobbyState();
    state.lobbyCode = String(options.lobbyCode || "").trim().toUpperCase();
    state.privacy = options.privacy === "open" ? "open" : "private";
    state.gameMode = options.gameMode === "battle" ? "battle" : "race";
    state.trackId = String(options.trackId || DEFAULT_TRACK);
    state.arenaId = String(options.arenaId || DEFAULT_ARENA);
    state.battleType = options.battleType === "ctf" ? "ctf" : DEFAULT_BATTLE_TYPE;
    state.maxPlayers = Math.min(Math.max(Number(options.maxPlayers) || DEFAULT_MAX_PLAYERS, 2), 12);
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

      this.state.gameMode = data.gameMode === "battle" ? "battle" : "race";
      this.state.trackId = String(data.trackId || this.state.trackId || DEFAULT_TRACK);
      this.state.arenaId = String(data.arenaId || this.state.arenaId || DEFAULT_ARENA);
      this.state.battleType = data.battleType === "ctf" ? "ctf" : "deathmatch";
      this.state.maxPlayers = Math.min(Math.max(Number(data.maxPlayers) || this.state.maxPlayers || DEFAULT_MAX_PLAYERS, 2), 12);
      this.maxClients = this.state.maxPlayers;
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
      this.state.lobbyCode = this.roomId.slice(0, 6).toUpperCase();
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
  }

  onLeave(client) {
    const wasHost = this.state.players.get(client.sessionId)?.isHost;
    this.state.players.delete(client.sessionId);
    LobbyRoom.activeLobbyPlayers = Math.max(0, LobbyRoom.activeLobbyPlayers - 1);

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
        gameMode: this.state.gameMode,
        trackId: this.state.trackId,
        arenaId: this.state.arenaId,
        battleType: this.state.battleType,
        maxPlayers: this.state.maxPlayers,
        lobbyCode: this.state.lobbyCode,
        players,
        multiplayer: true,
        multiplayerProvider: "colyseus",
      };

      const roomName = this.state.gameMode === "battle" ? "battle_room" : "race_room";
      this.broadcast("matchStart", { roomName, gameConfig });
      this.disconnect();
    }, 1000, 3);
  }
}
