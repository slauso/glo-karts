/**
 * kart.js  GLO KARTS Port: Weight classes, drift, mini-turbo boost.
 *
 * Ported from STK data/karts/*.xml
 */

//  STK Weight-class presets 
export const WEIGHT_CLASSES = {
  light: {
    name: 'Light (Suzanne)',
    mass: 250,              // STK light karts are around 250-300
    maxEngineForce: 3200,   // High acceleration
    reverseForce: 1200,
    grip: 8.5,              // High grip
    driftRearGrip: 2.0,     // Easy to drift
    turboRate: 45,          // Fast nitro charge
    miniThreshold: 50,
    superThreshold: 90,
    miniBoostDuration: 0.8,
    superBoostDuration: 1.6,
    boostMultiplier: 2.0,
  },
  medium: {
    name: 'Medium (Tux)',
    mass: 350,              // STK medium karts are around 350-400
    maxEngineForce: 2800,   // Balanced
    reverseForce: 1000,
    grip: 7.5,
    driftRearGrip: 2.5,
    turboRate: 35,
    miniThreshold: 60,
    superThreshold: 100,
    miniBoostDuration: 0.7,
    superBoostDuration: 1.5,
    boostMultiplier: 1.8,
  },
  heavy: {
    name: 'Heavy (Nolok)',
    mass: 500,              // STK heavy karts are 500+
    maxEngineForce: 2400,   // Slow acceleration, high top speed (handled by drag)
    reverseForce: 800,
    grip: 6.5,              // Lower grip, slides more
    driftRearGrip: 3.5,     // Harder to initiate drift
    turboRate: 25,          // Slow nitro charge
    miniThreshold: 70,
    superThreshold: 110,
    miniBoostDuration: 0.6,
    superBoostDuration: 1.4,
    boostMultiplier: 1.6,
  },
};

//  State factory 
export function createKartState(weightClass = 'medium') {
  const preset = WEIGHT_CLASSES[weightClass] ?? WEIGHT_CLASSES.medium;
  return {
    weightClass,
    preset,
    // drift
    isDrifting: false,
    driftDir: 0,       // -1 = left, +1 = right
    driftCharge: 0,    // 0100
    sparksLevel: 0,    // 0=none, 1=blue (mini ready), 2=orange (super ready)
    // boost
    isBoosting: false,
    boostTimer: 0,
    pendingBoost: null, // 'mini' | 'super' | null
  };
}

//  Per-physics-step update (called from physics.js) 
export function updateKart(kart, keys, dt, speedKPH) {
  const p       = kart.preset;
  const turning = keys.a || keys.d;
  const fast    = speedKPH > 20;

  //  Drift initiation 
  if (keys.shift && turning && fast && !kart.isDrifting) {
    kart.isDrifting  = true;
    kart.driftDir    = keys.a ? -1 : 1;
    kart.driftCharge = 0;
    kart.sparksLevel = 0;
  }

  //  Drift tick 
  if (kart.isDrifting) {
    if (!keys.shift || speedKPH < 12) {
      // Release drift  award boost if charged enough
      if      (kart.driftCharge >= p.superThreshold) kart.pendingBoost = 'super';
      else if (kart.driftCharge >= p.miniThreshold)  kart.pendingBoost = 'mini';
      kart.isDrifting  = false;
      kart.driftCharge = 0;
      kart.sparksLevel = 0;
    } else if (keys.w && turning) {
      // Build charge while actively accelerating and drifting
      kart.driftCharge = Math.min(100, kart.driftCharge + dt * p.turboRate);
      kart.sparksLevel =
        kart.driftCharge >= p.superThreshold ? 2 :
        kart.driftCharge >= p.miniThreshold  ? 1 : 0;
    }
  }

  //  Boost application 
  if (kart.pendingBoost) {
    kart.isBoosting = true;
    kart.boostTimer = kart.pendingBoost === 'super' ? p.superBoostDuration : p.miniBoostDuration;
    kart.pendingBoost = null;
  }

  if (kart.isBoosting) {
    kart.boostTimer -= dt;
    if (kart.boostTimer <= 0) {
      kart.isBoosting = false;
      kart.boostTimer = 0;
    }
  }
}

//  Force getters (called from car.js) 
export function getEngineForce(kart, keys) {
  const p = kart.preset;
  let force = 0;
  if (keys.w) force = p.maxEngineForce;
  if (keys.s) force = -p.reverseForce;
  if (kart.isBoosting && force > 0) force *= p.boostMultiplier;
  return force;
}

export function getBrakingForce(kart, keys) {
  // In STK, braking is strong
  return (keys.s && keys.w) ? 150 : 0; 
}

export function getRearFriction(kart) {
  return kart.isDrifting ? kart.preset.driftRearGrip : kart.preset.grip;
}
