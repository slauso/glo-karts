import { Room } from "@colyseus/core";
import { BattleState } from "../schema/BattleState.js";
import { PlayerState } from "../schema/PlayerState.js";
import {
  WEAPONS,
  handleFireWeapon,
  tickArenaEffects,
  tickProjectiles,
} from "../combat.js";
import { RateLimiter, sanitizePosition, isValidProjectileOrigin } from "../server-guard.js";
import {
  configureRealtimeRoom,
  getRealtimeCountdownMs,
  getRealtimeJoinPayload,
  getRealtimeMetricsSnapshot,
  getSimulationIntervalMs,
  noteProcessedInput,
  noteRealtimeTick,
  noteRejectedInput,
} from "../realtime-sync.js";
import { log } from "../logger.js";
import {
  buildArenaCollisionBoxes,
  FPS_ARENA_DIMENSIONS,
  getArenaGroundHeight,
  getDefaultFpsSpawn,
  normalizeAngle,
} from "../../../frontend/src/modules/fps/fps-arena-layout.js";

const TICK_RATE = getSimulationIntervalMs();
const DEFAULT_LOADOUT = ["cannon", "frostAxe", "moltenDagger"];
const MOVE_SPEED = 8;
const SPRINT_SPEED = 12;
const GROUND_ACCEL = 26;
const AIR_ACCEL = 14;
const JUMP_VELOCITY = 6;
const GRAVITY = 20;
const PLAYER_HEIGHT = FPS_ARENA_DIMENSIONS.playerHeight;
const PLAYER_RADIUS = FPS_ARENA_DIMENSIONS.playerRadius;

function createLoadoutState() {
  return {
    currentWeapon: DEFAULT_LOADOUT[0],
    reloadingWeapon: "",
    reloadEndsAt: 0,
    weapons: Object.fromEntries(
      DEFAULT_LOADOUT.map((weaponId) => {
        const def = WEAPONS[weaponId];
        return [weaponId, {
          weaponId,
          ammo: def?.ammo || 0,
          maxAmmo: def?.ammo || 0,
          reloadTimeMs: def?.reloadTimeMs || 0,
        }];
      }),
    ),
  };
}

function normalizeQuaternion(rx, ry, rz, rw) {
  const len = Math.sqrt(rx * rx + ry * ry + rz * rz + rw * rw) || 1;
  return { rx: rx / len, ry: ry / len, rz: rz / len, rw: rw / len };
}

function parseFpsInput(data = {}, now = Date.now()) {
  return {
    seq: Math.max(0, Math.floor(Number(data.seq || 0))),
    moveX: Math.max(-1, Math.min(1, Number(data.moveX || 0))),
    moveY: Math.max(-1, Math.min(1, Number(data.moveY || 0))),
    sprint: !!data.sprint,
    jump: !!data.jump,
    yaw: Number.isFinite(Number(data.yaw)) ? Number(data.yaw) : 0,
    pitch: Number.isFinite(Number(data.pitch)) ? Number(data.pitch) : 0,
    rx: Number(data.rx || 0),
    ry: Number(data.ry || 0),
    rz: Number(data.rz || 0),
    rw: Number.isFinite(Number(data.rw)) ? Number(data.rw) : 1,
    receivedAt: now,
  };
}

