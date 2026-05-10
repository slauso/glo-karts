// GLO KARTS — Track / Arena Carousel (lobby-track-preview.js)
// Navigation + thumbnail preview display.

import { ALL_TRACKS, ALL_ARENAS } from './modules/content-registry.js';
import { getStudioTrackCache, loadStudioTracks, LOCAL_DRAFT_TRACK_ID, readLocalDraftTrack } from './lobby/constants.js';

// ── Rosters (derived from content-registry) ─────────────────────────────────

const STK_TRACKS = Object.values(ALL_TRACKS).map(t => ({ id: t.id, name: t.label }));
const STK_ARENAS = Object.values(ALL_ARENAS).map(a => ({ id: a.id, name: a.label }));

// Phase 2.5: Studio carousel list (Online Arena). Pulled from the same
// loadStudioTracks() cache the lobby dropdown uses, with the host's local
// browser draft prepended when present.
function getStudioList() {
  const out = [];
  const draft = readLocalDraftTrack();
  if (draft) out.push({ id: LOCAL_DRAFT_TRACK_ID, name: `${draft.name} (browser draft)` });
  for (const t of getStudioTrackCache()) {
    const suffix = t.source === 'mine' ? '  ·  yours'
      : (t.source === 'community' ? '  ·  community' : '');
    out.push({ id: t.id, name: `${t.name}${suffix}` });
  }
  return out.length ? out : [{ id: '__loading__', name: 'Loading Studio tracks…' }];
}

function getList(mode) {
  if (mode === 'studio') return getStudioList();
  return mode === 'battle' ? STK_ARENAS : STK_TRACKS;
}

// ── TrackPreview class ──────────────────────────────────────────────────────

class TrackPreview {
  constructor() {
    this.container = document.getElementById('track-preview-container');
    if (!this.container) return;

    this.mode         = 'race';
    this.currentIndex = 0;

    this._setupNavButtons();
    this._updateInfo();
    this._listenForModeChanges();
  }

  // ── Thumbnail display ──────────────────────────────────────────────────────

  _getThumbPath(item) {
    const prefix = this.mode === 'battle' ? 'battle' : 'race';
    return `/thumbs/${prefix}-${item.id}.jpg`;
  }

  _updateThumb() {
    const img = document.getElementById('track-preview-thumb');
    if (!img) return;
    const item = this._currentItem();
    const src  = this._getThumbPath(item);

    // Remove any previous procedural canvas
    const oldCanvas = this.container?.querySelector('.track-preview-canvas');
    if (oldCanvas) oldCanvas.remove();

    // Try loading the thumbnail image; fall back to procedural preview on error
    img.onerror = () => {
      img.style.opacity = '0';
      this._drawProceduralPreview(item);
    };
    img.onload = () => {
      img.style.opacity = '1';
    };
    img.src = src;
    img.alt = item.name;
  }

  /** Draw a simple procedural top-down arena preview when no thumbnail exists */
  _drawProceduralPreview(item) {
    if (!this.container) return;
    // Avoid duplicates
    if (this.container.querySelector('.track-preview-canvas')) return;

    const canvas = document.createElement('canvas');
    canvas.className = 'track-preview-canvas';
    canvas.width = 480;
    canvas.height = 300;
    this.container.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;

    // Dark background
    ctx.fillStyle = '#0a0a18';
    ctx.fillRect(0, 0, w, h);

    // Subtle grid
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

    // Isometric arena floor
    const cx = w / 2, cy = h * 0.48;
    const sx = w * 0.38, sy = h * 0.22;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy - sy);
    ctx.lineTo(cx + sx, cy);
    ctx.lineTo(cx, cy + sy);
    ctx.lineTo(cx - sx, cy);
    ctx.closePath();

