import { Room } from "@colyseus/core";
import { RaceState } from "../schema/RaceState.js";
import { PlayerState } from "../schema/PlayerState.js";
import { EntityState } from "../schema/EntityState.js";
import { grantWeapon, handleFireWeapon, tickProjectiles } from "../combat.js";

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
    state.trackId = options.trackId || "test_box";
    state.totalLaps = Math.min(Math.max(Number(options.totalLaps) || 3, 1), 10);
    this.setState(state);

    this.maxClients = Math.min(Number(options.maxPlayers) || 12, 12);
    // Minimum elapsed time (ms) before a new lap is accepted — prevents double-trigger
    this._minLapMs = 15000;
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

    this.onMessage("checkpoint", (client, data) => {
      if (!this.state.started) return;
      const player = this.state.players.get(client.sessionId);
      if (!player || player.finished) return;

      const now = this.state.serverTime;
      const sinceLastLap = now - (player._lastLapAt || 0);

      // Only accept the finish-line checkpoint (idx 0) and enforce minimum lap time
      const idx = Number(data.idx || 0);
      if (idx !== 0) return; // currently only finish-line supported
      if (sinceLastLap < this._minLapMs && player.lap > 0) return; // anti-spam

      player._lastLapAt = now;

      if (player.lap === 0) {
        // First crossing after race starts — begin lap 1
        player.lap = 1;
        player.checkpointIdx = 0;
        client.send("lapStarted", { lap: 1, totalLaps: this.state.totalLaps });
        return;
      }

      // Subsequent crossings — complete the current lap
      player.lap += 1;
      player.checkpointIdx = 0;

      if (player.lap > this.state.totalLaps) {
        // Player finished the race
        player.finished = true;
        player.raceFinishTime = now;
        this.state.finishCount += 1;
        const position = this.state.finishCount;

        this.broadcast("raceFinished", {
          sessionId: client.sessionId,
          name: player.name,
          position,
          raceFinishTime: now,
        });

        client.send("youFinished", { position, raceFinishTime: now });

        // If all players finished, end the match
        const totalPlayers = this.state.players.size;
        if (position >= totalPlayers) {
          this._endRace();
        }
        return;
      }

      this.broadcast("lapComplete", {
        sessionId: client.sessionId,
        name: player.name,
        lap: player.lap,
        totalLaps: this.state.totalLaps,
      });
      client.send("yourLap", { lap: player.lap, totalLaps: this.state.totalLaps });
    });

    this.onMessage("pickupItem", (client, data) => {
        const entityId = data.entityId;
        const e = this.state.entities.get(entityId);
        const player = this.state.players.get(client.sessionId);
        
        if (e && e.type === "item_box" && e.active && player) {
            // "Consume" the item box
            e.active = false;
            e.respawnTimer = 10000; // 10 seconds respawn
            
            // Grant weapon via combat system
            const rolled = grantWeapon(player);
            
            // Tell the specific client what they got
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
    console.log(`[race_room] created roomId=${this.roomId} track=${state.trackId} laps=${state.totalLaps} maxClients=${this.maxClients}`);

    this.spawnItemBoxes();
  }

  _endRace() {
    // Collect final standings sorted by finish time (finished first) then score
    const standings = [];
    this.state.players.forEach((p) => {
      standings.push({
        sessionId: p.id,
        name: p.name,
        lap: p.lap,
        finished: p.finished,
        raceFinishTime: p.raceFinishTime,
      });
    });
    standings.sort((a, b) => {
      if (a.finished && !b.finished) return -1;
      if (!a.finished && b.finished) return 1;
      if (a.finished && b.finished) return a.raceFinishTime - b.raceFinishTime;
      return b.lap - a.lap;
    });

    this.broadcast("matchEnd", { mode: "race", standings });
    this.state.started = false;
    console.log(`[race_room] race ended — ${standings.length} finishers`);
  }

  spawnItemBoxes() {
    // Spawn item boxes in rows at known positions relative to the track start.
    // Two rows of 4 boxes offset either side of the start-line so karts pass
    // through them naturally on each lap.
    const rows = [
      { zOff:  30, count: 4, spread: 12 },
      { zOff:  80, count: 4, spread: 12 },
      { zOff: 150, count: 4, spread: 10 },
      { zOff: -30, count: 3, spread: 10 }, // behind start line
    ];
    let i = 0;
    for (const row of rows) {
      for (let s = 0; s < row.count; s++) {
        const id = `box_${i++}`;
        const box = new EntityState();
        box.id = id;
        box.type = "item_box";
        box.active = true;
        const tOff = (s / (row.count - 1 || 1) - 0.5) * row.spread;
        box.x = tOff;
        box.y = 2.5;
        box.z = row.zOff;
        this.state.entities.set(id, box);
      }
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

    // Lap tracking — initialise _lastLapAt in the past so first trigger
    // is never blocked by the minimum-lap-time guard.
    p._lastLapAt = -this._minLapMs;

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

    // Handle entity respawns and updates
    this.state.entities.forEach((e) => {
        if (!e.active && e.type === "item_box" && e.respawnTimer > 0) {
            e.respawnTimer -= deltaTime;
            if (e.respawnTimer <= 0) {
                e.respawnTimer = 0;
                e.active = true; // respawn!
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
