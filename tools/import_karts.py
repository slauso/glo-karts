#!/usr/bin/env python3
"""
import_karts.py — Download, extract, and convert new STK addon karts to GLB.

Usage:
    py tools/import_karts.py                # Process all karts in NEW_KARTS
    py tools/import_karts.py --only carrot  # Process just one kart
    py tools/import_karts.py --list         # Show all karts and their status

Pipeline per kart:
  1. Download addon zip from online.supertuxkart.net
  2. Extract to tools/kart_staging/<id>/
  3. Detect model format (.b3d or .spm)
  4. Convert to GLB using b3d_to_glb.py or spm_to_glb.py
  5. Place kart.glb at frontend/public/models/stk/karts/<id>/kart.glb
"""

import argparse
import os
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

# Ensure we can import sibling converters
TOOLS_DIR = Path(__file__).parent
sys.path.insert(0, str(TOOLS_DIR))

from b3d_to_glb import convert_kart as b3d_convert_kart
from spm_to_glb import convert as spm_convert
from spm_to_glb import convert_kart as spm_convert_kart

try:
    import urllib.request
    HAS_URLLIB = True
except ImportError:
    HAS_URLLIB = False

# ── New karts to import ────────────────────────────────────────

NEW_KARTS = {
    'carrot': {
        'name': 'Carrot',
        'glo_name': 'Clover',
        'url': 'https://online.supertuxkart.net/dl/21272134026434077cdb536.zip',
        'weight': 'light',
    },
    'liz': {
        'name': 'Liz',
        'glo_name': 'Amelia',
        'url': 'https://online.supertuxkart.net/dl/1914186770690596090bf52.zip',
        'weight': 'medium',
    },
    'oem': {
        'name': 'OEM',
        'glo_name': 'Owen',
        'url': 'https://online.supertuxkart.net/dl/16643016366831e9138241e.zip',
        'weight': 'medium',
    },
    'mr_iceblock': {
        'name': 'Mr Iceblock',
        'glo_name': 'Frost',
        'url': 'https://online.supertuxkart.net/dl/213176325578fb1fbd6538.zip',
        'weight': 'heavy',
    },
    'minix': {
        'name': 'Minix',
        'glo_name': 'Max',
        'url': 'https://online.supertuxkart.net/dl/1242386400552d9e5a369ab.zip',
        'weight': 'light',
    },
    'pidgin_2020': {
        'name': 'Pidgin 2020 Edit',
        'glo_name': 'Perry',
        'url': 'https://online.supertuxkart.net/dl/1830254635ed8f9c9bdf65.zip',
        'weight': 'light',
    },
    'toots': {
        'name': 'Toots',
        'glo_name': 'Tina',
        'url': 'https://online.supertuxkart.net/dl/12708628296429fc6cd2521.zip',
        'weight': 'heavy',
    },
    'rx173': {
        'name': '173RX Mk2',
        'glo_name': 'michael',
        'url': 'https://online.supertuxkart.net/dl/13693307406444270ab9242.zip',
        'weight': 'medium',
    },
    'bea': {
        'name': 'Christi',
        'glo_name': 'Christi',
        'url': 'https://online.supertuxkart.net/dl/1615719541652457e80f197.zip',
        'weight': 'medium',
    },
    # ── Batch 2: 41 new addon karts ──
    'transmission': {
        'name': 'Transmission',
        'glo_name': 'Switch',
        'url': 'https://online.supertuxkart.net/dl/130392834456aba3ec52406.zip',
        'weight': 'medium',
    },
    'python': {
        'name': 'Python',
        'glo_name': 'Dave',
        'url': 'https://online.supertuxkart.net/dl/111813124355a018a557e64.zip',
        'weight': 'light',
    },
    'amazing_panda': {
        'name': 'Amazing Panda',
        'glo_name': 'Sharlene',
        'url': 'https://online.supertuxkart.net/dl/11680857915936d0fa75e72.zip',
        'weight': 'heavy',
    },
    'racehicle': {
        'name': 'Racehicle',
        'glo_name': 'Ron',
        'url': 'https://online.supertuxkart.net/dl/13437161925b8953563df9c.zip',
        'weight': 'medium',
    },
    'inky': {
        'name': 'Inky',
        'glo_name': 'Gail',
        'url': 'https://online.supertuxkart.net/dl/4233345835b3698de83bce.zip',
        'weight': 'light',
    },
    'mechatux': {
        'name': 'Mechatux',
        'glo_name': 'MJ',
        'url': 'https://online.supertuxkart.net/dl/280355243641f6d36a887f.zip',
        'weight': 'heavy',
    },
    'sepia': {
        'name': 'Sepia',
        'glo_name': 'Jason',
        'url': 'https://online.supertuxkart.net/dl/183206718864499961d9e76.zip',
        'weight': 'light',
    },
    'elephpant': {
        'name': 'Elephpant',
        'glo_name': 'Carrie',
        'url': 'https://online.supertuxkart.net/dl/7722911426445aa4f2299f.zip',
        'weight': 'heavy',
    },
    'ozom': {
        'name': 'Ozom',
        'glo_name': 'Bennett',
        'url': 'https://online.supertuxkart.net/dl/1629449964644c55fa54d60.zip',
        'weight': 'light',
    },
    'chibi': {
        'name': 'Chibi',
        'glo_name': 'Jimbo',
        'url': 'https://online.supertuxkart.net/dl/12632671526483df90d8e71.zip',
        'weight': 'light',
    },
    'p2000': {
        'name': 'P2000',
        'glo_name': 'Stephen',
        'url': 'https://online.supertuxkart.net/dl/82325594664bb9138dabbf.zip',
        'weight': 'light',
    },
    'cyberkart': {
        'name': 'Cyberkart',
        'glo_name': 'Peter',
        'url': 'https://online.supertuxkart.net/dl/1121281005667f2223737d1.zip',
        'weight': 'heavy',
    },
}

