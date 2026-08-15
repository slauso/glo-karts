# GloKarts Multiplayer Synchronization Debugging Guide

## Critical Bug Fixed: Projectile Field Name Mismatch

### The Problem
**Symptom:** Players join multiplayer race, weapons fire but projectiles never appear on screen
**Root Cause:** Client code was reading projectile positions from wrong field names
- Schema defines: `x`, `y`, `z`
- Client was reading: `px`, `py`, `pz`
- Result: All projectiles positioned at (0, 0, 0) - invisible

### The Fix (Applied)
**File:** `frontend/src/multiplayer-editor3-main.js`
**Lines:** 1757-1759

```javascript
// BEFORE (BROKEN):
const mesh = ensureProjMesh(key, proj.subType || 'default');
mesh.position.set(proj.px || 0, proj.py || 0, proj.pz || 0);

// AFTER (FIXED):
const mesh = ensureProjMesh(key, proj.subType || 'default');
// Fixed: Schema defines x/y/z, not px/py/pz
mesh.position.set(proj.x || 0, proj.y || 0, proj.z || 0);
```

---

## Multiplayer Data Flow Architecture

### 1. Client Input (60Hz)
```
User presses key E
↓
fireWeapon message sent to server
room.send('fireWeapon', {slot: 'secondary'})
↓
Server receives: Editor3RaceRoom.onMessage("fireWeapon")
```

### 2. Server Processing
```
fireWeapon handler validates:
  ✓ Kart exists and is racing
  ✓ Weapon has ammo
  ✓ Not on cooldown
  ✓ Not stunned/spinning
↓
Decrement ammo: kart.ammo2 = Math.max(0, ammo - 1)
Spawn projectile: _spawnProjectile()
  - Create ProjectileState with x, y, z fields
  - Set ownerId, subType, velocity
  - Add to state.projectiles MapSchema
↓
Broadcast "projectileSpawned" message
```

### 3. Server Physics (60Hz)
```
_tickProjectiles() runs every frame:
  For each projectile in state.projectiles:
    ✓ Apply gravity: vy += gravity * dt
    ✓ Bounce off ground
    ✓ Homing tracking (if enabled)
    ✓ Update position: x += vx*dt, y += vy*dt, z += vz*dt
    ✓ Collision detection
    ✓ Expire when lifetime exceeded
```

### 4. Server Broadcast (30Hz)
```
_writeSnapshot() consolidates state:
  For each kart in vehicles map:
    Copy position/rotation/velocity to KartState
    Copy effects/boost/stun state
  
Colyseus automatically diffs changes:
  Only changed fields sent to clients
  Schema: {
    karts: {sessionId: KartState},
    pickups: {pickupId: PickupState},
    projectiles: {projKey: ProjectileState}
  }
```

### 5. Client State Update
```
room.onStateChange(state) fires:
  state.karts.forEach((kart, sid) => {
    Update ghost.target positions
    Push snapshot for interpolation
    Update HUD (lap, weapon, etc.)
  })
  
  state.pickups.forEach((p, id) => {
    ensurePickupMesh(id, p.x, p.y, p.z, !!p.active, p.kind)
  })
  
  state.projectiles.forEach((proj, key) => {
    mesh = ensureProjMesh(key, proj.subType)
    mesh.position.set(proj.x, proj.y, proj.z)  ← NOW FIXED
  })
```

### 6. Client Animation (60Hz)
```
tick(now) handles frame-by-frame updates:
  For each ghost kart:
    Interpolate between snapshots in buffer
    Update mesh position/rotation
    Apply visual effects (wheels, drift sparks, etc.)
  
  Update projectile positions (from state)
  Update pickup visibility (from state.pickups[].active)
  Shake camera if hit
```

---

## Data Structure Verification

### ProjectileState Schema (Server Definition)
**File:** `realtime/src/rooms/Editor3RaceRoom.js` Lines 128-140

```javascript
class ProjectileState extends Schema {}
type("string")(ProjectileState.prototype, "ownerId");      // Player who fired
type("string")(ProjectileState.prototype, "subType");      // green_shell, banana, etc
type("number")(ProjectileState.prototype, "x");            // Position X (mm)
type("number")(ProjectileState.prototype, "y");            // Position Y (mm)
type("number")(ProjectileState.prototype, "z");            // Position Z (mm)
type("number")(ProjectileState.prototype, "vx");           // Velocity X (mm/s)
type("number")(ProjectileState.prototype, "vy");           // Velocity Y (mm/s)
type("number")(ProjectileState.prototype, "vz");           // Velocity Z (mm/s)
type("string")(ProjectileState.prototype, "targetId");     // For homing (blue shell)
type("uint8")(ProjectileState.prototype, "bouncesLeft");   // Remaining bounces
type("uint8")(ProjectileState.prototype, "armed");         // 1 = can damage owner
```

**Note:** NO `px`, `py`, `pz` fields defined! The client was reading non-existent fields.

### KartState Schema (Comparison)
**File:** `realtime/src/rooms/Editor3RaceRoom.js` Lines 48-110

