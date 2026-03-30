#!/usr/bin/env python3
"""Inspect a GLB file's mesh/material/node structure."""
import json, struct, sys
from pathlib import Path

glb_path = sys.argv[1] if len(sys.argv) > 1 else 'frontend/public/models/stk/karts/gavroche/kart.glb'
data = Path(glb_path).read_bytes()

magic, ver, length = struct.unpack_from('<III', data, 0)
json_len, json_type = struct.unpack_from('<II', data, 12)
gltf = json.loads(data[20:20+json_len])

print('=== MESHES ===')
for i, m in enumerate(gltf.get('meshes', [])):
    prims = m.get('primitives', [])
    mat_indices = [p.get('material', 'none') for p in prims]
    print(f'  [{i}] {m.get("name","?")} -> materials: {mat_indices}')

print('\n=== MATERIALS ===')
for i, mat in enumerate(gltf.get('materials', [])):
    ds = mat.get('doubleSided', False)
    print(f'  [{i}] {mat.get("name","?")}  doubleSided={ds}')
    pbr = mat.get('pbrMetallicRoughness', {})
    bt = pbr.get('baseColorTexture', {})
    if bt:
        tex_idx = bt.get('index')
        if tex_idx is not None and tex_idx < len(gltf.get('textures', [])):
            src = gltf['textures'][tex_idx].get('source')
            if src is not None and src < len(gltf.get('images', [])):
                img = gltf['images'][src]
                print(f'       texture: {img.get("name","unnamed")} ({img.get("mimeType","?")})')

print('\n=== NODES ===')
for i, n in enumerate(gltf.get('nodes', [])):
    mesh_ref = n.get('mesh', '-')
    children = n.get('children', [])
    trans = n.get('translation', [])
    extra = ''
    if trans:
        extra += f' translation={trans}'
    if children:
        extra += f' children={children}'
    print(f'  [{i}] {n.get("name","?")}  mesh={mesh_ref}{extra}')

print('\n=== IMAGES ===')
for i, img in enumerate(gltf.get('images', [])):
    print(f'  [{i}] {img.get("name","unnamed")} ({img.get("mimeType","?")})')