PROJECT_ROOT = TOOLS_DIR.parent
STAGING_DIR = TOOLS_DIR / 'kart_staging'
OUTPUT_DIR = PROJECT_ROOT / 'frontend' / 'public' / 'models' / 'stk' / 'karts'


def download_file(url, dest):
    """Download a file from url to dest path."""
    print(f'  Downloading {url} ...')
    if HAS_URLLIB:
        req = urllib.request.Request(url, headers={'User-Agent': 'GLO-Karts-Import/1.0'})
        with urllib.request.urlopen(req, timeout=60) as resp, open(dest, 'wb') as f:
            shutil.copyfileobj(resp, f)
    else:
        raise RuntimeError('urllib not available')
    size = os.path.getsize(dest)
    print(f'  Downloaded {size:,} bytes -> {dest.name}')
    return size


def extract_zip(zip_path, dest_dir):
    """Extract a zip, returning the effective root directory of the kart data."""
    with zipfile.ZipFile(zip_path, 'r') as zf:
        zf.extractall(dest_dir)

    # STK addon zips sometimes contain a subdirectory, sometimes not.
    # Find where kart.xml lives.
    for root, dirs, files in os.walk(dest_dir):
        if 'kart.xml' in files:
            return Path(root)

    # If no kart.xml, return dest_dir itself
    return dest_dir


def find_model_files(kart_dir):
    """Detect what model format the kart uses (.b3d or .spm)."""
    b3d_files = list(kart_dir.glob('*.b3d'))
    spm_files = list(kart_dir.glob('*.spm'))
    return b3d_files, spm_files


def convert_kart(kart_id, kart_dir, output_glb):
    """Convert a kart directory to GLB. Returns True on success."""
    b3d_files, spm_files = find_model_files(kart_dir)

    kart_xml = kart_dir / 'kart.xml'
    has_kart_xml = kart_xml.is_file()

    print(f'  Found: {len(b3d_files)} .b3d, {len(spm_files)} .spm, kart.xml={has_kart_xml}')

    output_glb.parent.mkdir(parents=True, exist_ok=True)

    if has_kart_xml and b3d_files:
        # Use the B3D kart converter (reads kart.xml for body + wheels)
        print(f'  Converting via B3D pipeline...')
        try:
            b3d_convert_kart(str(kart_dir), str(output_glb), no_wheels=False)
            return True
        except Exception as e:
            print(f'  B3D conversion failed: {e}')
            print(f'  Retrying without wheels...')
            try:
                b3d_convert_kart(str(kart_dir), str(output_glb), no_wheels=True)
                return True
            except Exception as e2:
                print(f'  B3D no-wheels also failed: {e2}')
                return False

    if spm_files:
        # Use SPM converter — prefer kart.xml-aware assembly for body + wheels
        if has_kart_xml:
            print(f'  Converting via SPM kart pipeline (body + wheels)...')
            try:
                spm_convert_kart(str(kart_dir), str(output_glb))
                return True
            except Exception as e:
                print(f'  SPM kart conversion failed: {e}')
                print(f'  Falling back to body-only conversion...')

        # Fallback: single SPM body-only conversion
        main_spm = None
        if has_kart_xml:
            import xml.etree.ElementTree as ET
            tree = ET.parse(str(kart_xml))
            root = tree.getroot()
            model_file = root.attrib.get('model-file', '')
            if model_file and (kart_dir / model_file).is_file():
                main_spm = kart_dir / model_file
        
        if not main_spm:
            # Pick the largest .spm as the body
            main_spm = max(spm_files, key=lambda f: f.stat().st_size)

        print(f'  Converting SPM (body only): {main_spm.name}')
        try:
            size, n_meshes = spm_convert(str(main_spm), str(output_glb), [str(kart_dir)])
            print(f'  -> {output_glb.name}: {size:,} bytes, {n_meshes} mesh(es)')
            return True
        except Exception as e:
            print(f'  SPM conversion failed: {e}')
            return False

    print(f'  ERROR: No convertible model files found in {kart_dir}')
    return False


