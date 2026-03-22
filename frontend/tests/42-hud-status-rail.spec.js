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

async function readHudStatusState(page) {
  return page.evaluate(() => {
    const client = window.__gloClient;
    const scene = client?.scene;
    const guiTexture = scene?.textures?.find?.((t) => t?.name === 'BattleHUD')
      || scene?.textures?.find?.((t) => t?._name === 'BattleHUD');
    const root = guiTexture?._rootContainer || guiTexture?.rootContainer || null;

    function findControl(control, name) {
      if (!control) return null;
      if (control.name === name) return control;
      const children = control.children || control._children || [];
      for (const child of children) {
        const match = findControl(child, name);
        if (match) return match;
      }
      return null;
    }

    const lane = findControl(root, 'hudStatusLane');
    const laneTitle = findControl(root, 'hudStatusLaneTitle');
    const laneSubtitle = findControl(root, 'hudStatusLaneSubtitle');
    const chip = findControl(root, 'hudStatusChipText');
    const ribbonTrack = findControl(root, 'hudStatusRibbonTrack');
    const ribbonFill = findControl(root, 'hudStatusRibbonFill');
    const arenaLine = findControl(root, 'hudArenaLine');
    const scoreLabel = findControl(root, 'scoreLabel');
    const eyebrowLabels = [];

    function collectEyebrows(control) {
      if (!control) return;
      if (typeof control.name === 'string' && control.name.startsWith('hudEyebrowLabel')) {
        eyebrowLabels.push(String(control.text || '').trim());
      }
      const children = control.children || control._children || [];
      for (const child of children) collectEyebrows(child);
    }

    collectEyebrows(root);

    return {
      hasBattleHud: !!guiTexture,
      laneAlpha: Number(lane?.alpha ?? 0),
      laneLeft: lane?.left ?? null,
      laneTitle: laneTitle?.text ?? '',
      laneSubtitle: laneSubtitle?.text ?? '',
      chipText: chip?.text ?? '',
      ribbonAlpha: Number(ribbonTrack?.alpha ?? 0),
      ribbonFillWidth: ribbonFill?.width ?? null,
      arenaLineAlpha: Number(arenaLine?.alpha ?? 0),
      scoreLabel: scoreLabel?.text ?? '',
      eyebrowLabels,
      hasLegacyDomOverlay: !!document.querySelector('.tk-status-overlay'),
    };
  });
}

test.describe.configure({ mode: 'serial' });

test.describe('Integrated Battle HUD Status Rail', () => {
  test('personal status uses Babylon GUI lane and ribbon instead of a DOM popup', async ({ page }) => {
    const cfg = withLobbyCode({ ...BATTLE_CONFIG, maxPlayers: 1 }, 'hud-rail-personal');
    await injectGameConfig(page, cfg);
    await page.goto('/realtime.html');
    await waitForBattleClientReady(page);

    await page.evaluate(() => {
      window.__gloClient?.showEffectOverlay('ludicrous', 1800);
    });
    await page.waitForFunction(() => {
      const client = window.__gloClient;
      const scene = client?.scene;
      const guiTexture = scene?.textures?.find?.((t) => t?.name === 'BattleHUD')
        || scene?.textures?.find?.((t) => t?._name === 'BattleHUD');
      const root = guiTexture?._rootContainer || guiTexture?.rootContainer || null;
      const walk = (control, name) => {
        if (!control) return null;
        if (control.name === name) return control;
        const children = control.children || control._children || [];
        for (const child of children) {
          const match = walk(child, name);
          if (match) return match;
        }
        return null;
      };
      const lane = walk(root, 'hudStatusLane');
      const title = walk(root, 'hudStatusLaneTitle');
      return Number(lane?.alpha || 0) > 0.2 && String(title?.text || '').includes('Ludicrous');
    }, null, { timeout: 5000 });

    const hud = await readHudStatusState(page);
    expect(hud.hasBattleHud).toBe(true);
    expect(hud.hasLegacyDomOverlay).toBe(false);
    expect(hud.eyebrowLabels).toEqual(expect.arrayContaining(['HEALTH', 'PRIMARY', 'PICKUP', 'RESERVE', 'KNOCK OUTS']));
    expect(hud.eyebrowLabels).not.toContain('LIVES');
    expect(hud.scoreLabel).toBe('');
  });

  test('arena status uses the integrated rail and ambient line', async ({ page }) => {
    const cfg = withLobbyCode({ ...BATTLE_CONFIG, maxPlayers: 1 }, 'hud-rail-arena');
    await injectGameConfig(page, cfg);
    await page.goto('/realtime.html');
    await waitForBattleClientReady(page);

    await page.evaluate(() => {
      window.__gloClient?.showArenaEffectOverlay('arena_rain', 2200);
    });
    await page.waitForFunction(() => {
      const client = window.__gloClient;
      const scene = client?.scene;
      const guiTexture = scene?.textures?.find?.((t) => t?.name === 'BattleHUD')
        || scene?.textures?.find?.((t) => t?._name === 'BattleHUD');
      const root = guiTexture?._rootContainer || guiTexture?.rootContainer || null;
      const walk = (control, name) => {
        if (!control) return null;
        if (control.name === name) return control;
        const children = control.children || control._children || [];
        for (const child of children) {
          const match = walk(child, name);
          if (match) return match;
        }
        return null;
      };
      const lane = walk(root, 'hudStatusLane');
      const title = walk(root, 'hudStatusLaneTitle');
      const arenaLine = walk(root, 'hudArenaLine');
      return Number(lane?.alpha || 0) > 0.1
        && Number(arenaLine?.alpha || 0) > 0.1
        && String(title?.text || '').includes('Rain Slick');
    }, null, { timeout: 5000 });

    const hud = await readHudStatusState(page);
    expect(hud.hasBattleHud).toBe(true);
    expect(hud.hasLegacyDomOverlay).toBe(false);
  });

  test('empty weapon state does not render a no-weapon status lane', async ({ page }) => {
    const cfg = withLobbyCode({ ...BATTLE_CONFIG, maxPlayers: 1 }, 'hud-rail-no-weapon');
    await injectGameConfig(page, cfg);
    await page.goto('/realtime.html');
    await waitForBattleClientReady(page);

    await page.evaluate(() => {
      window.__gloClient?.showEffectOverlay('no_weapon', 1800);
    });
    await page.waitForTimeout(250);

    const hud = await readHudStatusState(page);
    expect(hud.laneTitle).toBe('');
    expect(hud.laneAlpha).toBeLessThan(0.05);
    expect(hud.hasLegacyDomOverlay).toBe(false);
  });
});
