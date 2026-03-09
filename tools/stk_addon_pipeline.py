#!/usr/bin/env python3
"""
stk_addon_pipeline.py — Download, extract, and convert STK addon tracks
to GLB format for TwistedKart.

This script:
1. Downloads addon track/arena zip files from the STK addon server
2. Extracts and analyzes the track XML (scene.xml, track.xml)
3. Converts .b3d / .spm models to .glb using the existing converters
4. Extracts driveline, start positions, items from XML
5. Generates track-data.json for each track
6. Places files in the correct output directory

Usage:
    python stk_addon_pipeline.py --list            # List available addons
    python stk_addon_pipeline.py --import-all       # Import all configured tracks
    python stk_addon_pipeline.py --import <track_id> # Import a specific track

Requirements:
    pip install requests
"""

import argparse
import json
import os
import shutil
import struct
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

# Import existing converters
TOOLS_DIR = Path(__file__).parent
sys.path.insert(0, str(TOOLS_DIR))
try:
    from spm_to_glb import convert_spm_to_glb
except ImportError:
    convert_spm_to_glb = None
try:
    from b3d_to_glb import convert_b3d_to_glb
except ImportError:
    convert_b3d_to_glb = None

# ── Addon Track Registry ────────────────────────────────────────────────────
# Maps our internal track ID → STK addon download info.
# 'source' can be 'stk-addons' or 'gamebanana'.
# 'addon_id' is the ID on the STK addons server.

