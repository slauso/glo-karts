/**
 * sp-battle-systems.js — Battle mode lifecycle for rebuilt SP modes.
 *
 * Handles arena spawning, lives/scoring, item distribution, and win conditions
 * for deathmatch, three-strikes, and CTF variants.
 */

import { createRaceBots, updateRaceBots, disposeRaceBots } from '../../../bot-controller.js';
import { getDriveline } from '../../../track-data-loader.js';
import {
  initThreeStrikes, onStrikeDamage, isPlayerAlive,
  getStrikesStatus, isThreeStrikesActive, disposeThreeStrikes,
} from '../../three-strikes.js';
import { drawWeapon } from '../../../weapons/weapon-inventory.js';
import {
  createDamageVignette, flashDamageVignette,
  triggerScreenShake, disposeHUD,
} from '../../../race-hud.js';

const BATTLE_TIME_LIMIT = 180; // 3 minutes
const RESPAWN_DELAY = 2;

export class SPBattleSystems {
  constructor(deps) {
    this.scene = deps.scene;
    this.trackData = deps.trackData;
    this.botLogic = deps.botLogic;
    this.projectiles = deps.projectiles;
    this.weapons = deps.weapons;
    this.hud = deps.hud;
    this.difficulty = deps.difficulty || 'normal';

    this.variant = 'deathmatch';
    this.bots = [];
    this.battleStarted = false;
    this.battleFinished = false;
    this.elapsed = 0;
    this.scores = {};
    this._playerKart = null;
    this._particantIds = [];
    this._respawnTimers = {};
    this._traps = [];
    this._hudEl = null;
    this._scoreEl = null;

    // CTF state
    this._flags = { red: { x: 0, z: 0, carrier: null }, blue: { x: 0, z: 0, carrier: null } };
    this._ctfScores = { red: 0, blue: 0 };
  }

  /**
   * @param {{ variant: string, bots: boolean, botCount?: number }} config
   */
  initBattle(config) {
    this.variant = config.variant || 'deathmatch';
    this.battleStarted = false;
    this.battleFinished = false;
    this.elapsed = 0;
    this.scores = {};
    this._traps = [];
    this._respawnTimers = {};

    // Create bots
    if (config.bots && this.trackData) {
      const count = config.botCount ?? this._botCountForDifficulty();
      this.bots = createRaceBots(this.scene, this.trackData, count);
      const driveline = getDriveline(this.trackData);
      if (driveline.length > 0) {
        this.botLogic.setPath(driveline.map(q => ({ x: q.center[0], z: q.center[2] })));
      }
    }

    // Setup participant IDs
    this._particantIds = ['player', ...this.bots.map(b => b.id)];
    for (const id of this._particantIds) {
      this.scores[id] = 0;
    }

    // Variant-specific init
    if (this.variant === 'three_strikes') {
      initThreeStrikes(this._particantIds);
    }

    if (this.variant === 'ctf') {
      this._initCTF();
    }

    // Create HUD
    createDamageVignette();
    this._createBattleHUD();
    this.battleStarted = true;
  }

  /**
   * Per-frame battle update.
   * @param {number} dt
   */
  updateBattle(dt) {
    if (!this.battleStarted || this.battleFinished) return;

    this.elapsed += dt;

    // Update bots
    updateRaceBots(this.bots, dt, 0, true);

    // AI weapon usage
    this._updateBotWeapons(dt);

    // Update projectile hits
    this._updateProjectileHits(dt);

    // Update traps
    this._updateTraps(dt);

    // Variant-specific logic
    if (this.variant === 'three_strikes') {
      this._updateThreeStrikes(dt);
    } else if (this.variant === 'ctf') {
      this._updateCTF(dt);
    } else {
      // Deathmatch — time limit check
      if (this.elapsed >= BATTLE_TIME_LIMIT) {
        this.battleFinished = true;
      }
    }

    // Update HUD
    this._updateBattleHUD();
  }

  setPlayerKart(kartMesh) {
    this._playerKart = kartMesh;
  }

  getKartPosition(id) {
    if (id === 'player' && this._playerKart) {
      const p = this._playerKart.position;
      return { x: p.x, y: p.y, z: p.z };
    }
    const bot = this.bots.find(b => b.id === id);
    if (bot) return { x: bot.position.x, y: bot.position.y, z: bot.position.z };
    return null;
  }

  playerFire(targetId) {
    if (!this._playerKart) return;
    const slot = this.weapons.getSlot('player');
    const p = this._playerKart.position;
    const heading = this._playerKart.rotation?.y || 0;
    const result = slot.fire({ x: p.x, y: p.y, z: p.z, heading }, targetId);
    if (result) this._handleFireResult(result);
  }

  isFinished() { return this.battleFinished; }

