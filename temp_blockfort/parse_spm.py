#!/usr/bin/env python3
"""Parse STK SPM (Space Partitioned Mesh) format and inspect structure."""

import struct
import os

SPM_PATH = r'C:\Users\laptop\twistedkart\temp_blockfort\extracted\mk64blockfort\mk64blockfort_track.spm'

def read_string(f):
    """Read a length-prefixed string (1 byte length)."""
    str_len = struct.unpack('<B', f.read(1))[0]
    return f.read(str_len).decode('utf-8', errors='replace')

def main():
    file_size = os.path.getsize(SPM_PATH)
    print(f"File size: {file_size} bytes")
    
    with open(SPM_PATH, 'rb') as f:
        # Header
        magic = f.read(2)
        assert magic == b'SP', f"Invalid magic: {magic}"
        
        version = struct.unpack('<B', f.read(1))[0]
        print(f"Version: {version}")
        
        # Export flags byte (version >= 1)
        export_flags = struct.unpack('<B', f.read(1))[0]
        print(f"Export flags: {export_flags} (bit0=normals, bit1=vcolor, bit2=tangents)")
        has_normals = bool(export_flags & 1)
        has_vcolor = bool(export_flags & 2)
        has_tangents = bool(export_flags & 4)
        print(f"  has_normals={has_normals}, has_vcolor={has_vcolor}, has_tangents={has_tangents}")
        
        # Bounding box
        # SPM stores bbox only in version >= 1
        # Actually the header after flags varies by version
        # Let me try: 6 floats for bbox
        # But wait - looking at STK source, the format might be:
        # After flags: num_materials (uint16), then material strings
        
        # Let me try reading as num_materials first
        # Actually from the hex dump, after byte 3 (flags=1), we had:
        # 08 c0 22 41 -> float 10.172
        # 36 cb 11 40 -> float 2.278  
        # 00 07 63 40 -> float 3.547
        # 8e b2 02 43 -> float 130.697
        # dd 2c 16 41 -> float 9.386
        # 53 25 f8 42 -> float 124.073
        # Then 13 00 -> uint16 = 19 (num textures)
        
        bbox = struct.unpack('<6f', f.read(24))
        print(f"BBox min: ({bbox[0]:.3f}, {bbox[1]:.3f}, {bbox[2]:.3f})")
        print(f"BBox max: ({bbox[3]:.3f}, {bbox[4]:.3f}, {bbox[5]:.3f})")
        
        # Number of textures
        num_textures = struct.unpack('<H', f.read(2))[0]
        print(f"\nNum textures: {num_textures}")
        
        textures = []
        for i in range(num_textures):
            tex = read_string(f)
            textures.append(tex)
            print(f"  [{i}] {tex}")
        
        print(f"\nOffset after texture names: {f.tell()}")
        
        # After textures: the SPM format has "sectors" 
        # Each sector has: num_materials, then for each material:
        #   material_index (uint16), num_vertices (uint32), vertex_data, 
        #   num_indices (uint16/uint32), index_data
        
        # But first, let's see if there's a sector count
        # From STK source (sp_mesh_loader.cpp):
        # After textures: uint16 num_armatures (if has_tangents? or always?)
        # Then sector data
        
        # Let me just read a chunk and analyze
        pos = f.tell()
        chunk = f.read(60)
        f.seek(pos)
        
        print(f"\nNext bytes at offset {pos}:")
        print(f"Hex: {chunk[:30].hex(' ')}")
        print(f"Hex: {chunk[30:60].hex(' ')}")
        
        # Try interpreting in different ways
        vals_u16 = [struct.unpack_from('<H', chunk, i*2)[0] for i in range(min(15, len(chunk)//2))]
        vals_u32 = [struct.unpack_from('<I', chunk, i*4)[0] for i in range(min(8, len(chunk)//4))]
        vals_f32 = [struct.unpack_from('<f', chunk, i*4)[0] for i in range(min(8, len(chunk)//4))]
        
        print(f"As uint16: {vals_u16}")
        print(f"As uint32: {vals_u32}")
        print(f"As float32: {[f'{v:.4f}' for v in vals_f32]}")
        
        # In STK SPM format (looking at sp_mesh_loader.cpp):
        # After texture list:
        # uint16 num_sectors  (SPMSector count)
        # For each sector:
        #   uint16 num_material_meshes
        #   For each material mesh:
        #     uint16 texture_index_1
        #     uint16 texture_index_2  (or 0xFFFF if none)  
        #     uint32 num_vertices
        #     vertex data...
        #     uint16 num_indices (or uint32 for large meshes)
        #     index data...
        
        # Let's try this interpretation
        num_sectors = struct.unpack('<H', f.read(2))[0]
        print(f"\nNum sectors: {num_sectors}")
        
        total_verts = 0
        total_indices = 0
        
        for s in range(num_sectors):
            num_material_meshes = struct.unpack('<H', f.read(2))[0]
            print(f"\n  Sector {s}: {num_material_meshes} material meshes")
            
            for m in range(num_material_meshes):
                # Material indices
                tex_idx1 = struct.unpack('<H', f.read(2))[0]
                tex_idx2 = struct.unpack('<H', f.read(2))[0]
                
                tex1_name = textures[tex_idx1] if tex_idx1 < len(textures) else f"#{tex_idx1}"
                tex2_name = textures[tex_idx2] if tex_idx2 < len(textures) else f"#{tex_idx2}"
                
                print(f"    Mesh {m}: tex1={tex1_name} ({tex_idx1}), tex2={tex2_name} ({tex_idx2})")
                
                # Number of vertices
                num_verts = struct.unpack('<I', f.read(4))[0]
                print(f"    Num vertices: {num_verts}")
                total_verts += num_verts
                
                if num_verts > 100000:
                    print("    ERROR: Unreasonable vertex count, format parsing likely wrong")
                    return
                
                # Vertex size depends on export flags
                # Base: position (3 floats = 12 bytes)
                # + normal (if has_normals): compressed as 10-10-10-2 = 4 bytes
                # + UV (2 half-floats = 4 bytes) 
                # + vcolor (if has_vcolor): 4 bytes (RGBA8)
                # + tangent (if has_tangents): 4 bytes
                # Actually in SPM, position is 3 floats (12 bytes)
                # Normal is packed into a single uint32 (4 bytes) as 10-10-10-2
                # UV is 2 half-floats (4 bytes)
                # Color is uint32 RGBA (4 bytes) if has_vcolor
                # Tangent is uint32 packed (4 bytes) if has_tangents
                
                vert_size = 12  # position (3 floats)
                if has_normals:
                    vert_size += 4  # packed normal
                vert_size += 4  # UV (2 half-floats)
                if has_vcolor:
                    vert_size += 4  # RGBA color
                if has_tangents:
                    vert_size += 4  # packed tangent
                
                print(f"    Vertex size: {vert_size} bytes")
                
                # Read vertex data
                vert_data = f.read(num_verts * vert_size)
                if len(vert_data) < num_verts * vert_size:
                    print(f"    ERROR: Expected {num_verts * vert_size} bytes, got {len(vert_data)}")
                    return
                
                # Print first vertex for verification
                if num_verts > 0:
                    vx, vy, vz = struct.unpack_from('<3f', vert_data, 0)
                    print(f"    First vertex pos: ({vx:.3f}, {vy:.3f}, {vz:.3f})")
                
                # Number of indices
                # If num_verts > 65535, indices are uint32, else uint16
                num_idx = struct.unpack('<H', f.read(2))[0]
                
                # Check if this might actually be uint32
                # In SPM: index count is uint16, but if the mesh uses 32-bit indices...
                # Actually from STK source: index count is always uint32 in SPMv10+
                # Let me re-read as uint32
                f.seek(-2, 1)
                num_idx = struct.unpack('<I', f.read(4))[0]
                
                print(f"    Num indices: {num_idx}")
                total_indices += num_idx
                
                if num_idx > 1000000:
                    # Might be wrong, try uint16 for index count
                    f.seek(-4, 1)
                    num_idx = struct.unpack('<H', f.read(2))[0]
                    print(f"    Retry as uint16 num_indices: {num_idx}")
                
                # Index size: uint16 if num_verts <= 65535, else uint32
                if num_verts > 65535:
                    idx_size = 4
                else:
                    idx_size = 2
                
                idx_data = f.read(num_idx * idx_size)
                if len(idx_data) < num_idx * idx_size:
                    print(f"    ERROR: Expected {num_idx * idx_size} idx bytes, got {len(idx_data)}")
                    return
                    
                print(f"    Index data read OK ({num_idx * idx_size} bytes)")
        
        print(f"\nTotal vertices: {total_verts}")
        print(f"Total indices: {total_indices}")
        remaining = file_size - f.tell()
        print(f"Bytes remaining: {remaining}")
        print(f"Current offset: {f.tell()}")

if __name__ == '__main__':
    main()
