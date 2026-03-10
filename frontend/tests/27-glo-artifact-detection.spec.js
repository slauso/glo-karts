import { test, expect } from '@playwright/test';

/**
 * GLO Artifact Detection — Visual regression test
 *
 * Takes rapid-fire screenshots while cycling through GLO scenes and kart
 * selections, then compares consecutive frames pixel-by-pixel to detect
 * "flashing box outlines" — sharp-edged rectangular regions that appear
 * for a single frame and vanish (compositor layer boundary artefacts).
 *
 * Artefact signature: a rectangle of bright pixels that appears in one
 * frame but is absent in both the frame before and the frame after.
 * We detect this as a region where a diff frame shows high-delta pixels
 * in a boxy/rectangular pattern while surrounding frames do not.
 */

const BASE = 'http://localhost:5173';
const SETTLE_MS = 2500;         // let lobby fully render + Three.js init
const FRAME_INTERVAL = 80;      // ms between screenshots (~12.5 fps)
const FRAMES_PER_ACTION = 8;    // screenshots captured after each action

test.describe('GLO & Kart — Artifact Detection', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    // Wait for lobby to fully render (Three.js, GLO engine, drum picker)
    await page.waitForTimeout(SETTLE_MS);
    // Increase screenshot timeout for font loading
    page.setDefaultTimeout(30_000);
  });

  test('No flashing box artifacts when cycling GLO scenes', async ({ page }) => {
    // Grab the scenes drum arrow (next) button
    const nextArrow = page.locator('.glo-drum-row--scenes .glo-drum-arrow').last();
    const hasArrow = await nextArrow.count();

    if (hasArrow === 0) {
      test.skip('GLO drum not found — skipping artifact test');
      return;
    }

    // Capture a baseline screenshot before any interaction
    const baseline = await page.screenshot({ type: 'png' });

    const allFrames = [];
    const actionCount = 6; // cycle through 6 GLO scenes

    for (let action = 0; action < actionCount; action++) {
      // Click next GLO scene
      await nextArrow.click();

      // Capture rapid screenshots right after the click
      for (let f = 0; f < FRAMES_PER_ACTION; f++) {
        await page.waitForTimeout(FRAME_INTERVAL);
        const shot = await page.screenshot({ type: 'png' });
        allFrames.push({ action, frame: f, data: shot });
      }
    }

    // Analyse consecutive frame pairs for artefact signatures
    const artefacts = await detectArtifacts(page, allFrames);

    // Save diagnostic screenshots for any detected artefacts
    for (const a of artefacts) {
      const tag = `glo-scene-artifact-a${a.action}-f${a.frame}`;
      await test.info().attach(tag, { body: a.screenshot, contentType: 'image/png' });
      console.log(`ARTIFACT: action=${a.action} frame=${a.frame} changedIn=${a.changedIn} edgeRatio=${a.edgeRatio}% fillRatio=${a.fillRatio}% bbox=${JSON.stringify(a.bbox)}`);
    }

    // Also attach the baseline
    await test.info().attach('baseline', { body: baseline, contentType: 'image/png' });

    // Attach first/last frame for reference
    if (allFrames.length > 0) {
      await test.info().attach('first-frame', { body: allFrames[0].data, contentType: 'image/png' });
      await test.info().attach('last-frame', { body: allFrames[allFrames.length - 1].data, contentType: 'image/png' });
    }

    expect(artefacts.length, `Detected ${artefacts.length} flashing-box artefact(s)`).toBe(0);
  });

  test('No flashing box artifacts when cycling karts', async ({ page }) => {
    const nextKartBtn = page.locator('#kart-next-btn');
    const hasBtn = await nextKartBtn.count();

    if (hasBtn === 0) {
      test.skip('Kart next button not found — skipping');
      return;
    }

    const baseline = await page.screenshot({ type: 'png' });
    const allFrames = [];
    const kartCycles = 5;

    for (let action = 0; action < kartCycles; action++) {
      await nextKartBtn.click();

      for (let f = 0; f < FRAMES_PER_ACTION; f++) {
        await page.waitForTimeout(FRAME_INTERVAL);
        const shot = await page.screenshot({ type: 'png' });
        allFrames.push({ action, frame: f, data: shot });
      }
    }

    const artefacts = await detectArtifacts(page, allFrames);

    for (const a of artefacts) {
      const tag = `kart-artifact-a${a.action}-f${a.frame}`;
      await test.info().attach(tag, { body: a.screenshot, contentType: 'image/png' });
      console.log(`ARTIFACT: action=${a.action} frame=${a.frame} changedIn=${a.changedIn} edgeRatio=${a.edgeRatio}% fillRatio=${a.fillRatio}% bbox=${JSON.stringify(a.bbox)}`);
    }

    await test.info().attach('baseline', { body: baseline, contentType: 'image/png' });
    if (allFrames.length > 0) {
      await test.info().attach('first-frame', { body: allFrames[0].data, contentType: 'image/png' });
      await test.info().attach('last-frame', { body: allFrames[allFrames.length - 1].data, contentType: 'image/png' });
    }

    expect(artefacts.length, `Detected ${artefacts.length} flashing-box artefact(s)`).toBe(0);
  });

  test('Rapid GLO scene switching under stress produces no artifacts', async ({ page }) => {
    const nextArrow = page.locator('.glo-drum-row--scenes .glo-drum-arrow').last();
    const hasArrow = await nextArrow.count();

    if (hasArrow === 0) {
      test.skip('GLO drum not found — skipping');
      return;
    }

    const allFrames = [];

    // Rapid-fire: click 12 times with minimal delay (stress test)
    for (let i = 0; i < 12; i++) {
      await nextArrow.click();
      await page.waitForTimeout(40);
    }

    // Now capture frames during the settling period
    for (let f = 0; f < 15; f++) {
      await page.waitForTimeout(FRAME_INTERVAL);
      const shot = await page.screenshot({ type: 'png' });
      allFrames.push({ action: 0, frame: f, data: shot });
    }

    const artefacts = await detectArtifacts(page, allFrames);

    for (const a of artefacts) {
      const tag = `stress-artifact-f${a.frame}`;
      await test.info().attach(tag, { body: a.screenshot, contentType: 'image/png' });
      console.log(`ARTIFACT: frame=${a.frame} changedIn=${a.changedIn} edgeRatio=${a.edgeRatio}% fillRatio=${a.fillRatio}% bbox=${JSON.stringify(a.bbox)}`);
    }

    expect(artefacts.length, `Detected ${artefacts.length} stress artefact(s)`).toBe(0);
  });
});

