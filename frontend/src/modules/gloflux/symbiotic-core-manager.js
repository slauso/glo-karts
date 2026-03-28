import { activatePower, awardEchoShards, detectSynergies } from './glo-flux-powers.js';
import { infectKart, serializeMutation } from './glo-flux-mutations.js';
import { createSurgeState, surgeFromChain, surgeFromEchoShards, surgeFromKill, surgeFromAssist, triggerApocalypseBurst, getSurgePercent, getDominantContributorFamily } from './glo-flux-surge.js';

class EventCombiner {
  constructor(windowMs = 4500) {
    this.windowMs = windowMs;
    this.eventsByPlayer = new Map();
  }

  push(playerId, event) {
    const events = this.eventsByPlayer.get(playerId) || [];
    events.push(event);
    this.eventsByPlayer.set(playerId, events.filter((entry) => (event.timestamp - entry.timestamp) <= this.windowMs));
  }

  get(playerId) {
    return this.eventsByPlayer.get(playerId) || [];
  }

  clear(playerId) {
    this.eventsByPlayer.delete(playerId);
  }
}

export class SymbioticCoreManager {
  constructor({ registry, debugBus = null } = {}) {
    this.registry = registry;
    this.debugBus = debugBus;
    this.players = new Map();
    this.eventCombiner = new EventCombiner();
    this.chainEvents = [];
  }

  ensurePlayer(playerId, playerRef = null) {
    if (!this.players.has(playerId)) {
      this.players.set(playerId, {
        id: playerId,
        ref: playerRef,
        surgeState: createSurgeState(),
        chainCount: 0,
        lastChainEvent: null,
        lastMutation: null,
      });
    }
    const state = this.players.get(playerId);
    if (playerRef) state.ref = playerRef;
    return state;
  }

  collectCore(player, powerId, now = Date.now()) {
    const record = this.ensurePlayer(player.id, player);
    const previousChainCount = player.powerState?.totalChainsHit || 0;
    const powerResult = activatePower(player.powerState, powerId, now / 1000);
    if (!powerResult) return null;

    const familyId = this.registry.getFamilyForPower(powerId);
    const mutation = infectKart(player.mutationState, powerId, familyId, now);
    record.lastMutation = serializeMutation(player.mutationState);

    const surge = surgeFromChain(record.surgeState, player.powerState.activePowers.map((entry) => entry.powerId), now / 1000);
    record.chainCount = player.powerState.totalChainsHit;

    const newChainTriggered = record.chainCount > previousChainCount;
    const synergy = newChainTriggered
      ? powerResult.newSynergies[powerResult.newSynergies.length - 1] || null
      : null;
    const chainEvent = {
      playerId: player.id,
      powerId,
      familyId,
      comboId: synergy?.id || null,
      chainCount: record.chainCount,
      chainStrength: Math.max(1, powerResult.surgeGain?.multiplier || 1),
      surgeDelta: surge.gained,
      surgeMeter: record.surgeState.meter,
      timestamp: now,
      mutationTier: player.mutationState.tier,
    };

    if (synergy) {
      record.lastChainEvent = chainEvent;
      this.eventCombiner.push(player.id, chainEvent);
      this.chainEvents.push(chainEvent);
    }

    if (surge.triggered) {
      const burst = triggerApocalypseBurst(record.surgeState);
      if (burst) {
        this.chainEvents.push({
          ...chainEvent,
          comboId: chainEvent.comboId || 'apocalypse',
          chainStrength: Math.max(chainEvent.chainStrength, 4),
          apocalypse: true,
          dominantFamily: burst.dominantFamily,
        });
      }
    }

    this._publishDebug();
    return {
      powerResult,
      mutation,
      surge,
      chainEvent,
    };
  }

  awardEchoShards(player, distance, now = Date.now()) {
    const record = this.ensurePlayer(player.id, player);
    const shards = awardEchoShards(player.powerState, distance);
    const surge = surgeFromEchoShards(record.surgeState, shards, now / 1000);
    this._publishDebug();
    return { shards, surge };
  }

  noteKill(player, now = Date.now()) {
    const record = this.ensurePlayer(player.id, player);
    const surge = surgeFromKill(record.surgeState, now / 1000);
    this._publishDebug();
    return surge;
  }

  noteAssist(player, now = Date.now()) {
    const record = this.ensurePlayer(player.id, player);
    const surge = surgeFromAssist(record.surgeState, now / 1000);
    this._publishDebug();
    return surge;
  }

  ingestRemoteChainEvent(event) {
    if (!event?.playerId) return;
    this.chainEvents.push({ ...event });
    this.eventCombiner.push(event.playerId, event);
    this._publishDebug();
  }

  consumeChainEvents() {
    const events = this.chainEvents.slice();
    this.chainEvents.length = 0;
    return events;
  }

  getPlayerDebugState(playerId) {
    const record = this.players.get(playerId);
    const player = record?.ref;
    const activePowerIds = player?.powerState?.activePowers?.map((entry) => entry.powerId) || [];
    return {
      playerId,
      surgeMeter: record?.surgeState?.meter || 0,
      surgePercent: record ? getSurgePercent(record.surgeState) : 0,
      dominantFamily: record ? getDominantContributorFamily(record.surgeState) : null,
      chainCount: record?.chainCount || 0,
      lastChainEvent: record?.lastChainEvent || null,
      mutationTier: player?.mutationState?.tier || 0,
      activePowerIds,
      activeSynergies: detectSynergies(activePowerIds).map((entry) => entry.id),
    };
  }

  getDebugState() {
    return {
      playerCount: this.players.size,
      activePlayers: Array.from(this.players.keys()),
      pendingChainEvents: this.chainEvents.length,
      players: Array.from(this.players.keys()).reduce((acc, playerId) => {
        acc[playerId] = this.getPlayerDebugState(playerId);
        return acc;
      }, {}),
    };
  }

  _publishDebug() {
    if (!this.debugBus || typeof this.debugBus !== 'object') return;
    this.debugBus.symbioticCoreManager = this.getDebugState();
  }

  dispose() {
    this.players.clear();
    this.chainEvents.length = 0;
  }
}