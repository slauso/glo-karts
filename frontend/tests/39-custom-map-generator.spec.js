import { test, expect } from '@playwright/test';

test.describe('Custom Map Definition Auto-generator', () => {
  test('should generate map definition and spawn player when loading custom track', async ({ page }) => {
    await page.goto('/realtime.html?customTrack=stk_imported_test&mockMap=true');
    await page.waitForTimeout(2000);
    const __gloDebug = await page.evaluate(() => window.__gloDebug);
    expect(__gloDebug).toBeDefined();
    if (__gloDebug) {
      expect(__gloDebug.spawnPos).toBeTruthy();
      expect(__gloDebug.spawnPos.x).toBeDefined();
    }
  });
});