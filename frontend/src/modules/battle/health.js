// Simple battle health system for GLO KARTS battle mode
// Keeps logic isolated from race code

import { resetKart } from '../havok-physics.js';

export function createHealthSystem({ onRespawn, maxHealth = 100, invulnMs = 2000 }) {
  let health = maxHealth;
  let invulnerable = false;

  function damage(amount) {
    if (invulnerable) return { health, invulnerable };
    health = Math.max(0, health - amount);
    if (health === 0) {
      respawn();
    }
    return { health, invulnerable };
  }

  function heal(amount) {
    health = Math.min(maxHealth, health + amount);
    return { health, invulnerable };
  }

  function setHealth(value) {
    health = Math.max(0, Math.min(maxHealth, value));
    return { health, invulnerable };
  }

  function respawn() {
    // Reset kart to center spawn; game can override via onRespawn
    resetKart({ x: 0, y: 3, z: 0 }, 0);

    // Callback for custom spawn behavior/FX
    if (onRespawn) onRespawn();

    health = maxHealth;
    invulnerable = true;
    setTimeout(() => { invulnerable = false; }, invulnMs);

    return { health, invulnerable };
  }

  function getState() {
    return { health, maxHealth, invulnerable };
  }

  return { damage, heal, setHealth, respawn, getState };
}