/**
 * Compare consecutive screenshots to find single-frame "flash" artefacts.
 *
 * A compositor boundary artefact is a thin rectangular OUTLINE (1-4px border)
 * that appears for exactly one frame. It differs from normal UI changes
 * (kart model swap, GLO color fade) which change FILLED regions.
 *
 * Detection strategy:
 *   1. Diff consecutive frames, find bounding box of changed pixels
 *   2. Check if changed pixels are concentrated at the EDGES of the bounding
 *      box (outline pattern) rather than filling the interior (content change)
 *   3. Only flag if the outline appears then vanishes (single-frame transient)
 *
 * Uses in-page Canvas API for raw pixel comparison.
 */
async function detectArtifacts(page, frames) {
  if (frames.length < 3) return [];

  const b64Frames = frames.map(f => ({
    action: f.action,
    frame: f.frame,
    b64: f.data.toString('base64'),
  }));

  const results = await page.evaluate(async (frameData) => {
    async function decodeImage(b64) {
      const blob = await fetch(`data:image/png;base64,${b64}`).then(r => r.blob());
      const bmp = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      return ctx.getImageData(0, 0, bmp.width, bmp.height);
    }

    /**
     * Compare two frames. Returns changed pixel count, bounding box,
     * and an "edge ratio" — what fraction of changed pixels are within
     * 4px of the bounding box edges vs the interior.
     */
    function compareFrames(imgA, imgB, threshold = 45) {
      const w = imgA.width, h = imgA.height;
      const dA = imgA.data, dB = imgB.data;
      let changedPixels = 0;
      let minX = w, maxX = 0, minY = h, maxY = 0;
      // Bitmap of changed pixels for edge analysis
      const changed = new Uint8Array(w * h);

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const dr = Math.abs(dA[i] - dB[i]);
          const dg = Math.abs(dA[i + 1] - dB[i + 1]);
          const db = Math.abs(dA[i + 2] - dB[i + 2]);
          if (dr + dg + db > threshold) {
            changedPixels++;
            changed[y * w + x] = 1;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (changedPixels < 20) {
        return { changedPixels, edgeRatio: 0, boxArea: 0, totalPixels: w * h };
      }

      // Calculate edge ratio: fraction of changed pixels within 4px of bounding box edge
      const edgePx = 4;
      let edgeCount = 0;
      let interiorCount = 0;
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          if (!changed[y * w + x]) continue;
          const nearEdge = (x - minX < edgePx) || (maxX - x < edgePx) ||
                           (y - minY < edgePx) || (maxY - y < edgePx);
          if (nearEdge) edgeCount++;
          else interiorCount++;
        }
      }
      const edgeRatio = edgeCount / (edgeCount + interiorCount);
      const boxW = maxX - minX + 1;
      const boxH = maxY - minY + 1;
      const boxArea = boxW * boxH;

      // Fill ratio: what fraction of the bounding box is actually changed
      const fillRatio = changedPixels / boxArea;

      return {
        changedPixels, edgeRatio, fillRatio, boxArea, totalPixels: w * h,
        bbox: { x: minX, y: minY, w: boxW, h: boxH },
      };
    }

    const decoded = [];
    for (const fd of frameData) {
      decoded.push({
        action: fd.action,
        frame: fd.frame,
        img: await decodeImage(fd.b64),
      });
    }

    const artefacts = [];

    for (let i = 1; i < decoded.length - 1; i++) {
      const prev = decoded[i - 1].img;
      const curr = decoded[i].img;
      const next = decoded[i + 1].img;

      const diffIn  = compareFrames(prev, curr);
      const diffOut = compareFrames(curr, next);
      const diffAround = compareFrames(prev, next);

      const changedRatio = diffIn.changedPixels / diffIn.totalPixels;
      const flashRatio = diffOut.changedPixels / diffOut.totalPixels;
      const aroundRatio = diffAround.changedPixels / diffAround.totalPixels;

      // Compositor artefact criteria:
      // 1. Transient: appears (changedRatio > 0.05%) and disappears (flashRatio > 0.05%)
      // 2. Outline-shaped: edgeRatio > 0.65 (most changes at bounding box edges)
      //    OR fillRatio < 0.10 (changed pixels are sparse within the bounding box)
      // 3. Surrounding frames are more similar to each other than to the flash frame
      // 4. Bounding box is at least 40px in both dimensions (not just a small UI element)
      const isTransient = changedRatio > 0.0005 && flashRatio > 0.0005;
      const isOutlineShaped = diffIn.edgeRatio > 0.65 || (diffIn.fillRatio !== undefined && diffIn.fillRatio < 0.10);
      const isSurroundingStable = aroundRatio < Math.min(changedRatio, flashRatio) * 0.6;
      const isLargeEnough = diffIn.bbox && diffIn.bbox.w > 40 && diffIn.bbox.h > 40;

      if (isTransient && isOutlineShaped && isSurroundingStable && isLargeEnough) {
        artefacts.push({
          action: decoded[i].action,
          frame: decoded[i].frame,
          changedIn: diffIn.changedPixels,
          changedOut: diffOut.changedPixels,
          edgeRatio: Math.round(diffIn.edgeRatio * 100),
          fillRatio: diffIn.fillRatio !== undefined ? Math.round(diffIn.fillRatio * 100) : null,
          bbox: diffIn.bbox,
          changedAround: diffAround.changedPixels,
        });
      }
    }

    return artefacts;
  }, b64Frames);

  // Attach the actual screenshot data back to results
  return results.map(r => ({
    ...r,
    screenshot: frames.find(f => f.action === r.action && f.frame === r.frame)?.data,
  }));
}
