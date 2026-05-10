/**
 * Editor3RaceRoom — Authoritative race room driven by editor3 cannon-es.
 *
 * Promoted from realtime/spikes/editor3-bridge/server.mjs (Phase 1.5 spike).
 * The spike proved the engine pattern; this room adds Track Studio integration:
 *
 *   onCreate(options) accepts:
 *     - { trackData }  : inline editor3 Track JSON (wire or backend envelope)
 *     - { trackId }    : UUID — fetched from backend via fetchTrack()
 *     - {}             : falls back to a tiny default arena (smoke parity)
 *
 * Architecture:
 *   - 60Hz authoritative tick (cannon-es World)
 *   - 20Hz state snapshot (Colyseus schema deltas)
 *   - One CANNON.RaycastVehicle per session
 *   - Karts spawn at the loaded track's `isSpawn` placements (round-robin),
 *     falling back to the first placement when a track lacks spawns.
 *
 * NOT YET IN SCOPE (deferred to subsequent phases):
 *   - Lap counting / finish-line crossings
 *   - Combat / pickups
 *   - Lag compensation / client-side reconciliation refinement
 */
import { Room } from "@colyseus/core";
import { Schema, MapSchema, type } from "@colyseus/schema";
import * as CANNON from "cannon-es";
import { buildWorldFromTrackData, buildDefaultArena } from "../track/track-loader.js";
import { fetchTrack } from "../track/backend-client.js";
import { log } from "../logger.js";

const TICK_HZ = 60;
const SNAPSHOT_HZ = 20;
const KART_MASS = 150;
const CHASSIS_HX = 0.6, CHASSIS_HY = 0.3, CHASSIS_HZ = 1.0;
const WHEEL_RADIUS = 0.4;
const MAX_ENGINE = 1700;
const MAX_BRAKE = 28;
const MAX_PLAYERS = 8;

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

class Editor3WorldState extends Schema {
  constructor() {
    super();
    this.karts = new MapSchema();
  }
}
type({ map: KartState })(Editor3WorldState.prototype, "karts");
type("string")(Editor3WorldState.prototype, "trackId");
type("string")(Editor3WorldState.prototype, "trackName");

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

// ── Room ────────────────────────────────────────────────────────────
export class Editor3RaceRoom extends Room {
  static maxClients = MAX_PLAYERS;

  async onCreate(options = {}) {
    this.maxClients = MAX_PLAYERS;
    this.setState(new Editor3WorldState());

    this.world = makeWorld();
    this.vehicles = new Map();    // sessionId -> RaycastVehicle
    this.inputs = new Map();      // sessionId -> { seq, throttle, brake, steer }
    this.spawnCursor = 0;
    this.tickDt = 1 / TICK_HZ;
    this.snapshotDt = 1 / SNAPSHOT_HZ;
    this.tickDurations = [];

    // Resolve track source
    let trackData = options.trackData ?? null;
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
      this.state.trackId = trackId;
      this.state.trackName = trackData?.track?.name || trackData?.name || "(custom)";
    } else {
      const result = buildDefaultArena(this.world);
      this.spawns = result.spawns;
      this.finish = null;
      this.state.trackId = "";
      this.state.trackName = "(default arena)";
    }

    this.onMessage("input", (client, msg) => {
      this.inputs.set(client.sessionId, {
        seq: (msg && msg.seq) | 0,
        throttle: clamp01(msg?.throttle ?? 0),
        brake: clamp01(msg?.brake ?? 0),
        steer: clampSym(msg?.steer ?? 0),
      });
    });

    this.tickHandle = setInterval(() => this._tick(), this.tickDt * 1000);
    this.snapshotHandle = setInterval(() => this._writeSnapshot(), this.snapshotDt * 1000);

    log("info", "editor3_room_create", {
      roomId: this.roomId, trackId, trackName: this.state.trackName, spawns: this.spawns.length,
    });
  }

  onJoin(client) {
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
    this.state.karts.set(client.sessionId, ks);
    this.inputs.set(client.sessionId, { seq: 0, throttle: 0, brake: 0, steer: 0 });
    log("info", "editor3_room_join", { roomId: this.roomId, sessionId: client.sessionId, total: this.vehicles.size });
  }

  onLeave(client) {
    const v = this.vehicles.get(client.sessionId);
    if (v) {
      v.removeFromWorld(this.world);
      this.world.removeBody(v.chassisBody);
    }
    this.vehicles.delete(client.sessionId);
    this.inputs.delete(client.sessionId);
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
