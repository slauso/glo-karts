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
  { id: 'mechatux',        label: 'MJ',          modelPath: '/models/stk/karts/mechatux/kart.glb',        weight: 'medium', accent: '#00e5ff' },
  { id: 'gnu',             label: 'Gnu',         modelPath: '/models/stk/karts/gnu/kart.glb',             weight: 'heavy',  accent: '#a67bff' },
  { id: 'hexley',          label: 'Wes',         modelPath: '/models/stk/karts/hexley/kart.glb',          weight: 'medium', accent: '#ffb347' },
  { id: 'nolok',           label: 'Fred',        modelPath: '/models/stk/karts/nolok/kart.glb',           weight: 'heavy',  accent: '#ff3a3a' },
  { id: 'suzanne',         label: 'John',        modelPath: '/models/stk/karts/suzanne/kart.glb',         weight: 'medium', accent: '#f5a623' },
  { id: 'adiumy',          label: 'Angela',      modelPath: '/models/stk/karts/adiumy/kart.glb',          weight: 'light',  accent: '#58cfff' },
  { id: 'amanda',          label: 'Grace',       modelPath: '/models/stk/karts/amanda/kart.glb',          weight: 'medium', accent: '#ff3aa1' },
  { id: 'amazing_panda',   label: 'Sharlene',    modelPath: '/models/stk/karts/amazing_panda/kart.glb',   weight: 'heavy',  accent: '#ffffff' },
  { id: 'bea',             label: 'Christi',     modelPath: '/models/stk/karts/bea/kart.glb',             weight: 'light',  accent: '#ffd866' },
  { id: 'beagle_2',        label: 'Walter',      modelPath: '/models/stk/karts/beagle_2/kart.glb',        weight: 'medium', accent: '#c98a5b' },
  { id: 'carrot',          label: 'Olivia',      modelPath: '/models/stk/karts/carrot/kart.glb',          weight: 'light',  accent: '#ff8c1a' },
  { id: 'chibi',           label: 'Jimbo',       modelPath: '/models/stk/karts/chibi/kart.glb',           weight: 'light',  accent: '#ff6ec7' },
  { id: 'cyberkart',       label: 'Peter',       modelPath: '/models/stk/karts/cyberkart/kart.glb',       weight: 'light',  accent: '#ff00ea' },
  { id: 'elephpant',       label: 'Carrie',      modelPath: '/models/stk/karts/elephpant/kart.glb',       weight: 'heavy',  accent: '#8888ff' },
  { id: 'emule',           label: 'Luca',        modelPath: '/models/stk/karts/emule/kart.glb',           weight: 'medium', accent: '#4da6ff' },
  { id: 'gavroche',        label: 'James',       modelPath: '/models/stk/karts/gavroche/kart.glb',        weight: 'light',  accent: '#ffe066' },
  { id: 'inky',            label: 'Gail',        modelPath: '/models/stk/karts/inky/kart.glb',            weight: 'medium', accent: '#8a2be2' },
  { id: 'kiki',            label: 'Madeline',    modelPath: '/models/stk/karts/kiki/kart.glb',            weight: 'light',  accent: '#ff66cc' },
  { id: 'konqi',           label: 'Judy',        modelPath: '/models/stk/karts/konqi/kart.glb',           weight: 'heavy',  accent: '#3ddc84' },
  { id: 'liz',             label: 'Amelia',      modelPath: '/models/stk/karts/liz/kart.glb',             weight: 'medium', accent: '#ff5e7e' },
  { id: 'minix',           label: 'Max',         modelPath: '/models/stk/karts/minix/kart.glb',           weight: 'light',  accent: '#7afff0' },
  { id: 'mr_iceblock',     label: 'Frost',       modelPath: '/models/stk/karts/mr_iceblock/kart.glb',     weight: 'heavy',  accent: '#a8eaff' },
  { id: 'oem',             label: 'Christopher', modelPath: '/models/stk/karts/oem/kart.glb',             weight: 'medium', accent: '#cccccc' },
  { id: 'ozom',            label: 'Bennett',     modelPath: '/models/stk/karts/ozom/kart.glb',            weight: 'medium', accent: '#ffaa00' },
  { id: 'p2000',           label: 'Stephen',     modelPath: '/models/stk/karts/p2000/kart.glb',           weight: 'medium', accent: '#222222' },
  { id: 'pidgin',          label: 'Zane',        modelPath: '/models/stk/karts/pidgin/kart.glb',          weight: 'light',  accent: '#b2dbef' },
  { id: 'pidgin_2020',     label: 'Perry',       modelPath: '/models/stk/karts/pidgin_2020/kart.glb',     weight: 'light',  accent: '#7ec5e8' },
  { id: 'puffy',           label: 'Anthony',     modelPath: '/models/stk/karts/puffy/kart.glb',           weight: 'medium', accent: '#ffe4a0' },
  { id: 'python',          label: 'Dave',        modelPath: '/models/stk/karts/python/kart.glb',          weight: 'medium', accent: '#4cd964' },
  { id: 'racehicle',       label: 'Ron',         modelPath: '/models/stk/karts/racehicle/kart.glb',       weight: 'heavy',  accent: '#ff2222' },
  { id: 'rx173',           label: 'Michael',     modelPath: '/models/stk/karts/rx173/kart.glb',           weight: 'medium', accent: '#ff7733' },
  { id: 'sara_the_racer',  label: 'Toni',        modelPath: '/models/stk/karts/sara_the_racer/kart.glb',  weight: 'medium', accent: '#ff77aa' },
  { id: 'sara_the_wizard', label: 'Gianna',      modelPath: '/models/stk/karts/sara_the_wizard/kart.glb', weight: 'medium', accent: '#cc88ff' },
  { id: 'sepia',           label: 'Jason',       modelPath: '/models/stk/karts/sepia/kart.glb',           weight: 'medium', accent: '#a07d4f' },
  { id: 'toots',           label: 'Alicia',      modelPath: '/models/stk/karts/toots/kart.glb',           weight: 'light',  accent: '#ffd966' },
  { id: 'transmission',    label: 'Switch',      modelPath: '/models/stk/karts/transmission/kart.glb',    weight: 'medium', accent: '#7777aa' },
  { id: 'wilber',          label: 'Mia',         modelPath: '/models/stk/karts/wilber/kart.glb',          weight: 'heavy',  accent: '#ff9933' },
  { id: 'xue',             label: 'Pat',         modelPath: '/models/stk/karts/xue/kart.glb',             weight: 'light',  accent: '#ffffff' },
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
