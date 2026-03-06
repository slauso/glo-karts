# STK Track Porting Pipeline — Complete Process

> Comprehensive process for identification, conversion, porting, integration, and testing of SuperTuxKart courses for browser-based play in Twisted Kart.

---

## Phase 0 — Track Census & Browser Suitability Analysis

**Status:** ✅ COMPLETE — See `tools/stk_track_analysis.json`

### Classification (corrected)
- **21 Race Tracks** — all have `quads+graph` waypoint data
- **9 Battle Arenas** — 8 have navmesh, 1 (Ancient Colosseum) too heavy
- **6 Soccer Fields** — excluded from scope

### Scoring Criteria (0–100)
| Factor | Threshold | Penalty |
|--------|-----------|---------|
| Total size | >20 MB | −40 |
| Total size | >10 MB | −25 |
| Total size | >5 MB | −10 |
| SPM mesh count | >50 | −30 |
| SPM mesh count | >25 | −15 |
| SPM mesh count | >15 | −5 |
| Texture count | >40 | −25 |
| Texture count | >20 | −15 |
| Texture count | >10 | −5 |
| Scene objects | >200 | −20 |
| Scene objects | >100 | −10 |
| Scene objects | >50 | −5 |
| Matching waypoints | present | +10 |
| No waypoints (race) | missing | −20 |

---

## Phase 1 — Identification & Selection

### Final Track Roster

#### ★★★ Tier 1 — Browser Ideal (import first)
| ID | Name | Size | SPMs | Textures | Scene Objs | Score |
|----|------|------|------|----------|------------|-------|
| `olivermath` | Oliver's Math Class | 2.0 MB | 4 | 12 | 40 | 100 |
| `snowmountain` | Northern Resort | 1.2 MB | 5 | 15 | 92 | 100 |
| `abyss` | Antediluvian Abyss | 4.0 MB | 13 | 10 | 234 | 90 |
| `cornfield_crossing` | Cornfield Crossing | 2.8 MB | 10 | 5 | 325 | 90 |
| `ravenbridge_mansion` | Ravenbridge Mansion | 4.1 MB | 12 | 3 | 452 | 90 |
| `scotland` | Nessie's Pond | 3.5 MB | 4 | 38 | 56 | 90 |
| `candela_city` | Candela City | 4.2 MB | 16 | 5 | 693 | 85 |
| `minigolf` | Minigolf | 6.0 MB | 12 | 31 | 37 | 85 |
| `sandtrack` | Shifting Sands | 6.4 MB | 4 | 15 | 104 | 85 |
| `snowtuxpeak` | Snow Peak | 2.1 MB | 24 | 22 | 67 | 85 |

#### ★★☆ Tier 2 — Browser Suitable (import second wave)
| ID | Name | Size | SPMs | Textures | Scene Objs | Score |
|----|------|------|------|----------|------------|-------|
| `cocoa_temple` | Cocoa Temple | 7.6 MB | 20 | 8 | 1144 | 75 |
| `gran_paradiso_island` | Gran Paradiso Island | 8.6 MB | 21 | 10 | 783 | 75 |
| `hacienda` | Hacienda | 3.9 MB | 19 | 49 | 104 | 70 |
| `lighthouse` | Around the Lighthouse | 9.4 MB | 16 | 38 | 169 | 70 |
| `stk_enterprise` | STK Enterprise | 9.4 MB | 14 | 67 | 121 | 65 |
| `fortmagma` | Fort Magma | 5.3 MB | 26 | 49 | 42 | 60 |
| `xr591` | XR591 | 5.8 MB | 27 | 71 | 26 | 60 |

#### ★☆☆ Tier 3 — Heavy (defer or skip)
| ID | Name | Size | SPMs | Score |
|----|------|------|------|-------|
| `volcano_island` | Volcan Island | 12.3 MB | 11 | 50 |
| `zengarden` | Zen Garden | 9.7 MB | 24 | 50 |

#### ☆☆☆ Reject
| ID | Name | Size | SPMs | Score |
|----|------|------|------|-------|
| `black_forest` | Black Forest | 31.9 MB | 158 | 0 |
| `mines` | Old Mine | 13.4 MB | 31 | 35 |

### Final Arena Roster

#### ★★★ Tier 1 — All suitable except Ancient Colosseum
| ID | Name | Size | SPMs | Navmesh | Score |
|----|------|------|------|---------|-------|
| `stadium` | The Stadium | 1.0 MB | 1 | ✅ | 100 |
| `battleisland` | Battle Island | 3.8 MB | 10 | ✅ | 100 |
| `pumpkin_park` | Pumpkin Park | 3.2 MB | 8 | ✅ | 100 |
| `arena_candela_city` | Candela City | 3.2 MB | 14 | ✅ | 90 |
| `lasdunasarena` | Las Dunas Arena | 2.6 MB | 9 | ✅ | 90 |
| `alien_signal` | Alien Signal | 4.4 MB | 16 | ✅ | 85 |
| `cave` | Cave X | 10.7 MB | 6 | ✅ | 85 |
| `temple` | Temple | 4.5 MB | 16 | ✅ | 80 |

