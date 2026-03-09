import { ModeBase } from './mode-base.js';

/**
 * Time Trial with ghost record/playback.
 *
 * Features:
 *  - No items, no bots — pure time attack
 *  - Records kart position each frame → saves to localStorage
 *  - Spawns best ghost from previous run
 *  - Displays lap splits and best time comparison
 */
export class TimeTrialMode extends ModeBase {
  get id() { return 'time_trial'; }

  async init() {
    await super.init();
    this.race = this.deps.raceSystems;
    this.ghost = this.deps.ghost;
    this.hud = this.deps.hud;

    const laps = this.deps.gameConfig?.laps || 3;
    this.race?.initRace?.({ enableItems: false, enableBots: false, laps });

    // Start ghost recording and spawn previous best
    this.ghost?.startRecording?.();
    this.ghost?.spawnBestGhost?.(this.deps.scene);

    this.hud?.setModeInfo?.(`Time Trial — ${laps} Laps`);
    this.hud?.showToast?.('Time Trial — Beat your ghost!');

    this._lapTimes = [];
    this._lapStart = 0;
  }

  update(dt) {
    this.guard(() => {
      this.race?.updateRace?.(dt);
      this.ghost?.recordFrame?.(dt);
      this.ghost?.updatePlayback?.(dt);

      // Track lap splits
      if (this.race?.raceTime !== undefined) {
        const currentLap = this.race.playerProgress ? Math.floor(this.race.playerProgress) : 0;
        if (currentLap > this._lapTimes.length) {
          const lapTime = this.race.raceTime - this._lapStart;
          this._lapTimes.push(lapTime);
          this._lapStart = this.race.raceTime;
          const lapStr = lapTime.toFixed(2);
          this.hud?.showToast?.(`Lap ${currentLap}: ${lapStr}s`, 2000);
        }
      }

      // Check race finish
      if (this.race?.isFinished?.()) {
        const totalTime = this.race.raceTime?.toFixed?.(2) || '0.00';
        this.hud?.showToast?.(`Finished! Time: ${totalTime}s`, 5000);
        this.ghost?.stopRecording?.();
        this.finished = true;
      }
    }, undefined);
  }

  async destroy() {
    this.ghost?.stopRecording?.();
    this.ghost?.dispose?.();
    this.race?.disposeRace?.();
    await super.destroy();
  }
}
