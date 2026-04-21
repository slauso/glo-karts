/**
 * glo-flux-menu.js — "3rd Rail" menu system for gloFLUX mode.
 *
 * Creates a self-contained wasteland-themed menu overlay:
 *   - Mode select (Race Flux / Arena Flux)
 *   - Kart mutation preview
 *   - Arena threat-level selection
 *   - Loading screen with lore ticker
 *   - Settings panel
 *
 * This is NOT the standard lobby — gloFLUX owns its own entry flow.
 */

import { FAMILY, FAMILY_META } from './glo-flux-powers.js';
import { navigateWithTransition } from '../../ui/page-transition.js';

// ── Menu State Machine ──────────────────────────────────────────────────────

export const MENU_SCREEN = Object.freeze({
  SPLASH:      'splash',
  MODE_SELECT: 'mode_select',
  ARENA_PICK:  'arena_pick',
  LOADOUT:     'loadout',
  LOADING:     'loading',
  HIDDEN:      'hidden',
});

const LORE_LINES = [
  'The fallout rewrote everything. Even the karts remember.',
  'Radiation doesn\'t kill anymore — it creates.',
  'Symbiotic engines hum with borrowed life.',
  'Every lap is an evolution. Every crash is a mutation.',
  'The wasteland chooses its champions.',
  'Surge levels critical. Apocalypse imminent.',
  'Bio-fractal growths detected on chassis 7.',
  'Echo phantoms multiply in sector 12.',
  'Entropic void expanding — track integrity declining.',
  'The fungal wastes spread beneath the asphalt.',
];

const ARENA_PRESETS = [
  { id: 'nuclear_desert',  label: 'Nuclear Desert',  threat: 3, desc: 'Scorched plains and irradiated dunes.' },
  { id: 'fungal_wastes',   label: 'Fungal Wastes',   threat: 4, desc: 'Living fungal networks reclaim the highways.' },
  { id: 'frozen_fallout',  label: 'Frozen Fallout',   threat: 2, desc: 'Sub-zero wastelands blanketed in radioactive snow.' },
  { id: 'molten_ruins',    label: 'Molten Ruins',     threat: 5, desc: 'Collapsed reactors feeding rivers of magma.' },
  { id: 'void_rift',       label: 'Void Rift',        threat: 5, desc: 'Reality tears where the boundary collapsed.' },
  { id: 'coral_overgrowth',label: 'Coral Overgrowth', threat: 3, desc: 'Mutated reefs engulf the ruins. Spore visibility low.' },
  { id: 'random',          label: '??? RANDOM ???',    threat: 0, desc: 'Let the wasteland decide.' },
];

// ── Create Menu State ───────────────────────────────────────────────────────

export function createMenuState() {
  return {
    screen: MENU_SCREEN.SPLASH,
    selectedVariant: 'arena',       // 'race' | 'arena'
    selectedArena: 'random',
    selectedKart: null,             // filled from session
    botCount: 5,
    maxPlayers: 8,
    loreIndex: 0,
    loadingProgress: 0,
    overlayEl: null,
    disposed: false,
  };
}

// ── DOM Construction ────────────────────────────────────────────────────────

/**
 * Build and mount the gloFLUX menu overlay.
 * @param {object} state
 * @param {Function} onStart - Called with final config when player hits ENTER THE FLUX
 * @returns {HTMLElement}
 */
