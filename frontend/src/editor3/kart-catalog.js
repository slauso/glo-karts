/**
 * kart-catalog.js — Curated list of playable karts for the Track Studio.
 *
 * Paths resolve to the shared /models/stk/karts/<id>/kart.glb assets that
 * ship with the main GLO KARTS game. Single source of truth — both editor
 * and play runtimes import from here so kart IDs always match.
 */

export const DEFAULT_KART_ID = 'mechatux';

/**
 * @typedef {Object} KartEntry
 * @property {string} id        - directory name under /models/stk/karts/
 * @property {string} label     - display name
 * @property {string} modelPath - absolute URL path to the GLB
 * @property {'light'|'medium'|'heavy'} weight
 * @property {string} accent    - HUD accent color
 */

/** @type {KartEntry[]} */
export const KARTS = [
  { id: 'mechatux', label: 'Mecha Tux', modelPath: '/models/stk/karts/mechatux/kart.glb', weight: 'medium', accent: '#00e5ff' },
  { id: 'gnu',      label: 'Gnu',       modelPath: '/models/stk/karts/gnu/kart.glb',      weight: 'heavy',  accent: '#a67bff' },
  { id: 'hexley',   label: 'Hexley',    modelPath: '/models/stk/karts/hexley/kart.glb',   weight: 'medium', accent: '#ffb347' },
  { id: 'nolok',    label: 'Nolok',     modelPath: '/models/stk/karts/nolok/kart.glb',    weight: 'heavy',  accent: '#ff3a3a' },
  { id: 'suzanne',  label: 'Suzanne',   modelPath: '/models/stk/karts/suzanne/kart.glb',  weight: 'medium', accent: '#f5a623' },
  { id: 'adiumy',   label: 'Adiumy',    modelPath: '/models/stk/karts/adiumy/kart.glb',   weight: 'light',  accent: '#58cfff' },
  { id: 'amanda',   label: 'Amanda',    modelPath: '/models/stk/karts/amanda/kart.glb',   weight: 'medium', accent: '#ff3aa1' },
  { id: 'emule',    label: 'Emule',     modelPath: '/models/stk/karts/emule/kart.glb',    weight: 'medium', accent: '#4da6ff' },
  { id: 'gavroche', label: 'Gavroche',  modelPath: '/models/stk/karts/gavroche/kart.glb', weight: 'light',  accent: '#ffe066' },
  { id: 'kiki',     label: 'Kiki',      modelPath: '/models/stk/karts/kiki/kart.glb',     weight: 'light',  accent: '#ff66cc' },
  { id: 'konqi',    label: 'Konqi',     modelPath: '/models/stk/karts/konqi/kart.glb',    weight: 'heavy',  accent: '#3ddc84' },
  { id: 'pidgin',   label: 'Pidgin',    modelPath: '/models/stk/karts/pidgin/kart.glb',   weight: 'light',  accent: '#b2dbef' },
  { id: 'puffy',    label: 'Puffy',     modelPath: '/models/stk/karts/puffy/kart.glb',    weight: 'medium', accent: '#ffe4a0' },
  { id: 'wilber',   label: 'Wilber',    modelPath: '/models/stk/karts/wilber/kart.glb',   weight: 'heavy',  accent: '#ff9933' },
  { id: 'xue',      label: 'Xue',       modelPath: '/models/stk/karts/xue/kart.glb',      weight: 'light',  accent: '#fff' },
  { id: 'beagle_2', label: 'Beagle',    modelPath: '/models/stk/karts/beagle_2/kart.glb', weight: 'medium', accent: '#c98a5b' },
  { id: 'python',   label: 'Python',    modelPath: '/models/stk/karts/python/kart.glb',   weight: 'medium', accent: '#4cd964' },
  { id: 'cyberkart',label: 'Cyberkart', modelPath: '/models/stk/karts/cyberkart/kart.glb',weight: 'light',  accent: '#ff00ea' },
  { id: 'inky',     label: 'Inky',      modelPath: '/models/stk/karts/inky/kart.glb',     weight: 'medium', accent: '#8a2be2' },
  { id: 'racehicle',label: 'Racehicle', modelPath: '/models/stk/karts/racehicle/kart.glb',weight: 'heavy',  accent: '#ff2222' },
];

export const KART_BY_ID = Object.fromEntries(KARTS.map((k) => [k.id, k]));

/**
 * Resolve a kart id with sensible fallbacks.
 * Falls back to session/localStorage → DEFAULT_KART_ID.
 */
export function resolveSelectedKartId() {
  try {
    const stored = (typeof window !== 'undefined' && window.sessionStorage
      ? window.sessionStorage.getItem('studioSelectedKart')
      : null)
      || (typeof window !== 'undefined' && window.localStorage
        ? window.localStorage.getItem('studioSelectedKart')
        : null)
      || (typeof window !== 'undefined' && window.localStorage
        ? window.localStorage.getItem('selectedKart')
        : null);
    if (stored && KART_BY_ID[stored]) return stored;
  } catch {}
  return DEFAULT_KART_ID;
}

export function getKart(id) {
  return KART_BY_ID[id] || KART_BY_ID[DEFAULT_KART_ID];
}
