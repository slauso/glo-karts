/**
 * pipeline-verify.mjs — Verify the builder→playtest rendering pipeline
 * Run: node tests/pipeline-verify.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

let allPassed = true;
function check(label, ok) {
  const status = ok ? 'PASS' : 'FAIL';
  if (!ok) allPassed = false;
  console.log(`  [${status}] ${label}`);
}

console.log('\n=== 1. Procedural Runtime Kit Verification ===');
const expectedKeys = [
  'straight', 'corner-large', 'corner-small', 'corner-large-ramp', 'corner-small-ramp',
  'curve', 'bend', 'bend-large', 'bump-up', 'bump-down', 'hill-beginning', 'hill-end',
  'hill-complete', 'hill-complete-half', 'skew-left', 'skew-right', 'skew-left-side',
  'skew-right-side', 'cap-front', 'cap-back', 'wide', 'end',
];
check('custom-arena-procedural.js exists', existsSync(join(root, 'src/modules/custom-arena-procedural.js')));

console.log('\n=== 2. PLAYTEST_SEGMENT_TYPE_MAP Identity ===');
const serializerSrc = readFileSync(join(root, 'src/builder-v2/serializer.js'), 'utf8');
const mapBlock = serializerSrc.match(/PLAYTEST_SEGMENT_TYPE_MAP = Object\.freeze\(\{([\s\S]*?)\}\)/);
if (mapBlock) {
  const lines = mapBlock[1].split('\n').filter(l => l.includes(':'));
  for (const line of lines) {
    const m = line.match(/['"]?([^'":\s]+)['"]?\s*:\s*['"]([^'"]+)['"]/);
    if (m) {
      check(`${m[1]} → ${m[2]} (identity)`, m[1] === m[2]);
    }
  }
} else {
  check('PLAYTEST_SEGMENT_TYPE_MAP found', false);
}

console.log('\n=== 3. Segment Catalog Coverage ===');
const casSrc = readFileSync(join(root, 'src/modules/custom-arena-segments.js'), 'utf8');
for (const key of expectedKeys) {
  check(`CUSTOM_ARENA_TRACK_ASSETS has "${key}"`, casSrc.includes(`key: '${key}'`));
}

console.log('\n=== 4. CUSTOM_ARENA_PORT_DEFS Coverage ===');
for (const key of expectedKeys) {
  const hasPort = casSrc.includes(`'${key}':`) || casSrc.includes(`${key}:`);
  check(`Port definition for "${key}"`, hasPort);
}

console.log('\n=== 5. LEGACY_SEGMENT_ALIASES backward compat ===');
const legacyTypes = ['flat_wide', 'curve_left', 'curve_right', 'ramp_up', 'ramp_down'];
for (const lt of legacyTypes) {
  check(`Legacy alias "${lt}" defined`, casSrc.includes(`${lt}:`));
}

console.log('\n=== 6. Runtime uses procedural builder-aligned kit ===');
const cbcSrc = readFileSync(join(root, 'src/modules/realtime/colyseus-babylon-client.js'), 'utf8');
const procSrc = readFileSync(join(root, 'src/modules/custom-arena-procedural.js'), 'utf8');
check('custom arena loader imports procedural builder kit', cbcSrc.includes('buildCustomArenaSegmentVisual'));
check('procedural builder kit defines straight base', procSrc.includes('buildStraightBase'));
check('procedural builder kit defines corner base', procSrc.includes('buildCornerBase'));
check('procedural builder kit defines wide pad', procSrc.includes('buildWidePad'));
check('procedural builder kit defines cap tiles', procSrc.includes('buildCap'));
check('physicsMeshes stored in segmentRecords', cbcSrc.includes('physicsMeshes: segmentVisual.physicsMeshes'));
check('PhysicsShapeType.MESH used for segments', cbcSrc.includes('PhysicsShapeType.MESH'));
check('Clone+bake physics pattern', cbcSrc.includes('bakeCurrentTransformIntoVertices'));
check('BOX fallback for non-procedural segments', cbcSrc.includes('PhysicsShapeType.BOX'));

console.log('\n' + '='.repeat(50));
console.log(allPassed ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
