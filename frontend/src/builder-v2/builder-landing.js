/**
 * builder-landing.js — Landing menu for TinkerTracks.
 *
 * Shows before the builder loads, letting players: continue an auto-saved
 * project, start fresh, open a saved arena, or import a share code.
 */
import { navigateWithTransition } from '../ui/page-transition.js';

/**
 * Display the landing overlay and return a Promise that resolves with the
 * user's chosen action.
 *
 * @param {import('./serializer.js').Serializer} serializer
 * @returns {Promise<{ action: 'continue'|'new'|'load'|'import', data?: object }>}
 */
export function showLanding(serializer) {
  const overlay    = document.getElementById('bv2-landing');
  const root       = document.getElementById('builder-root');

  const btnCont    = document.getElementById('bv2-land-continue');
  const btnNew     = document.getElementById('bv2-land-new');
  const btnSaved   = document.getElementById('bv2-land-saved');
  const btnImport  = document.getElementById('bv2-land-import');
  const btnBack    = document.getElementById('bv2-land-back');

  const savesPanel = document.getElementById('bv2-land-saves-panel');
  const savesClose = document.getElementById('bv2-land-saves-close');
  const savesList  = document.getElementById('bv2-land-saves-list');

  const importPanel = document.getElementById('bv2-land-import-panel');
  const importClose = document.getElementById('bv2-land-import-close');
  const importCode  = document.getElementById('bv2-land-import-code');
  const importGo    = document.getElementById('bv2-land-import-go');
  const autoInfo    = document.getElementById('bv2-land-autosave-info');

  // ── Probe auto-save ───────────────────────────────────────
  const autoSave = serializer.loadAutoSave();
  if (autoSave) {
    btnCont.disabled = false;
    autoInfo.textContent = autoSave.name || 'Untitled Arena';
  }

  // ── Helpers ───────────────────────────────────────────────
  function dismiss() {
    overlay.hidden = true;
    root.style.display = '';
  }

  function closePanels() {
    savesPanel.hidden = true;
    importPanel.hidden = true;
  }

  function renderSaves(resolve) {
    const slots = serializer.listSlots();
    savesList.innerHTML = '';

    if (slots.length === 0) {
      savesList.innerHTML = '<p class="bv2-land-empty">No saved arenas yet.</p>';
      return;
    }

    for (const slot of slots) {
      const row = document.createElement('div');
      row.className = 'bv2-land-slot';

      const dateStr = slot.savedAt
        ? new Date(slot.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        : '';

      row.innerHTML = `
        <span class="bv2-land-slot-icon">🏁</span>
        <div class="bv2-land-slot-info">
          <div class="bv2-land-slot-name">${escapeHTML(slot.name)}</div>
          <div class="bv2-land-slot-date">${escapeHTML(dateStr)}</div>
        </div>
        <div class="bv2-land-slot-actions">
          <button class="bv2-land-slot-btn" data-action="load" title="Open">▶</button>
          <button class="bv2-land-slot-btn bv2-land-slot-btn--del" data-action="del" title="Delete">✕</button>
        </div>`;

      row.querySelector('[data-action="load"]').addEventListener('click', (e) => {
        e.stopPropagation();
        const data = serializer.loadFromSlot(slot.key);
        if (data) { dismiss(); resolve({ action: 'load', data }); }
      });

      row.querySelector('[data-action="del"]').addEventListener('click', (e) => {
        e.stopPropagation();
        serializer.deleteSlot(slot.key);
        renderSaves(resolve);
      });

      savesList.appendChild(row);
    }
  }

  // ── Return promise ────────────────────────────────────────
  return new Promise((resolve) => {
    // Continue
    btnCont.addEventListener('click', () => {
      dismiss();
      resolve({ action: 'continue', data: autoSave });
    });

    // New
    btnNew.addEventListener('click', () => {
      dismiss();
      resolve({ action: 'new' });
    });

    // Saved panel toggle
    btnSaved.addEventListener('click', () => {
      importPanel.hidden = true;
      savesPanel.hidden = !savesPanel.hidden;
      if (!savesPanel.hidden) renderSaves(resolve);
    });

    savesClose.addEventListener('click', () => { savesPanel.hidden = true; });

    // Import panel toggle
    btnImport.addEventListener('click', () => {
      savesPanel.hidden = true;
      importPanel.hidden = !importPanel.hidden;
      if (!importPanel.hidden) { importCode.value = ''; importCode.focus(); }
    });

    importClose.addEventListener('click', () => { importPanel.hidden = true; });

    importGo.addEventListener('click', () => {
      const code = importCode.value.trim();
      if (!code) return;
      const data = serializer.importShareCode(code);
      if (data) {
        dismiss();
        resolve({ action: 'import', data });
      } else {
        importCode.style.borderColor = '#f66';
        setTimeout(() => { importCode.style.borderColor = ''; }, 1200);
      }
    });

    // Back to lobby
    btnBack.addEventListener('click', () => {
      void navigateWithTransition(new URL('index.html', window.location.href).href);
    });
  });
}

/** Safely escape HTML to prevent XSS in slot names. */
function escapeHTML(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
