/**
 * Editor3RaceRoom — Authoritative race room driven by editor3 cannon-es.
 *
 * Promoted from realtime/spikes/editor3-bridge/server.mjs (Phase 1.5 spike)
 * and extended (Phase 2.2) with the full lobby game-config pipeline:
 *
 *   onCreate(options) accepts ANY of:
 *     - { trackData }          : inline editor3 Track JSON
 *     - { trackId }            : UUID — fetched from backend via fetchTrack()
 *     - { customTrackData }    : same as trackData but as a JSON STRING (the
 *                                shape produced by LobbyRoom.matchStart)
 *     - { totalLaps }          : 1..10 (default 3)
 *     - { weaponPool }         : string[] override (else RACE_WEAPON_POOL)
 *     - { players }            : roster from LobbyRoom (display only — actual
 *                                identity comes from each client's onJoin)
 *     - { lobbyCode, maxPlayers, scoreLimit, ... }
 *
 * Architecture:
 *   - 60Hz authoritative cannon-es tick
 *   - 20Hz Colyseus state snapshot
 *   - One CANNON.RaycastVehicle per session
 *   - Karts spawn at the loaded track's `isSpawn` placements (round-robin)
 *   - Item boxes spawned at every placement whose segment def has
 *     `runtime.kind === 'pickup'`. Server validates proximity, grants
 *     weapon via combat.grantWeapon, broadcasts on pickup/respawn.
 *   - Lap counting: kart must travel beyond HALF_TRACK_FAR_RADIUS_MM from
 *     finish, then re-enter FINISH_TRIGGER_RADIUS_MM, with at least
 *     MIN_LAP_TIME_MS between laps. Server-authoritative — no client trust.
 *   - Weapon fire: client sends "fireWeapon" → ammo decrement +
 *     "projectileFired" broadcast. Full server-side projectile physics
 *     deferred (clients render the visual; reference: RaceRoom.fireWeapon).
 */
import { Room } from "@colyseus/core";
import { Schema, MapSchema, type } from "@colyseus/schema";
import * as CANNON from "cannon-es";
import { buildWorldFromTrackData, buildDefaultArena, validateTrackData } from "../track/track-loader.js";
import { fetchTrack } from "../track/backend-client.js";
import { RACE_WEAPON_POOL, WEAPONS, grantWeapon, swapSecondaryWeapon } from "../combat.js";
import { log } from "../logger.js";
import {
  SCALE, M,
  createKartVehicle, createControlState, createPlayerCombat,
  applyKartControls, inputsToKeys,
} from "../physics/kart-physics.js";

const TICK_HZ = 60;
const SNAPSHOT_HZ = 30;
// Kart constants live in the shared kart-physics module so SP playtest
// and the online race room use the exact same handling values. Only
// room-level constants stay here.
const MAX_PLAYERS = 8;
const FINISH_TRIGGER_RADIUS_MM = 18 * SCALE;
const HALF_TRACK_FAR_RADIUS_MM = 30 * SCALE;
const MIN_LAP_TIME_MS = 4000;

// ── Schema ──────────────────────────────────────────────────────────
class KartState extends Schema {}
type("number")(KartState.prototype, "x");
type("number")(KartState.prototype, "y");
type("number")(KartState.prototype, "z");
type("number")(KartState.prototype, "qx");
type("number")(KartState.prototype, "qy");
type("number")(KartState.prototype, "qz");
type("number")(KartState.prototype, "qw");
type("number")(KartState.prototype, "vx");
type("number")(KartState.prototype, "vy");
type("number")(KartState.prototype, "vz");
type("uint32")(KartState.prototype, "lastSeq");
type("string")(KartState.prototype, "name");
type("string")(KartState.prototype, "color");
type("string")(KartState.prototype, "kartId");
// Customisable underglow — broadcast so each client renders the
// player's chosen GLO pattern + colour beneath every kart, identical
// to the SP playtest "Pick Your GLO" rig.
type("string")(KartState.prototype, "gloEffect");
type("string")(KartState.prototype, "gloColor");
type("string")(KartState.prototype, "gloColor2");
type("uint8")(KartState.prototype, "lap");
type("uint8")(KartState.prototype, "place");
type("boolean")(KartState.prototype, "finished");
type("string")(KartState.prototype, "weapon2");
type("uint8")(KartState.prototype, "ammo2");
type("string")(KartState.prototype, "weapon3");
type("uint8")(KartState.prototype, "ammo3");
// FX-driving state — broadcast so each client can render skid trails,
// drift sparks, burnout smoke, boost flames, and engine SFX 1:1 with
// SP playtest. Without these the only visible thing remote karts do
// is glide silently across the track.
type("boolean")(KartState.prototype, "driftActive");
type("uint8")(KartState.prototype, "driftTier");      // 0..3
type("number")(KartState.prototype, "boostTimer");     // sec remaining (drift mini-turbo)
type("number")(KartState.prototype, "gloBurnoutT");    // sec remaining (burnout boost)
type("boolean")(KartState.prototype, "chargingBurnout"); // W+Space hold accumulating
type("number")(KartState.prototype, "throttleIn");     // 0..1
type("number")(KartState.prototype, "brakeIn");        // 0..1
type("number")(KartState.prototype, "steerIn");        // -1..1 (smoothed)
type("uint8")(KartState.prototype, "wheelGrounded");   // bitmask 4 bits
type("int8")(KartState.prototype, "driftDir");         // -1, 0, +1
type("boolean")(KartState.prototype, "engineExploded"); // true while lockout active
// Slice 2 — PvP combat state. Drives buff VFX, knockback resolution,
// scoring, and HUD overlays. All effect timestamps are absolute server
// epoch milliseconds (Date.now()) so the client can compare directly.
type("uint16")(KartState.prototype, "score");
type("number")(KartState.prototype, "boostUntilMs");      // mushroom / golden / star speed boost
type("number")(KartState.prototype, "boostMul");          // active multiplier (1.0 if none)
type("number")(KartState.prototype, "immuneUntilMs");     // star + bullet bill invuln
type("number")(KartState.prototype, "stunUntilMs");       // shell hits / explosions
type("number")(KartState.prototype, "spinUntilMs");       // banana spinout
type("number")(KartState.prototype, "bulletBillUntilMs"); // bullet bill auto-pilot
type("number")(KartState.prototype, "starUntilMs");       // star (separate so client can paint rainbow)
type("uint8")(KartState.prototype, "chargeCount");        // golden mushroom remaining charges
// Slice 3 — economy + V8 buff state
type("uint8")(KartState.prototype, "hp");             // 0-100 health
type("uint8")(KartState.prototype, "coins");          // coin count (top-speed economy)
type("uint8")(KartState.prototype, "shieldActive");   // 1 = v8_shield absorb pending
type("number")(KartState.prototype, "doubleDmgUntilMs"); // v8_double_dmg active until

class PickupState extends Schema {}
type("number")(PickupState.prototype, "x");
type("number")(PickupState.prototype, "y");
type("number")(PickupState.prototype, "z");
type("boolean")(PickupState.prototype, "active");
type("string")(PickupState.prototype, "kind");

// Slice 2 — server-authoritative projectile entity. One per live shell /
// bomb / banana drop. Client subscribes via state.projectiles MapSchema
// and renders meshes by subType.
class ProjectileState extends Schema {}
type("string")(ProjectileState.prototype, "ownerId");
type("string")(ProjectileState.prototype, "subType"); // green_shell|red_shell|blue_shell|bobomb|banana
type("number")(ProjectileState.prototype, "x");
type("number")(ProjectileState.prototype, "y");
type("number")(ProjectileState.prototype, "z");
type("number")(ProjectileState.prototype, "vx");
type("number")(ProjectileState.prototype, "vy");
type("number")(ProjectileState.prototype, "vz");
type("string")(ProjectileState.prototype, "targetId"); // for homing
type("uint8")(ProjectileState.prototype, "bouncesLeft");
type("uint8")(ProjectileState.prototype, "armed"); // 1 = can damage owner (post fuse)

