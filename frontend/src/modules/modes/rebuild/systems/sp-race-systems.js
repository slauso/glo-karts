/**
 * sp-race-systems.js — Race lifecycle for rebuilt SP modes.
 *
 * Wraps the existing bot-controller, checkpoints, race-items, and race-hud
 * modules into a cohesive service object that mode classes consume via DI.
 */

import { createRaceBots, updateRaceBots, getRacePositions, getBotProgress, disposeRaceBots } from '../../../bot-controller.js';
import {
  initCheckpoints, updateCheckpoints, getRaceProgress,
  getCurrentQuadCenter, getCurrentQuadHeading, isRaceFinished,
  getCurrentLap, getTotalLaps,
} from '../../../checkpoints.js';
import {
  initRaceItems, updateRaceItems, useCurrentItem,
  getCurrentItem, getActiveEffect, disposeRaceItems, onItemCollected,
} from '../../../race-items.js';
import {
  createPositionBadge, updatePositionBadge,
  createNitroGauge, updateNitroGauge,
  createWrongWayIndicator, showWrongWay,
  playItemRoulette, createTrafficLight, animateTrafficLight,
  triggerScreenShake, createDamageVignette, flashDamageVignette,
  disposeHUD,
} from '../../../race-hud.js';
import { getDriveline, getStartGrid, getLapCount } from '../../../track-data-loader.js';
import { drawWeapon } from '../../../weapons/weapon-inventory.js';

// ── Constants ───────────────────────────────────────────────────────────────

const COUNTDOWN_SECONDS = 3;
const ITEM_BOX_PICKUP_RADIUS = 3.5;

/**
 * @typedef {object} RaceConfig
 * @property {boolean} enableItems
 * @property {boolean} enableBots
 * @property {number} laps
 * @property {number} [botCount]
 */

export class SPRaceSystems {
  /**
   * @param {object} deps
   * @param {import('@babylonjs/core').Scene} deps.scene
   * @param {object} deps.trackData
   * @param {import('../../../ai/bot-logic.js').BotLogicService} deps.botLogic
   * @param {import('../../../weapons/projectile-system.js').ProjectileSystem} deps.projectiles
   * @param {import('../../../weapons/weapon-inventory.js').WeaponInventory} deps.weapons
   * @param {import('./sp-hud-controller.js').SPHudController} deps.hud
   * @param {string} deps.difficulty
   */
  constructor(deps) {
    this.scene = deps.scene;
    this.trackData = deps.trackData;
    this.botLogic = deps.botLogic;
    this.projectiles = deps.projectiles;
    this.weapons = deps.weapons;
    this.hud = deps.hud;
    this.difficulty = deps.difficulty || 'normal';

    this.bots = [];
    this.raceStarted = false;
    this.raceFinished = false;
    this.countdownTimer = COUNTDOWN_SECONDS;
    this.raceTime = 0;
    this.playerProgress = 0;
    this.playerPosition = 1;
    this._config = null;
    this._playerKart = null;
    this._traps = [];
    this._raceResult = null;
  }

  /**
   * Initialize a race session.
   * @param {RaceConfig} config
   */
  initRace(config) {
    this._config = config;
    this.raceStarted = false;
    this.raceFinished = false;
    this.countdownTimer = COUNTDOWN_SECONDS;
    this.raceTime = 0;
    this.playerProgress = 0;
    this.playerPosition = 1;
    this._raceResult = null;
    this._traps = [];

    // Initialize checkpoints from track data
    if (this.trackData) {
      initCheckpoints(this.trackData);
    }

    // Create HUD
    createPositionBadge();
    createNitroGauge();
    createWrongWayIndicator();
    createDamageVignette();

    // Create bots
    if (config.enableBots && this.trackData) {
      const botCount = config.botCount ?? this._botCountForDifficulty();
      this.bots = createRaceBots(this.scene, this.trackData, botCount);

      // Feed driveline to botLogic for AI modes
      const driveline = getDriveline(this.trackData);
      if (driveline.length > 0) {
        this.botLogic.setPath(driveline.map(q => ({ x: q.center[0], z: q.center[2] })));
      }
    }

    // Init items
    if (config.enableItems && this.trackData?.items) {
      initRaceItems(this.scene, this.trackData.items);
      onItemCollected((weaponId) => {
        playItemRoulette(weaponId);
        this.weapons.getSlot('player').equip(weaponId);
      });
    }

    // Traffic light countdown
    createTrafficLight();
  }

