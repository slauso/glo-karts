import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

function getArg(name) {
  const match = process.argv.find(a => a.startsWith(`${name}=`));
  return match ? match.split('=').slice(1).join('=') : null;
}

const sourceRepo = getArg('--source');
if (!sourceRepo) {
  console.error('Usage: node scripts/migrate-stk-repo.mjs --source=<path-to-supertuxkart-repo>');
  process.exit(1);
}

const projectRoot = process.cwd();
const dataRoot = path.join(sourceRepo, 'data');
const sourceTracks = path.join(dataRoot, 'tracks');
const sourceKarts = path.join(dataRoot, 'karts');

const targetRoot = path.join(projectRoot, 'public', 'models', 'stk');
const targetTracks = path.join(targetRoot, 'tracks');
const targetArenas = path.join(targetRoot, 'arenas');
const targetKarts = path.join(targetRoot, 'karts');

const migrationDir = path.join(projectRoot, 'stk-migration');
const queueFile = path.join(migrationDir, 'conversion-queue.json');

function toDisplayName(id) {
  return id
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function buildProfiles({ tracks, arenas, karts }) {
  const sortBySize = (arr) => [...arr].sort((a, b) => (a.sizeBytes || Number.MAX_SAFE_INTEGER) - (b.sizeBytes || Number.MAX_SAFE_INTEGER));
  const ids = (arr, n) => sortBySize(arr).slice(0, n).map(item => item.id);

  return {
    lite: {
      tracks: ids(tracks, 6),
      arenas: ids(arenas, 2),
      karts: ids(karts, 8),
      weaponSet: 'stk-lite',
    },
    balanced: {
      tracks: ids(tracks, 12),
      arenas: ids(arenas, 4),
      karts: ids(karts, 16),
      weaponSet: 'stk-classic',
    },
    full: {
      tracks: tracks.map(t => t.id),
      arenas: arenas.map(a => a.id),
      karts: karts.map(k => k.id),
      weaponSet: 'stk-classic',
    },
  };
}

async function fileExists(filePath) {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch {
    return false;
  }
}

async function parseTrackMeta(trackDir, id) {
  const xmlPath = path.join(trackDir, 'track.xml');
  let name = toDisplayName(id);
  let isArena = false;

  try {
    const xml = await readFile(xmlPath, 'utf8');
    const nameMatch = xml.match(/name\s*=\s*"([^"]+)"/i);
    if (nameMatch && nameMatch[1]) {
      name = nameMatch[1];
    }

    const arenaMatch = xml.match(/arena\s*=\s*"([^"]+)"/i);
    if (arenaMatch && arenaMatch[1]) {
      const value = arenaMatch[1].toLowerCase();
      isArena = value === 'true' || value === 'yes' || value === '1' || value === 'y';
    }
  } catch {
    // fallback metadata already set
  }

  return { id, name, isArena };
}

async function copyIfPresent(candidates, targetFile) {
  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      await mkdir(path.dirname(targetFile), { recursive: true });
      await cp(candidate, targetFile, { force: true });
      return candidate;
    }
  }
  return null;
}

async function scanTracks() {
  const entries = await readdir(sourceTracks, { withFileTypes: true });
  const tracks = [];
  const arenas = [];
  const queue = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    const dir = path.join(sourceTracks, id);
    const meta = await parseTrackMeta(dir, id);

    const targetDir = meta.isArena ? path.join(targetArenas, id) : path.join(targetTracks, id);
    const trackTarget = meta.isArena
      ? path.join(targetDir, 'arena.glb')
      : path.join(targetDir, 'track.glb');
    const decoTarget = path.join(targetDir, 'decorations.glb');

    const trackCandidate = await copyIfPresent([
      path.join(dir, 'arena.glb'),
      path.join(dir, 'track.glb'),
      path.join(dir, 'scene.glb'),
      path.join(dir, `${id}.glb`),
    ], trackTarget);

    const decoCandidate = await copyIfPresent([
      path.join(dir, 'decorations.glb'),
      path.join(dir, 'props.glb'),
    ], decoTarget);

    queue.push({
      type: meta.isArena ? 'arena' : 'track',
      id,
      name: meta.name,
      sourceDir: dir,
      targetDir,
      expectedFiles: meta.isArena ? ['arena.glb'] : ['track.glb', 'decorations.glb'],
      copiedFiles: [trackCandidate, decoCandidate].filter(Boolean),
      needsConversion: !trackCandidate,
    });

    let sizeBytes = 0;
    if (trackCandidate) {
      try {
        const fileStat = await stat(trackTarget);
        if (fileStat.isFile()) sizeBytes += fileStat.size;
      } catch {}
    }
    if (decoCandidate) {
      try {
        const fileStat = await stat(decoTarget);
        if (fileStat.isFile()) sizeBytes += fileStat.size;
      } catch {}
    }

    if (meta.isArena) {
      arenas.push({ id, name: meta.name, sizeBytes });
    } else {
      tracks.push({ id, name: meta.name, sizeBytes });
    }
  }

  tracks.sort((a, b) => a.name.localeCompare(b.name));
  arenas.sort((a, b) => a.name.localeCompare(b.name));
  return { tracks, arenas, queue };
}

async function scanKarts() {
  const entries = await readdir(sourceKarts, { withFileTypes: true });
  const karts = [];
  const queue = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    const dir = path.join(sourceKarts, id);
    const targetDir = path.join(targetKarts, id);
    const kartTarget = path.join(targetDir, 'kart.glb');

    const kartCandidate = await copyIfPresent([
      path.join(dir, 'kart.glb'),
      path.join(dir, 'model.glb'),
      path.join(dir, `${id}.glb`),
    ], kartTarget);

    const name = toDisplayName(id);
    let sizeBytes = 0;
    if (kartCandidate) {
      try {
        const fileStat = await stat(kartTarget);
        if (fileStat.isFile()) sizeBytes = fileStat.size;
      } catch {}
    }
    karts.push({ id, name, sizeBytes });
    queue.push({
      type: 'kart',
      id,
      name,
      sourceDir: dir,
      targetDir,
      expectedFiles: ['kart.glb'],
      copiedFiles: kartCandidate ? [kartCandidate] : [],
      needsConversion: !kartCandidate,
    });
  }

  karts.sort((a, b) => a.name.localeCompare(b.name));
  return { karts, queue };
}

async function writeManifest(manifest) {
  await mkdir(targetRoot, { recursive: true });
  const manifestPath = path.join(targetRoot, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return manifestPath;
}

async function writeQueue(queue) {
  await mkdir(migrationDir, { recursive: true });
  await writeFile(queueFile, JSON.stringify({ items: queue }, null, 2));
}

async function main() {
  await mkdir(targetTracks, { recursive: true });
  await mkdir(targetArenas, { recursive: true });
  await mkdir(targetKarts, { recursive: true });

  const { tracks, arenas, queue: trackQueue } = await scanTracks();
  const { karts, queue: kartQueue } = await scanKarts();
  const queue = [...trackQueue, ...kartQueue];
  const profiles = buildProfiles({ tracks, arenas, karts });

  const manifestPath = await writeManifest({ tracks, arenas, karts, profiles });
  await writeQueue(queue);

  const needingConversion = queue.filter(item => item.needsConversion).length;
  const copied = queue.length - needingConversion;

  console.log(`Manifest written: ${manifestPath}`);
  console.log(`Conversion queue written: ${queueFile}`);
  console.log(`Assets copied directly: ${copied}`);
  console.log(`Assets requiring conversion: ${needingConversion}`);
}

main().catch((error) => {
  console.error('STK migration scan failed:', error);
  process.exit(1);
});