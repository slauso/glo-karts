/**
 * race-hud.js — STK-style Race HUD overlays
 *
 * Adds missing HUD elements vs SuperTuxKart:
 *   - Position badge (large "1st" / "2nd" / "3rd" overlay)
 *   - Nitro gauge (boost meter, bottom-right)
 *   - Wrong-way indicator
 *   - Item roulette animation on pickup
 *   - Traffic-light countdown (3 circles)
 *   - "GO!" burst text with animation
 */

// ── Position Badge ──────────────────────────────────────────────────────────

let _positionBadge = null;

export function createPositionBadge() {
  if (_positionBadge) return;
  _positionBadge = document.createElement('div');
  _positionBadge.id = 'position-badge';
  _positionBadge.style.cssText = `
    position: fixed; bottom: 240px; right: 30px;
    font-family: 'Poppins', sans-serif; font-size: 3.5rem; font-weight: 900;
    color: gold; text-shadow: 0 0 20px rgba(255,215,0,0.6), 0 4px 0 #b8860b;
    z-index: 100; pointer-events: none; user-select: none;
    transition: transform 0.3s cubic-bezier(.18,.89,.32,1.28), color 0.3s;
    letter-spacing: -2px;
  `;
  _positionBadge.textContent = '1st';
  _positionBadge.style.display = 'none';
  document.body.appendChild(_positionBadge);
}

export function updatePositionBadge(position) {
  if (!_positionBadge) return;
  const labels = { 1: '1st', 2: '2nd', 3: '3rd' };
  const colors = { 1: 'gold', 2: 'silver', 3: '#cd7f32' };
  const shadows = {
    1: '0 0 20px rgba(255,215,0,0.6), 0 4px 0 #b8860b',
    2: '0 0 20px rgba(192,192,192,0.6), 0 4px 0 #808080',
    3: '0 0 20px rgba(205,127,50,0.6), 0 4px 0 #8B4513',
  };
  const label = labels[position] || `${position}th`;
  const prevText = _positionBadge.textContent;
  _positionBadge.textContent = label;
  _positionBadge.style.color = colors[position] || '#fff';
  _positionBadge.style.textShadow = shadows[position] || '0 0 10px rgba(255,255,255,0.5), 0 4px 0 #333';
  _positionBadge.style.display = 'block';

  // Pulse animation on position change
  if (prevText !== label) {
    _positionBadge.style.transform = 'scale(1.4)';
    setTimeout(() => { if (_positionBadge) _positionBadge.style.transform = 'scale(1)'; }, 300);
  }
}

// ── Nitro Gauge ─────────────────────────────────────────────────────────────

let _nitroGauge = null;
let _nitroFill = null;
let _nitroValue = 0;
let _nitroTarget = 0;

export function createNitroGauge() {
  if (_nitroGauge) return;
  _nitroGauge = document.createElement('div');
  _nitroGauge.id = 'nitro-gauge';
  _nitroGauge.style.cssText = `
    position: fixed; bottom: 30px; right: 240px;
    width: 36px; height: 140px;
    background: rgba(0,0,0,0.6); border-radius: 18px;
    border: 2px solid rgba(255,255,255,0.25);
    z-index: 100; pointer-events: none; user-select: none;
    overflow: hidden; display: none;
  `;

  // Label
  const label = document.createElement('div');
  label.style.cssText = `
    position: absolute; bottom: -22px; left: 50%; transform: translateX(-50%);
    font-family: 'Poppins', sans-serif; font-size: 10px; font-weight: 700;
    color: #fff; letter-spacing: 1px; white-space: nowrap;
  `;
  label.textContent = 'NITRO';
  _nitroGauge.appendChild(label);

  // Fill bar (fills from bottom)
  _nitroFill = document.createElement('div');
  _nitroFill.style.cssText = `
    position: absolute; bottom: 0; left: 0; width: 100%; height: 0%;
    background: linear-gradient(to top, #00e5ff, #00ff88);
    border-radius: 0 0 16px 16px;
    transition: height 0.15s ease;
    box-shadow: 0 0 12px rgba(0,229,255,0.5);
  `;
  _nitroGauge.appendChild(_nitroFill);

  document.body.appendChild(_nitroGauge);
}

