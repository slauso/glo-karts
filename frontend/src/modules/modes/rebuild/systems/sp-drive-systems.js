/**
 * sp-drive-systems.js — Free-roam driving system for SP modes.
 *
 * Provides a minimal driving environment with no race constraints,
 * items, or opponents. Used by Free Roam mode.
 */

export class SPDriveSystems {
  constructor(deps) {
    this.scene = deps.scene;
    this.trackData = deps.trackData;
    this._initialized = false;
    this._playerKart = null;
    this._elapsed = 0;
  }

  init(config = {}) {
    this._initialized = true;
    this._elapsed = 0;
  }

  setPlayerKart(kart) {
    this._playerKart = kart;
  }

  update(dt) {
    if (!this._initialized) return;
    this._elapsed += dt;
  }

  dispose() {
    this._initialized = false;
  }
}