#### ☆☆☆ Reject
| ID | Name | Size | Reason |
|----|------|------|--------|
| `ancient_colosseum_labyrinth` | Ancient Colosseum | 23.6 MB | Too heavy |

---

## Phase 2 — Conversion (SPM → GLB + Auxiliary Data)

### Current Pipeline Gaps

The existing `tools/stk_asset_pipeline.py` extracts **only the main track SPM → GLB**. It misses:

| Data | Source File in STK | Needed For | Status |
|------|--------------------|------------|--------|
| Waypoint driveline | `quads.xml` | Racing AI, lap counting | ❌ Not extracted |
| Quad connectivity graph | `graph.xml` | AI pathfinding, shortcuts | ❌ Not extracted |
| Arena navmesh | `navmesh.xml` | Battle bot navigation | ❌ Not extracted |
| Start positions & heading | `quads.xml` quad-0 | Grid positions, facing dir | ❌ Hardcoded guesses |
| Scene objects (decorations) | `scene.xml` | Visual completeness | ❌ Only main SPM |
| Item/powerup positions | `scene.xml` item nodes | Weapon pickups on track | ❌ Not extracted |
| Track boundaries | quad edges | Off-track detection | ❌ Not extracted |
| Checkpoints / lap line | quad-0 in graph | Lap progress tracking | ❌ Not extracted |

### Enhanced Pipeline Design

Each track conversion must produce a **track bundle**:

```
frontend/public/models/stk/tracks/{track_id}/
├── track.glb          # Main geometry + textures (already exists)
├── track-data.json    # NEW: waypoints, checkpoints, spawn grid, items
└── (optional) decorations.glb  # Scene objects from scene.xml
```

#### `track-data.json` Schema (Race Tracks)

```json
{
  "id": "cornfield_crossing",
  "name": "Cornfield Crossing",
  "type": "race",
  "laps": 3,
  "driveline": [
    { "center": [x, y, z], "width": w, "quad": [[x1,y1,z1],[x2,y2,z2],[x3,y3,z3],[x4,y4,z4]] }
  ],
  "graph": {
    "nodes": [0, 1, 2, ...],
    "edges": [[0,1], [1,2], ...]
  },
  "checkpoints": [
    { "quadIndex": 0, "isLapLine": true },
    { "quadIndex": 50, "isLapLine": false }
  ],
  "startPositions": [
    { "position": [x, y, z], "heading": 1.57 }
  ],
  "itemPositions": [
    { "position": [x, y, z], "type": "item-box" }
  ]
}
```

#### `track-data.json` Schema (Battle Arenas)

```json
{
  "id": "battleisland",
  "name": "Battle Island",
  "type": "battle",
  "navmesh": {
    "vertices": [[x,y,z], ...],
    "triangles": [[i0,i1,i2], ...]
  },
  "spawnPositions": [
    { "position": [x, y, z], "heading": 0 }
  ],
  "itemPositions": [
    { "position": [x, y, z], "type": "item-box" }
  ]
}
```

### Conversion Script: `tools/stk_extract_track_data.py`

**Required operations per track:**

1. **Read `quads.xml`** → Parse all `<quad>` elements with 4 corner vertices → compute center + width → output as `driveline[]`
2. **Read `graph.xml`** → Parse `<node-list>` + `<edge-list>` → output as `graph.nodes[]` + `graph.edges[]`
3. **Derive checkpoints** → Every Nth quad (e.g., every 10th) becomes a checkpoint; quad-0 = lap line
4. **Derive start grid** → From quad-0 + quad-1 direction, generate 8–12 staggered positions across the start line width
5. **Read `scene.xml`** → Extract `<item>` positions for powerup boxes
6. **Read `navmesh.xml`** (arenas) → Parse vertices + triangles → output navmesh data
7. **Bundle into `track-data.json`**

---

## Phase 3 — Porting (Runtime Integration)

### Step 3a: Track Data Loader

Create `frontend/src/modules/track-data-loader.js`:
- `loadTrackData(trackId)` → fetch `track-data.json` from the track bundle
- Cache loaded data per track
- Expose: `getDriveline()`, `getGraph()`, `getCheckpoints()`, `getStartGrid()`, `getNavmesh()`

### Step 3b: Checkpoint / Lap System for STK Tracks

Modify `frontend/src/modules/gates.js` (or create new `checkpoints.js`):
- Instead of requiring `gates.glb`, use driveline quads as invisible checkpoints
- Track which quad the kart is nearest to → derive lap progress
- Detect lap-line crossing (quad-0) → increment lap count
- Works for both human players and bots

### Step 3c: Start Grid System

