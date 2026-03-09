import { ModeBase } from './mode-base.js';

/**
 * Grand Prix / Adventure — multi-race cup progression.
 *
 * Features:
 *  - Sequence of races from a cup definition
 *  - Carry-over standings with point scoring
 *  - Inter-race standings overlay
 *  - Final results screen with cup award
 */
export class GrandPrixMode extends ModeBase {
  get id() { return 'grand_prix'; }

  async init() {
    await super.init();
    this.gp = this.deps.grandPrix;
    this.race = this.deps.raceSystems;
    this.hud = this.deps.hud;

    this.gp?.start?.();
    const raceInfo = this.gp?.getCurrentRaceInfo?.();
    const trackName = raceInfo?.trackId || 'test_box';

    this.race?.initRace?.({
      enableItems: true,
      enableBots: true,
      laps: raceInfo?.laps || 3,
    });

    this.hud?.setModeInfo?.(`Grand Prix — Race ${raceInfo?.raceNumber || 1}`);
    this.hud?.showToast?.(`Track: ${trackName.replace(/_/g, ' ')}`, 2500);

    this._raceReported = false;
  }

  update(dt) {
    this.guard(() => {
      this.race?.updateRace?.(dt);
      this.race?.updateBots?.(dt);
      this.race?.updateItems?.(dt);

      // Report result when race finishes
      if (this.race?.isFinished?.() && !this._raceReported) {
        this._raceReported = true;
        const result = this.race.getResult?.();
        this.gp?.reportRaceResult?.(result);

        if (this.gp?.hasNextRace?.()) {
          this.gp?.showStandings?.();
          this.hud?.showToast?.('Next race starting...', 3000);
          // In a real implementation, the bridge would call switchMode
        } else {
          this.gp?.showFinalResults?.();
          const standings = this.gp?.getStandings?.();
          const winner = standings?.[0]?.name || 'You';
          this.hud?.showToast?.(`Grand Prix Complete! Winner: ${winner}`, 5000);
          this.finished = true;
        }
      }
    }, undefined);
  }

  async destroy() {
    this.race?.disposeRace?.();
    this.gp?.end?.();
    await super.destroy();
  }
}
