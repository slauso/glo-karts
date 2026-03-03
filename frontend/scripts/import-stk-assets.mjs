import { cp, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

function getArg(name) {
  const match = process.argv.find(a => a.startsWith(`${name}=`));
  return match ? match.split('=').slice(1).join('=') : null;
}

const sourceRoot = getArg('--source');
if (!sourceRoot) {
  console.error('Usage: node scripts/import-stk-assets.mjs --source=<converted-assets-dir>');
  console.error('Expected source structure:');
  console.error('  <source>/tracks/<track-id>/track.glb');
  console.error('  <source>/tracks/<track-id>/decorations.glb   (optional)');
  console.error('  <source>/arenas/<arena-id>/arena.glb         (optional)');
  process.exit(1);
}

const projectRoot = process.cwd();
const targetTracks = path.join(projectRoot, 'public', 'models', 'stk', 'tracks');
const targetArenas = path.join(projectRoot, 'public', 'models', 'stk', 'arenas');
const targetKarts = path.join(projectRoot, 'public', 'models', 'stk', 'karts');
const manifestFile = path.join(projectRoot, 'public', 'models', 'stk', 'manifest.json');

function formatTrackName(id) {
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

async function copyChildren(srcDir, dstDir) {
  try {
    const entries = await readdir(srcDir, { withFileTypes: true });
    await mkdir(dstDir, { recursive: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const from = path.join(srcDir, entry.name);
      const to = path.join(dstDir, entry.name);
      await mkdir(to, { recursive: true });
      await cp(from, to, { recursive: true, force: true });
      console.log(`Imported: ${entry.name}`);
    }
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
}

async function validateTracks(tracksDir) {
  try {
    const entries = await readdir(tracksDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const trackFile = path.join(tracksDir, entry.name, 'track.glb');
      try {
        const fileStat = await stat(trackFile);
        if (!fileStat.isFile()) {
          console.warn(`Track missing required file: ${trackFile}`);
        }
      } catch {
        console.warn(`Track missing required file: ${trackFile}`);
      }
    }
  } catch {
    // no-op
  }
}

async function generateTrackManifest(tracksDir, outputFile) {
  const tracks = [];
  const arenas = [];
  const karts = [];
  try {
    const entries = await readdir(tracksDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const id = entry.name;
      const trackFile = path.join(tracksDir, id, 'track.glb');
      try {
        const fileStat = await stat(trackFile);
        if (!fileStat.isFile()) continue;
        const decoFile = path.join(tracksDir, id, 'decorations.glb');
        let decoSize = 0;
        try {
          const decoStat = await stat(decoFile);
          if (decoStat.isFile()) decoSize = decoStat.size;
        } catch {
          // optional decorations
        }
        tracks.push({ id, name: formatTrackName(id), sizeBytes: fileStat.size + decoSize });
      } catch {
        // Skip invalid track directories
      }
    }
  } catch {
    // no-op
  }

  try {
    const arenaEntries = await readdir(targetArenas, { withFileTypes: true });
    for (const entry of arenaEntries) {
      if (!entry.isDirectory()) continue;
      const id = entry.name;
      const arenaFile = path.join(targetArenas, id, 'arena.glb');
      try {
        const fileStat = await stat(arenaFile);
        if (!fileStat.isFile()) continue;
        arenas.push({ id, name: formatTrackName(id), sizeBytes: fileStat.size });
      } catch {
        // Skip invalid arena directories
      }
    }
  } catch {
    // no-op
  }

  try {
    const kartEntries = await readdir(targetKarts, { withFileTypes: true });
    for (const entry of kartEntries) {
      if (!entry.isDirectory()) continue;
      const id = entry.name;
      const kartFile = path.join(targetKarts, id, 'kart.glb');
      try {
        const fileStat = await stat(kartFile);
        if (!fileStat.isFile()) continue;
        karts.push({ id, name: formatTrackName(id), sizeBytes: fileStat.size });
      } catch {
        // Skip invalid kart directories
      }
    }
  } catch {
    // no-op
  }

  tracks.sort((a, b) => a.name.localeCompare(b.name));
  arenas.sort((a, b) => a.name.localeCompare(b.name));
  karts.sort((a, b) => a.name.localeCompare(b.name));
  const profiles = buildProfiles({ tracks, arenas, karts });
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, JSON.stringify({ tracks, arenas, karts, profiles }, null, 2));
  console.log(`Generated manifest: ${outputFile} (${tracks.length} tracks, ${arenas.length} arenas, ${karts.length} karts)`);
}

(async () => {
  const sourceTracks = path.join(sourceRoot, 'tracks');
  const sourceArenas = path.join(sourceRoot, 'arenas');
  const sourceKarts = path.join(sourceRoot, 'karts');

  await copyChildren(sourceTracks, targetTracks);
  await copyChildren(sourceArenas, targetArenas);
  await copyChildren(sourceKarts, targetKarts);
  await validateTracks(targetTracks);
  await generateTrackManifest(targetTracks, manifestFile);

  console.log('STK asset import complete.');
  console.log('Use track IDs as: stk:<track-id> (example: stk:candela_city).');
})();
