# Wizard Masters — Weapons System Audit for TwistedKart

> **Source**: https://github.com/ertugrulcetin/wizard-masters  
> **Stack**: ClojureScript + BabylonJS + Havok v2, Clojure backend, WebSocket (msgpack)  
> **Game type**: Third-person multiplayer wizard battle arena (6 elements × 2 spells each = 12 spells)  
> **Audit scope**: Extract patterns for improving TwistedKart's PVP weapons system

---

## A. Aiming & Lead Prediction

### How Wizard Masters handles aiming

**Camera-direction casting (hitscan + physics projectiles)**

WM uses two fundamentally different targeting approaches depending on spell type:

1. **Camera-direction projectile launch** — Fire/Toxic/Rock spells use `api.camera/get-direction-scaled` to get the camera's forward vector scaled to a velocity magnitude, then launch a physics-enabled ball along that direction. No lead prediction on the shooter side — projectiles are "dumb" balls with physics.

2. **Raycast-to-surface targeting** — Super Nova, Toxic Cloud, Light Strike, Wind Tornado use `api.core/create-picking-ray` + `api.physics/raycast-to-ref` to project a ray from camera through the crosshair, intersect with environment geometry (`collision-group-environment`), and place a targeting indicator at the hit point. The player holds the sorcery key (Q/E) to aim, then releases to cast.

3. **Hitscan raycast** — Ice Arrow and Light Staff use instant raycasts (`shouldHitTriggers: true`) to check if the ray hits a player's trigger body. Ice Arrow fires a visual trail while the raycast determines the hit target. Light Staff is a continuous beam that raycasts each frame.

4. **Wind Slash** — Fires a visual particle from player to hit point. The raycast determines the endpoint; if a player is hit directly, damage is sent with the hit player-id. Otherwise, it fires as a ranged visual effect.

**Key pattern — no client-side lead prediction at all.** WM relies on:
- Relatively close-range combat (max 70 units for placed spells, 150 units for raycasts)
- Physics-simulated projectile travel (fire ball, toxic ball)
- Server-authoritative damage — the client sends `dispatch-pro :fire-projectile {:pos :dir}` and the server calculates who got hit

### Crosshair / Reticle

- Simple crosshair image shown via `image/crosshair` (toggled isVisible on game start/stop)
- Ice Arrow has a zoom mechanic: holding right-click gradually decreases camera FOV to `zoom-fov`, increasing effective aim precision
- No auto-aim, aim-assist, or magnetism

### TwistedKart Integration Opportunities

| WM Pattern | TwistedKart Equivalent | Priority |
|---|---|---|
| Raycast-to-surface targeting preview | Could add targeting reticle for gravity well showing predicted impact zone | Medium |
| Ice Arrow zoom/slow-aim mechanic | Add optional "sniper" weapon with FOV zoom + drag factor → damage scaling | Low |
| Camera-direction launch + physics sim | Already how TK fires projectiles — validated approach | ✅ Done |
| Crosshair visibility toggling | Could benefit battle mode with weapon-specific crosshairs | Medium |

---

## B. Projectile Creation & Pooling

### Object Pool Architecture

WM implements a sophisticated pool system via the rule engine:

```clojure
;; Registration — creates a factory function for the pool
(re/register-item-creation :pool/fire-projectile-ball create-fire-projectile-ball)

;; Pre-warming — creates initial instances
(dotimes [_ 1]
  (re/push-to-pool :pool/fire-projectile-ball (create-fire-projectile-ball)))

;; Borrowing from pool
(re/pop-from-pool :pool/fire-projectile-ball)

;; Returning to pool (after use)
(re/push-to-pool :pool/fire-projectile-ball ball-mesh)
```

**Pre-warm counts**: Only 1 instance each pre-warmed. The factory creates new instances on-demand if pool empty.

### Projectile Mesh Creation (JS equivalent)