export class FpsArenaRoom extends Room {
  onCreate(options = {}) {
    const state = new BattleState();
    state.mode = "fps_arena";
    state.gameType = "deathmatch";
    state.scoreLimit = Math.max(3, Number(options.scoreLimit || 10));
    this.setState(state);

    const syncConfig = configureRealtimeRoom(this, options, { authoritative: true });
    this.inputBySession = new Map();
    this.loadouts = new Map();
    this.countdownActive = false;
    this.staleInputMs = syncConfig.staleInputMs || 250;
    this.countdownDurationMs = getRealtimeCountdownMs(options);
    this._countdownStartAt = 0;
    this._rateLimiter = new RateLimiter({ input: { max: 90, windowMs: 1000 }, fireWeapon: { max: 12, windowMs: 1000 } });
    this._allowDebugControls = process.env.NODE_ENV !== "production";
    this._collisionBoxes = buildArenaCollisionBoxes();

    this.onMessage("start", () => this._beginCountdown());
    this.onMessage("triggerStart", () => this._beginCountdown());

    this.onMessage("input", (client, data = {}) => {
      if (!this._rateLimiter.allow(client.sessionId, "input")) return;
      const next = parseFpsInput(data);
      const prev = this.inputBySession.get(client.sessionId);
      if (prev && next.seq <= prev.seq) {
        noteRejectedInput(this, "out_of_order");
        return;
      }
      this.inputBySession.set(client.sessionId, next);
    });

    this.onMessage("selectWeapon", (client, data = {}) => {
      const loadout = this.loadouts.get(client.sessionId);
      const player = this.state.players.get(client.sessionId);
      const weaponId = String(data.weaponId || "");
      if (!loadout || !player || !loadout.weapons[weaponId]) return;
      loadout.currentWeapon = weaponId;
      this._applyLoadoutToPlayer(player, loadout);
      client.send("loadoutState", this._serializeLoadout(loadout));
    });

    this.onMessage("reloadWeapon", (client, data = {}) => {
      const loadout = this.loadouts.get(client.sessionId);
      const player = this.state.players.get(client.sessionId);
      if (!loadout || !player) return;
      const weaponId = String(data.weaponId || loadout.currentWeapon || "");
      const slot = loadout.weapons[weaponId];
      if (!slot || loadout.reloadingWeapon || slot.ammo >= slot.maxAmmo) return;

      loadout.reloadingWeapon = weaponId;
      loadout.reloadEndsAt = Date.now() + slot.reloadTimeMs;
      client.send("reloadStarted", { weaponId, durationMs: slot.reloadTimeMs });
    });

    this.onMessage("fireWeapon", (client, data = {}) => {
      if (!this._rateLimiter.allow(client.sessionId, "fireWeapon")) return;
      const player = this.state.players.get(client.sessionId);
      const loadout = this.loadouts.get(client.sessionId);
      if (!player || !loadout || !this.state.started || loadout.reloadingWeapon) return;

      this._applyLoadoutToPlayer(player, loadout);
      const result = handleFireWeapon(player, this.state.entities, this.state.players, {
        roomState: this.state,
        fireInput: data,
      });
      if (!result) return;

      if (loadout.weapons[player.weapon]) {
        loadout.weapons[player.weapon].ammo = Math.max(0, player.ammo);
      }
      client.send("loadoutState", this._serializeLoadout(loadout));

      if (result.projectile) {
        const proj = result.projectile;
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
            });
            continue;
          }

          victim.health = Math.max(0, victim.health - damage);
          const attacker = this.state.players.get(hit.ownerId || player.id);

          if (victim.health === 0) {
            if (attacker) attacker.score += 1;
            this.broadcast("playerKilled", {
              attackerId: attacker?.id || "",
              attackerName: attacker?.name || "Unknown",
              victimId: victim.id,
              victimName: victim.name,
              weapon: hit.subType || "swatter",
            });
            if (attacker && attacker.score >= this.state.scoreLimit) {
              this._endMatch(attacker);
            }
            this._resetPlayerPose(victim, this.getSpawnPoint(Math.floor(Math.random() * 8)));
            victim.health = 100;
          }

          this.broadcast("projectileHit", {
            projectileId: "",
            victimId: victim.id,
            attackerId: hit.ownerId || player.id,
            subType: hit.subType || "swatter",
            damage,
            remainingHealth: victim.health,
            effect: hit.effectApplied?.type || hit.subType || "swatter",
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

    this.onMessage("debugTeleport", (client, data = {}) => {
      if (!this._allowDebugControls) return;
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const yaw = Number.isFinite(Number(data.yaw)) ? Number(data.yaw) : player.heading;
      this._resetPlayerPose(player, {
        x: Number(data.x || 0),
        y: Number(data.y || 2.5),
        z: Number(data.z || 0),
        yaw,
      });
    });

    this.setSimulationInterval((deltaTime) => this.update(deltaTime), TICK_RATE);
    log("info", "room_create", {
      room: "fps_arena",
      roomId: this.roomId,
      scoreLimit: state.scoreLimit,
      maxClients: this.maxClients,
      patchRateMs: syncConfig.patchRateMs,
      authoritative: true,
    });
  }

  onJoin(client, options = {}) {
    const player = new PlayerState();
    player.id = client.sessionId;
    player.name = options.playerName || `Player_${client.sessionId.slice(0, 4)}`;
    player.team = "solo";
    player.health = 100;

    const spawn = this.getSpawnPoint(this.state.players.size);
    this._resetPlayerPose(player, spawn);

    const loadout = createLoadoutState();
    this.loadouts.set(client.sessionId, loadout);
    this._applyLoadoutToPlayer(player, loadout);

    this.state.players.set(client.sessionId, player);
    this.inputBySession.set(client.sessionId, parseFpsInput({ yaw: spawn.yaw }));

    client.send("joined", {
      sessionId: client.sessionId,
      room: this.roomId,
      mode: "fps_arena",
      sync: getRealtimeJoinPayload(this),
    });
    client.send("loadoutState", this._serializeLoadout(loadout));

    if (this.state.started) {
      const serverNow = Date.now();
      client.send("startSequence", { durationMs: 0, startAt: serverNow, serverNow });
      client.send("matchLive", { startedAt: serverNow });
    } else if (this.countdownActive) {
      const remaining = Math.max(0, this._countdownStartAt - Date.now());
      const serverNow = Date.now();
      client.send("startSequence", { durationMs: remaining, startAt: serverNow + remaining, serverNow });
    }
  }

  onLeave(client) {
    this.state.players.delete(client.sessionId);
    this.inputBySession.delete(client.sessionId);
    this.loadouts.delete(client.sessionId);
    this._rateLimiter.removeClient(client.sessionId);
  }

  getSpawnPoint(index = 0) {
    return getDefaultFpsSpawn(index);
  }

  update(deltaTime) {
    const now = Date.now();
    this.state.serverTime = now;
    noteRealtimeTick(this, deltaTime, now);

    this.state.players.forEach((player, sessionId) => {
      const input = this.inputBySession.get(sessionId);
      if (!this.state.started || !input) return;

      let effectiveInput = input;
      if (now - Number(input.receivedAt || 0) > this.staleInputMs) {
        noteRejectedInput(this, "stale");
        effectiveInput = { ...input, moveX: 0, moveY: 0, sprint: false, jump: false };
      }

      this._stepPlayer(player, effectiveInput, deltaTime);
      noteProcessedInput(this, input, now);
    });

    const endedArenaEffect = tickArenaEffects(this.state, this.state.players, deltaTime);
    if (endedArenaEffect) {
      this.broadcast("arenaEffectCleared", { type: endedArenaEffect });
    }

    this._tickReloads(now);

    const hits = tickProjectiles(this.state.entities, this.state.players, deltaTime);
    for (const { projectile, victim, shieldAbsorbed, effectApplied, damage } of hits) {
      if (shieldAbsorbed) {
        this.broadcast("shieldAbsorbed", {
          projectileId: projectile.id,
          victimId: victim.id,
        });
        continue;
      }

      const appliedDamage = Math.max(0, Number(damage ?? projectile.damage ?? 0));
      victim.health = Math.max(0, victim.health - appliedDamage);
      const attacker = this.state.players.get(projectile.ownerId);

      if (victim.health === 0) {
        if (attacker) attacker.score += 1;
        this.broadcast("playerKilled", {
          attackerId: attacker?.id || "",
          attackerName: attacker?.name || "Unknown",
          victimId: victim.id,
          victimName: victim.name,
          weapon: projectile.subType,
        });
        if (attacker && attacker.score >= this.state.scoreLimit) {
          this._endMatch(attacker);
        }
        this._resetPlayerPose(victim, this.getSpawnPoint(Math.floor(Math.random() * 8)));
        victim.health = 100;
      }

      this.broadcast("projectileHit", {
        projectileId: projectile.id,
        victimId: victim.id,
        attackerId: projectile.ownerId,
        subType: projectile.subType,
        damage: appliedDamage,
        remainingHealth: victim.health,
        effect: projectile.subType,
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

  _beginCountdown() {
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
  }

  _tickReloads(now) {
    for (const [sessionId, loadout] of this.loadouts.entries()) {
      if (!loadout.reloadingWeapon || now < loadout.reloadEndsAt) continue;
      const slot = loadout.weapons[loadout.reloadingWeapon];
      const player = this.state.players.get(sessionId);
      if (slot) slot.ammo = slot.maxAmmo;
      if (player) this._applyLoadoutToPlayer(player, loadout);
      const client = this.clients.find((entry) => entry.sessionId === sessionId);
      client?.send("weaponReloaded", { weaponId: loadout.reloadingWeapon, ammo: slot?.ammo || 0 });
      client?.send("loadoutState", this._serializeLoadout(loadout));
      loadout.reloadingWeapon = "";
      loadout.reloadEndsAt = 0;
    }
  }

  _applyLoadoutToPlayer(player, loadout) {
    const slot = loadout.weapons[loadout.currentWeapon];
    player.weapon = loadout.currentWeapon;
    player.ammo = slot?.ammo || 0;
    if (loadout.reloadingWeapon === player.weapon) {
      player.fireCooldown = Math.max(player.fireCooldown, (loadout.reloadEndsAt || 0) - Date.now());
    }
  }

  _serializeLoadout(loadout) {
    return {
      currentWeapon: loadout.currentWeapon,
      reloadingWeapon: loadout.reloadingWeapon,
      reloadEndsAt: loadout.reloadEndsAt,
      weapons: Object.fromEntries(
        Object.entries(loadout.weapons).map(([weaponId, slot]) => [weaponId, { ...slot }]),
      ),
    };
  }

  _endMatch(attacker) {
    if (!this.state.started) return;
    const standings = [];
    this.state.players.forEach((p) => standings.push({ sessionId: p.id, name: p.name, score: p.score }));
    standings.sort((a, b) => b.score - a.score);
    this.broadcast("matchEnd", {
      mode: "fps_arena",
      gameType: "deathmatch",
      winner: attacker.name,
      winnerId: attacker.id,
      winReason: `${attacker.score} eliminations`,
      standings,
      metrics: getRealtimeMetricsSnapshot(this),
    });
    this.state.started = false;
  }

  _resetPlayerPose(player, spawn) {
    player.x = spawn.x;
    player.y = spawn.y;
    player.z = spawn.z;
    player.vx = 0;
    player.vy = 0;
    player.vz = 0;
    const q = normalizeQuaternion(0, Math.sin((spawn.yaw || 0) * 0.5), 0, Math.cos((spawn.yaw || 0) * 0.5));
    player.rx = q.rx;
    player.ry = q.ry;
    player.rz = q.rz;
    player.rw = q.rw;
    player.heading = spawn.yaw || 0;
  }

  _stepPlayer(player, input, deltaTime) {
    const dt = Math.max(0.001, deltaTime / 1000);
    const yaw = Number.isFinite(input.yaw) ? normalizeAngle(input.yaw) : player.heading;
    const magnitude = Math.hypot(input.moveX, input.moveY);
    const moveX = magnitude > 0 ? input.moveX / magnitude : 0;
    const moveY = magnitude > 0 ? input.moveY / magnitude : 0;
    const desiredSpeed = input.sprint ? SPRINT_SPEED : MOVE_SPEED;
    const forwardX = Math.sin(yaw);
    const forwardZ = Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const desiredVx = (forwardX * moveY + rightX * moveX) * desiredSpeed;
    const desiredVz = (forwardZ * moveY + rightZ * moveX) * desiredSpeed;
    const groundY = getArenaGroundHeight(player.x, player.z) + PLAYER_HEIGHT * 0.5;
    const grounded = player.y <= groundY + 0.08;
    const accel = grounded ? GROUND_ACCEL : AIR_ACCEL;
    player.vx += (desiredVx - player.vx) * Math.min(1, accel * dt);
    player.vz += (desiredVz - player.vz) * Math.min(1, accel * dt);

    if (grounded) {
      player.y = groundY;
      if (player.vy < 0) player.vy = 0;
      if (input.jump) player.vy = JUMP_VELOCITY;
    } else {
      player.vy -= GRAVITY * dt;
    }

    let nextX = player.x + player.vx * dt;
    let nextZ = player.z + player.vz * dt;
    let nextY = player.y + player.vy * dt;

    const resolvedX = this._resolveAxis(nextX, player.z, nextY, "x");
    if (resolvedX !== nextX) player.vx = 0;
    nextX = resolvedX;
    const resolvedZ = this._resolveAxis(nextX, nextZ, nextY, "z");
    if (resolvedZ !== nextZ) player.vz = 0;
    nextZ = resolvedZ;

    const nextGroundY = getArenaGroundHeight(nextX, nextZ) + PLAYER_HEIGHT * 0.5;
    if (nextY <= nextGroundY) {
      nextY = nextGroundY;
      if (player.vy < 0) player.vy = 0;
    }

    const sanitized = sanitizePosition(
      { x: player.x, y: player.y, z: player.z },
      { x: nextX, y: nextY, z: nextZ },
    );
    player.x = sanitized?.x ?? player.x;
    player.y = sanitized?.y ?? player.y;
    player.z = sanitized?.z ?? player.z;
    const q = normalizeQuaternion(0, Math.sin(yaw * 0.5), 0, Math.cos(yaw * 0.5));
    player.rx = q.rx;
    player.ry = q.ry;
    player.rz = q.rz;
    player.rw = q.rw;
    player.heading = yaw;
  }

  _resolveAxis(nextX, nextZ, nextY, axis) {
    const halfHeight = PLAYER_HEIGHT * 0.5;
    const footY = nextY - halfHeight;
    const headY = nextY + halfHeight;
    let resolved = axis === "x" ? nextX : nextZ;

    for (const box of this._collisionBoxes) {
      if (headY <= box.minY || footY >= box.maxY) continue;
      const currentX = axis === "x" ? resolved : nextX;
      const currentZ = axis === "z" ? resolved : nextZ;
      if (currentX + PLAYER_RADIUS <= box.minX || currentX - PLAYER_RADIUS >= box.maxX) continue;
      if (currentZ + PLAYER_RADIUS <= box.minZ || currentZ - PLAYER_RADIUS >= box.maxZ) continue;

      if (axis === "x") {
        const pushLeft = Math.abs((currentX + PLAYER_RADIUS) - box.minX);
        const pushRight = Math.abs(box.maxX - (currentX - PLAYER_RADIUS));
        resolved = pushLeft < pushRight ? box.minX - PLAYER_RADIUS : box.maxX + PLAYER_RADIUS;
      } else {
        const pushBack = Math.abs((currentZ + PLAYER_RADIUS) - box.minZ);
        const pushForward = Math.abs(box.maxZ - (currentZ - PLAYER_RADIUS));
        resolved = pushBack < pushForward ? box.minZ - PLAYER_RADIUS : box.maxZ + PLAYER_RADIUS;
      }
    }

    return resolved;
  }
}
