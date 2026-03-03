# SuperTuxKart Integration Guide

This project now supports a content-registry based integration path for SuperTuxKart-derived content.

## Important Licensing Note

Before importing assets from SuperTuxKart, verify each asset's license and attribution requirements in the original repository. Some assets may require attribution and/or share-alike obligations.

## What Is Integrated

- Track namespace support (`stk:<track-id>`) in race mode.
- Automatic lobby map dropdown discovery from `public/models/stk/manifest.json`.
- Automatic battle arena dropdown discovery from `public/models/stk/manifest.json`.
- Weapon set registry support in battle mode (`weaponSet`, default: `stk-classic`).
- Central content registry for game modes, tracks, and weapon sets.
- Import script for already-converted web assets (`.glb`).

## Folder Layout for Imported Assets

Imported STK-compatible assets are expected in:

- `public/models/stk/tracks/<track-id>/track.glb` (required)
- `public/models/stk/tracks/<track-id>/decorations.glb` (optional)
- `public/models/stk/arenas/<arena-id>/arena.glb` (optional for future arena integration)
  - This now supports runtime loading through `stk:<arena-id>` in battle mode.

## Import Converted Assets

From `frontend`:

- `npm run import:stk -- --source="C:/path/to/converted-stk-assets"`

## Scan SuperTuxKart Source Repository

If you have a local clone of the SuperTuxKart repository, you can scan and stage directly from it:

- `npm run scan:stk -- --source="C:/path/to/supertuxkart"`

This command:

- Builds/updates `public/models/stk/manifest.json` with tracks, arenas, and karts.
- Copies any already-converted `.glb` assets it can find.
- Writes conversion tasks to `stk-migration/conversion-queue.json` for assets still needing conversion.

## Device-Aware Curation (Web Performance)

The generated `manifest.json` includes profile bundles:

- `lite`: intended for lower-memory mobile devices (fewer/smaller tracks/karts/arenas)
- `balanced`: default cross-device catalog
- `full`: full migrated catalog for stronger desktops

At runtime, the lobby picks a profile using browser heuristics (`deviceMemory`, `hardwareConcurrency`, screen size) and filters the STK selection accordingly.
Battle mode also picks the profile's default weapon set (`stk-lite` or `stk-classic`).

This command also regenerates `public/models/stk/manifest.json` so newly imported tracks appear in the lobby map selector automatically.

Expected source structure:

- `<source>/tracks/<track-id>/track.glb`
- `<source>/tracks/<track-id>/decorations.glb` (optional)
- `<source>/arenas/<arena-id>/arena.glb` (optional)

## Runtime Usage

- Race track IDs:
  - Built-in: `map1`, `map2`
  - STK namespace: `stk:<track-id>`
- Battle weapon sets:
  - `stk-classic` (default)
- Kart model IDs:
  - Built-in colors: `red`, `blue`, `green`, etc.
  - STK karts: `stk:<kart-id>` (example: `stk:tux`), loaded from `public/models/stk/karts/<kart-id>/kart.glb`

## Next Expansion Points

- Dynamic map picker population from imported STK tracks.
- Arena loader support for imported STK arenas.
- Weapon VFX models from imported assets instead of primitive meshes.