```javascript
// Fire projectile — invisible sphere with physics aggregate
const ballMesh = BABYLON.MeshBuilder.CreateSphere("fire-projectile-ball", {
    diameter: 0.01  // Tiny — the particle system IS the visual
}, scene);
ballMesh.isVisible = false;
ballMesh.isPickable = false;

const agg = new BABYLON.PhysicsAggregate(ballMesh, 
    BABYLON.PhysicsShapeType.SPHERE, {
        mass: 1, friction: 1
    }, scene);
```

**Key insight**: The projectile mesh itself is invisible/tiny. All visuals come from attached particle systems. This:
- Decouples physics from rendering
- Allows different visual styles using the same physics
- Makes pooling easier (just swap particle system emitters)

### Projectile Lifecycle (Fire Ball Example)

```
1. Pop ball from pool
2. Pop particle system from particle pool → attach as emitter
3. Pop explosion particle from pool (stored on mesh for later)
4. Set position (near player + camera offset)
5. Make physics body DYNAMIC with mass 1
6. Apply impulse in camera direction × 50
7. On trigger/collision:
   a. Set body to STATIC (stop movement)
   b. Send hit to server
   c. Play explosion particles
   d. Reset position to (0, -2, 0) underground
   e. Stop trail particles → return to particle pool
   f. Return ball mesh to mesh pool
```

### Multi-Projectile Spread (Toxic Ball)

WM fires 3 toxic balls simultaneously in a spread pattern:

```javascript
// Center direction
const dirCenter = camera.getDirection(FORWARD).scale(30);

// Left (-5° rotation around Y)
const quatLeft = BABYLON.Quaternion.RotationAxis(new Vector3(0,1,0), toRadians(-5));
dirCenter.rotateByQuaternionToRef(quatLeft, dirLeft);

// Right (+5° rotation around Y)
const quatRight = BABYLON.Quaternion.RotationAxis(new Vector3(0,1,0), toRadians(5));
dirCenter.rotateByQuaternionToRef(quatRight, dirRight);
```

### TwistedKart Integration Opportunities

| WM Pattern | TwistedKart Equivalent | Priority |
|---|---|---|
| Invisible mesh + particle trail visual | Already partially done (TK uses visible sphere meshes). Could switch to invisible mesh + trail-only for more VFX flexibility | Medium |
| Mesh pool → particle pool → explosion pool (3-layer pool) | TK has trail pool recycling. Could add explosion particle pool | High |
| Multi-projectile spread with quaternion rotation | Implement for shotgun/spread weapon type | Medium |
| Underground reset position (0, -2, 0) | Simple but effective — hides pooled objects below map | ✅ Applicable |
| Dynamic→Static body on impact | Stops physics sim immediately, cheaper than dispose | High |

---

## C. Havok Physics Integration

### Physics Body Setup Patterns

**PhysicsAggregate (simple projectiles)**:
```javascript
new PhysicsAggregate(mesh, PhysicsShapeType.SPHERE, {
    mass: 1,
    friction: 1
});
// Filter membership for collision groups
agg.shape.filterMembershipMask = COLLISION_GROUP_ENVIRONMENT;
```

**PhysicsBody + PhysicsShapeMesh (complex shapes like rock projectile)**:
```javascript
// Use convex hull from imported mesh for accurate shape
const convex = mesh.getChildByName("SM_Env_StoneWall_02_convex");
convex.setEnabled(false);  // Hide the convex mesh

const shape = new PhysicsShapeMesh(convex, scene);
shape.isTrigger = true;
shape.filterCollideMask = COLLISION_GROUP_OTHER_PLAYERS;  // Only collide with players

const body = new PhysicsBody(convex, PhysicsMotionType.ANIMATED, false, scene);
body.shape = shape;
```

### Collision Groups

WM uses bit masks for collision filtering:
- `collision-group-environment` — World geometry
- `collision-group-other-players` — Other player capsules
- `collision-group-player` — Local player capsule
- `collision-group-collectables` — Pickup items
- `collision-group-kill-splash` — Death explosion debris
- `collision-group-kill-splash-surface` — Death surface splatter

