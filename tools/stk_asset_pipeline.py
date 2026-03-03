#!/usr/bin/env python3
"""
STK asset pipeline: extract selected tracks/karts/arenas from stk-win.zip,
convert SPM files to GLB, embed textures, produce manifest.json.

Usage:
    python stk_asset_pipeline.py --zip=<path/to/SuperTuxKart-1.5-win.zip>
                                  --out=<frontend/public/models/stk>
                                  [--manifest=<path/to/manifest.json>]
                                  [--profile=lite|balanced|full]

Curated asset selection (avoids bloat):
  KARTS (8 balanced, 16 full): tux, sara_the_racer, adiumy, nolok,
         gnome, wilber, xue, hexley, emule, kiki, beastie, gavroche,
         amanda, suzanne, konqi, pepper
  TRACKS (6 lite, 12 balanced, all in full):
         cocoa_temple, hacienda, minigolf, zengarden, lasdunaspista,
         sandtrack, snowtuxpeak, lighthouse, greenvalley, olivermath,
         black_forest, XR591
  ARENAS (2 lite, 4 balanced, all in full):
         battleIsland, citadel, snowtuxpeak_battle, farm
"""

import argparse, json, os, struct, sys, zipfile
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# ── Curated selections ──────────────────────────────────────────────────────
KARTS_CURATED = [
    # id,               display name,            profile (min to include)
    ('tux',             'Tux',                   'lite'),
    ('adiumy',          'Adiumy',                'lite'),
    ('nolok',           'Nolok',                 'lite'),
    ('wilber',          'Wilber',                'lite'),
    ('xue',             'Xue',                   'lite'),
    ('hexley',          'Hexley',                'lite'),
    ('gavroche',        'Gavroche',              'balanced'),
    ('emule',           'Emule',                 'balanced'),
    ('kiki',            'Kiki',                  'balanced'),
    ('beastie',         'Godette',               'balanced'),
    ('amanda',          'Amanda',                'balanced'),
    ('suzanne',         'Suzanne',               'balanced'),
    ('gnu',             'Gnu',                   'full'),
    ('konqi',           'Konqi',                 'full'),
    ('sara_the_racer',  'Pepper',                'full'),
    ('sara_the_wizard', 'Sara',                  'full'),
    ('puffy',           'Puffy',                 'full'),
    ('pidgin',          'Pidgin',                'full'),
]

TRACKS_CURATED = [
    # id,                    display name,               profile
    ('cocoa_temple',         'Cocoa Temple',             'lite'),
    ('hacienda',             'Hacienda',                 'lite'),
    ('minigolf',             'Mini Golf',                'lite'),
    ('sandtrack',            'Sand Track',               'lite'),
    ('snowtuxpeak',          'Snow Tux Peak',            'lite'),
    ('zengarden',            'Zen Garden',               'lite'),
    ('lighthouse',           'Lighthouse',               'balanced'),
    ('olivermath',           "Oliver's Math Class",      'balanced'),
    ('black_forest',         'Black Forest',             'balanced'),
    ('xr591',                'XR591',                    'balanced'),
    ('oasis',                'Oasis',                    'balanced'),
    ('gran_paradiso_island', 'Gran Paradiso Island',     'balanced'),
    ('mines',                'Mines',                    'full'),
    ('snowmountain',         'Snow Mountain',            'full'),
    ('abyss',                'Abyss',                    'full'),
    ('cornfield_crossing',   'Cornfield Crossing',       'full'),
    ('volcano_island',       'Volcano Island',           'full'),
    ('ravenbridge_mansion',  'Ravenbridge Mansion',      'full'),
]

ARENAS_CURATED = [
    # id,                        display name,                  profile
    ('battleisland',             'Battle Island',               'lite'),
    ('lasdunasarena',            'Las Dunas Arena',             'lite'),
    ('cave',                     'Cave X',                      'balanced'),
    ('pumpkin_park',             'Pumpkin Park',                'balanced'),
    ('arena_candela_city',       'Candela City',                'full'),
    ('ancient_colosseum_labyrinth', 'Ancient Colosseum',        'full'),
    ('stadium',                  'The Stadium',                 'full'),
    ('alien_signal',             'Alien Signal',                'full'),
    ('temple',                   'Temple',                      'full'),
]

