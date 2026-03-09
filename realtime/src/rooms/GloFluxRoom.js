/**
 * GloFluxRoom.js — Colyseus room for gloFLUX multiplayer.
 *
 * Authoritative server for 8-12 player gloFLUX matches.
 * Handles: player management, power-up spawn/collection validation,
 * surge verification, boundary shrink, apocalypse broadcast, scoring.
 */

import { Room } from "@colyseus/core";
import { GloFluxState, GloFluxPowerSpawn } from "../schema/GloFluxState.js";
import { PlayerState } from "../schema/PlayerState.js";
import { RateLimiter, sanitizePosition } from "../server-guard.js";
import { log } from "../logger.js";

const TICK_RATE = 1000 / 60;        // 60 Hz
const ACCEL = 20;
const DRAG = 0.9;
const SHRINK_RATE = 0.3;            // units per second
const POWER_RESPAWN_SEC = 8;
const COLLECTION_RADIUS_SQ = 9;     // 3 units squared
const MAX_SURGE = 100;
const APOCALYPSE_DAMAGE = 30;

function safeNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safeUnit(v, fallback = 0) {
  return Math.max(-1, Math.min(1, safeNumber(v, fallback)));
}

// Simple power-up pool for server-side draws
const POWER_IDS = [
  'echo_phantom','quantum_duplicate','neural_hijack','symbiote_swarm',
  'gravity_well','dimensional_rift','entropy_cascade','weather_dominion',
  'phase_shift','bio_regen_cocoon','fractal_duplication','symbiotic_overgrowth',
  'paradox_loop','psyche_fracture','chronal_echo','mutation_surge',
  'rogue_ai_companion','rhythm_pulse','karmic_reversal','ecosystem_hack',
];

function randomPowerId() {
  return POWER_IDS[Math.floor(Math.random() * POWER_IDS.length)];
}

export class GloFluxRoom extends Room {
  onCreate(options = {}) {
    const state = new GloFluxState();
    state.variant = options.variant || 'arena';
    state.arenaTheme = options.arenaTheme || 'nuclear_desert';
    state.hostSessionId = '';
    state.shrinkRadius = 60;
    this.setState(state);

    this.maxClients = Math.min(Number(options.maxPlayers) || 12, 12);
    this.inputBySession = new Map();
    this._rateLimiter = new RateLimiter();
    this._countdownActive = false;
    this._powerRespawnTimers = [];

    // Generate initial power spawn points (server-side grid)
    this._initPowerSpawns();

    // ── Messages ──────────────────────────────────────────────

    this.onMessage("input", (client, data) => {
      if (!this._rateLimiter.allow(client.sessionId, 'input', 120)) return;
      this.inputBySession.set(client.sessionId, {
        f: safeUnit(data?.f),
        s: safeUnit(data?.s),
        b: safeUnit(data?.b),
        p: typeof data?.p === 'string' ? data.p : null,
      });
    });

    this.onMessage("collectPower", (client, data) => {
      if (!this._rateLimiter.allow(client.sessionId, 'collect', 10)) return;
      this._handleCollectPower(client, data);
    });

    this.onMessage("surgeSync", (client, data) => {
      if (!this._rateLimiter.allow(client.sessionId, 'surge', 30)) return;
      const v = safeNumber(data?.v);
      if (v < 0 || v > MAX_SURGE + 5) return; // sanity
      this.broadcast('surgeBroadcast', { sessionId: client.sessionId, v }, { except: client });
    });

    this.onMessage("mutationSync", (client, data) => {
      if (!this._rateLimiter.allow(client.sessionId, 'mutation', 10)) return;
      if (typeof data !== 'object') return;
      this.broadcast('mutationBroadcast', { sessionId: client.sessionId, ...data }, { except: client });
    });

    this.onMessage("apocalypse", (client) => {
      if (!this._rateLimiter.allow(client.sessionId, 'apocalypse', 2)) return;
      const player = this.state.players.get(client.sessionId);
      if (!player || player.health <= 0) return;
      // Damage all other players
      this.state.players.forEach((p, sid) => {
        if (sid !== client.sessionId && p.health > 0) {
          p.health = Math.max(0, p.health - APOCALYPSE_DAMAGE);
        }
      });
      this.broadcast('apocalypseTriggered', { sessionId: client.sessionId });
      log(`[GloFlux] Apocalypse by ${client.sessionId}`);
    });

    this.onMessage("triggerStart", (client) => {
      if (this.state.hostSessionId && client.sessionId !== this.state.hostSessionId) return;
      if (this.state.started || this._countdownActive) return;
      this._startCountdown();
    });

    // ── Tick ──────────────────────────────────────────────────

    this.setSimulationInterval(() => this._tick(), TICK_RATE);

    log(`[GloFlux] Room created: variant=${state.variant}, theme=${state.arenaTheme}`);
  }

  onJoin(client, options) {
    const p = new PlayerState();
    p.id = client.sessionId;
    p.name = String(options?.name || "Player").substring(0, 20);
    p.kartId = String(options?.kartId || "tux").substring(0, 30);
    p.playerColor = String(options?.playerColor || "red").substring(0, 20);
    p.gloEffect = String(options?.gloEffect || "solid").substring(0, 32);
    p.gloColor = String(options?.gloColor || "#ff0080").substring(0, 16);
    p.gloColor2 = String(options?.gloColor2 || "#00e5ff").substring(0, 16);
    const playerIndex = this.state.players.size;
    const spawnAngle = (playerIndex / Math.max(this.maxClients, 1)) * Math.PI * 2;
    const spawnRadius = 14;
    p.x = Math.cos(spawnAngle) * spawnRadius;
    p.z = Math.sin(spawnAngle) * spawnRadius;
    p.ry = spawnAngle + Math.PI;
    p.health = 100;
    this.state.players.set(client.sessionId, p);
    if (!this.state.hostSessionId) {
      this.state.hostSessionId = client.sessionId;
    }
    this.inputBySession.set(client.sessionId, { f: 0, s: 0, b: 0, p: null });
    log(`[GloFlux] ${p.name} joined (${client.sessionId})`);
  }