### Trigger System

Rock projectile uses trigger-based hit detection:
```javascript
body.onTrigger = function(type, name, collided) {
    if (type === "TRIGGER_ENTERED" && name === "trigger_player") {
        const playerId = collided.transformNode.parent.playerId;
        if (isEnemy(playerId)) {
            dispatch("rock-projectile", { playerId, pos });
        }
    }
};
```

Fire/Toxic balls use collision observable + trigger combo:
```javascript
body.onTrigger = (type) => {
    if (type === "TRIGGER_ENTERED") resetBallProps(ballMesh);
};
addCollisionObservable(body, () => resetBallProps(ballMesh));
```

### Motion Type Switching

WM switches between STATIC and DYNAMIC to control projectile state:
```javascript
// Launch: make dynamic
body.setMotionType(PhysicsMotionType.DYNAMIC);
body.setMassProperties({ mass: 1 });

// Hit: freeze immediately
body.setMotionType(PhysicsMotionType.STATIC);
body.setMassProperties({ mass: 0 });
```

### Raycast for Ground/Surface Detection

```javascript
const result = new PhysicsRaycastResult();
engine.raycastToRef(start, end, result, { collideWith: COLLISION_GROUP_ENVIRONMENT });

if (result.hasHit) {
    const point = result.hitPoint;
    const distance = result.hitDistance;
    const normal = result.hitNormal;
    const normalY = normal.y;
    
    // Reject steep surfaces or too-far targets
    if (normalY < 0.6 || distance > 70) { /* disallow */ }
}
```

### TwistedKart Integration Opportunities

| WM Pattern | TwistedKart Application | Priority |
|---|---|---|
| Trigger shapes for player-only collision | Add trigger-only collision for weapons that should pass through walls | Medium |
| Collision group bitmasks | Add finer-grained groups (projectile, player, terrain, pickup) | High |
| Dynamic→Static motion type switch on hit | Use instead of dispose for pooled projectiles | High |
| PhysicsShapeMesh for convex hull detection | Better hit detection for oddly-shaped weapons | Low |
| `disablePreStep` usage | Set `true` for static objects, `false` for dynamic — perf optimization | Medium |

---

## D. Impact & Hit Detection

### Server-Authoritative Damage Model

**Client side (shooter):**
1. Client detects collision/trigger locally
2. Sends position + context to server: `dispatch-pro :fire-projectile {:pos [x y z]}`
3. Server calculates damage radius, finds affected players, applies damage
4. Server broadcasts damage results to all clients

**Client side (victim):**
1. Receives `dispatch-pro-response :got-fire-projectile-hit` with `{:damage N :died? bool :player-id attacker-id}`
2. Shows local feedback: damage numbers, screen effects, death sequence

### Hit Response Pipeline

```
got-hit:
  1. Show floating damage number at victim position (+1.5Y offset)
  2. Show damage edge effect (red/blue/white border glow, 1s duration)
  3. Show offscreen damage arrow pointing toward attacker (if not visible)
  4. Set kill info HUD element (if died)
  5. Show kill explosion at death position
  6. Hide player model
  7. Play death scream sound
  8. Exit pointer lock
```

### Floating Damage Numbers

```javascript
common.showHitNumber({
    value: damage,              // Numeric damage value
    pos: playerPos.clone().addInPlaceXYZ(0, 0.5, 0),
    color: "red",               // Optional color override
    durationFactor: 1           // Speed multiplier
});
```

### Screen-Edge Damage Effect

```javascript
function showDamageEffect(effectColor) {
    const d1 = document.getElementById("damage-effect-1");
    const d2 = document.getElementById("damage-effect-2");
    const color = { white: "white", red: "red", blue: "#4a9ad3" }[effectColor];
    
    d1.classList.add("glow-effect");
    d1.style.border = `40px solid ${color}`;
    d2.classList.add("glow-effect");
    d2.style.border = `20px solid ${color}`;
    
    setTimeout(() => {
        d1.classList.remove("glow-effect");
        d2.classList.remove("glow-effect");
    }, 1000);
}
```