Modify `frontend/src/modules/track.js`:
- Replace single `startPosition` with grid from `track-data.json`
- Assign grid slots based on qualifying/random order
- Apply correct heading from quad-0 orientation

### Step 3d: Registry Updates

Update `frontend/src/modules/track-data.js` and `content-registry.js`:
- Flag tracks that have `track-data.json` as fully integrated
- Use extracted data instead of hardcoded positions
- Define Grand Prix cups using Tier 1 tracks

---

## Phase 4 — Bot AI Implementation

### Step 4a: Racing Bot Controller

Create `frontend/src/modules/bot-controller.js`:
- **Input:** driveline quads + graph from track-data.json
- **Core loop:** Find current quad → get next N quads → steer toward look-ahead point
- **Steering:** Calculate angle to target → apply proportional steering input
- **Speed:** Slow on sharp turns (high angle delta between consecutive quads), full speed on straights
- **Collision avoidance:** Raycast left/right to avoid walls, brake if too close to other karts
- **Difficulty levels:** Vary look-ahead distance, max speed, steering precision

### Step 4b: Battle Bot Controller

Create `frontend/src/modules/battle/bot-battle-controller.js`:
- **Input:** navmesh from track-data.json
- **Navigation:** A* pathfinding on navmesh triangles
- **Targeting:** Find nearest opponent → path to them → fire weapons
- **Evasion:** Random direction changes, flee when low health

### Step 4c: Bot Integration

- Spawn bot karts with same physics as player
- Run bot controllers at same tick rate
- Display bot nametags (NPC names)

---

## Phase 5 — Testing & Validation

### Per-Track Acceptance Criteria

| Test | Pass Criteria |
|------|---------------|
| **GLB loads** | Track renders in <3s, no console errors |
| **Textures intact** | No missing/black textures, correct UV mapping |
| **Collision works** | Kart sits on track surface, no fall-through |
| **Start position correct** | Kart faces correct direction on start line |
| **Waypoints valid** | Driveline follows track centerline (visual debug overlay) |
| **Lap counting works** | Crossing start line increments lap, 3 laps = finish |
| **Checkpoints work** | Wrong-way/shortcut detection functional |
| **Bot completes race** | AI bot finishes 3 laps without getting stuck |
| **FPS ≥ 30** | On mid-range device (GTX 1060 / M1 equivalent) |
| **Load size ≤ 8 MB** | Total network transfer for track bundle |
| **Arena navmesh** | Battle bots navigate without stuck points |
| **Spawn points** | All 12 spawn positions are on valid ground |

### Testing Commands

```bash
# Visual debug overlay for waypoints
?debug=waypoints&track=cornfield_crossing

# Bot stress test (8 bots, 3 laps)
?mode=quick_race&track=cornfield_crossing&bots=8

# FPS benchmark
?benchmark=true&track=cornfield_crossing&duration=60
```

### Regression Suite

Track integration must not break:
- Existing custom maps (`map1`, `map2`)
- Online multiplayer (Colyseus rooms)
- Lobby UI / track selection
- Weapon/powerup system

---

## Execution Order

```
Phase 2a → Create stk_extract_track_data.py (quads + graph parser)
Phase 2b → Run on all Tier 1 tracks, generate track-data.json files
Phase 3a → Build track-data-loader.js
Phase 3b → Build quad-based checkpoint/lap system
Phase 3c → Wire up start grid from extracted data
Phase 2c → Extract navmesh for arenas
Phase 4a → Build racing bot controller
Phase 4b → Build battle bot controller (navmesh)
Phase 5  → Per-track testing & validation
```

### Tier 1 Import Priority Order

1. **Cornfield Crossing** — Simple, flat, great for initial testing (2.8 MB, 10 SPMs)
2. **Northern Resort** — Smallest track, good validation (1.2 MB, 5 SPMs)
3. **Oliver's Math Class** — Unique theme, very simple (2.0 MB, 4 SPMs)
4. **Snow Peak** — Medium complexity test (2.1 MB, 24 SPMs)
5. **Nessie's Pond** — Open layout, 4 SPMs (3.5 MB)
6. **Shifting Sands** — Desert theme variety (6.4 MB)
7. **Ravenbridge Mansion** — Gothic theme (4.1 MB)
8. **Antediluvian Abyss** — Underwater theme (4.0 MB)
9. **Candela City** — Urban, most scene objects in tier 1 (4.2 MB)
10. **Minigolf** — Unique gameplay feel (6.0 MB)

### Arena Import Priority Order

1. **The Stadium** — Simplest (1.0 MB, 1 SPM)
2. **Las Dunas Arena** — Small (2.6 MB)
3. **Battle Island** — Medium (3.8 MB)
4. **Pumpkin Park** — Medium (3.2 MB)
5. **Candela City Arena** — Medium (3.2 MB)
6. **Alien Signal** — Larger (4.4 MB)
7. **Temple** — Larger (4.5 MB)
8. **Cave X** — Largest suitable (10.7 MB)
