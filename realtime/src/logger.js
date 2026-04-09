/**
 * logger.js — Shared structured JSON logger for the realtime server.
 * Outputs one JSON object per line for easy aggregation.
 */

export function log(level, event, data = {}) {
  const entry = { ts: new Date().toISOString(), level, event, ...data };
  if (level === 'error') console.error(JSON.stringify(entry));
  else console.log(JSON.stringify(entry));
}
