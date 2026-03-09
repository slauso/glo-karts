/**
 * ghost-service.js — Ghost recording and playback for Time Trial mode.
 *
 * Wraps the existing ghost-recorder module into the DI service interface.
 */

import {
  startRecording, recordFrame, stopRecording,
  loadGhost, spawnGhostKart, updateGhostPlayback, disposeGhost,
} from '../../../ghost-recorder.js';

export class GhostService {
  constructor() {
    this._recording = false;
  }

  startRecording() {
    startRecording();
    this._recording = true;
  }

  recordFrame(dt) {
    if (this._recording) recordFrame(dt);
  }

  stopRecording() {
    if (this._recording) {
      stopRecording();
      this._recording = false;
    }
  }

  async spawnBestGhost(scene) {
    const ghostData = loadGhost();
    if (ghostData) {
      spawnGhostKart(scene || null);
    }
  }

  updatePlayback(dt) {
    updateGhostPlayback(dt);
  }

  dispose() {
    this.stopRecording();
    disposeGhost();
  }
}
