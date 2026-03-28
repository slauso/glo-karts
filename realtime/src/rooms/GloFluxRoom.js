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
import {
  configureRealtimeRoom,
  getSimulationIntervalMs,
  isRealtimeInputFresh,
  getRealtimeJoinPayload,
  noteRealtimeAnomalyEvent,
  noteProcessedInput,
  noteRealtimeTick,
  REALTIME_SYNC_DEFAULTS,
} from "../realtime-sync.js";

const TICK_RATE = getSimulationIntervalMs();
const SHRINK_RATE = 0.3;            // units per second
const POWER_RESPAWN_SEC = 8;
const COLLECTION_RADIUS_SQ = 9;     // 3 units squared
const MAX_SURGE = 100;
const CHAIN_WINDOW_MS = 4500;

// 20.15 — match lifecycle timing
const PREMATCH_WAIT_SEC = 5;        // seconds in prematch lobby
const COUNTDOWN_DURATION_MS = 4000; // countdown to GO
const RESULTS_DISPLAY_SEC = 8;      // seconds showing results
const REMATCH_VOTE_SEC = 15;        // time to vote for rematch
const MIN_PLAYERS_TO_START = 2;     // minimum players to leave waiting

// 20.16 — reconnect window
const RECONNECT_WINDOW_MS = 15000;  // 15 seconds to rejoin

// 20.17 — scale hardening caps
const MAX_POWER_SPAWNS = 20;
const MAX_CHAIN_EVENTS_PER_SEC = 5;
const MAX_ENTITY_COUNT = 100;

// 20.18 — balance constants (single source of truth)
const BALANCE = Object.freeze({
  ACCEL: 20,
  DRAG: 0.9,
  STEER: 2.5,
  APOCALYPSE_DAMAGE: 30,
  BOUNDARY_DAMAGE_PER_SEC: 20,
  POWER_RARITY: Object.freeze({
    common: 0.45,
    uncommon: 0.30,
    rare: 0.18,
    legendary: 0.07,
  }),
  FAMILY_WEIGHT: Object.freeze({
    phantom_horde: 1.0,
    entropic_void: 1.0,
    biofractal_aegis: 1.0,
    psyche_apotheosis: 1.0,
  }),
  SURGE_BASE_GAIN: 12,
  SURGE_COMBO_GAIN: 28,
  SURGE_CHAIN_BONUS: 10,
  ECHO_SHARD_VALUE: 4,
  MUTATION_GROWTH_RATE: 1.0,
});

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
  'pirateleportation','dimensional_rift','entropy_cascade','weather_dominion',
  'phase_shift','bio_regen_cocoon','fractal_duplication','symbiotic_overgrowth',
  'paradox_loop','psyche_fracture','chronal_echo','mutation_surge',
  'rogue_ai_companion','rhythm_pulse','karmic_reversal','ecosystem_hack',
];

const POWER_FAMILY = Object.freeze({
  echo_phantom: 'phantom_horde',
  quantum_duplicate: 'phantom_horde',
  neural_hijack: 'phantom_horde',
  symbiote_swarm: 'phantom_horde',
  pirateleportation: 'entropic_void',
  dimensional_rift: 'entropic_void',
  entropy_cascade: 'entropic_void',
  weather_dominion: 'entropic_void',
  phase_shift: 'biofractal_aegis',
  bio_regen_cocoon: 'biofractal_aegis',
  fractal_duplication: 'biofractal_aegis',
  symbiotic_overgrowth: 'biofractal_aegis',
  paradox_loop: 'biofractal_aegis',
  psyche_fracture: 'psyche_apotheosis',
  chronal_echo: 'psyche_apotheosis',
  mutation_surge: 'psyche_apotheosis',
  rogue_ai_companion: 'psyche_apotheosis',
  rhythm_pulse: 'psyche_apotheosis',
  karmic_reversal: 'psyche_apotheosis',
  ecosystem_hack: 'psyche_apotheosis',
});

const COMBO_TABLE = Object.freeze([
  { comboId: 'horde_split', requires: ['echo_phantom', 'quantum_duplicate'] },
  { comboId: 'void_portal', requires: ['pirateleportation', 'dimensional_rift'] },
  { comboId: 'fractal_cocoon', requires: ['phase_shift', 'bio_regen_cocoon'] },
  { comboId: 'echo_hallucination', requires: ['psyche_fracture', 'chronal_echo'] },
]);