PROFILES = ['lite', 'balanced', 'full']

def profile_index(p: str) -> int:
    return PROFILES.index(p) if p in PROFILES else 2

# ── SPM Reader ──────────────────────────────────────────────────────────────
SPM_VERSION = 1

def half_float(b: bytes) -> float:
    return struct.unpack('<e', b)[0]

def parse_spm(data: bytes, tex_dir: Path) -> list[dict]:
    """Parse SPM bytes -> list of mesh dicts."""
    f = __import__('io').BytesIO(data)

    hdr = f.read(2)
    if hdr != b'SP':
        raise ValueError('Not an SPM file')

    b = struct.unpack('<B', f.read(1))[0]
    version = b >> 3
    if version != SPM_VERSION:
        raise ValueError(f'Unsupported SPM version {version}')

    b &= ~0x08
    spm_type = ['SPMS', 'SPMA', 'SPMN'][b] if b < 3 else 'SPMN'

    flags = struct.unpack('<B', f.read(1))[0]
    read_normal  = bool(flags & 0x01)
    read_vcolor  = bool((flags >> 1) & 0x01)
    read_tangent = bool((flags >> 2) & 0x01)
    is_skinned   = (spm_type == 'SPMA')

    f.read(24)  # bounding box
    mat_count = struct.unpack('<H', f.read(2))[0]
    materials = []
    for _ in range(mat_count):
        sz = struct.unpack('<B', f.read(1))[0]
        t1 = f.read(sz).decode('ascii', errors='replace') if sz else ''
        sz = struct.unpack('<B', f.read(1))[0]
        t2 = f.read(sz).decode('ascii', errors='replace') if sz else ''
        materials.append({'tex1': t1, 'tex2': t2})

    sector_count = struct.unpack('<H', f.read(2))[0]
    meshes = []

    for _ in range(sector_count):
        sec_mat_c = struct.unpack('<H', f.read(2))[0]
        for _ in range(sec_mat_c):
            vc = struct.unpack('<I', f.read(4))[0]
            ic = struct.unpack('<i', f.read(4))[0]
            mid = struct.unpack('<H', f.read(2))[0]
            mat = materials[mid] if mid < len(materials) else {'tex1': '', 'tex2': ''}

            uv_one = bool(mat['tex1'])
            uv_two = bool(mat['tex2'])
            idx_size = 4 if vc > 65535 else 2 if vc > 255 else 1

            positions, uvs, colors = [], [], []

            for _ in range(vc):
                x, y, z = struct.unpack('<fff', f.read(12))
                positions.append((x, y, z))
                if read_normal:
                    f.read(4)
                if read_vcolor:
                    ci = struct.unpack('<B', f.read(1))[0]
                    if ci == 128:
                        colors.append((1.0, 1.0, 1.0, 1.0))
                    else:
                        r, g, b2 = struct.unpack('<BBB', f.read(3))
                        colors.append((r/255, g/255, b2/255, 1.0))
                if uv_one:
                    u = half_float(f.read(2))
                    v = 1.0 - half_float(f.read(2))
                    uvs.append((u, v))
                    if uv_two:
                        f.read(4)  # skip second UV
                    if read_tangent:
                        f.read(4)
                if is_skinned:
                    f.read(16)

            if idx_size == 4:
                indices = list(struct.unpack(f'<{ic}I', f.read(ic * 4)))
            elif idx_size == 2:
                indices = list(struct.unpack(f'<{ic}H', f.read(ic * 2)))
            else:
                indices = list(struct.unpack(f'<{ic}B', f.read(ic)))

            meshes.append({
                'positions': positions,
                'uvs': uvs,
                'colors': colors,
                'indices': indices,
                'tex1': mat['tex1'],
            })

        if spm_type == 'SPMS':
            f.read(24)

    return meshes

