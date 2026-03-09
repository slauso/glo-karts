/**
 * GLO KARTS — Shared Playwright test helpers
 *
 * Provides:
 *  - injectGameConfig(page, cfg)  — set sessionStorage before navigation
 *  - waitForDebug(page, fn, timeout) — poll window.__gloDebug until predicate passes
 *  - readDebug(page)              — snapshot current window.__gloDebug
 *  - isCriticalError(msg)         — filter benign network / asset errors
 *  - BATTLE_CONFIG / RACE_CONFIG  — sensible test defaults
 */

/** Filter strings that represent genuine runtime JS errors vs benign noise */
export const isCriticalError = (msg) =>
  !msg.includes('WebSocket') &&
  !msg.includes('net::') &&
  !msg.includes('favicon') &&
  !msg.includes('404') &&
  !msg.includes('Failed to fetch') &&
  !msg.includes('Havok') &&
  !msg.includes('ResizeObserver') &&
  !msg.includes('raycast') &&
  !msg.includes('doRaycast') &&
  !msg.includes('model-viewer') &&
  !msg.includes('AudioContext') &&
  !msg.includes('boing.ogg') &&
  !msg.includes('NotSupportedError') &&
  !msg.includes('already been declared');

/** Default config for battle-mode tests */
export const BATTLE_CONFIG = {
  gameMode:    'battle',
  trackId:     'battleisland',
  battleType:  'deathmatch',
  maxPlayers:  2,
  scoreLimit:  5,
  selectedKart: 'tux',
};

/** Default config for race-mode tests */
export const RACE_CONFIG = {
  gameMode:    'race',
  trackId:     'cocoa_temple',
  maxPlayers:  2,
  selectedKart: 'tux',
};

/**
 * Inject sessionStorage game config before page.goto() so the realtime client
 * picks up the right room type, map, kart etc.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} cfg   — merged on top of BATTLE_CONFIG defaults
 */
export async function injectGameConfig(page, cfg = {}) {
  const merged = { ...BATTLE_CONFIG, ...cfg };
  await page.addInitScript((config) => {
    sessionStorage.setItem('gameConfig', JSON.stringify(config));
    sessionStorage.setItem('myPlayerId', 'test-player-001');
    sessionStorage.setItem('selectedKart', config.selectedKart || 'tux');
    sessionStorage.setItem('gloEffect', config.gloEffect || 'solid');
    sessionStorage.setItem('gloColor',  config.gloColor  || '#ff0080');
    sessionStorage.setItem('gloColor2', config.gloColor2 || '#00e5ff');
  }, merged);
}

/**
 * Poll window.__gloDebug until `predicate(debug)` returns true.
 *
 * @param {import('@playwright/test').Page} page
 * @param {function} predicate  — receives the __gloDebug snapshot
 * @param {number}   timeout    — ms before giving up (default 25 000)
 */
export async function waitForDebug(page, predicate, timeout = 25_000) {
  const predicateStr = predicate.toString();
  await page.waitForFunction(
    (pred) => {
      const d = window.__gloDebug;
      if (!d) return false;
      // eslint-disable-next-line no-new-func
      return (new Function('d', `return (${pred})(d)`))(d);
    },
    predicateStr,
    { timeout },
  );
}

/**
 * Return a snapshot of window.__gloDebug from the page.
 * Safe to call at any time — returns {} if the bus isn't initialised yet.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<object>}
 */
export async function readDebug(page) {
  return page.evaluate(() => {
    const d = window.__gloDebug;
    if (!d) return {};
    // Serialise only plain-JSON-safe fields (no DOM refs)
    return JSON.parse(JSON.stringify(d));
  });
}

/**
 * Teleport the local kart mesh to a given world position via evaluate().
 * Useful for triggering item-box pickups or testing out-of-bounds respawn.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ x: number, y: number, z: number }} pos
 */
export async function teleportKart(page, pos) {
  await page.evaluate((p) => {
    const c = window.__gloClient;
    if (!c?.localMesh) return;
    c.localMesh.position.set(p.x, p.y, p.z);
    if (c.localKartAggregate?.body) {
      c.localKartAggregate.body.setLinearVelocity({ x: 0, y: 0, z: 0 });
      c.localKartAggregate.body.setAngularVelocity({ x: 0, y: 0, z: 0 });
    }
  }, pos);
}

/**
 * Return { x, y, z } for the first active item box in state.entities.
 * Returns null if none found.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function getFirstItemBoxPos(page) {
  return page.evaluate(() => {
    const c = window.__gloClient;
    if (!c?.authoritativeState?.entities) return null;
    for (const [, ent] of c.authoritativeState.entities.entries()) {
      if (ent.type === 'item_box' && ent.active) {
        return { x: ent.x, y: ent.y, z: ent.z };
      }
    }
    return null;
  });
}

/**
 * Wait for the match to go live (matchLive message received) on both pages,
 * polling __gloDebug.matchLive.
 *
 * @param {import('@playwright/test').Page[]} pages
 * @param {number} timeout
 */
export async function waitForMatchLive(pages, timeout = 30_000) {
  await Promise.all(
    pages.map((p) => waitForDebug(p, (d) => d.matchLive === true, timeout)),
  );
}
