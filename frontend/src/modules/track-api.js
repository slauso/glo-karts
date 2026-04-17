/**
 * track-api.js — Client for the TinkerTracks community track API.
 *
 * Communicates with the Django backend at /api/tracks/.
 */

const BASE_URL = '/api/tracks';

/**
 * Publish a track to the community gallery.
 * @param {{ name: string, author: string, description?: string, trackData: object, tags?: string }} payload
 * @returns {Promise<{ id: string, name: string, author: string, created_at: string }>}
 */
export async function publishTrack({ name, author, description, trackData, tags }) {
  const res = await fetch(`${BASE_URL}/publish/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, author, description, trackData, tags }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Publish failed (${res.status})`);
  }
  return res.json();
}

/**
 * Browse community tracks with pagination and sorting.
 * @param {{ sort?: 'newest'|'popular'|'top_rated', page?: number, per_page?: number, q?: string }} options
 */
export async function browseTracks({ sort = 'newest', page = 1, per_page = 20, q = '' } = {}) {
  const params = new URLSearchParams({ sort, page: String(page), per_page: String(per_page) });
  if (q) params.set('q', q);
  const res = await fetch(`${BASE_URL}/browse/?${params}`);
  if (!res.ok) throw new Error(`Browse failed (${res.status})`);
  return res.json();
}

/**
 * Get a single track by ID (includes full trackData).
 * @param {string} trackId
 */
export async function getTrack(trackId) {
  const res = await fetch(`${BASE_URL}/${encodeURIComponent(trackId)}/`);
  if (!res.ok) throw new Error(`Track not found (${res.status})`);
  return res.json();
}

/**
 * Rate a track (1-5 stars).
 * @param {string} trackId
 * @param {number} rating
 */
export async function rateTrack(trackId, rating) {
  const res = await fetch(`${BASE_URL}/${encodeURIComponent(trackId)}/rate/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating: Math.max(1, Math.min(5, Math.round(rating))) }),
  });
  if (!res.ok) throw new Error(`Rating failed (${res.status})`);
  return res.json();
}
