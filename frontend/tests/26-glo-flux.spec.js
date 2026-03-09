import { test, expect } from '@playwright/test';

const VITE = 'http://localhost:5173';

test.describe('Phase 18 — Glo Flux Multiplayer Mode (Procedural Symbiotic Apocalypse)', () => {

  test('Glo Flux state machine and core procedural gen are exported and valid', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const data = await page.evaluate(async () => {
      // 1. Check Mode Orchestrator
      const { GloFluxMode } = await import('/src/modules/modes/glo-flux.js');
      // 2. Check Procedural Gen
      const { ProceduralSymbioticGen } = await import('/src/modules/procedural-symbiotic-gen.js');

      return {
        hasModeManager: !!GloFluxMode,
        hasProcGen: !!ProceduralSymbioticGen,
        familyCount: Object.keys(new GloFluxMode().families).length
      };
    });

    expect(data.hasModeManager).toBe(true);
    expect(data.hasProcGen).toBe(true);
    // Phantom Horde, Entropic Void, Biofractal Aegis, Psyche Apotheosis
    expect(data.familyCount).toBe(4);
  });

  test('Glo Flux power-up families generate 100% procedurally (zero assets)', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const data = await page.evaluate(async () => {
      const { ProceduralSymbioticGen } = await import('/src/modules/procedural-symbiotic-gen.js');
      const BABYLON = await import('@babylonjs/core');
      
      // Setup headless test scene
      const engine = new BABYLON.NullEngine();
      const scene = new BABYLON.Scene(engine);
      const gen = new ProceduralSymbioticGen(scene);
      
      const ghost = gen.createGhostTrailParticles(new BABYLON.TransformNode('test', scene));
      const well = gen.createGravityWellRing(new BABYLON.Vector3(0,0,0));
      const cocoon = gen.createFractalCocoon(new BABYLON.TransformNode('test2', scene));

      return {
        ghostExists: !!ghost && ghost.name === 'phantom_emitter',
        wellExists: !!well && well.name === 'gravity_well',
        cocoonExists: !!cocoon && cocoon.name === 'fractal_cocoon',
        wellIsMesh: well.getClassName() === 'Mesh',
      };
    });

    expect(data.ghostExists).toBe(true);
    expect(data.wellExists).toBe(true);
    expect(data.cocoonExists).toBe(true);
    expect(data.wellIsMesh).toBe(true);
  });
});
