# GLO-Karts Arena Builder v2 — Development Plan

> **Goal**: Replace the current prototype builder with a production-quality browser-based
> track / arena editor modeled on [stk-editor](https://github.com/supertuxkart/stk-editor),
> informed by [Starter-Kit-Racing](https://github.com/mrdoob/Starter-Kit-Racing) (browser
> track editor) and [crashcat](https://github.com/isaac-mason/crashcat) (pure-JS physics).

---

## 1  Architecture Overview

```
builder.html
  └─ src/builder-v2/
       ├─ builder-app.js        ← entry point, orchestrates subsystems
       ├─ viewport.js           ← Three.js renderer, camera, grid, skybox
       ├─ camera-controller.js  ← orbit + top-down toggle (ortho / persp)
       ├─ input-router.js       ← mouse / keyboard → tool dispatch
       ├─ toolbox.js            ← sidebar panel manager (4 tabs)
       │    ├─ terrain-panel.js  ← heightmap / ground material paint
       │    ├─ objects-panel.js  ← GLB asset library, drag-and-drop
       │    ├─ road-panel.js     ← spline-based road / track tool
       │    └─ extras-panel.js   ← spawn points, item boxes, checkpoints, bounds
       ├─ selection.js          ← pick / multi-select via ray + box
       ├─ transform-gizmo.js   ← move / rotate / scale handles
       ├─ command-stack.js      ← undo / redo with command pattern
       ├─ scene-graph.js        ← entity tree, add/remove/reparent
       ├─ asset-loader.js       ← GLB loader + thumbnail cache
       ├─ serializer.js         ← save / load / share (JSON + base64url)
       ├─ physics-bridge.js     ← crashcat world for picking + collisions
       └─ playtest-bridge.js    ← launch race via Colyseus handoff
```

### Runtime-Shared Data (preserved from v1)

`track-editor.js` exports `SEGMENT_TYPES`, `OBSTACLE_TYPES`, `importTrackCode`,
`saveCustomTrack`, etc. that are consumed at runtime by `track-data-loader.js`
and dynamically by `lobby.js`. These **must NOT be deleted** — they remain in
`src/modules/` as the canonical schema definitions. The new builder imports them.

---

## 2  Reference Architecture Mapping

| stk-editor Concept | Browser Equivalent | Notes |
|---|---|---|
| Irrlicht viewport | Three.js WebGLRenderer + Scene | OrbitControls + ortho toggle |
| Toolbox 4 panels (Terrain / Env / Road / Extra) | Sidebar with 4 tab panels | HTML/CSS + JS panel classes |
| Environment panel → addItem() | objects-panel.js drag from library | 3D thumbnail grid, click-to-place + drag |
| SELECT / EDIT / FREECAM states | input-router modes | Toolbar buttons + Shift shortcuts |
| Keyboard: Shift+G/R/S delete ctrl-z/y | Same shortcuts | input-router bindings |
| Export .stktrack XML | serializer.js → JSON | URL share code, localStorage, download |

| Starter-Kit-Racing Concept | What We Adopt | What We Change |
|---|---|---|
| Grid cells with auto-tiling bitmask | Use for road/track cell painting mode | Extend with free-form object placement |
| Ghost preview before commit | ✅ adopt as-is for road tool | — |
| Orthographic top-down editor cam | ✅ adopt as default camera; toggle to 3D | — |
| Base64url map sharing | ✅ same URL share + localStorage | Extended to include objects + metadata |
| GLB track pieces via GLTFLoader | ✅ reuse existing 22 track GLBs | Add LOD system for large scenes |

| crashcat Concept | How We Use It |
|---|---|
| castRay / collideShape | **Object picking** in viewport — replaces Three.js raycaster for precision |
| Static box/mesh colliders | **Placement validation** — detect overlaps before committing |
| World state serialization | **Save physics state** with track for runtime wall generation |
| Three.js debug renderer | **Optional debug overlay** toggle in builder |

---

## 3  Existing Assets to Leverage

### Track Pieces (`public/models/track/`)
22 GLB files — straights, corners (large/small), bumps (up/down), hills,
bends, skews, caps, ramps, wide variants. Plus `colliders/` directory.

### STK Arenas (`public/models/stk/arenas/`)
10 arena directories: alien_signal, ancient_colosseum_labyrinth,
arena_candela_city, battleisland, blockfort, cave, lasdunasarena,
pumpkin_park, stadium, temple. Can be loaded as reference maps.

### Karts (`public/models/stk/karts/`, `public/models/car*.glb`)
19 STK karts + 8 color-variant cars for playtest preview.

### Pre-built Maps (`public/models/maps/`)
map1/, map2/ — existing race tracks for reference.

---

## 4  Development Phases

### Phase 1 — Scaffold & Viewport (Foundation)
**Files**: `builder-app.js`, `viewport.js`, `camera-controller.js`, `builder.html`, `builder-v2.css`

- [ ] Three.js scene with ground plane, infinite grid, sky gradient
- [ ] OrbitControls with ortho top-down ↔ perspective 3D toggle (key: `Numpad5`)
- [ ] Pan (middle mouse / Ctrl+click / Space+click), zoom (scroll), rotate (right-drag in 3D mode)
- [ ] Window resize handling, WebGL context loss recovery
- [ ] Minimal HTML shell: viewport canvas + sidebar placeholder + top toolbar

### Phase 2 — Asset Library & Object Placement
**Files**: `asset-loader.js`, `objects-panel.js`, `scene-graph.js`, `toolbox.js`

- [ ] Scan `public/models/track/` and generate thumbnail grid (render-to-canvas or static sprites)
- [ ] Click asset → ghost preview follows cursor on ground plane
- [ ] Click to place → add to scene graph, snap to grid (optional, toggle with `G`)
- [ ] Scene graph: flat list of entities with `{id, type, model, position, rotation, scale}`
- [ ] Entity inspector panel showing selected object's transform fields

### Phase 3 — Selection & Transform
**Files**: `selection.js`, `transform-gizmo.js`, `input-router.js`

- [ ] Click-to-select with raycasting (three.js Raycaster, upgrade to crashcat later)
- [ ] Box-select (click+drag on empty space)
- [ ] Multi-select (Shift+click)
- [ ] Transform gizmo modes: Move (`Shift+G`), Rotate (`Shift+R`), Scale (`Shift+S`)
- [ ] Transform gizmo renders as arrows/rings/boxes around selection
- [ ] Delete key removes selected entities
- [ ] Escape deselects

### Phase 4 — Undo / Redo & Command Stack
**Files**: `command-stack.js`

- [ ] Command pattern: each action = `{ execute(), undo(), description }`
- [ ] Commands: PlaceObject, DeleteObject, TransformObject, GroupTransform
- [ ] Ctrl+Z undo, Ctrl+Y / Ctrl+Shift+Z redo
- [ ] Stack size limit (100)

### Phase 5 — Road / Track Tool
**Files**: `road-panel.js`, extend `scene-graph.js`

- [ ] Grid-based road painting mode (from Starter-Kit-Racing approach)
- [ ] Auto-tiling: 4-bit neighbor bitmask determines piece + rotation
- [ ] Piece mapping: straight, corner, T-junction, crossroads from existing track GLBs
- [ ] Ghost preview showing proposed tiles before mouse-up commits
- [ ] Erase mode for road segments
- [ ] Orientation override for manual control

### Phase 6 — Extras Panel (Gameplay Objects)
**Files**: `extras-panel.js`

- [ ] Spawn point placement (numbered, with heading arrow indicator)
- [ ] Item box placement (grid or free)
- [ ] Checkpoint gate placement (for race mode)
- [ ] Arena bounds definition (drag rectangle or auto from placed objects)
- [ ] Driveline / race path visualization

### Phase 7 — Terrain Panel (Stretch Goal)
**Files**: `terrain-panel.js`

- [ ] Ground plane size / shape control
- [ ] Material paint (texture selection from available textures)
- [ ] Simple heightmap editing (raise / lower / smooth / flatten brushes)

### Phase 8 — Save / Load / Share
**Files**: `serializer.js`

- [ ] Save to localStorage with named slots
- [ ] JSON export / import (download / upload file)
- [ ] URL share code (base64url encoded, like Starter-Kit-Racing)
- [ ] Auto-save on change (debounced)
- [ ] Compatible format with existing `track-editor.js` schema for runtime consumption

### Phase 9 — Physics Integration
**Files**: `physics-bridge.js`

- [ ] `npm install crashcat` — add to frontend dependencies
- [ ] Static collision world initialized from placed track pieces
- [ ] castRay for precision object picking (upgrade from Three.js raycaster)
- [ ] collideShape for placement validation (overlap detection)
- [ ] Wall collider generation from road edges (reference: Starter-Kit-Racing Physics.js)
- [ ] Debug renderer toggle (`crashcat/three`)

### Phase 10 — Playtest Bridge
**Files**: `playtest-bridge.js`

- [ ] "Play" button generates TrackData JSON from scene graph
- [ ] Launches `realtime.html` in new tab with `customTrackData` in sessionStorage
- [ ] Builder-playtest loading screen (reuse existing CSS from realtime.html)
- [ ] Return-to-editor button in playtest

---

## 5  File Deletion Manifest (Current Builder v1)

**DELETE entirely:**
- `frontend/src/builder-main.js`
- `frontend/src/builder/editor-state.js`
- `frontend/src/builder/command-transactions.js`
- `frontend/src/builder/drag-controller.js`
- `frontend/src/builder/scene-adapter.js`
- `frontend/src/builder/gizmo-layer.js`
- `frontend/src/builder/road-controller.js`
- `frontend/src/builder-style.css`
- `frontend/scripts/builder-playtest-regression.mjs`
- `frontend/reports/builder-playtest-regression.json`
- `frontend/BUILDER_REFACTOR_TODOS.md`

**KEEP (runtime dependencies):**
- `frontend/src/modules/track-editor.js` — SEGMENT_TYPES, OBSTACLE_TYPES, import/export
- `frontend/src/modules/track-placement.js` — GRID_SIZE, snapToGrid, occupancy helpers

**REWRITE (will become new builder entry):**
- `frontend/builder.html` — new HTML shell for v2

**CLEAN references:**
- `frontend/package.json` — remove `test:e2e:builder-playtest` script
- `frontend/realtime.html` — builder-playtest CSS/HTML can stay (used by playtest bridge)
- `frontend/src/lobby.js` — `_openBuilder()` stays (still links to builder.html)
- `frontend/src/lobby-style.css` — builder card styles stay (lobby still shows builder mode card)

---

## 6  New Dependencies

| Package | Version | Purpose |
|---|---|---|
| `crashcat` | latest | Physics: picking, collision, wall generation |
| `three` | ^0.175.0 | Already installed — 3D rendering |

No other new dependencies required. Three.js OrbitControls, Raycaster,
GLTFLoader all come from the existing `three` package.

---

## 7  Key Design Decisions

1. **Three.js only** — the builder uses Three.js exclusively (no Babylon.js). Runtime
   battle mode can remain Babylon; the builder is a separate entry point.

2. **Grid + free-form hybrid** — road tool uses grid-snap auto-tiling; object tool
   allows free placement with optional grid snap toggle.

3. **JSON schema compatibility** — output format extends the existing TrackData schema
   from `track-editor.js` so existing runtime rendering works unchanged.

4. **No backend dependency** — builder is 100% client-side. Saves to localStorage/URL/file.
   No Django involvement.

5. **Modular files** — each subsystem in its own file, no god-class. ~200-400 LOC per file.

---

## 8  Keyboard Shortcuts (Matching stk-editor)

| Key | Action |
|---|---|
| `Shift+G` | Move mode |
| `Shift+R` | Rotate mode |
| `Shift+S` | Scale mode |
| `Shift+A` | Select all |
| `Delete` | Delete selected |
| `Escape` | Deselect / cancel |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `Ctrl+S` | Save |
| `G` | Toggle grid snap |
| `C` | Toggle camera mode (free / orbit) |
| `Numpad5` | Toggle ortho / perspective |
| `R` | Toggle road painting mode |
| `1-4` | Switch toolbox panel |