### Offscreen Damage Direction Arrow

WM calculates the angle from the player to the attacker who damaged them:
```javascript
// Calculate angle between camera forward and direction to enemy
const direction = normalize(enemyPos.subtract(playerPos));
const cameraForward = camera.getForwardRay().direction;
const angle = Math.acos(dot(cameraForward, direction));
const cross = cross(cameraForward, direction);
const signedAngle = cross.y < 0 ? -angle : angle;
offscreenDamage.rotation = signedAngle;
```

### Element-Specific Hit Effects

| Spell Hit | Color | Special Effect |
|---|---|---|
| Fire projectile/Super Nova | Red | Camera shake on super nova |
| Ice Arrow | Blue | Drain mana, freeze mana regen 1s |
| Ice Tornado | Blue | Freeze player 1.5s |
| Light Strike | Blue-white | Freeze player 1s |
| Wind Slash | White | Impulse knockback in hit direction |
| Wind Tornado | White | Gravity zero + tween player to tornado center |
| Toxic | Red (default) | — |
| Toxic Cloud | Red | Damage over time zone |
| Self-fall | — | 1000 damage instant kill |

### TwistedKart Integration Opportunities

| WM Pattern | TwistedKart Application | Priority |
|---|---|---|
| Screen-edge colored damage border | Add colored damage direction indicator (DOM overlay with CSS glow) | High |
| Offscreen damage arrow with signed angle | Show directional damage indicator pointing toward attacker | High |
| Element-typed hit responses | Weapon-specific hit reactions (freeze, knockback, stun) already partially done | ✅ Done |
| Floating damage numbers at world position | Already done via battle-hud hit confirm | ✅ Done |
| Server-authoritative damage with client visual feedback | Architecture matches TK's Colyseus model | ✅ Validated |

---

## E. Trails & VFX

### Particle System Architecture

WM uses a **pooled particle system factory pattern**:

```javascript
// Factory registration + pre-warming
registerItemCreation("pool/particle-fire-projectile", () => fireProjectile());
pushToPool("pool/particle-fire-projectile", fireProjectile());

// Usage: pop, attach, auto-return
const ps = startPs("pool/particle-fire-projectile", { emitter: ballMesh });

// On stop → auto-return to pool
ps.onStoppedObservable.addOnce(() => {
    pushToPool("pool/particle-fire-projectile", ps);
});
```

### GPU Particle Systems

WM uses GPU particles (`GPUParticleSystem`) where supported for:
- Fire projectile trail (2 sub-systems: smoke + moon trail)
- Fire ball explosion
- Super nova shockwave
- Snowflake (ice tornado peripheral)
- Arrow sparkles
- Ice arrow hit
- All toxic effects
- Speed lines
- Light burst

**Fallback**: If `GPUParticleSystem.IsSupported` is false, falls back to CPU `ParticleSystem`.

### Sprite Sheet Animation

Many particle effects use animated sprite sheets:
```javascript
{
    animationSheetEnabled: true,
    spriteCellWidth: 128,
    spriteCellHeight: 128,
    spriteCellLoop: true,
    spriteRandomStartCell: true,
    startSpriteCellID: 0,
    endSpriteCellID: 63,        // 8×8 sprite sheet = 64 frames
    spriteCellChangeSpeed: 1
}
```

This gives smoke/fire/explosion effects much richer variety than static particle textures.

### Trail Mesh (Ice Arrow)

WM uses Babylon's `TrailMesh` for the ice arrow trail:
```javascript
const ball = MeshBuilder.CreateSphere("arrow-trail-ball", {
    diameter: 0.1, segments: 2, visible: false, pickable: false
});
const trail = new TrailMesh("arrow-trail-mesh", ball, scene, {
    diameter: 0.2,
    length: 30,
    autoStart: false
});
trail.material = arrowTrailMaterial;
ball.trailMesh = trail;

// Animate ball from start → end, trail follows
beginDirectAnimation(ball, positionAnimation, { speedRatio: 2, to: 60 });
```

