/**
 * ftl-service.js — Follow the Leader mode service.
 *
 * Wraps the existing follow-the-leader module into the DI service interface.
 */

import {
  initFTL, updateFTL, isFTLActive, getFTLStatus, disposeFTL,
} from '../../follow-the-leader.js';

export class FTLService {
  constructor(deps) {
    this.scene = deps?.scene;
    this.botLogic = deps?.botLogic;
    this._active = false;
  }

  init(bots, playerMesh) {
    initFTL(this.scene, bots, playerMesh);
    this._active = true;
  }

  update(dt, standings) {
    if (!this._active) return null;
    const playerProgress = standings?.[0] || 0;
    return updateFTL(dt, playerProgress, standings);
  }

  isActive() {
    return this._active && isFTLActive();
  }

  getStatus() {
    return getFTLStatus();
  }

  dispose() {
    if (this._active) {
      disposeFTL();
      this._active = false;
    }
  }
}