ADDON_TRACKS = {
    # ── Race Tracks (15) ─────────────────────────────────────────────
    'pipe_track': {
        'name': 'Pipe Track',
        'source': 'stk-addons',
        'addon_id': 'pipe-track',
        'type': 'race',
    },
    'sector5_mini': {
        'name': 'Sector 5 Mini',
        'source': 'stk-addons',
        'addon_id': 'sector5-mini',
        'type': 'race',
    },
    'forest_lake': {
        'name': 'Around the Forest Lake',
        'source': 'stk-addons',
        'addon_id': 'around-the-forest-lake',
        'type': 'race',
    },
    'marble_stage': {
        'name': 'Marble Stage',
        'source': 'stk-addons',
        'addon_id': 'marble_stage',
        'type': 'race',
    },
    'kart_track': {
        'name': 'Kart Track',
        'source': 'stk-addons',
        'addon_id': 'kart-track',
        'type': 'race',
    },
    'racetrack': {
        'name': 'Racetrack',
        'source': 'stk-addons',
        'addon_id': 'racetrack',
        'type': 'race',
    },
    'sweet_cake': {
        'name': 'Sweet Cake',
        'source': 'stk-addons',
        'addon_id': 'sweet-cake',
        'type': 'race',
    },
    'rhomboor': {
        'name': 'Rhomboor',
        'source': 'stk-addons',
        'addon_id': 'rhomboor',
        'type': 'race',
    },
    'kart_corner': {
        'name': 'Kart Corner',
        'source': 'stk-addons',
        'addon_id': 'kart-corner',
        'type': 'race',
    },
    'lemans_lm': {
        'name': 'Le Mans LM Track',
        'source': 'stk-addons',
        'addon_id': 'lemans-lm',
        'type': 'race',
    },
    'freestyle_roads': {
        'name': 'Freestyle Roads 1',
        'source': 'stk-addons',
        'addon_id': 'freestyle-roads-1',
        'type': 'race',
    },
    'neon_duel_speedway': {
        'name': 'Neon Duel Speedway',
        'source': 'stk-addons',
        'addon_id': 'neon-duel-speedway',
        'type': 'race',
        'note': 'Renamed from IP-conflicting original',
    },
    'blossom_circuit': {
        'name': 'Blossom Circuit',
        'source': 'stk-addons',
        'addon_id': 'blossom-circuit',
        'type': 'race',
        'note': 'Renamed from IP-conflicting original',
    },
    'starter_circuit': {
        'name': 'Starter Circuit',
        'source': 'stk-addons',
        'addon_id': 'starter-circuit',
        'type': 'race',
        'note': 'Renamed from IP-conflicting original',
    },
    'sunset_wilds': {
        'name': 'Sunset Wilds',
        'source': 'stk-addons',
        'addon_id': 'sunset-wilds',
        'type': 'race',
        'note': 'Renamed from IP-conflicting original',
    },

    # ── Battle Arenas (15) ───────────────────────────────────────────
    'tiny': {
        'name': 'Tiny',
        'source': 'stk-addons',
        'addon_id': 'tiny',
        'type': 'arena',
    },
    'advanced_course': {
        'name': 'Advanced Course',
        'source': 'stk-addons',
        'addon_id': 'advanced-course',
        'type': 'arena',
    },
    'tournament_field': {
        'name': 'Tournament Field',
        'source': 'stk-addons',
        'addon_id': 'tournament-field',
        'type': 'arena',
    },
    'pipe_field': {
        'name': 'Pipe Field',
        'source': 'stk-addons',
        'addon_id': 'pipe-field',
        'type': 'arena',
    },
    'nitro_soccer': {
        'name': 'Nitro Soccer Field',
        'source': 'stk-addons',
        'addon_id': 'nitro-soccer-field',
        'type': 'arena',
    },
    'abyss_soccer': {
        'name': 'Abyss Soccer',
        'source': 'stk-addons',
        'addon_id': 'abyss-soccer',
        'type': 'arena',
    },
    'lava_fields': {
        'name': 'Lava Fields',
        'source': 'stk-addons',
        'addon_id': 'lava-fields',
        'type': 'arena',
    },
    'tiny_arena': {
        'name': 'Tiny Arena',
        'source': 'stk-addons',
        'addon_id': 'tiny-arena',
        'type': 'arena',
        'note': 'Renamed from IP-conflicting original',
    },
    'kristis_park': {
        'name': "Kristi's Park",
        'source': 'stk-addons',
        'addon_id': 'kristis-park',
        'type': 'arena',
    },
    'block_fort': {
        'name': 'Block Fort',
        'source': 'stk-addons',
        'addon_id': 'block-fort',
        'type': 'arena',
        'note': 'Renamed from IP-conflicting original',
    },
    'smash_island': {
        'name': 'Smash Island',
        'source': 'stk-addons',
        'addon_id': 'smash-island',
        'type': 'arena',
    },
    'n64_skyscraper': {
        'name': 'N64 Skyscraper',
        'source': 'stk-addons',
        'addon_id': 'n64-skyscraper',
        'type': 'arena',
    },
    'twisted_domain': {
        'name': 'Twisted Domain',
        'source': 'stk-addons',
        'addon_id': 'twisted-domain',
        'type': 'arena',
        'note': 'Renamed from IP-conflicting original',
    },
    'castle_courtyard': {
        'name': 'Castle Courtyard',
        'source': 'stk-addons',
        'addon_id': 'castle-courtyard',
        'type': 'arena',
    },
    'thunder_stadium': {
        'name': 'Thunder Stadium',
        'source': 'stk-addons',
        'addon_id': 'thunder-stadium',
        'type': 'arena',
        'note': 'Renamed from IP-conflicting original',
    },
}

# ── STK Addon Server ────────────────────────────────────────────────────────

STK_ADDONS_BASE = 'https://online.supertuxkart.net'
STK_ADDONS_DL   = f'{STK_ADDONS_BASE}/downloads'

def get_addon_download_url(addon_id, addon_type='track'):
    """Construct the download URL for an STK addon."""
    folder = 'tracks' if addon_type == 'track' else 'arenas'
    return f'{STK_ADDONS_DL}/{folder}/{addon_id}.zip'


def download_addon(track_id, output_dir):
    """Download an addon track/arena zip file."""
    try:
        import requests
    except ImportError:
        print(f'  ERROR: requests library not installed. Run: pip install requests')
        return None

    info = ADDON_TRACKS.get(track_id)
    if not info:
        print(f'  ERROR: Unknown track ID: {track_id}')
        return None

    addon_type = 'track' if info['type'] == 'race' else 'arena'
    url = get_addon_download_url(info['addon_id'], addon_type)

    print(f'  Downloading {info["name"]} from {url}...')
    try:
        resp = requests.get(url, timeout=60, stream=True)
        resp.raise_for_status()
    except Exception as e:
        print(f'  WARNING: Download failed for {track_id}: {e}')
        print(f'  The track will use procedural fallback geometry.')
        return None

    zip_path = output_dir / f'{track_id}.zip'
    with open(zip_path, 'wb') as f:
        for chunk in resp.iter_content(chunk_size=8192):
            f.write(chunk)

    print(f'  Downloaded to {zip_path} ({zip_path.stat().st_size / 1024:.0f} KB)')
    return zip_path