function detectCombo(history) {
  const powerIds = new Set(history.map((entry) => entry.powerId));
  return COMBO_TABLE.find((combo) => combo.requires.every((req) => powerIds.has(req))) || null;
}

function randomPowerId() {
  return POWER_IDS[Math.floor(Math.random() * POWER_IDS.length)];
}

export class GloFluxRoom extends Room {
  onCreate(options = {}) {
    const state = new GloFluxState();
    state.variant = options.variant || 'arena';
    state.arenaTheme = options.arenaTheme || 'nuclear_desert';
    state.arenaSeed = Math.floor(Math.random() * 1000000);
    state.hostSessionId = '';
    state.shrinkRadius = 60;
    state.matchPhase = 'waiting';
    state.partyCode = options.partyCode || '';
    state.seedBadge = `S${state.arenaSeed}`;
    this.setState(state);

    const syncConfig = configureRealtimeRoom(this, options);
    this.inputBySession = new Map();
    this._rateLimiter = new RateLimiter();
    this._countdownActive = false;
    this._powerRespawnTimers = [];
    this._chainBySession = new Map();
    this._powerHistoryBySession = new Map();
    this._surgeBySession = new Map();
    this._allowDebugHarness = process.env.NODE_ENV !== 'production';
    this.staleInputMs = Number(options.staleInputMs || process.env.COLYSEUS_STALE_INPUT_MS || REALTIME_SYNC_DEFAULTS.staleInputMs);

    // 20.15 — match lifecycle state
    this._rematchVotes = new Set();
    this._returnVotes = new Set();
    this._prematchTimer = null;
    this._resultsTimer = null;
    this._phaseStartedAt = Date.now();

    // 20.16 — reconnect tracking
    this._disconnected = new Map(); // sessionId → { playerSnapshot, disconnectedAt }
    this._spectators = new Set();

    // 20.17 — rate limiting for scale hardening
    this._chainEventsThisSecond = 0;
    this._chainRateResetAt = Date.now() + 1000;

    // Generate initial power spawn points (server-side grid)
    this._initPowerSpawns();
    this._refreshTelemetrySummary(Date.now());

    // ── Messages ──────────────────────────────────────────────

    this.onMessage("input", (client, data) => {
      if (!this._rateLimiter.allow(client.sessionId, 'input', 120)) return;
      this.inputBySession.set(client.sessionId, {
        f: safeUnit(data?.f),
        s: safeUnit(data?.s),
        b: safeUnit(data?.b),
        p: typeof data?.p === 'string' ? data.p : null,
        receivedAt: Date.now(),
      });
    });

    this.onMessage("collectPower", (client, data) => {
      if (!this._rateLimiter.allow(client.sessionId, 'collect', 10)) return;
      this._handleCollectPower(client, data);
    });

    this.onMessage("debugCollectPower", (client, data) => {
      if (!this._allowDebugHarness) return;
      if (!this._rateLimiter.allow(client.sessionId, 'collect', 10)) return;
      this._handleCollectPower(client, data, { ignoreProximity: true, snapToSpawn: true });
    });

    this.onMessage("debugSetPowerSpawn", (client, data) => {
      if (!this._allowDebugHarness) return;
      if (!this._rateLimiter.allow(client.sessionId, 'debug-spawn', 20)) return;
      const idx = safeNumber(data?.idx, -1);
      const powerId = typeof data?.powerId === 'string' ? data.powerId : '';
      if (idx < 0 || idx >= this.state.powerSpawns.length) return;
      if (!POWER_IDS.includes(powerId)) return;
      const spawn = this.state.powerSpawns[idx];
      if (!spawn) return;
      spawn.collected = false;
      spawn.powerId = powerId;
      this.broadcast('powerRespawn', { idx, powerId });
      this._refreshTelemetrySummary(Date.now());
    });

    this.onMessage("debugRoomSnapshotRequest", (client) => {
      if (!this._allowDebugHarness) return;
      if (!this._rateLimiter.allow(client.sessionId, 'debug-snapshot', 10)) return;
      client.send('debugRoomSnapshot', {
        roomId: this.roomId,
        ts: Date.now(),
        variant: this.state.variant,
        matchPhase: this.state.matchPhase,
        patchVersion: Number(this.state.patchVersion || 0),
        totalSurgeEvents: Number(this.state.totalSurgeEvents || 0),
        apocalypseBursts: Number(this.state.apocalypseBursts || 0),
        players: Array.from(this.state.players.entries()).map(([sessionId, player]) => ({
          sessionId,
          health: Number(player.health || 0),
          alive: Number(player.health || 0) > 0,
          score: Number(player.score || 0),
          x: Number(player.x || 0),
          y: Number(player.y || 0),
          z: Number(player.z || 0),
        })),
      });
    });

    this.onMessage("surgeSync", (client, data) => {
      if (!this._rateLimiter.allow(client.sessionId, 'surge', 30)) return;
      const v = safeNumber(data?.v);
      if (v < 0 || v > MAX_SURGE + 5) return;
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
      this.state.players.forEach((p, sid) => {
        if (sid !== client.sessionId && p.health > 0) {
          p.health = Math.max(0, p.health - BALANCE.APOCALYPSE_DAMAGE);
        }
      });
      this.broadcast('apocalypseTriggered', { sessionId: client.sessionId });
      noteRealtimeAnomalyEvent(this, 'apocalypseBursts');
      log(`[GloFlux] Apocalypse by ${client.sessionId}`);
    });

    this.onMessage("triggerStart", (client) => {
      if (this.state.hostSessionId && client.sessionId !== this.state.hostSessionId) return;
      if (this.state.matchPhase !== 'waiting' && this.state.matchPhase !== 'prematch') return;
      if (this._countdownActive) return;
      this._transitionPhase('countdown');
    });

    // 20.15 — rematch / return voting
    this.onMessage("rematchVote", (client) => {
      if (this.state.matchPhase !== 'results') return;
      this._rematchVotes.add(client.sessionId);
      this.state.rematchVotes = this._rematchVotes.size;
      this.broadcast('rematchStatus', {
        votes: this._rematchVotes.size,
        target: this.state.rematchTarget,
      });
      if (this._rematchVotes.size >= this.state.rematchTarget) {
        this._startRematch();
      }
    });

    this.onMessage("returnToMenu", (client) => {
      if (this.state.matchPhase !== 'results') return;
      this._returnVotes.add(client.sessionId);
      if (this._returnVotes.size >= this.state.players.size) {
        this.disconnect();
      }
    });

    // 20.16 — spectate request
    this.onMessage("spectate", (client) => {
      this._spectators.add(client.sessionId);
      this.state.spectatorCount = this._spectators.size;
      client.send('spectateConfirmed', { matchPhase: this.state.matchPhase });
    });

    // ── Tick ──────────────────────────────────────────────────

    this.setSimulationInterval(() => this._tick(), TICK_RATE);

    log('info', 'room_create', {
      room: 'gloflux',
      roomId: this.roomId,
      variant: state.variant,
      arenaTheme: state.arenaTheme,
      maxClients: this.maxClients,
      patchRateMs: syncConfig.patchRateMs,
      staleInputMs: this.staleInputMs,
    });
  }

