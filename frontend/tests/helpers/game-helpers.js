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
  !msg.includes('403') &&
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
  trackId:     'glo_arena',
  battleType:  'deathmatch',
  maxPlayers:  2,
  scoreLimit:  5,
  selectedKart: 'tux',
};

/** Default config for race-mode tests */
export const RACE_CONFIG = {
  gameMode:    'race',
  trackId:     'test_box',
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
    sessionStorage.setItem('myPlayerId', config.testPlayerId || `test-player-${Date.now()}-${Math.floor(Math.random() * 100000)}`);
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
    const body = c.localKartAggregate?.body;
    // Teleport the mesh
    c.localMesh.position.set(p.x, p.y, p.z);
    if (body) {
      // Tell Havok physics to sync body FROM mesh position next pre-step
      body.disablePreStep = false;
      body.setLinearVelocity({ x: 0, y: 0, z: 0 });
      body.setAngularVelocity({ x: 0, y: 0, z: 0 });
    }
  }, pos);
  // Wait one physics frame for the body to sync from the mesh
  await page.waitForTimeout(100);
  // Re-enable physics-driven mesh (body drives mesh position again)
  await page.evaluate(() => {
    const body = window.__gloClient?.localKartAggregate?.body;
    if (body) body.disablePreStep = true;
  });
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

export async function debugGrantWeapon(page, weaponId, targetId = null, ammo = null) {
  await page.evaluate(({ weaponId: nextWeaponId, targetId: nextTargetId, ammo: nextAmmo }) => {
    const room = window.__gloClient?.room;
    if (!room) return;
    room.send('debugGrantWeapon', {
      weaponId: nextWeaponId,
      targetId: nextTargetId,
      ammo: nextAmmo,
    });
  }, { weaponId, targetId, ammo });
}

export async function debugTeleportAuthoritative(page, pos, targetId = null) {
  await page.evaluate(({ pos: nextPos, targetId: nextTargetId }) => {
    const room = window.__gloClient?.room;
    if (!room) return;
    room.send('debugTeleport', {
      targetId: nextTargetId,
      x: nextPos.x,
      y: nextPos.y,
      z: nextPos.z,
      heading: nextPos.heading,
    });
  }, { pos, targetId });
}

export async function getSessionId(page) {
  return page.evaluate(() => window.__gloDebug?.sessionId || null);
}

export async function getRoomId(page) {
  return page.evaluate(() => window.__gloDebug?.roomId || window.__gloClient?.room?.id || null);
}

export async function waitForAuthoritativePosition(page, playerId, expected, tolerance = 0.75, timeout = 5_000) {
  await page.waitForFunction(
    ({ targetId, targetPos, toleranceRadius }) => {
      const players = window.__gloClient?.authoritativeState?.players;
      if (!players) return false;
      const player = players.get?.(targetId);
      if (!player) return false;
      const dx = Number(player.x || 0) - Number(targetPos.x || 0);
      const dy = Number(player.y || 0) - Number(targetPos.y || 0);
      const dz = Number(player.z || 0) - Number(targetPos.z || 0);
      return (dx * dx + dy * dy + dz * dz) <= (toleranceRadius * toleranceRadius);
    },
    {
      targetId: playerId,
      targetPos: expected,
      toleranceRadius: tolerance,
    },
    { timeout },
  );
}

export async function getProjectileSubTypes(page) {
  return page.evaluate(() => {
    const entities = window.__gloClient?.authoritativeState?.entities;
    if (!entities) return [];
    const result = [];
    for (const [, entity] of entities.entries()) {
      if (entity.type === 'projectile' && entity.active) result.push(entity.subType);
    }
    return result;
  });
}

export async function getActiveProjectiles(page) {
  return page.evaluate(() => {
    const entities = window.__gloClient?.authoritativeState?.entities;
    if (!entities) return [];
    const result = [];
    for (const [, entity] of entities.entries()) {
      if (entity.type !== 'projectile' || !entity.active) continue;
      result.push({
        id: entity.id,
        ownerId: entity.ownerId,
        subType: entity.subType,
        x: entity.x,
        y: entity.y,
        z: entity.z,
      });
    }
    return result;
  });
}

export async function getAuthoritativePlayerState(page, playerId) {
  return page.evaluate((targetId) => {
    const players = window.__gloClient?.authoritativeState?.players;
    if (!players) return null;
    let player = players.get?.(targetId) || null;
    if (!player && players.forEach) {
      players.forEach((candidate) => {
        if (!player && candidate?.id === targetId) player = candidate;
      });
    }
    if (!player) return null;
    return {
      id: player.id,
      x: player.x,
      y: player.y,
      z: player.z,
      weapon: player.weapon,
      ammo: player.ammo,
      fireCooldown: player.fireCooldown,
      weapon2: player.weapon2,
      ammo2: player.ammo2,
      fireCooldown2: player.fireCooldown2,
      weapon3: player.weapon3,
      ammo3: player.ammo3,
      effectType: player.effectType,
      effectTimer: player.effectTimer,
      shielded: player.shielded,
      shieldHP: player.shieldHP,
      reflectProjectiles: player.reflectProjectiles,
      phased: player.phased,
      speedMultiplier: player.speedMultiplier,
      steerMultiplier: player.steerMultiplier,
      health: player.health,
    };
  }, playerId);
}

export async function fireCurrentWeapon(page, slot = 'secondary') {
  await page.evaluate((s) => {
    const client = window.__gloClient;
    const room = client?.room;
    if (!room) return;
    const payload = typeof client?._buildFirePayload === 'function'
      ? client._buildFirePayload(s)
      : {};
    room.send('fireWeapon', { ...payload, slot: s });
  }, slot);
}