  /**
   * Per-frame race update.
   * @param {number} dt
   */
  updateRace(dt) {
    if (this.raceFinished) return;

    // Countdown phase
    if (!this.raceStarted) {
      this.countdownTimer -= dt;
      if (this.countdownTimer <= 0) {
        this.raceStarted = true;
        animateTrafficLight();
      }
      return;
    }

    this.raceTime += dt;

    // Update checkpoints
    if (this._playerKart) {
      const pos = this._playerKart.position || { x: 0, y: 0, z: 0 };
      const cpResult = updateCheckpoints(pos);
      this.playerProgress = getRaceProgress();

      if (cpResult.raceFinished && !this.raceFinished) {
        this._finishRace();
      }

      // Update position badge
      const positions = this.getStandings();
      const myPos = positions.findIndex(p => p.id === 'player') + 1;
      this.playerPosition = myPos || 1;
      updatePositionBadge(this.playerPosition);
    }

    // Update items
    if (this._config?.enableItems && this._playerKart) {
      const posRatio = this.bots.length > 0 ? (this.playerPosition - 1) / Math.max(1, this.bots.length) : 0.5;
      const itemResult = updateRaceItems(dt, this._playerKart, posRatio);
      if (itemResult.boost) {
        updateNitroGauge(itemResult.boost, true);
      }
      if (itemResult.spinout) {
        flashDamageVignette();
        triggerScreenShake(0.3);
      }
    }

    // Update projectiles
    this._updateProjectileHits(dt);

    // Update traps
    this._updateTraps(dt);
  }

  /**
   * Per-frame bot update.
   * @param {number} dt
   */
  updateBots(dt) {
    if (!this.raceStarted || this.raceFinished) return;
    updateRaceBots(this.bots, dt, this.playerProgress, this.raceStarted);

    // AI weapon usage
    for (const bot of this.bots) {
      if (bot.raceFinished) continue;
      const slot = this.weapons.getSlot(bot.id);

      // Periodically give bots items (simulates item box pickup)
      if (!slot.weaponId && Math.random() < 0.003) {
        const progress = getBotProgress(bot);
        const posRatio = this.bots.length > 0 ? progress / (getLapCount(this.trackData) || 3) : 0.5;
        const { id } = drawWeapon(Math.min(1, posRatio));
        slot.equip(id);
      }

      // AI fire decision
      if (slot.canFire()) {
        const aiOut = this.botLogic.think({
          x: bot.position.x,
          z: bot.position.z,
          heading: bot.heading,
          speed: bot.speed,
        });
        if (aiOut.fire) {
          const fireResult = slot.fire(
            { x: bot.position.x, y: bot.position.y, z: bot.position.z, heading: bot.heading },
            'player',
          );
          if (fireResult) this._handleFireResult(fireResult);
        }
      }
    }
  }

  /**
   * Per-frame item update (placeholder for custom item logic).
   * @param {number} dt
   */
  updateItems(dt) {
    // Items already updated in updateRace; this is for mode-specific overrides
    void dt;
  }

  /** Register the player kart mesh for positional queries. */
  setPlayerKart(kartMesh) {
    this._playerKart = kartMesh;
  }

  /** Get kart position by ID (for homing projectiles). */
  getKartPosition(id) {
    if (id === 'player' && this._playerKart) {
      const p = this._playerKart.position;
      return { x: p.x, y: p.y, z: p.z };
    }
    const bot = this.bots.find(b => b.id === id);
    if (bot) return { x: bot.position.x, y: bot.position.y, z: bot.position.z };
    return null;
  }

  /** Get sorted standings array. */
  getStandings() {
    return getRacePositions(this.bots, this.playerProgress);
  }

  /** @returns {boolean} */
  isFinished() {
    return this.raceFinished;
  }

  /** @returns {object|null} */
  getResult() {
    return this._raceResult;
  }

