export class ModeManager {
  constructor() {
    this.registry = new Map();
    this.currentMode = null;
  }

  register(mode) {
    if (!mode?.id) {
      throw new Error('ModeManager.register requires a mode with an id');
    }
    this.registry.set(mode.id, mode);
    return mode;
  }

  async activate(modeId) {
    const mode = this.registry.get(modeId);
    if (!mode) {
      throw new Error(`ModeManager.activate missing mode: ${modeId}`);
    }

    if (this.currentMode && this.currentMode !== mode) {
      this.currentMode.dispose();
    }

    this.currentMode = mode;
    if (!mode.initialized) {
      await mode.init();
    }
    return mode;
  }

  update(dt, now) {
    if (!this.currentMode || this.currentMode.disposed) return;
    this.currentMode.update(dt, now);
  }

  dispose() {
    if (this.currentMode) {
      this.currentMode.dispose();
      this.currentMode = null;
    }
    this.registry.clear();
  }
}