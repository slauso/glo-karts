/**
 * battle-hud.js — Battle-mode HUD overlays.
 *
 * Elements:
 *  - Health bar (player)
 *  - Lives / balloon indicator (three-strikes)
 *  - Score display (kills / goals)
 *  - Kill feed (scrolling murder log)
 *  - Match timer countdown
 *  - Lock-on reticle
 *  - Loading screen with progress
 *  - Mode label + arena name
 */

// ── Health Bar ──────────────────────────────────────────────────────────────

let _healthBar = null;
let _healthFill = null;
let _healthText = null;

export function createHealthBar() {
  if (_healthBar) return;
  _healthBar = document.createElement('div');
  _healthBar.id = 'battle-health-bar';
  _healthBar.style.cssText = `
    position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%);
    width: 260px; height: 24px;
    background: rgba(0,0,0,0.7); border-radius: 12px;
    border: 2px solid rgba(255,255,255,0.3);
    z-index: 100; pointer-events: none; overflow: hidden;
  `;

  _healthFill = document.createElement('div');
  _healthFill.style.cssText = `
    position: absolute; top: 0; left: 0; height: 100%; width: 100%;
    background: linear-gradient(to right, #22ff44, #88ff44);
    border-radius: 10px;
    transition: width 0.2s ease, background 0.3s;
  `;
  _healthBar.appendChild(_healthFill);

  _healthText = document.createElement('div');
  _healthText.style.cssText = `
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    font-family: 'Poppins', sans-serif; font-size: 12px; font-weight: 700;
    color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,0.8);
  `;
  _healthText.textContent = '100';
  _healthBar.appendChild(_healthText);

  document.body.appendChild(_healthBar);
}

// Throttle health bar DOM writes to ~30fps (33ms) to reduce layout thrashing
let _healthLastUpdateMs = 0;
const HEALTH_UPDATE_INTERVAL_MS = 33;

export function updateHealthBar(health, maxHealth = 100) {
  if (!_healthBar) return;
  // Always process damage flash immediately; throttle cosmetic updates
  const now = performance.now();
  const isDamage = health < (_healthBar._prevHP ?? maxHealth);
  if (!isDamage && now - _healthLastUpdateMs < HEALTH_UPDATE_INTERVAL_MS) return;
  _healthLastUpdateMs = now;

  const pct = Math.max(0, Math.min(100, (health / maxHealth) * 100));
  _healthFill.style.width = pct + '%';
  _healthText.textContent = `${Math.ceil(health)}/${maxHealth}`;

  if (pct > 60) {
    _healthFill.style.background = 'linear-gradient(to right, #22ff44, #88ff44)';
  } else if (pct > 30) {
    _healthFill.style.background = 'linear-gradient(to right, #ffcc00, #ff8800)';
  } else {
    _healthFill.style.background = 'linear-gradient(to right, #ff4444, #ff0000)';
  }

  // Flash red on damage
  if (isDamage) {
    _healthBar.style.boxShadow = '0 0 12px 4px rgba(255,0,0,0.7)';
    clearTimeout(_healthBar._flashTimer);
    _healthBar._flashTimer = setTimeout(() => { _healthBar.style.boxShadow = 'none'; }, 300);
  }
  _healthBar._prevHP = health;
}

// ── Lives / Balloon Indicator ───────────────────────────────────────────────

let _livesEl = null;

function _safeHudHex(value, fallback) {
  return typeof value === 'string' && /^#?[0-9a-fA-F]{6}$/.test(value)
    ? (value.startsWith('#') ? value : `#${value}`)
    : fallback;
}

function _getHudGloPalette() {
  return {
    primary: _safeHudHex(sessionStorage.getItem('gloColor'), '#ff0080'),
    secondary: _safeHudHex(sessionStorage.getItem('gloColor2'), '#00e5ff'),
  };
}

export function createLivesIndicator(maxLives = 3) {
  if (_livesEl) _livesEl.remove();
  const palette = _getHudGloPalette();
  _livesEl = document.createElement('div');
  _livesEl.id = 'battle-lives';
  _livesEl.style.cssText = `
    position: fixed; bottom: 62px; left: 50%; transform: translateX(-50%);
    display: flex; gap: 10px; align-items: center;
    z-index: 100; pointer-events: none;
  `;
  for (let i = 0; i < maxLives; i++) {
    const b = document.createElement('span');
    b.className = 'life-marble';
    const glow = i === 1 ? palette.secondary : palette.primary;
    b.style.cssText = `
      width: 18px; height: 18px; border-radius: 50%;
      display: inline-block;
      border: 1px solid rgba(255,255,255,0.72);
      background:
        radial-gradient(circle at 32% 30%, rgba(255,255,255,0.96) 0%, rgba(255,255,255,0.34) 20%, transparent 36%),
        radial-gradient(circle at 50% 44%, ${glow} 0%, ${glow}dd 36%, rgba(8,10,20,0.08) 76%, rgba(8,10,20,0) 100%);
      box-shadow:
        0 0 0 1px rgba(255,255,255,0.14) inset,
        0 0 8px ${glow}cc,
        0 0 18px ${glow}88;
      transition: opacity 0.3s, transform 0.3s, filter 0.3s;
    `;
    b.dataset.glow = glow;
    _livesEl.appendChild(b);
  }
  document.body.appendChild(_livesEl);
}

