import { ModeBase } from './mode-base.js';

/**
 * Soccer mode — ball physics, goals, team scoring, resets.
 *
 * Features:
 *  - Havok physics ball spawns at center
 *  - Red vs Blue team goals
 *  - Score limit (first to 5) or time limit (3 min)
 *  - 2-second pause and reset after each goal
 *  - Bot teammates and opponents
 */
export class SoccerMode extends ModeBase {
  get id() { return 'soccer'; }

  async init() {
    await super.init();
    this.soccer = this.deps.soccer;
    this.hud = this.deps.hud;
    this.race = this.deps.raceSystems;

    // Init bots for soccer teams
    this.race?.initRace?.({ enableItems: false, enableBots: true, laps: 99, botCount: 5 });

    // Init soccer field/ball/goals
    this.soccer?.init?.();

    this.hud?.setModeInfo?.('Soccer — First to 5');
    this.hud?.showToast?.('Soccer Match — Score!', 2500);
    this._lastScore = { red: 0, blue: 0 };
  }

  update(dt) {
    this.guard(() => {
      // Bot movement
      this.race?.updateBots?.(dt);

      // Soccer physics + scoring
      const result = this.soccer?.update?.(dt);

      // Announce goals
      const score = this.soccer?.getScore?.();
      if (score) {
        if (score.red > this._lastScore.red) {
          this.hud?.showToast?.(`GOAL! Red ${score.red} — ${score.blue} Blue`, 2000);
        }
        if (score.blue > this._lastScore.blue) {
          this.hud?.showToast?.(`GOAL! Red ${score.red} — ${score.blue} Blue`, 2000);
        }
        this._lastScore = { red: score.red, blue: score.blue };
      }

      // Check match end
      if (result?.finished) {
        const winner = result.winner || (score?.red > score?.blue ? 'Red' : 'Blue');
        this.hud?.showToast?.(`Match Over! ${winner} wins!`, 4000);
        this.finished = true;
      }
    }, undefined);
  }

  async destroy() {
    this.soccer?.dispose?.();
    this.race?.disposeRace?.();
    await super.destroy();
  }
}