export function mountMenu(state, onStart) {
  if (state.overlayEl) return state.overlayEl;

  const overlay = document.createElement('div');
  overlay.id = 'gloflux-menu';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:9999;
    background:linear-gradient(135deg,#0a0a0a 0%,#1a0a1a 50%,#0a1a0a 100%);
    color:#c8ffb0;font-family:'Courier New',monospace;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    overflow:hidden;
  `;
  state.overlayEl = overlay;
  document.body.appendChild(overlay);

  // Radiation particle CSS animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes gf-pulse { 0%,100%{opacity:0.3;transform:scale(1)} 50%{opacity:1;transform:scale(1.05)} }
    @keyframes gf-scan  { 0%{top:-2px} 100%{top:100%} }
    @keyframes gf-flicker { 0%,100%{opacity:1} 50%{opacity:0.7} }
    #gloflux-menu h1 { font-size:3rem;text-shadow:0 0 20px #4f4,0 0 40px #0f0;animation:gf-pulse 2s infinite;margin:0 0 10px; }
    #gloflux-menu h2 { font-size:1.2rem;color:#8f8;margin:5px 0; }
    #gloflux-menu .gf-btn {
      display:block;margin:8px auto;padding:12px 32px;
      background:rgba(0,255,0,0.08);border:1px solid #4f4;color:#8f8;
      font-family:inherit;font-size:1rem;cursor:pointer;
      transition:all 0.2s;text-transform:uppercase;
    }
    #gloflux-menu .gf-btn:hover { background:rgba(0,255,0,0.2);border-color:#0f0;color:#fff;text-shadow:0 0 8px #0f0; }
    #gloflux-menu .gf-btn.primary { border-color:#ff0;color:#ff0; }
    #gloflux-menu .gf-btn.primary:hover { background:rgba(255,255,0,0.2);text-shadow:0 0 10px #ff0; }
    #gloflux-menu .gf-card {
      background:rgba(0,0,0,0.5);border:1px solid #333;padding:12px 18px;
      margin:6px;cursor:pointer;transition:all 0.2s;text-align:center;
    }
    #gloflux-menu .gf-card:hover { border-color:#4f4;background:rgba(0,60,0,0.3); }
    #gloflux-menu .gf-card.selected { border-color:#0f0;background:rgba(0,80,0,0.4);box-shadow:0 0 12px rgba(0,255,0,0.3); }
    #gloflux-menu .gf-lore { color:#6a6;font-size:0.8rem;font-style:italic;animation:gf-flicker 3s infinite; }
    #gloflux-menu .gf-scanline {
      position:absolute;left:0;width:100%;height:2px;
      background:rgba(0,255,0,0.1);pointer-events:none;animation:gf-scan 4s linear infinite;
    }
    #gloflux-menu .gf-threat { display:inline-block;color:#f80;margin:0 1px; }
  `;
  overlay.appendChild(style);

  // Scanline effect
  const scanline = document.createElement('div');
  scanline.className = 'gf-scanline';
  overlay.appendChild(scanline);

  renderScreen(state, onStart);
  return overlay;
}

// ── Screen Rendering ────────────────────────────────────────────────────────

function renderScreen(state, onStart) {
  if (!state.overlayEl || state.disposed) return;

  // Clear content (keep style + scanline)
  const children = state.overlayEl.children;
  for (let i = children.length - 1; i >= 0; i--) {
    const c = children[i];
    if (c.tagName !== 'STYLE' && !c.classList.contains('gf-scanline')) {
      state.overlayEl.removeChild(c);
    }
  }

  const content = document.createElement('div');
  content.style.cssText = 'position:relative;z-index:1;text-align:center;max-width:600px;width:90%;';
  state.overlayEl.appendChild(content);

  switch (state.screen) {
    case MENU_SCREEN.SPLASH:
      renderSplash(content, state, onStart);
      break;
    case MENU_SCREEN.MODE_SELECT:
      renderModeSelect(content, state, onStart);
      break;
    case MENU_SCREEN.ARENA_PICK:
      renderArenaPick(content, state, onStart);
      break;
    case MENU_SCREEN.LOADING:
      renderLoading(content, state);
      break;
    default:
      break;
  }
}

function renderSplash(el, state, onStart) {
  el.innerHTML = `
    <h1>gloFLUX</h1>
    <h2>SYMBIOTIC KART WARFARE</h2>
    <p class="gf-lore">${LORE_LINES[state.loreIndex % LORE_LINES.length]}</p>
    <br>
    <button class="gf-btn primary" id="gf-enter">ENTER THE WASTELAND</button>
    <button class="gf-btn" id="gf-back">← BACK TO LOBBY</button>
  `;
  el.querySelector('#gf-enter').addEventListener('click', () => {
    state.screen = MENU_SCREEN.MODE_SELECT;
    renderScreen(state, onStart);
  });
  el.querySelector('#gf-back').addEventListener('click', () => {
    void navigateWithTransition('index.html');
  });
}

function renderModeSelect(el, state, onStart) {
  el.innerHTML = `
    <h1>gloFLUX</h1>
    <h2>CHOOSE YOUR FATE</h2>
    <div style="display:flex;gap:12px;justify-content:center;margin:20px 0;">
      <div class="gf-card ${state.selectedVariant === 'race' ? 'selected' : ''}" data-v="race">
        <div style="font-size:2rem;">🏁</div>
        <div style="font-weight:bold;">FLUX RACE</div>
        <div style="font-size:0.75rem;color:#888;">5 laps through mutating wasteland circuits</div>
      </div>
      <div class="gf-card ${state.selectedVariant === 'arena' ? 'selected' : ''}" data-v="arena">
        <div style="font-size:2rem;">💀</div>
        <div style="font-weight:bold;">FLUX ARENA</div>
        <div style="font-size:0.75rem;color:#888;">Last kart standing in a shrinking wasteland</div>
      </div>
    </div>
    <button class="gf-btn primary" id="gf-next">CHOOSE ARENA →</button>
    <button class="gf-btn" id="gf-back2">← BACK</button>
  `;

  el.querySelectorAll('.gf-card').forEach(card => {
    card.addEventListener('click', () => {
      state.selectedVariant = card.dataset.v;
      renderScreen(state, onStart);
    });
  });
  el.querySelector('#gf-next').addEventListener('click', () => {
    state.screen = MENU_SCREEN.ARENA_PICK;
    renderScreen(state, onStart);
  });
  el.querySelector('#gf-back2').addEventListener('click', () => {
    state.screen = MENU_SCREEN.SPLASH;
    renderScreen(state, onStart);
  });
}

function renderArenaPick(el, state, onStart) {
  const cards = ARENA_PRESETS.map(a => {
    const sel = a.id === state.selectedArena ? 'selected' : '';
    const threat = a.threat > 0
      ? Array.from({ length: a.threat }, () => '<span class="gf-threat">☢</span>').join('')
      : '<span class="gf-threat">?</span>';
    return `
      <div class="gf-card ${sel}" data-arena="${a.id}">
        <div style="font-weight:bold;">${a.label}</div>
        <div style="font-size:0.75rem;color:#888;margin:4px 0;">${a.desc}</div>
        <div>${threat}</div>
      </div>
    `;
  }).join('');

  el.innerHTML = `
    <h1>gloFLUX</h1>
    <h2>SELECT WASTELAND</h2>
    <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:16px 0;">
      ${cards}
    </div>
    <div style="margin:12px 0;">
      <label style="color:#888;font-size:0.8rem;">BOTS: </label>
      <input type="range" id="gf-bots" min="0" max="11" value="${state.botCount}" style="width:100px;vertical-align:middle;">
      <span id="gf-bots-val" style="color:#4f4;">${state.botCount}</span>
    </div>
    <button class="gf-btn primary" id="gf-launch">⚡ ENTER THE FLUX ⚡</button>
    <button class="gf-btn" id="gf-back3">← BACK</button>
  `;

  el.querySelectorAll('.gf-card').forEach(card => {
    card.addEventListener('click', () => {
      state.selectedArena = card.dataset.arena;
      renderScreen(state, onStart);
    });
  });

  el.querySelector('#gf-bots').addEventListener('input', (e) => {
    state.botCount = parseInt(e.target.value, 10);
    el.querySelector('#gf-bots-val').textContent = state.botCount;
  });

  el.querySelector('#gf-launch').addEventListener('click', () => {
    state.screen = MENU_SCREEN.LOADING;
    renderScreen(state, onStart);

    // Start loading, then call back
    setTimeout(() => {
      onStart(buildGloFluxConfig(state));
    }, 1500);
  });

  el.querySelector('#gf-back3').addEventListener('click', () => {
    state.screen = MENU_SCREEN.MODE_SELECT;
    renderScreen(state, onStart);
  });
}

function renderLoading(el, state) {
  state.loreIndex = (state.loreIndex + 1) % LORE_LINES.length;

  el.innerHTML = `
    <h1>gloFLUX</h1>
    <h2>INITIALIZING WASTELAND...</h2>
    <div style="width:100%;height:6px;background:#111;border:1px solid #333;margin:20px 0;">
      <div id="gf-load-bar" style="height:100%;width:0%;background:#0f0;transition:width 1.2s;"></div>
    </div>
    <p class="gf-lore">${LORE_LINES[state.loreIndex]}</p>
  `;

  // Animate loading bar
  requestAnimationFrame(() => {
    const bar = el.querySelector('#gf-load-bar');
    if (bar) bar.style.width = '100%';
  });
}

// ── Config Builder ──────────────────────────────────────────────────────────

function buildGloFluxConfig(state) {
  const arenaId = state.selectedArena === 'random'
    ? ARENA_PRESETS[Math.floor(Math.random() * (ARENA_PRESETS.length - 1))].id
    : state.selectedArena;

  return {
    gameMode: 'gloflux',
    subMode: state.selectedVariant === 'race' ? 'gloflux_race' : 'gloflux_arena',
    variant: state.selectedVariant,
    arenaTheme: arenaId,
    botCount: state.botCount,
    maxPlayers: state.maxPlayers,
    selectedKart: state.selectedKart || sessionStorage.getItem('selectedKart') || 'tux',
    multiplayer: true,
  };
}

// ── Visibility ──────────────────────────────────────────────────────────────

export function showMenu(state) {
  state.screen = MENU_SCREEN.SPLASH;
  if (state.overlayEl) state.overlayEl.style.display = 'flex';
}

export function hideMenu(state) {
  state.screen = MENU_SCREEN.HIDDEN;
  if (state.overlayEl) state.overlayEl.style.display = 'none';
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

export function disposeMenu(state) {
  state.disposed = true;
  if (state.overlayEl && state.overlayEl.parentNode) {
    state.overlayEl.parentNode.removeChild(state.overlayEl);
  }
  state.overlayEl = null;
}
