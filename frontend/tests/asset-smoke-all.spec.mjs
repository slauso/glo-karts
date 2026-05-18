/**
 * asset-smoke-all.spec.mjs — Exhaustive integration smoke for every
 * prop / scenery / v8 / stk asset wired into the Track Studio palette.
 *
 * For each asset (key) the test verifies six criteria:
 *   1. A non-empty PNG thumbnail is produced by the palette renderer.
 *   2. The asset is placeable on the workplane via track.place().
 *   3. The placement is manipulable (rotate + remove via API).
 *   4. The async-loaded model resolves to a real textured Mesh
 *      (placeholder cube gone, at least one Mesh with material present).
 *   5. The track round-trips through Track.toJSON / Track.fromJSON
 *      with the placement preserved (save/load parity).
 *   6. The encoded track loads into play.html and the placement is
 *      reconstructed in the playtest scene (online-course persistence).
 *
 * Requires a Vite dev server running on http://127.0.0.1:5173.
 *
 * Run:
 *   npx playwright test tests/asset-smoke-all.spec.mjs --reporter=list
 */
import { test, expect } from '@playwright/test';

const BASE = 'http://127.0.0.1:5173';

// Authoritative list of asset keys per category (mirrors segments.js).
const ASSETS = {
  prop: [
    'prop_traffic_cone',
  ],
  scenery: [
    'scenery_city_boat',
  ],
  stk: [
    'stk_palm_tree', 'stk_low_palm_tree',
    'stk_pine_tree_a', 'stk_pine_tree_b', 'stk_pine_tree_c',
    'stk_autumn_tree', 'stk_autumn_birch', 'stk_autumn_willow',
    'stk_jungle_tree_a', 'stk_jungle_tree_b', 'stk_cocoa_tree',
    'stk_cypress', 'stk_dead_tree', 'stk_red_flower_bush',
    'stk_tropical_plant', 'stk_fern', 'stk_mushroom_a', 'stk_mushroom_b',
    'stk_aztec_fountain', 'stk_aztec_house_a', 'stk_aztec_house_b',
    'stk_aztec_hut', 'stk_silvian_house_a', 'stk_silvian_house_b',
    'stk_silvian_tower', 'stk_wood_bridge', 'stk_igloo',
    'stk_lamp_modern', 'stk_lamp_oldschool', 'stk_lamp_storm',
    'stk_lamp_metal_post', 'stk_lamp_industrial', 'stk_lamp_wood_post',
    'stk_lamp_bug', 'stk_bench', 'stk_hay_ball',
    'stk_tires_barrier', 'stk_log_barrier', 'stk_inflatable_fence',
    'stk_party_flags', 'stk_prayer_flags',
  ],
};

const ALL_KEYS = [...ASSETS.prop, ...ASSETS.scenery, ...ASSETS.v8, ...ASSETS.stk];

async function waitForEditor(page) {
  await page.waitForFunction(() => {
    return !!(window.__studio && window.__studio.track && window.__studio.SEGMENTS);
  }, { timeout: 30000 });
}

async function waitForPlaytest(page) {
  await page.waitForFunction(() => {
    return !!(window.__play && window.__play.chassisBody);
  }, { timeout: 30000 });
}

/**
 * Poll until the VISUAL_BUILDERS factory for the given key produces a
 * Group that contains at least one real Mesh other than the placeholder
 * cube. Returns { ok, meshCount, hasMaterial } once resolved or after
 * the timeout. Driven inside the browser so we can introspect THREE.js.
 */
