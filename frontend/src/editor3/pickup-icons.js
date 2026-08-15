/**
 * pickup-icons.js — hand-authored SVG icon silhouettes for every pickup,
 * used to replace emoji glyphs across all HUDs (inventory slot, roulette,
 * grant floaters). Every icon is a plain white/monochrome silhouette
 * (drawn with `currentColor` / inherited `fill`) on a 0-0-24-24 viewBox —
 * the pickup's own color identity comes from the surrounding gradient
 * background set up in `pickup-visuals.js`, not from the icon itself.
 *
 * Dependency-free (pure strings) so it can be imported anywhere DOM
 * markup is convenient — SP HUD, MP HUD, and the track editor.
 */

// name -> inner-SVG markup (no wrapping <svg> tag — callers add that).
const ICONS = {
  mushroom: `
    <path d="M4 11C4 6 8 3 12 3C16 3 20 6 20 11C20 12.5 18.5 13 12 13C5.5 13 4 12.5 4 11Z"/>
    <rect x="9" y="13" width="6" height="7" rx="1.5"/>
    <circle cx="9" cy="8" r="1.3" opacity="0.4"/>
    <circle cx="14.6" cy="6.6" r="1" opacity="0.4"/>
    <circle cx="16" cy="9.6" r="1.1" opacity="0.4"/>`,

  golden_mushroom: `
    <path d="M4 11C4 6 8 3 12 3C16 3 20 6 20 11C20 12.5 18.5 13 12 13C5.5 13 4 12.5 4 11Z"/>
    <rect x="9" y="13" width="6" height="7" rx="1.5"/>
    <path d="M12 0.6L13 3L12 5.4L11 3Z" opacity="0.85"/>
    <path d="M17.5 2.4L18.1 3.8L19.5 4.4L18.1 5L17.5 6.4L16.9 5L15.5 4.4L16.9 3.8Z" opacity="0.7"/>`,

  star: `<path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>`,

  bullet_bill: `
    <path d="M4 9L14.5 9C17 9 20 10.2 20 12C20 13.8 17 15 14.5 15L4 15Z"/>
    <path d="M4 9L2.2 9.2L2.2 10.4L4 10.6Z"/>
    <path d="M4 13.4L2.2 13.6L2.2 14.8L4 15Z"/>
    <circle cx="8.6" cy="10.9" r="0.95" opacity="0.45"/>
    <circle cx="8.6" cy="13.1" r="0.95" opacity="0.45"/>`,

  green_shell: `
    <path d="M4 15C4 8.5 7.6 4 12 4C16.4 4 20 8.5 20 15Z"/>
    <rect x="3" y="15" width="18" height="2.2" rx="1.1"/>
    <path d="M12 4.4V15M7.7 6.7L9.1 15M16.3 6.7L14.9 15" stroke="currentColor" stroke-width="1" fill="none" opacity="0.55"/>`,
  red_shell: null,
  blue_shell: null,

  banana: `
    <path d="M5 19C5 13 9 5 18 4C18.6 4.6 19.2 6.3 17 8C11.2 9.1 8.2 15 8.2 19C8.2 20.1 6.2 20.2 5 19Z"/>
    <path d="M17 4.2C17.6 3.4 18.6 3 19.4 3.4C19.1 4.3 18.3 4.9 17.4 4.9Z" opacity="0.6"/>`,

  bobomb: `
    <circle cx="12" cy="14" r="7"/>
    <path d="M12 7C11 5.2 13 4.2 12 2" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    <circle cx="12" cy="2" r="1.15"/>
    <circle cx="9.4" cy="11.6" r="1.6" opacity="0.28"/>`,

  bowling_ball: `
    <circle cx="12" cy="12" r="9"/>
    <circle cx="10" cy="8" r="1" fill="#000000" opacity="0.5"/>
    <circle cx="8.6" cy="11" r="1" fill="#000000" opacity="0.5"/>
    <circle cx="11.6" cy="11.5" r="1" fill="#000000" opacity="0.5"/>`,

  cake: `
    <path d="M4 20L20 20L18 15L6 15Z"/>
    <path d="M8 15L16 15L15 10L9 10Z"/>
    <circle cx="12" cy="8.4" r="1.4"/>
    <rect x="11.3" y="4.6" width="1.4" height="3.4"/>
    <path d="M12 1.4C12.9 2.3 12.9 3.4 12 4.4C11.1 3.4 11.1 2.3 12 1.4Z" opacity="0.85"/>`,

  plunger: `
    <rect x="11" y="1.6" width="2" height="10.4" rx="1"/>
    <path d="M7 12L17 12L15 20L9 20Z"/>
    <ellipse cx="12" cy="12" rx="5" ry="1.5" opacity="0.6"/>`,

  nitro: `
    <rect x="8" y="6" width="8" height="14" rx="2"/>
    <rect x="9.5" y="1.6" width="5" height="4.4" rx="1"/>
    <rect x="8" y="11.4" width="8" height="2" opacity="0.5"/>
    <circle cx="12" cy="3.6" r="1"/>`,

  missile: null,
  v8_missile: `
    <path d="M12 2C15 6 15 12 15 16L9 16C9 12 9 6 12 2Z"/>
    <path d="M9 16L6 20.4L9 20.4Z"/>
    <path d="M15 16L18 20.4L15 20.4Z"/>
    <circle cx="12" cy="9" r="1.6" opacity="0.55"/>`,
  v8_rocket: `
    <path d="M12 2C15 6 15 12 15 16L9 16C9 12 9 6 12 2Z"/>
    <path d="M9 16L6 20.4L9 20.4Z"/>
    <path d="M15 16L18 20.4L15 20.4Z"/>
    <circle cx="12" cy="9" r="1.6" opacity="0.55"/>
    <path d="M10 20L12 23.2L14 20Z" opacity="0.8"/>`,

  bubblegum: `
    <circle cx="12" cy="13" r="7"/>
    <circle cx="9.6" cy="10.6" r="1.9" opacity="0.35"/>
    <circle cx="18.4" cy="6" r="1.4"/>
    <circle cx="20.2" cy="9.2" r="0.9"/>`,

  swatter: `
    <rect x="11" y="13" width="2" height="9.4" rx="1"/>
    <rect x="5" y="3" width="14" height="11" rx="3"/>
    <path d="M8 5.5V11.5M12 5.5V11.5M16 5.5V11.5M6.5 7H17.5M6.5 10.5H17.5" stroke="currentColor" stroke-width="0.6" fill="none" opacity="0.45"/>`,

  parachute: `
    <path d="M2 11C2 6 5.5 3 12 3C18.5 3 22 6 22 11C15.5 9.4 8.5 9.4 2 11Z"/>
    <path d="M4 11L10 19M8 11L11 19M16 11L13 19M20 11L14 19" stroke="currentColor" stroke-width="0.9" fill="none" opacity="0.6"/>
    <rect x="9.5" y="19" width="5" height="3" rx="0.8"/>`,

  anchor: `
    <circle cx="12" cy="4.4" r="2.1" fill="none" stroke="currentColor" stroke-width="1.6"/>
    <rect x="11.2" y="6.6" width="1.6" height="11.6"/>
    <rect x="7" y="9.6" width="10" height="1.6"/>
    <path d="M12 18.2C9 18.2 6.2 16.6 5.2 13.6M12 18.2C15 18.2 17.8 16.6 18.8 13.6" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,

  ludicrous_mode: `<path d="M13 2L5 14L11 14L9.5 22L19 10L12.5 10Z"/>`,

  shield: `
    <path d="M12 2L20 5L20 11C20 17 16.5 21 12 22C7.5 21 4 17 4 11L4 5Z"/>
    <path d="M8 11.4L11.4 15L17 8" stroke="#0a0d12" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.55"/>`,
  v8_shield: null,

  coin: `
    <circle cx="12" cy="12" r="9"/>
    <circle cx="12" cy="12" r="6.4" fill="none" stroke="#000000" stroke-width="1" opacity="0.3"/>
    <rect x="11" y="6" width="2" height="12" opacity="0.4"/>`,

  v8_cannon: `
    <circle cx="12" cy="18" r="5"/>
    <rect x="10.5" y="3" width="3" height="14" rx="1.4" transform="rotate(15 12 12)"/>`,

  v8_mortar: `
    <rect x="6" y="13" width="12" height="6" rx="2" transform="rotate(-20 12 16)"/>
    <rect x="4" y="19" width="16" height="3" rx="1.4"/>
    <circle cx="12" cy="8" r="3"/>`,

  v8_mine: `
    <circle cx="12" cy="12" r="5"/>
    <path d="M12 4V7M12 17V20M4 12H7M17 12H20M6.3 6.3L8.4 8.4M15.6 15.6L17.7 17.7M6.3 17.7L8.4 15.6M15.6 8.4L17.7 6.3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,

  v8_dynamite: `
    <rect x="6" y="6" width="3" height="14" rx="1.4"/>
    <rect x="10.5" y="5" width="3" height="15" rx="1.4"/>
    <rect x="15" y="6" width="3" height="14" rx="1.4"/>
    <rect x="5" y="11" width="14" height="2" opacity="0.55"/>
    <path d="M12 5C11 3.6 13 2.6 12 1.2" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/>`,

  v8_firethrower: `
    <path d="M12 2C16 7 18 10 15 15C17 15 18 18 15 20C12 22 8 20 7 17C5 14 7 11 9 9C8 12 9 13 10 12C9 9 10 5 12 2Z"/>`,

  v8_repair: `
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/>
    <rect x="10.6" y="6" width="2.8" height="12" rx="1"/>
    <rect x="6" y="10.6" width="12" height="2.8" rx="1"/>`,

  v8_double_dmg: `
    <rect x="11" y="2" width="2" height="20" rx="1" transform="rotate(35 12 12)"/>
    <rect x="11" y="2" width="2" height="20" rx="1" transform="rotate(-35 12 12)"/>`,

  health_orb: `
    <path d="M12 21C12 21 4 14.5 4 8.8C4 5.6 6.6 3 9.6 3C11.2 3 12 4 12 4C12 4 12.8 3 14.4 3C17.4 3 20 5.6 20 8.8C20 14.5 12 21 12 21Z"/>`,

  default: `
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/>
    <path d="M9 9C9 6 15 6 15 9C15 11.5 12 11.5 12 14" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>
    <circle cx="12" cy="18" r="1.3"/>`,
};

// Shared aliases — pickups that reuse another item's silhouette (recolored
// via the background gradient, which already carries their identity).
ICONS.red_shell = ICONS.green_shell;
ICONS.blue_shell = ICONS.green_shell;
ICONS.missile = ICONS.v8_missile;
ICONS.v8_shield = ICONS.shield;
ICONS.rocket = ICONS.v8_rocket;
ICONS.mortar = ICONS.v8_mortar;
ICONS.mine = ICONS.v8_mine;
ICONS.dynamite = ICONS.v8_dynamite;
ICONS.firethrower = ICONS.v8_firethrower;
ICONS.repair = ICONS.v8_repair;
ICONS.double_dmg = ICONS.v8_double_dmg;

/** Returns the inner-SVG markup (paths/shapes only) for a pickup name. */
export function getPickupIconMarkup(name) {
  return ICONS[name] || ICONS.default;
}
