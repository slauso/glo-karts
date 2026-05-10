# Glo-Karts Unified Pipeline Contract

**Status:** Draft v1 — 2026-05-10
**Scope:** Defines the data contracts that flow Build → Share → Live PvP. Anything outside this contract is implementation detail and may change without coordination. Anything *inside* this contract is a versioned interface and changes require a contract bump.

> **Architectural commitment:** the editor3 Track Studio + playtest engine is the canonical client engine. The current Babylon.js `realtime.html` stack is transitional and will be replaced by an editor3-based multiplayer client. All contracts below are designed to survive that transition.

---

## 0. Versioning

Every payload defined here carries an integer `v` field. Breaking changes increment `v`; additive fields don't. Producers MUST emit the highest `v` they know; consumers MUST tolerate older `v` they previously supported.

Current versions:
- Track JSON: **v1**
- Kart definition: **v1** (implicit — no `v` field today; see §5 Migration Notes)
- Weapon protocol: **v1** (implicit)

---

## 1. Track JSON Schema (canonical content format)

**Producer:** Track Studio (editor3) → user save action
**Stored by:** Backend `Track.track_data` JSON field (opaque blob, no server-side schema enforcement today)
**Consumed by:** Playtest (`play.html`), future PvP client, server-authoritative track loader

### 1.1 Wire format (encode/decode for share URLs)