export function updateLivesIndicator(currentLives) {
  if (!_livesEl) return;
  const marbles = _livesEl.querySelectorAll('.life-marble');
  marbles.forEach((b, i) => {
    const glow = b.dataset.glow || '#ffffff';
    if (i < currentLives) {
      b.style.opacity = '1';
      b.style.transform = 'scale(1)';
      b.style.filter = 'saturate(1.1)';
      b.style.boxShadow = `0 0 0 1px rgba(255,255,255,0.14) inset, 0 0 8px ${glow}cc, 0 0 18px ${glow}88`;
    } else {
      b.style.opacity = '0.22';
      b.style.transform = 'scale(0.6)';
      b.style.filter = 'grayscale(0.15) saturate(0.45)';
      b.style.boxShadow = '0 0 0 1px rgba(255,255,255,0.08) inset, 0 0 4px rgba(255,255,255,0.08)';
    }
  });
}

// ── Score Display ───────────────────────────────────────────────────────────

let _scoreEl = null;

export function createScoreDisplay() {
  if (_scoreEl?.parentNode) _scoreEl.parentNode.removeChild(_scoreEl);
  _scoreEl = null;
}

export function updateScoreDisplay(kills, label = 'Kills') {
  return;
}

// ── Kill Feed ───────────────────────────────────────────────────────────────

let _killFeed = null;

const WEAPON_ICONS = {
  bowling_ball: '🎳', cake: '🎂', plunger: '🪠', missile: '🚀',
  banana: '🍌', bubblegum: '🫧', swatter: '🪰',
  shield: '🛡️', ludicrous_mode: '🔋', pirateleportation: '🏴‍☠️', mirror_realm: '🪞', phase_shift: '👻',
  weather_dominion: '⛈️',
  fireball: '🔥', toxic_spread: '☣️', ice_lance: '🧊', tornado: '🌪️',
  super_nova: '☢️', rock_barrage: '🪨', lightning_bolt: '⚡', wind_slash: '💨', toxic_cloud: '🧪',
  shockwave_cannon: '💥', thunderstrike: '⚡', black_hole: '🕳️',
  meteor_swarm: '☄️', frost_nova: '❄️', emp_pulse: '📡',
  gravity_flip: '🔄', inferno_trail: '🔥', plasma_railgun: '🔫',
  vortex_tornado: '🌪️',
  glow_thrower: '🔥', glo_burst: '💫',
};

export function createKillFeed() {
  if (_killFeed) return;
  _killFeed = document.createElement('div');
  _killFeed.id = 'kill-feed';
  _killFeed.style.cssText = `
    position: fixed; top: 102px; left: 24px;
    display: flex; flex-direction: column; gap: 4px;
    z-index: 100; pointer-events: none;
    font-family: 'Poppins', sans-serif; font-size: 0.78rem; font-weight: 600;
  `;
  document.body.appendChild(_killFeed);
}

/**
 * Push a kill event to the feed.
 * @param {string} killerName
 * @param {string} victimName
 * @param {string} weaponId
 */
export function pushKillFeedEntry(killerName, victimName, weaponId) {
  if (!_killFeed) createKillFeed();
  const icon = WEAPON_ICONS[weaponId] || '💀';
  const entry = document.createElement('div');
  entry.style.cssText = `
    background: linear-gradient(135deg, rgba(16,22,34,0.8), rgba(10,12,18,0.7)); color: #fff; padding: 7px 12px;
    border-radius: 999px; opacity: 1; transition: opacity 0.5s, transform 0.25s;
    border: 1px solid rgba(228,236,255,0.12);
    box-shadow: 0 10px 24px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.08);
    white-space: nowrap;
    backdrop-filter: blur(10px);
  `;
  entry.innerHTML = `<span style="color:#ff6666">${_esc(killerName)}</span> ${icon} <span style="color:#88ccff">${_esc(victimName)}</span>`;
  _killFeed.appendChild(entry);

  // Auto-remove after 5s
  setTimeout(() => {
    entry.style.opacity = '0';
    setTimeout(() => entry.remove(), 500);
  }, 5000);

  // Cap at 5 visible entries
  while (_killFeed.children.length > 5) {
    _killFeed.removeChild(_killFeed.firstChild);
  }
}

function _esc(s) {
  const d = document.createElement('span');
  d.textContent = s || '?';
  return d.innerHTML;
}

// ── Match Timer ─────────────────────────────────────────────────────────────

let _matchTimer = null;

export function createMatchTimer() {
  if (_matchTimer) return;
  _matchTimer = document.createElement('div');
  _matchTimer.id = 'match-timer';
  _matchTimer.style.cssText = `
    position: fixed; top: 98px; left: 50%; transform: translateX(-50%);
    min-width: 92px; padding: 7px 14px; border-radius: 999px;
    background: linear-gradient(135deg, rgba(18,24,36,0.78), rgba(8,10,16,0.72));
    border: 1px solid rgba(228,236,255,0.14);
    box-shadow: 0 12px 28px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.09);
    backdrop-filter: blur(10px);
    font-family: 'Poppins', sans-serif; font-size: 1rem; font-weight: 800;
    color: #eef4ff; letter-spacing: 0.08em; text-align: center;
    z-index: 100; pointer-events: none;
  `;
  _matchTimer.textContent = '3:00';
  document.body.appendChild(_matchTimer);
}

