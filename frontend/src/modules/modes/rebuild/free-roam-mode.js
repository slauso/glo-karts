import { ModeBase } from './mode-base.js';

/**
 * Free Roam — open driving with no race constraints.
 *
 * Features:
 *  - No laps, no items, no opponents, no timer
 *  - Stable spawn and respawn behavior
 *  - Minimap display
 *  - Speed display
 *  - Long-session stability (no memory leaks)
 */
export class FreeRoamMode extends ModeBase {
  get id() { return 'free_roam'; }

  async init() {
    await super.init();
    this.drive = this.deps.driveSystems;
    this.hud = this.deps.hud;

    this.drive?.init?.({ items: false, bots: false, timer: false });
    this.hud?.setModeInfo?.('Free Roam');
    this.hud?.showToast?.('Free Roam — Explore!');
    this._elapsed = 0;
  }

  update(dt) {
    this.guard(() => {
      this.drive?.update?.(dt);
      this._elapsed += dt;
    }, undefined);
  }

  async destroy() {
    this.drive?.dispose?.();
    await super.destroy();
  }
}
