/**
 * GLO KARTS Studio — landing overlay.
 *
 * Shown when the editor opens (unless ?resume=1 / ?template=<id> /
 * ?community=<id> in the URL). Presents four flows:
 *   • New project        — empty workspace
 *   • Continue           — resume the autosaved track
 *   • Templates          — pick a starter from /api/tracks/templates/
 *                          (with bundled JSON fallback when offline)
 *   • Remix community    — pick a published track from /api/tracks/community/
 *
 * Resolves with one of:
 *   { action: 'new' }
 *   { action: 'continue' }
 *   { action: 'load', json }                // template / community / mine
 *
 * The caller (editor-main.js) is responsible for applying the JSON via
 * its existing loadFromJSON()+rebuild plumbing.
 */

import { StudioAPI } from './studio-api.js';
import { renderTrackThumb } from './track-thumb.js';

const STORAGE_KEY = 'gloKartsStudio.lastTrack';
const BUNDLED_TEMPLATES_URL = '/templates/bundled.json';

export function showStudioLanding() {
  // Honor URL shortcuts that bypass the landing.
  const params = new URLSearchParams(location.search);
  if (params.get('resume') === '1') return Promise.resolve({ action: 'continue' });
  if (params.get('new') === '1')    return Promise.resolve({ action: 'new' });
  const templateId  = params.get('template');
  const communityId = params.get('community');
  if (templateId || communityId) {
    return loadById(templateId || communityId).then((json) => ({ action: 'load', json }));
  }

  return new Promise((resolve) => {
    // Adopt an inline pre-rendered overlay if the host page provided
    // one (editor.html does this so the landing paints with the HTML
    // instead of after editor-main.js + its dep tree finish parsing).
    // If a Continue/New click was queued while we were loading, resolve
    // it immediately and never even mount the landing.
    let overlay = document.querySelector('.studio-landing[data-preshown="1"]');
    const queued = window.__studioPreClick;
    if (overlay && queued && (queued.action === 'new' || queued.action === 'continue')) {
      window.__studioPreClick = null;
      const action = queued.action;
      // For 'continue' verify autosave still exists (the user could have
      // cleared storage between the click and us getting here).
      if (action === 'continue' && !readAutosave()) {
        // Fall through to normal mount with the disabled card.
      } else {
        close(overlay);
        resolve({ action });
        return;
      }
    }
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'studio-landing';
      overlay.innerHTML = HTML;
      document.body.appendChild(overlay);
    } else {
      // We're adopting an inline overlay — drop the marker so a later
      // re-open from the menu builds a fresh node instead of finding
      // this stale one.
      overlay.removeAttribute('data-preshown');
    }

    // ── Continue card: enable + populate from autosave ───────────────
    const autosave = readAutosave();
    const continueCard = overlay.querySelector('[data-card="continue"]');
    if (autosave) {
      continueCard.classList.remove('disabled');
      const meta = continueCard.querySelector('.sl-card-meta');
      meta.textContent = autosave.name
        ? `${autosave.name} · ${autosave.placements} pieces`
        : `${autosave.placements} pieces`;
    }

    // ── Tab switching (templates / community / mine) ─────────────────
    const tabs = overlay.querySelectorAll('.sl-tab');
    const panes = overlay.querySelectorAll('.sl-pane');
    tabs.forEach((tab) => tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.toggle('active', t === tab));
      panes.forEach((p) => p.classList.toggle('active', p.dataset.pane === tab.dataset.tab));
      if (tab.dataset.tab === 'templates') hydrateTemplates(overlay);
      else if (tab.dataset.tab === 'community') hydrateCommunity(overlay);
      else if (tab.dataset.tab === 'mine') hydrateMine(overlay);
    }));

    // Eager-load whichever tab starts active (Templates by default).
    hydrateTemplates(overlay);

    // ── Card-level actions ───────────────────────────────────────────
    overlay.addEventListener('click', async (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (!action) {
        // Track-tile clicks (delegated)
        const tile = e.target.closest('[data-track-id]');
        if (tile) {
          const id = tile.dataset.trackId;
          const isRemix = e.target.closest('[data-tile-action="remix"]');
          await onPickTrack(id, !!isRemix, overlay, resolve);
        }
        return;
      }
      if (action === 'new') {
        close(overlay);
        resolve({ action: 'new' });
      } else if (action === 'continue' && autosave) {
        close(overlay);
        resolve({ action: 'continue' });
      } else if (action === 'lobby') {
        location.href = '/index.html';
      }
    });
  });

  function close(overlay) {
    overlay.classList.add('closing');
    setTimeout(() => overlay.remove(), 220);
  }

  async function onPickTrack(id, asRemix, overlay, resolve) {
    try {
      let detail;
      if (asRemix) {
        // Server-side clone so the new copy is owned by this user.
        detail = await StudioAPI.remix(id);
      } else {
        // Just load read-only into editor (the user will Save As… later).
        detail = await StudioAPI.get(id);
      }
      close(overlay);
      resolve({ action: 'load', json: detail.track_data, meta: { id: detail.id, name: detail.name } });
    } catch (err) {
      // Fallback for templates: try bundled JSON if backend unreachable.
      try {
        const bundled = await fetch(BUNDLED_TEMPLATES_URL).then((r) => r.json());
        const entry = bundled.find((t) => t.pk === id);
        if (entry) {
          close(overlay);
          resolve({ action: 'load', json: entry.fields.track_data, meta: { id: entry.pk, name: entry.fields.name } });
          return;
        }
      } catch {}
      flash(overlay, `Failed to load track (${err.message})`);
    }
  }
}

