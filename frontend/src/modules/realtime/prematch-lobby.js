/**
 * prematch-lobby.js — Lightweight DOM-only prematch lobby overlay.
 *
 * Shows a "liquid glass" styled waiting screen with:
 *   - Simple 2D player cards (name + kart label + GLO colour swatch)
 *   - Map info panel (text only, no 3D preview)
 *   - Game mode / settings display
 *   - Countdown → fluid transition to gameplay
 *
 * Zero Babylon.js dependencies — no Engine, Scene, or Canvas rendering.
 * This guarantees no GPU contention with the main game engine during init.
 *
 * API:  show(roomState, localSessionId, joinOptions)
 *       updatePlayers(roomState, localSessionId)
 *       startCountdown(seconds)
 *       hide()
 *       isVisible()
 */

import { resolveKartAsset } from '../content-registry.js';

// Three.js loaded lazily to avoid bundling 500+ kB into the realtime entry
let THREE = null;
let GLTFLoader = null;
let _threeLoadPromise = null;
async function _loadThree() {
  if (THREE && GLTFLoader) return;
  if (_threeLoadPromise) {
    await _threeLoadPromise;
    return;
  }

  _threeLoadPromise = (async () => {
    const [threeModule, loaders] = await Promise.all([
      import('three'),
      import('three/examples/jsm/loaders/GLTFLoader.js'),
    ]);
    THREE = threeModule;
    GLTFLoader = loaders.GLTFLoader;
  })();

  try {
    await _threeLoadPromise;
  } finally {
    _threeLoadPromise = null;
  }
}

// ── Module state ────────────────────────────────────────────────────────────

let _overlay = null;
let _countdownInterval = null;
let _disposed = false;

// Shared Three.js renderer for all kart previews (single WebGL context)
let _threeRenderer = null;
let _kartPreviews = new Map(); // sessionId → { scene, camera, canvas, rafId }
let _threeRafId = null;
let _lastRenderTime = 0;
const PREVIEW_FPS = 20;
const CARD_CANVAS_W = 140;
const CARD_CANVAS_H = 100;

// ── Helpers ─────────────────────────────────────────────────────────────────

function _getEl(id) { return document.getElementById(id); }

/** Validate hex colour to prevent CSS injection. */
function _safeColor(hex, fallback = '#ff0080') {
  return /^#[0-9a-f]{3,8}$/i.test(hex) ? hex : fallback;
}

const GLO_LABELS = {
  solid: 'Solid', pulse: 'Pulse', rainbow: 'Rainbow', fire: 'Fire',
  ice: 'Ice', electric: 'Electric', neon: 'Neon', plasma: 'Plasma',
  galaxy: 'Galaxy', toxic: 'Toxic', lava: 'Lava', ocean: 'Ocean',
  aurora: 'Aurora', sunset: 'Sunset', hologram: 'Hologram',
  glitch: 'Glitch', vapor: 'Vapor', candy: 'Candy', shadow: 'Shadow',
  gold: 'Gold', chrome: 'Chrome',
};

// ── Three.js kart preview ───────────────────────────────────────────────────

function _ensureRenderer() {
  if (_threeRenderer || !THREE) return;
  const c = document.createElement('canvas');
  c.width = CARD_CANVAS_W;
  c.height = CARD_CANVAS_H;
  c.style.display = 'none';
  document.body.appendChild(c);
  _threeRenderer = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true });
  _threeRenderer.setPixelRatio(1);
  _threeRenderer.setSize(CARD_CANVAS_W, CARD_CANVAS_H);
  _threeRenderer.outputColorSpace = THREE.SRGBColorSpace;
  _threeRenderer.setClearColor(0x000000, 0);
}

function _createKartPreview(sessionId, kartId, gloColor) {
  // Create the output canvas immediately (synchronous) for DOM insertion
  const canvas = document.createElement('canvas');
  canvas.className = 'pm-kart-canvas';
  canvas.width = CARD_CANVAS_W;
  canvas.height = CARD_CANVAS_H;
  const ctx = canvas.getContext('2d');

  // Load Three.js and build the scene asynchronously
  _loadThree().then(() => {
    if (_disposed) return;
    _ensureRenderer();
    if (!_threeRenderer) return;

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    const sun = new THREE.DirectionalLight(0xfff5e0, 1.8);
    sun.position.set(3, 6, 4);
    scene.add(sun);

    const safeGlo = _safeColor(gloColor);
    const gloLight = new THREE.PointLight(new THREE.Color(safeGlo), 3, 8);
    gloLight.position.set(0, -0.5, 0);
    scene.add(gloLight);

    const camera = new THREE.PerspectiveCamera(28, CARD_CANVAS_W / CARD_CANVAS_H, 0.1, 50);
    camera.position.set(3.5, 2.0, 3.5);
    camera.lookAt(0, 0.2, 0);

    const kartInfo = resolveKartAsset(kartId);
    const loader = new GLTFLoader();
    loader.load(kartInfo.modelPath, (gltf) => {
      if (_disposed) return;
      const model = gltf.scene;
      model.traverse(child => {
        if (child.isMesh && child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach(m => { if (m.map) m.map.colorSpace = THREE.SRGBColorSpace; });
        }
      });
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      model.scale.setScalar(2 / maxDim);
      const center = box.getCenter(new THREE.Vector3()).multiplyScalar(2 / maxDim);
      model.position.set(-center.x, -center.y + 0.15, -center.z);
      scene.add(model);
    }, undefined, (err) => {
      console.warn('[prematch] Kart preview failed:', kartId, err);
    });

    _kartPreviews.set(sessionId, { scene, camera, canvas, ctx, rotation: 0 });

    if (!_threeRafId) {
      _lastRenderTime = performance.now();
      _threeRafId = requestAnimationFrame(_renderLoop);
    }
  });

  return canvas;
}

