/**
 * Base lifecycle for single-player/local mode modules.
 *
 * Each mode receives dependencies through constructor injection and must
 * implement init/update/destroy. This keeps mode code isolated and testable.
 */
export class ModeBase {
  /**
   * @param {object} deps - Injected dependencies (scene, ui, ai, weapons, etc.)
   */
  constructor(deps = {}) {
    this.deps = deps;
    this.initialized = false;
    this.finished = false;
    this.lastError = null;
  }

  /** @returns {string} Stable mode identifier. */
  get id() {
    return 'base_mode';
  }

  /** @returns {Promise<void>} */
  async init() {
    this.initialized = true;
  }

  /**
   * @param {number} dt - Delta time in seconds.
   * @returns {void}
   */
  update(dt) {
    void dt;
  }

  /** @returns {Promise<void>} */
  async destroy() {
    this.finished = true;
    this.initialized = false;
  }

  /**
   * Wraps a mode operation to ensure robust error handling and fallback path.
   * @template T
   * @param {() => T} fn
   * @param {T} fallback
   * @returns {T}
   */
  guard(fn, fallback) {
    try {
      return fn();
    } catch (error) {
      this.lastError = error;
      if (this.deps?.logger?.error) {
        this.deps.logger.error(`[mode:${this.id}]`, error);
      }
      return fallback;
    }
  }
}
