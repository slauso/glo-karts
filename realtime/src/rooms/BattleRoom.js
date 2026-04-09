import { Room } from "@colyseus/core";
import { BattleState } from "../schema/BattleState.js";
import { PlayerState } from "../schema/PlayerState.js";
import { EntityState } from "../schema/EntityState.js";
import { BATTLE_WEAPON_POOL, WEAPONS, grantWeapon, handleFireWeapon, swapSecondaryWeapon, tickArenaEffects, tickProjectiles, tickOverheat } from "../combat.js";
import { RateLimiter, sanitizePosition, isWithinPickupRangeWithClientPosition, isValidProjectileOrigin } from "../server-guard.js";
import { log } from "../logger.js";
import {
  applyAuthoritativeKartStep,
  applyRealtimeTransform,
  buildRealtimeInput,
  configureRealtimeRoom,
  getRealtimeControlInput,
  getRealtimeCountdownMs,
  getSimulationIntervalMs,
  isRealtimeInputFresh,
  initializeAuthoritativeKart,
  noteProcessedInput,
  noteRealtimeTick,
  noteRealtimeAnomalyEvent,
  noteRejectedInput,
  REALTIME_SYNC_DEFAULTS,
  resolveAuthoritativeKartContacts,
  storeLatestRealtimeInput,
} from "../realtime-sync.js";

const TICK_RATE = getSimulationIntervalMs();
const ANOMALY_WEAPONS = new Set(["pirateleportation", "mirror_realm", "phase_shift", "memory_leak", "gravity_well", "weather_dominion"]);
const ANOMALY_EFFECTS = new Set(["mirror", "phase_shift_swap", "memory_leak", "arena_fog", "arena_rain"]);
const ARENA_SURFACE_Y = {
  test_box: 0.6,
  glo_arena: 0.35,
};
const CUSTOM_TRACK_ID = "custom_import";
const DEFAULT_BATTLE_TRACK = "glo_arena";
const DEFAULT_LOADOUT_ID = "classic";

