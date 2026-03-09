import { ModeBase } from './mode-base.js';

/**
 * Follow the Leader — periodic elimination mode.
 *
 * Features:
 *  - Pace-car bot leads at constant speed
 *  - Every 30s, last-place racer is eliminated
 *  - 15s grace period before first elimination
 *  - Items enabled for offensive/defensive play
 *  - Last racer standing wins
 */
export class FollowTheLeaderMode extends ModeBase {
  get id() { return 'follow_the_leader'; }

  async init() {
    await super.init();
    this.race = this.deps.raceSystems;
    this.ftl = this.deps.followTheLeader;
    this.hud = this.deps.hud;

    this.race?.initRace?.({ enableItems: true, enableBots: true, laps: 99 });

    // Initialize FTL elimination system
    this.ftl?.init?.(this.race?.bots, null);

    this.hud?.setModeInfo?.('Follow the Leader');
    this.hud?.showToast?.('Follow the Leader — Don\'t fall behind!', 3000);

    this._lastEliminationMsg = 0;
  }

  update(dt) {
    this.guard(() => {
      this.race?.updateRace?.(dt);
      this.race?.updateBots?.(dt);
      this.race?.updateItems?.(dt);

      // Get current standings for FTL evaluation
      const standings = this.race?.getStandings?.() || [];
      const ftlResult = this.ftl?.update?.(dt, standings);

      if (ftlResult?.eliminated) {
        this.hud?.showToast?.(`Racer eliminated!`, 2000);
      }

      if (ftlResult?.winner) {
        const isPlayer = ftlResult.winner === 'player';
        this.hud?.showToast?.(isPlayer ? 'You survived! Victory!' : `${ftlResult.winner} wins!`, 4000);
        this.finished = true;
      }

      // Show periodic status
      const status = this.ftl?.getStatus?.();
      if (status?.nextElimination !== undefined && status.nextElimination < 10) {
        const remaining = Math.ceil(status.nextElimination);
        if (remaining !== this._lastEliminationMsg && remaining > 0) {
          this._lastEliminationMsg = remaining;
        }
      }
    }, undefined);
  }

  async destroy() {
    this.ftl?.dispose?.();
    this.race?.disposeRace?.();
    await super.destroy();
  }
}