def extract_addon(zip_path, extract_dir):
    """Extract an addon zip file and return the root directory."""
    with zipfile.ZipFile(zip_path, 'r') as zf:
        zf.extractall(extract_dir)

    # Find the root directory inside the zip
    entries = list(extract_dir.iterdir())
    if len(entries) == 1 and entries[0].is_dir():
        return entries[0]
    return extract_dir


def parse_track_xml(track_dir):
    """Parse STK track.xml and scene.xml to extract metadata."""
    metadata = {
        'name': 'Unknown',
        'type': 'race',
        'laps': 3,
        'startPositions': [],
        'driveline': [],
        'items': [],
    }

    # Parse track.xml
    track_xml = track_dir / 'track.xml'
    if track_xml.exists():
        tree = ET.parse(str(track_xml))
        root = tree.getroot()
        metadata['name'] = root.get('name', 'Unknown')
        if root.get('arena', 'false').lower() == 'true':
            metadata['type'] = 'arena'

    # Parse scene.xml for start positions
    scene_xml = track_dir / 'scene.xml'
    if scene_xml.exists():
        tree = ET.parse(str(scene_xml))
        root = tree.getroot()

        # Find start positions
        for node in root.iter('node'):
            node_type = node.get('type', '')
            if 'start' in node_type.lower():
                xyz = node.get('xyz', '0 0 0').split()
                if len(xyz) == 3:
                    metadata['startPositions'].append({
                        'position': [float(xyz[0]), float(xyz[1]) + 3, float(xyz[2])],
                        'heading': 0,
                    })

    # Parse quads.xml for driveline
    quads_xml = track_dir / 'quads.xml'
    if quads_xml.exists():
        try:
            tree = ET.parse(str(quads_xml))
            root = tree.getroot()
            for quad in root.iter('quad'):
                p0 = [float(x) for x in quad.get('p0', '0 0 0').split()]
                p1 = [float(x) for x in quad.get('p1', '0 0 0').split()]
                p2 = [float(x) for x in quad.get('p2', '0 0 0').split()]
                p3 = [float(x) for x in quad.get('p3', '0 0 0').split()]
                center = [(p0[i] + p1[i] + p2[i] + p3[i]) / 4 for i in range(3)]
                metadata['driveline'].append({
                    'center': center,
                    'quad': [p0, p1, p2, p3],
                })
        except Exception:
            pass

    return metadata


def find_model_files(track_dir):
    """Find .b3d and .spm model files in the track directory."""
    models = {
        'b3d': list(track_dir.glob('*.b3d')),
        'spm': list(track_dir.glob('*.spm')),
    }
    return models


def convert_to_glb(track_dir, output_path):
    """Convert the main track model to GLB format."""
    models = find_model_files(track_dir)

    # Prefer SPM over B3D (SPM is more modern)
    if models['spm'] and convert_spm_to_glb:
        main_model = models['spm'][0]
        print(f'  Converting SPM: {main_model.name}')
        convert_spm_to_glb(str(main_model), str(output_path))
        return True

    if models['b3d'] and convert_b3d_to_glb:
        main_model = models['b3d'][0]
        print(f'  Converting B3D: {main_model.name}')
        convert_b3d_to_glb(str(main_model), str(output_path))
        return True

    print(f'  WARNING: No convertible model files found')
    return False


def generate_track_data_json(track_id, metadata, addon_info):
    """Generate the track-data.json file for integration."""
    start = metadata['startPositions'][0] if metadata['startPositions'] else {
        'position': [0, 2, 0], 'heading': 0
    }

    data = {
        'id': track_id,
        'name': addon_info['name'],
        'type': addon_info['type'],
        'laps': metadata.get('laps', 3),
        'startPositions': metadata['startPositions'] or [
            {'position': [0, 2, 0], 'heading': 0}
        ],
    }

    if metadata.get('driveline'):
        data['driveline'] = metadata['driveline'][:200]  # Cap at 200 quads

    if metadata.get('items'):
        data['items'] = metadata['items']

    return data


