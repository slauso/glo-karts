const fs = require('fs');

const path = 'src/modules/gloflux/glo-flux.js';
let code = fs.readFileSync(path, 'utf8');

// 1. Add imports
const imports = import { PhysicsAggregate } from '@babylonjs/core/Physics/v2/physicsAggregate';
import { PhysicsShapeType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import { FILTER, applyFilterToAggregate } from '../realtime/collision-layers.js';
import { applyKartDriving, createDriftState } from '../kart-physics.js';
;
if (!code.includes('PhysicsAggregate')) {
  code = code.replace("import { createBotFleet", imports + "import { createBotFleet");
}

// 2. Patch createPlayer
const createPlayerOld = unction createPlayer(orch, id, position, meta = {}) {
  // Placeholder mesh — real kart loading happens in platform wiring
  const mesh = MeshBuilder.CreateBox(\kart_\\, { width: 1.2, height: 0.6, depth: 2 }, orch.scene);
  mesh.position = new Vector3(position.x, position.y, position.z);
  mesh.position.y = position.y ?? 0.8;

  const material = new StandardMaterial(\kart_mat_\\, orch.scene);
  try {
    material.diffuseColor = Color3.FromHexString(meta.gloColor || meta.playerColor || '#ff0080');
  } catch {
    material.diffuseColor = new Color3(0.95, 0.2, 0.55);
  }
  material.emissiveColor = material.diffuseColor.scale(0.35);
  mesh.material = material;

  return {
    id,
    mesh,
    physics: null, // attached by kart-physics after full wiring
    powerState: createPowerState(),
    surgeState: createSurgeState(),
    mutationState: createMutationState(),
    health: 100,
    maxHealth: 100,
    alive: true,
    isBot: false,
    score: 0,
    kills: 0,
    lap: 0,
    checkpoint: 0,
    name: meta.name || id,
  };
};

const createPlayerNew = unction createPlayer(orch, id, position, meta = {}) {
  const mesh = MeshBuilder.CreateBox(\kart_\\, { width: 1.8, height: 0.6, depth: 3.2 }, orch.scene);
  mesh.position = new Vector3(position.x, (position.y ?? 1) + 2, position.z); // Start higher to drop onto track

  const material = new StandardMaterial(\kart_mat_\\, orch.scene);
  try {
    material.diffuseColor = Color3.FromHexString(meta.gloColor || meta.playerColor || '#ff0080');
  } catch {
    material.diffuseColor = new Color3(0.95, 0.2, 0.55);
  }
  material.emissiveColor = material.diffuseColor.scale(0.35);
  mesh.material = material;

  const physics = window.__useRealPhysics ? new PhysicsAggregate(mesh, PhysicsShapeType.BOX, { mass: 800, friction: 0.8, restitution: 0.1, extents: new Vector3(1.8, 0.5, 3.2) }, orch.scene) : null;
  if (physics) {
    physics.body.setMassProperties({ inertia: new Vector3(0, 500, 0) });
    applyFilterToAggregate(physics, FILTER.KART);
  }

  return {
    id,
    mesh,
    physics,
    driftState: createDriftState(),
    input: { forward: false, reverse: false, left: false, right: false, brake: false },
    powerState: createPowerState(),
    surgeState: createSurgeState(),
    mutationState: createMutationState(),
    health: 100,
    maxHealth: 100,
    alive: true,
    isBot: false,
    score: 0,
    kills: 0,
    lap: 0,
    checkpoint: 0,
    name: meta.name || id,
  };
};

code = code.replace(createPlayerOld, createPlayerNew);

// 3. Enable physics in startLoading
code = code.replace("function startLoading(orch) {", "function startLoading(orch) {\n  window.__useRealPhysics = true;");


// 4. Tick kart physics
const oldTickSurgeCheck =       // Tick surge
      const surgeResult = tickSurge(p.surgeState, dt, now);
      if (surgeResult.tier >= 4 && !surgeResult.isBursting) {
        // Can trigger apocalypse — check on next tick
        orch.state = GLOFLUX_STATE.SURGE_CHECK;
      };

const newTickSurgeCheck =       // Tick surge
      const surgeResult = tickSurge(p.surgeState, dt, now);
      if (surgeResult.tier >= 4 && !surgeResult.isBursting) {
        // Can trigger apocalypse — check on next tick
        orch.state = GLOFLUX_STATE.SURGE_CHECK;
      }

      // Physics update
      if (p.physics && p.alive) {
         let input = p.isBot ? p.input : orch.input;
         const steer = input.left && !input.right ? -1 : (input.right && !input.left ? 1 : 0);
         const accel = input.forward && !input.reverse ? 1 : (input.reverse ? -1 : 0);
         
         const kartInput = { accelerate: accel, steer, brake: input.brake };
         applyKartDriving(p.physics.body, p.mesh, kartInput, dt, p.driftState, { spdMult: 1, strMult: 1 });
      };
code = code.replace(oldTickSurgeCheck, newTickSurgeCheck);


fs.writeFileSync(path, code);
console.log('Patched');