/**
 * Update nitro gauge. Value is 0-1 (fraction of max boost remaining).
 */
export function updateNitroGauge(value, isBoosting = false) {
  if (!_nitroGauge) return;
  _nitroTarget = Math.max(0, Math.min(1, value));
  _nitroGauge.style.display = 'block';
  _nitroFill.style.height = (_nitroTarget * 100) + '%';
  if (isBoosting) {
    _nitroFill.style.background = 'linear-gradient(to top, #ff6600, #ffcc00)';
    _nitroFill.style.boxShadow = '0 0 16px rgba(255,102,0,0.7)';
  } else {
    _nitroFill.style.background = 'linear-gradient(to top, #00e5ff, #00ff88)';
    _nitroFill.style.boxShadow = '0 0 12px rgba(0,229,255,0.5)';
  }
}

// ── Wrong Way Indicator ─────────────────────────────────────────────────────

let _wrongWay = null;
let _wrongWayVisible = false;

export function createWrongWayIndicator() {
  if (_wrongWay) return;
  _wrongWay = document.createElement('div');
  _wrongWay.id = 'wrong-way';
  _wrongWay.style.cssText = `
    position: fixed; top: 25%; left: 50%; transform: translateX(-50%);
    font-family: 'Poppins', sans-serif; font-size: 3rem; font-weight: 900;
    color: #ff3333; text-shadow: 0 0 20px rgba(255,0,0,0.6), 0 3px 0 #660000;
    z-index: 200; pointer-events: none; user-select: none;
    opacity: 0; transition: opacity 0.3s;
    letter-spacing: 3px;
  `;
  _wrongWay.textContent = '⚠ WRONG WAY';
  document.body.appendChild(_wrongWay);
}

export function showWrongWay(show) {
  if (!_wrongWay) return;
  if (show && !_wrongWayVisible) {
    _wrongWayVisible = true;
    _wrongWay.style.opacity = '1';
  } else if (!show && _wrongWayVisible) {
    _wrongWayVisible = false;
    _wrongWay.style.opacity = '0';
  }
}

// ── Item Roulette Animation ─────────────────────────────────────────────────

const ITEM_ICONS = {
  bowling_ball: '🎳', cake: '🎂', plunger: '🪠', missile: '🚀',
  banana: '🍌', bubblegum: '🫧', ludicrous_mode: '🔋', shield: '🛡️', swatter: '🪰',
  // Extreme weapons
  shockwave_cannon: '💥', thunderstrike: '⚡', black_hole: '🕳️',
  meteor_swarm: '☄️', frost_nova: '❄️', emp_pulse: '📡',
  gravity_flip: '🔄', inferno_trail: '🔥', plasma_railgun: '🔫',
  vortex_tornado: '🌪️',
};
const ALL_ICONS = Object.values(ITEM_ICONS);

let _rouletteEl = null;
let _rouletteTimer = null;

/**
 * Play the item roulette animation then settles on the picked item.
 * @param {string} weaponId — the final weapon id
 * @param {Function} [onComplete] — called when roulette finishes
 */
export function playItemRoulette(weaponId, onComplete) {
  if (!_rouletteEl) {
    _rouletteEl = document.createElement('div');
    _rouletteEl.id = 'item-roulette';
    _rouletteEl.style.cssText = `
      position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
      background: rgba(0,0,0,0.8); color: #fff; font-family: Poppins, sans-serif;
      padding: 12px 24px; border-radius: 14px; z-index: 150; text-align: center;
      pointer-events: none; font-size: 2.5rem; border: 2px solid rgba(255,204,0,0.6);
      box-shadow: 0 0 20px rgba(255,204,0,0.4);
    `;
    document.body.appendChild(_rouletteEl);
  }

  _rouletteEl.style.display = 'block';
  if (_rouletteTimer) clearInterval(_rouletteTimer);

  let ticks = 0;
  const maxTicks = 14;
  let interval = 60;

  function tick() {
    ticks++;
    const icon = ALL_ICONS[Math.floor(Math.random() * ALL_ICONS.length)];
    _rouletteEl.textContent = icon;

    if (ticks >= maxTicks) {
      // Settle on final item
      _rouletteEl.textContent = ITEM_ICONS[weaponId] || '🎯';
      _rouletteEl.style.transform = 'translateX(-50%) scale(1.3)';
      setTimeout(() => {
        if (_rouletteEl) {
          _rouletteEl.style.transform = 'translateX(-50%) scale(1)';
          setTimeout(() => {
            if (_rouletteEl) _rouletteEl.style.display = 'none';
            if (onComplete) onComplete();
          }, 600);
        }
      }, 300);
      return;
    }
    // Slow down as we approach the end
    interval += 20;
    _rouletteTimer = setTimeout(tick, interval);
  }

  tick();
}

