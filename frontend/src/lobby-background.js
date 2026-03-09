/**
 * lobby-background.js — GLO-reactive ambient background (Canvas 2D edition)
 *
 * Six soft radial blobs on a plain Canvas 2D element — no WebGL, no Three.js.
 * Renders at ≤20 fps and pauses entirely when the tab is hidden.
 * GLO theme syncs from sessionStorage and re-syncs on the 'gloChanged' event.
 */

// ── Per-theme colour palettes ───────────────────────────────────────────────
const THEME_PALETTE = {
  sunrise:          ['#1a0030','#881100','#ff4400','#ff9900','#ffdd55'],
  sunset:           ['#ff5500','#ff2200','#cc0055','#880033','#440011'],
  'sunset-glow':    ['#ffaa00','#ff5500','#ff1166','#ff8800'],
  spring:           ['#ffaabb','#aaffbb','#ffffaa','#ccaaff'],
  aurora:           ['#00ff88','#00bbff','#8800ff','#00ff44','#00ffaa'],
  'full-rainbow':   null,                     // handled via HSL
  forest:           ['#003300','#116611','#335522','#005500'],
  ocean:            ['#001133','#002266','#0044aa','#0077cc','#44aaff'],
  snowing:          ['#bbccee','#ddeeff','#ffffff','#aabbdd'],
  'spring-wind':    ['#eeffcc','#ccffee','#ffeeff','#ffffcc'],
  cloudy:           ['#667788','#778899','#99aabb'],
  firefly:          ['#ffff88','#ffff44'],
  fire:             ['#ff0000','#ff4400','#ff8800','#ffcc00'],
  waterfall:        ['#0077bb','#00aaee','#55ccff','#ffffff'],
  'falling-petals': ['#ffbbcc','#ff88aa','#ffbbdd','#ffffff'],
  wave:             ['#001144','#003388','#0055aa','#0088cc'],
  raining:          ['#3355aa','#4466bb','#6688cc'],
  'falling-leaves': ['#aa3300','#dd6600','#cc8800','#772200'],
  river:            ['#005566','#007788','#009999','#44aaaa'],
  'water-drop':     ['#0088cc','#00aaee','#55ccff'],
};

const BLOB_COUNT = 6;

class LobbyBackground {
  constructor() {
    this._time     = 0;
    this._lastDraw = 0;
    this._hidden   = document.hidden;
    this._syncEffect();
    this._init();

    document.addEventListener('gloChanged', () => {
      this._syncEffect();
      this._buildBlobs();
    });
    document.addEventListener('visibilitychange', () => {
      this._hidden = document.hidden;
    });
  }

  _syncEffect() {
    this._effect = sessionStorage.getItem('gloEffect') || 'falling-petals';
    this._color  = sessionStorage.getItem('gloColor')  || '#ff0080';
    this._color2 = sessionStorage.getItem('gloColor2') || '#00e5ff';
  }

  _getPalette() {
    const fixed = THEME_PALETTE[this._effect];
    if (fixed) return fixed;
    if (this._effect === 'two-color') return [this._color, this._color2];
    return [this._color];
  }

  _hexToRgb(hex) {
    if (!hex || hex.length < 7) return [128, 0, 128];
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
  }

  _resolveRGBA(pidx, t, alpha) {
    if (this._effect === 'rainbow' || this._effect === 'full-rainbow') {
      const hue = (((t * 0.12 + pidx * 0.05) % 1) + 1) % 1 * 360;
      return `hsla(${hue.toFixed(1)},100%,55%,${alpha})`;
    }
    const pal = this._getPalette();
    const nv  = (((t * 0.07 + pidx * 0.019) % 1) + 1) % 1 * pal.length;
    const i   = Math.floor(nv) % pal.length;
    const f   = nv - Math.floor(nv);
    const a   = this._hexToRgb(pal[i]);
    const b   = this._hexToRgb(pal[(i + 1) % pal.length]);
    return `rgba(${Math.round(a[0]+(b[0]-a[0])*f)},${Math.round(a[1]+(b[1]-a[1])*f)},${Math.round(a[2]+(b[2]-a[2])*f)},${alpha})`;
  }

  _init() {
    this._canvas = document.createElement('canvas');
    this._canvas.id = 'background-canvas';
    Object.assign(this._canvas.style, {
      position: 'fixed', top: '0', left: '0',
      width: '100%', height: '100%',
      zIndex: '-1', pointerEvents: 'none',
    });
    document.body.insertBefore(this._canvas, document.body.firstChild);
    this._ctx = this._canvas.getContext('2d');
    this._resize();
    window.addEventListener('resize', () => this._resize());
    this._buildBlobs();
    this._tick();
    // Dismiss loading screen (no assets to wait for)
    setTimeout(() => {
      const ls = document.getElementById('loading-screen');
      if (ls) { ls.style.opacity = '0'; setTimeout(() => { ls.style.display = 'none'; }, 500); }
    }, 300);
  }

  _resize() {
    // Render at CSS pixels to minimise GPU fill cost on HiDPI screens
    this._w = this._canvas.width  = window.innerWidth;
    this._h = this._canvas.height = window.innerHeight;
    if (this._blobs) this._buildBlobs();
  }

  _buildBlobs() {
    const w = this._w || window.innerWidth;
    const h = this._h || window.innerHeight;
    const r = Math.min(w, h);
    this._blobs = Array.from({ length: BLOB_COUNT }, (_, i) => ({
      bx:    w * (0.1 + (i / BLOB_COUNT) * 0.8),
      by:    h * (0.15 + Math.random() * 0.7),
      r:     r * (0.22 + Math.random() * 0.28),
      phase: i * 1.047 + Math.random() * 0.5,
      spd:   0.055 + Math.random() * 0.065,
      ox:    w * 0.09,
      oy:    h * 0.10,
    }));
  }

  _tick() {
    requestAnimationFrame(() => this._tick());
    if (this._hidden) return;
    const now = performance.now();
    if (now - this._lastDraw < 50) return; // ≤20 fps
    this._lastDraw = now;
    this._time += 0.05;
    this._draw();
  }

  _draw() {
    const ctx = this._ctx;
    const w   = this._w;
    const h   = this._h;
    const t   = this._time;
    // Dark base
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#06060f';
    ctx.fillRect(0, 0, w, h);
    // Additive colour blobs
    ctx.globalCompositeOperation = 'lighter';
    this._blobs.forEach((b, i) => {
      const sl  = t * b.spd + b.phase;
      const cx  = b.bx + Math.sin(sl * 0.6)  * b.ox;
      const cy  = b.by + Math.cos(sl * 0.45) * b.oy;
      const col = this._resolveRGBA(i, t, 0.10);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, b.r);
      grad.addColorStop(0, col);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, b.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalCompositeOperation = 'source-over';
  }
}

export default LobbyBackground;