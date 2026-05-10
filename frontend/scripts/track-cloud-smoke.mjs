/**
 * track-cloud-smoke.mjs — Phase 2.5 backend integration probe.
 *
 * Verifies the full Studio cloud lifecycle that the lobby relies on:
 *   1. POST /api/tracks/        with X-Owner-Token  -> create
 *   2. GET  /api/tracks/mine/   with same token     -> contains the new id
 *   3. PATCH .../update/        is_public:true       -> publish
 *   4. GET  /api/tracks/community/                   -> contains the id
 *   5. DELETE .../delete/                            -> 204
 *
 * Run with backend already up on localhost:8000:
 *     python backend/manage.py runserver 8000
 *     node frontend/scripts/track-cloud-smoke.mjs
 */
const BASE = process.env.GLO_API || 'http://127.0.0.1:8000';
const OWNER = `smoke-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 8)}`;

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      'X-Owner-Token': OWNER,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => '');
    throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function main() {
  const trackData = {
    track: {
      name: 'Smoke Test Loop',
      placements: [
        { k: 'spawn', x: 0, z: 0, r: 0 },
        { k: 'straight', x: 0, z: 1, r: 0 },
        { k: 'finish', x: 0, z: 2, r: 0 },
      ],
    },
    decor: { items: [] },
  };

  console.log('[smoke] owner=', OWNER);

  // 1. Create
  const created = await api('/api/tracks/', {
    method: 'POST',
    body: { name: 'Smoke Test Loop', author_name: 'SmokeBot', track_data: trackData, is_public: false },
  });
  console.log('[smoke] created id=', created.id, 'is_public=', created.is_public);

  // 2. Mine
  const mine = await api('/api/tracks/mine/');
  if (!mine.results.find((t) => t.id === created.id)) {
    throw new Error('mine list missing newly created track');
  }
  console.log('[smoke] mine count=', mine.results.length);

  // 3. Publish
  const published = await api(`/api/tracks/${created.id}/update/`, {
    method: 'PATCH',
    body: { is_public: true },
  });
  if (!published.is_public) throw new Error('publish did not set is_public');
  console.log('[smoke] published');

  // 4. Community
  const community = await api('/api/tracks/community/?sort=newest&page=1');
  if (!community.results.find((t) => t.id === created.id)) {
    throw new Error('community list missing published track');
  }
  console.log('[smoke] community contains track');

  // 5. Delete (cleanup)
  await api(`/api/tracks/${created.id}/delete/`, { method: 'DELETE' });
  console.log('[smoke] deleted');

  // 6. Templates still resolve (sanity)
  const templates = await api('/api/tracks/templates/');
  if (!Array.isArray(templates.results) || templates.results.length === 0) {
    throw new Error('templates list empty');
  }
  console.log(`[smoke] templates=${templates.results.length} (${templates.results.map((t) => t.name).join(', ')})`);

  console.log('[smoke] PASS');
}

main().catch((err) => {
  console.error('[smoke] FAIL', err);
  process.exit(1);
});
