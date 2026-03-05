#!/usr/bin/env python3
"""Extract track.xml metadata (start positions, names, driveline) from the STK zip."""
import zipfile, xml.etree.ElementTree as ET, sys, json, struct, io
from pathlib import Path

ZIP = 'third_party/SuperTuxKart-1.5-win.zip'
ASSETS_PREFIX = 'SuperTuxKart-1.5-win/stk-assets/tracks/'

# The 18 tracks we already converted
CONVERTED_TRACKS = [
    'cocoa_temple', 'hacienda', 'minigolf', 'sandtrack', 'snowtuxpeak',
    'zengarden', 'lighthouse', 'olivermath', 'black_forest', 'xr591',
    'oasis', 'gran_paradiso_island', 'mines', 'snowmountain', 'abyss',
    'cornfield_crossing', 'volcano_island', 'ravenbridge_mansion',
]

zf = zipfile.ZipFile(ZIP, 'r')
nl = set(zf.namelist())

results = {}
for tid in CONVERTED_TRACKS:
    txml_path = f'{ASSETS_PREFIX}{tid}/track.xml'
    if txml_path not in nl:
        print(f'[MISS] {tid}: track.xml not found', file=sys.stderr)
        continue
    
    data = zf.read(txml_path)
    try:
        root = ET.fromstring(data.decode('utf-8', errors='replace'))
    except ET.ParseError as e:
        print(f'[ERR] {tid}: {e}', file=sys.stderr)
        continue

    name = root.get('name', tid)
    groups = root.get('groups', '')
    laps = int(root.get('default-number-of-laps', '3'))

    # Start position — STK uses these attributes on the <track> element
    sx = float(root.get('start-position-x') or root.get('start__position_x') or '0')
    sy = float(root.get('start-position-y') or root.get('start__position_y') or '3')
    sz = float(root.get('start-position-z') or root.get('start__position_z') or '0')

    # Look for <default-start-position x="..." y="..." z="..."> child element
    dsp = root.find('default-start-position')
    if dsp is not None:
        try:
            sx = float(dsp.get('x', sx))
            sy = float(dsp.get('y', sy))
            sz = float(dsp.get('z', sz))
        except (ValueError, TypeError):
            pass

    # Try <start> element
    start_el = root.find('start')
    if start_el is not None:
        try:
            sx = float(start_el.get('x', sx))
            sy = float(start_el.get('y', sy))
            sz = float(start_el.get('z', sz))
        except (ValueError, TypeError):
            pass

    # Estimate from driveline if start pos is still zero
    start_is_zero = (sx == 0 and sy == 0 and sz == 0)
    
    # Fall through to scene.xml for driveline-based start
    scene_path = f'{ASSETS_PREFIX}{tid}/scene.xml'
    if start_is_zero and scene_path in nl:
        scene_data = zf.read(scene_path)
        try:
            sroot = ET.fromstring(scene_data.decode('utf-8', errors='replace'))
            # Look for <ChecklineManager> or first waypoint
            for cm in sroot.iter('ChecklineManager'):
                for cl in cm:
                    if cl.tag in ('Checkline', 'checkline', 'check-line'):
                        p1 = cl.get('p1', '').split()
                        if len(p1) == 3:
                            sx, sy, sz = float(p1[0]), float(p1[1]) + 3, float(p1[2])
                            break
        except ET.ParseError:
            pass

    results[tid] = {
        'name': name,
        'groups': groups,
        'laps': laps,
        'start': {'x': round(sx, 3), 'y': round(sy + 3, 3), 'z': round(sz, 3)},
    }
    print(f'{tid}: name={name!r}  start=({sx:.2f},{sy:.2f},{sz:.2f})  laps={laps}  groups={groups!r}')

zf.close()
print('\n--- JSON output ---')
print(json.dumps(results, indent=2))
