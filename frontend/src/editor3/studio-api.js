/**
 * GLO KARTS Studio — backend API client.
 *
 * Anonymous owner-token identity: a UUID is generated on first visit and
 * persisted to localStorage. Every mutation sends it as `X-Owner-Token`.
 */

const API_BASE = (import.meta.env?.VITE_API_URL || 'http://localhost:8000').replace(/\/+$/, '');
const OWNER_KEY = 'gloKartsStudio.ownerToken';

export function getOwnerToken() {
  let token = null;
  try { token = localStorage.getItem(OWNER_KEY); } catch {}
  if (!token) {
    token = (crypto?.randomUUID?.() || `anon-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`);
    try { localStorage.setItem(OWNER_KEY, token); } catch {}
  }
  return token;
}

async function apiFetch(path, { method = 'GET', body, signal } = {}) {
  const headers = { 'Accept': 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const ownerToken = getOwnerToken();
  if (ownerToken) headers['X-Owner-Token'] = ownerToken;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error || JSON.stringify(await res.json()); } catch {}
    const err = new Error(`API ${method} ${path} → ${res.status} ${detail}`.trim());
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

export const StudioAPI = {
  apiBase: API_BASE,
  ownerToken: getOwnerToken,

  /** GET paginated/sorted templates. opts: { sort, q, page } */
  templates(opts = {}) {
    return apiFetch(`/api/tracks/templates/?${qs(opts)}`);
  },
  community(opts = {}) {
    return apiFetch(`/api/tracks/community/?${qs(opts)}`);
  },
  mine(opts = {}) {
    return apiFetch(`/api/tracks/mine/?${qs(opts)}`);
  },
  get(id, { play = false } = {}) {
    return apiFetch(`/api/tracks/${id}/${play ? '?play=1' : ''}`);
  },
  create({ name, author_name = '', description = '', track_data, thumbnail = '', tags = '', is_public = false }) {
    return apiFetch('/api/tracks/', {
      method: 'POST',
      body: { name, author_name, description, track_data, thumbnail, tags, is_public },
    });
  },
  update(id, patch) {
    return apiFetch(`/api/tracks/${id}/update/`, { method: 'PATCH', body: patch });
  },
  remove(id) {
    return apiFetch(`/api/tracks/${id}/delete/`, { method: 'DELETE' });
  },
  remix(id, { name, author_name = '' } = {}) {
    return apiFetch(`/api/tracks/${id}/remix/`, { method: 'POST', body: { name, author_name } });
  },
};

function qs(obj) {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  return parts.join('&');
}