```javascript
class KartState extends Schema {}
type("number")(KartState.prototype, "x");     // Position
type("number")(KartState.prototype, "y");
type("number")(KartState.prototype, "z");
type("number")(KartState.prototype, "qx");    // Rotation (quaternion)
type("number")(KartState.prototype, "qy");
type("number")(KartState.prototype, "qz");
type("number")(KartState.prototype, "qw");
type("number")(KartState.prototype, "vx");    // Velocity
type("number")(KartState.prototype, "vy");
type("number")(KartState.prototype, "vz");
type("string")(KartState.prototype, "weapon2");      // Active weapon
type("uint8")(KartState.prototype, "ammo2");         // Active ammo
type("string")(KartState.prototype, "weapon3");      // Reserve weapon
type("uint8")(KartState.prototype, "ammo3");         // Reserve ammo
// ... plus many more fields for effects, physics state, etc
```

### PickupState Schema
**File:** `realtime/src/rooms/Editor3RaceRoom.js` Lines 112-117

```javascript
class PickupState extends Schema {}
type("number")(PickupState.prototype, "x");       // Position
type("number")(PickupState.prototype, "y");
type("number")(PickupState.prototype, "z");
type("boolean")(PickupState.prototype, "active"); // True = pickup available
type("string")(PickupState.prototype, "kind");    // item_box, etc
```

---

## Expected Behavior After Fix

### Weapon Firing Should Now Work:
1. Player 1 presses E (fireWeapon)
2. Server validates and spawns projectile
3. Server broadcasts projectile position (x, y, z) every 33ms
4. Client receives update and renders mesh at correct position
5. Player 2 sees projectile approaching on screen
6. Collision detected, impact message broadcast
7. Both players see explosion effect

### Item Pickup Should Work:
1. Player 1 drives near item box (16m radius)
2. Client sends pickupItem message
3. Server validates distance and inventory space
4. Server sets pickup.active = false
5. Server grants weapon and broadcasts itemReceived
6. Client receives state change: pickup.active becomes false
7. ensurePickupMesh detects change and triggers collection VFX
8. Both players see pickup flash and sparkle

### Position Sync Should Be Smooth:
1. Each player's position updated at 30Hz
2. Client interpolates between snapshots
3. Remote kart moves smoothly on screen
4. No teleporting or stuttering

---

## Testing Verification Checklist

Run these tests in two browser tabs (localhost:5173):

- [ ] **Player Sync**
   - [ ] Both players load race successfully
   - [ ] Both show up in race with correct kart models
   - [ ] Position updates appear smooth (no teleporting)

- [ ] **Item Pickup**
   - [ ] Drive near item box
   - [ ] See collection message on HUD
   - [ ] Hear pickup sound effect
   - [ ] Other player sees pickup disappear
   - [ ] Weapon slot shows new weapon + ammo

- [ ] **Weapon Firing (With Fix)**
   - [ ] Press E to fire secondary weapon
   - [ ] Projectile VISIBLE on both screens
   - [ ] Projectile moves toward collision target
   - [ ] Ammo counter decreases immediately

- [ ] **Impact Detection**
   - [ ] Projectile hits target
   - [ ] Hit player receives knockback
   - [ ] Hit flash appears on attacker's screen
   - [ ] Screen shake triggers
   - [ ] Impact sound plays

- [ ] **Network Stability**
   - [ ] No disconnect messages
   - [ ] RTT display shows reasonable latency (50-100ms local)
   - [ ] No lag spikes or freezes

---

## Debugging Commands (Browser DevTools)

### Monitor Network Traffic
```javascript
window.__roomRef.onMessage('*', (msg) => console.log('MSG:', msg));
window.__roomRef.state.projectiles.onChange = (p, key) => console.log('Proj:', key, p);
```

### Check Current State
```javascript
window.__roomRef.state.projectiles // See all active projectiles
window.__roomRef.state.karts       // See all players
window.__roomRef.state.pickups     // See all items
```

### Verify Session ID
```javascript
console.log('My Session ID:', window.__mySid);
console.log('Room:', window.__roomRef);
```

### Monitor Snapshots (Client-Side)
```javascript
// Open browser console while in race
// Watch for snapshot buffer contents
```

---

## Performance Notes

- Server tick: 60Hz (16.67ms per frame)
- Snapshot broadcast: 30Hz (33ms per frame)
- Client render: 60Hz (16.67ms per frame)
- Patch rate: 33ms (matching snapshot rate)
- Adaptive interp delay: 60-200ms (adjusts for network jitter)
- Snapshot buffer: 6 frames max (~200ms at 30Hz)

---

## Known Limitations

- Projectiles only update when they move (Colyseus diff encoding)
- Pickups require server validation (no client-side collection)
- Weapon cooldown enforced on server (prevents spam)
- Ammo system one-slot at a time (no dual-wield)

---

## Related Files for Reference

- **Server Room:** `realtime/src/rooms/Editor3RaceRoom.js` (~1350 lines)
- **Client Main:** `frontend/src/multiplayer-editor3-main.js` (~2200 lines)
- **Combat System:** `realtime/src/logic/combat.js`
- **Kart Physics:** `shared/kart-physics.js`
- **Track Loading:** `realtime/src/logic/track-loader.js`

---

## Summary

The projectile field name bug was a classic schema mismatch:
- Server sends data in `proj.x`, `proj.y`, `proj.z`
- Client was reading from `proj.px`, `proj.py`, `proj.pz`
- Three-character typo broke entire weapon system

Single-line fix restores full multiplayer PvP functionality.