async function loadById(id) {
  try {
    const d = await StudioAPI.get(id);
    return d.track_data;
  } catch {
    const bundled = await fetch(BUNDLED_TEMPLATES_URL).then((r) => r.json());
    const entry = bundled.find((t) => t.pk === id);
    return entry?.fields?.track_data || null;
  }
}

function readAutosave() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const placements = parsed?.track?.placements?.length ?? 0;
    if (placements === 0) return null;
    return { name: parsed?.track?.name || 'Untitled Track', placements };
  } catch { return null; }
}

async function hydrateTemplates(overlay) {
  const grid = overlay.querySelector('[data-pane="templates"] .sl-grid');
  if (grid.dataset.hydrated === '1') return;
  grid.dataset.hydrated = '1';
  grid.innerHTML = `<div class="sl-empty">Loading templates…</div>`;
  let items = [];
  try {
    const res = await StudioAPI.templates({ sort: 'newest' });
    items = res.results || [];
  } catch {
    try {
      const bundled = await fetch(BUNDLED_TEMPLATES_URL).then((r) => r.json());
      items = bundled.map((t) => ({
        id: t.pk,
        name: t.fields.name,
        author_name: t.fields.author_name,
        description: t.fields.description,
        tags: t.fields.tags,
        is_template: true,        preview_placements: t.fields.track_data?.track?.placements || [],      }));
    } catch {}
  }
  if (!items.length) { grid.innerHTML = `<div class="sl-empty">No templates available.</div>`; return; }
  grid.innerHTML = items.map((t) => trackTile(t, { primaryLabel: 'Use Template' })).join('');
}

async function hydrateCommunity(overlay) {
  const grid = overlay.querySelector('[data-pane="community"] .sl-grid');
  if (grid.dataset.hydrated === '1') return;
  grid.dataset.hydrated = '1';
  grid.innerHTML = `<div class="sl-empty">Loading community tracks…</div>`;
  try {
    const res = await StudioAPI.community({ sort: 'newest' });
    const items = res.results || [];
    if (!items.length) {
      grid.innerHTML = `<div class="sl-empty">No community tracks yet — be the first to publish from the editor menu!</div>`;
      return;
    }
    grid.innerHTML = items.map((t) => trackTile(t, { primaryLabel: 'Open', showRemix: true })).join('');
  } catch (err) {
    grid.innerHTML = `<div class="sl-empty">Couldn't reach the community server.<br><small>${err.message}</small></div>`;
  }
}

async function hydrateMine(overlay) {
  const grid = overlay.querySelector('[data-pane="mine"] .sl-grid');
  if (grid.dataset.hydrated === '1') return;
  grid.dataset.hydrated = '1';
  grid.innerHTML = `<div class="sl-empty">Loading your saves…</div>`;
  try {
    const res = await StudioAPI.mine({ sort: 'newest' });
    const items = res.results || [];
    if (!items.length) {
      grid.innerHTML = `<div class="sl-empty">No cloud saves yet.<br><small>Saves you push from the editor's menu show up here.</small></div>`;
      return;
    }
    grid.innerHTML = items.map((t) => trackTile(t, { primaryLabel: 'Open' })).join('');
  } catch (err) {
    grid.innerHTML = `<div class="sl-empty">Couldn't load your saves.<br><small>${err.message}</small></div>`;
  }
}