class Editor3WorldState extends Schema {
  constructor() {
    super();
    this.karts = new MapSchema();
    this.pickups = new MapSchema();
    this.projectiles = new MapSchema();
  }
}
type({ map: KartState })(Editor3WorldState.prototype, "karts");
type({ map: PickupState })(Editor3WorldState.prototype, "pickups");
type({ map: ProjectileState })(Editor3WorldState.prototype, "projectiles");
type("string")(Editor3WorldState.prototype, "trackId");
type("string")(Editor3WorldState.prototype, "trackName");
type("string")(Editor3WorldState.prototype, "lobbyCode");
type("uint8")(Editor3WorldState.prototype, "totalLaps");
type("string")(Editor3WorldState.prototype, "status"); // "racing" | "finished"
type("uint16")(Editor3WorldState.prototype, "matchSecondsLeft"); // 0–180; 0 = no timer

// ── Helpers ─────────────────────────────────────────────────────────
function clamp01(n) { return Math.max(0, Math.min(1, Number(n) || 0)); }
function clampSym(n) { return Math.max(-1, Math.min(1, Number(n) || 0)); }

function makeWorld() {
  // Gravity in mm/s². Mirror SP playtest (`physics-worker.js`) which uses
  // M(25) for snappier arcade falls; using M(9.82) was too floaty when
  // combined with the heavy karts and stiff suspension below.
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -M(25), 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  world.defaultContactMaterial.friction = 0.4;
  // Ground+wheel contact material — matches SP playtest so karts get
  // grippy traction the moment a wheel raycast hits the road deck.
  const groundMat = new CANNON.Material("ground");
  const wheelMat = new CANNON.Material("wheel");
  world.addContactMaterial(new CANNON.ContactMaterial(groundMat, wheelMat, {
    friction: 0.65, restitution: 0.05,
  }));
  world.__groundMat = groundMat;
  world.__wheelMat = wheelMat;
  // Backstop plane far below the track. Without this a kart that misses
  // a deck (e.g. on a banked-turn seam) falls into the void forever and
  // the snapshot stream balloons with NaN-adjacent positions. SP playtest
  // uses an infinite plane at y=0; we put ours well below the lowest
  // possible deck so it only catches actual fall-throughs.
  const floor = new CANNON.Body({ mass: 0, material: groundMat, shape: new CANNON.Plane() });
  floor.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
  floor.position.set(0, -M(50), 0);
  world.addBody(floor);
  return world;
}

function spawnVehicle(world, pose) {
  const { vehicle } = createKartVehicle(world, pose);
  // Tag wheels with the world's wheelMat so the ground/wheel contact
  // material (friction 0.65) applies. Without this they fall back to
  // the default 0.4 friction and karts feel oddly slippery.
  for (const w of vehicle.wheelInfos) {
    w.material = world.__wheelMat;
  }
  return vehicle;
}

function parseTrackOption(options) {
  // LobbyRoom serializes track JSON as `customTrackData: string`.
  if (typeof options.customTrackData === "string" && options.customTrackData.length > 2) {
    try { return JSON.parse(options.customTrackData); } catch { /* ignore */ }
  }
  return options.trackData ?? null;
}

// ── Room ────────────────────────────────────────────────────────────
export class Editor3RaceRoom extends Room {
  static maxClients = MAX_PLAYERS;

