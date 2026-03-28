/**
 * gamepad-input.js — Web Gamepad API support (21.33)
 *
 * Polls connected gamepads and returns normalized input state.
 * Maps: left stick → steering (analog), right trigger → throttle (analog),
 *        left trigger → brake, A → fire, B → fire backward, X → drift, Start → pause.
 */

const DEAD_ZONE = 0.15;

let _connected = false;
let _gamepadIndex = -1;
let _onConnectionChange = null;
let _listenersAttached = false;
let _handleConnected = null;
let _handleDisconnected = null;

// Standard mapping (Xbox / generic): https://w3c.github.io/gamepad/#remapping
const BUTTONS = {
  A: 0,        // Fire weapon
  B: 1,        // Fire backward
  X: 2,        // Drift / brake
  Y: 3,        // Item use (alt)
  LB: 4,       // N/A
  RB: 5,       // N/A
  LT: 6,       // Brake (analog)
  RT: 7,       // Throttle (analog)
  BACK: 8,     // Scoreboard
  START: 9,    // Pause
  L3: 10,      // N/A
  R3: 11,      // N/A
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
};

/**
 * Initialize gamepad listeners.
 * @param {Function} [onConnectionChange] — Called with (connected: boolean, gamepad: Gamepad|null)
 */
export function initGamepad(onConnectionChange) {
  _onConnectionChange = onConnectionChange;
  if (_listenersAttached) {
    _notifyCurrentGamepad();
    return;
  }

  _handleConnected = (e) => {
    _gamepadIndex = e.gamepad.index;
    _connected = true;
    console.log(`[gamepad] Connected: ${e.gamepad.id}`);
    if (_onConnectionChange) _onConnectionChange(true, e.gamepad);
  };
  _handleDisconnected = (e) => {
    if (e.gamepad.index === _gamepadIndex) {
      _connected = false;
      _gamepadIndex = -1;
      console.log(`[gamepad] Disconnected: ${e.gamepad.id}`);
      if (_onConnectionChange) _onConnectionChange(false, null);
    }
  };

  window.addEventListener('gamepadconnected', _handleConnected);
  window.addEventListener('gamepaddisconnected', _handleDisconnected);
  _listenersAttached = true;
  _notifyCurrentGamepad();
}

export function disposeGamepad() {
  if (_listenersAttached) {
    window.removeEventListener('gamepadconnected', _handleConnected);
    window.removeEventListener('gamepaddisconnected', _handleDisconnected);
  }
  _listenersAttached = false;
  _handleConnected = null;
  _handleDisconnected = null;
  _connected = false;
  _gamepadIndex = -1;
  _onConnectionChange = null;
}

function _notifyCurrentGamepad() {
  const gamepads = typeof navigator?.getGamepads === 'function' ? navigator.getGamepads() : [];
  const existing = Array.from(gamepads || []).find(Boolean) || null;
  if (existing) {
    _gamepadIndex = existing.index;
    _connected = true;
    if (_onConnectionChange) _onConnectionChange(true, existing);
    return;
  }

  _connected = false;
  _gamepadIndex = -1;
  if (_onConnectionChange) _onConnectionChange(false, null);
}

function applyDeadZone(value) {
  return Math.abs(value) < DEAD_ZONE ? 0 : value;
}

function buttonPressed(gp, idx) {
  const btn = gp.buttons[idx];
  return btn ? (typeof btn === 'object' ? btn.pressed : btn > 0.5) : false;
}

function buttonValue(gp, idx) {
  const btn = gp.buttons[idx];
  if (!btn) return 0;
  return typeof btn === 'object' ? btn.value : btn;
}

/**
 * Poll the current gamepad state.
 * @returns {{ connected: boolean, throttle: number, steer: number, brake: boolean, fire: boolean, drift: boolean, pause: boolean, scoreboard: boolean }}
 */
export function pollGamepad() {
  const result = {
    connected: false,
    throttle: 0,
    steer: 0,
    brake: false,
    fire: false,
    fireSecondary: false,
    drift: false,
    pause: false,
    scoreboard: false,
  };

  if (!_connected) return result;

  const gamepads = navigator.getGamepads();
  const gp = gamepads[_gamepadIndex];
  if (!gp) return result;

  result.connected = true;

  // Left stick X → steering (-1 = left, +1 = right)
  result.steer = -applyDeadZone(gp.axes[0] || 0); // negate: left stick left = steer left = +1

  // Right trigger → throttle (0–1), left trigger → brake
  const rt = buttonValue(gp, BUTTONS.RT);
  const lt = buttonValue(gp, BUTTONS.LT);
  result.throttle = rt > DEAD_ZONE ? rt : 0;
  if (lt > DEAD_ZONE) result.brake = true;

  // D-pad fallback for steering/throttle
  if (buttonPressed(gp, BUTTONS.DPAD_UP)) result.throttle = 1;
  if (buttonPressed(gp, BUTTONS.DPAD_DOWN)) result.throttle = -1;
  if (buttonPressed(gp, BUTTONS.DPAD_LEFT)) result.steer = 1;
  if (buttonPressed(gp, BUTTONS.DPAD_RIGHT)) result.steer = -1;

  // Left stick Y as throttle fallback (push up = forward)
  const lsY = applyDeadZone(gp.axes[1] || 0);
  if (result.throttle === 0 && lsY !== 0) result.throttle = -lsY; // negate: up = forward

  // Buttons — A = primary fire (glo_burst), B = secondary fire (pickup)
  result.fire = buttonPressed(gp, BUTTONS.A);
  result.fireSecondary = buttonPressed(gp, BUTTONS.B);
  result.drift = buttonPressed(gp, BUTTONS.X) || result.brake;
  result.pause = buttonPressed(gp, BUTTONS.START);
  result.scoreboard = buttonPressed(gp, BUTTONS.BACK);

  return result;
}

/** Returns true if any gamepad is currently connected. */
export function isGamepadConnected() {
  return _connected;
}
