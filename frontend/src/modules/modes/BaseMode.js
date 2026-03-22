export class BaseMode {
  constructor({
    id,
    scene,
    engine = null,
    havokPlugin = null,
    networkClient = null,
    hud = null,
    debugBus = null,
    options = {},
  } = {}) {
    this.id = id || 'base-mode';
    this.scene = scene || null;
    this.engine = engine || null;
    this.havokPlugin = havokPlugin || null;
    this.networkClient = networkClient || null;
    this.hud = hud || null;
    this.debugBus = debugBus || null;
    this.options = options;
    this.initialized = false;
    this.disposed = false;
    this.startedAt = 0;
  }

  async init() {
    this.startedAt = Date.now();
    this.initialized = true;
  }

  update(_dt, _now) {}

  dispose() {
    this.disposed = true;
    this.initialized = false;
  }

  publishDebug(partial = {}) {
    if (!this.debugBus || typeof this.debugBus !== 'object') return;
    Object.assign(this.debugBus, partial);
  }

  getDebugSnapshot() {
    return {
      id: this.id,
      initialized: this.initialized,
      disposed: this.disposed,
      startedAt: this.startedAt,
    };
  }
}