function _renderLoop(now) {
  if (_disposed || !_threeRenderer || !THREE) return;
  _threeRafId = requestAnimationFrame(_renderLoop);

  const elapsed = now - _lastRenderTime;
  if (elapsed < 1000 / PREVIEW_FPS) return;
  _lastRenderTime = now;

  for (const [, preview] of _kartPreviews) {
    // Rotate camera orbit
    preview.rotation += 0.015;
    preview.camera.position.x = 3.5 * Math.cos(preview.rotation);
    preview.camera.position.z = 3.5 * Math.sin(preview.rotation);
    preview.camera.lookAt(0, 0.2, 0);

    _threeRenderer.render(preview.scene, preview.camera);
    preview.ctx.clearRect(0, 0, CARD_CANVAS_W, CARD_CANVAS_H);
    preview.ctx.drawImage(_threeRenderer.domElement, 0, 0, CARD_CANVAS_W, CARD_CANVAS_H);
  }
}

function _disposePreview(sessionId) {
  const preview = _kartPreviews.get(sessionId);
  if (!preview) return;
  preview.scene.traverse(child => {
    if (child.isMesh) {
      child.geometry?.dispose();
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach(m => { m?.map?.dispose(); m?.dispose(); });
    }
  });
  _kartPreviews.delete(sessionId);
}

function _disposeAllPreviews() {
  if (_threeRafId) { cancelAnimationFrame(_threeRafId); _threeRafId = null; }
  for (const [id] of _kartPreviews) _disposePreview(id);
  if (_threeRenderer) {
    _threeRenderer.dispose();
    _threeRenderer.domElement.remove();
    _threeRenderer = null;
  }
}

// ── Player card creation ────────────────────────────────────────────────────

function _createPlayerCard(sessionId, playerData, isLocal) {
  const card = document.createElement('div');
  card.className = 'pm-player-card' + (isLocal ? ' is-local' : '');
  card.dataset.sessionId = sessionId;

  const color1 = _safeColor(playerData.gloColor);
  const color2 = _safeColor(playerData.gloColor2, '#00e5ff');
  const kartId = playerData.kartId || playerData.playerKart || 'tux';

  // GLO colour swatch (gradient bar)
  const swatch = document.createElement('div');
  swatch.className = 'pm-glo-swatch';
  swatch.style.background = `linear-gradient(135deg, ${color1}, ${color2})`;
  card.appendChild(swatch);

  // 3D kart model preview canvas
  const kartCanvas = _createKartPreview(sessionId, kartId, playerData.gloColor);
  card.appendChild(kartCanvas);

  // Player name (from actual player state, NOT kart registry)
  const nameEl = document.createElement('div');
  nameEl.className = 'pm-player-name';
  nameEl.textContent = playerData.name || 'Player';
  card.appendChild(nameEl);

  return card;
}

// ── Settings pills ──────────────────────────────────────────────────────────

