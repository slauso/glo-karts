/**
 * sp-runtime-bridge.js — Bridges rebuilt SP/local modes into the game loop.
 *
 * When singlePlayerMode is active, this module replaces the Colyseus room
 * tick with a local game loop that drives ModeManager.update(dt).
 * It injects real game dependencies (scene, physics, HUD, AI, items)
 * into mode classes via the DI deps object.
 */

import { ModeManager } from './mode-manager.js';
import { createRebuildMode } from './mode-factory.js';
import { BotLogicService } from '../../ai/bot-logic.js';
import { ProjectileSystem } from '../../weapons/projectile-system.js';
import { WeaponInventory } from '../../weapons/weapon-inventory.js';
import { SPRaceSystems } from './systems/sp-race-systems.js';
import { SPBattleSystems } from './systems/sp-battle-systems.js';
import { SPDriveSystems } from './systems/sp-drive-systems.js';
import { GhostService } from './systems/ghost-service.js';
import { GrandPrixService } from './systems/grand-prix-service.js';
import { FTLService } from './systems/ftl-service.js';
import { SoccerService } from './systems/soccer-service.js';
import { SplitScreenService } from './systems/splitscreen-service.js';
import { SPHudController } from './systems/sp-hud-controller.js';

/**
 * @typedef {object} SPBootConfig
 * @property {string} modeId
 * @property {import('@babylonjs/core').Scene} scene
 * @property {import('@babylonjs/core').Engine} engine
 * @property {HTMLCanvasElement} canvas
 * @property {object} trackData
 * @property {object} [gameConfig]
 * @property {string} [difficulty]
 */

export class SPRuntimeBridge {
  /**
   * @param {SPBootConfig} config
   */
  constructor(config) {
    this.config = config;
    this.modeManager = new ModeManager();
    this.running = false;
    this._rafId = null;
    this._lastTime = 0;

    // Core systems (created on boot)
    this.botLogic = null;
    this.projectiles = null;
    this.weapons = null;
    this.hud = null;
    this.deps = {};
  }

  /**
   * Boot the SP runtime for the given modeId.
   * Creates all shared systems, injects them into the mode, and starts the loop.
   */
  async boot() {
    const { modeId, scene, engine, canvas, trackData, gameConfig } = this.config;
    const difficulty = this.config.difficulty || gameConfig?.difficulty || 'normal';

    // ── Shared systems ──────────────────────────────────────
    this.botLogic = new BotLogicService();
    this.botLogic.setDifficulty(difficulty);

    this.projectiles = new ProjectileSystem({ maxProjectiles: 128 });
    this.weapons = new WeaponInventory();
    this.hud = new SPHudController({ canvas });

    // ── Mode-specific service injection ─────────────────────
    const raceSystems = new SPRaceSystems({ scene, trackData, botLogic: this.botLogic, projectiles: this.projectiles, weapons: this.weapons, hud: this.hud, difficulty });
    const battleSystems = new SPBattleSystems({ scene, trackData, botLogic: this.botLogic, projectiles: this.projectiles, weapons: this.weapons, hud: this.hud, difficulty });
    const driveSystems = new SPDriveSystems({ scene, trackData });
    const ghost = new GhostService();
    const grandPrix = new GrandPrixService({ gameConfig });
    const followTheLeader = new FTLService({ scene, botLogic: this.botLogic });
    const soccer = new SoccerService({ scene });
    const splitScreen = new SplitScreenService({ scene, engine, canvas });

    this.deps = {
      scene,
      engine,
      canvas,
      trackData,
      gameConfig,
      raceSystems,
      battleSystems,
      driveSystems,
      ghost,
      grandPrix,
      followTheLeader,
      soccer,
      splitScreen,
      botLogic: this.botLogic,
      projectiles: this.projectiles,
      weapons: this.weapons,
      hud: this.hud,
      ui: this.hud,
      logger: console,
    };

    // ── Create and switch to the mode ───────────────────────
    const mode = createRebuildMode(modeId, this.deps);
    await this.modeManager.switchMode(mode);

    // ── Start local game loop ───────────────────────────────
    this.running = true;
    this._lastTime = performance.now();
    this._tick();
  }

  /** Frame tick — drives mode update + projectile update + HUD. */
  _tick() {
    if (!this.running) return;

    const now = performance.now();
    const dt = Math.min((now - this._lastTime) / 1000, 0.05); // cap at 50ms
    this._lastTime = now;

    // Update shared systems
    this.projectiles.update(dt, (targetId) => this._resolveTarget(targetId));
    this.weapons.update(dt);

    // Update the active mode
    this.modeManager.update(dt);

    // Update HUD
    this.hud.update(dt);

    this._rafId = requestAnimationFrame(() => this._tick());
  }

  /** Resolve a target position for homing projectiles. */
  _resolveTarget(targetId) {
    // Delegate to race/battle systems for kart positions
    const raceSys = this.deps.raceSystems;
    if (raceSys && typeof raceSys.getKartPosition === 'function') {
      return raceSys.getKartPosition(targetId);
    }
    return null;
  }

  /** Switch to a different mode at runtime (e.g., GP advancing). */
  async switchMode(modeId) {
    const mode = createRebuildMode(modeId, this.deps);
    await this.modeManager.switchMode(mode);
  }

  /** Clean shutdown. */
  async dispose() {
    this.running = false;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    await this.modeManager.dispose();
    this.hud.dispose();
  }
}
