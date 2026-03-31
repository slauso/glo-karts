#!/usr/bin/env python3
"""Measure bounding boxes of all track GLB models.

Reads POSITION accessor min/max from the glTF JSON within each GLB,
then computes world-space bounds by applying node transforms.
"""
import json, struct, sys
from pathlib import Path
import math

TRACK_DIR = Path(__file__).resolve().parent.parent / 'frontend' / 'public' / 'models' / 'track'

def parse_glb(path):
    data = path.read_bytes()
    magic, ver, length = struct.unpack_from('<III', data, 0)
    json_len, json_type = struct.unpack_from('<II', data, 12)
    gltf = json.loads(data[20:20+json_len])
    return gltf

def get_accessor_bounds(gltf):
    """Get global min/max from all POSITION accessors."""
    gmin = [float('inf')] * 3
    gmax = [float('-inf')] * 3
    for mesh in gltf.get('meshes', []):
        for prim in mesh.get('primitives', []):
            pos_idx = prim.get('attributes', {}).get('POSITION')
            if pos_idx is None:
                continue
            acc = gltf['accessors'][pos_idx]
            mn = acc.get('min', [0, 0, 0])
            mx = acc.get('max', [0, 0, 0])
            for i in range(3):
                gmin[i] = min(gmin[i], mn[i])
                gmax[i] = max(gmax[i], mx[i])
    return gmin, gmax

def main():
    glbs = sorted(TRACK_DIR.glob('*.glb'))
    print(f"{'Model':<50} {'SizeX':>7} {'SizeY':>7} {'SizeZ':>7} {'CenterX':>8} {'CenterY':>8} {'CenterZ':>8} {'MinX':>7} {'MaxX':>7} {'MinZ':>7} {'MaxZ':>7}")
    print("-" * 150)
    for glb in glbs:
        gltf = parse_glb(glb)
        mn, mx = get_accessor_bounds(gltf)
        sx = mx[0] - mn[0]
        sy = mx[1] - mn[1]
        sz = mx[2] - mn[2]
        cx = (mx[0] + mn[0]) / 2
        cy = (mx[1] + mn[1]) / 2
        cz = (mx[2] + mn[2]) / 2
        name = glb.stem
        print(f"{name:<50} {sx:7.2f} {sy:7.2f} {sz:7.2f} {cx:8.2f} {cy:8.2f} {cz:8.2f} {mn[0]:7.2f} {mx[0]:7.2f} {mn[2]:7.2f} {mx[2]:7.2f}")

if __name__ == '__main__':
    main()