  onLeave(client, consented) {
    this.state.players.delete(client.sessionId);
    this.inputBySession.delete(client.sessionId);
    if (this.state.hostSessionId === client.sessionId) {
      const next = this.state.players.keys().next();
      this.state.hostSessionId = next.done ? '' : next.value;
    }
    log(`[GloFlux] ${client.sessionId} left (consented=${consented})`);
  }

  onDispose() {
    log("[GloFlux] Room disposed");
  }

  // ── Internal ────────────────────────────────────────────────

  _startCountdown() {
    this._countdownActive = true;
    const durationMs = 4000;
    this.broadcast("countdown", { durationMs, serverNow: Date.now() });
    this.clock.setTimeout(() => {
      this.state.started = true;
      this._countdownActive = false;
      this.broadcast("matchLive", {});
    }, durationMs);
  }

  _tick() {
    if (!this.state.started) return;
    const dt = TICK_RATE / 1000;
    this.state.serverTime = Date.now();
    this.state.elapsed += dt;

    // Shrink boundary (arena mode)
    if (this.state.variant === 'arena' && this.state.shrinkRadius > 5) {
      this.state.shrinkRadius = Math.max(5, this.state.shrinkRadius - SHRINK_RATE * dt);
    }

    // Process inputs & physics
    this.state.players.forEach((player, sid) => {
      if (player.health <= 0) return;

      const input = this.inputBySession.get(sid) || { f: 0, s: 0, b: 0 };

      // Simple authoritative physics
      const accel = input.f * ACCEL;
      const steer = input.s * 2.5;

      player.vx = safeNumber(player.vx) * DRAG + Math.sin(safeNumber(player.ry)) * accel * dt;
      player.vz = safeNumber(player.vz) * DRAG + Math.cos(safeNumber(player.ry)) * accel * dt;

      player.x += player.vx * dt;
      player.z += player.vz * dt;
      player.ry = safeNumber(player.ry) + steer * dt;

      // Boundary damage (arena mode)
      if (this.state.variant === 'arena') {
        const distSq = player.x * player.x + player.z * player.z;
        const rSq = this.state.shrinkRadius * this.state.shrinkRadius;
        if (distSq > rSq) {
          player.health = Math.max(0, player.health - 20 * dt);
        }
      }
    });

    // Power respawn timers
    this._tickPowerRespawns(dt);

    // Check for game over
    this._checkGameOver();
  }

  _initPowerSpawns() {
    // Grid of power spawn points across the arena
    const positions = [];
    const halfSize = 50;
    const spacing = 15;
    for (let x = -halfSize; x <= halfSize; x += spacing) {
      for (let z = -halfSize; z <= halfSize; z += spacing) {
        positions.push({ x, z });
      }
    }
    // Pick 15 random positions
    const shuffled = positions.sort(() => Math.random() - 0.5).slice(0, 15);
    for (const pos of shuffled) {
      const spawn = new GloFluxPowerSpawn();
      spawn.x = pos.x;
      spawn.y = 1;
      spawn.z = pos.z;
      spawn.powerId = randomPowerId();
      spawn.collected = false;
      this.state.powerSpawns.push(spawn);
    }
  }

  _handleCollectPower(client, data) {
    const idx = safeNumber(data?.idx, -1);
    if (idx < 0 || idx >= this.state.powerSpawns.length) return;

    const spawn = this.state.powerSpawns[idx];
    if (spawn.collected) {
      client.send('powerDenied', { idx, reason: 'already_collected' });
      return;
    }

    const player = this.state.players.get(client.sessionId);
    if (!player || player.health <= 0) return;

    // Validate proximity
    const dx = player.x - spawn.x;
    const dz = player.z - spawn.z;
    if (dx * dx + dz * dz > COLLECTION_RADIUS_SQ * 4) {
      client.send('powerDenied', { idx, reason: 'too_far' });
      return;
    }

    spawn.collected = true;
    client.send('powerGranted', { idx, powerId: spawn.powerId });

    // Schedule respawn
    this._powerRespawnTimers.push({ idx, timer: POWER_RESPAWN_SEC });
  }

  _tickPowerRespawns(dt) {
    for (let i = this._powerRespawnTimers.length - 1; i >= 0; i--) {
      this._powerRespawnTimers[i].timer -= dt;
      if (this._powerRespawnTimers[i].timer <= 0) {
        const idx = this._powerRespawnTimers[i].idx;
        const spawn = this.state.powerSpawns[idx];
        if (spawn) {
          spawn.collected = false;
          spawn.powerId = randomPowerId();
          this.broadcast('powerRespawn', { idx, powerId: spawn.powerId });
        }
        this._powerRespawnTimers.splice(i, 1);
      }
    }
  }

  _checkGameOver() {
    if (this.state.variant !== 'arena') return;
    let alive = 0;
    let lastAlive = null;
    this.state.players.forEach((p, sid) => {
      if (p.health > 0) { alive++; lastAlive = sid; }
    });
    if (alive <= 1 && this.state.players.size > 1) {
      this.broadcast('gameOver', { winner: lastAlive });
      log(`[GloFlux] Game over — winner: ${lastAlive}`);
      this.disconnect();
    }
  }
}