Source: [frontend/src/editor3/track-data.js](frontend/src/editor3/track-data.js#L177-L185)

```jsonc
{
  "v": 1,
  "name": "string",
  "placements": [
    { "k": "<segment-id>", "x": <int gx>, "z": <int gz>, "r": 0|1|2|3 }
  ]
}
```

Wire encoding: JSON → UTF-8 → base64url. Used in `?t=...` URL params for instant share.

### 1.2 Persisted format (backend)

Backend stores a richer envelope (see [backend/tracks/models.py](backend/tracks/models.py)):

```jsonc
{
  "track":  { ...wire format above... },
  "decor":  { /* freeform decor placement records — see §1.4 */ },
  "meta":   { "editor_version": "...", "created_at": "ISO8601" }
}
```

Backend MUST NOT mutate this blob. Forward-compatibility comes from the inner `v` field, not the envelope.

### 1.3 Coordinate system

- Grid: integer `(gx, gz)` cells. Y is implicit (segment defines elevation).
- World scale: `TILE = 36` world units per cell. Road width = 32.4 m. ([segments.js#L22](frontend/src/editor3/segments.js#L22))
- Rotation: `r ∈ {0,1,2,3}`, multiples of 90° around world Y axis.

**Contract rule:** never serialize world-space (metres) coordinates in track payloads. Always grid coords. World derivation is the consumer's job using `TILE`.

### 1.4 Segment registry

Segment IDs ("k" values) are an enumeration owned by [frontend/src/editor3/segments.js](frontend/src/editor3/segments.js). Categories:

| Category | IDs |
|---|---|
| Road | `straight`, `corner`, `cornerR` |
| Elevation | `ramp_up`, `ramp_down`, `plateau`, `curved_plateau`, `curved_plateauR`, `bump_up`, `hill_complete`, `jump_ramp`, `bridge`, `bridge_onramp`, `bridge_offramp` |
| Junction | `wide`, `t_junction`, `crossroads` |
| Banked | `banked_turn` |
| Special | `finish`, `spawn`, `tunnel`, `cap_end` |
| Pickups & FX | `item_box`, `weapon_crate_heavy`, `health_orb`, `coin_pickup`, `boost_pad`, `super_boost_pad`, `oil_slick`, `slow_strip`, `repair_strip` |

**Contract rule:** consumers MUST treat unknown segment IDs as a parse warning (skip, don't crash). New IDs are an additive change and don't bump `v`.

### 1.5 PvP-relevant placement requirements

For a track to be loadable into a multiplayer match the placements list MUST include:
- ≥1 `spawn`
- ≥1 `finish` (race modes only; battle arenas may omit)
- ≥1 `item_box` (for weapon-enabled modes)

Server validation lives in the room loader (Phase 2 work — not yet implemented).

---

## 2. Kart Definition Contract

**Producer:** [frontend/src/editor3/kart-catalog.js](frontend/src/editor3/kart-catalog.js) (build-time static registry)
**Consumed by:** Lobby UI, Track Studio kart picker, Playtest, Realtime client, server (validates `kartId`)

### 2.1 KartEntry schema (de facto v1)

```typescript
type KartEntry = {
  id: string;          // canonical id; matches kart asset folder name
  label: string;       // display name
  modelPath: string;   // "/models/stk/karts/{id}/kart.glb"
  weight: 'light' | 'medium' | 'heavy';
  accent: string;      // HUD/glo color, hex "#rrggbb"
};
```

Trail/visual profiles live alongside in `kart-catalog.js`. They are **client-only presentation** and do not cross the network.

### 2.2 Network identity

Across the wire, a kart is referenced ONLY by its `id` string (server's `PlayerState.kartId`). Server never sees `modelPath`, accent color, or label. Client resolves these locally from `kart-catalog.js`.

**Contract rule:** kart `id` is a stable string forever. Renaming a kart folder breaks save data. New karts are added by appending entries.

### 2.3 Legacy duplicate

[frontend/src/modules/content-registry.js](frontend/src/modules/content-registry.js#L81-L92) (`ALL_KARTS`) holds an older, UI-only kart map. **Not authoritative.** Slated for removal in Phase 1 cleanup.

---

## 3. Weapon / Combat Event Protocol (server-authoritative)

**Authority:** server (`realtime/src/combat.js`, `BattleRoom`). Client never decides damage, hits, or pickups.
**Transport:** Colyseus room messages + schema delta sync.

### 3.1 Client → Server messages

Source: [realtime/src/rooms/BattleRoom.js](realtime/src/rooms/BattleRoom.js)

| Message | Payload | Notes |
|---|---|---|
| `input` | `{ steering, accel, brake, drift, lookBehind, seq }` | Rate-limited; authoritative input |
| `pickupItem` | `{ entityId }` | Server validates proximity to box; only grants if valid |
| `fireWeapon` | `{ slot: 'primary' \| 'secondary', target?: string }` | Server enforces cooldown/ammo |
| `swapSecondaryWeapon` | `{}` | Toggles `weapon2` ↔ `weapon3` |
| `clientReady` / `ready` | `{}` | Marks player ready for countdown |
| `settingsUpdate` | `{ trackId, gameType, scoreLimit, botCount, weaponPool }` | Host-only |
| `triggerStart` / `start` | `{}` | Host-only, evaluates countdown gate |

**Deprecated:** `hit` (client-reported). Removed from protocol; do not implement on new clients.

**Dev-only (gated):** `debugGrantWeapon`, `debugTeleport`. Disabled in production builds.

### 3.2 Server → Client broadcasts

| Message | Payload | When |
|---|---|---|
| `projectileFired` | `{ id, subType, ownerId, x, y, z, vx, vy, vz, targetId, lifespan, spread }` | Server spawns projectile |
| `effectApplied` | `{ type, duration, target: 'player' \| 'arena', ... }` | Status applied to player |
| `arenaEffectApplied` | `{ type, duration, ... }` | Arena-wide effect |
| `itemReceived` | `{ slot, weapon, ammo, category, cooldownMs, effect, description }` | Pickup granted to player |
| `secondaryWeaponSwapped` | `{ active: {weapon, ammo}, reserve: {weapon, ammo}, cooldownMs }` | After `swapSecondaryWeapon` |

### 3.3 Schema-synced state

State changes (positions, velocities, scores, active effects) flow through Colyseus schema deltas, **not** broadcast messages. See [realtime/src/schema/](realtime/src/schema/).

Top-level: `BattleState`
- `players: MapSchema<PlayerState>` — keyed by sessionId
- `entities: MapSchema<EntityState>` — keyed by entityId (item boxes, projectiles)

`PlayerState` fields (see [PlayerState.js](realtime/src/schema/PlayerState.js)):
- Identity: `id, name, team, kartId, playerColor, gloEffect, gloColor, gloColor2`
- Transform: `x, y, z, vx, vy, vz, heading, rx, ry, rz, rw`
- Combat: `health, score, lives, deaths`
- Inventory: `weapon, ammo, fireCooldown, overheat, overheated, weapon2, ammo2, weapon3, ammo3, fireCooldown2`
- Effects: `speedMultiplier, steerMultiplier, effectType, effectTimer, shielded, shieldHP, reflectProjectiles, phased`
- Race: `lap, checkpointIdx, finished, raceFinishTime`

`EntityState` fields (see [EntityState.js](realtime/src/schema/EntityState.js)):
- `id, type ('item_box' | 'projectile'), subType (weapon id), ownerId`
- Transform: `x, y, z, vx, vy, vz, rx, ry, rz, rw`
- Lifecycle: `active, respawnTimer, damage, lifespan, targetId`

### 3.4 Weapon catalogue

Defined in [realtime/src/combat.js](realtime/src/combat.js). Categories used in `itemReceived.category`:
- **Projectile:** bowling_ball, cake, plunger, nitro, missile, crimson_hydra, cannon, frostAxe, moltenDagger
- **Trap:** bubblegum, banana
- **Melee:** swatter
- **Debuff:** parachute, anchor
- **Buff:** ludicrous_mode
- **Utility:** pirateleportation

**Phase 2 MVP** ships only: `bowling_ball, missile, banana, nitro` (four-weapon reduced set).

---

## 4. Transport & Auth

| Channel | Endpoint | Auth |
|---|---|---|
| Realtime | `import.meta.env.VITE_COLYSEUS_URL` (e.g. `ws://localhost:2567`) | Colyseus session token |
| Track API | `/api/tracks/` (Django) — see [backend/tracks/urls.py](backend/tracks/urls.py) | `X-Owner-Token` header (browser-local UUID) for write ops; reads are public |

Track API verbs:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/tracks/` | List public community tracks (paged) |
| `POST` | `/api/tracks/` | Create track (writes `owner_token`) |
| `GET` | `/api/tracks/templates/` | List built-in templates |
| `GET` | `/api/tracks/mine/` | List caller's tracks (owner-token scoped) |
| `GET` | `/api/tracks/<uuid>/` | Full detail + `track_data` blob |
| `PUT` | `/api/tracks/<uuid>/update/` | Owner-only |
| `DELETE` | `/api/tracks/<uuid>/delete/` | Owner-only |
| `POST` | `/api/tracks/<uuid>/remix/` | Fork as new track owned by caller |

---

## 5. Migration Notes (gaps to close)

These are known gaps between today's implementation and the contract above. Each is a Phase 1+ work item.

1. **Kart definition has no `v` field.** Add `v: 1` at top of `kart-catalog.js` exports next time the schema changes.
2. **Server doesn't validate Track JSON.** Backend accepts arbitrary JSON in `track_data`. Add a validator that at least checks `v` and required pickup placements before allowing a track into a PvP room.
3. **`content-registry.js` legacy kart map** must be removed in Phase 1 lobby/kart cleanup.
4. **`hit` message** is deprecated — confirm no client still sends it before removing handler.
5. **Track JSON envelope** (`{track, decor, meta}`) is undocumented in code. Producer/consumer behavior should be unified into one helper exported from editor3.
6. **`PlayerState` schema is large** (~50 fields). Phase 2 should split into sub-schemas (Transform, Combat, Inventory, Effects) for clearer ownership and bandwidth audits.

---

## 6. Change process

1. Propose contract change in PR description: which version bumps, who's affected.
2. Update this doc in the same PR as the implementation.
3. Server-authoritative changes ship server-first; client tolerates both old and new payloads for ≥1 release.
4. Client-only presentation (kart accents, particle profiles) is **not** part of this contract — change freely.