// ── Traffic Light Countdown ─────────────────────────────────────────────────

let _trafficLight = null;

export function createTrafficLight() {
  if (_trafficLight) return;
  _trafficLight = document.createElement('div');
  _trafficLight.id = 'traffic-light';
  _trafficLight.style.cssText = `
    position: fixed; top: 10%; left: 50%; transform: translateX(-50%);
    display: none; flex-direction: column; align-items: center; gap: 10px;
    background: rgba(20,20,20,0.85); padding: 18px 22px; border-radius: 16px;
    border: 3px solid #333; z-index: 1000; pointer-events: none;
    box-shadow: 0 8px 32px rgba(0,0,0,0.6);
  `;

  for (let i = 0; i < 3; i++) {
    const light = document.createElement('div');
    light.className = 'traffic-circle';
    light.style.cssText = `
      width: 50px; height: 50px; border-radius: 50%;
      background: #333; border: 2px solid #555;
      transition: background 0.2s, box-shadow 0.2s;
    `;
    _trafficLight.appendChild(light);
  }

  document.body.appendChild(_trafficLight);
}

/**
 * Animate the traffic light countdown: red-red-red → red-red → red → green → hide.
 * @param {Function} onGo — called when GO is reached
 */
export function animateTrafficLight(onGo) {
  if (!_trafficLight) createTrafficLight();
  const lights = _trafficLight.querySelectorAll('.traffic-circle');
  _trafficLight.style.display = 'flex';

  // Reset all lights
  lights.forEach(l => { l.style.background = '#333'; l.style.boxShadow = 'none'; });

  // Light sequence: 3-2-1-GO
  const RED = '#ff2222';
  const RED_GLOW = '0 0 20px rgba(255,0,0,0.7)';
  const GREEN = '#22ff44';
  const GREEN_GLOW = '0 0 20px rgba(0,255,0,0.7)';

  // 3 — all red
  setTimeout(() => {
    lights.forEach(l => { l.style.background = RED; l.style.boxShadow = RED_GLOW; });
  }, 0);

  // 2 — top two red, bottom off
  setTimeout(() => {
    lights[2].style.background = '#333'; lights[2].style.boxShadow = 'none';
  }, 1000);

  // 1 — top red only
  setTimeout(() => {
    lights[1].style.background = '#333'; lights[1].style.boxShadow = 'none';
  }, 2000);

  // GO — all green
  setTimeout(() => {
    lights.forEach(l => { l.style.background = GREEN; l.style.boxShadow = GREEN_GLOW; });
    // Show GO! burst
    showGoBurst();
    if (onGo) onGo();
  }, 3000);

  // Hide traffic light
  setTimeout(() => {
    _trafficLight.style.display = 'none';
  }, 3800);
}

// ── GO! Burst Text ──────────────────────────────────────────────────────────

function showGoBurst() {
  const el = document.createElement('div');
  el.style.cssText = `
    position: fixed; top: 40%; left: 50%; transform: translate(-50%, -50%) scale(0.3);
    font-family: 'Poppins', sans-serif; font-size: 8rem; font-weight: 900;
    color: #22ff44; text-shadow: 0 0 40px rgba(0,255,0,0.7), 0 6px 0 #0a6618;
    z-index: 1001; pointer-events: none;
    opacity: 0; transition: transform 0.3s cubic-bezier(.18,.89,.32,1.28), opacity 0.3s;
    letter-spacing: 8px;
  `;
  el.textContent = 'GO!';
  document.body.appendChild(el);

  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translate(-50%, -50%) scale(1)';
  });

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translate(-50%, -50%) scale(1.5)';
    setTimeout(() => el.remove(), 400);
  }, 800);
}

