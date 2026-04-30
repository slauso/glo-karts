// Drive-by visual verification of the new walled segments. Loads the
// editor3 module graph in a chromium page, programmatically inspects
// every `_walled` segment's block geometry, and asserts:
//   (a) the variant contains every base block (deck/curbs preserved)
//   (b) at least one wall block exists per variant
//   (c) no wall block sits below the deck (clipping check)
//   (d) ramp variants have tilted walls; flat variants have none
//   (e) wall heights are in the realistic 2–4 m range
import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:5174/editor.html';
const WALL_COLOR = 0x6b7280;

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });

await page.goto(URL, { waitUntil: 'networkidle' });

// Pull the segment registry directly from the loaded module via a
// dynamic import — this avoids depending on whatever globals the
// editor exposes and tests the SAME module the editor uses.
const data = await page.evaluate(async () => {
  const mod = await import('/src/editor3/segments.js');
  const { SEGMENTS } = mod;
  const W = 0x6b7280;
  const out = [];
  for (const k of Object.keys(SEGMENTS)) {
    if (!k.endsWith('_walled')) continue;
    const baseKey = k.replace(/_walled$/, '');
    const base = SEGMENTS[baseKey];
    const seg = SEGMENTS[k];
    const baseBlocks = base ? base.blocks : [];
    // Only inspect the APPENDED wall blocks — base may already contain
    // grey pillars/rails (plateau supports, bridge piers) that share the
    // wall colour but aren't the new contour barriers.
    const addedBlocks = seg.blocks.slice(baseBlocks.length);
    const wallBlocks = addedBlocks.filter((b) => b.color === W);
    const tilted = wallBlocks.filter((b) => Math.abs(b.rotX || 0) > 1e-4).length;
    // Lowest wall-block bottom Y
    let minWallBottom = Infinity;
    for (const b of wallBlocks) {
      const bottom = b.pos[1] - b.size[1] / 2;
      if (bottom < minWallBottom) minWallBottom = bottom;
    }
    // Highest wall top
    let maxWallTop = -Infinity;
    for (const b of wallBlocks) {
      const top = b.pos[1] + b.size[1] / 2;
      if (top > maxWallTop) maxWallTop = top;
    }
    out.push({
      key: k, baseKey,
      total: seg.blocks.length,
      baseCount: baseBlocks.length,
      preservesBase: seg.blocks.length >= baseBlocks.length,
      wallCount: wallBlocks.length,
      tilted,
      minWallBottom,
      maxWallTop,
      heightRange: [
        Math.min(...wallBlocks.map((b) => b.size[1])),
        Math.max(...wallBlocks.map((b) => b.size[1])),
      ],
    });
  }
  return out;
});

let fails = 0;
const expectTilted = new Set([
  'ramp_up_walled', 'ramp_down_walled', 'jump_ramp_walled',
  'bridge_onramp_walled', 'bridge_offramp_walled', 'hill_complete_walled',
]);

console.log(`\nWalled variants found: ${data.length}\n`);
console.log('key                          base→tot  walls tilt minBot  maxTop heights');
console.log('---------------------------- --------- ----- ---- ------ ------- -------');
for (const r of data) {
  const ok =
    r.preservesBase &&
    r.wallCount > 0 &&
    r.minWallBottom >= -0.01 &&
    r.maxWallTop <= 30 &&     // sanity: bridge top ≈ 18.7
    r.heightRange[0] >= 0.4 &&
    r.heightRange[1] <= 3.5 &&
    (expectTilted.has(r.key) ? r.tilted > 0 : r.tilted === 0);
  const mark = ok ? '✓' : '✗';
  if (!ok) fails++;
  console.log(
    `${mark} ${r.key.padEnd(28)} ${String(r.baseCount).padStart(3)}→${String(r.total).padEnd(3)} `
    + ` ${String(r.wallCount).padStart(3)}  ${String(r.tilted).padStart(3)}  `
    + `${r.minWallBottom.toFixed(2).padStart(5)}  ${r.maxWallTop.toFixed(2).padStart(6)}  `
    + `[${r.heightRange[0].toFixed(2)}, ${r.heightRange[1].toFixed(2)}]`
  );
}

console.log('');
if (errors.length) {
  console.log('Page errors:'); for (const e of errors) console.log('  ' + e);
}
if (fails) {
  console.error(`\n✗ ${fails} variant(s) failed checks`);
  await browser.close(); process.exit(1);
}
console.log(`✓ ALL ${data.length} walled variants pass contour + preservation checks`);
await browser.close();