  async onCreate(options = {}) {
    // Phase D2 \u2014 protocol/engine version handshake. Refuse to boot the
    // room if a client/lobby is on an incompatible major version. Older
    // clients omitting these fields are treated as v1 for backwards compat
    // during the rollout window.
    const SERVER_PROTOCOL_VERSION = 1;
    const SERVER_ENGINE_VERSION = 1;
    const optProto = Number(options.protocolVersion ?? 1);
    const optEngine = Number(options.engineVersion ?? 1);
    if (optProto !== SERVER_PROTOCOL_VERSION || optEngine !== SERVER_ENGINE_VERSION) {
      log("warn", "editor3_room_version_mismatch", {
        clientProtocol: optProto,
        serverProtocol: SERVER_PROTOCOL_VERSION,
        clientEngine: optEngine,
        serverEngine: SERVER_ENGINE_VERSION,
      });
      this.broadcast("matchError", {
        message: `Version mismatch: client=${optProto}/${optEngine}, server=${SERVER_PROTOCOL_VERSION}/${SERVER_ENGINE_VERSION}. Refresh the page.`,
      });
      // continue \u2014 do not throw, so existing flows still work; clients can
      // surface the warning. Hard refusal can be enabled when versions diverge.
    }
    this.maxClients = Math.min(Math.max(Number(options.maxPlayers) || MAX_PLAYERS, 1), MAX_PLAYERS);
    this.setState(new Editor3WorldState());
    this.state.totalLaps = Math.min(Math.max(Number(options.totalLaps) || 3, 1), 10);
    this.state.lobbyCode = String(options.lobbyCode || "");
    this.state.status = "racing";

    this.world = makeWorld();
    this.vehicles = new Map();
    this.inputs = new Map();
    this.kartMeta = new Map();   // sid -> { lastLapAt, farReached }
    this.spawnCursor = 0;
    this.tickDt = 1 / TICK_HZ;
    this.snapshotDt = 1 / SNAPSHOT_HZ;
    this.tickDurations = [];

    this.weaponPool = (Array.isArray(options.weaponPool) && options.weaponPool.length)
      ? options.weaponPool.filter((id) => WEAPONS[id])
      : RACE_WEAPON_POOL;
    if (!this.weaponPool.length) this.weaponPool = RACE_WEAPON_POOL;

    // Slice 2 — projectile sim state. _projId is a monotonic counter used
    // as the MapSchema key so each projectile gets a stable unique id for
    // the duration of the room. _projMeta holds volatile per-projectile data
    // (expiry, fuse timer, homing delay) that doesn't need schema sync.
    this._projId = 0;
    this._projMeta = new Map(); // projKey -> { expiresMs, fuseMs, homingArmedMs, def, ownerId }
    this._matchStartMs = 0; // set on first _writeSnapshot while status=racing
    this.state.matchSecondsLeft = 180;

    let trackData = parseTrackOption(options);
    let trackId = options.trackId ?? "";
    if (!trackData && trackId) {
      try {
        trackData = await fetchTrack(trackId, { incrementPlayCount: true });
      } catch (err) {
        log("warn", "editor3_room_track_fetch_failed", { trackId, error: err.message });
        trackData = null;
      }
    }

    if (trackData) {
      // Phase A3 — pre-flight validation. Errors fall back to default arena;
      // warnings (e.g. missing finish line) are logged so we have a forensic
      // trail when guests report 'race never ends' or 'wrong starting grid'.
      const validation = validateTrackData(trackData);
      if (!validation.ok) {
        log("warn", "editor3_room_track_invalid", {
          trackId,
          errors: validation.errors,
          warnings: validation.warnings,
        });
        // Still attempt to build (forgiving) so a partial track is better
        // than a blank arena — but downstream clients will see the warnings.
      } else if (validation.warnings.length) {
        log("info", "editor3_room_track_warnings", { trackId, warnings: validation.warnings });
      }
      const result = buildWorldFromTrackData(this.world, trackData);
      // Phase A2 — surface segment-registry parity issues so we can spot
      // client/server drift the moment a track loads on the server.
      if (result.diagnostics?.unknownSegments?.length) {
        log("warn", "editor3_room_unknown_segments", {
          trackId,
          count: result.diagnostics.unknownSegments.length,
          keys: result.diagnostics.unknownSegments,
        });
      }
      this.spawns = result.spawns;
      this.finish = result.finish;
      this.pickupSpawns = result.pickups;
      this.state.trackId = trackId;
      this.state.trackName = trackData?.track?.name || trackData?.name || "(custom)";
    } else {
      const result = buildDefaultArena(this.world);
      this.spawns = result.spawns;
      this.finish = null;
      this.pickupSpawns = result.pickups || [];
      this.state.trackId = "";
      this.state.trackName = "(default arena)";
    }

    // Publish item boxes to schema so clients can render them.
    this.pickupRespawnAt = new Map();
    for (const p of this.pickupSpawns) {
      const ps = new PickupState();
      ps.x = p.x; ps.y = p.y; ps.z = p.z;
      ps.active = true;
      ps.kind = p.kind;
      this.state.pickups.set(p.id, ps);
      this.pickupRespawnAt.set(p.id, 0);
    }

    this.onMessage("input", (client, msg) => {
      this.inputs.set(client.sessionId, {
        seq: (msg && msg.seq) | 0,
        // Throttle is signed: -1 = reverse, 0 = coast, 1 = full forward.
        // Was clamp01 here which silently dropped reverse intent; karts
        // could only roll backward via residual momentum.
        throttle: clampSym(msg?.throttle ?? 0),
        brake: clamp01(msg?.brake ?? 0),
        steer: clampSym(msg?.steer ?? 0),
        drift: !!msg?.drift,
      });
    });

    // Phase F1 — off-course recovery. Client binds R; server snaps the
    // kart to its nearest spawn and zeroes velocity. Rate-limited to one
    // respawn per 1.5s to prevent grief / abuse.
    this.onMessage("respawn", (client) => {
      this._respawnKart(client.sessionId, { reason: "manual" });
    });

    // Slice 4 — rematch: reset all state and restart the match timer.
    this.onMessage("rematch", (_client) => {
      if (this.state.status !== "finished") return;
      const nowMs = Date.now();
      for (const [sid, ks] of this.state.karts.entries()) {
        ks.score = 0;
        ks.hp = 100;
        ks.coins = 0;
        ks.shieldActive = 0;
        ks.doubleDmgUntilMs = 0;
        ks.boostUntilMs = 0;
        ks.boostMul = 1.0;
        ks.immuneUntilMs = 0;
        ks.stunUntilMs = 0;
        ks.spinUntilMs = 0;
        ks.bulletBillUntilMs = 0;
        ks.starUntilMs = 0;
        ks.chargeCount = 0;
        ks.weapon2 = "";
        ks.weapon3 = "";
        ks.ammo2 = 0;
        ks.ammo3 = 0;
        this._respawnKart(sid, { reason: "rematch" });
      }
      // Clear live projectiles.
      const projKeys = [...this.state.projectiles.keys()];
      for (const k of projKeys) this.state.projectiles.delete(k);
      this._projMeta.clear();
      this._matchStartMs = 0;
      this.state.matchSecondsLeft = 180;
      this.state.status = "racing";
      this.broadcast("matchReset", { ts: nowMs });
    });

    this.onMessage("pickupItem", (client, data) => {
      const sid = client.sessionId;
      const kart = this.state.karts.get(sid);
      if (!kart || this.state.status !== "racing") return;
      const id = String(data?.id || "");
      const pickup = this.state.pickups.get(id);
      if (!pickup || !pickup.active) return;
      const dx = kart.x - pickup.x, dz = kart.z - pickup.z;
      const distSq = dx * dx + dz * dz;
      const spawn = this.pickupSpawns.find((p) => p.id === id);
      const radius = spawn?.radius || 14 * SCALE;
      if (distSq > radius * radius) return;
      const hasRoom = (!kart.weapon2 || kart.ammo2 <= 0) || (!kart.weapon3 || kart.ammo3 <= 0);
      if (!hasRoom) return;
      pickup.active = false;
      this.pickupRespawnAt.set(id, Date.now() + (spawn?.respawnMs || 5000));
      const rolled = grantWeapon(kart, this._positionRatio(sid), { pool: this.weaponPool });
      const def = WEAPONS[rolled];
      client.send("itemReceived", {
        slot: kart.weapon2 === rolled ? "secondary" : "reserve",
        weapon: rolled,
        ammo: kart.weapon2 === rolled ? kart.ammo2 : kart.ammo3,
        category: def?.category || "unknown",
        cooldownMs: def?.cooldown || 0,
        description: def?.desc || "",
      });
    });

    this.onMessage("swapSecondaryWeapon", (client) => {
      const kart = this.state.karts.get(client.sessionId);
      if (!kart) return;
      if (!swapSecondaryWeapon(kart)) return;
      client.send("secondaryWeaponSwapped", {
        active: { weapon: kart.weapon2 || "", ammo: kart.ammo2 || 0 },
        reserve: { weapon: kart.weapon3 || "", ammo: kart.ammo3 || 0 },
      });
    });

    this.onMessage("fireWeapon", (client, data = {}) => {
      const kart = this.state.karts.get(client.sessionId);
      if (!kart || this.state.status !== "racing") return;
      const slot = data?.slot === "reserve" ? "reserve" : "secondary";
      const weaponId = slot === "reserve" ? kart.weapon3 : kart.weapon2;
      const ammo = slot === "reserve" ? kart.ammo3 : kart.ammo2;
      if (!weaponId || ammo <= 0) return;
      const def = WEAPONS[weaponId];
      if (!def) return;
      // Phase C1 — server-authoritative weapon cooldown.
      const nowMs = Date.now();
      if (!this._weaponLastFire) this._weaponLastFire = new Map();
      const key = `${client.sessionId}:${slot}`;
      const lastMs = this._weaponLastFire.get(key) || 0;
      const cooldownMs = Number(def.cooldownMs) > 0 ? Number(def.cooldownMs)
        : Number(def.cooldown) > 0 ? Number(def.cooldown)
        : 200;
      if (nowMs - lastMs < cooldownMs) return;
      // Cannot fire while stunned / spinning.
      if (nowMs < (kart.stunUntilMs || 0) || nowMs < (kart.spinUntilMs || 0)) return;
      this._weaponLastFire.set(key, nowMs);

      // Decrement ammo.
      if (slot === "reserve") kart.ammo3 = Math.max(0, ammo - 1);
      else kart.ammo2 = Math.max(0, ammo - 1);

      // ── Slice 2 dispatch ──────────────────────────────────────────
      // Buff weapons: apply self-buff timers immediately. No projectile.
      if (def.category === "buff") {
        this._applySelfBuff(client.sessionId, kart, weaponId, def, nowMs);
        return;
      }
      // Projectile weapons (shells / bombs): spawn ProjectileState.
      if (def.category === "projectile" && def.subType) {
        this._spawnProjectile(client.sessionId, kart, weaponId, def, data, nowMs);
        return;
      }
      // Spread weapons (v8_firethrower): spawn N projectiles in a cone.
      if (def.category === "spread" && def.subType) {
        const count = def.spreadCount || 5;
        const halfAngle = (def.spreadAngle || 0.4) / 2;
        for (let i = 0; i < count; i++) {
          const angleOff = count > 1
            ? -halfAngle + (i / (count - 1)) * (def.spreadAngle || 0.4)
            : 0;
          this._spawnProjectile(client.sessionId, kart, weaponId, def, { ...data, spreadAngleOff: angleOff }, nowMs);
        }
        return;
      }
      // Trap (any trap category — banana, v8_mine, v8_dynamite, etc.)
      if (def.category === "trap") {
        this._spawnBanana(client.sessionId, kart, def, data, nowMs);
        return;
      }
      // Legacy fallthrough — keep prior projectileFired event for any
      // weapons that haven't been migrated to the schema-projectile path.
      this.broadcast("projectileFired", {
        ownerId: client.sessionId,
        weapon: weaponId,
        category: def.category || "projectile",
        x: kart.x, y: kart.y, z: kart.z,
        qx: kart.qx, qy: kart.qy, qz: kart.qz, qw: kart.qw,
      });
      const isHitscan = (def.category === 'hitscan' || def.category === 'cone' || def.range === 'short');
      if (isHitscan) {
        const target = this._findForwardCarTarget(kart, Number(def.rangeM) || 18);
        if (target) {
          const stunMs = Number(def.stunMs) > 0 ? Number(def.stunMs) : 600;
          this.broadcast("kartImpact", {
            sourceId: client.sessionId,
            targetId: target.sid,
            subType: weaponId,
            x: target.kart.x, y: target.kart.y, z: target.kart.z,
            stunMs,
            ts: Date.now(),
          });
        }
      }
    });

    // Phase F2 — single deterministic tick loop. We previously ran two
    // independent setInterval timers (60Hz physics + 30Hz snapshot writer)
    // which raced under load: the snapshot writer could fire mid-tick and
    // observe a partially-stepped world, producing one stuttery frame per
    // contention. Consolidating into a single 60Hz loop that also writes
    // a snapshot every other tick removes the race and keeps cadence
    // stable when the event loop is busy.
    let _snapAcc = 0;
    const _snapEveryNth = Math.max(1, Math.round(TICK_HZ / SNAPSHOT_HZ));
    this.tickHandle = setInterval(() => {
      this._tick();
      if (++_snapAcc >= _snapEveryNth) { _snapAcc = 0; this._writeSnapshot(); }
    }, this.tickDt * 1000);
    this.snapshotHandle = null;

    // Phase F2 — align Colyseus state-flush cadence with our 30Hz
    // snapshot writer. Default is 50ms (20Hz); a 33ms patch rate keeps
    // network bandwidth bounded while delivering every snapshot we
    // generate, which removes the visible stutter at high RTT.
    this.setPatchRate(1000 / SNAPSHOT_HZ);

    log("info", "editor3_room_create", {
      roomId: this.roomId, trackId, trackName: this.state.trackName,
      spawns: this.spawns.length, pickups: this.pickupSpawns.length,
      laps: this.state.totalLaps, hasFinish: !!this.finish, weapons: this.weaponPool.length,
    });
  }

