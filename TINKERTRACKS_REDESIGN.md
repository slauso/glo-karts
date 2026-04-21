# TinkerTracks Redesign Plan
## Target: Polytrack / Trackmania-Style Custom Track Builder & Racing

---

## Vision

TinkerTracks becomes a **snap-together track construction kit** where users build
custom racing circuits or battle arenas from interlocking segments—then instantly
play them solo or with friends. The experience model is:

1. **Build** — Snap pieces together in a 3D editor (≈ Polytrack / Trackmania track editor)
2. **Play** — One-click playtest: drive your creation immediately
3. **Share** — Publish a share code; friends paste it to race the same track
4. **Compete** — Multiplayer lobbies on user-created tracks with leaderboards

---

## Current Architecture Problems

| # | Problem | Impact |
|---|---------|--------|
| 1 | **Curb-walls have physics colliders** | Karts can't cross segment boundaries; stuck on center stripe |
| 2 | **Dual render engines** (Three.js editor + Babylon.js runtime) | Every visual fix requires two parallel code changes |
| 3 | **Flat segments only** — no elevation graph | Can't build overpasses, tunnels, loops, or proper hills |
| 4 | **1:1 cell-to-piece mapping** | Can't have large sweeping curves, banked turns, or multi-cell elements |
| 5 | **Road painting + segment placement = two parallel systems** | Merged at playtest via fragile deduplication logic |
| 6 | **3x world scale hack** | Kart footprint vs. tile size mismatch papered over with a constant |
| 7 | **No T-junction / 4-way pieces** — auto-tiler falls back to pad | Road layouts can't branch properly |
| 8 | **Mode is HIDDEN** in game-modes.js | Players can't discovery the builder |
| 9 | **No validation / playtesting feedback** | No lap path validation, no connectivity checker, no "is this driveable" |
| 10 | **No track surface variety** | All segments use the same asphalt deck; no dirt, ice, boost surfaces |

---

## Redesign Phases

### Phase 1 — Foundation Fix (Immediate, 1–2 weeks)
**Goal:** Make current builder fully playable end-to-end.

- [x] ~~Remove curb physics colliders~~ (done in this session — `isPhysical: false`)
- [x] ~~Manual yaw integration fix~~ (done in this session)
- [x] ~~Builder handling profile~~ (done: `turnResponse: 2.5`, `lateralGrip: 0.18`, `velocityAlign: 0.45`)
- [ ] **Remove the 3x world scale hack** — make segments natively kart-sized
  - Set `GRID_SIZE = 30` everywhere OR scale kart model down instead
  - Delete `PLAYTEST_WORLD_SCALE` and all `scalePosition()` / `scaleBounds()` calls
- [ ] **Widen segment decks to full cell** — `ROAD_WIDTH = GRID_SIZE` (no gap at edges)
- [ ] **Add segment seam bridges** — thin physical deck at every segment boundary so wheels never catch
- [ ] **Surface-only physics** — decks provide driveable surface; curbs are visual guardrail indicators only
- [ ] **Expose builder in main menu** — unhide `track_builder` mode in `game-modes.js`
- [ ] **Basic track validation** — warn if no spawn, no road, disconnected sections

### Phase 2 — Unified Render Pipeline (2–4 weeks)
**Goal:** Eliminate the Three.js / Babylon.js dual maintenance.

- [ ] **Migrate builder viewport to Babylon.js**
  - Replace `viewport.js` Three.js renderer with Babylon.js Engine (can share `@babylonjs/core` with runtime)
  - This means `asset-loader.js` rebuilds with `MeshBuilder` instead of `THREE.BoxGeometry`
  - Or: load the same procedural meshes used at runtime (`custom-arena-procedural.js`) in the editor
- [ ] **Single-source segment geometry** — `custom-arena-procedural.js` becomes THE segment renderer for both editor and playtest
- [ ] **GLB model pipeline** — for pieces that need organic shapes (banked curves, loops), load glTF/GLB meshes authored in Blender. `TRACK_ASSETS[].file` references already exist but point to placeholder filenames
- [ ] **Shared material palette** — one material definition module used by both rendering contexts

