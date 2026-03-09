/**
 * 15-marketplace.spec.js — Phase 15.2 checkpoint
 *
 * Validates the Addon Marketplace Framework Shell:
 *  - Page loads without fatal errors
 *  - Marketplace module exports are available
 *  - Catalogue and wallet stubs function correctly
 *  - Game-modes registry contains marketplace mode
 */
import { test, expect } from '@playwright/test';

const VITE = 'http://localhost:5173';

test.describe('Addon Marketplace', () => {

  test('marketplace.html loads with header and grid', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(`${VITE}/marketplace.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Header visible
    const header = await page.locator('#mp-header').count();
    expect(header).toBe(1);

    // Grid rendered with add-on cards
    const grid = await page.locator('#addon-grid').count();
    expect(grid).toBe(1);

    // Wallet button present
    const walletBtn = await page.locator('#wallet-btn').count();
    expect(walletBtn).toBe(1);

    // No fatal errors
    const fatalErrors = errors.filter(e =>
      e.includes('Cannot read properties of null') || e.includes('is not a function')
    );
    expect(fatalErrors).toHaveLength(0);
  });

  test('marketplace module exports required API surface', async ({ page }) => {
    await page.goto(`${VITE}/marketplace.html`, { waitUntil: 'domcontentloaded' });

    const exports = await page.evaluate(async () => {
      const mod = await import('/src/modules/marketplace.js');
      return {
        hasAddonCategories:   Array.isArray(mod.ADDON_CATEGORIES),
        hasAddonCatalogue:    Array.isArray(mod.ADDON_CATALOGUE),
        hasGetWalletState:    typeof mod.getWalletState === 'function',
        hasConnectWallet:     typeof mod.connectWallet === 'function',
        hasDisconnectWallet:  typeof mod.disconnectWallet === 'function',
        hasPurchaseAddon:     typeof mod.purchaseAddon === 'function',
        hasGetUnlockedAddons: typeof mod.getUnlockedAddons === 'function',
        hasRestoreUnlocks:    typeof mod.restoreUnlocks === 'function',
        hasOnMarketplaceEvent: typeof mod.onMarketplaceEvent === 'function',
        catalogueLength:      mod.ADDON_CATALOGUE.length,
        categoryCount:        mod.ADDON_CATEGORIES.length,
      };
    });

    expect(exports.hasAddonCategories).toBe(true);
    expect(exports.hasAddonCatalogue).toBe(true);
    expect(exports.hasGetWalletState).toBe(true);
    expect(exports.hasConnectWallet).toBe(true);
    expect(exports.hasDisconnectWallet).toBe(true);
    expect(exports.hasPurchaseAddon).toBe(true);
    expect(exports.hasGetUnlockedAddons).toBe(true);
    expect(exports.hasRestoreUnlocks).toBe(true);
    expect(exports.hasOnMarketplaceEvent).toBe(true);
    expect(exports.catalogueLength).toBeGreaterThanOrEqual(6);
    expect(exports.categoryCount).toBe(4);
  });

  test('wallet connect stub returns valid state', async ({ page }) => {
    await page.goto(`${VITE}/marketplace.html`, { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async () => {
      const mod = await import('/src/modules/marketplace.js');

      // Before connecting
      const before = mod.getWalletState();

      // Connect
      const connected = await mod.connectWallet();

      // After connecting
      const after = mod.getWalletState();

      return { before, connected, after };
    });

    expect(result.before.connected).toBe(false);
    expect(result.connected.connected).toBe(true);
    expect(result.connected.address).toMatch(/^0x[a-f0-9]{40}$/);
    expect(result.connected.balance).toBeGreaterThan(0);
    expect(result.after.connected).toBe(true);
  });

  test('purchase flow deducts GLOs and unlocks addon', async ({ page }) => {
    await page.goto(`${VITE}/marketplace.html`, { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async () => {
      const mod = await import('/src/modules/marketplace.js');

      // Connect wallet first
      await mod.connectWallet();
      const balanceBefore = mod.getWalletState().balance;

      // Purchase cheapest addon (fx_confetti = 200 GLOs)
      const purchaseResult = await mod.purchaseAddon('fx_confetti');
      const balanceAfter = mod.getWalletState().balance;

      // Check unlock
      const unlocked = mod.getUnlockedAddons();

      // Try re-purchase
      const rePurchase = await mod.purchaseAddon('fx_confetti');

      return { balanceBefore, purchaseResult, balanceAfter, unlocked, rePurchase };
    });

    expect(result.purchaseResult.success).toBe(true);
    expect(result.balanceAfter).toBe(result.balanceBefore - 200);
    expect(result.unlocked).toContain('fx_confetti');
    expect(result.rePurchase.success).toBe(false); // already owned
  });

  test('game-modes.js includes marketplace mode', async ({ page }) => {
    await page.goto(`${VITE}/index.html`, { waitUntil: 'domcontentloaded' });

    const mode = await page.evaluate(async () => {
      const mod = await import('/src/game-modes.js');
      const m = mod.MODE_REGISTRY.marketplace;
      return {
        exists:   !!m,
        category: m?.category,
        page:     m?.page,
        hasShopCategory: !!mod.CATEGORIES.shop,
      };
    });

    expect(mode.exists).toBe(true);
    expect(mode.category).toBe('shop');
    expect(mode.page).toBe('marketplace.html');
    expect(mode.hasShopCategory).toBe(true);
  });

  test('category tabs render and switch content', async ({ page }) => {
    await page.goto(`${VITE}/marketplace.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // Should have 4 category tab buttons
    const tabCount = await page.locator('#category-tabs button').count();
    expect(tabCount).toBe(4);

    // Click the "Tracks" tab
    await page.locator('#category-tabs button').filter({ hasText: 'Tracks' }).click();
    await page.waitForTimeout(300);

    // Grid should show track items
    const gridHTML = await page.locator('#addon-grid').innerHTML();
    expect(gridHTML).toContain('Volcano Circuit');
  });
});
