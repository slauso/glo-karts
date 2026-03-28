/**
 * debug-telemetry.js — Exposes a compact __gloDebug snapshot on window
 * for diagnosing routing/content resolution failures in the browser console.
 *
 * Usage:  JSON.stringify(window.__gloDebug, null, 2) in DevTools
 */

/**
 * Publish the resolved mode/content state to window.__gloDebug.
 * Safe to call multiple times — latest call wins.
 *
 * @param {object} gameConfig - The resolved gameConfig from sessionStorage
 * @param {object} [extras]   - Additional runtime-discovered fields
 */
export function publishDebugSnapshot(gameConfig, extras = {}) {
  if (!gameConfig) return;

  window.__gloDebug = Object.freeze({
    modeId:            gameConfig.modeId || gameConfig.subMode || null,
    subMode:           gameConfig.subMode || null,
    trackId:           gameConfig.trackId || null,
    arenaId:           gameConfig.arenaId || null,
    cupId:             gameConfig.cupId || null,
    resolvedContentId: gameConfig.resolvedContentId || gameConfig.trackId || gameConfig.arenaId || null,
    contentType:       gameConfig.contentType || null,
    botCount:          gameConfig.botCount ?? null,
    fallbackCause:     gameConfig.fallbackCause || null,
    multiplayer:       !!gameConfig.multiplayer,
    runtimeProvider:   gameConfig.runtimeProvider || null,
    selectedKart:      gameConfig.selectedKart || null,
    battleType:        gameConfig.battleType || null,
    timestamp:         new Date().toISOString(),
    ...extras,
  });
}