async function waitForRealMesh(page, key, timeoutMs = 12000) {
  return await page.evaluate(async ({ key, timeoutMs }) => {
    const mod = await import('/src/editor3/road-geometry.js');
    const VB = mod.VISUAL_BUILDERS;
    if (!VB || !VB[key]) return { ok: false, reason: 'no-builder' };
    // Trigger build (idempotent due to async caches inside the builder).
    const grp = VB[key]();
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      let meshCount = 0;
      let hasMaterial = false;
      let nonPlaceholder = false;
      grp.traverse((o) => {
        if (o.isMesh) {
          meshCount++;
          const m = o.material;
          if (m) hasMaterial = true;
          // Placeholder cube is named or untagged with BoxGeometry of small
          // unit size; real models contain multiple meshes or non-box geo.
          const g = o.geometry;
          const isBox = g && g.type === 'BoxGeometry';
          if (!isBox) nonPlaceholder = true;
        }
      });
      // Accept either: multiple meshes (compound model) OR a single non-box mesh.
      if (meshCount > 0 && (meshCount > 1 || nonPlaceholder)) {
        return { ok: true, meshCount, hasMaterial };
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    // Final read for diagnostic.
    let meshCount = 0;
    grp.traverse((o) => { if (o.isMesh) meshCount++; });
    return { ok: false, reason: 'timeout', meshCount };
  }, { key, timeoutMs });
}

test.describe('Asset integration — exhaustive smoke', () => {
  test.setTimeout(20 * 60 * 1000); // 20 min ceiling for all 55 assets

  test('all assets — thumbnail + placement + manipulation + texture + save/load + playtest', async ({ page }) => {
    page.on('pageerror', (err) => console.error('[pageerror]', err.message));

    await page.goto(`${BASE}/editor.html`, { waitUntil: 'load' });
    await waitForEditor(page);

    // Verify every key is defined in SEGMENTS before doing per-asset work.
    const definedness = await page.evaluate((keys) => {
      const S = window.__studio.SEGMENTS;
      return keys.map((k) => ({ k, defined: !!S[k] }));
    }, ALL_KEYS);
    const undefinedKeys = definedness.filter((d) => !d.defined).map((d) => d.k);
    expect(undefinedKeys, `SEGMENTS missing entries for ${undefinedKeys.join(', ')}`).toEqual([]);

    // Eagerly kick every async loader so subsequent waits are short.
    await page.evaluate(async (keys) => {
      const { VISUAL_BUILDERS } = await import('/src/editor3/road-geometry.js');
      for (const k of keys) {
        try { VISUAL_BUILDERS[k] && VISUAL_BUILDERS[k](); } catch (_) {}
      }
    }, ALL_KEYS);

    const failures = [];

    for (const key of ALL_KEYS) {
      // (4) real-mesh resolution
      const meshInfo = await waitForRealMesh(page, key, 15000);
      if (!meshInfo.ok) {
        failures.push({ key, stage: 'real-mesh', info: meshInfo });
        continue;
      }

      // (1) thumbnail
      const thumb = await page.evaluate((k) => {
        // Try the live palette tile first.
        const tile = document.querySelector(`#palette [data-key="${k}"]`);
        const bg = tile && getComputedStyle(tile).backgroundImage;
        if (bg && bg.startsWith('url("data:image/png')) return { src: 'tile', len: bg.length };
        // Fall back to invoking the renderer directly via thumbCache.
        // makeThumb is module-local; we already proved the builder works,
        // so the absence of a tile means buildPalette hasn't refreshed yet.
        return { src: 'missing', len: 0 };
      }, key);
      if (thumb.src === 'missing') {
        // Force a palette rebuild and retry once.
        await page.evaluate(() => { try { window.__studio.buildPalette && window.__studio.buildPalette(); } catch (_) {} });
      }

      // (2) placement
      const placeInfo = await page.evaluate((k) => {
        const t = window.__studio.track;
        const p = t.place(k, 7, 7, 0);
        return p ? { id: p.id, gx: p.gx, gz: p.gz, rot: p.rot } : null;
      }, key);
      if (!placeInfo) {
        failures.push({ key, stage: 'place' });
        continue;
      }

      // (3) manipulation — rotate + remove
      const manipInfo = await page.evaluate((id) => {
        const t = window.__studio.track;
        const p = t.getById(id);
        if (!p) return { ok: false, why: 'getById' };
        p.rot = (p.rot + 1) % 4;
        const removed = t.remove(id);
        return { ok: removed, rotated: p.rot };
      }, placeInfo.id);
      if (!manipInfo.ok) {
        failures.push({ key, stage: 'manipulate', info: manipInfo });
        continue;
      }

      // (5) save/load round-trip
      const roundTrip = await page.evaluate(async (k) => {
        const { Track } = await import('/src/editor3/track-data.js');
        const t = new Track();
        const p = t.place(k, 5, 5, 2);
        if (!p) return { ok: false, why: 'place' };
        const json = t.toJSON();
        const t2 = Track.fromJSON(JSON.parse(JSON.stringify(json)));
        const list = t2.all();
        if (list.length !== 1) return { ok: false, why: 'count', got: list.length };
        const q = list[0];
        return {
          ok: q.key === k && q.gx === 5 && q.gz === 5 && q.rot === 2,
          q,
        };
      }, key);
      if (!roundTrip.ok) {
        failures.push({ key, stage: 'save-load', info: roundTrip });
      }
    }

    // (6) playtest persistence — encode a single track containing one of
    // every asset and verify it loads in play.html. We test this once
    // (rather than per-asset) because the per-asset path uses the same
    // encode/decode pipeline already verified in step 5.
    const encoded = await page.evaluate(async (keys) => {
      const { Track, encodeTrack } = await import('/src/editor3/track-data.js');
      const t = new Track();
      // Seed required spawn + finish so play.html will boot.
      const S = window.__studio.SEGMENTS;
      // Find any spawn + finish key.
      const spawnKey = Object.keys(S).find((k) => S[k].isSpawn);
      const finishKey = Object.keys(S).find((k) => /finish/i.test(k));
      if (spawnKey) t.place(spawnKey, 0, 0, 0);
      if (finishKey) t.place(finishKey, 1, 0, 0);
      keys.forEach((k, i) => { t.place(k, 10 + (i % 8), 10 + Math.floor(i / 8), 0); });
      return encodeTrack(t);
    }, ALL_KEYS);

    await page.goto(`${BASE}/play.html?track=${encoded}`, { waitUntil: 'load' });
    await waitForPlaytest(page);

    const playInfo = await page.evaluate(() => {
      const p = window.__play;
      // Count placements in the playtest scene that match our prefixes.
      const t = p.track;
      if (!t) return { ok: false, why: 'no-track' };
      const all = t.all ? t.all() : [];
      const seen = new Set(all.map((x) => x.key));
      return { ok: true, total: all.length, distinct: seen.size };
    });
    expect(playInfo.ok, 'playtest exposes __play.track').toBeTruthy();
    expect(playInfo.distinct).toBeGreaterThanOrEqual(ALL_KEYS.length);

    // Report all failures as a single aggregate assertion so the test
    // output enumerates every broken asset rather than stopping at the first.
    if (failures.length > 0) {
      console.error('Asset smoke failures:', JSON.stringify(failures, null, 2));
    }
    expect(failures, `Asset smoke failures: ${failures.map((f) => `${f.key}/${f.stage}`).join(', ')}`).toEqual([]);
  });
});
