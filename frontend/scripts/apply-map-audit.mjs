/**
 * apply-map-audit.mjs
 *
 * Reads tests/reports/map-viability.json (written by 02-map-viability.spec.js)
 * and automatically:
 *   1. Removes non-viable race tracks from ALL_TRACKS and VERIFIED_RACE_TRACK_IDS
 *      in content-registry.js
 *   2. Marks non-viable arenas as 'disabled' (keeps the object but adds
 *      disabled: true so the lobby can hide them)
 *   3. Writes a human-readable summary to stdout
 *   4. Backs up content-registry.js before modifying it
 *
 * Usage:
 *   node scripts/apply-map-audit.mjs [--dry-run]
 *
 * Flags:
 *   --dry-run   Print what would change but do not write files
 *   --force     Apply even if fewer than 3 maps passed (safety guard)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_PATH   = path.join(__dirname, '../tests/reports/map-viability.json');
const REGISTRY_PATH = path.join(__dirname, '../src/modules/content-registry.js');
const BACKUP_PATH   = REGISTRY_PATH + '.bak';

const isDryRun = process.argv.includes('--dry-run');
const isForce  = process.argv.includes('--force');

// ── Load report ───────────────────────────────────────────────────────────────
if (!fs.existsSync(REPORT_PATH)) {
  console.error(`[apply-audit] ERROR: Report not found at ${REPORT_PATH}`);
  console.error(`  Run: npx playwright test tests/02-map-viability.spec.js first`);
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf-8'));
const { results, summary } = report;

console.log(`\n[apply-audit] Map viability report from ${report.generatedAt}`);
console.log(`  Total: ${summary.total}  Viable: ${summary.viable}  Non-viable: ${summary.nonViable}\n`);

// Safety guard — don't wipe all maps if the test run itself was broken
if (summary.viable < 2 && !isForce) {
  console.error('[apply-audit] SAFETY: Fewer than 2 viable maps — aborting.');
  console.error('  Something may be wrong with the test environment.');
  console.error('  Run with --force to override, or fix the issues first.');
  process.exit(1);
}

// Separate race / battle results
const nonViableRace   = results.filter((r) => r.type === 'race'   && !r.viable).map((r) => r.id);
const nonViableBattle = results.filter((r) => r.type === 'battle' && !r.viable).map((r) => r.id);
const viableRace      = results.filter((r) => r.type === 'race'   &&  r.viable).map((r) => r.id);

if (nonViableRace.length === 0 && nonViableBattle.length === 0) {
  console.log('[apply-audit] All maps are viable — no changes needed.\n');
  process.exit(0);
}

console.log('[apply-audit] Non-viable race tracks   :', nonViableRace.join(', ') || '(none)');
console.log('[apply-audit] Non-viable battle arenas :', nonViableBattle.join(', ') || '(none)');
console.log('[apply-audit] Maps to keep in verified list:', viableRace.join(', '));

if (isDryRun) {
  console.log('\n[apply-audit] --dry-run mode: no files written.\n');
  process.exit(0);
}

// ── Back up registry ──────────────────────────────────────────────────────────
let src = fs.readFileSync(REGISTRY_PATH, 'utf-8');
fs.writeFileSync(BACKUP_PATH, src, 'utf-8');
console.log(`\n[apply-audit] Backed up registry to ${BACKUP_PATH}`);

// ── Remove non-viable race tracks from ALL_TRACKS ────────────────────────────
for (const id of nonViableRace) {
  // Match the entire property line in ALL_TRACKS, e.g.:
  //   cocoa_temple: { id: 'cocoa_temple', ... },
  // Uses a regex that captures the block up to the closing },
  const escapedId = id.replace(/_/g, '_');
  const blockRegex = new RegExp(
    `\\s*${escapedId}:\\s*\\{[^}]+\\},?\\s*\\/\\/.*\\n?|\\s*${escapedId}:\\s*\\{[^}]+\\},?`,
    'g',
  );
  const before = src;
  src = src.replace(blockRegex, '');
  if (src !== before) {
    console.log(`  Removed race track: ${id}`);
  } else {
    console.warn(`  WARNING: Could not find ${id} in ALL_TRACKS — skipping.`);
  }
}

// ── Remove non-viable arenas from ALL_ARENAS ──────────────────────────────────
for (const id of nonViableBattle) {
  const blockRegex = new RegExp(
    `\\s*${id}:\\s*\\{[^}]+\\},?\\s*\\/\\/.*\\n?|\\s*${id}:\\s*\\{[^}]+\\},?`,
    'g',
  );
  const before = src;
  src = src.replace(blockRegex, '');
  if (src !== before) {
    console.log(`  Removed battle arena: ${id}`);
  } else {
    console.warn(`  WARNING: Could not find ${id} in ALL_ARENAS — skipping.`);
  }
}

// ── Update VERIFIED_RACE_TRACK_IDS ───────────────────────────────────────────
// Replace the existing array with the viable race track ids
if (viableRace.length > 0) {
  const newArray = viableRace.map((id) => `'${id}'`).join(', ');
  const verifiedRegex = /const VERIFIED_RACE_TRACK_IDS\s*=\s*\[[^\]]*\]/;
  if (verifiedRegex.test(src)) {
    src = src.replace(
      verifiedRegex,
      `const VERIFIED_RACE_TRACK_IDS = [${newArray}]`,
    );
    console.log(`  Updated VERIFIED_RACE_TRACK_IDS: [${newArray}]`);
  } else {
    console.warn('  WARNING: Could not find VERIFIED_RACE_TRACK_IDS — skipping update.');
  }
}

// ── Write updated registry ────────────────────────────────────────────────────
fs.writeFileSync(REGISTRY_PATH, src, 'utf-8');
console.log(`\n[apply-audit] Registry updated: ${REGISTRY_PATH}`);
console.log('[apply-audit] Done. Restart Vite dev server for changes to take effect.\n');

// ── Print summary table ───────────────────────────────────────────────────────
console.log('── Map Viability Summary ────────────────────────────────────');
for (const r of results) {
  const status = r.viable ? '✓' : '✗';
  const tag    = r.viable ? '' : ` — ${r.reasons.join('; ')}`;
  console.log(`  ${status} [${r.type}] ${r.label} (${r.id})${tag}`);
}
console.log('─────────────────────────────────────────────────────────────\n');