function _renderSettings(joinOptions) {
  const container = _getEl('pm-settings');
  if (!container) return;
  container.innerHTML = '';

  const pills = [];
  if (joinOptions.gameMode === 'battle') {
    pills.push(joinOptions.gameType === 'ctf' ? 'CTF' : 'DEATHMATCH');
    pills.push(`SCORE: ${joinOptions.scoreLimit || 5}`);
  } else {
    pills.push('3 LAPS');
  }
  pills.push(`MAX ${joinOptions.maxPlayers || 12} PLAYERS`);

  pills.forEach((text) => {
    const pill = document.createElement('span');
    pill.className = 'pm-setting-pill';
    pill.textContent = text;
    container.appendChild(pill);
  });
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Show the prematch lobby overlay.
 */
export function show(roomState, localSessionId, joinOptions = {}) {
  _disposed = false;
  _overlay = _getEl('prematch-lobby');
  if (!_overlay) return;

  const isBattle = joinOptions.gameMode === 'battle';

  // Mode label
  const modeLabel = _getEl('pm-mode-label');
  if (modeLabel) modeLabel.textContent = isBattle ? 'BATTLE' : 'RACE';

  // Map info (text only)
  const trackId = joinOptions.trackId || joinOptions.arenaId || 'test_box';
  const mapName = _getEl('pm-map-name');
  if (mapName) mapName.textContent = trackId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  const modeTag = _getEl('pm-map-mode-tag');
  if (modeTag) {
    modeTag.textContent = isBattle
      ? (joinOptions.gameType === 'ctf' ? 'CAPTURE THE FLAG' : 'DEATHMATCH')
      : 'RACE';
  }

  // Hide the 3D map canvas — no GPU work
  const mapCanvas = _getEl('pm-map-canvas');
  if (mapCanvas) mapCanvas.style.display = 'none';

  _renderSettings(joinOptions);

  // Clear & populate player grid
  const grid = _getEl('pm-players-grid');
  if (grid) grid.innerHTML = '';

  if (roomState?.players) {
    roomState.players.forEach((player, id) => {
      const card = _createPlayerCard(id, player, id === localSessionId);
      grid?.appendChild(card);
    });
  }

  // Show overlay
  _overlay.style.display = 'flex';
  requestAnimationFrame(() => _overlay.classList.add('visible'));

  // Reset countdown
  const countdownEl = _getEl('pm-countdown');
  if (countdownEl) {
    countdownEl.textContent = '\u2014'; // —
    countdownEl.style.color = '';
    countdownEl.style.textShadow = '';
  }
}

/**
 * Update the player grid when players join/leave.
 */
export function updatePlayers(roomState, localSessionId) {
  if (_disposed) return;
  const grid = _getEl('pm-players-grid');
  if (!grid || !roomState?.players) return;

  const connectedIds = new Set();

  roomState.players.forEach((player, id) => {
    connectedIds.add(id);
    const existing = grid.querySelector(`[data-session-id="${CSS.escape(id)}"]`);
    if (!existing) {
      const card = _createPlayerCard(id, player, id === localSessionId);
      grid.appendChild(card);
    } else {
      // Update name
      const nameEl = existing.querySelector('.pm-player-name');
      if (nameEl) nameEl.textContent = player.name || 'Player';
      // Update swatch
      const swatch = existing.querySelector('.pm-glo-swatch');
      if (swatch) {
        const c1 = _safeColor(player.gloColor);
        const c2 = _safeColor(player.gloColor2, '#00e5ff');
        swatch.style.background = `linear-gradient(135deg, ${c1}, ${c2})`;
      }
    }
  });

  // Remove disconnected players
  for (const card of [...grid.children]) {
    const sid = card.dataset.sessionId;
    if (sid && !connectedIds.has(sid)) {
      card.remove();
      _disposePreview(sid);
    }
  }
}

/**
 * Begin the visual countdown from `seconds` → 0, then auto-hide.
 */
export function startCountdown(seconds = 10) {
  if (_disposed) return;
  const el = _getEl('pm-countdown');
  if (!el) return;

  let remaining = seconds;
  el.textContent = String(remaining);
  el.classList.add('pulse');

  if (_countdownInterval) clearInterval(_countdownInterval);

  _countdownInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(_countdownInterval);
      _countdownInterval = null;
      el.textContent = 'GO!';
      el.style.color = '#00ff88';
      el.style.textShadow = '0 0 60px rgba(0,255,128,0.7), 0 4px 20px rgba(0,0,0,0.5)';
      el.classList.add('pulse');
      // Do NOT auto-hide here — lobby stays opaque until matchLive fires
      return;
    }
    el.textContent = String(remaining);
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('pulse');
    if (remaining <= 3) {
      el.style.color = '#ff4040';
      el.style.textShadow = '0 0 40px rgba(255,64,64,0.7), 0 4px 20px rgba(0,0,0,0.5)';
    }
  }, 1000);
}

export function cancelCountdown(label = 'WAITING') {
  if (_disposed) return;
  const el = _getEl('pm-countdown');
  if (!el) return;

  if (_countdownInterval) {
    clearInterval(_countdownInterval);
    _countdownInterval = null;
  }

  el.textContent = label;
  el.style.color = '';
  el.style.textShadow = '';
  el.classList.remove('pulse');
}

/**
 * Fade out and clean up.
 */
export function hide() {
  if (!_overlay) return;
  _overlay.classList.add('fade-out');
  setTimeout(() => {
    _overlay.classList.remove('visible', 'fade-out');
    _overlay.style.display = 'none';
    _dispose();
  }, 700);
}

function _dispose() {
  _disposed = true;
  if (_countdownInterval) { clearInterval(_countdownInterval); _countdownInterval = null; }
  _disposeAllPreviews();
}

/**
 * Quick check: is the prematch lobby currently visible?
 */
export function isVisible() {
  return _overlay?.classList.contains('visible') && !_disposed;
}
