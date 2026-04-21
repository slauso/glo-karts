/**
 * StudioRoom.js — Minimal Colyseus room for the new Track Studio.
 *
 * Responsibilities:
 *   - First client (host) seeds the track data on create.
 *   - Each client broadcasts its kart transform; server fans out to others.
 *   - State stays small; no auth, no bots, no scoring.
 *
 * Messages:
 *   client → server:
 *     "transform"  { x, y, z, qx, qy, qz, qw, vx, vy, vz, t }
 *   server → client:
 *     "trackData"  { code }              (sent on join, contains base64 track)
 *     "peerJoin"   { id, name, color }
 *     "peerLeave"  { id }
 *     "transforms" { [id]: {x,y,z,qx,qy,qz,qw,vx,vy,vz,t} }   (fanned out at 20Hz)
 */
import { Room } from "@colyseus/core";

const TICK_HZ = 20;

export class StudioRoom extends Room {
  onCreate(options = {}) {
    this.maxClients = 8;
    this.autoDispose = true;
    // Host-supplied track encoding (base64). Persisted for late joiners.
    this.trackCode = String(options.track || "");
    this.peers = new Map();   // sessionId -> { id, name, color, transform }

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
        this.broadcast("trackData", { code: this.trackCode });
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
  }

  onLeave(client) {
    this.peers.delete(client.sessionId);
    this.broadcast("peerLeave", { id: client.sessionId });
  }

  onDispose() {
    this.peers.clear();
  }
}
