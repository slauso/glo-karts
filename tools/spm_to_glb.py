#!/usr/bin/env python3
"""
STK SPM -> GLB converter (standalone, no Blender required).

Usage:
    python spm_to_glb.py <input.spm> [output.glb] [--tex-dir=<path>]

Reads SPM v1 (static SPMS/SPMA/SPMN) and writes a GLB (glTF 2.0) file with:
  - Vertex positions
  - UV coordinates (first UV set embedded, second if present)
  - Vertex colors (if present)
  - Triangle indices
  - Material base-color textures (PNG/JPEG embedded)
"""

import struct, sys, os, io, json, base64, argparse
from pathlib import Path

SPM_VERSION = 1

def half_float(data: bytes) -> float:
    return struct.unpack('<e', data)[0]

def read_str(f, length: int) -> str:
    return f.read(length).decode('ascii', errors='replace')

def _le(fmt, data):
    return struct.unpack('<' + fmt, data)

def load_texture_bytes(name: str, search_dirs: list[str]) -> tuple[bytes, str]:
    for d in search_dirs:
        p = Path(d) / name
        if p.is_file():
            data = p.read_bytes()
            mime = 'image/png' if name.lower().endswith('.png') else 'image/jpeg'
            return data, mime
        # Also try recursive search one level deep
        for sub in Path(d).iterdir() if Path(d).is_dir() else []:
            if sub.is_dir():
                pp = sub / name
                if pp.is_file():
                    data = pp.read_bytes()
                    mime = 'image/png' if name.lower().endswith('.png') else 'image/jpeg'
                    return data, mime
    return None, None


def parse_spm(filepath: str, tex_search_dirs: list[str]):
    """Parse SPM binary and return mesh data dict."""
    with open(filepath, 'rb') as f:
        header = f.read(2)
        if header != b'SP':
            raise ValueError(f'{filepath}: not an SPM file')

        b = _le('B', f.read(1))[0]
        version = b >> 3
        if version != SPM_VERSION:
            raise ValueError(f'{filepath}: unsupported SPM version {version}')

        b &= ~0x08
        spm_type = ['SPMS', 'SPMA', 'SPMN'][b] if b < 3 else 'SPMN'

        flags = _le('B', f.read(1))[0]
        read_normal  = bool(flags & 0x01)
        read_vcolor  = bool((flags >> 1) & 0x01)
        read_tangent = bool((flags >> 2) & 0x01)
        is_skinned   = spm_type == 'SPMA'

        f.read(24)  # bounding box, unused
        mat_count = _le('H', f.read(2))[0]
        materials = []
        for _ in range(mat_count):
            sz = _le('B', f.read(1))[0]
            tex1 = read_str(f, sz) if sz > 0 else ''
            sz = _le('B', f.read(1))[0]
            tex2 = read_str(f, sz) if sz > 0 else ''
            materials.append({'tex1': tex1, 'tex2': tex2})

        sector_count = _le('H', f.read(2))[0]
        meshes = []

        for _ in range(sector_count):
            sec_mat_count = _le('H', f.read(2))[0]
            for _ in range(sec_mat_count):
                vc = _le('I', f.read(4))[0]  # vertices count
                ic = _le('i', f.read(4))[0]  # indices count
                mid = _le('H', f.read(2))[0]  # material id
                assert mid < mat_count

                uv_one = bool(materials[mid]['tex1'])
                uv_two = bool(materials[mid]['tex2'])

                idx_size = 4 if vc > 65535 else 2 if vc > 255 else 1

                positions = []
                uvs = []
                uvs2 = []
                colors = []

                for _ in range(vc):
                    x, y, z = _le('fff', f.read(12))
                    positions.append((x, y, z))

                    if read_normal:
                        f.read(4)
                    if read_vcolor:
                        ci = _le('B', f.read(1))[0]
                        if ci == 128:
                            colors.append((1.0, 1.0, 1.0, 1.0))
                        else:
                            r, g, b = _le('BBB', f.read(3))
                            colors.append((r/255, g/255, b/255, 1.0))
                    if uv_one:
                        u = half_float(f.read(2))
                        v = 1.0 - half_float(f.read(2))
                        uvs.append((u, v))
                        if uv_two:
                            u2 = half_float(f.read(2))
                            v2 = 1.0 - half_float(f.read(2))
                            uvs2.append((u2, v2))
                        if read_tangent:
                            f.read(4)
                    if is_skinned:
                        f.read(16)

                if idx_size == 4:
                    indices = list(_le(f'{ic}I', f.read(ic * 4)))
                elif idx_size == 2:
                    indices = list(_le(f'{ic}H', f.read(ic * 2)))
                else:
                    indices = list(_le(f'{ic}B', f.read(ic)))

                meshes.append({
                    'positions': positions,
                    'uvs': uvs,
                    'uvs2': uvs2,
                    'colors': colors,
                    'indices': indices,
                    'material': materials[mid],
                })

            if spm_type == 'SPMS':
                f.read(24)  # reserved

    return meshes


