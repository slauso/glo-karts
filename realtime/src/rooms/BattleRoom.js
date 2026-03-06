import { Room } from "@colyseus/core";
import { BattleState } from "../schema/BattleState.js";
import { PlayerState } from "../schema/PlayerState.js";
import { EntityState } from "../schema/EntityState.js";
import { grantWeapon, handleFireWeapon, tickProjectiles } from "../combat.js";

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

      const durationMs = 10000;
      const serverNow = Date.now();
      const startAt = serverNow + durationMs;
      this._countdownStartAt = startAt;

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

      const durationMs = 10000;
      const serverNow = Date.now();
      const startAt = serverNow + durationMs;
      this._countdownStartAt = startAt;

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
        } else {
          // Deathmatch / TDM — check score limit
          this._checkDeathmatchWin(attacker);
        }
      }
    });

    this.onMessage("pickupItem", (client, data) => {
        const entityId = data.entityId;
        const e = this.state.entities.get(entityId);
        const player = this.state.players.get(client.sessionId);
        
        if (e && e.type === "item_box" && e.active && player) {
            e.active = false;
            e.respawnTimer = 10000; 
            
            const rolled = grantWeapon(player);
            
            client.send("itemReceived", { weapon: rolled });
        }
    });

    this.onMessage("fireWeapon", (client) => {
        const player = this.state.players.get(client.sessionId);
        if (!player || !this.state.started) return;

        const result = handleFireWeapon(player, this.state.entities, this.state.players);
        if (!result) return;

        if (result.projectile) {
            const proj = result.projectile;
            this.broadcast("projectileFired", {
                id: proj.id,
                subType: proj.subType,
                ownerId: proj.ownerId,
                x: proj.x, y: proj.y, z: proj.z,
                vx: proj.vx, vy: proj.vy, vz: proj.vz,
            });
        }
        if (result.effectApplied) {
            this.broadcast("effectApplied", result.effectApplied);
        }
    });

    this.setSimulationInterval((deltaTime) => this.update(deltaTime), TICK_RATE);
    console.log(`[battle_room] created roomId=${this.roomId} gameType=${state.gameType} scoreLimit=${state.scoreLimit} maxClients=${this.maxClients}`);
    
    this.spawnItemBoxes();
  }

  _checkDeathmatchWin(attacker) {
    if (!this.state.started) return;
    if (attacker.score >= this.state.scoreLimit) {
      // Build standings sorted by score
      const standings = [];
      this.state.players.forEach((p) => {
        standings.push({ sessionId: p.id, name: p.name, score: p.score, team: p.team });
      });
      standings.sort((a, b) => b.score - a.score);

      this.broadcast("matchEnd", {
        mode: "battle",
        gameType: this.state.gameType,
        winner: attacker.name,
        winnerId: attacker.id,
        winReason: `${attacker.score} kills`,
        standings,
      });
      this.state.started = false;
      console.log(`[battle_room] deathmatch won by ${attacker.name} (${attacker.score} kills)`);
    }
  }
  
  spawnItemBoxes() {
    // Grid of item boxes spread around the arena centre at 4 cardinal + 4 diagonal positions
    const positions = [
      { x:  20, z:   0 }, { x: -20, z:   0 },
      { x:   0, z:  20 }, { x:   0, z: -20 },
      { x:  15, z:  15 }, { x: -15, z:  15 },
      { x:  15, z: -15 }, { x: -15, z: -15 },
    ];
    positions.forEach((pos, i) => {
      const id = `box_${i}`;
      const box = new EntityState();
      box.id = id;
      box.type = "item_box";
      box.active = true;
      box.x = pos.x;
      box.y = 2.0;
      box.z = pos.z;
      this.state.entities.set(id, box);
    });
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

    // If the match is already started or mid-countdown, send catchup events
    // so late-joining clients (e.g. reconnect) receive the lifecycle signals.
    if (this.state.started) {
      const durationMs = 0;
      const serverNow = Date.now();
      client.send("startSequence", { durationMs, startAt: serverNow, serverNow });
      client.send("matchLive", { startedAt: serverNow });
    } else if (this.countdownActive) {
      // Mid-countdown — send startSequence with remaining time so client shows
      // correct countdown and transitions to matchLive when it fires.
      const remaining = Math.max(0, (this._countdownStartAt || Date.now()) - Date.now());
      const serverNow = Date.now();
      client.send("startSequence", { durationMs: remaining, startAt: serverNow + remaining, serverNow });
    }
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
        if (!e.active && e.type === "item_box" && e.respawnTimer > 0) {
            e.respawnTimer -= deltaTime;
            if (e.respawnTimer <= 0) {
                e.respawnTimer = 0;
                e.active = true;
            }
        }
    });

    // Tick projectiles — movement, lifespan, hit detection
    const hits = tickProjectiles(this.state.entities, this.state.players, deltaTime);
    for (const { projectile, victim, shieldAbsorbed } of hits) {
        if (shieldAbsorbed) {
            this.broadcast("shieldAbsorbed", {
                projectileId: projectile.id,
                victimId: victim.id,
            });
            continue;
        }
        victim.health = Math.max(0, victim.health - projectile.damage);

        // Award score to attacker
        const attacker = this.state.players.get(projectile.ownerId);
        if (victim.health === 0) {
            if (attacker) attacker.score += 1;
            victim.health = 100;
            const spawn = this.getSpawnPoint(this.state.players.size, Math.floor(Math.random() * 12));
            victim.x = spawn.x;
            victim.z = spawn.z;

            if (this.state.gameType === "ctf" && attacker) {
                if (attacker.team === "red") this.state.redScore += 1;
                else this.state.blueScore += 1;
            } else if (attacker) {
                this._checkDeathmatchWin(attacker);
            }
        }

        this.broadcast("projectileHit", {
            projectileId: projectile.id,
            victimId: victim.id,
            subType: projectile.subType,
            damage: projectile.damage,
            remainingHealth: victim.health,
            effect: projectile.subType,
        });
    }
  }
}
