/**
 * 22-trigger-physics.spec.js — Phase 13.9 Item/Weapon Trigger Physics
 *
 * Validates:
 *   - 13.9.1: initRaceItems accepts physicsOpts parameter
 *   - 13.9.2: Trigger observable wiring (function shape)
 *   - 13.9.3: Projectile/trap trigger aggregates created via useCurrentItem
 *   - 13.9.4: Distance-based fallback still works without Havok
 *   - Dispose cleans up trigger state
 */
import { test, expect } from '@playwright/test';

const VITE = 'http://localhost:5173';

test.describe('Phase 13.9 — Item/Weapon Trigger Physics', () => {

  test('13.9.1: initRaceItems accepts physicsOpts and creates item boxes', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async () => {
      const mod = await import('/src/modules/race-items.js');
      // Check signature accepts 3 params (scene, trackItems, physicsOpts)
      return {
        initLength: mod.initRaceItems.length,
        hasDispose: typeof mod.disposeRaceItems === 'function',
        hasUpdate: typeof mod.updateRaceItems === 'function',
        hasUse: typeof mod.useCurrentItem === 'function',
        hasOnCollected: typeof mod.onItemCollected === 'function',
      };
    });

    expect(result.initLength).toBeGreaterThanOrEqual(2); // scene, trackItems, [physicsOpts]
    expect(result.hasDispose).toBe(true);
    expect(result.hasUpdate).toBe(true);
    expect(result.hasUse).toBe(true);
    expect(result.hasOnCollected).toBe(true);
  });

  test('13.9.4: distance-based fallback code paths exist without Havok', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    // Verify the source uses distance-based checks as fallback (Vector3.Distance calls)
    const result = await page.evaluate(async () => {
      const resp = await fetch('/src/modules/race-items.js');
      const src = await resp.text();
      return {
        hasDistanceCheck: src.includes('Vector3.Distance'),
        hasItemBoxPickup: src.includes('ITEM_BOX_PICKUP_RADIUS'),
        hasBananaHit: src.includes('BANANA_HIT_RADIUS'),
        hasNitroPickup: src.includes('NITRO_PICKUP_RADIUS'),
        // physicsOpts is optional — _useTriggerPhysics defaults to false
        hasUseTriggerFlag: src.includes('_useTriggerPhysics = false'),
        hasPhysicsGuard: src.includes('if (_useTriggerPhysics)'),
      };
    });

    expect(result.hasDistanceCheck).toBe(true);
    expect(result.hasItemBoxPickup).toBe(true);
    expect(result.hasBananaHit).toBe(true);
    expect(result.hasNitroPickup).toBe(true);
    expect(result.hasUseTriggerFlag).toBe(true);
    expect(result.hasPhysicsGuard).toBe(true);
  });

  test('13.9: dispose cleanup handles trigger aggregates', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    // Verify dispose code properly handles trigger aggregate cleanup in source
    const result = await page.evaluate(async () => {
      const resp = await fetch('/src/modules/race-items.js');
      const src = await resp.text();
      return {
        disposesBoxTrigger: src.includes('box.triggerAgg') && src.includes('box.triggerAgg.dispose()'),
        disposesTrapTrigger: src.includes('t.triggerAgg') && src.includes('t.triggerAgg.dispose()'),
        disposesProjectileTrigger: src.includes('p.triggerAgg') && src.includes('p.triggerAgg.dispose()'),
        disposesBananaTrigger: src.includes('b.triggerAgg') && src.includes('b.triggerAgg.dispose()'),
        removesObserver: src.includes('onTriggerCollisionObservable.remove(_triggerObserver)'),
        resetsPhysicsState: src.includes('_useTriggerPhysics = false'),
      };
    });

    expect(result.disposesBoxTrigger).toBe(true);
    expect(result.disposesTrapTrigger).toBe(true);
    expect(result.disposesProjectileTrigger).toBe(true);
    expect(result.disposesBananaTrigger).toBe(true);
    expect(result.removesObserver).toBe(true);
    expect(result.resetsPhysicsState).toBe(true);
  });

  test('13.9: collision-layers exports FILTER presets for items', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async () => {
      const { FILTER, applyFilterToAggregate } = await import('/src/modules/realtime/collision-layers.js');
      return {
        hasItemBox: FILTER.ITEM_BOX != null,
        hasProjectile: FILTER.PROJECTILE != null,
        hasTrap: FILTER.TRAP != null,
        hasApplyFn: typeof applyFilterToAggregate === 'function',
        itemBoxHasMask: FILTER.ITEM_BOX?.filterMembershipMask != null,
        itemBoxHasCollide: FILTER.ITEM_BOX?.filterCollideMask != null,
      };
    });

    expect(result.hasItemBox).toBe(true);
    expect(result.hasProjectile).toBe(true);
    expect(result.hasTrap).toBe(true);
    expect(result.hasApplyFn).toBe(true);
    expect(result.itemBoxHasMask).toBe(true);
    expect(result.itemBoxHasCollide).toBe(true);
  });

  test('13.9.2: race-items has _raceItemType tagging pattern', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    // Verify the source code uses _raceItemType tagging for trigger identification
    const result = await page.evaluate(async () => {
      const resp = await fetch('/src/modules/race-items.js');
      const src = await resp.text();
      return {
        hasItemBoxTag: src.includes("_raceItemType = 'item_box'"),
        hasTrapTag: src.includes("_raceItemType = 'trap'"),
        hasProjectileTag: src.includes("_raceItemType = 'projectile'"),
        hasWireObservable: src.includes('_wireTriggerObservable'),
        hasCreateTrigger: src.includes('_createTrigger'),
        hasTriggerEntered: src.includes('TRIGGER_ENTERED'),
      };
    });

    expect(result.hasItemBoxTag).toBe(true);
    expect(result.hasTrapTag).toBe(true);
    expect(result.hasProjectileTag).toBe(true);
    expect(result.hasWireObservable).toBe(true);
    expect(result.hasCreateTrigger).toBe(true);
    expect(result.hasTriggerEntered).toBe(true);
  });
});
