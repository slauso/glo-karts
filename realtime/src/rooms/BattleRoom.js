import { Room } from "@colyseus/core";
import { BattleState } from "../schema/BattleState.js";
import { PlayerState } from "../schema/PlayerState.js";
import { EntityState } from "../schema/EntityState.js";

const TICK_RATE = 1000 / 60;
const ACCEL = 20;
const DRAG = 0.9;

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeUnit(value, fallback = 0) {
  const n = safeNumber(value, fallback);
  return Math.max(-1, Math.min(1, n));
}

export class BattleRoom extends Room {
  onCreate(options = {}) {
    const state = new BattleState();
    state.gameType = options.gameType || "deathmatch";
    state.scoreLimit = Number(options.scoreLimit || 5);
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

    this.onMessage("hit", (client, data) => {
      const target = this.state.players.get(String(data.targetId || ""));
      const attacker = this.state.players.get(client.sessionId);
      if (!target || !attacker || !this.state.started) return;

      target.health = Math.max(0, target.health - Number(data.damage || 10));
      if (target.health === 0) {
        attacker.score += 1;
        target.health = 100;
        const spawn = this.getSpawnPoint(this.state.players.size, Math.floor(Math.random() * 12));
        target.x = spawn.x;
        target.z = spawn.z;

        if (this.state.gameType === "ctf") {
          if (attacker.team === "red") this.state.redScore += 1;
          else this.state.blueScore += 1;
        }
      }
    });

    this.onMessage("pickupItem", (client, data) => {
        const entityId = data.entityId;
        const e = this.state.entities.get(entityId);
        
        if (e && e.type === "item_box" && e.active) {
            e.active = false;
            e.respawnTimer = 10000; 
            
            const weapons = ["missile", "bowling_ball", "shield"];
            const rolled = weapons[Math.floor(Math.random() * weapons.length)];
            
            client.send("itemReceived", { weapon: rolled });
        }
    });

    this.setSimulationInterval((deltaTime) => this.update(deltaTime), TICK_RATE);
    console.log(`[battle_room] created roomId=${this.roomId} gameType=${state.gameType} maxClients=${this.maxClients}`);
    
    this.spawnItemBoxes();
  }
  
  spawnItemBoxes() {
    for (let i = 0; i < 8; i++) {
        const angle = (Math.PI * 2) * (i / 8);
        const radius = 25; 
        const id = `box_${i}`;
        
        const box = new EntityState();
        box.id = id;
        box.type = "item_box";
        box.active = true;
        box.x = Math.cos(angle) * radius;
        box.y = 2.0; 
        box.z = Math.sin(angle) * radius;

        this.state.entities.set(id, box);
    }
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
    p.team = idx % 2 === 0 ? "red" : "blue";

    const spawn = this.getSpawnPoint(this.maxClients, idx);
    p.x = spawn.x;
    p.y = 2.5;
    p.z = spawn.z;

    this.state.players.set(client.sessionId, p);
    console.log(`[battle_room] join sessionId=${client.sessionId} name=${p.name} team=${p.team} players=${this.state.players.size}`);
    client.send("joined", {
      sessionId: client.sessionId,
      room: this.roomId,
      mode: "battle",
      gameType: this.state.gameType,
      team: p.team,
    });
  }

  onLeave(client) {
    this.state.players.delete(client.sessionId);
    this.inputBySession.delete(client.sessionId);
    console.log(`[battle_room] leave sessionId=${client.sessionId} players=${this.state.players.size}`);
  }

  getSpawnPoint(maxPlayers, index) {
    const count = Math.max(2, Math.min(12, maxPlayers || 12));
    const angleStep = (Math.PI * 2) / count;
    const baseAngle = angleStep * (index % count);
    const centerJitter = (Math.random() - 0.5) * angleStep * 0.8;
    const angle = baseAngle + centerJitter;
    const radius = 10 + Math.random() * 8;

    let x = Math.cos(angle) * radius;
    let z = Math.sin(angle) * radius;

    const minDistance = 10;
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
      const retryRadius = 24 + Math.random() * 12;
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

    if (this.state.gameType === "ctf") {
      if (this.state.redScore >= this.state.scoreLimit || this.state.blueScore >= this.state.scoreLimit) {
        this.broadcast("matchEnd", {
          winner: this.state.redScore > this.state.blueScore ? "red" : "blue",
          redScore: this.state.redScore,
          blueScore: this.state.blueScore,
        });
        this.state.started = false;
        this.countdownActive = false;
      }
    }

    this.state.entities.forEach((e) => {
        if (!e.active && e.respawnTimer > 0) {
            e.respawnTimer -= deltaTime;
            if (e.respawnTimer <= 0) {
                e.respawnTimer = 0;
                e.active = true;
            }
        }
    });
  }
}
