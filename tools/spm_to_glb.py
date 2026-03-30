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

import math
import struct, sys, os, io, json, base64, argparse
from pathlib import Path

SPM_VERSION = 1

def half_float(data: bytes) -> float:
    return struct.unpack('<e', data)[0]

def read_str(f, length: int) -> str:
    return f.read(length).decode('ascii', errors='replace')

def _le(fmt, data):
    return struct.unpack('<' + fmt, data)


def _normalize_quaternion(quat):
    x, y, z, w = quat
    length = math.sqrt(x * x + y * y + z * z + w * w)
    if length == 0.0:
        return (0.0, 0.0, 0.0, 1.0)
    inv = 1.0 / length
    return (x * inv, y * inv, z * inv, w * inv)


def _lerp_vec3(a, b, t):
    return (
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    )


def _quat_slerp(a, b, t):
    ax, ay, az, aw = _normalize_quaternion(a)
    bx, by, bz, bw = _normalize_quaternion(b)
    dot = ax * bx + ay * by + az * bz + aw * bw

    if dot < 0.0:
        bx, by, bz, bw = -bx, -by, -bz, -bw
        dot = -dot

    if dot > 0.9995:
        return _normalize_quaternion((
            ax + (bx - ax) * t,
            ay + (by - ay) * t,
            az + (bz - az) * t,
            aw + (bw - aw) * t,
        ))

    theta_0 = math.acos(max(-1.0, min(1.0, dot)))
    sin_theta_0 = math.sin(theta_0)
    if sin_theta_0 == 0.0:
        return (ax, ay, az, aw)
    theta = theta_0 * t
    sin_theta = math.sin(theta)
    s0 = math.cos(theta) - dot * sin_theta / sin_theta_0
    s1 = sin_theta / sin_theta_0
    return (
        s0 * ax + s1 * bx,
        s0 * ay + s1 * by,
        s0 * az + s1 * bz,
        s0 * aw + s1 * bw,
    )


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


def _invert_matrix(matrix):
    work = [[float(matrix[row][col]) for col in range(4)] for row in range(4)]
    inv = _identity_matrix()

    for pivot_idx in range(4):
        pivot_row = max(range(pivot_idx, 4), key=lambda row: abs(work[row][pivot_idx]))
        pivot_val = work[pivot_row][pivot_idx]
        if abs(pivot_val) < 1e-8:
            return _identity_matrix()

        if pivot_row != pivot_idx:
            work[pivot_idx], work[pivot_row] = work[pivot_row], work[pivot_idx]
            inv[pivot_idx], inv[pivot_row] = inv[pivot_row], inv[pivot_idx]

        scale = work[pivot_idx][pivot_idx]
        for col in range(4):
            work[pivot_idx][col] /= scale
            inv[pivot_idx][col] /= scale

        for row in range(4):
            if row == pivot_idx:
                continue
            factor = work[row][pivot_idx]
            if factor == 0.0:
                continue
            for col in range(4):
                work[row][col] -= factor * work[pivot_idx][col]
                inv[row][col] -= factor * inv[pivot_idx][col]

    return inv


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


def _read_loc_rot_scale(f):
    vals = _le('10f', f.read(40))
    return {
        'loc': (vals[0], vals[1], vals[2]),
        'rot': _normalize_quaternion((vals[3], vals[4], vals[5], vals[6])),
        'scale': (vals[7], vals[8], vals[9]),
    }


def _read_armature(f):
    joint_used = _le('H', f.read(2))[0]
    all_joints_size = _le('H', f.read(2))[0]
    if joint_used == 0 or all_joints_size == 0:
        raise ValueError('Invalid SPMA armature header')

    joint_names = []
    for _ in range(all_joints_size):
        str_len = _le('B', f.read(1))[0]
        joint_names.append(read_str(f, str_len) if str_len > 0 else '')

    joint_matrices = []
    interpolated = []
    for _ in range(all_joints_size):
        lrs = _read_loc_rot_scale(f)
        joint_matrices.append(_compose_matrix(lrs['loc'], lrs['rot'], lrs['scale']))
        interpolated.append(lrs)

    parent_infos = []
    non_parent_bone = False
    for _ in range(all_joints_size):
        parent = _le('h', f.read(2))[0]
        if parent == -1:
            non_parent_bone = True
        parent_infos.append(parent)
    if not non_parent_bone:
        raise ValueError('SPMA armature missing root bone')

    frame_size = _le('H', f.read(2))[0]
    frame_pose_matrices = []
    for _ in range(frame_size):
        frame_index = _le('H', f.read(2))[0]
        pose = [_read_loc_rot_scale(f) for _ in range(all_joints_size)]
        frame_pose_matrices.append((frame_index, pose))

    return {
        'joint_used': joint_used,
        'joint_names': joint_names,
        'joint_matrices': joint_matrices,
        'parent_infos': parent_infos,
        'frame_pose_matrices': frame_pose_matrices,
        'interpolated': interpolated,
    }


