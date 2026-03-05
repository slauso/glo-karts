#!/usr/bin/env python3
"""Parse STK SPM v10 format - materials have paired texture names."""

import struct
import os

SPM_PATH = r'C:\Users\laptop\twistedkart\temp_blockfort\extracted\mk64blockfort\mk64blockfort_track.spm'

def read_string(f):
    str_len = struct.unpack('<B', f.read(1))[0]
    if str_len == 0:
        return ''
    return f.read(str_len).decode('utf-8', errors='replace')

def main():
    file_size = os.path.getsize(SPM_PATH)
    print(f"File size: {file_size} bytes")
    
    with open(SPM_PATH, 'rb') as f:
        magic = f.read(2)
        assert magic == b'SP'
        
        version = struct.unpack('<B', f.read(1))[0]
        export_flags = struct.unpack('<B', f.read(1))[0]
        has_normals = bool(export_flags & 1)
        has_vcolor = bool(export_flags & 2)
        has_tangents = bool(export_flags & 4)
        print(f"Version: {version}, flags: {export_flags}")
        print(f"  normals={has_normals}, vcolor={has_vcolor}, tangents={has_tangents}")
        
        bbox = struct.unpack('<6f', f.read(24))
        print(f"BBox: ({bbox[0]:.2f},{bbox[1]:.2f},{bbox[2]:.2f}) - ({bbox[3]:.2f},{bbox[4]:.2f},{bbox[5]:.2f})")
        
        # Number of MATERIALS (each has 2 texture names)
        num_materials = struct.unpack('<H', f.read(2))[0]
        print(f"\nNum materials: {num_materials}")
        
        materials = []
        for i in range(num_materials):
            tex1 = read_string(f)
            tex2 = read_string(f)
            materials.append((tex1, tex2))
            print(f"  [{i}] diffuse='{tex1}' gloss='{tex2}'")
        
        print(f"\nOffset after materials: {f.tell()}")
        
        # Next: number of sectors (uint16)
        # From STK source: after materials comes armature data (if version >= 1)
        # Actually in SPMv1+: 
        #   uint16 num_armatures
        #   for each armature: armature data
        #   uint16 num_sectors
        #   for each sector: mesh data
        
        # But this is a track, probably no armatures
        # Let me read carefully
        
        # Peek at next bytes
        pos = f.tell()
        peek = f.read(20)
        f.seek(pos)
        print(f"Next 20 bytes: {peek.hex(' ')}")
        u16s = [struct.unpack_from('<H', peek, i*2)[0] for i in range(10)]
        print(f"As uint16: {u16s}")
        
        # Try: first uint16 = num_armatures (should be 0 for track)
        num_armatures = struct.unpack('<H', f.read(2))[0]
        print(f"\nNum armatures: {num_armatures}")
        
        if num_armatures > 0:
            print("Skipping armatures not implemented, trying without armature field...")
            f.seek(pos)  # go back
            # Maybe there's no armature field for tracks?
            
        # Read number of sectors
        num_sectors = struct.unpack('<H', f.read(2))[0]
        print(f"Num sectors: {num_sectors}")
        
        if num_sectors > 100:
            print(f"ERROR: {num_sectors} sectors seems too many. Adjusting...")
            # Try interpreting differently
            f.seek(pos)
            # Maybe it's just sectors directly
            num_sectors = struct.unpack('<H', f.read(2))[0]
            print(f"Retry direct - Num sectors: {num_sectors}")
            if num_sectors > 100:
                return
        
        total_verts = 0
        total_tris = 0
        
        for s in range(num_sectors):
            # Each sector: uint16 num_material_meshes
            num_meshes = struct.unpack('<H', f.read(2))[0]
            print(f"\n--- Sector {s}: {num_meshes} meshes ---")
            
            for m in range(num_meshes):
                # Material index
                mat_idx = struct.unpack('<H', f.read(2))[0]
                
                mat_name = materials[mat_idx][0] if mat_idx < len(materials) else f"#{mat_idx}"
                
                # Number of vertices (uint32)
                num_verts = struct.unpack('<I', f.read(4))[0]
                print(f"  Mesh {m}: mat={mat_name} ({mat_idx}), verts={num_verts}")
                
                if num_verts > 500000:
                    print(f"  ERROR: too many vertices")
                    print(f"  Offset: {f.tell()}")
                    return
                
                total_verts += num_verts
                
                # Vertex format: 
                # position: 3 floats (12 bytes)
                # normal: packed u32 (4 bytes) if has_normals
                # UV: 4 bytes (2 half-floats)
                # color: 4 bytes if has_vcolor
                # tangent: 4 bytes if has_tangents
                
                vert_size = 12 + 4  # pos + UV always
                if has_normals:
                    vert_size += 4
                if has_vcolor:
                    vert_size += 4
                if has_tangents:
                    vert_size += 4
                    
                vert_data = f.read(num_verts * vert_size)
                
                if num_verts > 0:
                    vx, vy, vz = struct.unpack_from('<3f', vert_data, 0)
                    print(f"    First vert: ({vx:.3f}, {vy:.3f}, {vz:.3f})")
                
                # Number of indices
                # In SPM the index count field size depends on version
                # For SPM v10: uint16 index_count, uint16 indices[]
                # But some versions use uint32
                
                # Let's try uint16 first
                num_idx = struct.unpack('<H', f.read(2))[0]
                print(f"    Indices: {num_idx}")
                
                if num_idx == 0:
                    # Maybe it's uint32
                    extra = f.read(2)
                    num_idx_32 = struct.unpack('<I', struct.pack('<HH', num_idx, struct.unpack('<H', extra)[0]))[0]
                    print(f"    Retry as uint32: {num_idx_32}")
                    num_idx = num_idx_32
                    idx_data = f.read(num_idx * 2)
                else:
                    total_tris += num_idx // 3
                    idx_size = 4 if num_verts > 65535 else 2
                    idx_data = f.read(num_idx * idx_size)
                    print(f"    Index size: {idx_size} bytes each, total: {len(idx_data)} bytes")
        
        print(f"\n=== Summary ===")
        print(f"Total vertices: {total_verts}")
        print(f"Total triangles: {total_tris}")
        remaining = file_size - f.tell()
        print(f"Bytes remaining: {remaining}")
        print(f"Final offset: {f.tell()}")

if __name__ == '__main__':
    main()
