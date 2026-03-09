/**
 * lobby-scaler.js — Dynamic viewport-aware UI scaling + widescreen lockout.
 *
 * Replaces the static `zoom: 0.828` with a computed `--ui-zoom` CSS variable
 * that adapts to the current viewport dimensions, keeping the 3-panel lobby
 * layout correctly proportioned at any window size.
 *
 * Also detects extreme aspect ratios where the menu becomes unusable and
 * shows a lockout overlay asking the user to resize.
 */

// Reference unzoomed design dimensions (original design at zoom 0.828 on 1440×900)
const REF_W = 1740;
const REF_H = 1050;
const MIN_ZOOM = 0.55;
const MAX_ZOOM = 1.0;

// Narrow breakpoint — below this, CSS media queries take over and zoom resets to 1
const NARROW_BP = 1000;

// Widescreen lockout thresholds
const MAX_ASPECT = 2.8;   // wider than ~25:9 locks out
const MIN_HEIGHT = 460;   // landscape windows shorter than this lock out

let lockoutEl = null;

function getLockoutOverlay() {
  if (!lockoutEl) {
    lockoutEl = document.getElementById('widescreen-lockout');
  }
  return lockoutEl;
}

function update() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const aspect = vw / vh;
  const isPortrait = vh > vw;

  // ── Widescreen lockout ──
  const overlay = getLockoutOverlay();
  const tooWide = !isPortrait && aspect > MAX_ASPECT;
  const tooShort = !isPortrait && vh < MIN_HEIGHT && vw > 600;
  if (overlay) {
    overlay.classList.toggle('active', tooWide || tooShort);
  }

  // ── Dynamic zoom ──
  const isNarrow = vw <= NARROW_BP || (vw <= 900 && isPortrait);
  let zoom;
  if (isNarrow) {
    // Media queries handle layout at narrow/portrait — no zoom needed
    zoom = 1;
  } else {
    const zw = vw / REF_W;
    const zh = vh / REF_H;
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(zw, zh)));
  }
  document.documentElement.style.setProperty('--ui-zoom', zoom.toFixed(4));
}

// Run immediately + on every resize
update();
window.addEventListener('resize', update);