def _get_interpolated_pose(armature, frame):
    frames = armature['frame_pose_matrices']
    if not frames:
        return armature['interpolated']

    if frame < float(frames[0][0]) or frame >= float(frames[-1][0]):
        return frames[-1][1] if frame >= float(frames[-1][0]) else frames[0][1]

    for idx in range(len(frames) - 1):
        frame_a, pose_a = frames[idx]
        frame_b, pose_b = frames[idx + 1]
        if frame >= float(frame_a) and frame < float(frame_b):
            denom = float(frame_b - frame_a)
            t = 0.0 if denom == 0.0 else (frame - float(frame_a)) / denom
            blended = []
            for joint_idx in range(len(pose_a)):
                blended.append({
                    'loc': _lerp_vec3(pose_a[joint_idx]['loc'], pose_b[joint_idx]['loc'], t),
                    'rot': _quat_slerp(pose_a[joint_idx]['rot'], pose_b[joint_idx]['rot'], t),
                    'scale': _lerp_vec3(pose_a[joint_idx]['scale'], pose_b[joint_idx]['scale'], t),
                })
            return blended

    return frames[-1][1]


def _get_armature_pose_matrices(armature, frame):
    interpolated = _get_interpolated_pose(armature, frame)
    world_cache: list[list[list[float]] | None] = [None] * len(interpolated)

    def get_world_matrix(joint_idx):
        cached = world_cache[joint_idx]
        if cached is not None:
            return cached
        local = _compose_matrix(
            interpolated[joint_idx]['loc'],
            interpolated[joint_idx]['rot'],
            interpolated[joint_idx]['scale'],
        )
        parent_idx = armature['parent_infos'][joint_idx]
        if parent_idx == -1:
            world = local
        else:
            world = _mat_mul(get_world_matrix(parent_idx), local)
        world_cache[joint_idx] = world
        return world

    pose_matrices = []
    for joint_idx in range(armature['joint_used']):
        pose_matrices.append(_mat_mul(get_world_matrix(joint_idx), armature['joint_matrices'][joint_idx]))
    return pose_matrices


def _apply_bind_pose(meshes, bind_pose_matrices):
    if not bind_pose_matrices:
        return

    inverse_matrices = [_invert_matrix(matrix) for matrix in bind_pose_matrices]

    for mesh in meshes:
        joint_indices = mesh.get('joint_indices') or []
        joint_weights = mesh.get('joint_weights') or []
        normals = mesh.get('normals') or []
        if not joint_indices or not joint_weights:
            continue

        baked_positions = []
        baked_normals = []
        for vertex_idx, position in enumerate(mesh['positions']):
            indices = joint_indices[vertex_idx]
            weights = joint_weights[vertex_idx]
            if indices[0] == -1 or weights[0] == 0.0:
                baked_positions.append(position)
                if normals:
                    baked_normals.append(normals[vertex_idx])
                continue

            bind_pos = (0.0, 0.0, 0.0)
            bind_nor = (0.0, 0.0, 0.0)
            for influence_idx in range(4):
                weight = weights[influence_idx]
                joint_idx = indices[influence_idx]
                if weight == 0.0:
                    break
                if joint_idx < 0 or joint_idx >= len(inverse_matrices):
                    continue
                cur_pos = _transform_point(inverse_matrices[joint_idx], position)
                bind_pos = (
                    bind_pos[0] + cur_pos[0] * weight,
                    bind_pos[1] + cur_pos[1] * weight,
                    bind_pos[2] + cur_pos[2] * weight,
                )
                if normals:
                    cur_nor = _transform_direction(inverse_matrices[joint_idx], normals[vertex_idx])
                    bind_nor = (
                        bind_nor[0] + cur_nor[0] * weight,
                        bind_nor[1] + cur_nor[1] * weight,
                        bind_nor[2] + cur_nor[2] * weight,
                    )

            baked_positions.append(bind_pos)
            if normals:
                baked_normals.append(_normalize_vec3(bind_nor))

        mesh['positions'] = baked_positions
        if normals:
            mesh['normals'] = baked_normals

