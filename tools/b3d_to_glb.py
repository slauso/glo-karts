#!/usr/bin/env python3
"""
B3D (Blitz3D) -> GLB converter for STK karts.

Usage:
    python b3d_to_glb.py <kart_dir> <output.glb>

Reads kart.xml to find body + wheel B3D files, parses them,
merges into a single GLB with embedded textures.
"""

import math
import struct, sys, os, json, xml.etree.ElementTree as ET
from pathlib import Path


# ΓöÇΓöÇ B3D parser ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

def _read_int(f):
    return struct.unpack('<i', f.read(4))[0]

def _read_float(f):
    return struct.unpack('<f', f.read(4))[0]

def _read_str(f):
    chars = []
    while True:
        c = f.read(1)
        if c == b'\x00' or c == b'':
            break
        chars.append(c)
    return b''.join(chars).decode('latin-1', errors='replace')

def _read_chunk_header(f):
    tag_bytes = f.read(4)
    if len(tag_bytes) < 4:
        return None, 0
    tag = tag_bytes.decode('ascii', errors='replace')
    length = _read_int(f)
    return tag, length


def _identity_matrix():
    return [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]


def _mat_mul(a, b):
    result = [[0.0] * 4 for _ in range(4)]
    for row in range(4):
        for col in range(4):
            result[row][col] = sum(a[row][k] * b[k][col] for k in range(4))
    return result


def _normalize_quaternion(quat):
    x, y, z, w = quat
    length = math.sqrt(x * x + y * y + z * z + w * w)
    if length == 0.0:
        return (0.0, 0.0, 0.0, 1.0)
    inv = 1.0 / length
    return (x * inv, y * inv, z * inv, w * inv)


def _mat_translate(vec):
    mat = _identity_matrix()
    mat[0][3], mat[1][3], mat[2][3] = vec
    return mat


