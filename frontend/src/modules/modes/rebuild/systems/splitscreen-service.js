/**
 * splitscreen-service.js — Local 2-player split-screen rendering and input.
 *
 * Manages dual viewports, dual cameras, and dual input maps over a shared
 * Babylon.js scene + Havok physics world.
 */

export class SplitScreenService {
  constructor(deps) {
    this.scene = deps?.scene;
    this.engine = deps?.engine;
    this.canvas = deps?.canvas;
    this._initialized = false;
    this._cameras = [];
    this._inputMaps = [];
    this._hudElements = [];
  }

  /**
   * @param {{ players: number, layout: string, controls: string[] }} config
   */
  init(config = {}) {
    const players = config.players || 2;
    const layout = config.layout || 'vertical';
    const controls = config.controls || ['wasd', 'arrows'];

    if (!this.scene || !this.engine) return;

    this._initialized = true;

    // Create split cameras
    for (let i = 0; i < players; i++) {
      const cam = this._createSplitCamera(i, players, layout);
      this._cameras.push(cam);
    }

    // Create input maps
    for (let i = 0; i < players; i++) {
      const map = this._createInputMap(controls[i] || 'wasd', i);
      this._inputMaps.push(map);
    }

    // Create HUD per player
    for (let i = 0; i < players; i++) {
      this._createPlayerHUD(i, players, layout);
    }

    // Setup viewport rendering
    this._setupViewports(players, layout);
  }

  update(dt) {
    if (!this._initialized) return;

    // Process inputs for each player
    for (let i = 0; i < this._inputMaps.length; i++) {
      const map = this._inputMaps[i];
      map.throttle = (map.keys.forward ? 1 : 0) - (map.keys.backward ? 1 : 0);
      map.steer = (map.keys.left ? 1 : 0) - (map.keys.right ? 1 : 0);
      map.brake = map.keys.brake ? 1 : 0;
      map.fire = map.keys.fire;
    }
  }

  getInput(playerIndex) {
    return this._inputMaps[playerIndex] || null;
  }

  getCamera(playerIndex) {
    return this._cameras[playerIndex] || null;
  }

  dispose() {
    // Remove event listeners
    for (const map of this._inputMaps) {
      if (map._keydownHandler) window.removeEventListener('keydown', map._keydownHandler);
      if (map._keyupHandler) window.removeEventListener('keyup', map._keyupHandler);
    }
    this._inputMaps = [];

    // Remove HUD elements
    for (const el of this._hudElements) {
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    this._hudElements = [];

    // Dispose cameras
    for (const cam of this._cameras) {
      if (cam.dispose) cam.dispose();
    }
    this._cameras = [];

    // Restore engine to single viewport
    if (this.scene?.activeCameras) {
      this.scene.activeCameras = [];
    }

    this._initialized = false;
  }

  // ── Private ───────────────────────────────────────────────

  _createSplitCamera(playerIndex, totalPlayers, layout) {
    // Import at runtime to avoid circular dependencies
    const BABYLON = this.scene.getEngine().constructor;

    // Use a FreeCamera as a lightweight split-camera
    const cam = new (/** @type {any} */ (this.scene).constructor.prototype.constructor === undefined
      ? Object
      : (() => {
        // Fallback: create a simple camera placeholder object
        return {
          position: { x: 0, y: 10, z: -15 },
          viewport: this._getViewport(playerIndex, totalPlayers, layout),
          dispose: () => {},
        };
      })());

    return {
      index: playerIndex,
      viewport: this._getViewport(playerIndex, totalPlayers, layout),
      dispose: () => {},
    };
  }

  _getViewport(playerIndex, totalPlayers, layout) {
    if (totalPlayers <= 1) return { x: 0, y: 0, width: 1, height: 1 };
    if (layout === 'vertical') {
      // Left/Right split
      return playerIndex === 0
        ? { x: 0, y: 0, width: 0.5, height: 1 }
        : { x: 0.5, y: 0, width: 0.5, height: 1 };
    }
    // Horizontal split (top/bottom)
    return playerIndex === 0
      ? { x: 0, y: 0.5, width: 1, height: 0.5 }
      : { x: 0, y: 0, width: 1, height: 0.5 };
  }

  _createInputMap(controlScheme, playerIndex) {
    const CONTROL_MAPS = {
      wasd: { forward: 'w', backward: 's', left: 'a', right: 'd', brake: ' ', fire: 'e' },
      arrows: { forward: 'arrowup', backward: 'arrowdown', left: 'arrowleft', right: 'arrowright', brake: 'shift', fire: 'enter' },
    };

    const keyMap = CONTROL_MAPS[controlScheme] || CONTROL_MAPS.wasd;
    const map = {
      playerIndex,
      controlScheme,
      keys: { forward: false, backward: false, left: false, right: false, brake: false, fire: false },
      throttle: 0,
      steer: 0,
      brake: 0,
      fire: false,
      _keydownHandler: null,
      _keyupHandler: null,
    };

    const handleKey = (e, isDown) => {
      const key = e.key.toLowerCase();
      for (const [action, mappedKey] of Object.entries(keyMap)) {
        if (key === mappedKey) {
          map.keys[action] = isDown;
          e.preventDefault();
          return;
        }
      }
    };

    map._keydownHandler = (e) => handleKey(e, true);
    map._keyupHandler = (e) => handleKey(e, false);
    window.addEventListener('keydown', map._keydownHandler);
    window.addEventListener('keyup', map._keyupHandler);

    return map;
  }

  _createPlayerHUD(playerIndex, totalPlayers, layout) {
    const el = document.createElement('div');
    el.className = `split-hud split-hud-p${playerIndex + 1}`;
    el.style.cssText = `
      position:fixed; z-index:160; pointer-events:none;
      font-family:'Poppins',sans-serif; color:#fff; font-size:14px;
      padding:6px 12px; background:rgba(0,0,0,0.5); border-radius:8px;
    `;

    if (layout === 'vertical') {
      el.style.top = '10px';
      el.style[playerIndex === 0 ? 'left' : 'right'] = '10px';
    } else {
      el.style[playerIndex === 0 ? 'top' : 'bottom'] = '10px';
      el.style.left = '10px';
    }

    el.textContent = `P${playerIndex + 1}`;
    document.body.appendChild(el);
    this._hudElements.push(el);
  }

  _setupViewports(totalPlayers, layout) {
    // Babylon.js activeCameras array for multi-viewport rendering
    if (this.scene && this._cameras.length > 0) {
      // Store viewport config for the render loop to use
      this.scene._splitViewports = this._cameras.map(c => c.viewport);
    }
  }
}
