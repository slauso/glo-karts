/**
 * pause-menu.js — In-game pause menu with Escape key handler.
 *
 * Features:
 *  - Escape key toggles pause
 *  - Freezes game loop (physics & render)
 *  - Overlay with Resume, Restart Race, Settings (volume), Controls, Quit to Lobby
 *  - Blocks game input while paused
 *  - Works for both race and battle modes
 */

import { showControlsOverlay } from './input-config.js';

let _overlay = null;
let _paused  = false;
let _onResume   = null;
let _onRestart  = null;
let _onQuit     = null;
let _keyHandler = null;

/** Audio volume settings (persisted to localStorage) */
let _musicVolume = parseFloat(localStorage.getItem('tk_musicVol') ?? '0.7');
let _sfxVolume   = parseFloat(localStorage.getItem('tk_sfxVol') ?? '0.8');

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Initialize the pause menu system. Call once at game startup.
 *
 * @param {object} opts
 * @param {Function} opts.onResume   Called when player resumes
 * @param {Function} opts.onRestart  Called when player clicks Restart
 * @param {Function} opts.onQuit     Called when player clicks Quit to Lobby
 */
export function initPauseMenu({ onResume, onRestart, onQuit }) {
  _onResume  = onResume  || (() => {});
  _onRestart = onRestart || (() => {});
  _onQuit    = onQuit    || (() => {});

  _buildOverlay();

  // Escape key handler
  if (_keyHandler) document.removeEventListener('keydown', _keyHandler);
  _keyHandler = (e) => {
    if (e.code === 'Escape') {
      e.preventDefault();
      if (_paused) resume(); else pause();
    }
  };
  document.addEventListener('keydown', _keyHandler);
}

export function pause() {
  if (_paused) return;
  _paused = true;
  if (_overlay) _overlay.style.display = 'flex';
}

export function resume() {
  if (!_paused) return;
  _paused = false;
  if (_overlay) _overlay.style.display = 'none';
  if (_onResume) _onResume();
}

export function isPaused() {
  return _paused;
}

export function getMusicVolume() { return _musicVolume; }
export function getSfxVolume()   { return _sfxVolume; }

export function disposePauseMenu() {
  if (_keyHandler) {
    document.removeEventListener('keydown', _keyHandler);
    _keyHandler = null;
  }
  if (_overlay && _overlay.parentNode) _overlay.parentNode.removeChild(_overlay);
  _overlay = null;
  _paused  = false;
}

// ── Build DOM ───────────────────────────────────────────────────────────────

function _buildOverlay() {
  if (_overlay) _overlay.remove();

  _overlay = document.createElement('div');
  _overlay.id = 'pause-overlay';
  _overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.75); z-index: 5000;
    display: none; flex-direction: column; align-items: center; justify-content: center;
    font-family: 'Poppins', sans-serif; color: #fff;
    backdrop-filter: blur(6px);
  `;

  // Title
  const title = document.createElement('div');
  title.textContent = 'PAUSED';
  title.style.cssText = `
    font-size: 3rem; font-weight: 900; letter-spacing: 6px;
    text-shadow: 0 0 30px rgba(255,204,0,0.5), 0 4px 0 #665500;
    margin-bottom: 40px;
  `;
  _overlay.appendChild(title);

  // Buttons
  const btnStyle = `
    display: block; width: 240px; padding: 14px 0; margin: 8px 0;
    font-family: 'Poppins', sans-serif; font-size: 1.1rem; font-weight: 700;
    border: 2px solid rgba(255,255,255,0.3); border-radius: 10px;
    background: rgba(255,255,255,0.08); color: #fff; cursor: pointer;
    text-align: center; transition: background 0.2s, transform 0.15s;
    letter-spacing: 1px;
  `;
  const hoverIn  = (e) => { e.target.style.background = 'rgba(255,255,255,0.2)'; e.target.style.transform = 'scale(1.04)'; };
  const hoverOut = (e) => { e.target.style.background = 'rgba(255,255,255,0.08)'; e.target.style.transform = 'scale(1)'; };

  const resumeBtn = _btn('▶  RESUME', btnStyle, hoverIn, hoverOut, () => resume());
  const restartBtn = _btn('🔄  RESTART', btnStyle, hoverIn, hoverOut, () => {
    resume();
    if (_onRestart) _onRestart();
  });

  // ── Settings section (volume sliders) ──
  const settingsBox = document.createElement('div');
  settingsBox.style.cssText = `
    width: 240px; margin: 16px 0; padding: 14px 18px;
    background: rgba(255,255,255,0.06); border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.15);
  `;

  settingsBox.appendChild(_slider('Music', _musicVolume, (v) => {
    _musicVolume = v;
    localStorage.setItem('tk_musicVol', String(v));
  }));
  settingsBox.appendChild(_slider('SFX', _sfxVolume, (v) => {
    _sfxVolume = v;
    localStorage.setItem('tk_sfxVol', String(v));
  }));

  const quitBtn = _btn('🚪  QUIT TO LOBBY', btnStyle, hoverIn, hoverOut, () => {
    resume();
    if (_onQuit) _onQuit();
  });
  quitBtn.style.marginTop = '24px';
  quitBtn.style.borderColor = 'rgba(255,80,80,0.5)';

  const controlsBtn = _btn('🎮  CONTROLS', btnStyle, hoverIn, hoverOut, () => showControlsOverlay());

  _overlay.appendChild(resumeBtn);
  _overlay.appendChild(restartBtn);
  _overlay.appendChild(settingsBox);
  _overlay.appendChild(controlsBtn);
  _overlay.appendChild(quitBtn);

  document.body.appendChild(_overlay);
}

function _btn(text, style, hoverIn, hoverOut, onClick) {
  const b = document.createElement('button');
  b.textContent = text;
  b.style.cssText = style;
  b.addEventListener('mouseenter', hoverIn);
  b.addEventListener('mouseleave', hoverOut);
  b.addEventListener('click', onClick);
  return b;
}

function _slider(label, initial, onChange) {
  const row = document.createElement('div');
  row.style.cssText = 'margin-bottom: 10px;';

  const lbl = document.createElement('div');
  lbl.style.cssText = 'font-size: 0.8rem; font-weight: 600; margin-bottom: 4px; color: #ccc;';
  lbl.textContent = label;
  row.appendChild(lbl);

  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '1';
  input.step = '0.05';
  input.value = String(initial);
  input.style.cssText = 'width: 100%; accent-color: #ffcc00; cursor: pointer;';
  input.addEventListener('input', () => {
    onChange(parseFloat(input.value));
  });
  row.appendChild(input);

  return row;
}