  /** Fire the player's weapon. */
  playerFire(targetId) {
    if (!this._playerKart) return;
    const slot = this.weapons.getSlot('player');
    const p = this._playerKart.position;
    const heading = this._playerKart.rotation?.y || 0;
    const result = slot.fire({ x: p.x, y: p.y, z: p.z, heading }, targetId);
    if (result) this._handleFireResult(result);
  }

  /** Handle any fire result (spawn projectile, trap, etc). */
  _handleFireResult(result) {
    if (result.type === 'ballistic' || result.type === 'homing') {
      this.projectiles.spawn({
        x: result.x, y: result.y, z: result.z,
        vx: result.vx, vy: result.vy || 0, vz: result.vz,
        type: result.type, ownerId: result.ownerId, targetId: result.targetId,
      });
    } else if (result.type === 'trap') {
      this._traps.push({
        x: result.x, y: result.y, z: result.z,
        damage: result.damage, lifetime: result.lifetime,
        ownerId: result.ownerId, weaponId: result.weaponId,
      });
    }
    // Buffs/shields handled internally by WeaponSlot
  }

  /** Check projectile collisions. */
  _updateProjectileHits(dt) {
    const active = this.projectiles.getActive();
    const hitRadius = 2.5;

    for (const proj of active) {
      // Check vs player
      if (proj.ownerId !== 'player' && this._playerKart) {
        const p = this._playerKart.position;
        const dx = proj.x - p.x, dy = proj.y - p.y, dz = proj.z - p.z;
        if (dx * dx + dy * dy + dz * dz < hitRadius * hitRadius) {
          const playerSlot = this.weapons.getSlot('player');
          if (!playerSlot.hasShield()) {
            flashDamageVignette();
            triggerScreenShake(0.4);
          }
          proj.active = false;
        }
      }

      // Check vs bots
      for (const bot of this.bots) {
        if (proj.ownerId === bot.id || bot.raceFinished) continue;
        const dx = proj.x - bot.position.x, dy = proj.y - bot.position.y, dz = proj.z - bot.position.z;
        if (dx * dx + dy * dy + dz * dz < hitRadius * hitRadius) {
          bot.speed *= 0.3; // slow down on hit
          proj.active = false;
          break;
        }
      }
    }
  }

  /** Check trap collisions. */
  _updateTraps(dt) {
    const trapHitRadius = 2.0;
    for (let i = this._traps.length - 1; i >= 0; i--) {
      const trap = this._traps[i];
      trap.lifetime -= dt;
      if (trap.lifetime <= 0) {
        this._traps.splice(i, 1);
        continue;
      }

      // Check vs player
      if (trap.ownerId !== 'player' && this._playerKart) {
        const p = this._playerKart.position;
        const dx = trap.x - p.x, dz = trap.z - p.z;
        if (dx * dx + dz * dz < trapHitRadius * trapHitRadius) {
          const playerSlot = this.weapons.getSlot('player');
          if (!playerSlot.hasShield()) {
            flashDamageVignette();
            triggerScreenShake(0.3);
          }
          this._traps.splice(i, 1);
          continue;
        }
      }

      // Check vs bots
      for (const bot of this.bots) {
        if (trap.ownerId === bot.id || bot.raceFinished) continue;
        const dx = trap.x - bot.position.x, dz = trap.z - bot.position.z;
        if (dx * dx + dz * dz < trapHitRadius * trapHitRadius) {
          bot.speed *= 0.2;
          this._traps.splice(i, 1);
          break;
        }
      }
    }
  }

  _finishRace() {
    this.raceFinished = true;
    const standings = this.getStandings();
    this._raceResult = {
      standings,
      playerPosition: this.playerPosition,
      raceTime: this.raceTime,
      totalLaps: getTotalLaps(),
    };
  }

  _botCountForDifficulty() {
    switch (this.difficulty) {
      case 'easy': return 3;
      case 'hard': return 7;
      case 'expert': return 11;
      default: return 5;
    }
  }

  disposeRace() {
    if (this.bots.length) disposeRaceBots(this.bots);
    this.bots = [];
    disposeRaceItems();
    disposeHUD();
    this._traps = [];
  }
}
