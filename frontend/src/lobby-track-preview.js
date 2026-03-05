// GLO Karts — Track / Arena Carousel (lobby-track-preview.js)
// Navigation + events only. Thumbnails are a placeholder; visual preview to be added later.

// ── Rosters (mirrors lobby.js STK_TRACKS / STK_ARENAS) ─────────────────────

const STK_TRACKS = [
  { id: 'cocoa_temple',         name: 'Cocoa Temple' },
  { id: 'hacienda',             name: 'Hacienda' },
  { id: 'minigolf',             name: 'Minigolf' },
  { id: 'sandtrack',            name: 'Shifting Sands' },
  { id: 'snowtuxpeak',          name: 'Snow Peak' },
  { id: 'zengarden',            name: 'Zen Garden' },
  { id: 'lighthouse',           name: 'Around the Lighthouse' },
  { id: 'olivermath',           name: "Oliver's Math Class" },
  { id: 'black_forest',         name: 'Black Forest' },
  { id: 'xr591',                name: 'XR591' },
  { id: 'oasis',                name: 'Oasis' },
  { id: 'gran_paradiso_island', name: 'Gran Paradiso Island' },
  { id: 'mines',                name: 'Old Mine' },
  { id: 'snowmountain',         name: 'Northern Resort' },
  { id: 'abyss',                name: 'Antediluvian Abyss' },
  { id: 'cornfield_crossing',   name: 'Cornfield Crossing' },
  { id: 'volcano_island',       name: 'Volcan Island' },
  { id: 'ravenbridge_mansion',  name: 'Ravenbridge Mansion' },
];

const STK_ARENAS = [
  { id: 'blockfort',                   name: 'Block Fort' },
  { id: 'battleisland',                name: 'Battle Island' },
  { id: 'lasdunasarena',               name: 'Las Dunas Arena' },
  { id: 'cave',                        name: 'Cave X' },
  { id: 'pumpkin_park',                name: 'Pumpkin Park' },
  { id: 'arena_candela_city',          name: 'Candela City' },
  { id: 'ancient_colosseum_labyrinth', name: 'Ancient Colosseum' },
  { id: 'stadium',                     name: 'The Stadium' },
  { id: 'alien_signal',                name: 'Alien Signal' },
  { id: 'temple',                      name: 'Temple' },
];

function getList(mode) {
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

  /** Switch between race ↔ battle roster. */
  setMode(newMode) {
    if (newMode === this.mode) return;
    this.mode         = newMode;
    this.currentIndex = 0;
    this._updateInfo();
    this._emitChange();
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
