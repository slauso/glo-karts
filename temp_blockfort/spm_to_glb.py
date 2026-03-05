#!/usr/bin/env python3
"""
Convert STK SPM (Space Partitioned Mesh) to GLB (glTF 2.0 Binary).
Based on STK source: sp_mesh_loader.cpp

SPM format (version 1, type SPMN):
  Header: "SP" + version_type_byte + flags_byte + bbox(6 floats)
  Materials: uint16 count, each = 2 length-prefixed strings (tex1, tex2)
  Sectors: uint16 count
    Each sector: uint16 num_meshes
      Each mesh: uint32 vert_count + uint32 idx_count + uint16 mat_id
        Vertex data: position(3f) + normal(u32 packed) + UV(2 half-float) ...
        Index data: uint8 or uint16 depending on vert_count
"""

import struct
import os
import json
import base64
import math
from pathlib import Path

SPM_PATH = Path(r'C:\Users\laptop\twistedkart\temp_blockfort\extracted\mk64blockfort\mk64blockfort_track.spm')
TEX_DIR = SPM_PATH.parent
OUT_PATH = Path(r'C:\Users\laptop\twistedkart\temp_blockfort\blockfort.glb')

def read_string(f):
    n = struct.unpack('<B', f.read(1))[0]
    if n == 0:
        return ''
    return f.read(n).decode('utf-8', errors='replace')

def half_to_float(h):
    """Convert IEEE 754 half-precision (16-bit) to float."""
    sign = (h >> 15) & 1
    exp = (h >> 10) & 0x1F
    frac = h & 0x3FF
    if exp == 0:
        if frac == 0:
            return (-1)**sign * 0.0
        else:
            return (-1)**sign * (2**-14) * (frac / 1024.0)
    elif exp == 31:
        if frac == 0:
            return float('inf') if sign == 0 else float('-inf')
        else:
            return float('nan')
    return (-1)**sign * (2**(exp - 15)) * (1 + frac / 1024.0)

def unpack_normal_10_10_10_2(packed):
    """Decompress 10-10-10-2 packed normal (STK format)."""
    x = packed & 0x3FF
    y = (packed >> 10) & 0x3FF
    z = (packed >> 20) & 0x3FF
    # Convert from unsigned 10-bit to signed float [-1, 1]
    # STK uses: x = (val / 511.0) * 2.0 - 1.0
    def to_float(val):
        return (val / 511.0) * 2.0 - 1.0
    nx, ny, nz = to_float(x), to_float(y), to_float(z)
    # Normalize
    length = math.sqrt(nx*nx + ny*ny + nz*nz)
    if length > 0:
        nx /= length
        ny /= length
        nz /= length
    return nx, ny, nz

