import { Room } from "@colyseus/core";
import { RaceState } from "../schema/RaceState.js";
import { PlayerState } from "../schema/PlayerState.js";

const TICK_RATE = 1000 / 60;
const ACCEL = 22;
const DRAG = 0.92;

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeUnit(value, fallback = 0) {
  const n = safeNumber(value, fallback);
  return Math.max(-1, Math.min(1, n));
}

export class RaceRoom extends Room {
  onCreate(options = {}) {
    const state = new RaceState();
    state.trackId = options.trackId || "cocoa_temple";
    this.setState(state);

    this.maxClients = Math.min(Number(options.maxPlayers) || 12, 12);
    this.inputBySession = new Map();
    this.countdownActive = false;

    this.onMessage("triggerStart", () => {
      if (this.state.started || this.countdownActive) return;
      this.countdownActive = true;

      const durationMs = 4000;
      const serverNow = Date.now();
      const startAt = serverNow + durationMs;

      this.broadcast("startSequence", { durationMs, startAt, serverNow });

      this.clock.setTimeout(() => {
        this.state.started = true;
        this.countdownActive = false;
        this.broadcast("matchLive", { startedAt: Date.now() });
      }, durationMs);
    });

    this.onMessage("start", () => {
      if (this.state.started || this.countdownActive) return;
      this.countdownActive = true;

      const durationMs = 4000;
      const serverNow = Date.now();
      const startAt = serverNow + durationMs;

      this.broadcast("startSequence", { durationMs, startAt, serverNow });

      this.clock.setTimeout(() => {
        this.state.started = true;
        this.countdownActive = false;
        this.broadcast("matchLive", { startedAt: Date.now() });
      }, durationMs);
    });

    this.onMessage("input", (client, data) => {
      this.inputBySession.set(client.sessionId, {
        seq: Math.max(0, Math.floor(safeNumber(data.seq, 0))),
        throttle: safeUnit(data.throttle, 0),
        steer: safeUnit(data.steer, 0),
        brake: safeUnit(data.brake, 0),
        fire: !!data.fire,
        x: safeNumber(data.x, 0),
        y: safeNumber(data.y, 1),
        z: safeNumber(data.z, 0),
        rx: safeNumber(data.rx, 0),
        ry: safeNumber(data.ry, 0),
        rz: safeNumber(data.rz, 0),
        rw: safeNumber(data.rw, 1)
      });
    });

    this.setSimulationInterval((deltaTime) => this.update(deltaTime), TICK_RATE);
    console.log(`[race_room] created roomId=${this.roomId} track=${state.trackId} maxClients=${this.maxClients}`);
  }

  onJoin(client, options = {}) {
    const p = new PlayerState();
    p.id = client.sessionId;
    p.name = options.playerName || `Player_${client.sessionId.slice(0, 4)}`;
    p.kartId = options.kartId || "tux";
    p.playerColor = options.playerColor || "red";
    p.gloEffect = options.gloEffect || "solid";
    p.gloColor = options.gloColor || "#ff0080";
    p.gloColor2 = options.gloColor2 || "#00e5ff";

    const idx = this.state.players.size;
    const spawn = this.getSpawnPoint(this.maxClients, idx);
    p.x = spawn.x;
    p.y = 2.5;
    p.z = spawn.z;

    this.state.players.set(client.sessionId, p);
    console.log(`[race_room] join sessionId=${client.sessionId} name=${p.name} players=${this.state.players.size}`);
    client.send("joined", { sessionId: client.sessionId, room: this.roomId, mode: "race" });
  }

  onLeave(client) {
    this.state.players.delete(client.sessionId);
    this.inputBySession.delete(client.sessionId);
    console.log(`[race_room] leave sessionId=${client.sessionId} players=${this.state.players.size}`);
  }

  getSpawnPoint(maxPlayers, index) {
    const count = Math.max(2, Math.min(12, maxPlayers || 12));
    const angleStep = (Math.PI * 2) / count;
    const baseAngle = angleStep * (index % count);
    const centerJitter = (Math.random() - 0.5) * angleStep * 0.8;
    const angle = baseAngle + centerJitter;
    const radius = 6 + Math.random() * 8;

    let x = Math.cos(angle) * radius;
    let z = Math.sin(angle) * radius;

    const minDistance = 8;
    for (let attempt = 0; attempt < 8; attempt++) {
      let tooClose = false;
      this.state.players.forEach((player) => {
        const dx = player.x - x;
        const dz = player.z - z;
        if (dx * dx + dz * dz < minDistance * minDistance) {
          tooClose = true;
        }
      });

      if (!tooClose) {
        return { x, z };
      }

      const retryAngle = Math.random() * Math.PI * 2;
      const retryRadius = 20 + Math.random() * 10;
      x = Math.cos(retryAngle) * retryRadius;
      z = Math.sin(retryAngle) * retryRadius;
    }

    return { x, z };
  }

  update(deltaTime) {
    const dt = deltaTime / 1000;
    this.state.serverTime += deltaTime;

    this.state.players.forEach((p, id) => {
      const input = this.inputBySession.get(id);
      if (input && this.state.started) {
        if (
          !Number.isFinite(input.x) ||
          !Number.isFinite(input.y) ||
          !Number.isFinite(input.z) ||
          !Number.isFinite(input.rx) ||
          !Number.isFinite(input.ry) ||
          !Number.isFinite(input.rz) ||
          !Number.isFinite(input.rw)
        ) {
          return;
        }

        // Phase 3: Update directly from client-authoritative Havok physics engine
        p.x = input.x; 
        p.y = input.y; 
        p.z = input.z;
        p.rx = input.rx; 
        p.ry = input.ry; 
        p.rz = input.rz; 
        p.rw = input.rw;
        p.lastProcessedInput = input.seq;
      }
    });
  }
}