### Composite Particle Effects

WM composes multiple particle systems for complex effects:

**Light Strike** = 3 particle systems:
1. Vertical lightning columns (sprite sheet, billboard Y-mode)
2. Ground impact flash (non-billboard, circular expansion)
3. Cloud formation above (billboard Y, large scale)

**Kill Explosion** = 20 physics-driven splash particles:
- 10 "blood" splashes with `kill-splash-ball` (physics DYNAMIC, impulse outward, velocity 5)
- 10 "surface" splashes with `kill-splash-surface-ball` (physics DYNAMIC, velocity 15)
- Each splash has its own particle system from pool
- Physics stops on environment collision → static → return to pool

### Particle Budget / Performance

- Pre-warm 1 instance of each particle type
- Factory creates on-demand
- GPU particles where possible
- `targetStopDuration` limits particle lifetime
- Pool return happens after 1000ms delay (via `setTimeout`) to let particles fully stop

### TwistedKart Integration Opportunities

| WM Pattern | TwistedKart Application | Priority |
|---|---|---|
| GPU particle fallback pattern | Add `GPUParticleSystem.IsSupported` check, upgrade heavy effects to GPU | High |
| Sprite sheet animation for smoke/fire | Replace static particle textures with animated sprite sheets | High |
| TrailMesh for projectile trails | Could replace or augment current particle-based trails | Medium |
| Composite multi-system effects | Combine spark + smoke + flash for weapon impacts | Medium |
| Physics-driven kill debris | Add physics-enabled debris particles on kart destruction | Medium |
| 1s delayed pool return | Already doing similar — validated approach | ✅ Done |
| Pool particle factories | TK already has trail pool. Extend to all VFX types | High |

---

## F. Model / Mesh / Texture

### Projectile Mesh Strategies

| Spell | Mesh Type | Size | Notes |
|---|---|---|---|
| Fire ball | Sphere | diameter: 0.01 | Invisible — particles are the visual |
| Toxic ball | Sphere | diameter: 0.01 | Invisible — same pattern |
| Kill splash | Sphere | diameter: 0.1 | Invisible — physics carrier for splash particles |
| Rock | Cloned from scene asset | scale: 0.03 | Visible mesh — actual stone wall model |
| Super nova | Sphere | diameter: 1 | Visible with node material (transparency block) |
| Toxic cloud | Sphere | diameter: 1 | Visible with cloned toxic cloud material |
| Wind tornado | Cloned tornado mesh | scale: 4 | Visible — imported model with material alpha |
| Ice tornado | Sphere (squashed) | diameter-x:1, -y:0.3, -z:1, scale:20 | Visible disc shape |
| Rock wall | Cloned environment mesh | scale: 0.02×0.06×0.05 | Visible with physics aggregate |
| Light strike cylinder | Built from cylinder primitives | — | Visible targeting indicator |
| Arrow trail ball | Sphere | diameter: 0.1, segments: 2 | Invisible — TrailMesh generator |

### Material Management

- Spell targeting indicators use **material swapping** for valid/invalid placement:
  - Valid: original material (e.g., `material/fire-nova`)
  - Invalid: shared red disallowed material (`material/fire-nova-disallowed`)
- Node materials used for transparency control: `mat.getBlockByName("transparency").value = 0.5`
- Team-colored materials pooled: `pool/material-hero-red`, `pool/material-hero-blue`

### Mesh Optimization Flags

```javascript
mesh.alwaysSelectAsActiveMesh = true;  // Don't frustum cull this
mesh.doNotSyncBoundingInfo = true;     // Skip bounding info recalculation
mesh.isPickable = false;               // Exclude from picking rays
```

### TwistedKart Integration Opportunities

