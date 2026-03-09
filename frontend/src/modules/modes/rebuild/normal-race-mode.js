import { ModeBase } from './mode-base.js';

/**
 * Standard lap race with bots and items.
 *
 * Full lifecycle:
 *  1. init() → creates bots, items, HUD, countdown
 *  2. update(dt) → drives race systems (checkpoints, bots, items, projectiles)
 *  3. destroy() → cleans up all resources
 */
export class NormalRaceMode extends ModeBase {
  get id() { return 'normal_race'; }

  async init() {
    await super.init();
    this.race = this.deps.raceSystems;
    this.hud = this.deps.hud;
    this._laps = this.deps.gameConfig?.laps || 3;
    this._botCount = this.deps.gameConfig?.botCount;

    this.race?.initRace?.({
      enableItems: true,
      enableBots: true,
      laps: this._laps,
      botCount: this._botCount,
    });

    this.hud?.setModeInfo?.(`Normal Race — ${this._laps} Laps`);
    this.hud?.showToast?.('Normal Race — Ready!');
  }

  update(dt) {
    this.guard(() => {
      this.race?.updateRace?.(dt);
      this.race?.updateBots?.(dt);
      this.race?.updateItems?.(dt);

      // Check for race completion
      if (this.race?.isFinished?.()) {
        const result = this.race.getResult?.();
        const pos = result?.playerPosition || 1;
        this.hud?.showToast?.(`Finished ${pos}${pos === 1 ? 'st' : pos === 2 ? 'nd' : pos === 3 ? 'rd' : 'th'}!`, 4000);
        this.finished = true;
      }
    }, undefined);
  }

  async destroy() {
    this.race?.disposeRace?.();
    await super.destroy();
  }
}
