import { ModeBase } from './mode-base.js';

/**
 * Local 2-player split-screen orchestrator.
 *
 * Features:
 *  - Vertical or horizontal viewport split
 *  - Dual input maps (WASD + Arrow keys)
 *  - Shared physics scene with two player karts
 *  - Per-player HUD (position, items, nitro)
 *  - Can overlay on any race or battle mode
 *  - Bots fill remaining grid slots
 */
export class LocalSplitScreenMode extends ModeBase {
  get id() { return 'local_2p'; }

  async init() {
    await super.init();
    this.split = this.deps.splitScreen;
    this.race = this.deps.raceSystems;
    this.hud = this.deps.hud;

    const layout = this.deps.gameConfig?.splitLayout || 'vertical';
    const controls = this.deps.gameConfig?.controls || ['wasd', 'arrows'];

    this.split?.init?.({
      players: 2,
      layout,
      controls,
    });

    // Initialize race systems for both players + bots
    this.race?.initRace?.({
      enableItems: true,
      enableBots: true,
      laps: this.deps.gameConfig?.laps || 3,
      botCount: this.deps.gameConfig?.botCount || 4,
    });

    this.hud?.setModeInfo?.('Local 2P Split-Screen');
    this.hud?.showToast?.('Local 2P — Ready!', 2000);
  }

  update(dt) {
    this.guard(() => {
      // Update split-screen input processing
      this.split?.update?.(dt);

      // Update race for both players
      this.race?.updateRace?.(dt);
      this.race?.updateBots?.(dt);
      this.race?.updateItems?.(dt);

      // Check race finish
      if (this.race?.isFinished?.()) {
        const result = this.race.getResult?.();
        this.hud?.showToast?.('Race Complete!', 4000);
        this.finished = true;
      }
    }, undefined);
  }

  async destroy() {
    this.split?.dispose?.();
    this.race?.disposeRace?.();
    await super.destroy();
  }
}
