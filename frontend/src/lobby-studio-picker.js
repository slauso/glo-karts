// GLO KARTS — Condensed Studio track picker for the lobby's left card.
// Phase 2.5e: surfaces the same TEMPLATES / REMIX COMMUNITY / MY SAVES tabs
// the standalone Track Studio landing page has, but at lobby-card width.
//
// Selecting a tile sets `lobby.selectedMap` via the existing
// `trackCarouselChanged` event channel that the carousel already uses, so
// the rest of the lobby (settings broadcast, host/peer sync, customTrackData
// for the local browser draft) keeps working unchanged.

import { StudioAPI } from './editor3/studio-api.js';
import { renderTrackThumb } from './editor3/track-thumb.js';
import { LOCAL_DRAFT_TRACK_ID, readLocalDraftTrack } from './lobby/constants.js';

const TABS = [
  { id: 'templates', label: 'Templates', primary: 'Use Template' },
  { id: 'community', label: 'Remix',     primary: 'Use Track', remixable: true },
  { id: 'mine',      label: 'My Saves',  primary: 'Use Track' },
];

const BUNDLED_TEMPLATES_URL = '/templates/bundled.json';

class LobbyStudioPicker {
  constructor(root) {
    this.root = root;
    this.activeTab = 'templates';
    this.selectedId = null;
    this._cache = { templates: null, community: null, mine: null };
    this._loading = { templates: false, community: false, mine: false };
    this._render();
    this._loadTab('templates');
    // Phase 2.12: when the editor saves a track (in this tab or a sibling
    // tab), invalidate our caches so the new save shows up without a full
    // lobby reload.
    this._onStorage = (e) => {
      if (e.key === 'gloKartsStudio.savesUpdated') this.refresh();
    };
    window.addEventListener('storage', this._onStorage);
    // Same-tab signal (storage event only fires across tabs).
    this._onSameTab = () => this.refresh();
    window.addEventListener('gloKartsStudio:savesUpdated', this._onSameTab);
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  /** Reflect a selection driven by another part of the lobby. */
  setSelectedId(id) {
    this.selectedId = id;
    this._refreshActiveStates();
  }

  /** Force a fresh fetch (e.g. after the user publishes from the editor). */
  refresh() {
    this._cache = { templates: null, community: null, mine: null };
    this._loadTab(this.activeTab);
  }

  _render() {
    this.root.innerHTML = `
      <div class="lsp-tabs" role="tablist">
        ${TABS.map((t) => `
          <button class="lsp-tab${t.id === this.activeTab ? ' active' : ''}"
                  data-tab="${t.id}" role="tab" type="button">${t.label}</button>
        `).join('')}
      </div>
      <div class="lsp-list" data-list></div>
    `;
    this.root.querySelectorAll('.lsp-tab').forEach((btn) => {
      btn.addEventListener('click', () => this._switchTab(btn.dataset.tab));
    });
    this.root.addEventListener('click', (e) => {
      const tile = e.target.closest('[data-track-id]');
      if (!tile) return;
      this._pick(tile.dataset.trackId, tile.dataset.trackName || '', tile.dataset.source || '');
    });
  }

  _switchTab(tabId) {
    if (tabId === this.activeTab) return;
    this.activeTab = tabId;
    this.root.querySelectorAll('.lsp-tab').forEach((b) =>
      b.classList.toggle('active', b.dataset.tab === tabId)
    );
    this._loadTab(tabId);
  }

  async _loadTab(tabId) {
    const list = this.root.querySelector('[data-list]');
    if (!list) return;
    if (this._cache[tabId]) {
      this._renderList(this._cache[tabId], tabId);
      return;
    }
    if (this._loading[tabId]) return;
    this._loading[tabId] = true;
    list.innerHTML = `<div class="lsp-empty">Loading…</div>`;
    let items = [];
    try {
      const fn = tabId === 'templates' ? StudioAPI.templates
              : tabId === 'community' ? StudioAPI.community
              : StudioAPI.mine;
      const args = tabId === 'community' ? { sort: 'popular', page: 1 } : { page: 1 };
      const res = await fn(args);
      items = res.results || [];
    } catch {
      // Templates fall back to bundled JSON so the picker still shows
      // something when the backend is offline (matches the standalone
      // Studio landing behaviour).
      if (tabId === 'templates') {
        try {
          const bundled = await fetch(BUNDLED_TEMPLATES_URL).then((r) => r.json());
          items = bundled.map((t) => ({
            id: t.pk,
            name: t.fields.name,
            author_name: t.fields.author_name,
            description: t.fields.description,
            tags: t.fields.tags,
            preview_placements: t.fields.track_data?.track?.placements || [],
          }));
        } catch { /* ignore */ }
      }
    }
    this._loading[tabId] = false;
    this._cache[tabId] = items;
    this._renderList(items, tabId);
  }

  _renderList(items, tabId) {
    const list = this.root.querySelector('[data-list]');
    if (!list) return;
    const tabMeta = TABS.find((t) => t.id === tabId) || TABS[0];

    // Prepend the host's local browser draft on the My Saves tab so it can
    // be selected for broadcast via customTrackData.
    let extras = '';
    if (tabId === 'mine') {
      const draft = readLocalDraftTrack();
      if (draft) {
        extras = this._tile({
          id: LOCAL_DRAFT_TRACK_ID,
          name: draft.name,
          author_name: 'Your browser',
          description: `${draft.placements} pieces · unsaved local draft`,
          tags: 'draft,local',
          preview_placements: this._draftPlacements(),
        }, tabMeta) + extras;
      }
    }

    if (!items.length && !extras) {
      const empty = tabId === 'mine'
        ? 'No cloud saves yet. Save tracks from the Studio menu and they\u2019ll appear here.'
        : (tabId === 'community'
          ? 'No community tracks published yet.'
          : 'No templates available.');
      list.innerHTML = `<div class="lsp-empty">${empty}</div>`;
      return;
    }

    list.innerHTML = extras + items.map((t) => this._tile(t, tabMeta)).join('');
    this._refreshActiveStates();
  }

  _draftPlacements() {
    try {
      const raw = localStorage.getItem('gloKartsStudio.lastTrack');
      const parsed = JSON.parse(raw);
      return parsed?.track?.placements || parsed?.placements || [];
    } catch { return []; }
  }

  _tile(t, tabMeta) {
    const tags = (t.tags || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3);
    const tagBadges = tags.map((tag) => `<span class="lsp-tag">${escHtml(tag)}</span>`).join('');
    let thumb;
    if (t.thumbnail) {
      thumb = `<img src="${escAttr(t.thumbnail)}" alt="">`;
    } else if (Array.isArray(t.preview_placements) && t.preview_placements.length) {
      thumb = renderTrackThumb(t.preview_placements, { width: 220, height: 110 });
    } else {
      thumb = `<div class="lsp-thumb-empty"></div>`;
    }
    const isActive = this.selectedId && String(this.selectedId) === String(t.id);
    return `
      <article class="lsp-tile${isActive ? ' active' : ''}"
               data-track-id="${escAttr(t.id)}"
               data-track-name="${escAttr(t.name)}"
               data-source="${tabMeta.id}">
        <div class="lsp-thumb">${thumb}</div>
        <div class="lsp-body">
          <h4 class="lsp-name">${escHtml(t.name || 'Untitled')}</h4>
          <p class="lsp-meta">by ${escHtml(t.author_name || 'Unknown')}</p>
          ${t.description ? `<p class="lsp-desc">${escHtml(t.description)}</p>` : ''}
          ${tagBadges ? `<div class="lsp-tags">${tagBadges}</div>` : ''}
          <button class="lsp-use" type="button">${isActive ? 'Selected' : tabMeta.primary}</button>
        </div>
      </article>
    `;
  }

  _refreshActiveStates() {
    this.root.querySelectorAll('.lsp-tile').forEach((tile) => {
      const isActive = this.selectedId && String(tile.dataset.trackId) === String(this.selectedId);
      tile.classList.toggle('active', !!isActive);
      const btn = tile.querySelector('.lsp-use');
      if (btn) {
        const tabMeta = TABS.find((t) => t.id === tile.dataset.source) || TABS[0];
        btn.textContent = isActive ? 'Selected' : tabMeta.primary;
      }
    });
  }

  _pick(id, name, source) {
    this.selectedId = id;
    this._refreshActiveStates();
    // Drive the same channel the legacy carousel uses so lobby.js's
    // existing trackCarouselChanged listener handles selectedMap +
    // customTrackData (for the local draft) + sendSettingsUpdate().
    document.dispatchEvent(new CustomEvent('trackCarouselChanged', {
      detail: { trackId: id, trackName: name, mode: 'studio', source },
    }));
  }
}

let _instance = null;
export function mountLobbyStudioPicker(rootEl) {
  if (!rootEl) return null;
  if (_instance && _instance.root === rootEl) return _instance;
  _instance = new LobbyStudioPicker(rootEl);
  window.__lobbyStudioPicker = _instance;
  return _instance;
}

export function getLobbyStudioPicker() { return _instance; }

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function escAttr(s) { return escHtml(s); }