def load_texture_bytes(name: str, search_dirs: list[str]) -> tuple[bytes | None, str | None]:
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
                normals = []
                uvs = []
                uvs2 = []
                colors = []
                joint_indices = []
                joint_weights = []

                for _ in range(vc):
                    x, y, z = _le('fff', f.read(12))
                    positions.append((x, y, z))

                    if read_normal:
                        packed = _le('I', f.read(4))[0]
                        nx = ((packed & 0x3FF) / 511.5) - 1.0
                        ny = (((packed >> 10) & 0x3FF) / 511.5) - 1.0
                        nz = (((packed >> 20) & 0x3FF) / 511.5) - 1.0
                        normals.append(_normalize_vec3((nx, ny, nz)))
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
                        joints = _le('4h', f.read(8))
                        weights = tuple(half_float(f.read(2)) for _ in range(4))
                        if joints[0] == -1 or weights[0] == 0.0 or math.copysign(1.0, weights[0]) < 0 and weights[0] == 0.0:
                            joints = (-32767, 0, 0, 0)
                            weights = (1.0, 0.0, 0.0, 0.0)
                        joint_indices.append(joints)
                        joint_weights.append(weights)

                if idx_size == 4:
                    indices = list(_le(f'{ic}I', f.read(ic * 4)))
                elif idx_size == 2:
                    indices = list(_le(f'{ic}H', f.read(ic * 2)))
                else:
                    indices = list(_le(f'{ic}B', f.read(ic)))

                meshes.append({
                    'positions': positions,
                    'normals': normals,
                    'uvs': uvs,
                    'uvs2': uvs2,
                    'colors': colors,
                    'joint_indices': joint_indices,
                    'joint_weights': joint_weights,
                    'indices': indices,
                    'material': materials[mid],
                })

            if spm_type == 'SPMS':
                f.read(24)  # reserved

        if is_skinned:
            armature_size_bytes = f.read(1)
            if armature_size_bytes:
                armature_size = _le('B', armature_size_bytes)[0]
                if armature_size > 0:
                    f.read(2)  # bind frame
                    for _ in range(armature_size):
                        _read_armature(f)

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
            'doubleSided': True,
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
        normals = m.get('normals', [])
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

        if normals and len(normals) == len(pos):
            flat_normals = [c for v in normals for c in _normalize_vec3(v)]
            bv_norm = add_buffer_view(pack_f32(flat_normals), ARRAY_BUFFER)
            prim_attrs['NORMAL'] = add_accessor(bv_norm, len(normals), FLOAT, 'VEC3')

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