  onJoin(client, options) {
    // 20.16 — check for reconnect
    const reconnectData = this._disconnected.get(client.sessionId);
    if (reconnectData) {
      this._disconnected.delete(client.sessionId);
      // Restore player from snapshot
      const p = new PlayerState();
      Object.assign(p, reconnectData.playerSnapshot);
      p.id = client.sessionId;
      this.state.players.set(client.sessionId, p);
      this.inputBySession.set(client.sessionId, { f: 0, s: 0, b: 0, p: null });
      client.send('joined', {
        sessionId: client.sessionId,
        room: this.roomId,
        mode: 'gloflux',
        reconnected: true,
        matchPhase: this.state.matchPhase,
        sync: getRealtimeJoinPayload(this),
      });
      log(`[GloFlux] ${client.sessionId} reconnected`);
      return;
    }

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

    // 20.16 — late join: if match is live, start as spectator
    const isLateJoin = this.state.matchPhase === 'live' || this.state.matchPhase === 'countdown';
    if (isLateJoin) {
      p.health = 0; // spectator until next round
      this._spectators.add(client.sessionId);
      this.state.spectatorCount = this._spectators.size;
    }

    client.send('joined', {
      sessionId: client.sessionId,
      room: this.roomId,
      mode: 'gloflux',
      matchPhase: this.state.matchPhase,
      spectating: isLateJoin,
      sync: getRealtimeJoinPayload(this),
    });

    // 20.15 — auto-transition from waiting when enough players
    if (this.state.matchPhase === 'waiting' && this.state.players.size >= MIN_PLAYERS_TO_START) {
      this._transitionPhase('prematch');
    }

    log(`[GloFlux] ${p.name} joined (${client.sessionId}) phase=${this.state.matchPhase}`);
  }

