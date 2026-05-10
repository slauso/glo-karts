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
import { buildWorldFromTrackData, buildDefaultArena } from "../track/track-loader.js";
import { fetchTrack } from "../track/backend-client.js";
import { RACE_WEAPON_POOL, WEAPONS, grantWeapon, swapSecondaryWeapon } from "../combat.js";
import { log } from "../logger.js";

const TICK_HZ = 60;
const SNAPSHOT_HZ = 20;
const KART_MASS = 150;
const CHASSIS_HX = 0.6, CHASSIS_HY = 0.3, CHASSIS_HZ = 1.0;
const WHEEL_RADIUS = 0.4;
const MAX_ENGINE = 1700;
const MAX_BRAKE = 28;
const MAX_PLAYERS = 8;
const SCALE = 1000; // mm/m — must match SEGMENT_SCALE in segment-physics.js
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
type("uint8")(KartState.prototype, "lap");
type("uint8")(KartState.prototype, "place");
type("boolean")(KartState.prototype, "finished");
type("string")(KartState.prototype, "weapon2");
type("uint8")(KartState.prototype, "ammo2");
type("string")(KartState.prototype, "weapon3");
type("uint8")(KartState.prototype, "ammo3");

class PickupState extends Schema {}
type("number")(PickupState.prototype, "x");
type("number")(PickupState.prototype, "y");
type("number")(PickupState.prototype, "z");
type("boolean")(PickupState.prototype, "active");
type("string")(PickupState.prototype, "kind");

class Editor3WorldState extends Schema {
  constructor() {
    super();
    this.karts = new MapSchema();
    this.pickups = new MapSchema();
  }
}
type({ map: KartState })(Editor3WorldState.prototype, "karts");
type({ map: PickupState })(Editor3WorldState.prototype, "pickups");
type("string")(Editor3WorldState.prototype, "trackId");
type("string")(Editor3WorldState.prototype, "trackName");
type("string")(Editor3WorldState.prototype, "lobbyCode");
type("uint8")(Editor3WorldState.prototype, "totalLaps");
type("string")(Editor3WorldState.prototype, "status"); // "racing" | "finished"

// ── Helpers ─────────────────────────────────────────────────────────
function clamp01(n) { return Math.max(0, Math.min(1, Number(n) || 0)); }
function clampSym(n) { return Math.max(-1, Math.min(1, Number(n) || 0)); }

function makeWorld() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  world.defaultContactMaterial.friction = 0.4;
  return world;
}

