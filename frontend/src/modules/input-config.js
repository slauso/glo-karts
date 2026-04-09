/**
 * input-config.js — Control mapping display & basic rebinding (21.34)
 *
 * Shows an overlay with keyboard + gamepad mappings.
 * Keyboard bindings are rebindable and persisted to localStorage.
 */

import { isGamepadConnected } from './gamepad-input.js';

const LS_KEY = 'tk_keyBindings';

// Default keyboard bindings: action → keyCode
const DEFAULT_BINDINGS = {
  throttle:  'KeyW',
  reverse:   'KeyS',
  steerLeft: 'KeyA',
  steerRight:'KeyD',
  brake:     'ShiftLeft',
  firePrimary: 'Space',
  fireSecondary: 'KeyE',
  swapSecondary: 'KeyR',
  drift:     'KeyQ',
  scoreboard:'Tab',
  cameraView:'KeyC',
};

// Labels for display
const ACTION_LABELS = {
  throttle:  'Throttle',
  reverse:   'Reverse',
  steerLeft: 'Left',
  steerRight:'Right',
  brake:     'Brake',
  firePrimary: 'Primary',
  fireSecondary: 'Pickup',
  swapSecondary: 'Swap',
  drift:     'Drift',
  scoreboard:'Board',
  cameraView:'Cam',
};

// Gamepad labels (fixed — not rebindable)
const GAMEPAD_LABELS = {
  throttle:  'RT / Left Stick Up',
  reverse:   'Left Stick Down',
  steerLeft: 'Left Stick Left',
  steerRight:'Left Stick Right',
  brake:     'LT / X',
  firePrimary: 'A',
  fireSecondary: 'B',
  swapSecondary: 'Y',
  drift:     'X',
  scoreboard:'Back',
  pause:     'Start',
};

let _bindings = null;
let _overlay = null;
let _rebindAction = null;
let _rebindHandler = null;

// ── Public API ──────────────────────────────────────────────────────

/** Load bindings from localStorage (or defaults). */
export function loadBindings() {
  if (_bindings) return _bindings;
  try {
    const stored = localStorage.getItem(LS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge with defaults so new actions always exist
      _bindings = { ...DEFAULT_BINDINGS, ...parsed };
    } else {
      _bindings = { ...DEFAULT_BINDINGS };
    }
  } catch {
    _bindings = { ...DEFAULT_BINDINGS };
  }
  return _bindings;
}

/** Get current key bindings (loads if needed). */
export function getBindings() {
  return _bindings || loadBindings();
}

/** Reset to defaults. */
export function resetBindings() {
  _bindings = { ...DEFAULT_BINDINGS };
  localStorage.setItem(LS_KEY, JSON.stringify(_bindings));
  if (_overlay) _refreshOverlay();
}

/** Show the controls overlay. */
export function showControlsOverlay() {
  loadBindings();
  if (!_overlay) _buildOverlay();
  _overlay.style.display = 'flex';
}

/** Hide the controls overlay. */
export function hideControlsOverlay() {
  if (_overlay) _overlay.style.display = 'none';
  _cancelRebind();
}

/** Dispose the controls overlay entirely. */
export function disposeControlsOverlay() {
  _cancelRebind();
  if (_overlay && _overlay.parentNode) _overlay.parentNode.removeChild(_overlay);
  _overlay = null;
}

// ── Key name prettifier ─────────────────────────────────────────────