# ── GLB Builder ──────────────────────────────────────────────────────────────
def build_glb(meshes: list, tex_lut: dict) -> bytes:
    bin_data = bytearray()
    accessors, buffer_views, gltf_meshes = [], [], []
    images, textures, materials = [], [], []
    tex_cache = {}

    ARRAY_BUFFER   = 34962
    ELEMENT_BUFFER = 34963
    FLOAT, U16, U32 = 5126, 5123, 5125

    def add_bv(data: bytes, target=None) -> int:
        off = len(bin_data)
        bin_data.extend(data)
        while len(bin_data) % 4: bin_data.append(0)
        bv = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
        if target: bv['target'] = target
        buffer_views.append(bv)
        return len(buffer_views) - 1

    def add_acc(bv, count, ct, atype, mn=None, mx=None) -> int:
        a = {'bufferView': bv, 'componentType': ct, 'count': count, 'type': atype}
        if mn is not None: a['min'] = mn; a['max'] = mx
        accessors.append(a)
        return len(accessors) - 1

    def get_mat(tex_name: str):
        if not tex_name or tex_name not in tex_lut:
            return None
        if tex_name in tex_cache:
            return tex_cache[tex_name]
        tex_data, mime = tex_lut[tex_name]
        bv = add_bv(tex_data)
        img_i = len(images)
        images.append({'bufferView': bv, 'mimeType': mime})
        tex_i = len(textures)
        textures.append({'source': img_i, 'sampler': 0})
        mat_i = len(materials)
        materials.append({
            'name': tex_name,
            'pbrMetallicRoughness': {
                'baseColorTexture': {'index': tex_i},
                'metallicFactor': 0.0,
                'roughnessFactor': 1.0,
            }
        })
        tex_cache[tex_name] = mat_i
        return mat_i

    def pf(*v): return struct.pack(f'<{len(v)}f', *v)
    def pu16(v): return struct.pack(f'<{len(v)}H', *v)
    def pu32(v): return struct.pack(f'<{len(v)}I', *v)

    for mi, m in enumerate(meshes):
        pos = m['positions']
        flat_p = b''.join(pf(*v) for v in pos)
        mn = [min(v[i] for v in pos) for i in range(3)]
        mx = [max(v[i] for v in pos) for i in range(3)]
        bv_p = add_bv(flat_p, ARRAY_BUFFER)
        acc_p = add_acc(bv_p, len(pos), FLOAT, 'VEC3', mn, mx)
        attrs = {'POSITION': acc_p}

        if m['uvs']:
            flat_uv = b''.join(pf(*v) for v in m['uvs'])
            attrs['TEXCOORD_0'] = add_acc(add_bv(flat_uv, ARRAY_BUFFER), len(m['uvs']), FLOAT, 'VEC2')

        if m['colors']:
            flat_c = b''.join(pf(*v) for v in m['colors'])
            attrs['COLOR_0'] = add_acc(add_bv(flat_c, ARRAY_BUFFER), len(m['colors']), FLOAT, 'VEC4')

        idx = m['indices']
        if any(i > 65535 for i in idx):
            bv_i = add_bv(pu32(idx), ELEMENT_BUFFER)
            acc_i = add_acc(bv_i, len(idx), U32, 'SCALAR')
        else:
            bv_i = add_bv(pu16(idx), ELEMENT_BUFFER)
            acc_i = add_acc(bv_i, len(idx), U16, 'SCALAR')

        prim = {'attributes': attrs, 'indices': acc_i, 'mode': 4}
        mat_i = get_mat(m['tex1'])
        if mat_i is not None: prim['material'] = mat_i
        gltf_meshes.append({'name': f'mesh_{mi}', 'primitives': [prim]})

    nodes = [{'mesh': i} for i in range(len(gltf_meshes))]
    gltf = {
        'asset': {'version': '2.0', 'generator': 'stk-asset-pipeline'},
        'scene': 0,
        'scenes': [{'nodes': list(range(len(nodes)))}],
        'nodes': nodes,
        'meshes': gltf_meshes,
        'accessors': accessors,
        'bufferViews': buffer_views,
        'buffers': [{'byteLength': len(bin_data)}],
        'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}],
    }
    if images:   gltf['images'] = images
    if textures: gltf['textures'] = textures
    if materials: gltf['materials'] = materials

    jb = json.dumps(gltf, separators=(',', ':')).encode()
    while len(jb) % 4: jb += b' '
    bb = bytes(bin_data)
    while len(bb) % 4: bb += b'\x00'

    def ch(magic, d): return struct.pack('<II', len(d), magic) + d
    jc = ch(0x4E4F534A, jb)
    bc = ch(0x004E4942, bb)
    total = 12 + len(jc) + len(bc)
    return struct.pack('<III', 0x46546C67, 2, total) + jc + bc


