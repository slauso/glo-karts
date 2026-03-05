/**
 * title-glow.js – Syncs the .game-title text-glow (and the mute button glow)
 * to the user's active GLO effect + colour selection.
 *
 * Updates two CSS custom properties on :root every animation frame:
 *   --glo-title-glow : rgba(r,g,b,α)  – used in text-shadow & box-shadow
 *
 * Mirrors the THEME_PALETTE from lobby-background.js so the title glow
 * matches the background particle animation exactly.
 */

// ── Per-theme colour palettes (mirrors lobby-background.js THEME_PALETTE) ────
const THEME_PAL = {
  sunrise:          ['#881100', '#ff4400', '#ff9900', '#ffdd55'],
  sunset:           ['#ff5500', '#ff2200', '#cc0055', '#880033'],
  'sunset-glow':    ['#ffaa00', '#ff5500', '#ff1166', '#ff8800'],
  fire:             ['#ff0000', '#ff4400', '#ff8800', '#ffcc00'],
  'falling-leaves': ['#aa3300', '#dd6600', '#cc8800', '#772200'],
  spring:           ['#ffaabb', '#aaffbb', '#ffffaa', '#ccaaff'],
  aurora:           ['#00ff88', '#00bbff', '#8800ff', '#00ff44', '#00ffaa'],
  forest:           ['#003300', '#116611', '#335522', '#005500'],
  'spring-wind':    ['#eeffcc', '#ccffee', '#ffeeff', '#ffffcc'],
  'falling-petals': ['#ffbbcc', '#ff88aa', '#ffbbdd', '#ffffff'],
  firefly:          ['#ffff88', '#ffff44'],
  ocean:            ['#001133', '#002266', '#0044aa', '#0077cc', '#44aaff'],
  waterfall:        ['#0077bb', '#00aaee', '#55ccff', '#ffffff'],
  river:            ['#005566', '#007788', '#009999', '#44aaaa'],
  wave:             ['#001144', '#003388', '#0055aa', '#0088cc'],
  raining:          ['#3355aa', '#4466bb', '#6688cc'],
  snowing:          ['#bbccee', '#ddeeff', '#ffffff', '#aabbdd'],
  cloudy:           ['#667788', '#778899', '#99aabb'],
  'water-drop':     ['#0088cc', '#00aaee', '#55ccff'],
};

// Cycle speed (palette-steps / second) per effect — faster = more vivid churn
const SPEED = {
  fire: 2.2, strobe: 0, 'water-drop': 1.4, firefly: 3.0,
  'falling-leaves': 0.35, sunrise: 0.12, sunset: 0.12, 'sunset-glow': 0.5,
};
const DEFAULT_SPEED = 0.18;

// ── Colour helpers ────────────────────────────────────────────────────────────
function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lerpCh(a, b, t) { return Math.round(a + (b - a) * t); }

function gradColors(hexArr, t) {
  const n = hexArr.length;
  const s = (((t % n) + n) % n);
  const i = Math.floor(s) % n;
  const f = s - Math.floor(s);
  const [ar, ag, ab] = hexToRgb(hexArr[i]);
  const [br, bg, bb] = hexToRgb(hexArr[(i + 1) % n]);
  return [lerpCh(ar, br, f), lerpCh(ag, bg, f), lerpCh(ab, bb, f)];
}

function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))));
  };
  return [f(0), f(8), f(4)];
}

// ── State ─────────────────────────────────────────────────────────────────────
let _effect = 'solid';
let _color  = '#ff0080';
let _color2 = '#00e5ff';
let _time   = 0;
let _last   = null;

// Crossfade transition state
const FADE_DURATION = 0.72; // seconds
let _fadeFrom    = [255, 0, 128]; // last rendered RGB (snapshotted on change)
let _fadeElapsed = FADE_DURATION; // start as "complete" so boot is instant

function readStorage() {
  _effect = sessionStorage.getItem('gloEffect') || 'solid';
  _color  = sessionStorage.getItem('gloColor')  || '#ff0080';
  _color2 = sessionStorage.getItem('gloColor2') || '#00e5ff';
}