  onLeave(client, consented) {
    const player = this.state.players.get(client.sessionId);

    // 20.16 — if match is live and disconnect was not consented, allow reconnect
    if (!consented && (this.state.matchPhase === 'live' || this.state.matchPhase === 'countdown') && player) {
      const snapshot = {
        name: player.name,
        kartId: player.kartId,
        playerColor: player.playerColor,
        gloEffect: player.gloEffect,
        gloColor: player.gloColor,
        gloColor2: player.gloColor2,
        x: player.x,
        y: player.y,
        z: player.z,
        ry: player.ry,
        health: player.health,
        score: player.score,
      };
      this._disconnected.set(client.sessionId, { playerSnapshot: snapshot, disconnectedAt: Date.now() });
      // Keep player in state but stop processing input
      this.inputBySession.delete(client.sessionId);
      log(`[GloFlux] ${client.sessionId} disconnected (holding slot for ${RECONNECT_WINDOW_MS}ms)`);

      // Expire reconnect slot after window
      this.clock.setTimeout(() => {
        if (this._disconnected.has(client.sessionId)) {
          this._disconnected.delete(client.sessionId);
          this.state.players.delete(client.sessionId);
          this._chainBySession.delete(client.sessionId);
          this._powerHistoryBySession.delete(client.sessionId);
          this._surgeBySession.delete(client.sessionId);
          log(`[GloFlux] ${client.sessionId} reconnect window expired`);
        }
      }, RECONNECT_WINDOW_MS);
      return;
    }

    this.state.players.delete(client.sessionId);
    this.inputBySession.delete(client.sessionId);
    this._chainBySession.delete(client.sessionId);
    this._powerHistoryBySession.delete(client.sessionId);
    this._surgeBySession.delete(client.sessionId);
    this._spectators.delete(client.sessionId);
    this._rematchVotes.delete(client.sessionId);
    this._returnVotes.delete(client.sessionId);
    this.state.spectatorCount = this._spectators.size;

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

  // 20.15 — phase transitions
  _transitionPhase(phase) {
    this.state.matchPhase = phase;
    this._phaseStartedAt = Date.now();
    this.broadcast('phaseChange', { phase, ts: Date.now() });
    log(`[GloFlux] Phase → ${phase}`);

    switch (phase) {
      case 'prematch':
        this._prematchTimer = this.clock.setTimeout(() => {
          if (this.state.matchPhase === 'prematch') {
            this._transitionPhase('countdown');
          }
        }, PREMATCH_WAIT_SEC * 1000);
        break;

      case 'countdown':
        this._countdownActive = true;
        this.broadcast("countdown", { durationMs: COUNTDOWN_DURATION_MS, serverNow: Date.now() });
        this.clock.setTimeout(() => {
          this.state.started = true;
          this._countdownActive = false;
          this._transitionPhase('live');
        }, COUNTDOWN_DURATION_MS);
        break;

      case 'live':
        this.broadcast("matchLive", {});
        break;

      case 'results': {
        this.state.started = false;
        // Compute standings
        const standings = [];
        this.state.players.forEach((p, sid) => {
          standings.push({ sessionId: sid, name: p.name, health: p.health, score: p.score, alive: p.health > 0 });
        });
        standings.sort((a, b) => (b.alive ? 1 : 0) - (a.alive ? 1 : 0) || b.score - a.score || b.health - a.health);
        this.state.rematchTarget = Math.max(1, Math.ceil(this.state.players.size / 2));
        this.state.rematchVotes = 0;
        this._rematchVotes.clear();
        this._returnVotes.clear();
        this.broadcast('matchResults', { standings, seedBadge: this.state.seedBadge });

        // Auto-dispose after rematch vote timeout
        this._resultsTimer = this.clock.setTimeout(() => {
          if (this.state.matchPhase === 'results') {
            if (this._rematchVotes.size >= this.state.rematchTarget) {
              this._startRematch();
            } else {
              this.disconnect();
            }
          }
        }, REMATCH_VOTE_SEC * 1000);
        break;
      }

      case 'rematch':
        // Reset for next round
        this.broadcast('rematchStarting', {});
        this.clock.setTimeout(() => {
          this._resetForNewRound();
          this._transitionPhase('countdown');
        }, 2000);
        break;
    }
  }

  _startRematch() {
    this._transitionPhase('rematch');
  }

  _resetForNewRound() {
    // Reset player states
    this.state.players.forEach((p) => {
      p.health = 100;
      p.score = 0;
      const playerIndex = Math.floor(Math.random() * 8);
      const spawnAngle = (playerIndex / Math.max(this.maxClients, 1)) * Math.PI * 2;
      const spawnRadius = 14;
      p.x = Math.cos(spawnAngle) * spawnRadius;
      p.z = Math.sin(spawnAngle) * spawnRadius;
      p.ry = spawnAngle + Math.PI;
    });

    // Reset arena state
    this.state.shrinkRadius = 60;
    this.state.elapsed = 0;
    this.state.arenaSeed = Math.floor(Math.random() * 1000000);
    this.state.seedBadge = `S${this.state.arenaSeed}`;
    this.state.totalCoreCollections = 0;
    this.state.totalChainBursts = 0;
    this.state.longestChain = 0;
    this.state.totalSurgeEvents = 0;
    this.state.highestSurgeMeter = 0;
    this.state.activeChainPeak = 0;
    this.state.patchVersion += 1;

    // Reset power spawns
    while (this.state.powerSpawns.length > 0) this.state.powerSpawns.pop();
    this._powerRespawnTimers = [];
    this._initPowerSpawns();

    // Clear per-session data
    this._chainBySession.clear();
    this._powerHistoryBySession.clear();
    this._surgeBySession.clear();
    this._spectators.clear();
    this.state.spectatorCount = 0;
    this._rematchVotes.clear();
    this._returnVotes.clear();
  }

  _tick() {
    if (this.state.matchPhase !== 'live') return;
    const dt = TICK_RATE / 1000;
    this.state.serverTime = Date.now();
    this.state.elapsed += dt;
    const now = Date.now();
    noteRealtimeTick(this, TICK_RATE, now);

    // 20.17 — reset chain rate limiter each second
    if (now >= this._chainRateResetAt) {
      this._chainEventsThisSecond = 0;
      this._chainRateResetAt = now + 1000;
    }

    // Shrink boundary (arena mode)
    if (this.state.variant === 'arena' && this.state.shrinkRadius > 5) {
      this.state.shrinkRadius = Math.max(5, this.state.shrinkRadius - SHRINK_RATE * dt);
    }

    // 20.17 — enforce entity cap
    if (this.state.entities.size > MAX_ENTITY_COUNT) {
      const excess = this.state.entities.size - MAX_ENTITY_COUNT;
      let removed = 0;
      for (const [key] of this.state.entities) {
        if (removed >= excess) break;
        this.state.entities.delete(key);
        removed++;
      }
    }

    // Process inputs & physics
    this.state.players.forEach((player, sid) => {
      if (player.health <= 0) return;
      // Skip disconnected players
      if (this._disconnected.has(sid)) return;

      const rawInput = this.inputBySession.get(sid);
      const input = isRealtimeInputFresh(rawInput, now, this.staleInputMs)
        ? rawInput
        : { f: 0, s: 0, b: 0, p: null };
      if (rawInput && input === rawInput) noteProcessedInput(this, rawInput, now);

      const accel = input.f * BALANCE.ACCEL;
      const steer = input.s * BALANCE.STEER;

      player.vx = safeNumber(player.vx) * BALANCE.DRAG + Math.sin(safeNumber(player.ry)) * accel * dt;
      player.vz = safeNumber(player.vz) * BALANCE.DRAG + Math.cos(safeNumber(player.ry)) * accel * dt;

      player.x += player.vx * dt;
      player.z += player.vz * dt;
      player.ry = safeNumber(player.ry) + steer * dt;

      // Boundary damage (arena mode)
      if (this.state.variant === 'arena') {
        const distSq = player.x * player.x + player.z * player.z;
        const rSq = this.state.shrinkRadius * this.state.shrinkRadius;
        if (distSq > rSq) {
          player.health = Math.max(0, player.health - BALANCE.BOUNDARY_DAMAGE_PER_SEC * dt);
        }
      }
    });

    // Power respawn timers
    this._tickPowerRespawns(dt);

    this._refreshTelemetrySummary(now);

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
    // Pick up to MAX_POWER_SPAWNS from random positions
    const shuffled = positions.sort(() => Math.random() - 0.5).slice(0, Math.min(15, MAX_POWER_SPAWNS));
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

  _handleCollectPower(client, data, options = {}) {
    const idx = safeNumber(data?.idx, -1);
    if (idx < 0 || idx >= this.state.powerSpawns.length) return;

    const spawn = this.state.powerSpawns[idx];
    if (spawn.collected) {
      client.send('powerDenied', { idx, reason: 'already_collected' });
      return;
    }

    const player = this.state.players.get(client.sessionId);
    if (!player || player.health <= 0) return;

    if (options.snapToSpawn) {
      player.x = spawn.x;
      player.y = spawn.y;
      player.z = spawn.z;
    }

    // Validate proximity
    const dx = player.x - spawn.x;
    const dz = player.z - spawn.z;
    if (!options.ignoreProximity && dx * dx + dz * dz > COLLECTION_RADIUS_SQ * 4) {
      client.send('powerDenied', { idx, reason: 'too_far' });
      return;
    }

    spawn.collected = true;
    client.send('powerGranted', { idx, powerId: spawn.powerId });
    this._noteCoreCollection(client.sessionId, spawn.powerId, Date.now());

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

  _noteCoreCollection(sessionId, powerId, now) {
    // 20.17 — rate-limit chain events per second
    if (this._chainEventsThisSecond >= MAX_CHAIN_EVENTS_PER_SEC) return;
    this._chainEventsThisSecond++;

    this.state.totalCoreCollections += 1;
    noteRealtimeAnomalyEvent(this, 'anomalyCoreCollections');

    const history = this._powerHistoryBySession.get(sessionId) || [];
    history.push({ powerId, familyId: POWER_FAMILY[powerId] || 'phantom_horde', at: now });
    const recentHistory = history.filter((entry) => (now - entry.at) <= CHAIN_WINDOW_MS * 2);
    this._powerHistoryBySession.set(sessionId, recentHistory);

    const previous = this._chainBySession.get(sessionId) || { count: 0, lastAt: 0 };
    const nextCount = (now - previous.lastAt) <= CHAIN_WINDOW_MS ? previous.count + 1 : 1;
    this._chainBySession.set(sessionId, { count: nextCount, lastAt: now });
    this.state.longestChain = Math.max(this.state.longestChain, nextCount);
    this.state.patchVersion += 1;

    const combo = detectCombo(recentHistory);
    // 20.18 — use BALANCE constants
    const surgeBonus = combo ? BALANCE.SURGE_COMBO_GAIN : BALANCE.SURGE_BASE_GAIN;
    const surgeMeter = Math.min(MAX_SURGE, Number(this._surgeBySession.get(sessionId) || 0) + surgeBonus + Math.max(0, nextCount - 1) * BALANCE.SURGE_CHAIN_BONUS);
    this._surgeBySession.set(sessionId, surgeMeter);
    this.state.totalSurgeEvents += 1;
    this.state.highestSurgeMeter = Math.max(this.state.highestSurgeMeter, surgeMeter);

    if (nextCount > 1) {
      this.state.totalChainBursts += 1;
      noteRealtimeAnomalyEvent(this, 'anomalyChainBursts');
    }

    this.broadcast('chainActivated', {
      sessionId,
      powerId,
      familyId: POWER_FAMILY[powerId] || 'phantom_horde',
      comboId: combo?.comboId || null,
      chainCount: nextCount,
      chainStrength: combo ? 2 : 1,
      surgeMeter,
      patchVersion: this.state.patchVersion,
    });
    this._refreshTelemetrySummary(now);
  }

  _refreshTelemetrySummary(now = Date.now()) {
    let activeCoreCount = 0;
    for (const spawn of this.state.powerSpawns) {
      if (!spawn.collected) activeCoreCount += 1;
    }
    this.state.activeCoreCount = activeCoreCount;

    let activeChainPeak = 0;
    for (const [sessionId, chain] of this._chainBySession.entries()) {
      if (!this.state.players.has(sessionId)) continue;
      if ((now - chain.lastAt) > CHAIN_WINDOW_MS) continue;
      activeChainPeak = Math.max(activeChainPeak, chain.count);
    }
    this.state.activeChainPeak = activeChainPeak;
  }

  _checkGameOver() {
    if (this.state.variant !== 'arena') return;
    if (this.state.matchPhase !== 'live') return;
    let alive = 0;
    let lastAlive = null;
    this.state.players.forEach((p, sid) => {
      if (p.health > 0) { alive++; lastAlive = sid; }
    });
    if (alive <= 1 && this.state.players.size > 1) {
      this.broadcast('gameOver', { winner: lastAlive });
      log(`[GloFlux] Game over — winner: ${lastAlive}`);
      this._transitionPhase('results');
    }
  }
}
