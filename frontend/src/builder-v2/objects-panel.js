/**
 * objects-panel.js — Categorised asset library with connection-port hints.
 */
import { TRACK_ASSETS, generateThumbnail } from './asset-loader.js';
import { PIECE_DEFS, CATEGORIES } from './grid-placement.js';

export class ObjectsPanel {
  /**
   * @param {HTMLElement} container
   * @param {(assetKey: string|null) => void} onSelect
   */
  constructor(container, onSelect) {
    this._container = container;
    this._onSelect = onSelect;
    this._selectedKey = null;
    /** @type {Map<string, HTMLButtonElement>} */
    this._buttons = new Map();
    this._build();
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

  async _build() {
    this._container.innerHTML = '';

    // Bucket assets by category
    const byCategory = new Map();
    for (const cat of CATEGORIES) byCategory.set(cat.id, []);

    for (const asset of TRACK_ASSETS) {
      const def = PIECE_DEFS[asset.key];
      const catId = def?.category || 'basic';
      if (!byCategory.has(catId)) byCategory.set(catId, []);
      byCategory.get(catId).push(asset);
    }

    for (const cat of CATEGORIES) {
      const assets = byCategory.get(cat.id);
      if (!assets || assets.length === 0) continue;

      // Category header (collapsible)
      const header = document.createElement('button');
      header.className = 'bv2-cat-header';
      header.type = 'button';
      header.innerHTML = `<span class="bv2-cat-icon">${cat.icon}</span><span>${cat.label}</span><span class="bv2-cat-count">${assets.length}</span>`;

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
  }
}
