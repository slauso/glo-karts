/**
 * Editor3 → Multiplayer Bridge Spike (Phase 1.5)
 *
 * GOAL: Prove that the editor3 cannon-es kart physics can be wrapped in a
 *       Colyseus room that authoritatively simulates the world server-side
 *       and broadcasts snapshots to clients. This is the architecture the
 *       project is moving toward (one engine end-to-end, replacing the
 *       Babylon + Havok multiplayer stack).
 *
 * SCOPE (intentionally tiny):
 *   - 1 room class (Editor3BridgeRoom)
 *   - cannon-es World with ground plane + tile floor (mirrors spike A setup)
 *   - 1 RaycastVehicle per player (simplified — no wheels-as-meshes; chassis only)
 *   - Player input message: { seq, throttle, brake, steer }
 *   - Server tick at 60Hz; snapshot broadcast at 20Hz via schema
 *   - Schema: Map<sessionId -> KartState{x,y,z,qx,qy,qz,qw,vx,vy,vz,lastSeq}>
 *
 * NOT IN SCOPE:
 *   - Client-side prediction (smoke client just records what server sends)
 *   - Lag compensation / rewinding
 *   - Weapons / combat (Phase 2 — handled by combat-runtime.js)
 *   - Track JSON ingestion (uses the spike-A tile world)
 *
 * USAGE:
 *   node realtime/spikes/editor3-bridge/server.mjs              # default port 2568
 *   node realtime/spikes/editor3-bridge/server.mjs --port=2569
 *
 * Then in another terminal:
 *   node realtime/spikes/editor3-bridge/smoke-client.mjs
 */

import http from 'node:http';
import { Server, Room } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Schema, MapSchema, type } from '@colyseus/schema';
import * as CANNON from 'cannon-es';

// ── Args ────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const PORT = parseInt(args.port ?? 2568, 10);
const TICK_HZ = parseInt(args.hz ?? 60, 10);
const SNAPSHOT_HZ = parseInt(args['snapshot-hz'] ?? 20, 10);

// ── Physics constants (mirrors spike A / editor3) ───────────────────
const TILE = 36;
const KART_MASS = 150;
const CHASSIS_HX = 0.6, CHASSIS_HY = 0.3, CHASSIS_HZ = 1.0;
const WHEEL_RADIUS = 0.4;
const MAX_ENGINE = 1700;
const MAX_BRAKE = 28;

// ── Colyseus schema ─────────────────────────────────────────────────
class KartState extends Schema {}
type('number')(KartState.prototype, 'x');
type('number')(KartState.prototype, 'y');
type('number')(KartState.prototype, 'z');
type('number')(KartState.prototype, 'qx');
type('number')(KartState.prototype, 'qy');
type('number')(KartState.prototype, 'qz');
type('number')(KartState.prototype, 'qw');
type('number')(KartState.prototype, 'vx');
type('number')(KartState.prototype, 'vy');
type('number')(KartState.prototype, 'vz');
type('uint32')(KartState.prototype, 'lastSeq');

class WorldState extends Schema {}
type({ map: KartState })(WorldState.prototype, 'karts');

// ── Physics helpers ─────────────────────────────────────────────────
function buildWorld() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  world.defaultContactMaterial.friction = 0.4;

  // Ground
  const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
  ground.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
  world.addBody(ground);

  // Tile floor 6x6 — mirrors editor3 segment grid
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      const body = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Box(new CANNON.Vec3(TILE / 2, 0.25, TILE / 2)),
      });
      body.position.set(i * TILE, 0, j * TILE);
      world.addBody(body);
    }
  }
  return world;
}

