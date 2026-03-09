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

export function updateHealthBar(health, maxHealth = 100) {
  if (!_healthBar) return;
  const pct = Math.max(0, Math.min(100, (health / maxHealth) * 100));
  _healthFill.style.width = pct + '%';
  _healthText.textContent = Math.ceil(health);

  if (pct > 60) {
    _healthFill.style.background = 'linear-gradient(to right, #22ff44, #88ff44)';
  } else if (pct > 30) {
    _healthFill.style.background = 'linear-gradient(to right, #ffcc00, #ff8800)';
  } else {
    _healthFill.style.background = 'linear-gradient(to right, #ff4444, #ff0000)';
  }
}

// ── Lives / Balloon Indicator ───────────────────────────────────────────────

let _livesEl = null;

export function createLivesIndicator(maxLives = 3) {
  if (_livesEl) _livesEl.remove();
  _livesEl = document.createElement('div');
  _livesEl.id = 'battle-lives';
  _livesEl.style.cssText = `
    position: fixed; bottom: 62px; left: 50%; transform: translateX(-50%);
    display: flex; gap: 8px;
    z-index: 100; pointer-events: none;
  `;
  for (let i = 0; i < maxLives; i++) {
    const b = document.createElement('span');
    b.className = 'life-balloon';
    b.style.cssText = `
      font-size: 1.6rem; transition: opacity 0.3s, transform 0.3s;
    `;
    b.textContent = '🎈';
    _livesEl.appendChild(b);
  }
  document.body.appendChild(_livesEl);
}

export function updateLivesIndicator(currentLives) {
  if (!_livesEl) return;
  const balloons = _livesEl.querySelectorAll('.life-balloon');
  balloons.forEach((b, i) => {
    if (i < currentLives) {
      b.style.opacity = '1';
      b.style.transform = 'scale(1)';
    } else {
      b.style.opacity = '0.2';
      b.style.transform = 'scale(0.6)';
    }
  });
}

// ── Score Display ───────────────────────────────────────────────────────────

let _scoreEl = null;

export function createScoreDisplay() {
  if (_scoreEl) return;
  _scoreEl = document.createElement('div');
  _scoreEl.id = 'battle-score';
  _scoreEl.style.cssText = `
    position: fixed; top: 20px; right: 30px;
    font-family: 'Poppins', sans-serif; font-size: 2rem; font-weight: 900;
    color: #fff; text-shadow: 0 0 10px rgba(255,255,255,0.4), 0 3px 0 #333;
    z-index: 100; pointer-events: none; text-align: right;
  `;
  _scoreEl.textContent = '0 Kills';
  document.body.appendChild(_scoreEl);
}

export function updateScoreDisplay(kills, label = 'Kills') {
  if (!_scoreEl) return;
  _scoreEl.textContent = `${kills} ${label}`;
}

// ── Kill Feed ───────────────────────────────────────────────────────────────

let _killFeed = null;

const WEAPON_ICONS = {
  bowling_ball: '🎳', cake: '🎂', plunger: '🪠', missile: '🚀',
  banana: '🍌', bubblegum: '🫧', swatter: '🪰',
  shockwave_cannon: '💥', thunderstrike: '⚡', black_hole: '🕳️',
  meteor_swarm: '☄️', frost_nova: '❄️', emp_pulse: '📡',
  gravity_flip: '🔄', inferno_trail: '🔥', plasma_railgun: '🔫',
  vortex_tornado: '🌪️',
};

export function createKillFeed() {
  if (_killFeed) return;
  _killFeed = document.createElement('div');
  _killFeed.id = 'kill-feed';
  _killFeed.style.cssText = `
    position: fixed; top: 20px; left: 20px;
    display: flex; flex-direction: column; gap: 4px;
    z-index: 100; pointer-events: none;
    font-family: 'Poppins', sans-serif; font-size: 0.85rem; font-weight: 600;
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
    background: rgba(0,0,0,0.7); color: #fff; padding: 4px 10px;
    border-radius: 6px; opacity: 1; transition: opacity 0.5s;
    white-space: nowrap;
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
    position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
    font-family: 'Poppins', sans-serif; font-size: 1.6rem; font-weight: 900;
    color: #fff; text-shadow: 0 0 12px rgba(255,255,255,0.3), 0 3px 0 #222;
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
    _matchTimer.style.textShadow = '0 0 12px rgba(255,0,0,0.5), 0 3px 0 #660000';
  } else {
    _matchTimer.style.color = '#fff';
    _matchTimer.style.textShadow = '0 0 12px rgba(255,255,255,0.3), 0 3px 0 #222';
  }
}

// ── Lock-On Reticle ─────────────────────────────────────────────────────────

let _reticle = null;

export function createLockReticle() {
  if (_reticle) return;
  _reticle = document.createElement('div');
  _reticle.id = 'lock-reticle';
  _reticle.style.cssText = `
    position: fixed; width: 48px; height: 48px;
    border: 3px solid rgba(255,0,0,0.7); border-radius: 50%;
    z-index: 110; pointer-events: none; display: none;
    transform: translate(-50%, -50%);
    transition: border-color 0.15s, box-shadow 0.15s;
  `;
  // Crosshair lines
  const line = (rot) => {
    const l = document.createElement('div');
    l.style.cssText = `
      position: absolute; top: 50%; left: 50%;
      width: 16px; height: 2px; background: rgba(255,0,0,0.7);
      transform: translate(-50%,-50%) rotate(${rot}deg);
    `;
    return l;
  };
  _reticle.appendChild(line(0));
  _reticle.appendChild(line(90));
  document.body.appendChild(_reticle);
}

/**
 * Update lock reticle position and lock state.
 * @param {number|null} screenX  Null to hide
 * @param {number|null} screenY
 * @param {boolean} locked  True = fully locked (red), false = acquiring (yellow)
 */
export function updateLockReticle(screenX, screenY, locked) {
  if (!_reticle) return;
  if (screenX == null || screenY == null) {
    _reticle.style.display = 'none';
    return;
  }
  _reticle.style.display = 'block';
  _reticle.style.left = screenX + 'px';
  _reticle.style.top  = screenY + 'px';
  if (locked) {
    _reticle.style.borderColor = 'rgba(255,0,0,0.9)';
    _reticle.style.boxShadow   = '0 0 16px rgba(255,0,0,0.6)';
  } else {
    _reticle.style.borderColor = 'rgba(255,200,0,0.7)';
    _reticle.style.boxShadow   = '0 0 10px rgba(255,200,0,0.4)';
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

// ── Dispose ─────────────────────────────────────────────────────────────────

export function disposeBattleHUD() {
  [_healthBar, _livesEl, _scoreEl, _killFeed, _matchTimer, _reticle, _loadScreen, _modeLabel].forEach(el => {
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
}
