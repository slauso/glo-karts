/**
 * workplane-usability-smoke.spec.mjs — Decor/workplane usability smoke.
 *
 * Verifies every placeable workplane decor asset:
 *   1. Places at the new 4x default size.
 *   2. Syncs resize/rotate updates through the same decor mesh path used
 *      by the editor gizmo.
 *   3. Hides color/material controls for textured model decor.
 *   4. Round-trips through DecorStore JSON without losing scale/rotation.
 *   5. Reconstructs in playtest mode from sessionStorage.
 *
 * Run:
 *   npx playwright test tests/workplane-usability-smoke.spec.mjs --reporter=list
 */
import { test, expect } from '@playwright/test';

const BASE = 'http://127.0.0.1:5173';
const SCALE_MULTIPLIER = 4;

async function waitForEditor(page) {
  await page.waitForFunction(() => !!(window.__studio && window.__studio.decor && window.__studio.decorMeshById), { timeout: 30000 });
}

async function waitForPlaytest(page) {
  await page.waitForFunction(() => !!(window.__play && window.__play.scene), { timeout: 30000 });
}

test.describe('Workplane usability smoke', () => {
  test.setTimeout(20 * 60 * 1000);

  test('all decor assets — 4x placement, gizmo sync, save/load, playtest', async ({ page }) => {
    page.on('pageerror', (err) => console.error('[pageerror]', err.message));

    await page.goto(`${BASE}/editor.html`, { waitUntil: 'load' });
    await waitForEditor(page);
    await page.waitForTimeout(1500);

    const result = await page.evaluate(async ({ scaleMultiplier }) => {
      const { DECOR, DECOR_KEYS, DecorStore, syncDecorMesh } = await import('/src/editor3/decor.js');
      const { Track, encodeTrack } = await import('/src/editor3/track-data.js');
      const studio = window.__studio;

      const keys = DECOR_KEYS.filter((key) => !!DECOR[key]);
      const failures = [];
      const expectedById = new Map();

      // Build the editor decor store with every placeable asset.
      for (const key of keys) {
        const def = DECOR[key];
        const inst = studio.decor.add({ type: key, x: 0, y: 0, z: 0 });
        if (!inst) {
          failures.push({ key, stage: 'add' });
          continue;
        }
        const expected = def.defaultScale
          ? [
            def.defaultScale[0] * 1000 * scaleMultiplier,
            def.defaultScale[1] * 1000 * scaleMultiplier,
            def.defaultScale[2] * 1000 * scaleMultiplier,
          ]
          : [5000 * scaleMultiplier, 5000 * scaleMultiplier, 5000 * scaleMultiplier];
        expectedById.set(inst.id, { key, expected, model: !!def.model });
      }

      studio.rebuildAllDecor();

      for (const d of studio.decor.all()) {
        const meta = expectedById.get(d.id);
        const mesh = studio.decorMeshById.get(d.id);
        if (!meta) continue;
        if (!mesh) {
          failures.push({ key: meta.key, stage: 'mesh-missing' });
          continue;
        }

        const scale = [d.sx, d.sy, d.sz];
        const scaleOk = scale.every((v, i) => Math.abs(v - meta.expected[i]) < 1e-6);
        if (!scaleOk) {
          failures.push({ key: meta.key, stage: 'scale', got: scale, expected: meta.expected });
        }

        // Simulate the gizmo committing a resize + rotation update.
        d.rx += 0.25;
        d.ry += 0.5;
        d.rz += 0.75;
        d.sx *= 1.10;
        d.sy *= 0.90;
        d.sz *= 1.20;
        syncDecorMesh(mesh, d);

        const syncedScale = [mesh.scale.x, mesh.scale.y, mesh.scale.z];
        const syncedRotation = [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z];
        const syncedOk =
          syncedScale.every((v, i) => Math.abs(v - [d.sx, d.sy, d.sz][i]) < 1e-6) &&
          syncedRotation.every((v, i) => Math.abs(v - [d.rx, d.ry, d.rz][i]) < 1e-6);
        if (!syncedOk) {
          failures.push({ key: meta.key, stage: 'sync', scale: syncedScale, rot: syncedRotation });
        }

        // Textured model decor should not expose color/material controls.
        if (meta.model) {
          studio.selectDecor(d.id);
          await new Promise((resolve) => setTimeout(resolve, 150));
          const matRowHidden = !!document.querySelector('#inspectorPopup .ip-mat-row')?.hidden;
          const colorBlockHidden = !!document.querySelector('#inspectorPopup .ip-color-block')?.hidden;
          const extraHidden = !!document.querySelector('#inspectorPopup .ip-extra')?.hidden;
          if (!(matRowHidden && colorBlockHidden && extraHidden)) {
            failures.push({ key: meta.key, stage: 'inspector-controls', matRowHidden, colorBlockHidden, extraHidden });
          }
        }
      }

      // Save/load round-trip using the live DecorStore JSON.
      const snapshot = studio.decor.toJSON();
      const clone = new DecorStore();
      clone.fromJSON(JSON.parse(JSON.stringify(snapshot)));
      const roundTripSnapshot = clone.toJSON();
      if (roundTripSnapshot.length !== snapshot.length) {
        failures.push({ stage: 'roundtrip-count', got: roundTripSnapshot.length, expected: snapshot.length });
      }
      const canonical = (rows) => JSON.stringify(rows);
      if (canonical(roundTripSnapshot) !== canonical(snapshot)) {
        failures.push({ stage: 'roundtrip-serial', before: snapshot, after: roundTripSnapshot });
      }

      return { failures, keys, snapshotCount: snapshot.length, snapshot };
    }, { scaleMultiplier: SCALE_MULTIPLIER });

    expect(result.failures, JSON.stringify(result.failures, null, 2)).toEqual([]);
    expect(result.snapshotCount).toBeGreaterThan(0);

    await page.evaluate(async ({ decorJson }) => {
      const { Track, encodeTrack } = await import('/src/editor3/track-data.js');
      const track = new Track();
      track.place('spawn', 0, 0, 0);
      track.place('finish', 1, 0, 0);
      sessionStorage.setItem('gloKartsStudio.playtest', encodeTrack(track));
      sessionStorage.setItem('gloKartsStudio.playtest.decor', JSON.stringify(decorJson));
    }, { decorJson: result.snapshot });

    await page.goto(`${BASE}/play.html`, { waitUntil: 'load' });
    await waitForPlaytest(page);

    const playResult = await page.evaluate((expectedCount) => {
      const scene = window.__play.scene;
      const seen = new Set();
      scene.traverse((o) => {
        const ud = o.userData || {};
        if (ud.decorId != null) seen.add(ud.decorId);
        for (const [k, v] of Object.entries(ud)) {
          if (k.startsWith('decorId:')) seen.add(v);
        }
      });
      return { seenCount: seen.size, expectedCount, allSeen: seen.size >= expectedCount };
    }, result.snapshotCount);

    expect(playResult.allSeen).toBeTruthy();
    expect(playResult.seenCount).toBeGreaterThanOrEqual(result.snapshotCount);
  });
});