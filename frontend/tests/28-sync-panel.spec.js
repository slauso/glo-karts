import { test, expect } from '@playwright/test';
import {
  injectGameConfig,
  waitForDebug,
  BATTLE_CONFIG,
  RACE_CONFIG,
} from './helpers/game-helpers.js';

function rectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

test.describe.configure({ mode: 'serial' });

test.describe('Sync Panel HUD Placement', () => {
  test('battle sync panel renders live metrics without overlapping the exit button', async ({ page }) => {
    await injectGameConfig(page, BATTLE_CONFIG);
    await page.goto('/realtime.html');

    await waitForDebug(page, (d) => d.roomJoined === true, 25_000);
    await waitForDebug(page, (d) => !!d.network && !!d.syncMetrics, 25_000);

    const panel = page.locator('#sync-debug-panel');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(panel).toContainText('Sync Monitor');
    await expect(panel).toContainText('rtt');
    await expect(panel).toContainText('patch');

    const layout = await page.evaluate(() => {
      const panelEl = document.getElementById('sync-debug-panel');
      const exitEl = document.querySelector('.exit-game-btn');
      if (!panelEl || !exitEl) return null;
      const panelRect = panelEl.getBoundingClientRect();
      const exitRect = exitEl.getBoundingClientRect();
      return {
        panel: { left: panelRect.left, top: panelRect.top, right: panelRect.right, bottom: panelRect.bottom },
        exit: { left: exitRect.left, top: exitRect.top, right: exitRect.right, bottom: exitRect.bottom },
      };
    });

    expect(layout, 'battle layout snapshot').toBeTruthy();
    expect(rectsOverlap(layout.panel, layout.exit), 'panel should not overlap exit button').toBe(false);
    expect(layout.panel.left, 'panel should sit on the left side of the HUD').toBeLessThan(80);
  });

  test('race sync panel does not collide with the top-right minimap HUD', async ({ page }) => {
    await injectGameConfig(page, RACE_CONFIG);
    await page.goto('/realtime.html');

    await waitForDebug(page, (d) => d.roomJoined === true, 25_000);
    await waitForDebug(page, (d) => !!d.network && !!d.syncMetrics, 25_000);

    const panel = page.locator('#sync-debug-panel');
    const minimap = page.locator('#minimap');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(minimap).toBeVisible({ timeout: 15_000 });

    const layout = await page.evaluate(() => {
      const panelEl = document.getElementById('sync-debug-panel');
      const minimapEl = document.getElementById('minimap');
      if (!panelEl || !minimapEl) return null;
      const panelRect = panelEl.getBoundingClientRect();
      const minimapRect = minimapEl.getBoundingClientRect();
      return {
        panel: { left: panelRect.left, top: panelRect.top, right: panelRect.right, bottom: panelRect.bottom },
        minimap: { left: minimapRect.left, top: minimapRect.top, right: minimapRect.right, bottom: minimapRect.bottom },
      };
    });

    expect(layout, 'race layout snapshot').toBeTruthy();
    expect(rectsOverlap(layout.panel, layout.minimap), 'panel should not overlap minimap').toBe(false);
    await expect(panel).toContainText('players');
  });
});