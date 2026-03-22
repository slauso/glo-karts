/**
 * GLO KARTS — Organic Kart Feel Verification Tests
 *
 * Verifies the realistic kart behaviours and properties:
 *  1. Wheel classification (FL/FR/RL/RR) detected from model
 *  2. Uniform black tire tread material applied to all wheels
 *  3. Suspension spring fields exist and update per frame
 *  4. Suspension travel responds to driving (non-zero offsets)
 *  5. Steering lean (body roll) responds to steer input at speed
 *  6. Acceleration lean (nose pitch) responds to throttle/brake
 *  7. Front-wheel visual steering tracks input continuously
 *  8. applySuspension / applySteerVisuals methods exist on KartEntity
 *  9. No critical console errors during full driving sequence
 *
 * Requires: Vite (:5173) + Colyseus (:2567) both running.
 */
import { test, expect } from '@playwright/test';
import {
  injectGameConfig,
  waitForMatchLive,
  isCriticalError,
  BATTLE_CONFIG,
} from './helpers/game-helpers.js';

function withLobbyCode(config, label) {
  return {
    ...config,
    lobbyCode: `${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
  };
}

let ctx1, ctx2, page1, page2;
const allErrors = [];

test.describe.configure({ mode: 'serial' });

test.describe('Organic Kart Feel', () => {

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    const roomCfg = withLobbyCode(BATTLE_CONFIG, 'organic');
    ctx1 = await browser.newContext();
    ctx2 = await browser.newContext();
    page1 = await ctx1.newPage();
    page2 = await ctx2.newPage();
    page1.on('pageerror', (e) => allErrors.push(e.message));

    await injectGameConfig(page1, { ...roomCfg, playerName: 'ORG-P1' });
    await page1.goto('/realtime.html');
    await page1.waitForTimeout(2000);
    await injectGameConfig(page2, { ...roomCfg, playerName: 'ORG-P2' });
    await page2.goto('/realtime.html');

    await waitForMatchLive([page1, page2], 80_000);
    await page1.waitForTimeout(1500);
  });

  test.afterAll(async () => {
    await ctx1?.close();
    await ctx2?.close();
  });

  // ── Test 1: Wheel classification ──────────────────────────────────────
  test('wheels are classified as FL/FR/RL/RR', async () => {
    const wheels = await page1.evaluate(() => {
      const e = window.__gloClient?._localKartEntity;
      if (!e) return null;
      return {
        fl: !!e._wheels?.fl,
        fr: !!e._wheels?.fr,
        rl: !!e._wheels?.rl,
        rr: !!e._wheels?.rr,
        totalWheels: e.wheelMeshes?.length || 0,
      };
    });

    expect(wheels).toBeTruthy();
    expect(wheels.totalWheels, 'should have at least 4 wheel meshes').toBeGreaterThanOrEqual(4);
    expect(wheels.fl, 'front-left classified').toBe(true);
    expect(wheels.fr, 'front-right classified').toBe(true);
    expect(wheels.rl, 'rear-left classified').toBe(true);
    expect(wheels.rr, 'rear-right classified').toBe(true);
  });

  // ── Test 2: Black tire material ───────────────────────────────────────
  test('all wheels have uniform dark tire material', async () => {
    const tireInfo = await page1.evaluate(() => {
      const e = window.__gloClient?._localKartEntity;
      if (!e) return null;
      const mats = e.wheelMeshes.map(w => {
        const m = w.material;
        if (!m) return null;
        return {
          name: m.name,
          hasTexture: !!m.diffuseTexture,
          r: m.diffuseColor?.r,
          g: m.diffuseColor?.g,
          b: m.diffuseColor?.b,
        };
      });
      return { count: mats.length, mats };
    });

    expect(tireInfo).toBeTruthy();
    expect(tireInfo.count).toBeGreaterThanOrEqual(4);
    for (const mat of tireInfo.mats) {
      expect(mat).toBeTruthy();
      expect(mat.name).toContain('tire');
      expect(mat.hasTexture, 'tire has tread texture').toBe(true);
      // Dark rubber (each channel < 0.2)
      expect(mat.r, 'tire red < 0.2').toBeLessThan(0.2);
      expect(mat.g, 'tire green < 0.2').toBeLessThan(0.2);
      expect(mat.b, 'tire blue < 0.2').toBeLessThan(0.2);
    }
  });

  // ── Test 3: Suspension fields exist in drift state ────────────────────
  test('drift state has suspension spring fields', async () => {
    const susp = await page1.evaluate(() => {
      const ds = window.__gloClient?._driftState;
      if (!ds) return null;
      return {
        hasSuspTravel: Array.isArray(ds.suspTravel),
        hasSuspVelocity: Array.isArray(ds.suspVelocity),
        travelLen: ds.suspTravel?.length,
        velocityLen: ds.suspVelocity?.length,
        hasSteerLean: 'steerLean' in ds,
        hasAccelLean: 'accelLean' in ds,
      };
    });

    expect(susp).toBeTruthy();
    expect(susp.hasSuspTravel, 'suspTravel array exists').toBe(true);
    expect(susp.hasSuspVelocity, 'suspVelocity array exists').toBe(true);
    expect(susp.travelLen, '4 suspension channels').toBe(4);
    expect(susp.velocityLen, '4 velocity channels').toBe(4);
    expect(susp.hasSteerLean, 'steerLean field exists').toBe(true);
    expect(susp.hasAccelLean, 'accelLean field exists').toBe(true);
  });

  // ── Test 4: Suspension travel changes while driving ───────────────────
  test('suspension travel is non-zero after driving', async () => {
    await page1.keyboard.down('w');
    await page1.waitForTimeout(2000);

    // Poll for any non-zero suspension travel
    let anyNonZero = false;
    for (let i = 0; i < 15; i++) {
      await page1.waitForTimeout(200);
      anyNonZero = await page1.evaluate(() => {
        const t = window.__gloClient?._driftState?.suspTravel;
        if (!t) return false;
        return t.some(v => Math.abs(v) > 0.001);
      });
      if (anyNonZero) break;
    }

    await page1.keyboard.up('w');
    await page1.waitForTimeout(300);

    expect(anyNonZero, 'at least one wheel has non-zero suspension travel').toBe(true);
  });

  // ── Test 5: Steering lean responds to input ───────────────────────────
  test('steering lean responds to steer input at speed', async () => {
    // Build speed
    await page1.keyboard.down('w');
    await page1.waitForTimeout(2000);

    // Steer right
    await page1.keyboard.down('d');

    let leanVal = 0;
    for (let i = 0; i < 15; i++) {
      await page1.waitForTimeout(200);
      leanVal = await page1.evaluate(() =>
        window.__gloClient?._driftState?.steerLean || 0
      );
      if (Math.abs(leanVal) > 0.005) break;
    }

    await page1.keyboard.up('d');
    await page1.keyboard.up('w');
    await page1.waitForTimeout(300);

    expect(Math.abs(leanVal), 'steer lean should be > 0.005 when turning').toBeGreaterThan(0.005);
  });

  // ── Test 6: Acceleration lean responds to throttle ────────────────────
  test('acceleration lean responds to throttle input', async () => {
    await page1.keyboard.down('w');

    let accelLean = 0;
    for (let i = 0; i < 20; i++) {
      await page1.waitForTimeout(200);
      accelLean = await page1.evaluate(() =>
        window.__gloClient?._driftState?.accelLean || 0
      );
      if (Math.abs(accelLean) > 0.005) break;
    }

    await page1.keyboard.up('w');
    await page1.waitForTimeout(300);

    expect(Math.abs(accelLean), 'accel lean should be > 0.005 under throttle').toBeGreaterThan(0.005);
  });

  // ── Test 7: Front wheels steer visually ───────────────────────────────
  test('front wheels rotate visually when steering', async () => {
    // Build speed
    await page1.keyboard.down('w');
    await page1.waitForTimeout(1500);

    // Steer left
    await page1.keyboard.down('a');
    await page1.waitForTimeout(500);

    const wheelRot = await page1.evaluate(() => {
      const e = window.__gloClient?._localKartEntity;
      if (!e?._wheels?.fl) return null;
      return {
        flY: e._wheels.fl.rotation?.y || 0,
        frY: e._wheels.fr?.rotation?.y || 0,
      };
    });

    await page1.keyboard.up('a');
    await page1.keyboard.up('w');
    await page1.waitForTimeout(300);

    expect(wheelRot).toBeTruthy();
    // Steering left (input.steer = +1) → positive Y rotation on front wheels
    expect(Math.abs(wheelRot.flY), 'FL wheel has non-zero Y rotation').toBeGreaterThan(0.01);
  });

  // ── Test 8: KartEntity has new methods ────────────────────────────────
  test('KartEntity has suspension and steer visual methods', async () => {
    const methods = await page1.evaluate(() => {
      const e = window.__gloClient?._localKartEntity;
      if (!e) return null;
      return {
        hasApplySuspension: typeof e.applySuspension === 'function',
        hasApplySteerVisuals: typeof e.applySteerVisuals === 'function',
        hasSpinWheels: typeof e.spinWheels === 'function',
        hasApplyDriftVisuals: typeof e.applyDriftVisuals === 'function',
        hasTireMaterial: !!e._tireMaterial,
        hasWheelBaseY: e._wheelBaseY instanceof Map,
      };
    });

    expect(methods).toBeTruthy();
    expect(methods.hasApplySuspension).toBe(true);
    expect(methods.hasApplySteerVisuals).toBe(true);
    expect(methods.hasSpinWheels).toBe(true);
    expect(methods.hasApplyDriftVisuals).toBe(true);
    expect(methods.hasTireMaterial).toBe(true);
    expect(methods.hasWheelBaseY).toBe(true);
  });

  // ── Test 9: No critical errors ────────────────────────────────────────
  test('no critical errors during full organic driving sequence', async () => {
    // Full gameplay: accelerate, steer, brake, drift
    await page1.keyboard.down('w');
    await page1.waitForTimeout(1000);
    await page1.keyboard.down('d');
    await page1.waitForTimeout(500);
    await page1.keyboard.up('d');
    await page1.keyboard.down('a');
    await page1.waitForTimeout(500);
    await page1.keyboard.up('a');
    // Brake hard
    await page1.keyboard.down('s');
    await page1.waitForTimeout(500);
    await page1.keyboard.up('s');
    // Drift
    await page1.keyboard.down('x');
    await page1.keyboard.down('a');
    await page1.waitForTimeout(1500);
    await page1.keyboard.up('x');
    await page1.keyboard.up('a');
    await page1.keyboard.up('w');
    await page1.waitForTimeout(300);

    const criticalErrors = allErrors.filter(isCriticalError);
    expect(criticalErrors, `critical errors: ${criticalErrors.join('; ')}`).toHaveLength(0);
  });
});