    const floorGrad = ctx.createLinearGradient(cx - sx, cy, cx + sx, cy);
    floorGrad.addColorStop(0, '#1a1a2e');
    floorGrad.addColorStop(0.5, '#252545');
    floorGrad.addColorStop(1, '#1a1a2e');
    ctx.fillStyle = floorGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,200,255,0.25)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Walls (raised edges)
    const wallH = h * 0.06;
    ctx.fillStyle = 'rgba(0,200,255,0.12)';
    // Left wall
    ctx.beginPath();
    ctx.moveTo(cx - sx, cy); ctx.lineTo(cx, cy - sy);
    ctx.lineTo(cx, cy - sy - wallH); ctx.lineTo(cx - sx, cy - wallH);
    ctx.closePath(); ctx.fill();
    // Right wall
    ctx.fillStyle = 'rgba(0,200,255,0.08)';
    ctx.beginPath();
    ctx.moveTo(cx, cy - sy); ctx.lineTo(cx + sx, cy);
    ctx.lineTo(cx + sx, cy - wallH); ctx.lineTo(cx, cy - sy - wallH);
    ctx.closePath(); ctx.fill();

    // Edge glow lines
    ctx.strokeStyle = 'rgba(0,200,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - sx, cy); ctx.lineTo(cx, cy - sy); ctx.lineTo(cx + sx, cy);
    ctx.stroke();

    ctx.restore();

    // Track name label
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.textAlign = 'center';
    ctx.fillText(item.name.toUpperCase(), cx, h - 16);
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  _currentList() { return getList(this.mode); }
  _currentItem() { return this._currentList()[this.currentIndex]; }

  prev() {
    const list = this._currentList();
    this.currentIndex = (this.currentIndex - 1 + list.length) % list.length;
    this._updateInfo();
    this._emitChange();
  }

  next() {
    const list = this._currentList();
    this.currentIndex = (this.currentIndex + 1) % list.length;
    this._updateInfo();
    this._emitChange();
  }

  /** Jump to a specific track/arena id (called when lobby state syncs). */
  setById(id) {
    const list = this._currentList();
    const idx  = list.findIndex(t => t.id === id);
    if (idx >= 0 && idx !== this.currentIndex) {
      this.currentIndex = idx;
      this._updateInfo();
    }
  }

  /** Switch between race ↔ battle ↔ studio roster. */
  setMode(newMode) {
    if (newMode === this.mode) return;
    this.mode         = newMode;
    this.currentIndex = 0;
    this._updateInfo();
    // Phase 2.5: when entering studio mode, kick off a fresh fetch and
    // re-render once the cache populates so the carousel mirrors the
    // dropdown's grouped Studio list.
    if (newMode === 'studio') {
      loadStudioTracks({ force: true })
        .then(() => this._updateInfo())
        .catch(() => { /* offline */ });
    }
  }

  /** Force a refresh from the Studio cache (called by lobby on dropdown updates). */
  refreshStudioList() {
    if (this.mode === 'studio') this._updateInfo();
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  _emitChange() {
    const item = this._currentItem();
    document.dispatchEvent(new CustomEvent('trackCarouselChanged', {
      detail: { trackId: item.id, trackName: item.name, mode: this.mode }
    }));
    document.dispatchEvent(new CustomEvent('mapChanged', {
      detail: { mapId: item.id }
    }));
  }

  _listenForModeChanges() {
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-mode') === 'battle' ? 'battle' : 'race';
        this.setMode(mode);
      });
    });
  }

  // ── UI ─────────────────────────────────────────────────────────────────────

  _updateInfo() {
    const item    = this._currentItem();
    const list    = this._currentList();
    const nameEl  = document.getElementById('track-carousel-name');
    const indexEl = document.getElementById('track-carousel-index');
    if (nameEl)  nameEl.textContent  = item.name;
    if (indexEl) indexEl.textContent = `${this.currentIndex + 1} / ${list.length}`;
    this._updateThumb();
  }

  _setupNavButtons() {
    const prevBtn = document.getElementById('track-prev-btn');
    const nextBtn = document.getElementById('track-next-btn');
    if (prevBtn) prevBtn.addEventListener('click', () => this.prev());
    if (nextBtn) nextBtn.addEventListener('click', () => this.next());
  }
}

// ── Bootstrap ───────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const preview = new TrackPreview();
  window.__trackPreview = preview;
});

export default TrackPreview;
