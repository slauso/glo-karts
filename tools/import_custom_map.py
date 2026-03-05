#!/usr/bin/env python3
"""
import_custom_map.py — Bring any STK-format custom map (race track or battle arena)
into the GLO Karts project as a fully playable course.

Usage:
  python tools/import_custom_map.py \
    --src=path/to/extracted_map_folder \
    --id=my_map_id \
    --type=arena \
    --name="My Map Name"

  # Optional:
    --laps=3          (race tracks only, default 3)
    --start=x,y,z    (spawn point override, default auto-detected)

Examples:
  python tools/import_custom_map.py --src=temp_blockfort/extracted/mk64blockfort --id=blockfort --type=arena --name="Block Fort"
  python tools/import_custom_map.py --src=/downloads/my_race_track       --id=my_race  --type=track --name="My Race Track" --laps=3

What it does:
  1. Finds the .spm file in --src
  2. Converts SPM → GLB using the project's spm_to_glb converter
  3. Copies GLB to frontend/public/models/stk/{arenas|tracks}/{id}/{arena|track}.glb
  4. Tries to auto-detect spawn position from scene.xml
  5. Prints the JS code snippets you need to paste into 3 files

After running this script:
  - Paste the track-data.js snippet into the TRACK_REGISTRY in  frontend/src/modules/track-data.js
  - Paste the lobby snippet into STK_ARENAS / STK_TRACKS in both:
      frontend/src/lobby.js
      frontend/src/lobby-track-preview.js
"""

import argparse
import importlib.util
import shutil
import sys
import os
import xml.etree.ElementTree as ET
from pathlib import Path

# ── Locate project root ───────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
SPM_CONVERTER = PROJECT_ROOT / 'temp_blockfort' / 'spm_to_glb.py'

# ── CLI args ──────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(description='Import a custom STK map into GLO Karts.')
    p.add_argument('--src',   required=True, help='Path to extracted map folder (contains .spm file)')
    p.add_argument('--id',    required=True, help='Unique track/arena id (no spaces, e.g. blockfort)')
    p.add_argument('--type',  required=True, choices=['arena', 'track'], help='arena or track')
    p.add_argument('--name',  required=True, help='Display name shown in the lobby')
    p.add_argument('--laps',  type=int, default=3, help='Number of laps (race tracks only)')
    p.add_argument('--start', default=None, help='Spawn position override: x,y,z')
    return p.parse_args()

# ── Find SPM ──────────────────────────────────────────────────────────────────

def find_spm(folder: Path) -> Path:
    spms = list(folder.glob('*.spm'))
    # Prefer a file that contains "track" or "arena" in its name, otherwise take first
    preferred = [s for s in spms if 'track' in s.stem.lower() or 'arena' in s.stem.lower()]
    chosen = (preferred or spms)
    if not chosen:
        sys.exit(f'ERROR: No .spm file found in {folder}')
    return chosen[0]

# ── Auto-detect start position from scene.xml ─────────────────────────────────

def detect_start(folder: Path):
    scene_xml = folder / 'scene.xml'
    if not scene_xml.exists():
        return None

    try:
        root = ET.parse(scene_xml).getroot()
    except ET.ParseError:
        return None

    # Battle arenas: collect all <item> spawn positions and use centroid
    items = [(float(el.get('x', 0)), float(el.get('y', 0)), float(el.get('z', 0)))
             for el in root.iter('item')]
    if items:
        cx = sum(i[0] for i in items) / len(items)
        cy = sum(i[1] for i in items) / len(items)
        cz = sum(i[2] for i in items) / len(items)
        # Add 2 units above centroid so kart spawns slightly above ground
        return (round(cx, 2), round(cy + 2, 2), round(cz, 2))

    # Race tracks: get start position from <track> element
    track_el = root.find('track')
    if track_el is not None:
        x = float(track_el.get('x', 0))
        y = float(track_el.get('y', 0))
        z = float(track_el.get('z', 0))
        if x != 0 or z != 0:
            return (round(x, 3), round(y + 3, 3), round(z, 3))

    return None

# ── GLB conversion using project's spm_to_glb converter ──────────────────────