### Phase 3 — Elevation & Advanced Pieces (3–6 weeks)
**Goal:** Trackmania-style 3D building with height, ramps, and stacking.

- [ ] **Elevation graph** — each cell stores a `height` layer (integer steps, e.g., 0–10)
  - Arrow keys / mouse-wheel to raise/lower the build cursor
  - Segments auto-connect vertically: ramp-up at height N connects to straight at height N+1
- [ ] **Multi-cell pieces** — allow pieces that span 2×1, 1×3, etc.
  - `PIECE_DEFS` gains `cellFootprint: [[0,0],[1,0]]` arrays
  - `GridState` occupancy blocks multiple cells per piece
- [ ] **New piece types:**
  - **Banked turn** — tilted corner with up to 45° bank angle
  - **Loop** — vertical loop (2×3 cell footprint)
  - **Corkscrew** — rotating helix (3×3 cells)
  - **Jump** — ramp with gap (2×1 cells, no floor in middle)
  - **Tunnel** — enclosed segment (visual roof, no physics change)
  - **Bridge** — elevated straight with support pillars, allows under-crossing
  - **Chicane** — S-curve in a single 2×1 piece
  - **Halfpipe / pipe** — tubular enclosed racing surface
  - **T-junction / Crossroads** — proper 3-port and 4-port pieces
- [ ] **Auto-ramp insertion** — when cursor height changes between adjacent cells, automatically insert ramp-up / ramp-down connectors (Trackmania-style)
- [ ] **Ghost preview at build cursor** — show the piece preview at the correct elevation before placing

### Phase 4 — Surface Types & Track Decoration (2–3 weeks)
**Goal:** Visual variety and gameplay-affecting surfaces.

- [ ] **Surface material per segment** — asphalt (default), dirt (low grip), ice (very low grip), boost (speed increase), water (slow)
  - Surface type stored in track data: `segment.surface = 'asphalt' | 'dirt' | 'ice' | 'boost' | 'water'`
  - Physics applies grip / speed multiplier based on surface under kart
- [ ] **Scenery objects** — trees, barriers, grandstands, flags placed outside the track
- [ ] **Skybox selector** — choose from several skybox presets (day, sunset, night, space)
- [ ] **Ground material** — grass, desert sand, snow (changes with skybox)
- [ ] **Guardrails as decoration** — optional snap-on guardrails that visually line the trackside, non-physical
- [ ] **Start/finish gate mesh** — checkered arch at the finish line

### Phase 5 — Racing & Competition (2–4 weeks)
**Goal:** Full multiplayer racing on custom tracks with timing and leaderboards.

- [ ] **Lap counter** — checkpoint system validates lap completion (ordered checkpoint sequence)
  - Auto-checkpoint: derive from track path connectivity (BFS/DFS from start to find circuit)
  - Manual override: let creator place numbered checkpoint gates
- [ ] **Ghost racing** — record and replay best lap as ghost kart
- [ ] **Time trial** — solo mode with persistent best-time per track
- [ ] **Leaderboard per track** — keyed by track share code, stores best times
- [ ] **Multiplayer race lobby** — host creates lobby with custom track, friends join via lobby code
  - Room name: `custom_race_{trackCode}`
  - Reuse existing Colyseus `race_room` with custom track payload
- [ ] **Track publish API** — backend endpoint to store/retrieve published tracks
  - `POST /api/tracks` — validate and store track JSON
  - `GET /api/tracks/:code` — retrieve by share code
  - `GET /api/tracks/popular` — browse trending tracks
- [ ] **Battle arena on custom maps** — existing `builder_battle_playtest` flow, but published

### Phase 6 — UX Polish & Community (2–3 weeks)
**Goal:** Discovery, sharing, and creator tools.

