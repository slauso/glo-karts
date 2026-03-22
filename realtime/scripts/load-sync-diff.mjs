import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const cliArgs = new Map(
  process.argv.slice(2)
    .filter((arg) => arg.startsWith('--'))
    .map((arg) => {
      const [rawKey, ...rest] = arg.slice(2).split('=');
      return [rawKey, rest.join('=') || 'true'];
    }),
);

const latestPath = resolve(cliArgs.get('latest') || process.env.SYNC_HARNESS_LATEST_JSON || 'reports/load-sync-latest.json');
const previousPath = resolve(cliArgs.get('previous') || process.env.SYNC_HARNESS_PREVIOUS_JSON || 'reports/load-sync-previous.json');

function round(value) {
  return Math.round(value * 100) / 100;
}

function diffMetric(next, prev) {
  return round((next || 0) - (prev || 0));
}

function buildScenarioMap(report) {
  const map = new Map();
  for (const result of report.results || []) {
    map.set(result.players, result);
  }
  return map;
}

const [latestRaw, previousRaw] = await Promise.all([
  readFile(latestPath, 'utf8'),
  readFile(previousPath, 'utf8'),
]);

const latest = JSON.parse(latestRaw);
const previous = JSON.parse(previousRaw);
const latestMap = buildScenarioMap(latest);
const previousMap = buildScenarioMap(previous);

const playerCounts = Array.from(new Set([...latestMap.keys(), ...previousMap.keys()])).sort((a, b) => a - b);
const rows = playerCounts.map((players) => {
  const next = latestMap.get(players);
  const prev = previousMap.get(players);
  return {
    players,
    patchAvgDelta: diffMetric(next?.patchBytes?.avg, prev?.patchBytes?.avg),
    tickDriftDelta: diffMetric(next?.serverMetrics?.avgTickDriftMs, prev?.serverMetrics?.avgTickDriftMs),
    rttAvgDelta: diffMetric(next?.rttMs?.avg, prev?.rttMs?.avg),
    anomalyEventDelta: diffMetric(next?.anomalyEvents?.total, prev?.anomalyEvents?.total),
    anomalyBytesDelta: diffMetric(next?.anomalyEvents?.payloadBytes, prev?.anomalyEvents?.payloadBytes),
    latestPatchAvg: round(next?.patchBytes?.avg || 0),
    previousPatchAvg: round(prev?.patchBytes?.avg || 0),
    latestTickDrift: round(next?.serverMetrics?.avgTickDriftMs || 0),
    previousTickDrift: round(prev?.serverMetrics?.avgTickDriftMs || 0),
    latestRttAvg: round(next?.rttMs?.avg || 0),
    previousRttAvg: round(prev?.rttMs?.avg || 0),
    latestAnomalyEvents: round(next?.anomalyEvents?.total || 0),
    previousAnomalyEvents: round(prev?.anomalyEvents?.total || 0),
  };
});

console.log(`[load-sync-diff] latest: ${latestPath}`);
console.log(`[load-sync-diff] previous: ${previousPath}`);
console.table(rows);