function parseCustomTrackData(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

function normalizeCustomSpawn(spawn) {
  if (!spawn) return null;
  const position = spawn.position && typeof spawn.position === "object"
    ? spawn.position
    : spawn;
  const x = Number(position.x);
  const y = Number(position.y ?? 0);
  const z = Number(position.z);
  if (![x, y, z].every(Number.isFinite)) return null;
  const heading = Number(spawn.heading);
  return {
    x,
    y,
    z,
    heading: Number.isFinite(heading) ? heading : undefined,
  };
}

function normalizeCustomObstacle(obstacle) {
  if (!obstacle?.position || typeof obstacle.position !== "object") return null;
  const x = Number(obstacle.position.x);
  const y = Number(obstacle.position.y ?? 0);
  const z = Number(obstacle.position.z);
  if (![x, y, z].every(Number.isFinite)) return null;
  return { x, y, z };
}

function normalizeBattleGameType(value) {
  const normalized = String(value || "deathmatch").trim().toLowerCase();
  if (normalized === "ctf" || normalized === "capture_the_flag") return "ctf";
  if (normalized === "balloon" || normalized === "last_kart_standing") return "balloon";
  return "deathmatch";
}

export class BattleRoom extends Room {
  onCreate(options = {}) {
    const state = new BattleState();
    state.gameType = normalizeBattleGameType(options.gameType || options.battleType);
    state.trackId = String(options.trackId || DEFAULT_BATTLE_TRACK);
    state.loadoutId = String(options.loadoutId || DEFAULT_LOADOUT_ID);
    state.botCount = Math.max(0, Number(options.botCount || 0));
    state.scoreLimit = Number(options.scoreLimit || 5);
    this.setState(state);
    const customPool = Array.isArray(options.weaponPool)
      ? [...new Set(options.weaponPool.map((weaponId) => String(weaponId || "").trim()).filter((weaponId) => BATTLE_WEAPON_POOL.includes(weaponId)))]
      : [];
    this._weaponPool = customPool.length ? customPool : BATTLE_WEAPON_POOL;

    const syncConfig = configureRealtimeRoom(this, options, { authoritative: true });
    this.inputBySession = new Map();
    this.countdownActive = false;
    this.staleInputMs = syncConfig.staleInputMs || REALTIME_SYNC_DEFAULTS.staleInputMs;
    this.countdownDurationMs = getRealtimeCountdownMs(options);
    this._countdownTimer = null;
    this._matchEnded = false;
    this._joinedAtBySession = new Map();
    this._hostSessionId = null;
    // Task 2.2: per-client rate limiter
    this._rateLimiter = new RateLimiter();
    this._allowDebugControls = process.env.NODE_ENV !== "production";
    this._customArenaData = state.trackId === CUSTOM_TRACK_ID
      ? parseCustomTrackData(options.customTrackData)
      : null;
    this._customSpawnPoints = Array.isArray(this._customArenaData?.startPositions)
      ? this._customArenaData.startPositions.map(normalizeCustomSpawn).filter(Boolean)
      : [];
    this._customItemBoxPositions = Array.isArray(this._customArenaData?.obstacles)
      ? this._customArenaData.obstacles
          .filter((obstacle) => String(obstacle?.type || "") === "item_box")
          .map(normalizeCustomObstacle)
          .filter(Boolean)
      : [];

    state.syncPatchRateMs = Number(syncConfig.patchRateMs || 0);
    state.syncSimulationHz = Number(syncConfig.simulationHz || 0);
    state.syncStaleInputMs = Number(syncConfig.staleInputMs || 0);
    state.syncInterpolationBaseDelayMs = Number(syncConfig.interpolationBaseDelayMs || 0);
    state.syncAuthoritative = !!syncConfig.authoritative;
    state.countdownDurationMs = this.countdownDurationMs;
    this._refreshReadyState();

    // Arena-specific spawn Y height (default 2.5 for glo_arena/test_box)
    this._spawnY = this._customSpawnPoints[0]?.y ?? ARENA_SURFACE_Y[state.trackId] ?? 1.0;
    this._positionGuardHalf = 49.5;
    if (this._customArenaData?.bounds?.min && this._customArenaData?.bounds?.max) {
      const spanX = Math.abs(Number(this._customArenaData.bounds.max.x) - Number(this._customArenaData.bounds.min.x));
      const spanZ = Math.abs(Number(this._customArenaData.bounds.max.z) - Number(this._customArenaData.bounds.min.z));
      const customHalf = Math.max(spanX, spanZ) * 0.5 + 12;
      if (Number.isFinite(customHalf)) {
        this._positionGuardHalf = Math.max(this._positionGuardHalf, customHalf);
      }
    }

    // Phase 21 Block C: respawn invulnerability + kill tracking
    this._invulnUntil = new Map();
    this._killStreaks = new Map();
    this._lastKilledBy = new Map();
    this._firstBloodDone = false;
    this._kartCrashCooldownUntil = new Map();

    this.onMessage("triggerStart", () => {
      if (this._matchEnded) this._resetForRematch("triggerStart");
      this._evaluateCountdownStart("triggerStart");
    });

    this.onMessage("start", () => {
      if (this._matchEnded) this._resetForRematch("start");
      this._evaluateCountdownStart("start");
    });

    this.onMessage("settingsUpdate", (client, data = {}) => {
      if (!client || client.sessionId !== this._hostSessionId) return;
      if (this.state.started || this.countdownActive) return;

      const nextTrackId = String(data.trackId || this.state.trackId || DEFAULT_BATTLE_TRACK);
      this.state.trackId = nextTrackId;
      this.state.gameType = normalizeBattleGameType(data.gameType || data.battleType || this.state.gameType);
      this.state.scoreLimit = Math.min(Math.max(Number(data.scoreLimit) || this.state.scoreLimit || 5, 1), 50);
      this.state.loadoutId = String(data.loadoutId || this.state.loadoutId || DEFAULT_LOADOUT_ID);
      this.state.botCount = Math.min(Math.max(Number(data.botCount) || 0, 0), 10);
      this._spawnY = this._customSpawnPoints[0]?.y ?? ARENA_SURFACE_Y[nextTrackId] ?? this._spawnY;

      if (Array.isArray(data.weaponPool) && this.state.loadoutId === "custom") {
        const sanitizedPool = [...new Set(
          data.weaponPool
            .map((weaponId) => String(weaponId || "").trim())
            .filter((weaponId) => BATTLE_WEAPON_POOL.includes(weaponId))
        )];
        this._weaponPool = sanitizedPool.length ? sanitizedPool : BATTLE_WEAPON_POOL;
      } else if (this.state.loadoutId !== "custom") {
        this._weaponPool = BATTLE_WEAPON_POOL;
      }
    });

    const markClientReady = (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || this.state.started || this._matchEnded) return;
      if (!player.ready) {
        player.ready = true;
        player.readyAt = Date.now();
        log('info', 'battle_ready', {
          room: 'battle_room',
          roomId: this.roomId,
          sessionId: client.sessionId,
          readyCount: this.state.readyCount,
          players: this.state.players.size,
        });
      }
      this._refreshReadyState();
      this._evaluateCountdownStart("clientReady");
    };

    this.onMessage("clientReady", markClientReady);
    this.onMessage("ready", markClientReady);

    this.onMessage("input", (client, data) => {
      // Task 2.2: rate-limit input messages
      if (!this._rateLimiter.allow(client.sessionId, "input")) return;
      const accepted = storeLatestRealtimeInput(this.inputBySession, client.sessionId, buildRealtimeInput(data));
      if (!accepted) noteRejectedInput(this, "out_of_order");
    });

    // Task 1.3: Server-authoritative damage — ignore client-supplied damage values.
    // Only accept weapon sub-type to look up canonical damage from the WEAPONS catalogue.
    this.onMessage("hit", (client, data) => {
      // Active battle damage is authoritative from tickProjectiles / kartCrash.
      // Keep the legacy channel inert so clients cannot inject arbitrary hits.
      if (!this._rateLimiter.allow(client.sessionId, "hit")) return;
    });

    this.onMessage("pickupItem", (client, data) => {
        // Task 2.2 + 2.3: rate-limit and proximity-validate pickups
        if (!this._rateLimiter.allow(client.sessionId, "pickupItem")) return;
        this._handlePickupItem(client, data);
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

        const slot = data.slot === "secondary" ? "secondary" : "primary";
        const result = handleFireWeapon(player, this.state.entities, this.state.players, {
          roomState: this.state,
          fireInput: data,
          slot,
        });
        if (!result) return;

        if (result.projectile) {
            const proj = result.projectile;
            // Task 2.3.4: Verify projectile spawn is near owner's authoritative position
            if (!isValidProjectileOrigin(player, proj)) {
                this.state.entities.delete(proj.id);
                return;
            }
          if (ANOMALY_WEAPONS.has(proj.subType)) {
            noteRealtimeAnomalyEvent(this, "anomalyProjectilesFired");
          }
            this.broadcast("projectileFired", {
                id: proj.id,
                subType: proj.subType,
                ownerId: proj.ownerId,
                x: proj.x, y: proj.y, z: proj.z,
                vx: proj.vx, vy: proj.vy, vz: proj.vz,
                targetId: proj.targetId || "",
                lifespan: proj.lifespan || 0,
                spread: 1 + Number(result.extraProjectiles?.length || 0),
            });
            if (Array.isArray(result.extraProjectiles)) {
              for (const extraProj of result.extraProjectiles) {
                this.broadcast("projectileFired", {
                  id: extraProj.id,
                  subType: extraProj.subType,
                  ownerId: extraProj.ownerId,
                  x: extraProj.x, y: extraProj.y, z: extraProj.z,
                  vx: extraProj.vx, vy: extraProj.vy, vz: extraProj.vz,
                  targetId: extraProj.targetId || "",
                  lifespan: extraProj.lifespan || 0,
                  spread: 1 + Number(result.extraProjectiles.length),
                });
              }
            }
        }
        if (result.effectApplied) {
            if (result.effectApplied.target === "arena") {
              noteRealtimeAnomalyEvent(this, "arenaEffectsApplied");
            }
            if (ANOMALY_EFFECTS.has(result.effectApplied.type) || result.effectApplied.target === "arena") {
              noteRealtimeAnomalyEvent(this, "anomalyEffectsApplied");
            }
            this.broadcast("effectApplied", result.effectApplied);
          if (result.effectApplied.target === "arena") {
            this.broadcast("arenaEffectApplied", result.effectApplied);
          }
        }
        if (Array.isArray(result.instantHits)) {
          for (const hit of result.instantHits) {
            this._resolveCombatHit({
              projectileId: hit.projectileId || "",
              ownerId: hit.ownerId || player.id,
              subType: hit.subType || data.weaponId || "unknown",
              victim: hit.victim,
              shieldAbsorbed: false,
              effectApplied: hit.effectApplied,
              hitPoint: hit.hitPoint,
              damage: hit.damage,
            });
          }
        }
    });

    this.onMessage("debugGrantWeapon", (client, data = {}) => {
      if (!this._allowDebugControls) return;
      const targetId = String(data.targetId || client.sessionId);
      const weaponId = String(data.weaponId || "");
      const target = this.state.players.get(targetId);
      const weaponDef = WEAPONS[weaponId];
      if (!target || !weaponDef) return;

      target.weapon2 = weaponId;
      target.ammo2 = Number.isFinite(Number(data.ammo)) ? Math.max(1, Number(data.ammo)) : weaponDef.ammo;
      target.fireCooldown2 = 0;

      const targetClient = this.clients.find((entry) => entry.sessionId === targetId);
      targetClient?.send("itemReceived", {
        slot: "secondary",
        weapon: weaponId,
        ammo: target.ammo2,
        category: weaponDef.category,
        cooldownMs: weaponDef.cooldown || 0,
        effect: weaponDef.effect || '',
        description: weaponDef.desc || '',
      });
    });

    this.onMessage("debugTeleport", (client, data = {}) => {
      if (!this._allowDebugControls) return;
      const targetId = String(data.targetId || client.sessionId);
      const target = this.state.players.get(targetId);
      if (!target) return;

      initializeAuthoritativeKart(target, {
        x: Number(data.x || 0),
        y: Number(data.y || 2.5),
        z: Number(data.z || 0),
        heading: Number.isFinite(Number(data.heading)) ? Number(data.heading) : 0,
      });
    });

    this.setSimulationInterval((deltaTime) => this.update(deltaTime), TICK_RATE);
    console.log(`[battle_room] created roomId=${this.roomId} gameType=${state.gameType} scoreLimit=${state.scoreLimit} maxClients=${this.maxClients} patchRateMs=${Math.round(syncConfig.patchRateMs)}`);
    log('info', 'room_create', {
      room: 'battle_room',
      roomId: this.roomId,
      gameType: state.gameType,
      scoreLimit: state.scoreLimit,
      maxClients: this.maxClients,
      patchRateMs: syncConfig.patchRateMs,
      staleInputMs: this.staleInputMs,
      authoritative: true,
    });
    
    this.spawnItemBoxes();
  }

  _handlePickupItem(client, data = {}) {
    const entityId = data.entityId;
    const itemBox = this.state.entities.get(entityId);
    const player = this.state.players.get(client.sessionId);
    const pickupPosition = Number.isFinite(Number(data.x)) && Number.isFinite(Number(data.y)) && Number.isFinite(Number(data.z))
      ? { x: Number(data.x), y: Number(data.y), z: Number(data.z) }
      : null;

    if (!itemBox || itemBox.type !== "item_box" || !itemBox.active || !player) return null;
    if (!isWithinPickupRangeWithClientPosition(player, itemBox, pickupPosition)) return null;

    const hasRoom = (!player.weapon2 || player.ammo2 <= 0) || (!player.weapon3 || player.ammo3 <= 0);
    if (!hasRoom) return null;

    itemBox.active = false;
    itemBox.respawnTimer = 10000;

    const slot = (player.weapon2 && player.ammo2 > 0) ? "reserve" : "secondary";
    const rolled = grantWeapon(player, 0.5, { pool: this._weaponPool });
    const weaponDef = WEAPONS[rolled];
    const payload = {
      slot,
      weapon: rolled,
      ammo: slot === "reserve" ? player.ammo3 : player.ammo2,
      category: weaponDef?.category || "unknown",
      cooldownMs: weaponDef?.cooldown || 0,
      effect: weaponDef?.effect || "",
      description: weaponDef?.desc || "",
      reserve: { weapon: player.weapon3 || "", ammo: player.ammo3 || 0 },
    };

    client.send("itemReceived", payload);
    return payload;
  }

  _checkDeathmatchWin(attacker) {
    if (!this.state.started) return;
    if (attacker.score >= this.state.scoreLimit) {
      this._matchEnded = true;
      this._cancelCountdown("matchEnd");
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
      log('info', 'match_end', { room: 'battle_room', roomId: this.roomId, gameType: this.state.gameType, winner: attacker.name });
      console.log(`[battle_room] deathmatch won by ${attacker.name} (${attacker.score} kills)`);
    }
  }

  _checkBalloonWin() {
    if (!this.state.started || this.state.gameType !== 'balloon') return;
    let aliveCount = 0;
    let lastAlive = null;
    this.state.players.forEach((p) => {
      if (p.lives > 0) { aliveCount++; lastAlive = p; }
    });
    if (aliveCount <= 1 && lastAlive) {
      this._matchEnded = true;
      this._cancelCountdown("matchEnd");
      const standings = [];
      this.state.players.forEach((p) => {
        standings.push({ sessionId: p.id, name: p.name, score: p.score, team: p.team, lives: p.lives });
      });
      standings.sort((a, b) => b.lives - a.lives || b.score - a.score);
      this.broadcast("matchEnd", {
        mode: "battle", gameType: "balloon",
        winner: lastAlive.name, winnerId: lastAlive.id,
        winReason: "Last kart standing!",
        standings,
      });
      this.state.started = false;
      log('info', 'match_end', { room: 'battle_room', roomId: this.roomId, gameType: 'balloon', winner: lastAlive.name });
      console.log(`[battle_room] balloon mode won by ${lastAlive.name}`);
    }
  }

  _getKartCrashKey(playerAId, playerBId) {
    return [playerAId, playerBId].sort().join(":");
  }

  _applyBattleDamage(victim, damage, context = {}) {
    const amount = Math.max(0, Number(damage) || 0);
    const attacker = context.attackerId ? this.state.players.get(context.attackerId) : null;
    if (!victim || amount <= 0 || !this.state.started) {
      return { applied: false, attacker, remainingHealth: Number(victim?.health || 0) };
    }

    if (!context.ignoreInvulnerability && Date.now() < (this._invulnUntil.get(victim.id) || 0)) {
      return {
        applied: false,
        attacker,
        remainingHealth: Number(victim.health || 0),
        invulnerable: true,
      };
    }

    victim.health = Math.max(0, victim.health - amount);
    const remainingHealth = victim.health;
    if (remainingHealth > 0) {
      return { applied: true, attacker, remainingHealth, killed: false };
    }

    if (attacker && attacker.id !== victim.id) {
      attacker.score += 1;
    }
    victim.deaths += 1;
    this._invulnUntil.set(victim.id, Date.now() + 2000);
    victim.weapon = "";
    victim.ammo = 0;
    victim.weapon2 = "";
    victim.ammo2 = 0;
    victim.fireCooldown2 = 0;
    victim.weapon3 = "";
    victim.ammo3 = 0;
    if (this.state.gameType === "balloon") {
      victim.lives = Math.max(0, victim.lives - 1);
    }

    const spawn = this.getSpawnPoint(this.state.players.size, Math.floor(Math.random() * 12));
    initializeAuthoritativeKart(victim, spawn);
    victim.health = 100;
    victim.weapon = "glo_burst";
    victim.ammo = WEAPONS.glo_burst.ammo;
    victim.fireCooldown = 0;
    victim.overheat = 0;
    victim.overheated = false;

    const isFirstBlood = !this._firstBloodDone;
    if (isFirstBlood) this._firstBloodDone = true;
    const now = Date.now();
    let multiKill = 1;
    if (attacker && attacker.id !== victim.id) {
      const streak = this._killStreaks.get(attacker.id);
      if (streak && now - streak.lastKillAt < 5000) {
        streak.count += 1;
        streak.lastKillAt = now;
        multiKill = streak.count;
      } else {
        this._killStreaks.set(attacker.id, { count: 1, lastKillAt: now });
      }
    }
    const isRevenge = attacker ? this._lastKilledBy.get(attacker.id) === victim.id : false;
    if (attacker) this._lastKilledBy.set(victim.id, attacker.id);

    this.broadcast("playerKilled", {
      attackerId: attacker?.id || "",
      attackerName: attacker?.name || "Arena",
      victimId: victim.id,
      victimName: victim.name,
      weapon: context.weapon || "unknown",
      isFirstBlood,
      multiKill,
      isRevenge,
    });
    this.broadcast("playerDied", {
      victimId: victim.id,
      attackerId: attacker?.id || "",
      attackerName: attacker?.name || "Arena",
      weapon: context.weapon || "unknown",
      spawnX: spawn.x,
      spawnY: spawn.y,
      spawnZ: spawn.z,
    });

    if (this.state.gameType === "balloon" && victim.lives <= 0) {
      this.broadcast("playerEliminated", { playerId: victim.id, playerName: victim.name });
    }

    if (this.state.gameType === "ctf" && attacker) {
      if (attacker.team === "red") this.state.redScore += 1;
      else this.state.blueScore += 1;
    } else if (this.state.gameType === "balloon") {
      this._checkBalloonWin();
    } else if (attacker) {
      this._checkDeathmatchWin(attacker);
    }

    return { applied: true, attacker, remainingHealth, killed: true };
  }

  _resolveCombatHit(hit = {}) {
    const victim = hit.victim;
    const projectileId = String(hit.projectileId || hit.projectile?.id || "");
    const attackerId = String(hit.ownerId || hit.projectile?.ownerId || "");
    const subType = String(hit.subType || hit.projectile?.subType || "unknown");
    const amount = Math.max(0, Number(hit.damage ?? hit.projectile?.damage ?? 0));
    const hitPoint = hit.hitPoint;
    if (!victim) return { applied: false };

    if (hit.shieldAbsorbed) {
      this.broadcast("shieldAbsorbed", {
        projectileId,
        victimId: victim.id,
        attackerId,
        subType,
        shieldHP: hit.shieldHP ?? 0,
        shieldBroken: (hit.shieldHP ?? 0) <= 0,
        hitX: hitPoint?.x,
        hitY: hitPoint?.y,
        hitZ: hitPoint?.z,
      });
      return { applied: false, shieldAbsorbed: true };
    }

    const damageResult = this._applyBattleDamage(victim, amount, {
      attackerId,
      weapon: subType,
    });
    if (!damageResult.applied) return damageResult;

    this.broadcast("projectileHit", {
      projectileId,
      victimId: victim.id,
      attackerId,
      subType,
      damage: amount,
      remainingHealth: damageResult.remainingHealth,
      effect: hit.effectApplied?.type || subType,
      hitX: hitPoint?.x,
      hitY: hitPoint?.y,
      hitZ: hitPoint?.z,
    });
    if (ANOMALY_WEAPONS.has(subType)) {
      noteRealtimeAnomalyEvent(this, "anomalyProjectileHits");
    }
    if (hit.effectApplied?.type) {
      if (ANOMALY_EFFECTS.has(hit.effectApplied.type)) {
        noteRealtimeAnomalyEvent(this, "anomalyEffectsApplied");
      }
      this.broadcast("effectApplied", {
        type: hit.effectApplied.type,
        target: victim.id,
        attackerId,
        duration: hit.effectApplied.duration,
      });
    }
    return damageResult;
  }
  
  spawnItemBoxes() {
    // Custom builder arenas should only receive authored pickup boxes.
    const positions = this.state.trackId === CUSTOM_TRACK_ID
      ? this._customItemBoxPositions
      : [
          { x:  20, z:   0 }, { x: -20, z:   0 },
          { x:   0, z:  20 }, { x:   0, z: -20 },
          { x:  15, z:  15 }, { x: -15, z:  15 },
          { x:  15, z: -15 }, { x: -15, z: -15 },
        ];
    if (!positions.length) return;
    positions.forEach((pos, i) => {
      const id = `box_${i}`;
      const box = new EntityState();
      box.id = id;
      box.type = "item_box";
      box.active = true;
      box.x = pos.x;
      box.y = Number.isFinite(pos.y) ? pos.y : this._spawnY + 0.9;
      box.z = pos.z;
      this.state.entities.set(id, box);
    });
  }

  onJoin(client, options = {}) {
    if (!this._hostSessionId || options.isHost) {
      this._hostSessionId = client.sessionId;
    }

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
    p.ready = !!this.state.started;
    p.readyAt = p.ready ? Date.now() : 0;

    const spawn = this.getSpawnPoint(this.maxClients, idx);
    initializeAuthoritativeKart(p, spawn);

    // Grant glo_burst as primary weapon (always active)
    const gloBurst = WEAPONS.glo_burst;
    p.weapon = "glo_burst";
    p.ammo = gloBurst.ammo;
    p.fireCooldown = 0;
    p.overheat = 0;
    p.overheated = false;
    // Secondary slot starts empty
    p.weapon2 = "";
    p.ammo2 = 0;
    p.fireCooldown2 = 0;
    p.weapon3 = "";
    p.ammo3 = 0;

    this.state.players.set(client.sessionId, p);
    this._joinedAtBySession.set(client.sessionId, Date.now());
    this._refreshReadyState();
    if (!this.state.started) {
      this._evaluateCountdownStart("join");
    }
    console.log(`[battle_room] join sessionId=${client.sessionId} name=${p.name} team=${p.team} players=${this.state.players.size}`);
    log('info', 'room_join', { room: 'battle_room', roomId: this.roomId, sessionId: client.sessionId, name: p.name, players: this.state.players.size });

    setTimeout(() => {
      if (!this.state.players.has(client.sessionId)) return;

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
    }, 0);
  }

  onLeave(client) {
    const wasHost = client.sessionId === this._hostSessionId;
    this._joinedAtBySession.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.inputBySession.delete(client.sessionId);
    this._rateLimiter.removeClient(client.sessionId);
    this._refreshReadyState();
    if (!this.state.started) {
      this._evaluateCountdownStart("leave");
    }
    if (wasHost) {
      this._hostSessionId = this.clients[0]?.sessionId || null;
    }
    log('info', 'room_leave', { room: 'battle_room', roomId: this.roomId, sessionId: client.sessionId, players: this.state.players.size });
    console.log(`[battle_room] leave sessionId=${client.sessionId} players=${this.state.players.size}`);
  }

  _getMinReadyPlayers() {
    return this.maxClients > 1 ? 2 : 1;
  }

  _resetForRematch(reason = "rematch") {
    const now = Date.now();
    this._cancelCountdown(`reset:${reason}`);
    this._matchEnded = false;
    this.state.started = false;
    this.countdownActive = false;
    this.state.countdownActive = false;
    this.state.countdownStartAt = 0;
    this._countdownStartAt = 0;
    this.state.redScore = 0;
    this.state.blueScore = 0;
    this.state.arenaEffectType = "";
    this.state.arenaEffectTimer = 0;
    this.inputBySession.clear();
    this._invulnUntil.clear();
    this._killStreaks.clear();
    this._lastKilledBy.clear();
    this._kartCrashCooldownUntil.clear();
    this._firstBloodDone = false;

    const players = [...this.state.players.values()];
    const maxPlayers = Math.max(players.length, this.maxClients || players.length || 1);
    const gloBurst = WEAPONS.glo_burst;
    players.forEach((player, index) => {
      const spawn = this.getSpawnPoint(maxPlayers, index);
      initializeAuthoritativeKart(player, spawn);
      player.team = index % 2 === 0 ? "red" : "blue";
      player.health = 100;
      player.score = 0;
      player.ready = true;
      player.readyAt = now;
      player.lastProcessedInput = 0;
      player.lives = 3;
      player.deaths = 0;
      player.weapon = "glo_burst";
      player.ammo = gloBurst?.ammo || 0;
      player.fireCooldown = 0;
      player.overheat = 0;
      player.overheated = false;
      player.weapon2 = "";
      player.ammo2 = 0;
      player.fireCooldown2 = 0;
      player.weapon3 = "";
      player.ammo3 = 0;
      player.speedMultiplier = 1;
      player.steerMultiplier = 1;
      player.effectType = "";
      player.effectTimer = 0;
      player.shielded = false;
      player.shieldHP = 0;
      player.reflectProjectiles = false;
      player.phased = false;
      player.steer = 0;
      player.lap = 0;
      player.checkpointIdx = -1;
      player.finished = false;
      player.raceFinishTime = 0;
    });

    const transientEntityIds = [];
    this.state.entities.forEach((entity, entityId) => {
      if (entity.type === "item_box") {
        entity.active = true;
        entity.respawnTimer = 0;
      } else {
        transientEntityIds.push(entityId);
      }
    });
    transientEntityIds.forEach((entityId) => this.state.entities.delete(entityId));

    this._refreshReadyState();
  }

  _refreshReadyState() {
    const now = Date.now();
    let playerCount = 0;
    let readyCount = 0;
    this.state.players.forEach((player, sessionId) => {
      playerCount += 1;
      const joinedAt = this._joinedAtBySession.get(sessionId) || 0;
      if (!player.ready && joinedAt > 0 && (now - joinedAt) >= 12000) {
        player.ready = true;
        player.readyAt = player.readyAt || now;
      }
      if (player.ready) readyCount += 1;
    });
    this.state.readyCount = readyCount;
    this.state.readyRequiredCount = Math.max(this._getMinReadyPlayers(), playerCount);
  }

  _cancelCountdown(reason = "unknown") {
    if (this._countdownTimer) {
      this._countdownTimer.clear();
      this._countdownTimer = null;
    }
    if (!this.countdownActive && !this.state.countdownActive) return;

    this.countdownActive = false;
    this._countdownStartAt = 0;
    this.state.countdownActive = false;
    this.state.countdownStartAt = 0;
    this.broadcast("startCancelled", { reason, serverNow: Date.now() });
  }

  _startCountdown(reason = "ready") {
    if (this.state.started || this.countdownActive || this._matchEnded) return;

    this.countdownActive = true;
    const durationMs = this.countdownDurationMs;
    const serverNow = Date.now();
    const startAt = serverNow + durationMs;

    this._countdownStartAt = startAt;
    this.state.countdownActive = true;
    this.state.countdownDurationMs = durationMs;
    this.state.countdownStartAt = startAt;

    this.broadcast("startSequence", { durationMs, startAt, serverNow, reason });

    this._countdownTimer = this.clock.setTimeout(() => {
      this._countdownTimer = null;
      this.state.started = true;
      this.countdownActive = false;
      this.state.countdownActive = false;
      this.state.countdownStartAt = 0;
      this._countdownStartAt = 0;
      this.broadcast("matchLive", { startedAt: Date.now() });
    }, durationMs);
  }

  _evaluateCountdownStart(reason = "state") {
    if (this.state.started || this._matchEnded) return;

    this._refreshReadyState();
    const playerCount = this.state.players.size;
    const minPlayers = this._getMinReadyPlayers();
    const allJoinedPlayersReady = playerCount > 0 && this.state.readyCount >= playerCount;
    const canStart = playerCount >= minPlayers && allJoinedPlayersReady;

    if (!canStart) {
      this._cancelCountdown(reason);
      return;
    }

    this._startCountdown(reason);
  }

  getSpawnPoint(maxPlayers, index) {
    if (this._customSpawnPoints.length) {
      const authoredSpawn = this._customSpawnPoints[index % this._customSpawnPoints.length];
      return {
        x: authoredSpawn.x,
        y: authoredSpawn.y,
        z: authoredSpawn.z,
        heading: authoredSpawn.heading,
      };
    }

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
        return { x, y: this._spawnY, z };
      }

      const retryAngle = Math.random() * Math.PI * 2;
      const retryRadius = 24 + Math.random() * 12;
      x = Math.cos(retryAngle) * retryRadius;
      z = Math.sin(retryAngle) * retryRadius;
    }

    return { x, y: this._spawnY, z };
  }

  update(deltaTime) {
    const now = Date.now();
    this.state.serverTime = now;
    noteRealtimeTick(this, deltaTime, now);
    const sanitizeBattlePosition = (prev, next) => sanitizePosition(prev, next, this._positionGuardHalf);

    this.state.players.forEach((p, id) => {
      const input = this.inputBySession.get(id);
      if (!this.state.started) return;

      if (input && !isRealtimeInputFresh(input, now, this.staleInputMs)) {
        noteRejectedInput(this, "stale");
      }

      const authoritativeInput = getRealtimeControlInput(input, now, this.staleInputMs);
      applyAuthoritativeKartStep(p, authoritativeInput, deltaTime, sanitizeBattlePosition);
      if (input) noteProcessedInput(this, input, now);
    });

    const kartCrashes = resolveAuthoritativeKartContacts(this.state.players, deltaTime, sanitizeBattlePosition);
    for (const crash of kartCrashes) {
      const pairKey = this._getKartCrashKey(crash.playerA.id, crash.playerB.id);
      if (now < (this._kartCrashCooldownUntil.get(pairKey) || 0)) continue;
      if (crash.severity < 1.2 && crash.damageA <= 0 && crash.damageB <= 0) continue;
      this._kartCrashCooldownUntil.set(pairKey, now + 350);

      const resultA = crash.damageA > 0
        ? this._applyBattleDamage(crash.playerA, crash.damageA, { attackerId: crash.playerB.id, weapon: "kart_crash" })
        : { applied: false, remainingHealth: crash.playerA.health };
      const resultB = crash.damageB > 0
        ? this._applyBattleDamage(crash.playerB, crash.damageB, { attackerId: crash.playerA.id, weapon: "kart_crash" })
        : { applied: false, remainingHealth: crash.playerB.health };

      this.broadcast("kartCrash", {
        playerAId: crash.playerA.id,
        playerBId: crash.playerB.id,
        damageA: resultA.applied ? crash.damageA : 0,
        damageB: resultB.applied ? crash.damageB : 0,
        remainingHealthA: resultA.remainingHealth,
        remainingHealthB: resultB.remainingHealth,
        severity: crash.severity,
        hitX: crash.hitX,
        hitY: crash.hitY,
        hitZ: crash.hitZ,
      });
    }

    const endedArenaEffect = tickArenaEffects(this.state, this.state.players, deltaTime);
    if (endedArenaEffect) {
      this.broadcast("arenaEffectCleared", { type: endedArenaEffect });
    }

    if (this.state.gameType === "ctf" && this.state.started) {
      if (this.state.redScore >= this.state.scoreLimit || this.state.blueScore >= this.state.scoreLimit) {
        const winTeam = this.state.redScore > this.state.blueScore ? "red" : "blue";
        const standings = [];
        this.state.players.forEach((p) => {
          standings.push({ sessionId: p.id, name: p.name, score: p.score, team: p.team });
        });
        standings.sort((a, b) => b.score - a.score);
        this.broadcast("matchEnd", {
          mode: "battle",
          gameType: "ctf",
          winner: winTeam,
          winReason: `${winTeam} team wins`,
          redScore: this.state.redScore,
          blueScore: this.state.blueScore,
          standings,
        });
        this._matchEnded = true;
        this.state.started = false;
        this.countdownActive = false;
        this.state.countdownActive = false;
        this.state.countdownStartAt = 0;
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
    const hits = tickProjectiles(this.state.entities, this.state.players, deltaTime, this._spawnY);
    for (const hit of hits) {
        this._resolveCombatHit(hit);
    }
  }
}
