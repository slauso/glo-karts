import { ModeBase } from './mode-base.js';

/**
 * Battle mode — supports deathmatch, three-strikes, and CTF variants.
 *
 * Features:
 *  - Arena spawning with bots
 *  - 3-Strikes: balloon lives, elimination, last standing wins
 *  - Deathmatch: time-limited kills, highest score wins
 *  - CTF: capture/return flags, score limit or time limit
 *  - Items/weapons active with full projectile + trap support
 *  - Kill feed and damage VFX
 */
export class BattleMode extends ModeBase {
  constructor(deps = {}, variant = 'deathmatch') {
    super(deps);
    this.variant = variant;
  }

  get id() { return `battle_${this.variant}`; }

  async init() {
    await super.init();
    this.battle = this.deps.battleSystems;
    this.hud = this.deps.hud;

    const botCount = this.deps.gameConfig?.botCount;
    this.battle?.initBattle?.({
      variant: this.variant,
      bots: true,
      botCount,
    });

    const variantLabel = {
      deathmatch: 'Deathmatch',
      three_strikes: '3-Strikes',
      ctf: 'Capture the Flag',
    }[this.variant] || this.variant;

    this.hud?.setModeInfo?.(`Battle — ${variantLabel}`);
    this.hud?.showToast?.(`${variantLabel} — Fight!`, 2500);
  }

  update(dt) {
    this.guard(() => {
      this.battle?.updateBattle?.(dt);

      if (this.battle?.isFinished?.()) {
        const result = this.battle.getResult?.();
        const winner = result?.winner;
        const isPlayer = winner === 'player';
        this.hud?.showToast?.(isPlayer ? 'VICTORY!' : 'Defeat', 4000);
        this.finished = true;
      }
    }, undefined);
  }

  async destroy() {
    this.battle?.disposeBattle?.();
    await super.destroy();
  }
}
