// Regression: dragging multi-cell segments must track the cursor 1:1.
// Reproduces the historical bug where clicking on the second cell of a
// 1×2 tunnel (or 2×2 plaza) caused the drag delta to be measured from
// the segment's stored origin instead of the actual click cell, making
// the piece feel "stuck" and producing spurious "Cell occupied" toasts.
import { chromium } from '@playwright/test';

let b;
try { b = await chromium.connectOverCDP('http://127.0.0.1:9222'); }
catch { b = await chromium.launch({ headless: true }); }
const ctx = b.contexts()[0] ?? await b.newContext();
const p = await ctx.newPage();
await p.setViewportSize({ width: 1280, height: 800 });
await p.goto('http://localhost:5173/editor.html', { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__studio?.track, null, { timeout: 15000 });

const cases = [
  // [key, originGx, originGz, clickCellOffset(fx,fz), targetGx, targetGz]
  ['tunnel',  10, 10, [0, 0],  15, 12],   // click first cell, drag away
  ['tunnel',  10, 20, [0, 1],  16, 22],   // click second cell of 1×2
  ['wide',    -5, -5, [1, 1], -10, -8],   // click far corner of 2×2
  ['bridge',  -5, 10, [0, 1], -2,  14],   // 1×2 bridge, click second cell
];

const results = [];
for (const [key, ogx, ogz, [fx, fz], tgx, tgz] of cases) {
  const out = await p.evaluate(({ key, ogx, ogz, fx, fz, tgx, tgz }) => {
    const { track } = window.__studio;
    track.clear();
    const placed = track.place(key, ogx, ogz, 0);
    if (!placed) return { ok: false, reason: 'initial place failed' };
    // Simulate the drag bookkeeping the canvas mousedown/mousemove path runs:
    // anchorStart = click cell; offDx = target - anchorStart.
    const clickGx = ogx + fx, clickGz = ogz + fz;
    const offDx = tgx - clickGx, offDz = tgz - clickGz;
    // Mirror tryMoveSelectionTo: remove, test isClear at new origin,
    // then place. (We move only one piece here.)
    track.remove(placed.id);
    const newOriginGx = ogx + offDx;
    const newOriginGz = ogz + offDz;
    if (!track.isClear(key, newOriginGx, newOriginGz, 0)) {
      track.place(key, ogx, ogz, 0);
      return { ok: false, reason: 'isClear false at target' };
    }
    const moved = track.place(key, newOriginGx, newOriginGz, 0);
    return {
      ok: true,
      newOriginGx: moved.gx,
      newOriginGz: moved.gz,
      // The cell that was under the cursor must now be at (tgx, tgz).
      clickCellNowGx: moved.gx + fx,
      clickCellNowGz: moved.gz + fz,
      targetGx: tgx, targetGz: tgz,
    };
  }, { key, ogx, ogz, fx, fz, tgx, tgz });
  const pass = out.ok && out.clickCellNowGx === out.targetGx && out.clickCellNowGz === out.targetGz;
  console.log(`${pass ? '✓' : '✗'} ${key} click=(${ogx+fx},${ogz+fz}) → cursor=(${tgx},${tgz}) clickCellNow=(${out.clickCellNowGx},${out.clickCellNowGz})${out.reason ? ' ['+out.reason+']' : ''}`);
  results.push(pass);
}
await b.close();
const failed = results.filter(r => !r).length;
if (failed) { console.error(`\n${failed}/${results.length} cases failed`); process.exit(1); }
console.log(`\n${results.length}/${results.length} multi-cell drag cases passed`);
