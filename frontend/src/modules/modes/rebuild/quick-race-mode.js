import { NormalRaceMode } from './normal-race-mode.js';

/**
 * Fast-start race mode. Inherits NormalRaceMode behavior but auto-picks
 * random sensible defaults (track, bot count, laps) for instant play.
 */
export class QuickRaceMode extends NormalRaceMode {
  get id() { return 'quick_race'; }

  async init() {
    // Apply randomized defaults for quick-start feel
    if (!this.deps.gameConfig) this.deps.gameConfig = {};
    const cfg = this.deps.gameConfig;
    if (!cfg.laps) cfg.laps = [2, 3, 3, 5][Math.floor(Math.random() * 4)];
    if (!cfg.botCount) cfg.botCount = [3, 5, 5, 7][Math.floor(Math.random() * 4)];

    await super.init();
    this.deps.hud?.setModeInfo?.(`Quick Race — ${cfg.laps} Laps`);
    this.deps.hud?.showToast?.('Quick Race — GO!');
  }
}