function trackTile(t, { primaryLabel = 'Open', showRemix = false } = {}) {
  const author = t.author_name ? ` · ${escapeHtml(t.author_name)}` : '';
  const tags = (t.tags || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3);
  const tagBadges = tags.map((tag) => `<span class="sl-tag">${escapeHtml(tag)}</span>`).join('');
  // Prefer an authored PNG thumbnail; otherwise render a static iso preview
  // from the placement skeleton the API ships in `preview_placements`.
  let thumb;
  if (t.thumbnail) {
    thumb = `<img src="${escapeAttr(t.thumbnail)}" alt="">`;
  } else if (Array.isArray(t.preview_placements) && t.preview_placements.length) {
    thumb = renderTrackThumb(t.preview_placements, { width: 320, height: 180 });
  } else {
    thumb = `<div class="sl-tile-thumb-placeholder"></div>`;
  }
  return `
    <article class="sl-tile" data-track-id="${escapeAttr(t.id)}">
      <div class="sl-tile-thumb">${thumb}</div>
      <div class="sl-tile-body">
        <h4 class="sl-tile-name">${escapeHtml(t.name)}</h4>
        <p class="sl-tile-meta">by ${escapeHtml(t.author_name || 'Unknown')}${author && ''}</p>
        ${t.description ? `<p class="sl-tile-desc">${escapeHtml(t.description)}</p>` : ''}
        ${tagBadges ? `<div class="sl-tile-tags">${tagBadges}</div>` : ''}
      </div>
      <div class="sl-tile-actions">
        <button class="sl-btn sl-btn-primary" data-tile-action="open">${primaryLabel}</button>
        ${showRemix ? `<button class="sl-btn sl-btn-ghost" data-tile-action="remix">Remix</button>` : ''}
      </div>
    </article>
  `;
}

function flash(overlay, message) {
  let bar = overlay.querySelector('.sl-flash');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'sl-flash';
    overlay.appendChild(bar);
  }
  bar.textContent = message;
  bar.classList.add('show');
  setTimeout(() => bar.classList.remove('show'), 2400);
}

function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function escapeAttr(s) { return escapeHtml(s); }

const HTML = `
  <div class="sl-bg"></div>
  <div class="sl-shell" role="dialog" aria-modal="true" aria-label="Track Studio">
    <header class="sl-header">
      <div class="sl-brand">GLO<br>KARTS</div>
      <div class="sl-title">
        <h1>Track Studio</h1>
        <p>Build a new circuit, remix the community, or pick up where you left off.</p>
      </div>
      <button class="sl-lobby" data-action="lobby" type="button" title="Return to lobby">← Lobby</button>
    </header>

    <section class="sl-quickrow">
      <button class="sl-card" data-card="new" data-action="new" type="button">
        <div class="sl-card-icon">＋</div>
        <div class="sl-card-text">
          <h3>New Project</h3>
          <p>Empty workspace.</p>
        </div>
      </button>
      <button class="sl-card disabled" data-card="continue" data-action="continue" type="button">
        <div class="sl-card-icon">⟳</div>
        <div class="sl-card-text">
          <h3>Continue</h3>
          <p class="sl-card-meta">No autosave found yet.</p>
        </div>
      </button>
    </section>

    <nav class="sl-tabs">
      <button class="sl-tab active" data-tab="templates" type="button">Templates</button>
      <button class="sl-tab" data-tab="community" type="button">Remix Community</button>
      <button class="sl-tab" data-tab="mine" type="button">My Saves</button>
    </nav>

    <section class="sl-pane active" data-pane="templates">
      <div class="sl-grid"></div>
    </section>
    <section class="sl-pane" data-pane="community">
      <div class="sl-grid"></div>
    </section>
    <section class="sl-pane" data-pane="mine">
      <div class="sl-grid"></div>
    </section>
  </div>
`;