export function updateMatchTimer(formatted) {
  if (!_matchTimer) return;
  _matchTimer.textContent = formatted;
  // Flash red when under 30 seconds
  const parts = formatted.split(':');
  const totalSec = parseInt(parts[0]) * 60 + parseInt(parts[1]);
  if (totalSec <= 30) {
    _matchTimer.style.color = '#ff3333';
    _matchTimer.style.borderColor = 'rgba(255,94,94,0.32)';
  } else {
    _matchTimer.style.color = '#eef4ff';
    _matchTimer.style.borderColor = 'rgba(228,236,255,0.14)';
  }
}

// ── Lock-On Reticle ─────────────────────────────────────────────────────────

let _reticle = null;

export function createLockReticle() {
  if (_reticle) return;
  if (!document.getElementById('lock-reticle-style')) {
    const style = document.createElement('style');
    style.id = 'lock-reticle-style';
    style.textContent = `
      @keyframes lock-reticle-pulse {
        from { filter: brightness(0.96); }
        to { filter: brightness(1.18); }
      }
    `;
    document.head.appendChild(style);
  }
  _reticle = document.createElement('div');
  _reticle.id = 'lock-reticle';
  _reticle.style.cssText = `
    position: fixed; width: 72px; height: 72px;
    border: 2px solid rgba(110,255,170,0.3); border-radius: 50%;
    z-index: 110; pointer-events: none; display: none;
    transform: translate(-50%, -50%);
    transition: border-color 0.08s, box-shadow 0.08s, transform 0.08s, opacity 0.08s, width 0.08s, height 0.08s;
    opacity: 0.82;
    background: radial-gradient(circle at 50% 50%, rgba(255,255,255,0.08), rgba(255,255,255,0.02) 40%, rgba(255,255,255,0) 70%);
    backdrop-filter: blur(8px);
  `;
  // Crosshair lines
  const line = (rot) => {
    const l = document.createElement('div');
    l.className = 'lock-reticle-line';
    l.style.cssText = `
      position: absolute; top: 50%; left: 50%;
      width: 18px; height: 2px; background: rgba(190,255,220,0.82);
      transform: translate(-50%,-50%) rotate(${rot}deg);
    `;
    return l;
  };
  _reticle.appendChild(line(0));
  _reticle.appendChild(line(90));
  const core = document.createElement('div');
  core.className = 'lock-reticle-core';
  core.style.cssText = `
    position:absolute; left:50%; top:50%; width:6px; height:6px; border-radius:50%;
    transform:translate(-50%,-50%);
    background:rgba(235,248,255,0.85);
    box-shadow:0 0 10px rgba(235,248,255,0.45);
  `;
  _reticle.appendChild(core);
  document.body.appendChild(_reticle);
}

/**
 * Update lock reticle position and lock state.
 * @param {number|null} screenX  Null to hide
 * @param {number|null} screenY
 * @param {boolean} locked  True = fully locked (red), false = acquiring (yellow)
 * @param {number} [progress=0]  0 -> 1 acquisition progress
 */
export function updateLockReticle(screenX, screenY, locked, progress = 0) {
  if (!_reticle) return;
  if (screenX == null || screenY == null) {
    _reticle.style.display = 'none';
    return;
  }
  _reticle.style.display = 'block';
  _reticle.style.left = screenX + 'px';
  _reticle.style.top  = screenY + 'px';
  const clampedProgress = Math.max(0, Math.min(1, progress || 0));
  const sizePx = locked ? 36 : Math.round(76 - clampedProgress * 34);
  const scale = locked ? 0.88 : (1.2 - clampedProgress * 0.26);
  const ringColor = locked
    ? 'rgba(255,56,32,0.96)'
    : `rgba(${Math.round(105 + clampedProgress * 54)},255,${Math.round(176 - clampedProgress * 70)},0.9)`;
  const glowColor = locked
    ? '0 0 22px rgba(255,70,30,0.74), inset 0 0 18px rgba(255,120,40,0.32)'
    : `0 0 ${Math.round(9 + clampedProgress * 11)}px rgba(110,255,170,${(0.24 + clampedProgress * 0.36).toFixed(2)}), inset 0 0 12px rgba(160,255,210,0.16)`;
  const lineLength = locked ? 8 : Math.round(20 - clampedProgress * 8);
  const lineThickness = locked ? 3 : (clampedProgress > 0.7 ? 3 : 2);
  const coreSize = locked ? 8 : Math.round(4 + clampedProgress * 4);
  const borderWidth = locked ? 3 : (clampedProgress > 0.58 ? 3 : 2);
  _reticle.style.width = `${sizePx}px`;
  _reticle.style.height = `${sizePx}px`;
  _reticle.style.transform = `translate(-50%, -50%) scale(${scale})`;
  _reticle.style.borderColor = ringColor;
  _reticle.style.borderWidth = `${borderWidth}px`;
  _reticle.style.boxShadow = glowColor;
  _reticle.style.opacity = locked ? '1' : String(0.7 + clampedProgress * 0.24);
  for (const child of _reticle.children) {
    if (child.className === 'lock-reticle-line') {
      child.style.background = ringColor;
      child.style.width = `${lineLength}px`;
      child.style.height = `${lineThickness}px`;
    } else if (child.className === 'lock-reticle-core') {
      child.style.background = locked ? 'rgba(255,228,216,0.96)' : 'rgba(235,248,255,0.88)';
      child.style.width = `${coreSize}px`;
      child.style.height = `${coreSize}px`;
      child.style.boxShadow = locked
        ? '0 0 14px rgba(255,128,72,0.62)'
        : `0 0 ${Math.round(7 + clampedProgress * 4)}px rgba(235,248,255,0.42)`;
    }
  }
  if (locked) {
    _reticle.style.animation = 'lock-reticle-pulse 0.28s ease-in-out infinite alternate';
  } else {
    _reticle.style.animation = 'none';
  }
}