  onJoin(client, options = {}) {
    const basePose = this.spawns[this.spawnCursor % this.spawns.length] || { x: 0, y: 1.5, z: 0, heading: 0 };
    // Stagger karts so multiple players don't pile on top of one spawn
    // marker (most templates ship with a single spawn). Offset along the
    // spawn's local "behind" axis (negative forward), with a small lateral
    // zig-zag so a 2-row grid forms naturally.
    const slot = this.spawnCursor;
    const row = Math.floor(slot / this.spawns.length);
    const lateral = ((slot % 2) === 0 ? -1 : 1) * M(2.5);
    const back = (row + (this.spawns.length === 1 ? row : 0)) * M(5);
    const heading = basePose.heading || 0;
    // Forward unit-vector for this spawn (segment "forward" is +Z in local
    // space, rotated by heading around +Y).
    const fwdX = Math.sin(heading);
    const fwdZ = Math.cos(heading);
    // Right unit-vector (perpendicular, rotated -90°).
    const rightX = Math.cos(heading);
    const rightZ = -Math.sin(heading);
    const pose = {
      x: basePose.x - fwdX * back + rightX * lateral,
      y: basePose.y,
      z: basePose.z - fwdZ * back + rightZ * lateral,
      heading,
    };
    this.spawnCursor++;
    const vehicle = spawnVehicle(this.world, pose);
    this.vehicles.set(client.sessionId, vehicle);
    // Per-kart control + combat state for the shared physics core.
    // Without this the drift state machine and boost timers would be
    // shared across players (or simply absent), and online karts
    // wouldn't feel like SP playtest.
    if (!this.controlStates) this.controlStates = new Map();
    if (!this.playerCombats) this.playerCombats = new Map();
    this.controlStates.set(client.sessionId, createControlState());
    this.playerCombats.set(client.sessionId, createPlayerCombat());

    const ks = new KartState();
    ks.x = pose.x; ks.y = pose.y; ks.z = pose.z;
    ks.qx = vehicle.chassisBody.quaternion.x;
    ks.qy = vehicle.chassisBody.quaternion.y;
    ks.qz = vehicle.chassisBody.quaternion.z;
    ks.qw = vehicle.chassisBody.quaternion.w;
    ks.vx = 0; ks.vy = 0; ks.vz = 0;
    ks.lastSeq = 0;
    ks.name = String(options.playerName || `Player_${client.sessionId.slice(0, 4)}`).slice(0, 24);
    ks.color = String(options.playerColor || "#ff3aa1");
    ks.kartId = String(options.playerKart || options.kartId || "tux");
    ks.gloEffect = String(options.gloEffect || "solid");
    ks.gloColor = String(options.gloColor || "#ff0080");
    ks.gloColor2 = String(options.gloColor2 || "#00e5ff");
    ks.lap = 0; ks.place = 1; ks.finished = false;
    ks.driftActive = false; ks.driftTier = 0;
    ks.boostTimer = 0; ks.gloBurnoutT = 0;
    ks.chargingBurnout = false;
    ks.throttleIn = 0; ks.brakeIn = 0; ks.steerIn = 0;
    ks.wheelGrounded = 0; ks.driftDir = 0;
    ks.engineExploded = false;
    ks.weapon2 = ""; ks.ammo2 = 0;
    ks.weapon3 = ""; ks.ammo3 = 0;
    ks.score = 0;
    ks.boostUntilMs = 0;
    ks.boostMul = 1;
    ks.immuneUntilMs = 0;
    ks.stunUntilMs = 0;
    ks.spinUntilMs = 0;
    ks.bulletBillUntilMs = 0;
    ks.starUntilMs = 0;
    ks.chargeCount = 0;
    ks.hp = 100;
    ks.coins = 0;
    ks.shieldActive = 0;
    ks.doubleDmgUntilMs = 0;
    this.state.karts.set(client.sessionId, ks);

    this.inputs.set(client.sessionId, { seq: 0, throttle: 0, brake: 0, steer: 0, drift: false });
    this.kartMeta.set(client.sessionId, { lastLapAt: Date.now(), farReached: !this.finish });
    log("info", "editor3_room_join", {
      roomId: this.roomId, sessionId: client.sessionId, name: ks.name, total: this.vehicles.size,
    });
  }

  onLeave(client, consented) {
    // Phase D3 \u2014 graceful reconnect window. Keep the kart, vehicle body and
    // combat state warm for ~15s so a client that briefly drops (mobile
    // hand-off, tab refresh) can rejoin and pick up where they left off.
    // Consented leaves (host kicks them, race ends) bypass this.
    if (!consented && this.state.status === "racing") {
      try {
        log("info", "editor3_room_leave_pending_reconnect", {
          roomId: this.roomId, sessionId: client.sessionId,
        });
        // allowReconnection returns a Deferred that resolves with the new
        // client when they rejoin, or rejects after the timeout.
        // Migrate vehicle/kart state across the new sessionId.
        // NOTE: the new client comes back with the SAME sessionId.
        return this.allowReconnection(client, 15).then(() => {
          log("info", "editor3_room_reconnected", {
            roomId: this.roomId, sessionId: client.sessionId,
          });
        }).catch(() => {
          this._purgeKart(client.sessionId);
        });
      } catch (err) {
        log("warn", "editor3_room_reconnect_unsupported", { error: err.message });
      }
    }
    this._purgeKart(client.sessionId);
  }

