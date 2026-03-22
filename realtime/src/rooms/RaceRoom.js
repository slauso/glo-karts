import { Room } from "@colyseus/core";
import { RaceState } from "../schema/RaceState.js";
import { PlayerState } from "../schema/PlayerState.js";
import { EntityState } from "../schema/EntityState.js";
import { RACE_WEAPON_POOL, WEAPONS, grantWeapon, handleFireWeapon, swapSecondaryWeapon, tickProjectiles } from "../combat.js";
import { RateLimiter, sanitizePosition, isWithinPickupRangeWithClientPosition, isValidProjectileOrigin } from "../server-guard.js";
import { log } from "../logger.js";
import {
  applyAuthoritativeKartStep,
  buildRealtimeInput,
  configureRealtimeRoom,
  getRealtimeControlInput,
  getRealtimeCountdownMs,
  getRealtimeJoinPayload,
  getSimulationIntervalMs,
  isRealtimeInputFresh,
  initializeAuthoritativeKart,
  noteProcessedInput,
  noteRealtimeTick,
  noteRejectedInput,
  REALTIME_SYNC_DEFAULTS,
  resolveAuthoritativeKartContacts,
  storeLatestRealtimeInput,
} from "../realtime-sync.js";

const TICK_RATE = getSimulationIntervalMs();
const TRACK_SURFACE_Y = {
  test_box: 1.0,
  glo_circuit: 1.0,
};

