// Simple battle health system for Twisted Kart battle mode
// Keeps logic isolated from race code

export function createHealthSystem({ ammo, getCarBody, onRespawn, maxHealth = 100, invulnMs = 2000 }) {
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
    const body = getCarBody && getCarBody();
    if (!ammo || !body) return { health, invulnerable };

    // Zero velocities
    const zero = new ammo.btVector3(0,0,0);
    body.setLinearVelocity(zero);
    body.setAngularVelocity(zero);

    // Center spawn; game can override via onRespawn
    const t = new ammo.btTransform();
    t.setIdentity();
    t.setOrigin(new ammo.btVector3(0, 3, 0));
    const q = new ammo.btQuaternion(0, 0, 0, 1);
    t.setRotation(q);
    body.setWorldTransform(t);
    const ms = body.getMotionState && body.getMotionState();
    if (ms) ms.setWorldTransform(t);

    // Callback for custom spawn behavior/FX
    if (onRespawn) onRespawn();

    health = maxHealth;
    invulnerable = true;
    setTimeout(() => { invulnerable = false; }, invulnMs);

    ammo.destroy(zero);
    ammo.destroy(t);
    ammo.destroy(q);

    return { health, invulnerable };
  }

  function getState() {
    return { health, maxHealth, invulnerable };
  }

  return { damage, heal, setHealth, respawn, getState };
}