function spawnVehicle(world, x, z) {
  const chassis = new CANNON.Body({ mass: KART_MASS });
  chassis.addShape(new CANNON.Box(new CANNON.Vec3(CHASSIS_HX, CHASSIS_HY, CHASSIS_HZ)));
  chassis.position.set(x, 1.5, z);
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
export class Editor3BridgeRoom extends Room {
  onCreate() {
    this.setState(new WorldState());
    this.state.karts = new MapSchema();

    this.world = buildWorld();
    this.vehicles = new Map();   // sessionId -> RaycastVehicle
    this.inputs = new Map();     // sessionId -> { seq, throttle, brake, steer }

    this.tickDt = 1 / TICK_HZ;
    this.snapshotDt = 1 / SNAPSHOT_HZ;
    this.tickCount = 0;
    this.snapshotCount = 0;
    this.lastTickHr = process.hrtime.bigint();
    this.tickDurations = [];

    this.onMessage('input', (client, msg) => {
      // {seq:uint32, throttle:0..1, brake:0..1, steer:-1..1}
      this.inputs.set(client.sessionId, {
        seq: (msg && msg.seq) | 0,
        throttle: clamp01(msg?.throttle ?? 0),
        brake: clamp01(msg?.brake ?? 0),
        steer: clampSym(msg?.steer ?? 0),
      });
    });

    // Tick loop — production-ready pattern: hrtime + setImmediate.
    this.tickHandle = setInterval(() => this._tick(), this.tickDt * 1000);
    // Snapshot pacing (state writes are coalesced by Colyseus' patchRate;
    // we explicitly write at SNAPSHOT_HZ to keep the schema deltas predictable).
    this.snapshotHandle = setInterval(() => this._writeSnapshot(), this.snapshotDt * 1000);

    console.log(`[Editor3BridgeRoom] created — tick=${TICK_HZ}Hz, snapshot=${SNAPSHOT_HZ}Hz`);
  }

  onJoin(client) {
    const idx = this.vehicles.size;
    const x = (idx % 4) * 4 + 8;
    const z = Math.floor(idx / 4) * 4 + 8;
    const vehicle = spawnVehicle(this.world, x, z);
    this.vehicles.set(client.sessionId, vehicle);

    const ks = new KartState();
    ks.x = x; ks.y = 1.5; ks.z = z;
    ks.qx = 0; ks.qy = 0; ks.qz = 0; ks.qw = 1;
    ks.vx = 0; ks.vy = 0; ks.vz = 0;
    ks.lastSeq = 0;
    this.state.karts.set(client.sessionId, ks);

    this.inputs.set(client.sessionId, { seq: 0, throttle: 0, brake: 0, steer: 0 });
    console.log(`[Editor3BridgeRoom] join ${client.sessionId} @(${x},${z}) — total=${this.vehicles.size}`);
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
    console.log(`[Editor3BridgeRoom] leave ${client.sessionId} — remaining=${this.vehicles.size}`);
  }

  onDispose() {
    clearInterval(this.tickHandle);
    clearInterval(this.snapshotHandle);
    if (this.tickDurations.length) {
      const sorted = [...this.tickDurations].sort((a, b) => a - b);
      const p = (q) => sorted[Math.floor(sorted.length * q)] ?? 0;
      console.log(`[Editor3BridgeRoom] disposed — ticks=${this.tickCount}, p50=${p(0.5).toFixed(2)}ms, p95=${p(0.95).toFixed(2)}ms, p99=${p(0.99).toFixed(2)}ms`);
    }
  }

  _tick() {
    // Apply inputs
    for (const [sid, input] of this.inputs.entries()) {
      const v = this.vehicles.get(sid);
      if (!v) continue;
      const eng = input.throttle * MAX_ENGINE - input.brake * MAX_BRAKE * 50;
      v.applyEngineForce(eng, 2);
      v.applyEngineForce(eng, 3);
      v.setSteeringValue(input.steer * 0.5, 0);
      v.setSteeringValue(input.steer * 0.5, 1);
      v.setBrake(input.brake * MAX_BRAKE, 0);
      v.setBrake(input.brake * MAX_BRAKE, 1);
      v.setBrake(input.brake * MAX_BRAKE, 2);
      v.setBrake(input.brake * MAX_BRAKE, 3);
    }

    const t0 = process.hrtime.bigint();
    this.world.step(this.tickDt, this.tickDt, 3);
    const dur = Number(process.hrtime.bigint() - t0) / 1e6;
    this.tickDurations.push(dur);
    if (this.tickDurations.length > 1200) this.tickDurations.shift();
    this.tickCount++;
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
    this.snapshotCount++;
  }
}

function clamp01(n) { return Math.max(0, Math.min(1, Number(n) || 0)); }
function clampSym(n) { return Math.max(-1, Math.min(1, Number(n) || 0)); }

// ── Boot ────────────────────────────────────────────────────────────
const server = http.createServer();
const gameServer = new Server({ transport: new WebSocketTransport({ server }) });
gameServer.define('editor3_bridge', Editor3BridgeRoom);

gameServer.listen(PORT).then(() => {
  console.log(`[spike] editor3-bridge server listening on ws://localhost:${PORT}`);
  console.log('[spike] room: editor3_bridge');
});