export class RaceRoom extends Room {
  onCreate(options = {}) {
    const state = new RaceState();
    state.trackId = options.trackId || "test_box";
    state.totalLaps = Math.min(Math.max(Number(options.totalLaps) || 3, 1), 10);
    this.setState(state);
    this._surfaceY = TRACK_SURFACE_Y[state.trackId] ?? 1.0;

    const syncConfig = configureRealtimeRoom(this, options, { authoritative: true });
    // Minimum elapsed time (ms) before a new lap is accepted — prevents double-trigger
    this._minLapMs = 15000;
    this.inputBySession = new Map();
    this.countdownActive = false;
    this.staleInputMs = syncConfig.staleInputMs || REALTIME_SYNC_DEFAULTS.staleInputMs;
    this.countdownDurationMs = getRealtimeCountdownMs(options);
    // Task 2.2: per-client rate limiter
    this._rateLimiter = new RateLimiter({
      fireWeapon: { max: 40, windowMs: 1000 },
    });
    this._kartCrashCooldownUntil = new Map();

    this.onMessage("triggerStart", () => {
      if (this.state.started || this.countdownActive) return;
      this.countdownActive = true;

      const durationMs = this.countdownDurationMs;
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

      const durationMs = this.countdownDurationMs;
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
      // Task 2.2: rate-limit input messages
      if (!this._rateLimiter.allow(client.sessionId, "input")) return;
      const accepted = storeLatestRealtimeInput(this.inputBySession, client.sessionId, buildRealtimeInput(data));
      if (!accepted) noteRejectedInput(this, "out_of_order");
    });

    this.onMessage("checkpoint", (client, data) => {
      // Task 2.2: rate-limit checkpoint messages
      if (!this._rateLimiter.allow(client.sessionId, "checkpoint")) return;
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
        // Task 2.2 + 2.3: rate-limit and proximity-validate pickups
        if (!this._rateLimiter.allow(client.sessionId, "pickupItem")) return;
        const entityId = data.entityId;
        const e = this.state.entities.get(entityId);
        const player = this.state.players.get(client.sessionId);
        const pickupPosition = data && Number.isFinite(Number(data.x)) && Number.isFinite(Number(data.y)) && Number.isFinite(Number(data.z))
          ? { x: Number(data.x), y: Number(data.y), z: Number(data.z) }
          : null;
        
        if (e && e.type === "item_box" && e.active && player && isWithinPickupRangeWithClientPosition(player, e, pickupPosition)) {
            // Allow pickup if any pickup slot has room
            const hasRoom = (!player.weapon2 || player.ammo2 <= 0) || (!player.weapon3 || player.ammo3 <= 0);
            if (!hasRoom) return;
            // "Consume" the item box
            e.active = false;
            e.respawnTimer = 10000; // 10 seconds respawn
            const slot = (player.weapon2 && player.ammo2 > 0) ? "reserve" : "secondary";
            
            // Grant weapon via combat system
            const rolled = grantWeapon(player, 0.5, { pool: RACE_WEAPON_POOL });
          const weaponDef = WEAPONS[rolled];
            
            // Tell the specific client what they got
          client.send("itemReceived", {
            slot,
            weapon: rolled,
            ammo: slot === "reserve" ? player.ammo3 : player.ammo2,
            category: weaponDef?.category || 'unknown',
            cooldownMs: weaponDef?.cooldown || 0,
            effect: weaponDef?.effect || '',
            description: weaponDef?.desc || '',
            reserve: { weapon: player.weapon3 || "", ammo: player.ammo3 || 0 },
          });
        }
    });

    this.onMessage("swapSecondaryWeapon", (client) => {
        if (!this._rateLimiter.allow(client.sessionId, "swapSecondaryWeapon")) return;
        const player = this.state.players.get(client.sessionId);
        if (!player || !this.state.started) return;
        if (!swapSecondaryWeapon(player)) return;

        client.send("secondaryWeaponSwapped", {
          active: { weapon: player.weapon2 || "", ammo: player.ammo2 || 0 },
          reserve: { weapon: player.weapon3 || "", ammo: player.ammo3 || 0 },
          cooldownMs: WEAPONS[player.weapon2 || ""]?.cooldown || 0,
        });
    });

    this.onMessage("fireWeapon", (client, data = {}) => {
        // Task 2.2: rate-limit weapon fire
        if (!this._rateLimiter.allow(client.sessionId, "fireWeapon")) return;
        const player = this.state.players.get(client.sessionId);
        if (!player || !this.state.started) return;

        const result = handleFireWeapon(player, this.state.entities, this.state.players, {
          roomState: this.state,
          fireInput: data,
        });
        if (!result) return;

        if (result.projectile) {
            const proj = result.projectile;
            // Task 2.3.4: Verify projectile spawn is near owner's authoritative position
            if (!isValidProjectileOrigin(player, proj)) {
                this.state.entities.delete(proj.id);
                return;
            }
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
        if (Array.isArray(result.instantHits)) {
          for (const hit of result.instantHits) {
            const damage = Math.max(0, Number(hit.damage || 0));
            const victim = hit.victim;
            if (!victim || damage <= 0) continue;
            if (victim.shielded) {
              victim.shieldHP = Math.max(0, Number(victim.shieldHP || 0) - damage);
              if (victim.shieldHP <= 0) {
                victim.shielded = false;
                victim.effectType = "";
                victim.effectTimer = 0;
              }
              this.broadcast("shieldAbsorbed", {
                projectileId: "",
                victimId: victim.id,
                attackerId: hit.ownerId || player.id,
                subType: hit.subType || "swatter",
                shieldHP: victim.shieldHP ?? 0,
                shieldBroken: (victim.shieldHP ?? 0) <= 0,
                hitX: hit.hitPoint?.x,
                hitY: hit.hitPoint?.y,
                hitZ: hit.hitPoint?.z,
              });
              continue;
            }
            victim.health = Math.max(0, victim.health - damage);
            this.broadcast("projectileHit", {
              projectileId: "",
              victimId: victim.id,
              attackerId: hit.ownerId || player.id,
              subType: hit.subType || "swatter",
              damage,
              remainingHealth: victim.health,
              effect: hit.effectApplied?.type || hit.subType || "swatter",
              hitX: hit.hitPoint?.x,
              hitY: hit.hitPoint?.y,
              hitZ: hit.hitPoint?.z,
            });
            if (hit.effectApplied?.type) {
              this.broadcast("effectApplied", {
                type: hit.effectApplied.type,
                target: victim.id,
                attackerId: hit.ownerId || player.id,
                duration: hit.effectApplied.duration,
              });
            }
          }
        }
    });

    this.setSimulationInterval((deltaTime) => this.update(deltaTime), TICK_RATE);
    log('info', 'room_create', {
      room: 'race_room',
      roomId: this.roomId,
      track: state.trackId,
      laps: state.totalLaps,
      maxClients: this.maxClients,
      patchRateMs: syncConfig.patchRateMs,
      staleInputMs: this.staleInputMs,
      authoritative: true,
    });
    console.log(`[race_room] created roomId=${this.roomId} track=${state.trackId} laps=${state.totalLaps} maxClients=${this.maxClients} patchRateMs=${Math.round(syncConfig.patchRateMs)}`);

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
    log('info', 'match_end', { room: 'race_room', roomId: this.roomId, finishers: standings.length });
    console.log(`[race_room] race ended — ${standings.length} finishers`);
  }

  _getKartCrashKey(playerAId, playerBId) {
    return [playerAId, playerBId].sort().join(":");
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
        box.y = this._surfaceY + 0.9;
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
    initializeAuthoritativeKart(p, { x: spawn.x, y: this._surfaceY, z: spawn.z });

    this.state.players.set(client.sessionId, p);
    log('info', 'room_join', { room: 'race_room', roomId: this.roomId, sessionId: client.sessionId, name: p.name, players: this.state.players.size });
    console.log(`[race_room] join sessionId=${client.sessionId} name=${p.name} players=${this.state.players.size}`);
    client.send("joined", { sessionId: client.sessionId, room: this.roomId, mode: "race", sync: getRealtimeJoinPayload(this) });

    // Late-join catchup: sync countdown/live state to late arrivals
    if (this.state.started) {
      const serverNow = Date.now();
      client.send("startSequence", { durationMs: 0, startAt: serverNow, serverNow });
      client.send("matchLive", { startedAt: serverNow });
      client.send("lapStarted", { lap: 1, totalLaps: this.state.totalLaps });
    } else if (this.countdownActive) {
      const remaining = Math.max(0, (this._countdownStartAt || Date.now()) - Date.now());
      const serverNow = Date.now();
      client.send("startSequence", { durationMs: remaining, startAt: serverNow + remaining, serverNow });
    }
  }

  onLeave(client) {
    this.state.players.delete(client.sessionId);
    this.inputBySession.delete(client.sessionId);
    this._rateLimiter.removeClient(client.sessionId);
    log('info', 'room_leave', { room: 'race_room', roomId: this.roomId, sessionId: client.sessionId, players: this.state.players.size });
    console.log(`[race_room] leave sessionId=${client.sessionId} players=${this.state.players.size}`);

    // Task 3.4: If everyone remaining has finished, end the race to prevent hangs
    if (this.state.started && this.state.players.size > 0) {
      let allFinished = true;
      this.state.players.forEach((p) => { if (!p.finished) allFinished = false; });
      if (allFinished) this._endRace();
    }
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
    const now = Date.now();
    this.state.serverTime = now;
    noteRealtimeTick(this, deltaTime, now);

    this.state.players.forEach((p, id) => {
      const input = this.inputBySession.get(id);
      const inputFresh = !!(input && isRealtimeInputFresh(input, now, this.staleInputMs));
      if (!this.state.started) return;
      if (input && !inputFresh) {
        noteRejectedInput(this, "stale");
      }

      const authoritativeInput = getRealtimeControlInput(input, now, this.staleInputMs);
      p.steer = authoritativeInput.steer || 0;
      applyAuthoritativeKartStep(p, authoritativeInput, deltaTime, sanitizePosition);
      if (inputFresh) noteProcessedInput(this, input, now);
    });

    const kartCrashes = resolveAuthoritativeKartContacts(this.state.players, deltaTime, sanitizePosition);
    for (const crash of kartCrashes) {
      const pairKey = this._getKartCrashKey(crash.playerA.id, crash.playerB.id);
      if (now < (this._kartCrashCooldownUntil.get(pairKey) || 0)) continue;
      if (crash.severity < 1.2 && crash.damageA <= 0 && crash.damageB <= 0) continue;
      this._kartCrashCooldownUntil.set(pairKey, now + 350);

      if (crash.damageA > 0) {
        crash.playerA.health = Math.max(0, crash.playerA.health - crash.damageA);
      }
      if (crash.damageB > 0) {
        crash.playerB.health = Math.max(0, crash.playerB.health - crash.damageB);
      }

      this.broadcast("kartCrash", {
        playerAId: crash.playerA.id,
        playerBId: crash.playerB.id,
        damageA: crash.damageA,
        damageB: crash.damageB,
        remainingHealthA: crash.playerA.health,
        remainingHealthB: crash.playerB.health,
        severity: crash.severity,
        hitX: crash.hitX,
        hitY: crash.hitY,
        hitZ: crash.hitZ,
      });
    }

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
    const hits = tickProjectiles(this.state.entities, this.state.players, deltaTime, this._surfaceY);
    for (const { projectile, victim, shieldAbsorbed, effectApplied, shieldHP, hitPoint, damage } of hits) {
        if (shieldAbsorbed) {
            this.broadcast("shieldAbsorbed", {
                projectileId: projectile.id,
                victimId: victim.id,
          attackerId: projectile.ownerId,
          subType: projectile.subType,
          shieldHP: shieldHP ?? 0,
          shieldBroken: (shieldHP ?? 0) <= 0,
          hitX: hitPoint?.x,
          hitY: hitPoint?.y,
          hitZ: hitPoint?.z,
            });
            continue;
        }
        const appliedDamage = Math.max(0, Number(damage ?? projectile.damage ?? 0));
        victim.health = Math.max(0, victim.health - appliedDamage);
        this.broadcast("projectileHit", {
            projectileId: projectile.id,
            victimId: victim.id,
        attackerId: projectile.ownerId,
            subType: projectile.subType,
            damage: appliedDamage,
            remainingHealth: victim.health,
        effect: effectApplied?.type || projectile.subType,
        hitX: hitPoint?.x,
        hitY: hitPoint?.y,
        hitZ: hitPoint?.z,
        });
        if (effectApplied?.type) {
          this.broadcast("effectApplied", {
            type: effectApplied.type,
            target: victim.id,
            attackerId: projectile.ownerId,
            duration: effectApplied.duration,
          });
        }
    }
  }
}