def main():
    file_size = os.path.getsize(SPM_PATH)
    print(f"SPM file: {file_size} bytes")

    with open(SPM_PATH, 'rb') as f:
        # ─── HEADER ───
        magic = f.read(2)
        assert magic == b'SP', f"Bad magic: {magic}"

        vt_byte = struct.unpack('<B', f.read(1))[0]
        version = vt_byte >> 3
        mesh_type = vt_byte & ~0x08
        type_name = {0: "SPMS", 1: "SPMA", 2: "SPMN"}.get(mesh_type, f"?{mesh_type}")
        print(f"Version: {version}, Type: {type_name}")
        assert version == 1, f"Unsupported version {version}"

        flags = struct.unpack('<B', f.read(1))[0]
        read_normal = bool(flags & 1)
        read_vcolor = bool(flags & 2)
        read_tangent = bool(flags & 4)
        is_skinned = (type_name == "SPMA")
        print(f"Flags: normals={read_normal}, vcolor={read_vcolor}, tangent={read_tangent}, skinned={is_skinned}")

        bbox = struct.unpack('<6f', f.read(24))
        print(f"BBox: ({bbox[0]:.2f},{bbox[1]:.2f},{bbox[2]:.2f}) - ({bbox[3]:.2f},{bbox[4]:.2f},{bbox[5]:.2f})")

        # ─── MATERIALS ───
        num_materials = struct.unpack('<H', f.read(2))[0]
        materials = []
        for i in range(num_materials):
            tex1 = read_string(f)
            tex2 = read_string(f)
            materials.append((tex1, tex2))
        print(f"Materials: {num_materials}")
        for i, (t1, t2) in enumerate(materials):
            print(f"  [{i}] {t1} | {t2}")

        # ─── SECTORS ───
        num_sectors = struct.unpack('<H', f.read(2))[0]
        print(f"\nSectors: {num_sectors}")

        # Collect all mesh data
        all_meshes = []  # list of (mat_id, positions[], normals[], uvs[], indices[])

        for s in range(num_sectors):
            num_meshes = struct.unpack('<H', f.read(2))[0]
            print(f"  Sector {s}: {num_meshes} meshes")

            for m in range(num_meshes):
                vert_count = struct.unpack('<I', f.read(4))[0]
                idx_count = struct.unpack('<I', f.read(4))[0]
                mat_id = struct.unpack('<H', f.read(2))[0]

                uv_one = bool(materials[mat_id][0]) if mat_id < len(materials) else False
                uv_two = bool(materials[mat_id][1]) if mat_id < len(materials) else False

                print(f"    Mesh {m}: mat={mat_id} verts={vert_count} idx={idx_count} uv1={uv_one} uv2={uv_two}")

                positions = []
                normals = []
                uvs = []
                colors = []

                for v in range(vert_count):
                    # Position: 3 floats
                    px, py, pz = struct.unpack('<3f', f.read(12))
                    positions.extend([px, py, pz])

                    # Normal: packed uint32 (10-10-10-2)
                    if read_normal:
                        packed = struct.unpack('<I', f.read(4))[0]
                        nx, ny, nz = unpack_normal_10_10_10_2(packed)
                        normals.extend([nx, ny, nz])

                    # Vertex color
                    if read_vcolor:
                        ci = struct.unpack('<B', f.read(1))[0]
                        if ci == 128:
                            colors.extend([1.0, 1.0, 1.0, 1.0])
                        else:
                            r, g, b = struct.unpack('<3B', f.read(3))
                            colors.extend([r/255.0, g/255.0, b/255.0, 1.0])

                    # UV coordinates
                    if uv_one:
                        hf = struct.unpack('<2h', f.read(4))
                        u = half_to_float(hf[0] & 0xFFFF)
                        v = half_to_float(hf[1] & 0xFFFF)
                        uvs.extend([u, v])

                        if uv_two:
                            f.read(4)  # skip UV2

                        if read_tangent:
                            f.read(4)  # skip tangent

                    # Skinning data
                    if is_skinned:
                        f.read(16)  # joint indices + weights

                # Indices
                idx_size = 2 if vert_count > 255 else 1
                indices = []
                if idx_size == 2:
                    for _ in range(idx_count):
                        indices.append(struct.unpack('<H', f.read(2))[0])
                else:
                    for _ in range(idx_count):
                        indices.append(struct.unpack('<B', f.read(1))[0])

                if vert_count > 0 and idx_count > 0:
                    all_meshes.append({
                        'mat_id': mat_id,
                        'positions': positions,
                        'normals': normals,
                        'uvs': uvs,
                        'indices': indices,
                        'vert_count': vert_count,
                    })

            if type_name == "SPMS":
                f.read(24)  # skip sector bbox

        remaining = file_size - f.tell()
        print(f"\nParsed OK. Meshes: {len(all_meshes)}, Bytes remaining: {remaining}")

    # ─── BUILD GLB ───
    print("\n=== Building GLB ===")

    # Load textures
    tex_cache = {}
    for mat in materials:
        for tex_name in [mat[0], mat[1]]:
            if tex_name and tex_name not in tex_cache:
                tex_path = TEX_DIR / tex_name
                if tex_path.exists():
                    with open(tex_path, 'rb') as tf:
                        tex_cache[tex_name] = tf.read()
                    print(f"  Loaded texture: {tex_name} ({len(tex_cache[tex_name])} bytes)")
                else:
                    print(f"  WARNING: Missing texture: {tex_name}")

    # Build binary buffer
    bin_data = bytearray()
    accessors = []
    buffer_views = []
    meshes_gltf = []
    nodes = []
    gltf_materials = []
    images = []
    textures_gltf = []
    samplers = [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}]

    # Create materials and textures
    tex_name_to_idx = {}
    for i, (tex1, tex2) in enumerate(materials):
        mat_def = {
            "name": tex1 or f"material_{i}",
            "pbrMetallicRoughness": {
                "metallicFactor": 0.0,
                "roughnessFactor": 0.8,
            },
            "doubleSided": True,
        }
        if tex1 and tex1 in tex_cache:
            if tex1 not in tex_name_to_idx:
                # Add image
                img_data = tex_cache[tex1]
                # Pad binary to 4-byte alignment
                while len(bin_data) % 4 != 0:
                    bin_data.append(0)
                img_offset = len(bin_data)
                bin_data.extend(img_data)

                img_bv = len(buffer_views)
                buffer_views.append({
                    "buffer": 0,
                    "byteOffset": img_offset,
                    "byteLength": len(img_data),
                })
                img_idx = len(images)
                images.append({
                    "bufferView": img_bv,
                    "mimeType": "image/png",
                    "name": tex1,
                })
                tex_idx = len(textures_gltf)
                textures_gltf.append({
                    "source": img_idx,
                    "sampler": 0,
                })
                tex_name_to_idx[tex1] = tex_idx

            mat_def["pbrMetallicRoughness"]["baseColorTexture"] = {
                "index": tex_name_to_idx[tex1]
            }

        gltf_materials.append(mat_def)

    # Create mesh primitives
    # Group meshes by material for efficiency
    for mesh in all_meshes:
        # Pad to 4-byte alignment
        while len(bin_data) % 4 != 0:
            bin_data.append(0)

        # Position data
        pos_offset = len(bin_data)
        pos_bytes = struct.pack(f'<{len(mesh["positions"])}f', *mesh["positions"])
        bin_data.extend(pos_bytes)

        pos_bv = len(buffer_views)
        buffer_views.append({
            "buffer": 0,
            "byteOffset": pos_offset,
            "byteLength": len(pos_bytes),
            "target": 34962,  # ARRAY_BUFFER
        })

        # Compute min/max for positions
        pos_list = mesh["positions"]
        xs = pos_list[0::3]
        ys = pos_list[1::3]
        zs = pos_list[2::3]
        pos_accessor = len(accessors)
        accessors.append({
            "bufferView": pos_bv,
            "componentType": 5126,  # FLOAT
            "count": mesh["vert_count"],
            "type": "VEC3",
            "min": [min(xs), min(ys), min(zs)],
            "max": [max(xs), max(ys), max(zs)],
        })

        attributes = {"POSITION": pos_accessor}

        # Normal data
        if mesh["normals"]:
            while len(bin_data) % 4 != 0:
                bin_data.append(0)
            norm_offset = len(bin_data)
            norm_bytes = struct.pack(f'<{len(mesh["normals"])}f', *mesh["normals"])
            bin_data.extend(norm_bytes)

            norm_bv = len(buffer_views)
            buffer_views.append({
                "buffer": 0,
                "byteOffset": norm_offset,
                "byteLength": len(norm_bytes),
                "target": 34962,
            })
            norm_accessor = len(accessors)
            accessors.append({
                "bufferView": norm_bv,
                "componentType": 5126,
                "count": mesh["vert_count"],
                "type": "VEC3",
            })
            attributes["NORMAL"] = norm_accessor

        # UV data
        if mesh["uvs"]:
            while len(bin_data) % 4 != 0:
                bin_data.append(0)
            uv_offset = len(bin_data)
            uv_bytes = struct.pack(f'<{len(mesh["uvs"])}f', *mesh["uvs"])
            bin_data.extend(uv_bytes)

            uv_bv = len(buffer_views)
            buffer_views.append({
                "buffer": 0,
                "byteOffset": uv_offset,
                "byteLength": len(uv_bytes),
                "target": 34962,
            })
            uv_accessor = len(accessors)
            accessors.append({
                "bufferView": uv_bv,
                "componentType": 5126,
                "count": mesh["vert_count"],
                "type": "VEC2",
            })
            attributes["TEXCOORD_0"] = uv_accessor

        # Index data
        while len(bin_data) % 4 != 0:
            bin_data.append(0)
        idx_offset = len(bin_data)
        # Always use uint16 for indices in output
        idx_bytes = struct.pack(f'<{len(mesh["indices"])}H', *mesh["indices"])
        bin_data.extend(idx_bytes)

        idx_bv = len(buffer_views)
        buffer_views.append({
            "buffer": 0,
            "byteOffset": idx_offset,
            "byteLength": len(idx_bytes),
            "target": 34963,  # ELEMENT_ARRAY_BUFFER
        })
        idx_accessor = len(accessors)
        accessors.append({
            "bufferView": idx_bv,
            "componentType": 5123,  # UNSIGNED_SHORT
            "count": len(mesh["indices"]),
            "type": "SCALAR",
        })

        primitive = {
            "attributes": attributes,
            "indices": idx_accessor,
            "mode": 4,  # TRIANGLES
        }
        if mesh["mat_id"] < len(gltf_materials):
            primitive["material"] = mesh["mat_id"]

        mesh_idx = len(meshes_gltf)
        meshes_gltf.append({
            "name": f"mesh_{mesh_idx}",
            "primitives": [primitive],
        })
        nodes.append({
            "name": f"node_{mesh_idx}",
            "mesh": mesh_idx,
        })

    # Pad binary to 4-byte alignment
    while len(bin_data) % 4 != 0:
        bin_data.append(0)

    # Build glTF JSON
    gltf = {
        "asset": {"version": "2.0", "generator": "spm_to_glb.py"},
        "scene": 0,
        "scenes": [{"name": "BlockFort", "nodes": list(range(len(nodes)))}],
        "nodes": nodes,
        "meshes": meshes_gltf,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": len(bin_data)}],
        "materials": gltf_materials,
    }
    if images:
        gltf["images"] = images
    if textures_gltf:
        gltf["textures"] = textures_gltf
    if samplers:
        gltf["samplers"] = samplers

    # Encode GLB
    json_str = json.dumps(gltf, separators=(',', ':'))
    json_bytes = json_str.encode('utf-8')
    # Pad JSON to 4-byte alignment
    while len(json_bytes) % 4 != 0:
        json_bytes += b' '

    # GLB header: magic + version + length
    # Chunk 0: JSON
    # Chunk 1: BIN
    total_length = 12 + 8 + len(json_bytes) + 8 + len(bin_data)

    with open(OUT_PATH, 'wb') as out:
        # GLB header
        out.write(struct.pack('<I', 0x46546C67))  # magic "glTF"
        out.write(struct.pack('<I', 2))            # version
        out.write(struct.pack('<I', total_length)) # total length

        # JSON chunk
        out.write(struct.pack('<I', len(json_bytes)))
        out.write(struct.pack('<I', 0x4E4F534A))  # "JSON"
        out.write(json_bytes)

        # BIN chunk
        out.write(struct.pack('<I', len(bin_data)))
        out.write(struct.pack('<I', 0x004E4942))  # "BIN\0"
        out.write(bin_data)

    print(f"\n✓ Written {OUT_PATH} ({total_length} bytes)")
    print(f"  {len(meshes_gltf)} meshes, {len(gltf_materials)} materials, {len(images)} textures")

if __name__ == '__main__':
    main()
