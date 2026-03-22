import { test, expect } from '@playwright/test';

test.describe('Realtime Input Lifecycle', () => {
  test('keeps gamepad listeners idempotent and clears pressed keys on blur', async ({ page }) => {
    await page.goto('/index.html');

    const result = await page.evaluate(async () => {
      const addCounts = { gamepadconnected: 0, gamepaddisconnected: 0 };
      const removeCounts = { gamepadconnected: 0, gamepaddisconnected: 0 };
      const originalAdd = window.addEventListener.bind(window);
      const originalRemove = window.removeEventListener.bind(window);

      window.addEventListener = (type, listener, options) => {
        if (type in addCounts) addCounts[type] += 1;
        return originalAdd(type, listener, options);
      };
      window.removeEventListener = (type, listener, options) => {
        if (type in removeCounts) removeCounts[type] += 1;
        return originalRemove(type, listener, options);
      };

      try {
        const gamepad = await import('/src/modules/gamepad-input.js');
        const realtime = await import('/src/modules/realtime/colyseus-babylon-client.js');

        gamepad.disposeGamepad();
        gamepad.initGamepad(() => {});
        gamepad.initGamepad(() => {});
        gamepad.disposeGamepad();
        const directCounts = {
          addCounts: { ...addCounts },
          removeCounts: { ...removeCounts },
        };

        const client = new realtime.ColyseusBabylonClient({ endpoint: 'ws://localhost:2567' });
        client.scene = {
          registerBeforeRender() {},
          unregisterBeforeRender() {},
          dispose() {},
        };
        client.engine = {
          dispose() {},
        };
        client.setupInputLoop();
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
        const beforeBlur = !!client._keys.Space;
        window.dispatchEvent(new Event('blur'));
        const afterBlur = !!client._keys.Space;
        client.dispose();

        return {
          directCounts,
          addCounts,
          removeCounts,
          beforeBlur,
          afterBlur,
          firePressedLastFrame: client._firePressedLastFrame,
          fire2PressedLastFrame: client._fire2PressedLastFrame,
        };
      } finally {
        window.addEventListener = originalAdd;
        window.removeEventListener = originalRemove;
      }
    });

    expect(result.directCounts.addCounts.gamepadconnected).toBe(1);
    expect(result.directCounts.addCounts.gamepaddisconnected).toBe(1);
    expect(result.directCounts.removeCounts.gamepadconnected).toBe(1);
    expect(result.directCounts.removeCounts.gamepaddisconnected).toBe(1);
    expect(result.addCounts.gamepadconnected).toBe(2);
    expect(result.addCounts.gamepaddisconnected).toBe(2);
    expect(result.removeCounts.gamepadconnected).toBeGreaterThanOrEqual(2);
    expect(result.removeCounts.gamepaddisconnected).toBeGreaterThanOrEqual(2);
    expect(result.beforeBlur).toBe(true);
    expect(result.afterBlur).toBe(false);
    expect(result.firePressedLastFrame).toBe(false);
    expect(result.fire2PressedLastFrame).toBe(false);
  });
});