  getResult() {
    const sorted = Object.entries(this.scores).sort(([, a], [, b]) => b - a);
    return {
      variant: this.variant,
      scores: this.scores,
      standings: sorted.map(([id, score], i) => ({ id, score, rank: i + 1 })),
      winner: sorted[0]?.[0] || null,
      elapsed: this.elapsed,
    };
  }

  // ── Bot AI weapons ──────────────────────────────────────────

  _updateBotWeapons(dt) {
    for (const bot of this.bots) {
      if (bot.raceFinished) continue;
      const slot = this.weapons.getSlot(bot.id);

      // Give bots weapons periodically
      if (!slot.weaponId && Math.random() < 0.005) {
        const { id } = drawWeapon(0.5);
        slot.equip(id);
      }

      // Fire decision
      if (slot.canFire()) {
        const ai = this.botLogic.think({
          x: bot.position.x, z: bot.position.z,
          heading: bot.heading, speed: bot.speed,
        });
        if (ai.fire) {
          const result = slot.fire(
            { x: bot.position.x, y: bot.position.y, z: bot.position.z, heading: bot.heading },
            'player',
          );
          if (result) this._handleFireResult(result);
        }
      }
    }
  }

  _handleFireResult(result) {
    if (result.type === 'ballistic' || result.type === 'homing') {
      this.projectiles.spawn({
        x: result.x, y: result.y, z: result.z,
        vx: result.vx, vy: result.vy || 0, vz: result.vz,
        type: result.type, ownerId: result.ownerId, targetId: result.targetId,
      });
    } else if (result.type === 'trap') {
      this._traps.push({ ...result });
    }
  }

  _updateProjectileHits(dt) {
    const active = this.projectiles.getActive();
    const hitR = 2.5;

    for (const proj of active) {
      // vs player
      if (proj.ownerId !== 'player' && this._playerKart) {
        const p = this._playerKart.position;
        const dx = proj.x - p.x, dy = proj.y - p.y, dz = proj.z - p.z;
        if (dx * dx + dy * dy + dz * dz < hitR * hitR) {
          if (!this.weapons.getSlot('player').hasShield()) {
            this._onPlayerHit(proj.ownerId);
          }
          proj.active = false;
        }
      }

      // vs bots
      for (const bot of this.bots) {
        if (proj.ownerId === bot.id || bot.raceFinished) continue;
        const dx = proj.x - bot.position.x, dy = proj.y - bot.position.y, dz = proj.z - bot.position.z;
        if (dx * dx + dy * dy + dz * dz < hitR * hitR) {
          this._onBotHit(bot.id, proj.ownerId);
          proj.active = false;
          break;
        }
      }
    }
  }

  _updateTraps(dt) {
    for (let i = this._traps.length - 1; i >= 0; i--) {
      const trap = this._traps[i];
      trap.lifetime -= dt;
      if (trap.lifetime <= 0) { this._traps.splice(i, 1); continue; }

      if (trap.ownerId !== 'player' && this._playerKart) {
        const p = this._playerKart.position;
        const dx = trap.x - p.x, dz = trap.z - p.z;
        if (dx * dx + dz * dz < 4) {
          if (!this.weapons.getSlot('player').hasShield()) {
            this._onPlayerHit(trap.ownerId);
          }
          this._traps.splice(i, 1);
          continue;
        }
      }

      for (const bot of this.bots) {
        if (trap.ownerId === bot.id) continue;
        const dx = trap.x - bot.position.x, dz = trap.z - bot.position.z;
        if (dx * dx + dz * dz < 4) {
          this._onBotHit(bot.id, trap.ownerId);
          this._traps.splice(i, 1);
          break;
        }
      }
    }
  }

  _onPlayerHit(attackerId) {
    flashDamageVignette();
    triggerScreenShake(0.4);
    if (this.variant === 'three_strikes') {
      onStrikeDamage('player');
    }
    this.scores[attackerId] = (this.scores[attackerId] || 0) + 1;
  }

  _onBotHit(botId, attackerId) {
    const bot = this.bots.find(b => b.id === botId);
    if (bot) bot.speed *= 0.15;
    if (this.variant === 'three_strikes') {
      const result = onStrikeDamage(botId);
      if (result.eliminated) bot.raceFinished = true;
    }
    this.scores[attackerId] = (this.scores[attackerId] || 0) + 1;
  }

  // ── 3-Strikes ─────────────────────────────────────────────

  _updateThreeStrikes(dt) {
    const status = getStrikesStatus();
    if (!status.active) {
      this.battleFinished = true;
    }
  }

  // ── CTF ───────────────────────────────────────────────────