- [ ] **Track browser** — in-game gallery of published tracks (searchable, sortable)
  - Categories: Featured, Popular, Recent, My Tracks
  - Thumbnail: auto-generated top-down screenshot of the track
- [ ] **Rate & favorite** — players can upvote/favorite tracks
- [ ] **Creator profile** — list of tracks created by a user
- [ ] **Undo/redo improvements** — group operations (e.g., undo an entire road-paint stroke as one)
- [ ] **Camera presets** — top-down, isometric, free-orbit (current), first-person preview
- [ ] **Track settings panel** — creator sets laps, game mode (race/battle), max players, weapon sets
- [ ] **Minimap preview** — live minimap in the editor sidebar showing the track layout
- [ ] **Mobile-friendly controls** — touch support for builder viewport (stretch goal)

---

## Data Model Evolution

### Current Segment Schema
```json
{
  "id": 1,
  "type": "straight",
  "position": { "x": 10, "y": 0, "z": 0 },
  "rotation": 90,
  "scale": 1
}
```

### Proposed Segment Schema (Phase 3+)
```json
{
  "id": 1,
  "type": "banked-turn",
  "position": { "x": 30, "y": 2, "z": 0 },
  "elevation": 2,
  "rotation": 90,
  "scale": 1,
  "surface": "asphalt",
  "variant": "default",
  "cellFootprint": [[0,0],[1,0]]
}
```

### Track Metadata (Phase 5+)
```json
{
  "version": 2,
  "name": "Rainbow Sprint",
  "author": "PlayerOne",
  "authorId": "uuid",
  "shareCode": "RT-AB12-XY34",
  "settings": {
    "mode": "race",
    "laps": 3,
    "maxPlayers": 8,
    "weaponSet": "standard",
    "skybox": "sunset"
  },
  "segments": [...],
  "checkpoints": [...],
  "startPositions": [...],
  "obstacles": [...],
  "decorations": [...],
  "terrain": {
    "size": 200,
    "groundMaterial": "grass"
  },
  "stats": {
    "segmentCount": 42,
    "estimatedLapTime": 45,
    "hasElevation": true,
    "hasLoop": false
  }
}
```

---

## File Impact Map

| File | Phase | Change |
|------|-------|--------|
| `custom-arena-procedural.js` | 1 | Curbs = visual only (done), widen decks, seam bridges |
| `asset-loader.js` | 1→2 | Widen decks, then migrate to Babylon.js |
| `kart-physics.js` | 1 | Handling profile params (done) |
| `colyseus-babylon-client.js` | 1 | Yaw fix (done), handling profile (done), arena setup |
| `serializer.js` | 1 | Remove PLAYTEST_WORLD_SCALE |
| `game-modes.js` | 1 | Unhide track_builder |
| `grid-placement.js` | 3 | Elevation, multi-cell, new PIECE_DEFS |
| `road-panel.js` | 3 | Elevation controls, height-aware auto-tiling |
| `scene-graph.js` | 3 | Elevation field, multi-cell occupancy |
| `viewport.js` | 2 | Migrate from Three.js → Babylon.js |
| `builder-app.js` | 2–6 | Toolbar additions, panel wiring |
| `playtest-bridge.js` | 5 | Multiplayer lobby creation for custom tracks |
| `custom-arena-segments.js` | 3 | New piece defs, elevation connectors |
| `custom-arena-anchors.js` | 3 | Vertical port anchors |
| `terrain-panel.js` | 4 | Skybox, ground material, scenery |
| `extras-panel.js` | 4–5 | Decoration tools, track settings |

---

## Priority Order

1. **Phase 1** — Make it work (barriers removed, kart drives freely, builder accessible)
2. **Phase 5 partial** — Multiplayer on custom tracks (core loop: build → share → race)
3. **Phase 2** — Unified rendering (reduce maintenance burden before adding pieces)
4. **Phase 3** — Elevation + new pieces (the "wow" feature that matches Trackmania)
5. **Phase 4** — Surfaces & decoration (visual polish)
6. **Phase 6** — Community features (long-term engagement)
