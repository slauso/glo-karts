/**
 * soccer-service.js — Soccer mode service.
 *
 * Wraps the existing soccer module into the DI service interface.
 */

import {
  initSoccer, updateSoccer, isSoccerActive, getSoccerScore,
  getBallMesh, disposeSoccer,
} from '../../soccer.js';

export class SoccerService {
  constructor(deps) {
    this.scene = deps?.scene;
    this._active = false;
  }

  init() {
    if (this.scene) {
      initSoccer(this.scene);
      this._active = true;
    }
  }

  update(dt) {
    if (!this._active) return null;
    return updateSoccer(dt);
  }

  isActive() {
    return this._active && isSoccerActive();
  }

  getScore() {
    return getSoccerScore();
  }

  getBallMesh() {
    return getBallMesh();
  }

  dispose() {
    if (this._active) {
      disposeSoccer();
      this._active = false;
    }
  }
}