  _initCTF() {
    this._flags = {
      red: { x: -30, z: 0, carrier: null, home: { x: -30, z: 0 } },
      blue: { x: 30, z: 0, carrier: null, home: { x: 30, z: 0 } },
    };
    this._ctfScores = { red: 0, blue: 0 };
  }

  _updateCTF(dt) {
    const captureR = 4;
    const scoreLimit = 3;

    // Player is red team — tries to grab blue flag
    if (this._playerKart && !this._flags.blue.carrier) {
      const p = this._playerKart.position;
      const dx = p.x - this._flags.blue.x, dz = p.z - this._flags.blue.z;
      if (dx * dx + dz * dz < captureR * captureR) {
        this._flags.blue.carrier = 'player';
      }
    }

    // Player carrying blue flag — check return to red base
    if (this._flags.blue.carrier === 'player' && this._playerKart) {
      const p = this._playerKart.position;
      this._flags.blue.x = p.x;
      this._flags.blue.z = p.z;
      const dx = p.x - this._flags.red.home.x, dz = p.z - this._flags.red.home.z;
      if (dx * dx + dz * dz < captureR * captureR) {
        this._ctfScores.red++;
        this._flags.blue.carrier = null;
        this._flags.blue.x = this._flags.blue.home.x;
        this._flags.blue.z = this._flags.blue.home.z;
      }
    }

    // Bots try to grab red flag
    for (const bot of this.bots) {
      if (bot.raceFinished || this._flags.red.carrier) continue;
      const dx = bot.position.x - this._flags.red.x, dz = bot.position.z - this._flags.red.z;
      if (dx * dx + dz * dz < captureR * captureR) {
        this._flags.red.carrier = bot.id;
      }
    }

    // Bot carrying flag — return to blue base
    if (this._flags.red.carrier && this._flags.red.carrier !== 'player') {
      const bot = this.bots.find(b => b.id === this._flags.red.carrier);
      if (bot) {
        this._flags.red.x = bot.position.x;
        this._flags.red.z = bot.position.z;
        const dx = bot.position.x - this._flags.blue.home.x, dz = bot.position.z - this._flags.blue.home.z;
        if (dx * dx + dz * dz < captureR * captureR) {
          this._ctfScores.blue++;
          this._flags.red.carrier = null;
          this._flags.red.x = this._flags.red.home.x;
          this._flags.red.z = this._flags.red.home.z;
        }
      }
    }

    // Win condition
    if (this._ctfScores.red >= scoreLimit || this._ctfScores.blue >= scoreLimit || this.elapsed >= BATTLE_TIME_LIMIT) {
      this.battleFinished = true;
    }
  }

  // ── HUD ───────────────────────────────────────────────────

  _createBattleHUD() {
    this._hudEl = document.createElement('div');
    this._hudEl.id = 'battle-hud';
    this._hudEl.style.cssText = `
      position:fixed; top:10px; left:50%; transform:translateX(-50%);
      color:#fff; font-family:'Poppins',sans-serif; font-size:20px;
      background:rgba(0,0,0,.6); padding:8px 20px; border-radius:10px;
      z-index:160; pointer-events:none; text-align:center;
    `;
    this._scoreEl = document.createElement('div');
    this._hudEl.appendChild(this._scoreEl);
    document.body.appendChild(this._hudEl);
  }

  _updateBattleHUD() {
    if (!this._scoreEl) return;
    const remaining = Math.max(0, BATTLE_TIME_LIMIT - this.elapsed);
    const mins = Math.floor(remaining / 60);
    const secs = Math.floor(remaining % 60);
    const timeStr = `${mins}:${String(secs).padStart(2, '0')}`;

    if (this.variant === 'ctf') {
      this._scoreEl.innerHTML = `🔴 ${this._ctfScores.red} — ${this._ctfScores.blue} 🔵 | ⏱ ${timeStr}`;
    } else if (this.variant === 'three_strikes') {
      const status = getStrikesStatus();
      const playerLives = status.lives?.player ?? 0;
      this._scoreEl.innerHTML = `❤️ ${playerLives}/3 | Alive: ${this._particantIds.length - status.eliminated.length} | ⏱ ${timeStr}`;
    } else {
      const pScore = this.scores.player || 0;
      this._scoreEl.innerHTML = `Kills: ${pScore} | ⏱ ${timeStr}`;
    }
  }

  _botCountForDifficulty() {
    switch (this.difficulty) {
      case 'easy': return 3;
      case 'hard': return 7;
      case 'expert': return 11;
      default: return 5;
    }
  }

  disposeBattle() {
    if (this.bots.length) disposeRaceBots(this.bots);
    this.bots = [];
    this._traps = [];
    if (this.variant === 'three_strikes') disposeThreeStrikes();
    if (this._hudEl) { this._hudEl.remove(); this._hudEl = null; }
    disposeHUD();
  }
}