function _prettyKey(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'Space') return 'Space';
  if (code === 'ShiftLeft' || code === 'ShiftRight') return 'Shift';
  if (code === 'ControlLeft' || code === 'ControlRight') return 'Ctrl';
  if (code === 'AltLeft' || code === 'AltRight') return 'Alt';
  if (code.startsWith('Arrow')) return '↑↓←→'['UpDownLeftRight'.indexOf(code.slice(5)) >= 0 ? 'UpDownLeftRight'.indexOf(code.slice(5)) / (code.slice(5).length) : 0] || code.slice(5);
  return code.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function _prettyKeyClean(code) {
  if (!code) return '—';
  const map = {
    'ArrowUp': '↑', 'ArrowDown': '↓', 'ArrowLeft': '←', 'ArrowRight': '→',
    'Space': 'Space', 'Tab': 'Tab', 'Enter': 'Enter', 'Escape': 'Esc',
    'ShiftLeft': 'L-Shift', 'ShiftRight': 'R-Shift',
    'ControlLeft': 'L-Ctrl', 'ControlRight': 'R-Ctrl',
  };
  if (map[code]) return map[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

// ── DOM Construction ────────────────────────────────────────────────

function _buildOverlay() {
  _overlay = document.createElement('div');
  _overlay.id = 'controls-overlay';
  _overlay.style.cssText = `
    position:fixed; inset:0; z-index:5100;
    display:none; flex-direction:column; align-items:center; justify-content:center;
    background:radial-gradient(circle at 50% 72%, rgba(8,12,24,0.12), rgba(2,4,10,0.28));
    backdrop-filter:blur(4px);
    font-family:'Poppins',sans-serif; color:#fff;
    padding:16px;
  `;
  _refreshOverlay();
  document.body.appendChild(_overlay);
}

function _refreshOverlay() {
  _overlay.innerHTML = '';

  const card = document.createElement('div');
  card.style.cssText = `
    width:min(420px, calc(100vw - 24px));
    max-height:min(72vh, 560px);
    overflow:auto;
    border-radius:22px;
    border:1px solid rgba(255,255,255,0.12);
    background:
      linear-gradient(180deg, rgba(255,255,255,0.09), rgba(255,255,255,0.02)),
      rgba(10,14,24,0.68);
    box-shadow:
      0 20px 48px rgba(0,0,0,0.3),
      inset 0 1px 0 rgba(255,255,255,0.1);
    backdrop-filter:blur(16px) saturate(132%);
    -webkit-backdrop-filter:blur(16px) saturate(132%);
    padding:16px 16px 14px;
  `;
  _overlay.appendChild(card);

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;flex-direction:column;align-items:flex-start;gap:6px;margin-bottom:12px;text-align:left;';

  const eyebrow = document.createElement('div');
  eyebrow.textContent = 'CONTROLS';
  eyebrow.style.cssText = 'padding:4px 9px;border-radius:999px;border:1px solid rgba(255,255,255,0.11);background:rgba(255,255,255,0.045);color:rgba(220,235,255,0.68);font-size:0.64rem;font-weight:700;letter-spacing:1.9px;text-transform:uppercase;';
  header.appendChild(eyebrow);

  const title = document.createElement('div');
  title.textContent = 'Drive / Fire';
  title.style.cssText = 'font-size:1.16rem;font-weight:800;letter-spacing:0.24px;color:#f6fbff;text-shadow:0 0 18px rgba(110,190,255,0.14);';
  header.appendChild(title);

  const subtitle = document.createElement('div');
  subtitle.textContent = 'Quick bind reference.';
  subtitle.style.cssText = 'max-width:320px;font-size:0.75rem;line-height:1.35;color:rgba(255,255,255,0.48);';
  header.appendChild(subtitle);

  card.appendChild(header);

  // Container for keyboard + gamepad columns
  const cols = document.createElement('div');
  cols.style.cssText = 'display:grid;grid-template-columns:1fr;gap:10px;width:100%;';

  // Keyboard column
  const kbCol = _buildColumn('KEYBOARD', true);
  cols.appendChild(kbCol);

  // Gamepad column
  if (isGamepadConnected()) {
    const gpCol = _buildColumn('GAMEPAD', false);
    cols.appendChild(gpCol);
  }

  card.appendChild(cols);

  // Hint
  const hint = document.createElement('div');
  hint.textContent = 'Click to remap. Esc closes.';
  hint.style.cssText = 'margin-top:10px;font-size:0.72rem;color:rgba(255,255,255,0.42);letter-spacing:0.14px;';
  card.appendChild(hint);

  // Buttons row
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex; gap:8px; margin-top:10px;';

  const resetBtn = document.createElement('button');
  resetBtn.textContent = 'Reset';
  resetBtn.style.cssText = _btnStyle();
  resetBtn.addEventListener('click', () => resetBindings());

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.style.cssText = _btnStyle();
  closeBtn.addEventListener('click', () => hideControlsOverlay());

  btnRow.appendChild(resetBtn);
  btnRow.appendChild(closeBtn);
  card.appendChild(btnRow);

  // Escape to close
  if (!_overlay._escHandler) {
    _overlay._escHandler = (e) => {
      if (e.code === 'Escape' && _overlay.style.display !== 'none') {
        e.preventDefault();
        e.stopPropagation();
        hideControlsOverlay();
      }
    };
    document.addEventListener('keydown', _overlay._escHandler, true);
  }
}

function _btnStyle() {
  return `padding:8px 14px;border-radius:999px;border:1px solid rgba(255,255,255,0.16);
    background:rgba(255,255,255,0.06);color:#eef6ff;font-family:'Poppins',sans-serif;
    font-size:0.76rem;font-weight:600;cursor:pointer;transition:background 0.2s,border-color 0.2s;`;
}

function _buildColumn(heading, isRebindable) {
  const col = document.createElement('div');
  col.style.cssText = 'background:rgba(255,255,255,0.032); border-radius:16px; padding:12px 12px 8px; border:1px solid rgba(255,255,255,0.075);';

  const h = document.createElement('div');
  h.textContent = heading;
  h.style.cssText = 'font-size:0.68rem;font-weight:700;letter-spacing:1.7px;color:rgba(212,230,255,0.64);margin-bottom:8px;text-align:left;';
  col.appendChild(h);

  const actions = Object.keys(ACTION_LABELS);
  for (const action of actions) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.045);';

    const label = document.createElement('span');
    label.textContent = ACTION_LABELS[action];
    label.style.cssText = 'font-size:0.76rem;color:rgba(240,245,255,0.76);';
    row.appendChild(label);

    if (isRebindable) {
      const keyBtn = document.createElement('button');
      keyBtn.textContent = _prettyKeyClean(_bindings[action]);
      keyBtn.dataset.action = action;
      keyBtn.style.cssText = `
        padding:4px 11px;border-radius:999px;border:1px solid rgba(255,255,255,0.15);
        background:rgba(255,255,255,0.075);color:#f8fbff;font-family:'Exo 2',monospace;font-size:0.76rem;
        cursor:pointer;min-width:58px;text-align:center;transition:all 0.2s;
      `;
      keyBtn.addEventListener('click', () => _startRebind(action, keyBtn));
      row.appendChild(keyBtn);
    } else {
      const gpLabel = document.createElement('span');
      gpLabel.textContent = GAMEPAD_LABELS[action] || '—';
      gpLabel.style.cssText = 'font-size:0.76rem;color:rgba(220,228,240,0.62);font-family:\'Exo 2\',monospace;';
      row.appendChild(gpLabel);
    }

    col.appendChild(row);
  }

  // If gamepad column, add the pause mapping
  if (!isRebindable) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:10px;padding:6px 0;';
    const label = document.createElement('span');
    label.textContent = 'Pause';
    label.style.cssText = 'font-size:0.76rem;color:rgba(240,245,255,0.76);';
    row.appendChild(label);
    const gpLabel = document.createElement('span');
    gpLabel.textContent = GAMEPAD_LABELS.pause;
    gpLabel.style.cssText = 'font-size:0.76rem;color:rgba(220,228,240,0.62);font-family:\'Exo 2\',monospace;';
    row.appendChild(gpLabel);
    col.appendChild(row);
  }

  return col;
}

// ── Rebinding ───────────────────────────────────────────────────────

function _startRebind(action, btnEl) {
  _cancelRebind();
  _rebindAction = action;
  btnEl.textContent = '...';
  btnEl.style.borderColor = '#ffcc00';
  btnEl.style.background = 'rgba(255,204,0,0.15)';

  _rebindHandler = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape') {
      // Cancel rebind
      _cancelRebind();
      _refreshOverlay();
      return;
    }
    // Assign new key
    _bindings[_rebindAction] = e.code;
    localStorage.setItem(LS_KEY, JSON.stringify(_bindings));
    _cancelRebind();
    _refreshOverlay();
  };
  document.addEventListener('keydown', _rebindHandler, true);
}

function _cancelRebind() {
  if (_rebindHandler) {
    document.removeEventListener('keydown', _rebindHandler, true);
    _rebindHandler = null;
  }
  _rebindAction = null;
}