def pack_f32(values):
    return struct.pack(f'<{len(values)}f', *values)

def pack_u16(values):
    return struct.pack(f'<{len(values)}H', *values)

def pack_u32(values):
    return struct.pack(f'<{len(values)}I', *values)


def build_glb(meshes: list, tex_dirs: list[str]) -> bytes:
    """Build GLB binary from parsed mesh list."""

    bin_data = bytearray()     # combined binary buffer
    accessors = []
    buffer_views = []
    gltf_meshes = []
    images = []
    textures = []
    materials = []
    tex_cache = {}  # tex_name -> image index

    def add_buffer_view(data: bytes, target=None) -> int:
        offset = len(bin_data)
        bin_data.extend(data)
        # Align to 4 bytes
        while len(bin_data) % 4 != 0:
            bin_data.append(0x00)
        bv = {'buffer': 0, 'byteOffset': offset, 'byteLength': len(data)}
        if target:
            bv['target'] = target
        buffer_views.append(bv)
        return len(buffer_views) - 1

    def add_accessor(bv_idx, count, comp_type, atype, min_v=None, max_v=None) -> int:
        acc = {
            'bufferView': bv_idx,
            'componentType': comp_type,  # 5126=f32, 5123=u16, 5125=u32
            'count': count,
            'type': atype,  # 'VEC3','VEC2','VEC4','SCALAR'
        }
        if min_v is not None:
            acc['min'] = min_v
            acc['max'] = max_v
        accessors.append(acc)
        return len(accessors) - 1

    def get_or_add_texture(tex_name: str, dirs: list[str]) -> int | None:
        if not tex_name:
            return None
        if tex_name in tex_cache:
            return tex_cache[tex_name]
        data, mime = load_texture_bytes(tex_name, dirs)
        if data is None:
            tex_cache[tex_name] = None
            return None
        img_idx = len(images)
        bv_idx = add_buffer_view(data)
        images.append({'bufferView': bv_idx, 'mimeType': mime, 'name': tex_name})
        tex_idx = len(textures)
        textures.append({'source': img_idx, 'sampler': 0})
        mat_idx = len(materials)
        mat = {
            'name': tex_name,
            'pbrMetallicRoughness': {
                'baseColorTexture': {'index': tex_idx},
                'metallicFactor': 0.0,
                'roughnessFactor': 1.0,
            },
            'doubleSided': False,
        }
        materials.append(mat)
        tex_cache[tex_name] = mat_idx
        return mat_idx

    ARRAY_BUFFER   = 34962
    ELEMENT_BUFFER = 34963
    FLOAT          = 5126
    U16            = 5123
    U32            = 5125

    for mesh_idx, m in enumerate(meshes):
        pos = m['positions']
        uvs = m['uvs']
        colors = m['colors']
        indices = m['indices']
        mat_info = m['material']

        primitives = []

        # positions
        flat_pos = [c for v in pos for c in v]
        min_x = min(v[0] for v in pos); max_x = max(v[0] for v in pos)
        min_y = min(v[1] for v in pos); max_y = max(v[1] for v in pos)
        min_z = min(v[2] for v in pos); max_z = max(v[2] for v in pos)
        bv_pos = add_buffer_view(pack_f32(flat_pos), ARRAY_BUFFER)
        acc_pos = add_accessor(bv_pos, len(pos), FLOAT, 'VEC3',
                               [min_x, min_y, min_z], [max_x, max_y, max_z])

        prim_attrs = {'POSITION': acc_pos}

        if uvs:
            flat_uv = [c for v in uvs for c in v]
            bv_uv = add_buffer_view(pack_f32(flat_uv), ARRAY_BUFFER)
            prim_attrs['TEXCOORD_0'] = add_accessor(bv_uv, len(uvs), FLOAT, 'VEC2')

        if colors:
            flat_col = [c for v in colors for c in v]
            bv_col = add_buffer_view(pack_f32(flat_col), ARRAY_BUFFER)
            prim_attrs['COLOR_0'] = add_accessor(bv_col, len(colors), FLOAT, 'VEC4')

        # indices
        use_u32 = any(i > 65535 for i in indices)
        if use_u32:
            bv_idx = add_buffer_view(pack_u32(indices), ELEMENT_BUFFER)
            acc_idx = add_accessor(bv_idx, len(indices), U32, 'SCALAR')
        else:
            bv_idx = add_buffer_view(pack_u16(indices), ELEMENT_BUFFER)
            acc_idx = add_accessor(bv_idx, len(indices), U16, 'SCALAR')

        mat_idx = get_or_add_texture(mat_info['tex1'], tex_dirs)

        prim = {
            'attributes': prim_attrs,
            'indices': acc_idx,
            'mode': 4,  # TRIANGLES
        }
        if mat_idx is not None:
            prim['material'] = mat_idx

        primitives.append(prim)

        gltf_meshes.append({'name': f'mesh_{mesh_idx}', 'primitives': primitives})

    # Build nodes - one node per mesh
    nodes = [{'mesh': i, 'name': f'node_{i}'} for i in range(len(gltf_meshes))]
    scene = {'nodes': list(range(len(nodes)))}

    gltf_json = {
        'asset': {'version': '2.0', 'generator': 'STK-spm-to-glb'},
        'scene': 0,
        'scenes': [scene],
        'nodes': nodes,
        'meshes': gltf_meshes,
        'accessors': accessors,
        'bufferViews': buffer_views,
        'buffers': [{'byteLength': len(bin_data)}],
        'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}],
    }
    if images:
        gltf_json['images'] = images
    if textures:
        gltf_json['textures'] = textures
    if materials:
        gltf_json['materials'] = materials

    json_bytes = json.dumps(gltf_json, separators=(',', ':')).encode('utf-8')
    # pad to 4 bytes
    while len(json_bytes) % 4:
        json_bytes += b' '
    bin_chunk = bytes(bin_data)
    while len(bin_chunk) % 4:
        bin_chunk += b'\x00'

    def chunk(magic: int, data: bytes) -> bytes:
        return struct.pack('<II', len(data), magic) + data

    json_chunk = chunk(0x4E4F534A, json_bytes)  # JSON
    bin_chunk_data = chunk(0x004E4942, bin_chunk)  # BIN
    total = 12 + len(json_chunk) + len(bin_chunk_data)
    glb_header = struct.pack('<III', 0x46546C67, 2, total)
    return glb_header + json_chunk + bin_chunk_data


def convert(spm_path: str, out_path: str, tex_dirs: list[str]):
    meshes = parse_spm(spm_path, tex_dirs)
    if not meshes:
        raise ValueError(f'No meshes found in {spm_path}')
    glb = build_glb(meshes, tex_dirs)
    Path(out_path).write_bytes(glb)
    return len(glb), len(meshes)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Convert STK .spm to .glb')
    parser.add_argument('input', help='Input .spm file')
    parser.add_argument('output', nargs='?', help='Output .glb file (default: same name)')
    parser.add_argument('--tex-dir', action='append', default=[], dest='tex_dirs',
                        help='Directory to search for textures (repeatable)')
    args = parser.parse_args()

    inp = Path(args.input)
    out = Path(args.output) if args.output else inp.with_suffix('.glb')
    tex_search = args.tex_dirs or [str(inp.parent)]

    try:
        size, num_meshes = convert(str(inp), str(out), tex_search)
        print(f'OK: {out.name} ({size:,} bytes, {num_meshes} mesh(es))')
    except Exception as e:
        print(f'ERROR: {e}', file=sys.stderr)
        sys.exit(1)