function spawnVehicle(world, pose) {
  const chassis = new CANNON.Body({ mass: KART_MASS });
  chassis.addShape(new CANNON.Box(new CANNON.Vec3(CHASSIS_HX, CHASSIS_HY, CHASSIS_HZ)));
  chassis.position.set(pose.x, pose.y, pose.z);
  chassis.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), pose.heading || 0);
  chassis.angularDamping = 0.2;
  world.addBody(chassis);

  const vehicle = new CANNON.RaycastVehicle({
    chassisBody: chassis,
    indexRightAxis: 0,
    indexUpAxis: 1,
    indexForwardAxis: 2,
  });
  const wheelOpts = {
    radius: WHEEL_RADIUS,
    directionLocal: new CANNON.Vec3(0, -1, 0),
    suspensionStiffness: 30,
    suspensionRestLength: 0.3,
    frictionSlip: 1.5,
    dampingRelaxation: 2.3,
    dampingCompression: 4.4,
    maxSuspensionForce: 100000,
    rollInfluence: 0.01,
    axleLocal: new CANNON.Vec3(-1, 0, 0),
    chassisConnectionPointLocal: new CANNON.Vec3(),
    maxSuspensionTravel: 0.3,
    customSlidingRotationalSpeed: -30,
    useCustomSlidingRotationalSpeed: true,
  };
  const dx = CHASSIS_HX, dz = CHASSIS_HZ - 0.2;
  for (const [px, pz] of [[-dx, dz], [dx, dz], [-dx, -dz], [dx, -dz]]) {
    wheelOpts.chassisConnectionPointLocal = new CANNON.Vec3(px, 0, pz);
    vehicle.addWheel({ ...wheelOpts });
  }
  vehicle.addToWorld(world);
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
      const result = buildWorldFromTrackData(this.world, trackData);
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
        throttle: clamp01(msg?.throttle ?? 0),
        brake: clamp01(msg?.brake ?? 0),
        steer: clampSym(msg?.steer ?? 0),
      });
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
      if (slot === "reserve") kart.ammo3 = Math.max(0, ammo - 1);
      else kart.ammo2 = Math.max(0, ammo - 1);
      this.broadcast("projectileFired", {
        ownerId: client.sessionId,
        weapon: weaponId,
        category: def.category || "projectile",
        x: kart.x, y: kart.y, z: kart.z,
        qx: kart.qx, qy: kart.qy, qz: kart.qz, qw: kart.qw,
      });
    });

    this.tickHandle = setInterval(() => this._tick(), this.tickDt * 1000);
    this.snapshotHandle = setInterval(() => this._writeSnapshot(), this.snapshotDt * 1000);

    log("info", "editor3_room_create", {
      roomId: this.roomId, trackId, trackName: this.state.trackName,
      spawns: this.spawns.length, pickups: this.pickupSpawns.length,
      laps: this.state.totalLaps, hasFinish: !!this.finish, weapons: this.weaponPool.length,
    });
  }

  onJoin(client, options = {}) {
    const pose = this.spawns[this.spawnCursor % this.spawns.length] || { x: 0, y: 1.5, z: 0, heading: 0 };
    this.spawnCursor++;
    const vehicle = spawnVehicle(this.world, pose);
    this.vehicles.set(client.sessionId, vehicle);

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
    ks.lap = 0; ks.place = 1; ks.finished = false;
    ks.weapon2 = ""; ks.ammo2 = 0;
    ks.weapon3 = ""; ks.ammo3 = 0;
    this.state.karts.set(client.sessionId, ks);

    this.inputs.set(client.sessionId, { seq: 0, throttle: 0, brake: 0, steer: 0 });
    this.kartMeta.set(client.sessionId, { lastLapAt: Date.now(), farReached: !this.finish });
    log("info", "editor3_room_join", {
      roomId: this.roomId, sessionId: client.sessionId, name: ks.name, total: this.vehicles.size,
    });
  }

  onLeave(client) {
    const v = this.vehicles.get(client.sessionId);
    if (v) {
      v.removeFromWorld(this.world);
      this.world.removeBody(v.chassisBody);
    }
    this.vehicles.delete(client.sessionId);
    this.inputs.delete(client.sessionId);
    this.kartMeta.delete(client.sessionId);
    this.state.karts.delete(client.sessionId);
    log("info", "editor3_room_leave", { roomId: this.roomId, sessionId: client.sessionId, remaining: this.vehicles.size });
  }

  onDispose() {
    clearInterval(this.tickHandle);
    clearInterval(this.snapshotHandle);
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

  _tick() {
    for (const [sid, input] of this.inputs.entries()) {
      const v = this.vehicles.get(sid);
      if (!v) continue;
      const eng = input.throttle * MAX_ENGINE - input.brake * MAX_BRAKE * 50;
      v.applyEngineForce(eng, 2);
      v.applyEngineForce(eng, 3);
      v.setSteeringValue(input.steer * 0.5, 0);
      v.setSteeringValue(input.steer * 0.5, 1);
      for (let w = 0; w < 4; w++) v.setBrake(input.brake * MAX_BRAKE, w);
    }
    const t0 = process.hrtime.bigint();
    this.world.step(this.tickDt, this.tickDt, 3);
    const dur = Number(process.hrtime.bigint() - t0) / 1e6;
    this.tickDurations.push(dur);
    if (this.tickDurations.length > 1200) this.tickDurations.shift();

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
        if (meta.farReached
            && d2 < FINISH_TRIGGER_RADIUS_MM * FINISH_TRIGGER_RADIUS_MM
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
      if (input) ks.lastSeq = input.seq;
    }
  }
}
