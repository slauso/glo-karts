import { BaseMode } from './BaseMode.js';
import { updateCombo, updateSurge, updateTelemetry } from '../gloflux/glo-flux-hud.js';
import { createPowerUpFamilyRegistry } from '../gloflux/power-up-family-registry.js';
import { SymbioticCoreManager } from '../gloflux/symbiotic-core-manager.js';
import { ProceduralArenaEvolver } from '../gloflux/procedural-arena-evolver.js';

export class GloFluxMode extends BaseMode {
  constructor({
    scene,
    engine,
    havokPlugin,
    networkClient,
    hud,
    arenaData,
    arenaSeed,
    localPlayerId,
    debugBus,
    options = {},
  } = {}) {
    super({
      id: 'gloflux-mode',
      scene,
      engine,
      havokPlugin,
      networkClient,
      hud,
      debugBus,
      options,
    });
    this.arenaData = arenaData || null;
    this.arenaSeed = Number(arenaSeed || 0);
    this.localPlayerId = localPlayerId || 'local';
    this.familyRegistry = createPowerUpFamilyRegistry();
    this.coreManager = new SymbioticCoreManager({ registry: this.familyRegistry, debugBus });
    this.arenaEvolver = new ProceduralArenaEvolver({
      scene,
      havokPlugin,
      arenaData,
      seed: this.arenaSeed,
      debugBus,
    });
  }

  async init() {
    await super.init();
    await this.arenaEvolver.init();
    this._bindNetwork();
    this.publishDebug(this.getDebugSnapshot());
  }

  registerPlayer(player) {
    return this.coreManager.ensurePlayer(player.id, player);
  }

  handleCoreCollected(player, powerId, now = Date.now(), meta = {}) {
    const result = this.coreManager.collectCore(player, powerId, now);
    if (!result) return null;

    const events = this.coreManager.consumeChainEvents();
    events.forEach((event) => {
      this.arenaEvolver.queueMutation(event);
    });

    if (player.id === this.localPlayerId && this.hud) {
      const playerDebug = this.coreManager.getPlayerDebugState(player.id);
      const playerRecord = this.coreManager.players.get(player.id);
      updateCombo(this.hud, playerDebug.chainCount, Math.max(1, result.powerResult?.surgeGain?.multiplier || 1), 4.5);
      updateSurge(this.hud, {
        current: playerRecord?.surgeState?.meter || 0,
        tier: playerRecord?.surgeState?.tier || 0,
        dominantContributorFamily: playerDebug.dominantFamily,
        burstActive: !!events.find((entry) => entry.apocalypse),
        burstStartTime: now,
        burstDuration: 4000,
      });
    }

    if (meta.fromNetwork && this.networkClient?.syncMutation) {
      this.networkClient.syncMutation({
        playerId: player.id,
        mutationTier: player.mutationState.tier,
        dominantFamily: player.mutationState.dominantFamily,
      });
    }

    if (meta.fromNetwork && this.networkClient?.syncSurge) {
      this.networkClient.syncSurge(this.coreManager.players.get(player.id)?.surgeState?.meter || 0);
    }

    this.publishDebug(this.getDebugSnapshot());
    return result;
  }

  awardEchoShards(player, distance, now = Date.now()) {
    const result = this.coreManager.awardEchoShards(player, distance, now);
    this.publishDebug(this.getDebugSnapshot());
    return result;
  }

  update(_dt, _now) {
    this.arenaEvolver.update();
    if (this.hud && this.networkClient?.telemetry) {
      updateTelemetry(this.hud, this.networkClient.telemetry);
    }
    this.publishDebug(this.getDebugSnapshot());
  }

  _bindNetwork() {
    if (!this.networkClient?.on || this._networkBound) return;
    this._networkBound = true;

    this.networkClient.on('chainActivated', (msg = {}) => {
      this.coreManager.ingestRemoteChainEvent({
        playerId: msg.sessionId || msg.playerId,
        familyId: msg.familyId || this.familyRegistry.getFamilyForPower(msg.powerId),
        comboId: msg.comboId || null,
        chainCount: Number(msg.chainCount || 0),
        chainStrength: Number(msg.chainStrength || 1),
        surgeMeter: Number(msg.surgeMeter || 0),
        timestamp: Date.now(),
      });
      const events = this.coreManager.consumeChainEvents();
      events.forEach((event) => this.arenaEvolver.queueMutation(event));
    });

    this.networkClient.on('apocalypseTriggered', (msg = {}) => {
      this.arenaEvolver.triggerApocalypseBurst({
        playerId: msg.sessionId || msg.playerId || this.localPlayerId,
        familyId: msg.familyId || null,
        comboId: 'apocalypse',
        chainStrength: 4,
        timestamp: Date.now(),
      });
    });
  }

  getDebugSnapshot() {
    return {
      ...super.getDebugSnapshot(),
      familyRegistry: this.familyRegistry.toJSON(),
      symbioticCoreManager: this.coreManager.getDebugState(),
      arenaEvolver: this.arenaEvolver.getDebugState(),
    };
  }

  dispose() {
    this.arenaEvolver.dispose();
    this.coreManager.dispose();
    super.dispose();
  }
}