| WM Pattern | TwistedKart Application | Priority |
|---|---|---|
| Invisible carrier mesh + particle visual | Decouple projectile physics from visuals completely | Medium |
| Material swapping for targeting indicators | Add valid/invalid targeting for gravity well placement | Low |
| `doNotSyncBoundingInfo` on projectiles | Already using low-poly meshes. Add these flags for extra perf | High |
| `alwaysSelectAsActiveMesh` for important objects | Use on projectiles to prevent culling glitches | Medium |
| Clone from scene assets for weapon models | Use for more complex weapon projectile shapes | Low |
| Segments: 2 for invisible trail generators | Already using segments: 8 — could go lower for invisible meshes | Low |

---

## G. Play Feel Polish

### Camera Effects

**Camera shake (Super Nova hit)**:
```javascript
api.camera/shake-camera  // Full camera shake on heavy hits
```

**Vertical shake (landing)**:
```javascript
// Proportional to air time
if (airTime > 1.2) shakeVertical(0.5, 0.75);  // Heavy landing
if (airTime > 0.6) shakeVertical(0.5, 0.4);   // Medium
if (airTime > 0.2) shakeVertical(0.5, 0.3);   // Light
```

**Shockwave post-process (spell cast)**:
```javascript
function applyShockwaveEffect({ intensity = 1.0 }) {
    // Custom post-process shader with noise texture
    // Intensity decays: Math.max(0, intensity - 0.03 * animRatio)
    // Uses time-based distortion, noise texture for organic feel
    shockwave.onApply = (effect) => {
        effect.setFloat("time", performance.now() * 0.001);
        effect.setFloat("intensity", currentIntensity);
        effect.setTexture("noiseTexture", noiseTexture);
    };
}
```

### Cooldown System

Each spell has a cooldown with optional booster:
```javascript
const cooldowns = {
    "spell-toxic-cloud": { duration: 15500 },
    "spell-super-nova": { duration: 15500 },
    "spell-rock-wall": { duration: 15500 },
    "spell-ice-tornado": { duration: 15500 },
    "spell-wind-tornado": { duration: 15500 },
    "spell-light-strike": { duration: 15500 },
    "roll": { duration: 4500 }
};

// Booster reduces cooldown by 20%
if (boosterActive("booster_cooldown")) {
    duration *= 0.8;
}
```

### Mana System

```javascript
const totalMana = 100;
const manaCosts = {
    spell: 15,        // Fire, Rock
    toxic: 15,
    iceArrow: 15,
    windSlash: 15,
    lightStaff: 50    // Most expensive — continuous drain
};

// Mana regen: 2× on ground, 1× in air, blocked during casting
// After mana use: 500ms regen freeze
// Booster: 1.25× mana regen
```

### Sound Design Pattern

Every spell has 3+ sound events:
1. **Cast/Launch**: `air-whoosh`, `toxic-whoosh`, `rock-hit`, `wind-slash`, `bow-draw`
2. **Travel/Active**: `electric-light-staff-player` (looping), `levitate` (looping)
3. **Impact/Hit**: `fire-projectile-hit`, `ice-hit`, `wind-hit`, `toxic-explode`
4. **Extra**: victory/defeat, death screams (8 variants), collectible pickup, heartbeat (low HP), landing sounds (volume scales with air time)

Position-based audio: `api.sound/play :sound/fire-projectile-hit {:position pos}`

### Low Health Warning

```javascript
// Heartbeat sound + screen border pulsing when health < 350/1000
if (0 < currentHealth < 350) {
    showHeartbeatEffect();  // Red border glow
    playSound("heartbeat"); // Looping heartbeat audio
}
// Tween volume to 0 over 1s when health recovers
```

### Dash / Roll Mechanic

```javascript
// Shift key → directional dash
const speed = onlyLeftOrRight ? 2000 : 250;
const direction = getDirectionFromInput();

applyImpulse(capsule, direction.scale(speed), position);

// Visual: trail mesh + speed lines + dash particle
// Duration: 500ms then stop effects
// Cooldown: 4500ms
```

### Wind Slash Knockback

