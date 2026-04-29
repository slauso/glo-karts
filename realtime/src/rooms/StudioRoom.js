/**
 * StudioRoom.js — Minimal Colyseus room for the new Track Studio.
 *
 * Responsibilities:
 *   - First client (host) seeds the track data on create.
 *   - Each client broadcasts its kart transform; server fans out to others.
 *   - State stays small; no auth, no bots, no scoring.
 *   - Combat overlays (Phase 1): server holds authoritative pickup state
 *     so all 8 clients see consistent collection + respawn timing.
 *
 * Messages:
 *   client → server:
 *     "transform"  { x, y, z, qx, qy, qz, qw, vx, vy, vz, t }
 *   server → client:
 *     "trackData"   { code }              (sent on join, contains base64 track)
 *     "peerJoin"    { id, name, color }
 *     "peerLeave"   { id }
 *     "transforms"  { [id]: {x,y,z,qx,qy,qz,qw,vx,vy,vz,t} }   (fanned out at 20Hz)
 *     "combatInit"  { pickups: [{ id, key, x, z, payload, ready }], effects: [{ id, key, x, z, effect }] }
 *     "pickupUpdate"{ id, ready, respawnAt }
 *     "pickupGrant" { id, sessionId, payload, amount }
 *     "effectFired" { id, sessionId, effect, ... }   (broadcast to all so clients can play SFX)
 */
import { Room } from "@colyseus/core";
import { decodeTrack } from "../../../frontend/src/editor3/track-data.js";
import {
  buildCombatState, sweepKart, tickRespawns,
} from "../../../frontend/src/editor3/combat-runtime.js";

const TICK_HZ = 20;
const COMBAT_HZ = 30;        // sweep often enough to catch fast karts
const RESPAWN_HZ = 5;        // re-arm pickups in coarse ticks

export class StudioRoom extends Room {
  onCreate(options = {}) {
    this.maxClients = 8;
    this.autoDispose = true;
    // Host-supplied track encoding (base64). Persisted for late joiners.
    this.trackCode = String(options.track || "");
    this.peers = new Map();   // sessionId -> { id, name, color, transform }
    // Authoritative combat state — Map<id, entity>. Built lazily once
    // we have a track to decode. Re-built whenever the host re-seeds.
    this.combat = new Map();
    this._lastSeenTrackCode = "";
    this._rebuildCombatFromCode();

    this.onMessage("transform", (client, data = {}) => {
      const peer = this.peers.get(client.sessionId);
      if (!peer) return;
      // Sanitize inputs to numbers, drop NaN
      const t = {};
      for (const k of ["x", "y", "z", "qx", "qy", "qz", "qw", "vx", "vy", "vz"]) {
        const v = Number(data[k]);
        t[k] = Number.isFinite(v) ? v : 0;
      }
      t.t = Date.now();
      peer.transform = t;
    });

    this.onMessage("track", (client, data = {}) => {
      // Allow host (first peer) to update the track in case they didn't pass it on create
      const peers = Array.from(this.peers.values());
      if (peers.length && peers[0].sessionId !== client.sessionId) return;
      if (typeof data.code === "string" && data.code.length < 50000) {
        this.trackCode = data.code;
        this._rebuildCombatFromCode();
        this.broadcast("trackData", { code: this.trackCode });
        this._broadcastCombatInit();
      }
    });

    // Fan-out loop
    this.setSimulationInterval(() => {
      const transforms = {};
      for (const [sid, peer] of this.peers) {
        if (peer.transform) transforms[sid] = peer.transform;
      }
      this.broadcast("transforms", transforms);
    }, Math.round(1000 / TICK_HZ));

    // Combat sweep — server is authoritative for pickup grants. Each
    // peer's most-recent transform.x/.z is swept against the pickup
    // state; first grab wins. Effects also broadcast so every client
    // plays the SFX even if their local prediction missed it.
    this.setSimulationInterval(() => {
      if (this.combat.size === 0) return;
      const now = Date.now();
      for (const [sid, peer] of this.peers) {
        if (!peer.transform) continue;
        const events = sweepKart(this.combat, peer.transform.x, peer.transform.z, now);
        for (const ev of events) {
          if (ev.type === "pickup") {
            this.broadcast("pickupGrant", {
              id: ev.id, sessionId: sid,
              payload: ev.payload, amount: ev.amount,
            });
            const ent = this.combat.get(ev.id);
            if (ent) {
              this.broadcast("pickupUpdate", {
                id: ent.id, ready: ent.ready, respawnAt: ent.respawnAt,
              });
            }
          } else if (ev.type === "effect") {
            this.broadcast("effectFired", {
              id: ev.id, sessionId: sid,
              effect: ev.effect, strength: ev.strength,
              durationMs: ev.durationMs, amount: ev.amount,
              amountPerSec: ev.amountPerSec,
            });
          }
        }
      }
    }, Math.round(1000 / COMBAT_HZ));

    // Respawn loop — coarse, just re-arms cooled-down pickups.
    this.setSimulationInterval(() => {
      if (this.combat.size === 0) return;
      const now = Date.now();
      const ready = tickRespawns(this.combat, now);
      for (const r of ready) {
        const ent = this.combat.get(r.id);
        if (!ent) continue;
        this.broadcast("pickupUpdate", {
          id: ent.id, ready: true, respawnAt: 0,
        });
      }
    }, Math.round(1000 / RESPAWN_HZ));
  }

  _rebuildCombatFromCode() {
    if (!this.trackCode || this.trackCode === this._lastSeenTrackCode) return;
    this._lastSeenTrackCode = this.trackCode;
    let decoded = null;
    try { decoded = decodeTrack(this.trackCode); } catch (_) { decoded = null; }
    if (!decoded) { this.combat = new Map(); return; }
    this.combat = buildCombatState(decoded.all());
  }

  _broadcastCombatInit(client = null) {
    const pickups = [];
    const effects = [];
    for (const e of this.combat.values()) {
      const base = { id: e.id, key: e.key, x: e.worldX, z: e.worldZ };
      if (e.kind === "pickup") {
        pickups.push({ ...base, payload: e.payload, ready: e.ready, respawnAt: e.respawnAt });
      } else if (e.kind === "effect") {
        effects.push({ ...base, effect: e.effect });
      }
    }
    const payload = { pickups, effects };
    if (client) client.send("combatInit", payload);
    else this.broadcast("combatInit", payload);
  }

  onJoin(client, options = {}) {
    const peer = {
      sessionId: client.sessionId,
      id: client.sessionId,
      name: String(options.name || "Racer").slice(0, 24),
      color: String(options.color || "#ff3aa1"),
      kart: String(options.kart || "mechatux").slice(0, 32),
      transform: null,
    };
    this.peers.set(client.sessionId, peer);

    // Late joiners receive the existing track (if host already seeded one)
    if (this.trackCode) client.send("trackData", { code: this.trackCode });
    // Tell the new joiner about everyone already here
    for (const other of this.peers.values()) {
      if (other.sessionId === client.sessionId) continue;
      client.send("peerJoin", { id: other.id, name: other.name, color: other.color, kart: other.kart });
    }
    // And announce them to everyone
    this.broadcast("peerJoin", { id: peer.id, name: peer.name, color: peer.color, kart: peer.kart }, { except: client });
    // Send full combat snapshot so the new client knows which pickups are
    // currently armed / cooling down.
    if (this.combat.size > 0) this._broadcastCombatInit(client);
  }

  onLeave(client) {
    this.peers.delete(client.sessionId);
    this.broadcast("peerLeave", { id: client.sessionId });
  }

  onDispose() {
    this.peers.clear();
  }
}