def build_glb_kart(all_parts: list, tex_dirs: list[str], offset_map: dict | None = None,
                   part_names: dict | None = None) -> bytes:
    """Build GLB from multiple SPM part mesh-lists with positional offsets.

    all_parts:  [ [body_meshes], [wheel1_meshes], [wheel2_meshes], ... ]
    offset_map: { part_index: (ox, oy, oz) }  — wheel positions from kart.xml
    part_names: { part_index: str }            — human-readable part labels
    """
    bin_data = bytearray()
    accessors = []
    buffer_views = []
    gltf_meshes = []
    images = []
    textures = []
    materials = []
    tex_cache = {}

    ARRAY_BUFFER   = 34962
    ELEMENT_BUFFER = 34963
    FLOAT          = 5126
    U16            = 5123
    U32            = 5125

    def add_buffer_view(data: bytes, target=None) -> int:
        offset = len(bin_data)
        bin_data.extend(data)
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
            'componentType': comp_type,
            'count': count,
            'type': atype,
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
            'doubleSided': True,
        }
        materials.append(mat)
        tex_cache[tex_name] = mat_idx
        return mat_idx

    # Track per-gltf-mesh which part it belongs to (for node translation)
    mesh_part_map = {}  # gltf_mesh_index -> part_idx

    for part_idx, part_meshes in enumerate(all_parts):
        part_label = (part_names or {}).get(part_idx, f'part_{part_idx}')

        for local_idx, m in enumerate(part_meshes):
            pos = m['positions']
            normals = m.get('normals', [])
            uvs = m.get('uvs', [])
            colors = m.get('colors', [])
            indices = m['indices']
            mat_info = m['material']

            if not pos or not indices:
                continue

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

            if colors:
                flat_col = [c for v in colors for c in v]
                bv_col = add_buffer_view(pack_f32(flat_col), ARRAY_BUFFER)
                prim_attrs['COLOR_0'] = add_accessor(bv_col, len(colors), FLOAT, 'VEC4')

            use_u32 = any(i > 65535 for i in indices)
            if use_u32:
                bv_idx = add_buffer_view(pack_u32(indices), ELEMENT_BUFFER)
                acc_idx = add_accessor(bv_idx, len(indices), U32, 'SCALAR')
            else:
                bv_idx = add_buffer_view(pack_u16(indices), ELEMENT_BUFFER)
                acc_idx = add_accessor(bv_idx, len(indices), U16, 'SCALAR')

            mat_idx = get_or_add_texture(mat_info.get('tex1', mat_info.get('tex1', '')), tex_dirs)

            prim = {
                'attributes': prim_attrs,
                'indices': acc_idx,
                'mode': 4,
            }
            if mat_idx is not None:
                prim['material'] = mat_idx

            mesh_name = f'{part_label}_{local_idx}'
            mesh_part_map[len(gltf_meshes)] = part_idx
            gltf_meshes.append({'name': mesh_name, 'primitives': [prim]})

    # Build nodes: wheel parts get a parent node with translation so they
    # rotate around their own center instead of the world origin.
    nodes = []
    scene_node_indices = []
    # Group mesh indices by part_idx for multi-mesh wheel parts
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
    while len(json_bytes) % 4:
        json_bytes += b' '
    bin_chunk = bytes(bin_data)
    while len(bin_chunk) % 4:
        bin_chunk += b'\x00'

    def chunk(magic: int, data: bytes) -> bytes:
        return struct.pack('<II', len(data), magic) + data

    json_chunk = chunk(0x4E4F534A, json_bytes)
    bin_chunk_data = chunk(0x004E4942, bin_chunk)
    total = 12 + len(json_chunk) + len(bin_chunk_data)
    glb_header = struct.pack('<III', 0x46546C67, 2, total)
    return glb_header + json_chunk + bin_chunk_data


def convert_kart(kart_dir: str | Path, output_path: str) -> int:
    """Read kart.xml, parse body + wheel SPMs, produce combined GLB.
    Mirrors b3d_to_glb.convert_kart() for SPM-based karts."""
    import xml.etree.ElementTree as ET

    kart_dir = Path(kart_dir)
    kart_xml_path = kart_dir / 'kart.xml'

    if not kart_xml_path.is_file():
        raise FileNotFoundError(f'No kart.xml in {kart_dir}')

    tree = ET.parse(str(kart_xml_path))
    root = tree.getroot()

    body_file = root.attrib.get('model-file', '')
    if not body_file:
        raise ValueError('No model-file in kart.xml')

    tex_dirs = [str(kart_dir)]

    # Parse body SPM
    body_path = kart_dir / body_file
    print(f'  Parsing body: {body_file}')
    body_meshes = parse_spm(str(body_path), tex_dirs)
    print(f'    -> {len(body_meshes)} mesh group(s), '
          f'{sum(len(m["positions"]) for m in body_meshes)} verts')

    all_parts = [body_meshes]
    offset_map = {}
    part_names = {0: 'body'}

    # Parse wheels from kart.xml
    wheels_el = root.find('wheels')
    if wheels_el is not None:
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
            wheel_meshes = parse_spm(str(wheel_path), tex_dirs)
            part_idx = len(all_parts)
            all_parts.append(wheel_meshes)
            offset_map[part_idx] = (pos[0], pos[1], pos[2])
            part_names[part_idx] = f'wheel-{wheel_tag}'
            print(f'    -> {len(wheel_meshes)} mesh group(s)')

    glb = build_glb_kart(all_parts, tex_dirs, offset_map, part_names)
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    Path(output_path).write_bytes(glb)
    print(f'  Output: {output_path} ({len(glb):,} bytes)')
    return len(glb)


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