def process_kart(kart_id, info):
    """Full pipeline for one kart: download, extract, convert."""
    print(f'\n{"="*60}')
    print(f'Processing: {info["name"]} (id={kart_id})')
    print(f'{"="*60}')

    output_glb = OUTPUT_DIR / kart_id / 'kart.glb'
    if output_glb.is_file():
        size = output_glb.stat().st_size
        print(f'  SKIP: Already exists ({size:,} bytes)')
        return True

    staging = STAGING_DIR / kart_id
    staging.mkdir(parents=True, exist_ok=True)

    # Step 1: Download
    zip_path = staging / f'{kart_id}.zip'
    if not zip_path.is_file():
        try:
            download_file(info['url'], zip_path)
        except Exception as e:
            print(f'  DOWNLOAD FAILED: {e}')
            return False
    else:
        print(f'  Using cached zip: {zip_path.name}')

    # Step 2: Extract
    extract_dir = staging / 'extracted'
    if extract_dir.is_dir():
        shutil.rmtree(extract_dir)
    extract_dir.mkdir(parents=True)

    try:
        kart_dir = extract_zip(zip_path, extract_dir)
        print(f'  Extracted to: {kart_dir}')
    except Exception as e:
        print(f'  EXTRACTION FAILED: {e}')
        return False

    # Step 3: Convert
    success = convert_kart(kart_id, kart_dir, output_glb)

    if success:
        print(f'  ✓ {kart_id} -> {output_glb}')
    else:
        print(f'  ✗ {kart_id} FAILED')

    return success


def list_karts():
    """Show all karts and their status."""
    print(f'\n{"ID":<16} {"Name":<20} {"GLO Name":<10} {"Weight":<8} {"Status"}')
    print('-' * 70)
    for kart_id, info in NEW_KARTS.items():
        output_glb = OUTPUT_DIR / kart_id / 'kart.glb'
        if output_glb.is_file():
            status = f'✓ ({output_glb.stat().st_size:,} bytes)'
        else:
            status = '— not converted'
        print(f'{kart_id:<16} {info["name"]:<20} {info["glo_name"]:<10} {info["weight"]:<8} {status}')


def main():
    parser = argparse.ArgumentParser(description='Import STK addon karts to GLO Karts')
    parser.add_argument('--only', help='Process only this kart ID')
    parser.add_argument('--list', action='store_true', help='List all karts and their status')
    args = parser.parse_args()

    if args.list:
        list_karts()
        return

    STAGING_DIR.mkdir(parents=True, exist_ok=True)

    if args.only:
        if args.only not in NEW_KARTS:
            print(f'Unknown kart ID: {args.only}')
            print(f'Available: {", ".join(NEW_KARTS.keys())}')
            sys.exit(1)
        ok = process_kart(args.only, NEW_KARTS[args.only])
        sys.exit(0 if ok else 1)

    results = {}
    for kart_id, info in NEW_KARTS.items():
        results[kart_id] = process_kart(kart_id, info)

    print(f'\n{"="*60}')
    print('SUMMARY')
    print(f'{"="*60}')
    success = sum(1 for v in results.values() if v)
    fail = sum(1 for v in results.values() if not v)
    for kart_id, ok in results.items():
        print(f'  {"✓" if ok else "✗"} {kart_id}')
    print(f'\n{success} succeeded, {fail} failed out of {len(results)} total')


if __name__ == '__main__':
    main()