def _mat_scale(vec):
    sx, sy, sz = vec
    return [
        [sx, 0.0, 0.0, 0.0],
        [0.0, sy, 0.0, 0.0],
        [0.0, 0.0, sz, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]


def _mat_from_quaternion(quat):
    x, y, z, w = _normalize_quaternion(quat)
    xx = x * x
    yy = y * y
    zz = z * z
    xy = x * y
    xz = x * z
    yz = y * z
    wx = w * x
    wy = w * y
    wz = w * z
    return [
        [1.0 - 2.0 * (yy + zz), 2.0 * (xy - wz), 2.0 * (xz + wy), 0.0],
        [2.0 * (xy + wz), 1.0 - 2.0 * (xx + zz), 2.0 * (yz - wx), 0.0],
        [2.0 * (xz - wy), 2.0 * (yz + wx), 1.0 - 2.0 * (xx + yy), 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]


def _compose_matrix(loc, rot, scale):
    return _mat_mul(_mat_mul(_mat_translate(loc), _mat_from_quaternion(rot)), _mat_scale(scale))


def _transform_point(matrix, point):
    x, y, z = point
    return (
        matrix[0][0] * x + matrix[0][1] * y + matrix[0][2] * z + matrix[0][3],
        matrix[1][0] * x + matrix[1][1] * y + matrix[1][2] * z + matrix[1][3],
        matrix[2][0] * x + matrix[2][1] * y + matrix[2][2] * z + matrix[2][3],
    )


def _transform_direction(matrix, vector):
    x, y, z = vector
    return (
        matrix[0][0] * x + matrix[0][1] * y + matrix[0][2] * z,
        matrix[1][0] * x + matrix[1][1] * y + matrix[1][2] * z,
        matrix[2][0] * x + matrix[2][1] * y + matrix[2][2] * z,
    )


def _normalize_vec3(vec):
    x, y, z = vec
    length = math.sqrt(x * x + y * y + z * z)
    if length == 0.0:
        return (0.0, 1.0, 0.0)
    inv = 1.0 / length
    return (x * inv, y * inv, z * inv)


def parse_b3d(filepath):
    """Parse a B3D file and return list of mesh dicts."""
    meshes = []
    textures_list = []  # texture filenames from TEXS chunk
    brushes = []        # brush definitions from BRUS chunk

    with open(filepath, 'rb') as f:
        file_size = os.fstat(f.fileno()).st_size

        # Root chunk header
        tag, length = _read_chunk_header(f)
        if tag != 'BB3D':
            raise ValueError(f'{filepath}: not a B3D file (got {tag!r})')
        version = _read_int(f)

        end_pos = 8 + length  # end of root chunk data

        def parse_chunks(end):
            nonlocal textures_list, brushes
            while f.tell() < end:
                pos_before = f.tell()
                tag, length = _read_chunk_header(f)
                if tag is None:
                    break
                chunk_end = f.tell() + length

                if tag == 'TEXS':
                    parse_texs(chunk_end)
                elif tag == 'BRUS':
                    parse_brus(chunk_end)
                elif tag == 'NODE':
                    parse_node(chunk_end)
                else:
                    f.seek(chunk_end)

        def parse_texs(end):
            while f.tell() < end:
                name = _read_str(f)
                flags = _read_int(f)
                blend = _read_int(f)
                pos_x = _read_float(f)
                pos_y = _read_float(f)
                scl_x = _read_float(f)
                scl_y = _read_float(f)
                rot   = _read_float(f)
                textures_list.append(name)

        def parse_brus(end):
            n_texs = _read_int(f)  # textures per brush
            while f.tell() < end:
                name  = _read_str(f)
                red   = _read_float(f)
                green = _read_float(f)
                blue  = _read_float(f)
                alpha = _read_float(f)
                shine = _read_float(f)
                blend = _read_int(f)
                fx    = _read_int(f)
                tex_ids = []
                for _ in range(n_texs):
                    tex_ids.append(_read_int(f))
                brushes.append({
                    'name': name,
                    'color': (red, green, blue, alpha),
                    'tex_ids': tex_ids,
                })

        def parse_node(end, parent_transform=None):
            # Node header
            name  = _read_str(f)
            pos_x = _read_float(f)
            pos_y = _read_float(f)
            pos_z = _read_float(f)
            scl_x = _read_float(f)
            scl_y = _read_float(f)
            scl_z = _read_float(f)
            rot_w = _read_float(f)
            rot_x = _read_float(f)
            rot_y = _read_float(f)
            rot_z = _read_float(f)

            local_transform = _compose_matrix(
                (pos_x, pos_y, pos_z),
                (rot_x, rot_y, rot_z, rot_w),
                (scl_x, scl_y, scl_z),
            )
            node_transform = local_transform if parent_transform is None else _mat_mul(parent_transform, local_transform)

            # Parse sub-chunks
            while f.tell() < end:
                ctag, clength = _read_chunk_header(f)
                if ctag is None:
                    break
                cend = f.tell() + clength

                if ctag == 'MESH':
                    parse_mesh(cend, node_transform)
                elif ctag == 'NODE':
                    parse_node(cend, node_transform)
                elif ctag == 'BONE':
                    f.seek(cend)
                elif ctag == 'KEYS':
                    f.seek(cend)
                elif ctag == 'ANIM':
                    f.seek(cend)
                else:
                    f.seek(cend)

        def parse_mesh(end, node_transform):
            brush_id = _read_int(f)

            vertices = None
            tris_groups = []

            while f.tell() < end:
                ctag, clength = _read_chunk_header(f)
                if ctag is None:
                    break
                cend = f.tell() + clength

                if ctag == 'VRTS':
                    vertices = parse_vrts(cend, node_transform)
                elif ctag == 'TRIS':
                    tg = parse_tris(cend)
                    tris_groups.append(tg)
                else:
                    f.seek(cend)

            if vertices and tris_groups:
                for tg in tris_groups:
                    # Build per-triangle-group mesh
                    tri_brush = tg['brush_id']
                    indices = tg['indices']

                    tex_name = ''
                    base_color = (1.0, 1.0, 1.0, 1.0)
                    if tri_brush >= 0 and tri_brush < len(brushes):
                        br = brushes[tri_brush]
                        base_color = br.get('color', base_color)
                        for tid in br['tex_ids']:
                            if 0 <= tid < len(textures_list):
                                tex_name = textures_list[tid]
                                break

                    meshes.append({
                        'positions': vertices['positions'],
                        'normals': vertices.get('normals', []),
                        'uvs': vertices.get('uvs', []),
                        'colors': vertices.get('colors', []),
                        'indices': indices,
                        'material': {'tex1': tex_name, 'base_color': base_color},
                    })

        def parse_vrts(end, node_transform):
            flags     = _read_int(f)
            tex_sets  = _read_int(f)
            tex_size  = _read_int(f)  # components per tex coord (usually 2)

            has_normal = bool(flags & 1)
            has_color  = bool(flags & 2)

            positions = []
            normals   = []
            uvs       = []
            colors    = []

            while f.tell() < end:
                x = _read_float(f)
                y = _read_float(f)
                z = _read_float(f)
                positions.append(_transform_point(node_transform, (x, y, z)))

                if has_normal:
                    nx = _read_float(f)
                    ny = _read_float(f)
                    nz = _read_float(f)
                    normals.append(_normalize_vec3(_transform_direction(node_transform, (nx, ny, nz))))

                if has_color:
                    r = _read_float(f)
                    g = _read_float(f)
                    b = _read_float(f)
                    a = _read_float(f)
                    colors.append((r, g, b, a))

                for ts in range(tex_sets):
                    comps = []
                    for _ in range(tex_size):
                        comps.append(_read_float(f))
                    if ts == 0 and len(comps) >= 2:
                        # V-flip: B3D uses Irrlicht convention where V is inverted
                        uvs.append((comps[0], 1.0 - comps[1]))

            result = {'positions': positions}
            if normals:
                result['normals'] = normals
            if uvs:
                result['uvs'] = uvs
            if colors:
                result['colors'] = colors
            return result

        def parse_tris(end):
            brush_id = _read_int(f)
            indices = []
            while f.tell() < end:
                v0 = _read_int(f)
                v1 = _read_int(f)
                v2 = _read_int(f)
                indices.extend([v0, v1, v2])
            return {'brush_id': brush_id, 'indices': indices}

        parse_chunks(end_pos)

    return meshes


# ΓöÇΓöÇ GLB builder (mirrors spm_to_glb.py pattern) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

def pack_f32(values):
    return struct.pack(f'<{len(values)}f', *values)

def pack_u16(values):
    return struct.pack(f'<{len(values)}H', *values)

def pack_u32(values):
    return struct.pack(f'<{len(values)}I', *values)


def load_texture_bytes(name, search_dirs):
    candidates = []
    normalized = Path(name)
    candidates.append(normalized)
    if normalized.name != name:
        candidates.append(Path(normalized.name))
    for d in search_dirs:
        base_dir = Path(d)
        for candidate in candidates:
            p = base_dir / candidate
            if p.is_file():
                data = p.read_bytes()
                mime = 'image/png' if p.suffix.lower() == '.png' else 'image/jpeg'
                return data, mime
        if base_dir.is_dir():
            for candidate in candidates:
                for p in base_dir.rglob(candidate.name):
                    if p.is_file():
                        data = p.read_bytes()
                        mime = 'image/png' if p.suffix.lower() == '.png' else 'image/jpeg'
                        return data, mime
    return None, None


def build_glb(all_meshes, tex_dirs, offset_map=None, part_names=None, scale_x=1.0):
    """Build GLB binary. offset_map: {mesh_list_index: (ox,oy,oz)} for wheel positioning.
    part_names: {mesh_list_index: str} for naming parts (e.g. wheel meshes)."""
    bin_data = bytearray()
    accessors = []
    buffer_views = []
    gltf_meshes = []
    images = []
    textures = []
    materials = []
    tex_cache = {}
    color_mat_cache = {}

    ARRAY_BUFFER   = 34962
    ELEMENT_BUFFER = 34963
    FLOAT          = 5126
    U16            = 5123
    U32            = 5125

    def add_buffer_view(data, target=None):
        offset = len(bin_data)
        bin_data.extend(data)
        while len(bin_data) % 4 != 0:
            bin_data.append(0x00)
        bv = {'buffer': 0, 'byteOffset': offset, 'byteLength': len(data)}
        if target:
            bv['target'] = target
        buffer_views.append(bv)
        return len(buffer_views) - 1

    def add_accessor(bv_idx, count, comp_type, atype, min_v=None, max_v=None):
        acc = {
            'bufferView': bv_idx,
            'componentType': comp_type,
            'count': count,
            'type': atype,
        }
        if min_v is not None:
            acc['min'] = min_v
            acc['max'] = max_v
        accessors.append(acc)
        return len(accessors) - 1

    def get_or_add_texture(tex_name, dirs):
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
            'doubleSided': True,
        }
        materials.append(mat)
        tex_cache[tex_name] = mat_idx
        return mat_idx

    def get_or_add_color_material(color):
        rgba = tuple(float(component) for component in color)
        if rgba in color_mat_cache:
            return color_mat_cache[rgba]
        mat_idx = len(materials)
        materials.append({
            'name': f'color_{mat_idx}',
            'pbrMetallicRoughness': {
                'baseColorFactor': list(rgba),
                'metallicFactor': 0.0,
                'roughnessFactor': 1.0,
            },
            'doubleSided': True,
        })
        color_mat_cache[rgba] = mat_idx
        return mat_idx

    # Track per-gltf-mesh which part it belongs to (for node translation)
    mesh_part_map = {}  # gltf_mesh_index -> part_idx

    global_mesh_idx = 0
    for part_idx, part_meshes in enumerate(all_meshes):
        part_label = (part_names or {}).get(part_idx, f'part_{part_idx}')

        for local_idx, m in enumerate(part_meshes):
            pos = m['positions']
            normals = m.get('normals', [])
            uvs = m.get('uvs', [])
            indices = m['indices']
            mat_info = m['material']

            # Apply X scale
            if scale_x != 1.0:
                pos = [(x * scale_x, y, z) for x, y, z in pos]

            if not pos or not indices:
                continue

            # positions
            flat_pos = [c for v in pos for c in v]
            min_x = min(v[0] for v in pos); max_x = max(v[0] for v in pos)
            min_y = min(v[1] for v in pos); max_y = max(v[1] for v in pos)
            min_z = min(v[2] for v in pos); max_z = max(v[2] for v in pos)
            bv_pos = add_buffer_view(pack_f32(flat_pos), ARRAY_BUFFER)
            acc_pos = add_accessor(bv_pos, len(pos), FLOAT, 'VEC3',
                                   [min_x, min_y, min_z], [max_x, max_y, max_z])

            prim_attrs = {'POSITION': acc_pos}

            if normals and len(normals) == len(pos):
                flat_normals = [c for v in normals for c in _normalize_vec3(v)]
                bv_norm = add_buffer_view(pack_f32(flat_normals), ARRAY_BUFFER)
                prim_attrs['NORMAL'] = add_accessor(bv_norm, len(normals), FLOAT, 'VEC3')

            if uvs:
                flat_uv = [c for v in uvs for c in v]
                bv_uv = add_buffer_view(pack_f32(flat_uv), ARRAY_BUFFER)
                prim_attrs['TEXCOORD_0'] = add_accessor(bv_uv, len(uvs), FLOAT, 'VEC2')

            # indices
            use_u32 = any(i > 65535 for i in indices)
            if use_u32:
                bv_idx = add_buffer_view(pack_u32(indices), ELEMENT_BUFFER)
                acc_idx = add_accessor(bv_idx, len(indices), U32, 'SCALAR')
            else:
                bv_idx = add_buffer_view(pack_u16(indices), ELEMENT_BUFFER)
                acc_idx = add_accessor(bv_idx, len(indices), U16, 'SCALAR')

            mat_idx = get_or_add_texture(mat_info.get('tex1', ''), tex_dirs)
            if mat_idx is None:
                mat_idx = get_or_add_color_material(mat_info.get('base_color', (1.0, 1.0, 1.0, 1.0)))

            prim = {
                'attributes': prim_attrs,
                'indices': acc_idx,
                'mode': 4,
            }
            prim['material'] = mat_idx

            mesh_name = f'{part_label}_{local_idx}'
            mesh_part_map[len(gltf_meshes)] = part_idx
            gltf_meshes.append({'name': mesh_name, 'primitives': [prim]})
            global_mesh_idx += 1

    # Build nodes: wheel parts get a parent node with translation so they
    # rotate around their own center instead of the world origin.
    nodes = []
    scene_node_indices = []
    from collections import defaultdict
    part_mesh_indices = defaultdict(list)
    for mi, pi in mesh_part_map.items():
        part_mesh_indices[pi].append(mi)

    for pi in sorted(part_mesh_indices.keys()):
        mis = part_mesh_indices[pi]
        ox, oy, oz = (0, 0, 0)
        if offset_map and pi in offset_map:
            ox, oy, oz = offset_map[pi]
        has_offset = (ox != 0 or oy != 0 or oz != 0)

        if has_offset and len(mis) > 0:
            # Create child mesh nodes (no translation)
            child_node_indices = []
            for mi in mis:
                nidx = len(nodes)
                nodes.append({'mesh': mi, 'name': gltf_meshes[mi]['name']})
                child_node_indices.append(nidx)
            # Create parent node with translation, children are the mesh nodes
            parent_name = (part_names or {}).get(pi, f'part_{pi}')
            parent_idx = len(nodes)
            parent_node = {'name': parent_name, 'children': child_node_indices,
                           'translation': [ox, oy, oz]}
            nodes.append(parent_node)
            scene_node_indices.append(parent_idx)
        else:
            # Body or zero-offset: flat nodes at scene root
            for mi in mis:
                nidx = len(nodes)
                nodes.append({'mesh': mi, 'name': gltf_meshes[mi]['name']})
                scene_node_indices.append(nidx)

    scene = {'nodes': scene_node_indices}

    gltf_json = {
        'asset': {'version': '2.0', 'generator': 'STK-b3d-to-glb'},
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
    while len(json_bytes) % 4:
        json_bytes += b' '
    bin_chunk = bytes(bin_data)
    while len(bin_chunk) % 4:
        bin_chunk += b'\x00'

    def chunk(magic, data):
        return struct.pack('<II', len(data), magic) + data

    json_chunk = chunk(0x4E4F534A, json_bytes)
    bin_chunk_data = chunk(0x004E4942, bin_chunk)
    total = 12 + len(json_chunk) + len(bin_chunk_data)
    glb_header = struct.pack('<III', 0x46546C67, 2, total)
    return glb_header + json_chunk + bin_chunk_data


def convert_kart(kart_dir, output_path, scale_x=1.0, no_wheels=False):
    """Read kart.xml, parse body + wheels, produce combined GLB."""
    kart_dir = Path(kart_dir)
    kart_xml_path = kart_dir / 'kart.xml'

    if not kart_xml_path.is_file():
        raise FileNotFoundError(f'No kart.xml in {kart_dir}')

    tree = ET.parse(str(kart_xml_path))
    root = tree.getroot()

    body_file = root.attrib.get('model-file', '')
    if not body_file:
        raise ValueError('No model-file in kart.xml')

    # Parse body
    body_path = kart_dir / body_file
    print(f'  Parsing body: {body_file}')
    body_meshes = parse_b3d(str(body_path))
    print(f'    -> {len(body_meshes)} mesh group(s), '
          f'{sum(len(m["positions"]) for m in body_meshes)} verts')

    # Strip baked-in wheel meshes from body when separate wheel files exist.
    # B3D karts often embed 4 small identical wheel groups at origin; detect them
    # by finding trailing groups with identical low vertex counts.
    wheels_el = root.find('wheels')
    has_separate_wheels = (wheels_el is not None
                          and any(wheels_el.find(t) is not None
                                 for t in ['front-left','front-right','rear-left','rear-right']))
    if has_separate_wheels and len(body_meshes) > 2:
        # Check if the last 4 groups are small + same size (likely baked wheels)
        tail = body_meshes[-4:]
        tail_counts = [len(m['positions']) for m in tail]
        main_max = max(len(m['positions']) for m in body_meshes[:-4]) if len(body_meshes) > 4 else 9999
        if (len(set(tail_counts)) == 1              # all same vert count
                and tail_counts[0] < main_max * 0.2  # much smaller than main meshes
                and len(tail) == 4):
            print(f'  Stripping {len(tail)} baked wheel groups ({tail_counts[0]} verts each) from body')
            body_meshes = body_meshes[:-4]

    all_parts = [body_meshes]  # index 0 = body
    offset_map = {}
    part_names = {0: 'body'}

    # Parse wheels (skip if --no-wheels)
    if wheels_el is not None and not no_wheels:
        for i, wheel_tag in enumerate(['front-left', 'front-right', 'rear-left', 'rear-right']):
            wel = wheels_el.find(wheel_tag)
            if wel is None:
                continue
            model = wel.attrib.get('model', '')
            pos_str = wel.attrib.get('position', '0 0 0')
            pos = [float(x) for x in pos_str.split()]
            wheel_path = kart_dir / model
            if not wheel_path.is_file():
                print(f'  WARNING: wheel file {model} not found, skipping')
                continue
            print(f'  Parsing wheel: {model} at ({pos[0]:.3f}, {pos[1]:.3f}, {pos[2]:.3f})')
            wheel_meshes = parse_b3d(str(wheel_path))
            part_idx = len(all_parts)
            all_parts.append(wheel_meshes)
            offset_map[part_idx] = (pos[0], pos[1], pos[2])
            part_names[part_idx] = f'wheel-{wheel_tag}'
            print(f'    -> {len(wheel_meshes)} mesh group(s)')

    tex_dirs = [str(kart_dir)]
    glb = build_glb(all_parts, tex_dirs, offset_map, part_names, scale_x=scale_x)
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    Path(output_path).write_bytes(glb)
    print(f'  Output: {output_path} ({len(glb):,} bytes)')
    return len(glb)


if __name__ == '__main__':
    import argparse as _ap
    p = _ap.ArgumentParser(description='Convert B3D kart to GLB')
    p.add_argument('kart_dir', help='Directory containing kart.xml + B3D files')
    p.add_argument('output', help='Output .glb path')
    p.add_argument('--scale-x', type=float, default=1.0, help='X-axis scale factor')
    p.add_argument('--no-wheels', action='store_true', help='Skip separate wheel files (use if body has wheels baked in)')
    a = p.parse_args()
    convert_kart(a.kart_dir, a.output, scale_x=a.scale_x, no_wheels=a.no_wheels)