// ── Loading Screen ──────────────────────────────────────────────────────────

let _loadScreen = null;
let _loadBar = null;
let _loadText = null;

export function showLoadingScreen(text = 'Loading...') {
  if (!_loadScreen) {
    _loadScreen = document.createElement('div');
    _loadScreen.id = 'loading-screen';
    _loadScreen.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: #111; z-index: 2000; display: flex;
      flex-direction: column; align-items: center; justify-content: center;
      font-family: 'Poppins', sans-serif; color: #fff;
    `;

    _loadText = document.createElement('div');
    _loadText.style.cssText = 'font-size: 1.4rem; font-weight: 700; margin-bottom: 20px;';
    _loadScreen.appendChild(_loadText);

    const container = document.createElement('div');
    container.style.cssText = `
      width: 300px; height: 8px; background: rgba(255,255,255,0.15);
      border-radius: 4px; overflow: hidden;
    `;
    _loadBar = document.createElement('div');
    _loadBar.style.cssText = `
      height: 100%; width: 0%; background: linear-gradient(to right, #00e5ff, #ff6600);
      border-radius: 4px; transition: width 0.3s;
    `;
    container.appendChild(_loadBar);
    _loadScreen.appendChild(container);

    document.body.appendChild(_loadScreen);
  }
  _loadScreen.style.display = 'flex';
  _loadText.textContent = text;
}

export function updateLoadingProgress(fraction, text) {
  if (_loadBar) _loadBar.style.width = (fraction * 100) + '%';
  if (text && _loadText) _loadText.textContent = text;
}

export function hideLoadingScreen() {
  if (_loadScreen) {
    _loadScreen.style.opacity = '0';
    _loadScreen.style.transition = 'opacity 0.5s';
    setTimeout(() => {
      if (_loadScreen) _loadScreen.style.display = 'none';
      if (_loadScreen) _loadScreen.style.opacity = '1';
    }, 500);
  }
}

// ── Mode Label & Arena Name ─────────────────────────────────────────────────

let _modeLabel = null;

export function showModeLabel(modeName, arenaName) {
  if (_modeLabel) _modeLabel.remove();
  _modeLabel = document.createElement('div');
  _modeLabel.id = 'mode-label';
  _modeLabel.style.cssText = `
    position: fixed; top: 12%; left: 50%; transform: translateX(-50%);
    font-family: 'Poppins', sans-serif; text-align: center;
    z-index: 300; pointer-events: none;
    opacity: 0; transition: opacity 0.5s;
  `;
  _modeLabel.innerHTML = `
    <div style="font-size:2.2rem;font-weight:900;color:#fff;text-shadow:0 0 20px rgba(255,204,0,0.5),0 4px 0 #665500;letter-spacing:2px">${_esc(modeName)}</div>
    <div style="font-size:1rem;font-weight:600;color:#ccc;margin-top:4px">${_esc(arenaName)}</div>
  `;
  document.body.appendChild(_modeLabel);

  requestAnimationFrame(() => { _modeLabel.style.opacity = '1'; });
  setTimeout(() => {
    if (_modeLabel) {
      _modeLabel.style.opacity = '0';
      setTimeout(() => { if (_modeLabel) _modeLabel.remove(); _modeLabel = null; }, 500);
    }
  }, 3000);
}

// ── KO / Death Overlay (21.12) ──────────────────────────────────────────────

let _koOverlay = null;

export function showKOOverlay(text = "KO'd!") {
  hideKOOverlay();
  _koOverlay = document.createElement('div');
  _koOverlay.id = 'ko-overlay';
  _koOverlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.5); z-index: 500; pointer-events: none;
    opacity: 0; transition: opacity 0.3s;
  `;
  _koOverlay.innerHTML = `<div style="
    font-family:'Poppins',sans-serif; font-size:4rem; font-weight:900;
    color:#ff3333; text-shadow:0 0 30px rgba(255,0,0,0.6),0 6px 0 #660000;
    letter-spacing:6px; text-transform:uppercase;
    animation: koPulse 0.6s ease-out;
  ">${_esc(text)}</div>`;
  document.body.appendChild(_koOverlay);
  requestAnimationFrame(() => { _koOverlay.style.opacity = '1'; });
}

export function hideKOOverlay() {
  if (_koOverlay) {
    _koOverlay.remove();
    _koOverlay = null;
  }
}

// ── Respawning Text (21.13) ─────────────────────────────────────────────────

let _respawnText = null;

export function showRespawnText(text = 'RESPAWNING...') {
  hideRespawnText();
  _respawnText = document.createElement('div');
  _respawnText.id = 'respawn-text';
  _respawnText.style.cssText = `
    position: fixed; bottom: 40%; left: 50%; transform: translateX(-50%);
    font-family:'Poppins',sans-serif; font-size:1.6rem; font-weight:800;
    color:#ffcc00; text-shadow:0 0 12px rgba(255,204,0,0.4),0 3px 0 #665500;
    z-index: 510; pointer-events: none; letter-spacing:3px;
    animation: respawnBlink 0.8s infinite;
  `;
  _respawnText.textContent = text;
  document.body.appendChild(_respawnText);
}

export function hideRespawnText() {
  if (_respawnText) { _respawnText.remove(); _respawnText = null; }
}

// ── Damage Direction Indicator (21.14 + 22.4 WM-style colored border) ────

let _damageArcs = [];

// (22.4) WM-style concentric border overlays for damage direction
let _dmgBorderOuter = null;
let _dmgBorderInner = null;

/** Map weapon element to damage border color. */
const DAMAGE_BORDER_COLORS = {
  fire: '#ff3322',
  explosive: '#ff3322',
  missile: '#ff6600',
  fireball: '#ff6a24',
  glow_thrower: '#ff5a1f',
  glo_burst: '#ffd54a',
  bowling_ball: '#ff4444',
  cake: '#ff6600',
  ice: '#4a9ad3',
  freeze: '#4a9ad3',
  lightning_bolt: '#bfcfff',
  rock_barrage: '#8d6a4c',
  super_nova: '#ffd84a',
  gravity_well: '#8844ff',
  pirateleportation: '#8844ff',
  black_hole: '#8844ff',
  impact: '#ffffff',
  banana: '#ffcc00',
  bubblegum: '#ff66aa',
  default: '#ff0000',
};

/**
 * Show a WM-style colored damage border glow on screen edges.
 * Two concentric border overlays with CSS transition; color maps to weapon element.
 * @param {number} angle  Angle in radians from kart forward to attacker direction
 * @param {string} [weaponType]  Weapon subType for element-colored border
 */
export function showDamageDirection(angle, weaponType) {
  const color = DAMAGE_BORDER_COLORS[weaponType] || DAMAGE_BORDER_COLORS.default;

  // (22.4) WM-style concentric border glow
  if (!_dmgBorderOuter) {
    _dmgBorderOuter = document.createElement('div');
    _dmgBorderOuter.id = 'damage-border-outer';
    _dmgBorderOuter.style.cssText = `
      position:fixed; inset:0; pointer-events:none; z-index:106;
      border:40px solid transparent; box-sizing:border-box;
      transition: border-color 0.15s, opacity 1s ease-out;
      opacity:0;
    `;
    document.body.appendChild(_dmgBorderOuter);
  }
  if (!_dmgBorderInner) {
    _dmgBorderInner = document.createElement('div');
    _dmgBorderInner.id = 'damage-border-inner';
    _dmgBorderInner.style.cssText = `
      position:fixed; inset:0; pointer-events:none; z-index:107;
      border:20px solid transparent; box-sizing:border-box;
      transition: border-color 0.15s, opacity 1s ease-out;
      opacity:0;
    `;
    document.body.appendChild(_dmgBorderInner);
  }
  _dmgBorderOuter.style.borderColor = color;
  _dmgBorderOuter.style.opacity = '0.7';
  _dmgBorderInner.style.borderColor = color;
  _dmgBorderInner.style.opacity = '0.5';

  // Fade out after 1s
  clearTimeout(_dmgBorderOuter._fadeTimer);
  _dmgBorderOuter._fadeTimer = setTimeout(() => {
    if (_dmgBorderOuter) _dmgBorderOuter.style.opacity = '0';
    if (_dmgBorderInner) _dmgBorderInner.style.opacity = '0';
  }, 150);

  // Also keep the directional arc indicator (original 21.14)
  const arc = document.createElement('div');
  arc.style.cssText = `
    position: fixed; width: 80px; height: 80px;
    background: radial-gradient(circle, ${color}99, transparent 70%);
    border-radius: 50%; z-index: 105; pointer-events: none;
    opacity: 1; transition: opacity 1.5s;
  `;
  const cx = 50 + Math.sin(angle) * 42;
  const cy = 50 - Math.cos(angle) * 40;
  arc.style.left = `calc(${cx}% - 40px)`;
  arc.style.top = `calc(${cy}% - 40px)`;
  document.body.appendChild(arc);
  _damageArcs.push(arc);
  setTimeout(() => { arc.style.opacity = '0'; }, 50);
  setTimeout(() => { arc.remove(); _damageArcs = _damageArcs.filter(a => a !== arc); }, 1600);
}

// ── Low Health Warning (21.14) ───────────────────────────────────────────

let _lowHealthOverlay = null;

// ── (22.9) Offscreen Damage Direction Arrow — WM-style signed-angle tracking ──

let _offscreenArrow = null;

/**
 * Show a rotating arrow that tracks the attacker's position for 3 seconds.
 * Uses signed angle from camera forward × attacker direction for correct
 * left/right orientation (WM pattern: cross product sign).
 * @param {number} signedAngle  Signed angle in radians from camera forward to attacker
 */
export function showOffscreenDamageArrow(signedAngle) {
  // Reuse existing arrow if still visible
  if (!_offscreenArrow) {
    _offscreenArrow = document.createElement('div');
    _offscreenArrow.id = 'offscreen-damage-arrow';
    _offscreenArrow.style.cssText = `
      position:fixed; top:50%; left:50%; width:40px; height:40px;
      margin-left:-20px; margin-top:-20px;
      pointer-events:none; z-index:108;
      font-size:2rem; text-align:center; line-height:40px;
      color:#ff3333; text-shadow:0 0 8px rgba(255,0,0,0.6);
      transition: opacity 0.5s;
    `;
    _offscreenArrow.textContent = '▶';
    document.body.appendChild(_offscreenArrow);
  }

  // Position on screen edge based on angle
  const edgeRadius = Math.min(window.innerWidth, window.innerHeight) * 0.42;
  const cx = window.innerWidth / 2 + Math.sin(signedAngle) * edgeRadius;
  const cy = window.innerHeight / 2 - Math.cos(signedAngle) * edgeRadius;
  _offscreenArrow.style.left = cx + 'px';
  _offscreenArrow.style.top = cy + 'px';
  // Rotate arrow to point toward attacker
  const arrowAngleDeg = (signedAngle * 180 / Math.PI) + 90;
  _offscreenArrow.style.transform = `translate(-50%,-50%) rotate(${arrowAngleDeg}deg)`;
  _offscreenArrow.style.opacity = '1';

  // Auto-fade after 3s
  clearTimeout(_offscreenArrow._fadeTimer);
  _offscreenArrow._fadeTimer = setTimeout(() => {
    if (_offscreenArrow) _offscreenArrow.style.opacity = '0';
  }, 3000);
  // Clean up after fade
  clearTimeout(_offscreenArrow._removeTimer);
  _offscreenArrow._removeTimer = setTimeout(() => {
    if (_offscreenArrow) { _offscreenArrow.remove(); _offscreenArrow = null; }
  }, 3600);
}

export function updateLowHealthWarning(health, maxHealth = 100) {
  const pct = health / maxHealth;
  if (pct <= 0.25 && pct > 0) {
    if (!_lowHealthOverlay) {
      _lowHealthOverlay = document.createElement('div');
      _lowHealthOverlay.id = 'low-health-warning';
      _lowHealthOverlay.style.cssText = `
        position: fixed; inset: 0; pointer-events: none; z-index: 90;
        border: 4px solid transparent; box-sizing: border-box;
        animation: lowHealthPulse 1s infinite;
      `;
      document.body.appendChild(_lowHealthOverlay);
    }
  } else if (_lowHealthOverlay) {
    _lowHealthOverlay.remove();
    _lowHealthOverlay = null;
  }
}

// ── Scoreboard Tab Overlay (21.21) ──────────────────────────────────────────

let _scoreboardEl = null;

/**
 * Show/hide the in-match scoreboard.
 * @param {Array<{name:string, score:number, deaths:number, health:number, weapon:string}>} players
 * @param {string} selfId  Local player sessionId for highlighting
 */
export function showScoreboard(players, selfId) {
  if (!_scoreboardEl) {
    _scoreboardEl = document.createElement('div');
    _scoreboardEl.id = 'scoreboard-overlay';
    _scoreboardEl.style.cssText = `
      position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%);
      background: linear-gradient(135deg, rgba(18,24,36,0.86), rgba(8,10,16,0.82)); border-radius: 26px; padding: 22px 26px;
      border: 1px solid rgba(228,236,255,0.18);
      font-family:'Poppins',sans-serif; color:#fff; z-index: 600; min-width: 400px;
      backdrop-filter: blur(14px);
      box-shadow: 0 24px 60px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.09);
    `;
    document.body.appendChild(_scoreboardEl);
  }
  _scoreboardEl.style.display = 'block';

  const sorted = [...players].sort((a, b) => (b.score || 0) - (a.score || 0));
  let rows = sorted.map((p, i) => {
    const isSelf = p.id === selfId;
    const bg = isSelf ? 'rgba(92,245,208,0.12)' : 'rgba(255,255,255,0.02)';
    const icon = WEAPON_ICONS[p.weapon] || '';
    const hp = Math.max(0, Math.min(100, p.health ?? 100));
    const kd = (p.deaths || 0) === 0 ? (p.score || 0).toFixed(1) : ((p.score || 0) / (p.deaths || 1)).toFixed(1);
    const hpColor = hp > 60 ? '#22ff44' : hp > 30 ? '#ffcc00' : '#ff4444';
    return `<tr style="background:${bg}">
      <td style="padding:4px 8px;text-align:center">${i + 1}</td>
      <td style="padding:4px 8px">${isSelf ? '<span style="color:#00ff88">&#9654;</span> ' : ''}${_esc(p.name || '?')}</td>
      <td style="padding:4px 8px;text-align:center">${p.score || 0}</td>
      <td style="padding:4px 8px;text-align:center">${p.deaths || 0}</td>
      <td style="padding:4px 8px;text-align:center;color:#aaa">${kd}</td>
      <td style="padding:4px 8px;text-align:center">${icon}</td>
      <td style="padding:4px 8px"><div style="width:50px;height:6px;background:rgba(255,255,255,0.1);border-radius:3px;overflow:hidden"><div style="width:${hp}%;height:100%;background:${hpColor};border-radius:3px"></div></div></td>
    </tr>`;
  }).join('');

  _scoreboardEl.innerHTML = `
    <div style="font-size:0.72rem;font-weight:700;letter-spacing:0.24em;color:rgba(228,236,255,0.56);text-align:center;margin-bottom:4px">BATTLE STANDINGS</div>
    <div style="font-size:1.2rem;font-weight:900;text-align:center;margin-bottom:14px;color:#eef4ff">Scoreboard</div>
    <table style="width:100%;border-collapse:separate;border-spacing:0 6px;font-size:0.9rem">
      <tr style="font-weight:700;color:rgba(228,236,255,0.68)">
        <th style="padding:6px 8px">#</th><th style="padding:6px 8px;text-align:left">Player</th>
        <th style="padding:6px 8px">Knock Outs</th><th style="padding:6px 8px">Deaths</th><th style="padding:6px 8px">K/D</th><th style="padding:6px 8px">Wpn</th><th style="padding:6px 8px">HP</th>
      </tr>
      ${rows}
    </table>
  `;
}

export function hideScoreboard() {
  if (_scoreboardEl) _scoreboardEl.style.display = 'none';
}

// ── CSS Animations (injected once) ──────────────────────────────────────────

let _cssInjected = false;
function _injectCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes koPulse { 0% { transform: scale(2); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
    @keyframes respawnBlink { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
    @keyframes lowHealthPulse { 0%,100% { border-color: transparent; } 50% { border-color: rgba(255,0,0,0.4); } }
    @keyframes countdownPop { 0% { transform: scale(2); opacity: 0; } 50% { transform: scale(0.9); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
    @keyframes countdownFade { 0% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: scale(1.8); } }
  `;
  document.head.appendChild(style);
}
// Auto-inject
if (typeof document !== 'undefined') _injectCSS();

// ── Weapon Slot / Item Roulette ──────────────────────────────────────────────

const ROULETTE_ICONS = ['🎳', '🎂', '🪠', '🚀', '🍌', '🫧', '⚡', '🛡️', '🪰'];
const ROULETTE_DURATION = 1.5; // seconds

let _weaponSlot = null;
let _weaponIcon = null;
let _rouletteState = null; // { timer, result, intervalId }

export function createWeaponSlot() {
  if (_weaponSlot) return;
  _weaponSlot = document.createElement('div');
  _weaponSlot.id = 'weapon-slot';
  _weaponSlot.style.cssText = `
    position: fixed; bottom: 70px; right: 30px;
    width: 64px; height: 64px;
    background: rgba(0,0,0,0.75); border-radius: 14px;
    border: 3px solid rgba(255,255,255,0.3);
    display: flex; align-items: center; justify-content: center;
    z-index: 110; pointer-events: none;
    font-size: 2rem; transition: border-color 0.2s, transform 0.15s;
  `;
  _weaponIcon = document.createElement('span');
  _weaponIcon.style.cssText = 'transition: transform 0.08s;';
  _weaponSlot.appendChild(_weaponIcon);
  document.body.appendChild(_weaponSlot);
}

/**
 * Show the roulette-cycle animation then land on the awarded weapon.
 * @param {string} weaponId  The server-decided weapon
 * @param {object} weaponIcons  Optional map { id: icon }
 */
export function startItemRoulette(weaponId, weaponIcons) {
  if (!_weaponSlot) createWeaponSlot();
  stopItemRoulette();

  const icons = weaponIcons || {};
  const finalIcon = icons[weaponId] || WEAPON_ICONS[weaponId] || '❓';

  let tick = 0;
  const startInterval = 60;  // ms between swaps (fast)
  const endInterval = 220;   // ms between swaps (slow)
  const totalTicks = 16;
  let currentTick = 0;

  _weaponSlot.style.borderColor = 'rgba(255,204,0,0.8)';
  _weaponSlot.style.transform = 'scale(1.1)';

  const advanceTick = () => {
    currentTick++;
    const progress = currentTick / totalTicks;
    const randomIcon = ROULETTE_ICONS[Math.floor(Math.random() * ROULETTE_ICONS.length)];
    _weaponIcon.textContent = randomIcon;
    _weaponIcon.style.transform = 'scale(1.15)';
    setTimeout(() => { if (_weaponIcon) _weaponIcon.style.transform = 'scale(1)'; }, 40);

    if (currentTick >= totalTicks) {
      // Land on final weapon
      _weaponIcon.textContent = finalIcon;
      _weaponSlot.style.borderColor = 'rgba(0,255,100,0.9)';
      _weaponSlot.style.transform = 'scale(1.2)';
      setTimeout(() => {
        if (_weaponSlot) {
          _weaponSlot.style.borderColor = 'rgba(255,255,255,0.3)';
          _weaponSlot.style.transform = 'scale(1)';
        }
      }, 400);
      _rouletteState = null;
      return;
    }

    // Ease-out timing: intervals get longer as we approach the end
    const nextDelay = startInterval + (endInterval - startInterval) * progress * progress;
    _rouletteState.timeoutId = setTimeout(advanceTick, nextDelay);
  };

  _rouletteState = { timeoutId: setTimeout(advanceTick, startInterval) };
}

export function stopItemRoulette() {
  if (_rouletteState) {
    clearTimeout(_rouletteState.timeoutId);
    _rouletteState = null;
  }
}

export function isRouletteActive() {
  return _rouletteState !== null;
}

/** Update the weapon slot display (when not in roulette). */
export function updateWeaponSlot(weaponId, ammoCount) {
  if (!_weaponSlot) createWeaponSlot();
  if (_rouletteState) return; // Don't override during roulette
  if (!weaponId) {
    _weaponIcon.textContent = '';
    _weaponSlot.style.borderColor = 'rgba(255,255,255,0.15)';
    _weaponSlot.style.opacity = '0.5';
    if (_weaponSlot._noItemLabel) _weaponSlot._noItemLabel.style.display = 'none';
  } else {
    _weaponIcon.textContent = WEAPON_ICONS[weaponId] || '\u2753';
    _weaponSlot.style.borderColor = 'rgba(255,255,255,0.3)';
    _weaponSlot.style.opacity = '1';
    if (_weaponSlot._noItemLabel) _weaponSlot._noItemLabel.style.display = 'none';
  }
  // Ammo counter
  if (!_weaponSlot._ammoLabel) {
    const a = document.createElement('div');
    a.style.cssText = 'position:absolute;top:-10px;right:-10px;min-width:20px;height:20px;border-radius:10px;background:#ff6600;color:#fff;font-size:0.65rem;font-weight:900;display:flex;align-items:center;justify-content:center;pointer-events:none;padding:0 4px;';
    _weaponSlot.appendChild(a);
    _weaponSlot._ammoLabel = a;
  }
  if (ammoCount != null && ammoCount > 1) {
    _weaponSlot._ammoLabel.textContent = `x${ammoCount}`;
    _weaponSlot._ammoLabel.style.display = 'flex';
  } else {
    _weaponSlot._ammoLabel.style.display = 'none';
  }
}

/** Fire cooldown sweep overlay on weapon slot (0=ready, 1=full cooldown). */
export function updateWeaponCooldown(ratio) {
  if (!_weaponSlot) return;
  if (!_weaponSlot._cooldownOverlay) {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:absolute;bottom:0;left:0;width:100%;background:rgba(0,0,0,0.6);border-radius:0 0 11px 11px;pointer-events:none;transition:height 0.1s;';
    _weaponSlot.appendChild(ov);
    _weaponSlot._cooldownOverlay = ov;
  }
  const pct = Math.max(0, Math.min(1, ratio));
  _weaponSlot._cooldownOverlay.style.height = (pct * 100) + '%';
  _weaponSlot._cooldownOverlay.style.display = pct > 0 ? 'block' : 'none';
}

/** Brief glow pulse when a new weapon is acquired. */
export function pulseWeaponSlot() {
  if (!_weaponSlot) return;
  _weaponSlot.style.boxShadow = '0 0 20px 6px rgba(0,255,100,0.7)';
  _weaponSlot.style.transform = 'scale(1.15)';
  setTimeout(() => {
    if (_weaponSlot) {
      _weaponSlot.style.boxShadow = 'none';
      _weaponSlot.style.transform = 'scale(1)';
    }
  }, 400);
}

// ── Hit Confirm Indicator ───────────────────────────────────────────────────

let _hitConfirmEl = null;

export function showHitConfirm(damage) {
  if (!_hitConfirmEl) {
    _hitConfirmEl = document.createElement('div');
    _hitConfirmEl.id = 'hit-confirm';
    _hitConfirmEl.style.cssText = `
      position: fixed; top: 45%; left: 50%; transform: translate(-50%, -50%);
      font-family: 'Poppins', sans-serif; font-size: 1.4rem; font-weight: 900;
      color: #ff4444; text-shadow: 0 0 8px rgba(255,0,0,0.5), 0 2px 0 #660000;
      z-index: 120; pointer-events: none; opacity: 0;
      transition: opacity 0.15s, transform 0.3s;
    `;
    document.body.appendChild(_hitConfirmEl);
  }
  _hitConfirmEl.textContent = `HIT +${Math.round(damage)}`;
  _hitConfirmEl.style.opacity = '1';
  _hitConfirmEl.style.transform = 'translate(-50%, -50%) scale(1.2)';
  // Flash reticle red briefly
  if (_reticle) {
    _reticle.style.borderColor = '#ff2222';
    _reticle.style.boxShadow = '0 0 12px #ff2222';
    setTimeout(() => {
      if (_reticle) { _reticle.style.borderColor = ''; _reticle.style.boxShadow = ''; }
    }, 200);
  }
  setTimeout(() => {
    if (_hitConfirmEl) {
      _hitConfirmEl.style.opacity = '0';
      _hitConfirmEl.style.transform = 'translate(-50%, -60%) scale(1)';
    }
  }, 800);
}

// ── Dispose ─────────────────────────────────────────────────────────────────

export function disposeBattleHUD() {
  stopItemRoulette();
  hideKOOverlay();
  hideRespawnText();
  hideScoreboard();
  if (_lowHealthOverlay) { _lowHealthOverlay.remove(); _lowHealthOverlay = null; }
  // (22.4) Clean up damage border overlays
  if (_dmgBorderOuter) { _dmgBorderOuter.remove(); _dmgBorderOuter = null; }
  if (_dmgBorderInner) { _dmgBorderInner.remove(); _dmgBorderInner = null; }
  // (22.9) Clean up offscreen arrow
  if (_offscreenArrow) { clearInterval(_offscreenArrow._trackInterval); _offscreenArrow.remove(); _offscreenArrow = null; }
  for (const arc of _damageArcs) arc.remove();
  _damageArcs = [];
  [_healthBar, _livesEl, _scoreEl, _killFeed, _matchTimer, _reticle, _loadScreen, _modeLabel, _weaponSlot, _hitConfirmEl, _scoreboardEl].forEach(el => {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  });
  _healthBar = _healthFill = _healthText = null;
  _livesEl = null;
  _scoreEl = null;
  _killFeed = null;
  _matchTimer = null;
  _reticle = null;
  _loadScreen = _loadBar = _loadText = null;
  _modeLabel = null;
  _weaponSlot = _weaponIcon = null;
  _hitConfirmEl = null;
  _scoreboardEl = null;
}
