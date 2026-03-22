import { test, expect } from '@playwright/test';
import { injectGameConfig, waitForDebug, BATTLE_CONFIG } from './helpers/game-helpers.js';

function withLobbyCode(config, label) {
  return {
    ...config,
    lobbyCode: `${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
  };
}

async function waitForBattleClientReady(page, timeout = 30_000) {
  await waitForDebug(page, (d) => d.roomJoined === true && d.kartLoaded === true, timeout);
}

test.describe('Controls Overlay Card', () => {
  test('renders as a compact glass quick-reference card', async ({ page }) => {
    const cfg = withLobbyCode({ ...BATTLE_CONFIG, maxPlayers: 1 }, 'controls-card');
    await injectGameConfig(page, cfg);
    await page.goto('/realtime.html');
    await waitForBattleClientReady(page);

    await page.evaluate(async () => {
      const mod = await import('/src/modules/input-config.js');
      mod.showControlsOverlay();
    });

    const overlay = page.locator('#controls-overlay');
    const card = overlay.locator('> div').first();
    await expect(overlay).toBeVisible();
    await expect(card).toContainText('CONTROLS');
    await expect(card).toContainText('Drive / Fire');
    await expect(card).toContainText('Quick bind reference.');
    await expect(card).toContainText('Throttle');
    await expect(card).toContainText('Primary');
    await expect(card).toContainText('Pickup');
    await expect(card).toContainText('Click to remap. Esc closes.');
    await expect(card.getByRole('button', { name: 'Reset' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Close' })).toBeVisible();

    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.width ?? 999).toBeLessThanOrEqual(430);

    await expect(card).not.toContainText('Drive. Aim. React.');
    await expect(card).not.toContainText('Reset Defaults');
  });
});