def convert_spm_to_glb(spm_path: Path, tex_dir: Path, out_path: Path, map_name: str):
    if not SPM_CONVERTER.exists():
        sys.exit(f'ERROR: spm_to_glb converter not found at {SPM_CONVERTER}')

    # Load the converter as a module and monkey-patch its path globals
    spec = importlib.util.spec_from_file_location('spm_to_glb', SPM_CONVERTER)
    mod = importlib.util.module_from_spec(spec)
    mod.SPM_PATH = spm_path
    mod.TEX_DIR = tex_dir
    mod.OUT_PATH = out_path
    spec.loader.exec_module(mod)

    # Override path globals AFTER exec (exec_module re-assigns them from the script source)
    import types
    mod.SPM_PATH = spm_path
    mod.TEX_DIR = tex_dir
    mod.OUT_PATH = out_path

    # Patch the scene name in the GLB output
    original_main = mod.main
    def patched_main():
        # Redirect OUT_PATH reference inside main by patching the global
        mod.OUT_PATH = out_path
        original_main()
    mod.main = patched_main

    print(f'  Converting {spm_path.name} → {out_path.name} ...')
    try:
        mod.main()
    except Exception as e:
        sys.exit(f'ERROR during SPM conversion: {e}')

# ── Print JS snippets ─────────────────────────────────────────────────────────

def print_snippets(args, start, out_glb):
    sx, sy, sz = start if start else (0, 5, 0)
    tid = args.id
    tname = args.name
    is_arena = args.type == 'arena'
    laps = args.laps

    section = 'STK Battle Arenas' if is_arena else 'STK Race Tracks'
    reg_key = 'stk-arena' if is_arena else 'stk-track'
    laps_part = '' if is_arena else f'laps: {laps}, '

    print()
    print('=' * 70)
    print('PASTE INTO  frontend/src/modules/track-data.js  (TRACK_REGISTRY):')
    print('=' * 70)
    print(f"  // ── {section}")
    print(f"  {tid}: {{ type: '{reg_key}', scale: 1, {laps_part}name: '{tname}', start: {{ x: {sx}, y: {sy}, z: {sz} }}, startHeading: 0 }},")

    list_name = 'STK_ARENAS' if is_arena else 'STK_TRACKS'
    print()
    print(f'PASTE INTO  frontend/src/lobby.js  AND  frontend/src/lobby-track-preview.js  ({list_name}):')
    print('=' * 70)
    print(f"  {{ id: '{tid}', name: '{tname}' }},")

    print()
    print(f'GLB output: {out_glb}')
    print('Done! ✓  Vite will hot-reload the changes automatically.')

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    args = parse_args()
    src_folder = Path(args.src).resolve()
    if not src_folder.is_dir():
        sys.exit(f'ERROR: --src folder not found: {src_folder}')

    # Locate SPM and textures
    spm_path = find_spm(src_folder)
    tex_dir = src_folder
    print(f'Found SPM: {spm_path.name}')

    # Determine output destination
    sub_dir = 'arenas' if args.type == 'arena' else 'tracks'
    glb_name = 'arena.glb' if args.type == 'arena' else 'track.glb'
    out_dir = PROJECT_ROOT / 'frontend' / 'public' / 'models' / 'stk' / sub_dir / args.id
    out_dir.mkdir(parents=True, exist_ok=True)
    out_glb = out_dir / glb_name

    # Convert SPM → GLB (write to a tmp path in project root, then move)
    tmp_glb = PROJECT_ROOT / f'_tmp_{args.id}.glb'
    convert_spm_to_glb(spm_path, tex_dir, tmp_glb, args.name)

    # Move to final destination
    if tmp_glb.exists():
        shutil.move(str(tmp_glb), str(out_glb))
        print(f'  Installed → {out_glb.relative_to(PROJECT_ROOT)}')
    elif out_glb.exists():
        print(f'  (GLB already in place at {out_glb.relative_to(PROJECT_ROOT)})')
    else:
        sys.exit('ERROR: Conversion produced no output file.')

    # Auto-detect spawn position
    start = None
    if args.start:
        try:
            parts = [float(v) for v in args.start.split(',')]
            start = tuple(parts[:3])
            print(f'  Using manual start position: {start}')
        except ValueError:
            print('  WARNING: --start value invalid, will auto-detect.')

    if start is None:
        start = detect_start(src_folder)
        if start:
            print(f'  Auto-detected start position from scene.xml: {start}')
        else:
            start = (0, 5, 0)
            print(f'  No start position found; using default {start}. Override with --start=x,y,z')

    print_snippets(args, start, out_glb)


if __name__ == '__main__':
    main()