def process_track(track_id, base_output_dir):
    """Full pipeline for a single track: download → extract → convert → integrate."""
    info = ADDON_TRACKS.get(track_id)
    if not info:
        print(f'ERROR: Unknown track {track_id}')
        return False

    print(f'\n{"=" * 60}')
    print(f'Processing: {info["name"]} ({track_id})')
    print(f'{"=" * 60}')

    # Determine output directory
    if info['type'] == 'race':
        out_dir = base_output_dir / 'tracks' / track_id
    else:
        out_dir = base_output_dir / 'arenas' / track_id

    out_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)

        # Step 1: Download
        zip_path = download_addon(track_id, tmpdir)
        if not zip_path:
            print(f'  Skipping {track_id} (download failed)')
            return False

        # Step 2: Extract
        extract_dir = tmpdir / 'extracted'
        extract_dir.mkdir()
        track_dir = extract_addon(zip_path, extract_dir)
        print(f'  Extracted to {track_dir}')

        # Step 3: Parse metadata
        metadata = parse_track_xml(track_dir)
        print(f'  Type: {metadata["type"]}, Start positions: {len(metadata["startPositions"])}')

        # Step 4: Convert to GLB
        glb_name = 'track.glb' if info['type'] == 'race' else 'arena.glb'
        glb_path = out_dir / glb_name
        converted = convert_to_glb(track_dir, glb_path)
        if converted:
            print(f'  GLB written to {glb_path}')
        else:
            print(f'  No GLB produced — track will use procedural fallback')

        # Step 5: Generate track-data.json
        track_data = generate_track_data_json(track_id, metadata, info)
        data_path = out_dir / 'track-data.json'
        with open(data_path, 'w') as f:
            json.dump(track_data, f, indent=2)
        print(f'  Metadata written to {data_path}')

        # Step 6: Copy textures
        tex_count = 0
        for ext in ['*.png', '*.jpg', '*.jpeg']:
            for tex in track_dir.glob(ext):
                shutil.copy2(tex, out_dir)
                tex_count += 1
        if tex_count:
            print(f'  Copied {tex_count} texture files')

    print(f'  DONE: {info["name"]}')
    return True


# ── CLI ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='STK Addon Track Pipeline')
    parser.add_argument('--list', action='store_true', help='List all configured addon tracks')
    parser.add_argument('--import-all', action='store_true', help='Import all configured tracks')
    parser.add_argument('--import', dest='import_id', type=str, help='Import a specific track by ID')
    parser.add_argument('--out', type=str, default='frontend/public/models/stk',
                        help='Output directory (default: frontend/public/models/stk)')
    args = parser.parse_args()

    if args.list:
        print('\nConfigured Addon Tracks:')
        print('-' * 70)
        for tid, info in sorted(ADDON_TRACKS.items()):
            note = f' ({info["note"]})' if info.get('note') else ''
            print(f'  {tid:<25} {info["name"]:<30} [{info["type"]}]{note}')
        print(f'\nTotal: {len(ADDON_TRACKS)} tracks')
        return

    out_dir = Path(args.out)
    if not out_dir.exists():
        out_dir.mkdir(parents=True)

    if args.import_id:
        process_track(args.import_id, out_dir)
    elif args.import_all:
        results = {}
        for tid in ADDON_TRACKS:
            results[tid] = process_track(tid, out_dir)

        print(f'\n\n{"=" * 60}')
        print('IMPORT SUMMARY')
        print(f'{"=" * 60}')
        success = sum(1 for v in results.values() if v)
        failed = sum(1 for v in results.values() if not v)
        print(f'  Succeeded: {success}')
        print(f'  Failed:    {failed}')
        for tid, ok in results.items():
            status = 'OK' if ok else 'FAILED'
            print(f'    {tid:<25} [{status}]')
    else:
        parser.print_help()


if __name__ == '__main__':
    main()
