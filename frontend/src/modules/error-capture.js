/**
 * error-capture.js — Lightweight frontend error reporter
 *
 * Captures unhandled errors and promise rejections, stores the last N
 * in memory for debugging. In production, can POST to a configurable
 * endpoint for server-side aggregation.
 */

const MAX_ERRORS = 50;
const _errors = [];

function capture(level, message, meta = {}) {
  const entry = {
    ts: Date.now(),
    level,
    message,
    url: location.href,
    ...meta,
  };
  _errors.push(entry);
  if (_errors.length > MAX_ERRORS) _errors.shift();

  if (level === 'error') console.error('[error-capture]', message, meta);
}

/** Returns the in-memory error log (read-only copy). */
export function getErrorLog() {
  return [..._errors];
}

/** Clears the in-memory error log. */
export function clearErrorLog() {
  _errors.length = 0;
}

/** Initialize global error listeners. Call once on page load. */
export function initErrorCapture() {
  window.addEventListener('error', (e) => {
    capture('error', e.message, {
      filename: e.filename,
      line: e.lineno,
      col: e.colno,
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    capture('error', `Unhandled rejection: ${e.reason}`, {
      reason: String(e.reason),
    });
  });
}
