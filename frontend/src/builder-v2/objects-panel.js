/**
 * objects-panel.js — Categorised asset library with connection-port hints.
 */
import { TRACK_ASSETS, generateThumbnail } from './asset-loader.js';
import { PIECE_DEFS, CATEGORIES } from './grid-placement.js';

/* ── SVG icons per category letter (24×24 viewBox) ─────────── */
const CAT_ICONS = {
  R: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="3" width="3" height="18" rx="1" opacity=".4"/><rect x="17" y="3" width="3" height="18" rx="1" opacity=".4"/><rect x="10" y="3" width="4" height="4" rx=".5"/><rect x="10" y="10" width="4" height="4" rx=".5"/><rect x="10" y="17" width="4" height="4" rx=".5"/></svg>',
  T: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 19A14 14 0 0119 5"/></svg>',
  E: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 20l9-14 9 14z" opacity=".15"/><path d="M2 20l9-14 9 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  F: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M4 4c4 0 4 8 8 8s4 8 8 8"/></svg>',
  S: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14.4 6l-.24-1.2A1 1 0 0013.2 4H6v16h2v-6h4.4l.24 1.2a1 1 0 00.96.8H20V6h-5.6z"/></svg>',
  P: '<svg viewBox="0 0 24 24" fill="currentColor" opacity=".55"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  C: '<svg viewBox="0 0 24 24" fill="currentColor" opacity=".55"><path d="M2 4h20l-7 8 7 8H2l7-8z"/></svg>',
  B: '<svg viewBox="0 0 24 24" fill="currentColor" opacity=".55"><rect x="2" y="3" width="20" height="5" rx="1.5"/><rect x="2" y="12" width="9" height="9" rx="1.5"/><rect x="14" y="12" width="8" height="9" rx="1.5"/></svg>',
  V: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 20v-4h4v-4h4v-4h4V4h4v16z" opacity=".2"/><path d="M4 20v-4h4v-4h4v-4h4V4h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
};

const DEFAULT_LIBRARY = Object.freeze({
  kicker: 'Segment Library',
  title: 'Pick a piece and click to place it.',
  copy: 'Pieces snap to the grid and auto-connect to neighbors.',
  sections: CATEGORIES.map((category) => ({
    ...category,
    assetKeys: TRACK_ASSETS
      .filter((asset) => (PIECE_DEFS[asset.key]?.category || 'basic') === category.id)
      .map((asset) => asset.key),
  })),
});

export class ObjectsPanel {
  /**
   * @param {HTMLElement} container
   * @param {(assetKey: string|null) => void} onSelect
   * @param {object} [options]
   */
  constructor(container, onSelect, options = {}) {
    this._container = container;
    this._onSelect = onSelect;
    this._selectedKey = null;
    this._library = DEFAULT_LIBRARY;
    /** @type {Map<string, HTMLButtonElement>} */
    this._buttons = new Map();
    this.setLibrary(options);
  }

  get selectedKey() { return this._selectedKey; }

  deselect() {
    this._selectedKey = null;
    for (const btn of this._buttons.values()) btn.classList.remove('selected');
  }

  /** Select a piece programmatically. */
  select(key) {
    this.deselect();
    const btn = this._buttons.get(key);
    if (btn) {
      this._selectedKey = key;
      btn.classList.add('selected');
    }
  }

  setLibrary(options = {}) {
    this._library = {
      ...DEFAULT_LIBRARY,
      ...options,
      sections: Array.isArray(options.sections) && options.sections.length
        ? options.sections
        : DEFAULT_LIBRARY.sections,
    };
    this._build();
  }

  async _build() {
    const previousSelection = this._selectedKey;
    this._container.innerHTML = '';
    this._buttons.clear();

    const assetMap = new Map(TRACK_ASSETS.map((asset) => [asset.key, asset]));

    for (const section of this._library.sections) {
      const assetKeys = Array.isArray(section.assetKeys) && section.assetKeys.length
        ? section.assetKeys
        : TRACK_ASSETS
          .filter((asset) => (PIECE_DEFS[asset.key]?.category || 'basic') === section.id)
          .map((asset) => asset.key);
      const assets = assetKeys
        .map((key) => assetMap.get(key))
        .filter(Boolean);
      if (!assets.length) continue;

      // Category header (collapsible)
      const header = document.createElement('button');
      header.className = 'bv2-cat-header';
      header.type = 'button';
      const iconSvg = CAT_ICONS[section.icon] || '';
      header.innerHTML = `<span class="bv2-cat-icon">${iconSvg || section.icon || '•'}</span><span>${section.label}</span><span class="bv2-cat-count">${assets.length}</span>`;

      const gridEl = document.createElement('div');
      gridEl.className = 'bv2-asset-grid';

      header.addEventListener('click', () => {
        gridEl.classList.toggle('collapsed');
        header.classList.toggle('collapsed');
      });

      this._container.appendChild(header);
      this._container.appendChild(gridEl);

      for (const asset of assets) {
        const def = PIECE_DEFS[asset.key];
        const portCount = def?.ports?.length || 0;

        const btn = document.createElement('button');
        btn.className = 'bv2-asset-btn';
        btn.type = 'button';
        btn.title = `${asset.label}\n${portCount} connection${portCount !== 1 ? 's' : ''} · auto-rotates`;
        btn.dataset.key = asset.key;

        const img = document.createElement('img');
        img.className = 'bv2-asset-thumb';
        img.alt = asset.label;
        img.width = 64;
        img.height = 64;
        img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

        const info = document.createElement('div');
        info.className = 'bv2-asset-info';

        const lbl = document.createElement('span');
        lbl.className = 'bv2-asset-label';
        lbl.textContent = asset.label;

        const ports = document.createElement('span');
        ports.className = 'bv2-asset-ports';
        for (let i = 0; i < portCount; i++) {
          const dot = document.createElement('span');
          dot.className = 'bv2-port-dot';
          ports.appendChild(dot);
        }

        info.appendChild(lbl);
        info.appendChild(ports);
        btn.appendChild(img);
        btn.appendChild(info);
        gridEl.appendChild(btn);
        this._buttons.set(asset.key, btn);

        btn.addEventListener('click', () => {
          if (this._selectedKey === asset.key) {
            this.deselect();
            this._onSelect(null);
          } else {
            this.deselect();
            this._selectedKey = asset.key;
            btn.classList.add('selected');
            this._onSelect(asset.key);
          }
        });

        generateThumbnail(asset.key, 64).then(url => { img.src = url; }).catch(() => {});
      }
    }

    if (previousSelection && this._buttons.has(previousSelection)) {
      this.select(previousSelection);
    } else {
      this._selectedKey = null;
    }
  }
}