// ── Apply to DOM ──────────────────────────────────────────────────────────────
// Blends from _fadeFrom toward the live target (r,g,b) while fading, then
// tracks the rendered colour for the next transition snapshot.
function applyRgb(r, g, b) {
  let fr = r, fg = g, fb = b;
  if (_fadeElapsed < FADE_DURATION) {
    const t = 1 - Math.pow(1 - _fadeElapsed / FADE_DURATION, 3); // ease-out³
    fr = Math.round(_fadeFrom[0] + (r - _fadeFrom[0]) * t);
    fg = Math.round(_fadeFrom[1] + (g - _fadeFrom[1]) * t);
    fb = Math.round(_fadeFrom[2] + (b - _fadeFrom[2]) * t);
  } else {
    _fadeFrom = [r, g, b]; // keep current tracked so snapshot is always fresh
  }
  document.documentElement.style.setProperty('--glo-title-glow', `rgba(${fr},${fg},${fb},0.55)`);
  // Live-drive button background + glow to match the active GLO colour
  document.documentElement.style.setProperty('--glo-rgb', `${fr},${fg},${fb}`);
  const _dr = Math.round(fr * 0.55), _dg = Math.round(fg * 0.55), _db = Math.round(fb * 0.55);
  document.documentElement.style.setProperty('--glo-rgb-dark', `${_dr},${_dg},${_db}`);
  document.documentElement.style.setProperty(
    '--glo-accent-live',
    `rgb(${Math.round(fr * 0.28)},${Math.round(fg * 0.28)},${Math.round(fb * 0.28)})`
  );
  // Keep --accent / --accent-dark / --accent-glow in sync so every var(--accent)
  // reference in the CSS (mode icons, borders, etc.) tracks the GLO colour live.
  document.documentElement.style.setProperty('--accent',      `rgb(${fr},${fg},${fb})`);
  document.documentElement.style.setProperty('--accent-dark', `rgb(${_dr},${_dg},${_db})`);
  document.documentElement.style.setProperty('--accent-glow', `rgba(${fr},${fg},${fb},0.35)`);
}

// ── Per-frame tick ────────────────────────────────────────────────────────────
function tick(ts) {
  requestAnimationFrame(tick);
  const dt = _last === null ? 0 : Math.min((ts - _last) / 1000, 0.1);
  _last = ts;
  _time += dt;
  _fadeElapsed = Math.min(_fadeElapsed + dt, FADE_DURATION);

  // Rainbow / full-rainbow: HSL hue rotation
  if (_effect === 'rainbow' || _effect === 'full-rainbow') {
    const h = (_time * 50) % 360;
    applyRgb(...hslToRgb(h, 100, 68));
    return;
  }

  const pal = THEME_PAL[_effect];
  if (pal) {
    const speed = SPEED[_effect] ?? DEFAULT_SPEED;
    // firefly: random blink
    if (_effect === 'firefly') {
      const on = Math.random() > 0.04;
      on ? applyRgb(...gradColors(pal, _time * speed))
         : applyRgb(8, 8, 8);
      return;
    }
    applyRgb(...gradColors(pal, _time * speed));
    return;
  }

  // Classic user-colour effects
  switch (_effect) {
    case 'two-color': {
      applyRgb(...gradColors([_color, _color2], _time * 0.45));
      break;
    }
    case 'strobe': {
      const on = Math.sin(_time * 2 * Math.PI * 4) > 0;
      on ? applyRgb(...hexToRgb(_color)) : applyRgb(6, 6, 6);
      break;
    }
    case 'chase': {
      const p = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(_time * 2 * Math.PI * 1.2));
      const [r, g, b] = hexToRgb(_color);
      applyRgb(Math.round(r * p), Math.round(g * p), Math.round(b * p));
      break;
    }
    default:
      applyRgb(...hexToRgb(_color));
  }
}

// ── Snapshot current rendered colour to seed next crossfade ──────────────────
function snapshotCurrentRgb() {
  const val = getComputedStyle(document.documentElement)
    .getPropertyValue('--glo-title-glow').trim();
  // rgba(r,g,b,a) → extract r,g,b
  const m = val.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) _fadeFrom = [+m[1], +m[2], +m[3]];
}

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  readStorage();
  // Seed _fadeFrom so first frame has a valid source
  _fadeFrom = hexToRgb(_color);
  requestAnimationFrame(tick);

  document.addEventListener('gloChanged', () => {
    // Snapshot what's on screen right now as the crossfade start point
    snapshotCurrentRgb();
    _fadeElapsed = 0;  // restart the 0.72s blend
    readStorage();
  });
});