  /**
   * Phase F1 — reset a kart to its nearest spawn (or finish line).
   * Used by manual `respawn` messages and the per-tick auto-respawn for
   * fall-through cases (kart drops below the world floor).
   */
  _respawnKart(sessionId, opts = {}) {
    const v = this.vehicles.get(sessionId);
    const ks = this.state.karts.get(sessionId);
    if (!v || !ks) return false;
    const nowMs = Date.now();
    if (!this._lastRespawnAt) this._lastRespawnAt = new Map();
    const last = this._lastRespawnAt.get(sessionId) || 0;
    if (opts.reason === "manual" && nowMs - last < 1500) return false;
    this._lastRespawnAt.set(sessionId, nowMs);

    // Pit-fall score penalty (spec: "lose score or stun on pit fall").
    if (opts.reason === "fellOff") {
      ks.score = Math.max(0, (ks.score || 0) - 1);
      this.broadcast("penaltyApplied", { sessionId, reason: "fellOff", scoreDelta: -1 });
    }
    // For multi-spawn templates this naturally puts you back near the most
    // recently passed checkpoint.
    const spawns = this.spawns && this.spawns.length ? this.spawns : [{ x: 0, y: M(1.5), z: 0, heading: 0 }];
    let best = spawns[0]; let bestD2 = Infinity;
    for (const s of spawns) {
      const dx = s.x - ks.x, dz = s.z - ks.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; best = s; }
    }
    const heading = best.heading || 0;
    // Lift the kart slightly above the spawn pose so it doesn't clip into
    // the deck and immediately fall through.
    const liftY = M(0.6);
    v.chassisBody.position.set(best.x, best.y + liftY, best.z);
    v.chassisBody.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), heading);
    v.chassisBody.velocity.set(0, 0, 0);
    v.chassisBody.angularVelocity.set(0, 0, 0);
    // Clear control state so a held drift / boost timer doesn't carry
    // through the respawn.
    const cs = this.controlStates?.get(sessionId);
    if (cs) {
      cs.throttle = 0; cs.steer = 0;
      cs.driftActive = false; cs.driftArmed = false; cs.driftAirborne = false;
      cs.driftCharge = 0; cs.driftTier = 0;
      cs.boostTimer = 0; cs.gloBurnoutT = 0;
      cs.engineExplodedUntilMs = 0;
    }
    this.broadcast("kartRespawned", {
      sessionId, reason: opts.reason || "manual",
      x: best.x, y: best.y + liftY, z: best.z, ts: nowMs,
    });
    return true;
  }

  _purgeKart(sessionId) {
    const v = this.vehicles.get(sessionId);
    if (v) {
      v.removeFromWorld(this.world);
      this.world.removeBody(v.chassisBody);
    }
    this.vehicles.delete(sessionId);
    this.inputs.delete(sessionId);
    this.kartMeta.delete(sessionId);
    this.controlStates?.delete(sessionId);
    this.playerCombats?.delete(sessionId);
    this.state.karts.delete(sessionId);
    // Clean up projectiles owned by the leaving player
    if (this._projMeta) {
      const ownedKeys = [];
      for (const [key, meta] of this._projMeta.entries()) {
        if (meta.ownerId === sessionId) ownedKeys.push(key);
      }
      for (const key of ownedKeys) {
        this.state.projectiles.delete(key);
        this._projMeta.delete(key);
      }
    }
    log("info", "editor3_room_leave", { roomId: this.roomId, sessionId, remaining: this.vehicles.size });
  }

  onDispose() {
    clearInterval(this.tickHandle);
    if (this.snapshotHandle) clearInterval(this.snapshotHandle);
    if (this.tickDurations.length) {
      const sorted = [...this.tickDurations].sort((a, b) => a - b);
      const p = (q) => sorted[Math.floor(sorted.length * q)] ?? 0;
      log("info", "editor3_room_dispose", {
        roomId: this.roomId,
        ticks: this.tickDurations.length,
        p50: +p(0.5).toFixed(2),
        p95: +p(0.95).toFixed(2),
        p99: +p(0.99).toFixed(2),
      });
    }
  }

  /** 0 = first place, 1 = last (used by combat.grantWeapon for rubber banding). */
  _positionRatio(sid) {
    const total = this.state.karts.size || 1;
    const me = this.state.karts.get(sid);
    if (!me) return 0.5;
    let behind = 0;
    for (const other of this.state.karts.values()) {
      if (other === me) continue;
      if (other.lap > me.lap) behind++;
    }
    return total <= 1 ? 0.5 : behind / (total - 1);
  }

  /**
   * Phase C2 helper: find the closest kart inside a forward cone of the
   * given source kart. Used to resolve hitscan / short-range weapon
   * impacts authoritatively on the server.
   * @param {KartState} src
   * @param {number} rangeM \u2014 max distance in metres
   * @returns {{sid:string, kart:KartState}|null}
   */
  _findForwardCarTarget(src, rangeM = 18) {
    if (!src) return null;
    const range2 = rangeM * rangeM;
    // Forward vector from src quaternion (rotate +Z by quat).
    const qx = src.qx, qy = src.qy, qz = src.qz, qw = src.qw;
    const fx = 2 * (qx * qz + qw * qy);
    const fy = 2 * (qy * qz - qw * qx);
    const fz = 1 - 2 * (qx * qx + qy * qy);
    let bestSid = null, bestKart = null, bestDot = 0.5; // require >60deg fwd
    let bestDist2 = range2;
    for (const [sid, k] of this.state.karts.entries()) {
      if (k === src) continue;
      const dx = k.x - src.x, dy = k.y - src.y, dz = k.z - src.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > bestDist2) continue;
      const d = Math.sqrt(d2) || 1;
      const dot = (dx * fx + dy * fy + dz * fz) / d;
      if (dot < bestDot) continue;
      bestSid = sid; bestKart = k; bestDist2 = d2;
    }
    return bestSid ? { sid: bestSid, kart: bestKart } : null;
  }

  _tick() {
    const nowMs = Date.now();

    // ── Effect application: modify control inputs for stunned/spinning/boosted karts ──
    for (const [sid, input] of this.inputs.entries()) {
      const v = this.vehicles.get(sid);
      if (!v) continue;
      const cs = this.controlStates.get(sid);
      const pc = this.playerCombats.get(sid);
      if (!cs || !pc) continue;
      const ks = this.state.karts.get(sid);

      // Derive an effective input that reflects active status effects.
      let effInput = input;
      if (ks) {
        const stunned  = nowMs < (ks.stunUntilMs || 0);
        const spinning = nowMs < (ks.spinUntilMs || 0);
        const billing  = nowMs < (ks.bulletBillUntilMs || 0);

        if (stunned || spinning || billing) {
          // During stun/spin/bullet-bill player has no control.
          // For bullet bill we keep full throttle but auto-steer.
          effInput = { seq: input.seq, throttle: billing ? 1 : 0, brake: 0, steer: billing ? this._billSteer(sid, ks) : 0, drift: false };
        }

        // Apply external speed boost from mushroom/star.
        const boosting = nowMs < (ks.boostUntilMs || 0);
        if (boosting && !stunned && !spinning) {
          const mul = Number(ks.boostMul) || 1;
          // Clamp to prevent physics explosion — max factor is 3.
          if (mul > 1) {
            const vel = v.chassisBody.velocity;
            const spd = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
            if (spd > 0.1) {
              // Nudge velocity magnitude toward target (not a hard clamp —
              // smooth frame-over-frame is more stable with cannon-es).
              const targetSpd = spd * mul;
              const cappedMul = Math.min(targetSpd, spd * 1.08) / spd; // gentle ramp
              vel.x *= cappedMul; vel.y *= cappedMul; vel.z *= cappedMul;
            }
          }
        }

        // Star contact damage: if star is active and we're touching another kart, knockback them.
        const starActive = nowMs < (ks.starUntilMs || 0);
        if (starActive) {
          this._checkStarContact(sid, ks, nowMs);
        }
      }

      applyKartControls({
        chassisBody: v.chassisBody,
        vehicle: v,
        controlState: cs,
        keys: inputsToKeys(effInput),
        playerCombat: pc,
      }, this.tickDt);
    }

    const t0 = process.hrtime.bigint();
    this.world.step(this.tickDt, this.tickDt, 3);
    const dur = Number(process.hrtime.bigint() - t0) / 1e6;
    this.tickDurations.push(dur);
    if (this.tickDurations.length > 1200) this.tickDurations.shift();

    // Phase F1— fall-through guard. Any kart that drops below the world
    // floor (placed at y=-50m by makeWorld) is auto-respawned so the
    // player isn't stranded. Also catches NaN cases that would otherwise
    // poison the snapshot stream.
    const FALL_Y = -M(40);
    for (const [sid, v] of this.vehicles.entries()) {
      const py = v.chassisBody.position.y;
      if (!Number.isFinite(py) || py < FALL_Y) {
        this._respawnKart(sid, { reason: "fellOff" });
      }
    }

    // Lap detection.
    if (this.finish && this.state.status === "racing") {
      const now = Date.now();
      for (const [sid, kart] of this.state.karts.entries()) {
        if (kart.finished) continue;
        const meta = this.kartMeta.get(sid);
        if (!meta) continue;
        const dx = kart.x - this.finish.x;
        const dz = kart.z - this.finish.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > HALF_TRACK_FAR_RADIUS_MM * HALF_TRACK_FAR_RADIUS_MM) {
          meta.farReached = true;
        }
        // Phase C3 \u2014 swept-segment crossing check. A fast kart can travel
        // many metres per tick, so a point-in-radius test alone can miss a
        // valid lap completion. Test whether the (prevX, prevZ) -> (x, z)
        // segment passes within FINISH_TRIGGER_RADIUS_MM of the finish.
        let crossed = false;
        if (meta.prevX !== undefined) {
          const ax = meta.prevX, az = meta.prevZ;
          const bx = kart.x, bz = kart.z;
          // Closest point on segment AB to the finish point F.
          const fx = this.finish.x, fz = this.finish.z;
          const abx = bx - ax, abz = bz - az;
          const ab2 = abx * abx + abz * abz;
          if (ab2 > 1e-3) {
            let t = ((fx - ax) * abx + (fz - az) * abz) / ab2;
            t = Math.max(0, Math.min(1, t));
            const cx = ax + abx * t, cz = az + abz * t;
            const ddx = cx - fx, ddz = cz - fz;
            if (ddx * ddx + ddz * ddz < FINISH_TRIGGER_RADIUS_MM * FINISH_TRIGGER_RADIUS_MM) {
              crossed = true;
            }
          }
        }
        meta.prevX = kart.x; meta.prevZ = kart.z;
        const inRadius = d2 < FINISH_TRIGGER_RADIUS_MM * FINISH_TRIGGER_RADIUS_MM;
        if (meta.farReached
            && (inRadius || crossed)
            && (now - meta.lastLapAt) > MIN_LAP_TIME_MS) {
          kart.lap = Math.min(255, (kart.lap | 0) + 1);
          meta.farReached = false;
          meta.lastLapAt = now;
          this.broadcast("lapComplete", {
            sessionId: sid, name: kart.name, lap: kart.lap, totalLaps: this.state.totalLaps,
          });
          if (kart.lap >= this.state.totalLaps) {
            kart.finished = true;
            kart.place = this._countFinished();
            this.broadcast("kartFinished", { sessionId: sid, name: kart.name, place: kart.place });
            if (this._allFinished()) {
              this.state.status = "finished";
              this.broadcast("raceComplete", { trackId: this.state.trackId, trackName: this.state.trackName });
            }
          }
        }
      }
    }

    // Pickup respawns.
    const now = Date.now();
    for (const [pid, respawnAt] of this.pickupRespawnAt.entries()) {
      if (respawnAt > 0 && now >= respawnAt) {
        const ps = this.state.pickups.get(pid);
        if (ps) ps.active = true;
        this.pickupRespawnAt.set(pid, 0);
      }
    }

    // Slice 2 — advance all live projectiles.
    this._tickProjectiles(now);
  }

  // ── Slice 2 + 3: Self-buff weapons ──────────────────────────────────────

  _applySelfBuff(sid, kart, weaponId, def, nowMs) {
    const effect = def.effect;
    if (effect === "mushroom") {
      kart.boostUntilMs = Math.max(kart.boostUntilMs || 0, nowMs + def.effectDuration);
      kart.boostMul = def.boostFactor;
    } else if (effect === "star") {
      kart.boostUntilMs = Math.max(kart.boostUntilMs || 0, nowMs + def.effectDuration);
      kart.boostMul = def.boostFactor;
      kart.starUntilMs = Math.max(kart.starUntilMs || 0, nowMs + def.effectDuration);
      kart.immuneUntilMs = Math.max(kart.immuneUntilMs || 0, nowMs + def.effectDuration);
    } else if (effect === "bullet_bill") {
      kart.bulletBillUntilMs = Math.max(kart.bulletBillUntilMs || 0, nowMs + def.effectDuration);
      kart.immuneUntilMs = Math.max(kart.immuneUntilMs || 0, nowMs + def.effectDuration);
      const v = this.vehicles.get(sid);
      if (v) {
        const qx = kart.qx, qy = kart.qy, qz = kart.qz, qw = kart.qw;
        const fx = 2 * (qx * qz + qw * qy);
        const fy = 2 * (qy * qz - qw * qx);
        const fz = 1 - 2 * (qx * qx + qy * qy);
        const spd = M(def.targetSpeed || 92);
        v.chassisBody.velocity.set(fx * spd, fy * spd, fz * spd);
      }
    // ── Slice 3: V8 buffs ──────────────────────────────────────────────
    } else if (effect === "v8_shield") {
      kart.shieldActive = 1;
      kart.immuneUntilMs = Math.max(kart.immuneUntilMs || 0, nowMs + (def.effectDuration || 8000));
    } else if (effect === "v8_repair") {
      kart.hp = 100;
    } else if (effect === "v8_double_dmg") {
      kart.doubleDmgUntilMs = Math.max(kart.doubleDmgUntilMs || 0, nowMs + (def.effectDuration || 5000));
    }
    this.broadcast("effectApplied", {
      sessionId: sid, effect, durationMs: def.effectDuration || 0, weaponId, ts: nowMs,
    });
  }

  // ── Slice 2: Projectile spawn helpers ────────────────────────────────

  _spawnProjectile(sid, kart, weaponId, def, data, nowMs) {
    const key = "p" + (this._projId++);
    const ps = new ProjectileState();
    ps.ownerId = sid;
    ps.subType = def.subType;
    ps.bouncesLeft = def.bounces || 0;
    ps.armed = 1;

    // Forward direction from kart quaternion (rotate local +Z)
    const qx = kart.qx, qy = kart.qy, qz = kart.qz, qw = kart.qw;
    let fx = 2 * (qx * qz + qw * qy);
    let fz = 1 - 2 * (qx * qx + qy * qy);
    const backward = data?.dir === "back";
    const dir = backward ? -1 : 1;
    const spd = M(def.speed);

    // Spread-angle offset for firethrower cone (radians in XZ plane)
    const angleOff = data?.spreadAngleOff || 0;
    if (angleOff !== 0) {
      const cos = Math.cos(angleOff), sin = Math.sin(angleOff);
      const ofx = fx * cos - fz * sin;
      const ofz = fx * sin + fz * cos;
      fx = ofx; fz = ofz;
    }

    ps.x = kart.x + fx * dir * M(1.5);
    ps.y = kart.y + M(0.3);
    ps.z = kart.z + fz * dir * M(1.5);
    ps.vx = fx * dir * spd;
    // launchUp: blue_shell, mortar, and any weapon with the field
    ps.vy = def.launchUp ? M(def.launchUp) : 0;
    ps.vz = fz * dir * spd;

    let targetId = "";
    if (def.homing) {
      if (def.targetMode === "leader") {
        let leaderSid = null, leaderScore = -1;
        for (const [tsid, tk] of this.state.karts.entries()) {
          if (tsid === sid) continue;
          const s = (tk.lap || 0) * 100000 + (tk.score || 0);
          if (s > leaderScore) { leaderScore = s; leaderSid = tsid; }
        }
        targetId = leaderSid || "";
      } else {
        let best = null, bestD2 = Infinity;
        for (const [tsid, tk] of this.state.karts.entries()) {
          if (tsid === sid) continue;
          const dx = tk.x - kart.x, dz = tk.z - kart.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bestD2) { bestD2 = d2; best = tsid; }
        }
        targetId = best || "";
      }
    }
    ps.targetId = targetId;

    this.state.projectiles.set(key, ps);
    this._projMeta.set(key, {
      expiresMs: nowMs + (def.lifespan || 6500),
      fuseMs: def.fuseMs ? nowMs + def.fuseMs : 0,
      homingArmedMs: def.homingDelayMs ? nowMs + def.homingDelayMs : 0,
      spawnProtectionMs: nowMs + 300,
      def, ownerId: sid,
      spawnX: kart.x, spawnY: kart.y, spawnZ: kart.z,
    });
    this.broadcast("projectileSpawned", {
      key, ownerId: sid, subType: def.subType, targetId, ts: nowMs,
    });
    // Warn the targeted kart when a blue shell locks on.
    if (def.subType === "blue_shell" && targetId) {
      this.broadcast("blueShellWarning", { targetId, projKey: key, ts: nowMs });
    }
  }

  _spawnBanana(sid, kart, def, data, nowMs) {
    const key = "p" + (this._projId++);
    const ps = new ProjectileState();
    ps.ownerId = sid;
    ps.subType = "banana";
    ps.bouncesLeft = 0;
    ps.armed = 1;

    const qx = kart.qx, qy = kart.qy, qz = kart.qz, qw = kart.qw;
    const fx = 2 * (qx * qz + qw * qy);
    const fz = 1 - 2 * (qx * qx + qy * qy);

    ps.x = kart.x - fx * M(1.8);
    ps.y = kart.y;
    ps.z = kart.z - fz * M(1.8);
    ps.vx = 0; ps.vy = 0; ps.vz = 0;
    ps.targetId = "";

    this.state.projectiles.set(key, ps);
    this._projMeta.set(key, {
      expiresMs: nowMs + (def.lifespan || 18000),
      fuseMs: 0, homingArmedMs: 0, spawnProtectionMs: 0,
      def, ownerId: sid,
      spawnX: kart.x, spawnY: kart.y, spawnZ: kart.z,
    });
    this.broadcast("projectileSpawned", {
      key, ownerId: sid, subType: "banana", targetId: "", ts: nowMs,
    });
  }

  // ── Slice 2: Per-tick projectile simulation ───────────────────────────

  _tickProjectiles(nowMs) {
    const dt = this.tickDt;
    const toDestroy = [];

    for (const [key, ps] of this.state.projectiles.entries()) {
      const meta = this._projMeta.get(key);
      if (!meta) { toDestroy.push(key); continue; }
      const def = meta.def;

      if (nowMs >= meta.expiresMs) { toDestroy.push(key); continue; }

      // Out-of-bounds guard (no arena wall bouncing — destroy instead)
      const sdx = ps.x - meta.spawnX, sdz = ps.z - meta.spawnZ;
      if (sdx * sdx + sdz * sdz > M(80) * M(80) || ps.y < -M(10)) {
        toDestroy.push(key); continue;
      }

      // Gravity: def.gravity is in m/s² (negative = down), SCALE converts to mm/s²
      if (def.gravity) ps.vy += def.gravity * SCALE * dt;

      // Ground bounce / resting
      if (ps.y <= M(0.4) && ps.vy < 0) {
        if (ps.bouncesLeft > 0) {
          ps.y = M(0.4);
          const retention = def.bounceRetention ?? (1 - (def.bounceLoss ?? 0));
          ps.vy = -ps.vy * retention;
          ps.vx *= retention; ps.vz *= retention;
          ps.bouncesLeft--;
        } else if (def.subType === "banana") {
          ps.vy = 0; ps.y = M(0.4); // rest on ground
        } else {
          toDestroy.push(key); continue;
        }
      }

      // Homing
      if (def.homing && nowMs >= meta.homingArmedMs && ps.targetId) {
        const tk = this.state.karts.get(ps.targetId);
        if (tk) {
          if (def.subType === "blue_shell") {
            // 3D vector homing: converge on target, ramp speed to finalSpeed
            const tDx = tk.x - ps.x, tDy = tk.y - ps.y, tDz = tk.z - ps.z;
            const tLen = Math.sqrt(tDx * tDx + tDy * tDy + tDz * tDz) || 1;
            const curSpd = Math.sqrt(ps.vx * ps.vx + ps.vy * ps.vy + ps.vz * ps.vz) || M(def.speed);
            const targetSpd = Math.min(curSpd + M(10) * dt, M(def.finalSpeed || 72));
            const alpha = Math.min(1, def.homingTurnRate * dt * 3);
            ps.vx += ((tDx / tLen) * targetSpd - ps.vx) * alpha;
            ps.vy += ((tDy / tLen) * targetSpd - ps.vy) * alpha;
            ps.vz += ((tDz / tLen) * targetSpd - ps.vz) * alpha;
          } else {
            // 2D XZ angular homing (red_shell)
            const hSpd = Math.sqrt(ps.vx * ps.vx + ps.vz * ps.vz) || M(def.speed);
            const desiredAngle = Math.atan2(tk.x - ps.x, tk.z - ps.z);
            const currentAngle = Math.atan2(ps.vx, ps.vz);
            let dAngle = desiredAngle - currentAngle;
            while (dAngle > Math.PI) dAngle -= 2 * Math.PI;
            while (dAngle < -Math.PI) dAngle += 2 * Math.PI;
            const maxTurn = def.homingTurnRate * dt;
            const turn = Math.max(-maxTurn, Math.min(maxTurn, dAngle));
            const newAngle = currentAngle + turn;
            const newSpd = def.maxSpeed
              ? Math.min(hSpd + M(3) * dt, M(def.maxSpeed))
              : hSpd;
            ps.vx = Math.sin(newAngle) * newSpd;
            ps.vz = Math.cos(newAngle) * newSpd;
          }
        }
      }

      // Integrate
      ps.x += ps.vx * dt;
      ps.y += ps.vy * dt;
      ps.z += ps.vz * dt;

      // Bob-omb fuse detonation (after movement so blast is at final pos)
      if (meta.fuseMs > 0 && nowMs >= meta.fuseMs) {
        for (const [vsid, vk] of this.state.karts.entries()) {
          const dx = vk.x - ps.x, dy = vk.y - ps.y, dz = vk.z - ps.z;
          if (Math.sqrt(dx * dx + dy * dy + dz * dz) < M(def.explosionRadius || 8.5)) {
            this._applyKnockback(vsid, vk, meta.ownerId, def, nowMs,
              { x: ps.x, y: ps.y, z: ps.z });
          }
        }
        this.broadcast("projectileExploded", {
          key, x: ps.x, y: ps.y, z: ps.z, subType: ps.subType, ts: nowMs,
        });
        toDestroy.push(key);
        continue;
      }

      // Direct hit detection (owner protected during spawn grace window)
      const hitR = M(def.radius || 0.65);
      let hit = false;
      for (const [vsid, vk] of this.state.karts.entries()) {
        if (vsid === meta.ownerId && nowMs < meta.spawnProtectionMs) continue;
        const dx = vk.x - ps.x, dy = vk.y - ps.y, dz = vk.z - ps.z;
        if (dx * dx + dy * dy + dz * dz < hitR * hitR) {
          this._applyKnockback(vsid, vk, meta.ownerId, def, nowMs, null);
          this.broadcast("projectileExploded", {
            key, x: ps.x, y: ps.y, z: ps.z, subType: ps.subType, ts: nowMs,
          });
          toDestroy.push(key);
          hit = true;
          break;
        }
      }
      if (hit) continue;
    }

    for (const key of toDestroy) {
      this.state.projectiles.delete(key);
      this._projMeta.delete(key);
    }
  }

  // ── Slice 2: Combat resolution helpers ────────────────────────────────

  _applyKnockback(victimSid, victimKart, attackerSid, def, nowMs, explosionOrigin) {
    if (nowMs < (victimKart.immuneUntilMs || 0)) return;

    // V8 Shield: absorb one hit
    if (victimKart.shieldActive) {
      victimKart.shieldActive = 0;
      victimKart.immuneUntilMs = 0;
      this.broadcast("effectApplied", {
        sessionId: victimSid, effect: "shield_broken", durationMs: 0, weaponId: "", ts: nowMs,
      });
      return;
    }

    if (def.stunMs) {
      victimKart.stunUntilMs = Math.max(victimKart.stunUntilMs || 0, nowMs + def.stunMs);
    }
    if (def.effect === "spinout" && def.effectDuration) {
      victimKart.spinUntilMs = Math.max(victimKart.spinUntilMs || 0, nowMs + def.effectDuration);
    }

    // V8 Double Damage: attacker inflicts 2× knockback
    const atkKart = attackerSid ? this.state.karts.get(attackerSid) : null;
    const ddActive = atkKart && nowMs < (atkKart.doubleDmgUntilMs || 0);

    const v = this.vehicles.get(victimSid);
    let knockback = Number(def.knockback) || 0;
    if (ddActive) knockback *= 2;
    if (v && knockback > 0) {
      let impulseX = 0, impulseZ = 0;
      if (explosionOrigin) {
        const dx = victimKart.x - explosionOrigin.x;
        const dz = victimKart.z - explosionOrigin.z;
        const d = Math.sqrt(dx * dx + dz * dz) || 1;
        impulseX = dx / d; impulseZ = dz / d;
      } else {
        if (atkKart) {
          const dx = victimKart.x - atkKart.x, dz = victimKart.z - atkKart.z;
          const d = Math.sqrt(dx * dx + dz * dz) || 1;
          impulseX = dx / d; impulseZ = dz / d;
        } else {
          const vx = v.chassisBody.velocity.x, vz = v.chassisBody.velocity.z;
          const d = Math.sqrt(vx * vx + vz * vz) || 1;
          impulseX = -vx / d; impulseZ = -vz / d;
        }
      }
      const force = M(knockback);
      v.chassisBody.velocity.x += impulseX * force;
      v.chassisBody.velocity.y += M(6);
      v.chassisBody.velocity.z += impulseZ * force;
    }

    if (attackerSid && attackerSid !== victimSid) {
      if (atkKart) atkKart.score = Math.min(65535, (atkKart.score || 0) + 1);
    }

    this.broadcast("kartImpact", {
      sourceId: attackerSid || "",
      targetId: victimSid,
      subType: def.subType || def.effect || "unknown",
      x: victimKart.x, y: victimKart.y, z: victimKart.z,
      stunMs: def.stunMs || 0,
      screenShake: !!def.screenShake,
      ts: nowMs,
    });
  }

  _checkStarContact(sid, ks, nowMs) {
    if (!this._starCooldowns) this._starCooldowns = new Map();
    const CONTACT_DIST = M(4);
    const COOLDOWN_MS = 600;
    for (const [vsid, vk] of this.state.karts.entries()) {
      if (vsid === sid) continue;
      const dx = vk.x - ks.x, dy = vk.y - ks.y, dz = vk.z - ks.z;
      if (dx * dx + dy * dy + dz * dz < CONTACT_DIST * CONTACT_DIST) {
        const coolKey = sid + ":" + vsid;
        const last = this._starCooldowns.get(coolKey) || 0;
        if (nowMs - last < COOLDOWN_MS) continue;
        this._starCooldowns.set(coolKey, nowMs);
        this._applyKnockback(vsid, vk, sid,
          { knockback: 45, stunMs: 400, screenShake: false, effect: null, subType: "star" },
          nowMs, null);
      }
    }
  }

  _billSteer(sid, ks) {
    let nearestSid = null, nearestD2 = Infinity;
    for (const [tsid, tk] of this.state.karts.entries()) {
      if (tsid === sid) continue;
      const dx = tk.x - ks.x, dz = tk.z - ks.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < nearestD2) { nearestD2 = d2; nearestSid = tsid; }
    }
    if (!nearestSid) return 0;
    const tk = this.state.karts.get(nearestSid);
    if (!tk) return 0;
    const qx = ks.qx, qy = ks.qy, qz = ks.qz, qw = ks.qw;
    const fx = 2 * (qx * qz + qw * qy);
    const fz = 1 - 2 * (qx * qx + qy * qy);
    // Right vector perpendicular to forward in XZ plane
    const rx = fz, rz = -fx;
    const dx = tk.x - ks.x, dz = tk.z - ks.z;
    const d = Math.sqrt(dx * dx + dz * dz) || 1;
    return Math.max(-1, Math.min(1, ((dx / d) * rx + (dz / d) * rz) * 2));
  }

  _countFinished() {
    let n = 0;
    for (const k of this.state.karts.values()) if (k.finished) n++;
    return n;
  }

  _allFinished() {
    if (this.state.karts.size === 0) return false;
    for (const k of this.state.karts.values()) if (!k.finished) return false;
    return true;
  }

  _writeSnapshot() {
    const nowMs = Date.now();
    for (const [sid, vehicle] of this.vehicles.entries()) {
      const ks = this.state.karts.get(sid);
      if (!ks) continue;
      const p = vehicle.chassisBody.position;
      const q = vehicle.chassisBody.quaternion;
      const v = vehicle.chassisBody.velocity;
      ks.x = p.x; ks.y = p.y; ks.z = p.z;
      ks.qx = q.x; ks.qy = q.y; ks.qz = q.z; ks.qw = q.w;
      ks.vx = v.x; ks.vy = v.y; ks.vz = v.z;
      const input = this.inputs.get(sid);
      if (input) {
        ks.lastSeq = input.seq;
        ks.throttleIn = input.throttle || 0;
        ks.brakeIn = input.brake || 0;
      }
      // Per-kart effects-driving state. Pulled from the shared
      // controlState so SP and online render the same drift/boost/
      // burnout/engine-explosion beats per kart.
      const cs = this.controlStates ? this.controlStates.get(sid) : null;
      if (cs) {
        ks.driftActive = !!cs.driftActive;
        ks.driftTier = (cs.driftTier | 0) & 0xff;
        ks.boostTimer = +cs.boostTimer || 0;
        ks.gloBurnoutT = +cs.gloBurnoutT || 0;
        ks.chargingBurnout = !!cs.chargingBurnout;
        ks.steerIn = +cs.steer || 0;
        ks.driftDir = (cs.driftDir | 0);
        ks.engineExploded = nowMs < (cs.engineExplodedUntilMs || 0);
      }
      let mask = 0;
      for (let i = 0; i < 4 && i < vehicle.wheelInfos.length; i++) {
        if (vehicle.wheelInfos[i].isInContact) mask |= (1 << i);
      }
      ks.wheelGrounded = mask;
    }
    // Slice 2 — match timer countdown (updated every snapshot, ~30Hz).
    if (this.state.status === "racing") {
      if (this._matchStartMs === 0) this._matchStartMs = nowMs;
      const elapsed = Math.floor((nowMs - this._matchStartMs) / 1000);
      const left = Math.max(0, 180 - elapsed);
      if (left !== this.state.matchSecondsLeft) {
        this.state.matchSecondsLeft = left;
        if (left === 0) {
          this.state.status = "finished";
          const scores = {};
          for (const [sid, ks] of this.state.karts.entries()) scores[sid] = ks.score || 0;
          this.broadcast("matchOver", { scores });
        }
      }
    }
  }
}