# ── Zip Extractor & Converter ────────────────────────────────────────────────
def find_in_zip(zf: zipfile.ZipFile, namelist: list, patterns: list[str]) -> str | None:
    """Return first zip entry path matching any of the given suffix patterns."""
    for p in patterns:
        p_lower = p.lower()
        for n in namelist:
            if n.lower().endswith(p_lower):
                return n
    return None

def load_textures_from_zip(zf: zipfile.ZipFile, namelist: list, prefix: str) -> dict:
    """Load all PNG/JPEG files under zip prefix into {basename: (bytes, mime)} dict."""
    lut = {}
    for n in namelist:
        nl = n.lower()
        if not nl.startswith(prefix.lower()):
            continue
        if nl.endswith('.png') or nl.endswith('.jpg') or nl.endswith('.jpeg'):
            bname = Path(n).name
            if bname not in lut:
                with zf.open(n) as fh:
                    data = fh.read()
                mime = 'image/jpeg' if nl.endswith(('.jpg', '.jpeg')) else 'image/png'
                lut[bname] = (data, mime)
    return lut

def convert_spm_from_zip(zf: zipfile.ZipFile, namelist: list,
                          spm_path: str, tex_lut: dict) -> bytes | None:
    """Read SPM from zip, convert to GLB bytes."""
    try:
        with zf.open(spm_path) as fh:
            spm_data = fh.read()
        meshes = parse_spm(spm_data, None)
        if not meshes:
            return None
        return build_glb(meshes, tex_lut)
    except Exception as e:
        print(f'  [WARN] {spm_path}: {e}')
        return None


def get_spm_prefix_from_zip(namelist: list) -> str:
    """Detect data root prefix inside the zip (e.g. 'SuperTuxKart-1.5-win/stk-code/')."""
    for n in namelist:
        if '/data/karts/' in n:
            idx = n.find('/data/karts/')
            return n[:idx + 1]  # include trailing slash, exclude 'data'
    return ''


def process_category(zf, namelist, zip_prefix, category, items, out_root, profile_filter, is_arena=False):
    """Convert selected karts or tracks from zip to GLB."""
    results = []
    prof_limit = profile_index(profile_filter)

    for item_id, display_name, item_profile in items:
        if profile_index(item_profile) > prof_limit:
            continue

        if category == 'karts':
            dir_prefix = f'{zip_prefix}data/karts/{item_id}/'
        else:
            dir_prefix = f'{zip_prefix}data/tracks/{item_id}/'

        # Check directory exists in zip
        dir_entries = [n for n in namelist if n.startswith(dir_prefix)]
        if not dir_entries:
            print(f'  [SKIP] {item_id}: not found in zip at {dir_prefix}')
            continue

        tex_lut = load_textures_from_zip(zf, namelist, dir_prefix)

        # Find primary SPM
        spm_candidates = [n for n in dir_entries if n.lower().endswith('.spm')]
        if not spm_candidates:
            print(f'  [SKIP] {item_id}: no .spm files')
            continue

        # Prefer main kart/track/arena model
        def priority_key(p):
            bn = Path(p).name.lower()
            if category == 'karts':
                if item_id.lower() in bn: return 0
                if 'kart' in bn: return 1
            else:
                if 'track' in bn: return 0
                if 'arena' in bn: return 1
                if item_id.lower() in bn: return 2
                if 'scene' in bn: return 3
            return 10
        spm_candidates.sort(key=lambda p: (priority_key(p), len(p)))

        # Combine all meshes from all SPM files for this asset (for tracks)
        combined_meshes = []
        for spm_path in spm_candidates[:5]:  # limit to 5 spm files per asset
            try:
                with zf.open(spm_path) as fh:
                    spm_data = fh.read()
                meshes = parse_spm(spm_data, None)
                combined_meshes.extend(meshes)
            except Exception as e:
                pass  # skip bad SPMs

        if not combined_meshes:
            print(f'  [SKIP] {item_id}: no valid meshes')
            continue

        glb_data = build_glb(combined_meshes, tex_lut)

        if category == 'karts':
            out_dir = out_root / 'karts' / item_id
            glb_name = 'kart.glb'
        elif is_arena:
            out_dir = out_root / 'arenas' / item_id
            glb_name = 'arena.glb'
        else:
            out_dir = out_root / 'tracks' / item_id
            glb_name = 'track.glb'

        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / glb_name
        out_path.write_bytes(glb_data)

        size_kb = len(glb_data) // 1024
        print(f'  [OK] {item_id} -> {glb_name} ({size_kb:,} KB, {len(combined_meshes)} meshes)')
        results.append({
            'id': item_id,
            'name': display_name,
            'sizeBytes': len(glb_data),
            'profile': item_profile,
        })

    return results