// ── Screen Shake on Damage ──────────────────────────────────────────────────

let _shakeIntensity = 0;
let _shakeTimer = 0;

/**
 * Trigger a screen shake effect. Call from damage handler.
 * @param {number} intensity — 0-1 scale
 * @param {number} duration — seconds
 */
export function triggerScreenShake(intensity = 0.5, duration = 0.3) {
  _shakeIntensity = intensity;
  _shakeTimer = duration;
}

/**
 * Apply per-frame shake offset to the canvas. Call from animate loop.
 */
export function updateScreenShake(dt, canvas) {
  if (_shakeTimer <= 0) return;
  _shakeTimer -= dt;
  const t = Math.max(0, _shakeTimer);
  const amp = _shakeIntensity * (t / 0.3) * 8; // pixels
  const ox = (Math.random() - 0.5) * amp;
  const oy = (Math.random() - 0.5) * amp;
  if (canvas) {
    canvas.style.transform = `translate(${ox}px, ${oy}px)`;
  }
  if (_shakeTimer <= 0 && canvas) {
    canvas.style.transform = '';
  }
}

// ── Red Vignette on Damage ──────────────────────────────────────────────────

let _vignette = null;

export function createDamageVignette() {
  if (_vignette) return;
  _vignette = document.createElement('div');
  _vignette.id = 'damage-vignette';
  _vignette.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    pointer-events: none; z-index: 90; opacity: 0;
    background: radial-gradient(ellipse at center, transparent 50%, rgba(255,0,0,0.5) 100%);
    transition: opacity 0.15s ease-in;
  `;
  document.body.appendChild(_vignette);
}

/**
 * Flash the red damage vignette.
 * @param {number} intensity — 0-1
 */
export function flashDamageVignette(intensity = 0.6) {
  if (!_vignette) createDamageVignette();
  _vignette.style.opacity = String(Math.min(1, intensity));
  setTimeout(() => { if (_vignette) _vignette.style.opacity = '0'; }, 200);
}

// ── Weapon Icon Images (replaces emoji) ─────────────────────────────────────

const WEAPON_ICON_MAP = {
  bowling: '/textures/items/bowling-icon.png',
  bubblegum: '/textures/items/bubblegum-icon.png',
  cake: '/textures/items/cake-icon.png',
  plunger: '/textures/items/plunger-icon.png',
  anchor: '/textures/items/anchor-icon.png',
  swatter: '/textures/items/swatter-icon.png',
  nitro: '/textures/items/nitro.png',
  parachute: '/textures/items/parachute-icon.png',
  guided_missile: '/textures/items/bowling-icon.png',
  grenade: '/textures/items/nitro.png',
  // Race-mode weapon names (different ID scheme)
  bowling_ball: '/textures/items/bowling-icon.png',
  missile: '/textures/items/bowling-icon.png',
  ludicrous_mode: '/textures/items/nitro.png',
  shield: '/textures/items/bowling-icon.png',
};

/**
 * Return an <img> tag for the weapon icon, falling back to emoji if no image.
 */
export function getWeaponIconHTML(weaponId, emoji = '🎯', size = 32) {
  const src = WEAPON_ICON_MAP[weaponId];
  if (src) {
    return `<img src="${src}" alt="${weaponId}" style="width:${size}px;height:${size}px;vertical-align:middle;image-rendering:pixelated;filter:drop-shadow(0 0 4px rgba(255,255,255,0.5))">`;
  }
  return `<span style="font-size:${size}px">${emoji}</span>`;
}

// ── Dispose all HUD elements ────────────────────────────────────────────────

export function disposeHUD() {
  [_positionBadge, _nitroGauge, _wrongWay, _rouletteEl, _trafficLight, _vignette].forEach(el => {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  });
  _positionBadge = _nitroGauge = _nitroFill = _wrongWay = _rouletteEl = _trafficLight = _vignette = null;
}
