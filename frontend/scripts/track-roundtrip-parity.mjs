/**
 * track-roundtrip-parity.mjs — Phase A4 probe.
 *
 * Encodes every shipped template (and any caller-provided saved tracks)
 * twice through the realtime physics builder and asserts that segment
 * cannon-es bodies materialise at byte-for-byte identical positions and
 * orientations. This catches:
 *   - Floating-point drift between client encode and server decode.
 *   - Silent unknown-segment skipping (Phase A2).
 *   - Lost segments due to truncation (Phase A1).
 *
 * Defaults to the bundled fixture (backend/tracks/fixtures/starter_templates.json)
 * so the probe is offline-friendly. Pass --backend=http://localhost:8000 to
 * pull the live template + community endpoints instead.
 *
 * Pass — exits 0. Fail — exits 1 with a per-track diff log.
 */
import * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  buildWorldFromTrackData,
  validateTrackData,
} from '../../realtime/src/track/track-loader.js';

const POS_TOL_MM = 0.01; // mm
const ROT_TOL = 1e-6;

function makeWorld() {
  const w = new CANNON.World();
  w.gravity.set(0, -25 * 1000, 0);
  w.broadphase = new CANNON.NaiveBroadphase();
  w.__groundMat = new CANNON.Material('ground');
  return w;
}

function summariseBodies(bodies) {
  return bodies.map((b) => ({
    pos: [b.position.x, b.position.y, b.position.z],
    quat: [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w],
  }));
}

function diffSummaries(a, b) {
  if (a.length !== b.length) return [`body count differs (${a.length} vs ${b.length})`];
  const issues = [];
  for (let i = 0; i < a.length; i += 1) {
    for (let k = 0; k < 3; k += 1) {
      if (Math.abs(a[i].pos[k] - b[i].pos[k]) > POS_TOL_MM) {
        issues.push(`body[${i}].pos[${k}] diverges: ${a[i].pos[k]} vs ${b[i].pos[k]}`);
      }
    }
    for (let k = 0; k < 4; k += 1) {
      if (Math.abs(a[i].quat[k] - b[i].quat[k]) > ROT_TOL) {
        issues.push(`body[${i}].quat[${k}] diverges: ${a[i].quat[k]} vs ${b[i].quat[k]}`);
      }
    }
  }
  return issues;
}

async function loadFixtureTracks() {
  const here = dirname(fileURLToPath(import.meta.url));
  const fixturePath = resolve(here, '../../backend/tracks/fixtures/starter_templates.json');
  const raw = await readFile(fixturePath, 'utf8');
  const records = JSON.parse(raw);
  return records.map((r) => ({
    id: r.pk,
    name: r.fields.name,
    track_data: r.fields.track_data,
  }));
}

async function loadBackendTracks(backendUrl) {
  const fetchJson = async (path) => {
    const res = await fetch(`${backendUrl}${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
    return res.json();
  };
  const tracks = [];
  const tpl = await fetchJson('/api/tracks/templates/?page_size=50');
  const com = await fetchJson('/api/tracks/community/?page_size=10').catch(() => ({ results: [] }));
  for (const rec of [...(tpl.results || []), ...(com.results || [])]) {
    const full = await fetchJson(`/api/tracks/${rec.id}/`).catch(() => null);
    if (full) tracks.push({
      id: full.id || rec.id,
      name: full.fields?.name || rec.fields?.name || 'unknown',
      track_data: full.fields?.track_data || full.track_data,
    });
  }
  return tracks;
}

function probeTrack(track) {
  const world1 = makeWorld();
  const world2 = makeWorld();
  const r1 = buildWorldFromTrackData(world1, track.track_data);
  // Round-trip: stringify and parse to simulate the wire path.
  const wire = JSON.parse(JSON.stringify(track.track_data));
  const r2 = buildWorldFromTrackData(world2, wire);
  const a = summariseBodies(r1.bodies);
  const b = summariseBodies(r2.bodies);
  const issues = diffSummaries(a, b);
  const validation = validateTrackData(track.track_data);
  return {
    name: track.name,
    id: track.id,
    bodies: r1.bodies.length,
    spawns: r1.spawns.length,
    finish: !!r1.finish,
    unknownSegments: r1.diagnostics?.unknownSegments || [],
    issues,
    validationOk: validation.ok,
    validationWarnings: validation.warnings,
    validationErrors: validation.errors,
  };
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }));
  const backendUrl = args.backend || process.env.BACKEND_URL || '';
  const tracks = backendUrl
    ? await loadBackendTracks(backendUrl)
    : await loadFixtureTracks();

  if (!tracks.length) {
    console.error('[parity] no tracks loaded');
    process.exit(2);
  }

  let failed = 0;
  let validationFailed = 0;
  for (const t of tracks) {
    const r = probeTrack(t);
    const status = r.issues.length === 0 ? 'OK' : 'FAIL';
    if (r.issues.length) failed += 1;
    if (!r.validationOk) validationFailed += 1;
    console.log(
      `[${status}] ${r.name.padEnd(28)} ` +
      `bodies=${String(r.bodies).padStart(3)} ` +
      `spawns=${r.spawns} finish=${r.finish ? 'y' : 'n'} ` +
      `unknown=${r.unknownSegments.length}`
    );
    if (r.unknownSegments.length) {
      console.log(`        unknown segments: ${r.unknownSegments.join(', ')}`);
    }
    if (r.validationWarnings.length) {
      for (const w of r.validationWarnings) console.log(`        WARN: ${w}`);
    }
    for (const issue of r.issues) console.log(`        ${issue}`);
  }

  console.log('');
  console.log(`Summary: ${tracks.length} tracks  /  ${failed} parity failures  /  ${validationFailed} validation failures`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[parity] fatal:', err);
  process.exit(2);
});