```javascript
// Wind slash applies impulse to victim
const knockbackDir = hitDirection.scale(1000);
applyImpulse(victimCapsule, knockbackDir, victimPos);
// + 750ms movement lock after hit
```

### Wind Tornado Levitation

```javascript
// Victims are tweened to tornado center + lifted
tween({
    from: { x: victimX, y: victimY, z: victimZ },
    to: { x: tornadoX + random(-1.5, 1.5), y: tornadoY + 5 + random(-0.5, 1), z: tornadoZ + random(-1.5, 1.5) },
    duration: 1000,
    onUpdate: (v) => setPos(capsule, [v.x, v.y, v.z])
});
// Gravity factor set to 0 for 2500ms
```

### TwistedKart Integration Opportunities

| WM Pattern | TwistedKart Application | Priority |
|---|---|---|
| Shockwave post-process on heavy hits | Add screen distortion on bomb/gravity-well hits | High |
| Low-health heartbeat + screen effect | Already have low health warning. Add heartbeat SFX | Medium |
| Air-time proportional landing shake | Scale camera shake with fall distance | Medium |
| 8 death-scream variants | Add variety to kart destruction sounds | Low |
| Position-based 3D audio for all combat | Ensure all weapon sounds use 3D audio positioning | Medium |
| Wind-style knockback impulse | Already done for some weapons. WM's approach of `dir.scale(1000)` impulse + movement lock is clean | ✅ Validated |
| Gravity factor = 0 for stun/levitate | Use for freeze/stun effects — suspend kart in air | Medium |
| Cooldown booster (20% reduction) pickup | Add as collectible power-up in battle arenas | Low |

---

## Summary: Top 10 Actionable Items for TwistedKart

| # | Pattern | Category | Effort | Impact |
|---|---|---|---|---|
| 1 | GPU particle fallback (`GPUParticleSystem.IsSupported`) | E | Small | High |
| 2 | Sprite sheet animated particles for smoke/fire/explosions | E | Medium | High |
| 3 | Dynamic→Static body switching on projectile impact | C | Small | High |
| 4 | Screen-edge colored damage direction border | D | Medium | High |
| 5 | Shockwave post-process shader on heavy weapon impacts | G | Medium | High |
| 6 | Collision group bitmasks for projectile filtering | C | Medium | High |
| 7 | 3-layer pool: mesh + particle trail + explosion particle | B | Medium | High |
| 8 | `doNotSyncBoundingInfo` + `isPickable=false` on all projectiles | F | Small | Medium |
| 9 | Offscreen damage direction arrow (signed angle from camera) | D | Medium | Medium |
| 10 | Multi-projectile spread with quaternion Y-rotation | B | Small | Medium |

---

## Appendix: WM Spell → TK Weapon Mapping

| WM Spell | Mechanic | TK Weapon Analog |
|---|---|---|
| Fire Ball | Physics projectile + particle trail + explosion on contact | Green Shell |
| Toxic Ball (3× spread) | Multi-projectile fan, puddle DOT zone | Triple Green Shell |
| Super Nova | Placed AoE (raycast targeting preview) | Bomb / Gravity Well |
| Ice Arrow | Hitscan with zoom + mana drain | — (no hitscan in TK yet) |
| Light Staff | Continuous beam (per-frame raycast) | — (potential future weapon) |
| Wind Slash | Fast projectile + knockback impulse | Banana / knockback variant |
| Wind Tornado | Placed AoE + levitate + disable gravity | Gravity Well (exists) |
| Toxic Cloud | Placed AoE DOT zone | Oil Slick / hazard zone |
| Rock | Twin physics projectile + tween arc | — (could be catapult weapon) |
| Rock Wall | Placed barrier (physics static) | — (could be shield pickup) |
| Ice Tornado | Self-centered AoE freeze | Star / invincibility AoE |
| Light Strike | Placed column AoE (raycast targeting) | Lightning Strike |
| Dash/Roll | Directional impulse + i-frames | Mushroom boost already similar |
