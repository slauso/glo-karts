/**
 * backend-client.js — Tiny HTTP client for the Django tracks API.
 *
 * The realtime server uses this to fetch persisted Track JSON when a room is
 * created with a `trackId` option. Uses Node 18+ built-in `fetch`.
 */
const DEFAULT_BASE = process.env.BACKEND_URL || 'http://localhost:8000';

/**
 * Fetch a track by id and return the parsed `track_data` envelope.
 * @param {string} trackId UUID
 * @param {{ baseUrl?: string, incrementPlayCount?: boolean, signal?: AbortSignal }} [opts]
 * @returns {Promise<object>} backend envelope (`{track, decor, meta}`)
 */
export async function fetchTrack(trackId, opts = {}) {
  if (!trackId || typeof trackId !== 'string') {
    throw new Error(`fetchTrack: invalid trackId (${trackId})`);
  }
  const base = opts.baseUrl || DEFAULT_BASE;
  const url = `${base.replace(/\/$/, '')}/api/tracks/${trackId}/${opts.incrementPlayCount ? '?play=1' : ''}`;
  const res = await fetch(url, { signal: opts.signal });
  if (res.status === 404) {
    throw new Error(`fetchTrack: track ${trackId} not found`);
  }
  if (!res.ok) {
    throw new Error(`fetchTrack: backend returned HTTP ${res.status}`);
  }
  const json = await res.json();
  // Backend returns the full Track row; track_data is the persisted envelope.
  return json.track_data ?? json;
}