def build_manifest(karts, tracks, arenas):
    def by_profile(items, prof):
        pi = profile_index(prof)
        return [i['id'] for i in items if profile_index(i['profile']) <= pi]

    return {
        'version': '1.5',
        'generated': __import__('datetime').datetime.utcnow().isoformat() + 'Z',
        'karts': [{'id': i['id'], 'name': i['name'], 'sizeBytes': i['sizeBytes']} for i in karts],
        'tracks': [{'id': i['id'], 'name': i['name'], 'sizeBytes': i['sizeBytes']} for i in tracks],
        'arenas': [{'id': i['id'], 'name': i['name'], 'sizeBytes': i['sizeBytes']} for i in arenas],
        'profiles': {
            'lite': {
                'karts':  by_profile(karts,  'lite'),
                'tracks': by_profile(tracks, 'lite'),
                'arenas': by_profile(arenas, 'lite'),
                'weaponSet': 'stk-lite',
            },
            'balanced': {
                'karts':  by_profile(karts,  'balanced'),
                'tracks': by_profile(tracks, 'balanced'),
                'arenas': by_profile(arenas, 'balanced'),
                'weaponSet': 'stk-classic',
            },
            'full': {
                'karts':  by_profile(karts,  'full'),
                'tracks': by_profile(tracks, 'full'),
                'arenas': by_profile(arenas, 'full'),
                'weaponSet': 'stk-classic',
            },
        }
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--zip',      required=True, help='Path to SuperTuxKart-1.5-win.zip')
    ap.add_argument('--out',      required=True, help='Output dir (e.g. frontend/public/models/stk)')
    ap.add_argument('--manifest', help='Path to write manifest.json (default: <out>/manifest.json)')
    ap.add_argument('--profile',  default='full', choices=PROFILES, help='Max profile to include')
    args = ap.parse_args()

    zip_path = Path(args.zip)
    out_root = Path(args.out)
    manifest_path = Path(args.manifest) if args.manifest else out_root / 'manifest.json'

    if not zip_path.exists():
        sys.exit(f'ERROR: {zip_path} not found')

    print(f'Opening {zip_path.name} ...')
    with zipfile.ZipFile(zip_path, 'r') as zf:
        namelist = zf.namelist()
        zip_prefix = get_spm_prefix_from_zip(namelist)
        print(f'Zip prefix: {repr(zip_prefix)}, total entries: {len(namelist):,}')

        print('\n── Karts ──')
        karts = process_category(zf, namelist, zip_prefix, 'karts', KARTS_CURATED, out_root, args.profile)

        print('\n── Tracks ──')
        tracks = process_category(zf, namelist, zip_prefix, 'tracks', TRACKS_CURATED, out_root, args.profile)

        print('\n── Arenas ──')
        arenas = process_category(zf, namelist, zip_prefix, 'tracks', ARENAS_CURATED, out_root, args.profile, is_arena=True)

    manifest = build_manifest(karts, tracks, arenas)
    out_root.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(f'\nManifest: {manifest_path}')
    print(f'Karts: {len(karts)}, Tracks: {len(tracks)}, Arenas: {len(arenas)}')
    total_mb = sum(i['sizeBytes'] for i in karts + tracks + arenas) / 1_000_000
    print(f'Total asset size: {total_mb:.1f} MB')


if __name__ == '__main__':
    main()
