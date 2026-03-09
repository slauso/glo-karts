import { ModeBase } from './mode-base.js';

/**
 * ModeManager owns active mode lifecycle and update dispatch.
 */
export class ModeManager {
  constructor({ logger } = {}) {
    this.logger = logger || console;
    /** @type {ModeBase|null} */
    this.activeMode = null;
  }

  /**
   * @param {ModeBase} mode
   */
  async switchMode(mode) {
    if (!(mode instanceof ModeBase)) {
      throw new Error('switchMode expects a ModeBase instance');
    }

    if (this.activeMode) {
      await this.activeMode.destroy();
    }

    this.activeMode = mode;
    await this.activeMode.init();
    this.logger.info?.(`[ModeManager] active mode -> ${mode.id}`);
  }

  /**
   * @param {number} dt
   */
  update(dt) {
    if (!this.activeMode || !this.activeMode.initialized || this.activeMode.finished) {
      return;
    }
    this.activeMode.update(dt);
  }

  async dispose() {
    if (this.activeMode) {
      await this.activeMode.destroy();
      this.activeMode = null;
    }
  }
}
