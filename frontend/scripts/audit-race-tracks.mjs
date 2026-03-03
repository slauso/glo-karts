import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_TRACKS, VERIFIED_RACE_TRACK_IDS } from '../src/modules/content-registry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendRoot = path.resolve(__dirname, '..');
const publicRoot = path.join(frontendRoot, 'public');

function existsForPublicUrl(assetUrl) {
  if (!assetUrl || typeof assetUrl !== 'string' || !assetUrl.startsWith('/')) return false;
  const filePath = path.join(publicRoot, assetUrl.slice(1));
  return fs.existsSync(filePath);
}

const entries = Object.values(ALL_TRACKS).map((track) => {
  const trackExists = existsForPublicUrl(track.trackPath);
  const decorationsExists = existsForPublicUrl(track.decorationsPath);
  return {
    id: track.id,
    label: track.label,
    trackPath: track.trackPath,
    decorationsPath: track.decorationsPath,
    trackExists,
    decorationsExists,
    verifiedRaceTrack: VERIFIED_RACE_TRACK_IDS.includes(track.id),
  };
});

const missingCritical = entries.filter((e) => !e.trackExists);
const missingDecorations = entries.filter((e) => e.trackExists && !e.decorationsExists);

const report = {
  generatedAt: new Date().toISOString(),
  totalTracks: entries.length,
  verifiedRaceTrackIds: VERIFIED_RACE_TRACK_IDS,
  missingCriticalCount: missingCritical.length,
  missingDecorationCount: missingDecorations.length,
  tracks: entries,
};

const outputPath = path.join(frontendRoot, 'track-audit-report.json');
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');

console.log(`Track audit complete: ${outputPath}`);
console.log(`Missing track.glb: ${missingCritical.length}`);
console.log(`Missing decorations.glb: ${missingDecorations.length}`);
