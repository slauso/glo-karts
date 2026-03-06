"""
stk_extract_track_data.py — Extract waypoints, navmesh, start grids, items, and
checkpoints from STK ZIP → track-data.json bundles for each imported track/arena.

Usage:
    python tools/stk_extract_track_data.py               # all imported tracks
    python tools/stk_extract_track_data.py cornfield_crossing  # single track
"""
import zipfile
import xml.etree.ElementTree as ET
import json
import os
import sys
import math
import re

ZIP_PATH = r"third_party\SuperTuxKart-1.5-win.zip"
TRACKS_OUT = r"frontend\public\models\stk\tracks"
ARENAS_OUT = r"frontend\public\models\stk\arenas"

# Detect base prefix inside the ZIP
zf = zipfile.ZipFile(ZIP_PATH)
PREFIX = None
for n in zf.namelist():
    if "/data/tracks/" in n:
        idx = n.index("/data/tracks/")
        PREFIX = n[:idx] + "/data/tracks/"
        break

# ── Helpers ──────────────────────────────────────────────────────────────────

def read_zip(path):
    """Read a file from the ZIP, return string or None."""
    try:
        return zf.read(path).decode("utf-8")
    except (KeyError, UnicodeDecodeError):
        return None


def parse_vec3(s):
    """Parse '1.23 4.56 7.89' → [x, y, z]."""
    parts = s.strip().split()
    return [float(parts[0]), float(parts[1]), float(parts[2])]


def vec3_mid(a, b):
    return [(a[0]+b[0])/2, (a[1]+b[1])/2, (a[2]+b[2])/2]


def vec3_sub(a, b):
    return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]


def vec3_dist(a, b):
    d = vec3_sub(a, b)
    return math.sqrt(d[0]**2 + d[1]**2 + d[2]**2)


def vec3_lerp(a, b, t):
    return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t]


# ── Quads Parser ─────────────────────────────────────────────────────────────

def parse_quads(xml_str):
    """Parse quads.xml → list of quads, each with 4 resolved 3D points."""
    root = ET.fromstring(xml_str)
    quads = []
    ref_re = re.compile(r'^(\d+):(\d+)$')

    for elem in root.findall("quad"):
        pts = []
        for key in ("p0", "p1", "p2", "p3"):
            val = elem.get(key)
            m = ref_re.match(val)
            if m:
                qi, pi = int(m.group(1)), int(m.group(2))
                pts.append(quads[qi][pi])
            else:
                pts.append(parse_vec3(val))
        quads.append(pts)
    return quads


def quad_center(q):
    return [(q[0][i]+q[1][i]+q[2][i]+q[3][i])/4 for i in range(3)]


def quad_width(q):
    """Width across the road (p0-p1 edge and p3-p2 edge average)."""
    w1 = vec3_dist(q[0], q[1])
    w2 = vec3_dist(q[3], q[2])
    return (w1 + w2) / 2


# ── Graph Parser ─────────────────────────────────────────────────────────────

def parse_graph(xml_str):
    """Parse graph.xml → {nodeCount, mainLoop: [from, to], edges: [[from, to]]}"""
    root = ET.fromstring(xml_str)
    result = {"nodeCount": 0, "mainLoop": None, "shortcuts": []}

    for nl in root.findall("node-list"):
        result["nodeCount"] = int(nl.get("to-quad", "0"))

    for el in root.findall("edge-loop"):
        result["mainLoop"] = [int(el.get("from")), int(el.get("to"))]

    # Shortcuts: edge + edge-line pairs
    shortcuts = []
    current_shortcut = None
    for child in root:
        if child.tag == "edge":
            f, t = int(child.get("from")), int(child.get("to"))
            if current_shortcut and current_shortcut.get("end_edge") is None:
                current_shortcut["end_edge"] = [f, t]
                shortcuts.append(current_shortcut)
                current_shortcut = None
            else:
                current_shortcut = {"start_edge": [f, t], "end_edge": None}
        elif child.tag == "edge-line":
            if current_shortcut:
                current_shortcut["line"] = [int(child.get("from")), int(child.get("to"))]

    if current_shortcut and current_shortcut.get("end_edge"):
        shortcuts.append(current_shortcut)
    result["shortcuts"] = shortcuts
    return result


# ── Navmesh Parser ───────────────────────────────────────────────────────────

def parse_navmesh(xml_str):
    """Parse navmesh.xml → {vertices: [[x,y,z]], faces: [[i0,i1,...]], adjacency: [[...]]}"""
    root = ET.fromstring(xml_str)
    vertices = []
    for v in root.find("vertices").findall("vertex"):
        vertices.append([float(v.get("x")), float(v.get("y")), float(v.get("z"))])

    faces = []
    adjacency = []
    faces_elem = root.find("faces")
    if faces_elem is not None:
        for f in faces_elem.findall("face"):
            # indices="301 179 88 208 " (space-separated, may have trailing space)
            idx_str = f.get("indices", "").strip()
            indices = [int(x) for x in idx_str.split() if x]
            if len(indices) >= 3:
                faces.append(indices)
            # adjacency for pathfinding
            adj_str = f.get("adjacents", "").strip()
            adj = [int(x) for x in adj_str.split() if x]
            adjacency.append(adj)

    return {"vertices": vertices, "faces": faces, "adjacency": adjacency}


# ── Item Parser (from scene.xml) ─────────────────────────────────────────────

def parse_items(xml_str):
    """Extract item/banana/nitro positions from scene.xml."""
    items = []
    for line in xml_str.split("\n"):
        line = line.strip()
        # Match <item ...>, <banana ...>, <small-nitro ...>, <big-nitro ...>
        for tag in ("item", "banana", "small-nitro", "big-nitro"):
            if line.startswith(f"<{tag} "):
                try:
                    # Parse as XML element
                    elem = ET.fromstring(line if line.endswith("/>") else line + "/>")
                    x = float(elem.get("x", 0))
                    y = float(elem.get("y", 0))
                    z = float(elem.get("z", 0))
                    h = float(elem.get("h", 0))
                    items.append({
                        "type": tag,
                        "position": [round(x, 3), round(y, 3), round(z, 3)],
                        "heading": round(h, 2)
                    })
                except Exception:
                    pass
    return items


# ── Start Grid Generator ────────────────────────────────────────────────────

def generate_start_grid(quads, count=12):
    """Generate staggered start positions from the first few quads."""
    if not quads:
        return []

    q0 = quads[0]
    # Start line center
    center = quad_center(q0)
    # Road direction: from quad 0 center to quad 2 center (forward)
    q_ahead = quads[min(2, len(quads)-1)]
    forward = vec3_sub(quad_center(q_ahead), center)
    heading = math.atan2(forward[0], forward[2])

    # Road width at start
    width = quad_width(q0)
    # Left edge midpoint and right edge midpoint
    left_mid = vec3_mid(q0[0], q0[3])
    right_mid = vec3_mid(q0[1], q0[2])

    positions = []
    rows = (count + 1) // 2  # 2 karts per row

    for row in range(rows):
        # Place rows behind the start line (negative forward direction)
        row_offset = -(row * 4.0 + 2.0)  # 4m spacing between rows, 2m behind line
        for col in range(2):
            if len(positions) >= count:
                break
            # Lateral position: 30% and 70% across the road
            t = 0.3 if col == 0 else 0.7
            base = vec3_lerp(left_mid, right_mid, t)
            # Apply row offset along forward direction
            fwd_norm = math.sqrt(forward[0]**2 + forward[2]**2)
            if fwd_norm > 0.001:
                fx, fz = forward[0]/fwd_norm, forward[2]/fwd_norm
            else:
                fx, fz = 0, 1
            pos = [
                round(base[0] + fx * row_offset, 3),
                round(base[1], 3),
                round(base[2] + fz * row_offset, 3)
            ]
            positions.append({
                "position": pos,
                "heading": round(heading, 4)
            })

    return positions


# ── Checkpoint Generator ─────────────────────────────────────────────────────

def generate_checkpoints(quads, graph):
    """Generate evenly spaced checkpoints from the quad driveline."""
    if not quads:
        return []

    total = graph["mainLoop"][1] if graph["mainLoop"] else len(quads)
    # ~10-15 checkpoints per lap
    step = max(1, total // 12)

    checkpoints = []
    # Quad 0 is always the lap/start line
    checkpoints.append({
        "quadIndex": 0,
        "isLapLine": True,
        "center": [round(c, 3) for c in quad_center(quads[0])],
        "width": round(quad_width(quads[0]), 2)
    })

    for i in range(step, total, step):
        if i < len(quads):
            checkpoints.append({
                "quadIndex": i,
                "isLapLine": False,
                "center": [round(c, 3) for c in quad_center(quads[i])],
                "width": round(quad_width(quads[i]), 2)
            })

    return checkpoints


# ── Driveline Generator ─────────────────────────────────────────────────────

def generate_driveline(quads):
    """Convert quads to a compact driveline array."""
    driveline = []
    for q in quads:
        c = quad_center(q)
        w = quad_width(q)
        driveline.append({
            "center": [round(c[0], 3), round(c[1], 3), round(c[2], 3)],
            "width": round(w, 2),
            "quad": [[round(v, 3) for v in p] for p in q]
        })
    return driveline


# ── Main Extract Function ────────────────────────────────────────────────────

def extract_race_track(track_id):
    """Extract full track-data.json for a race track."""
    base = PREFIX + track_id + "/"

    # Track metadata
    track_xml = read_zip(base + "track.xml")
    if not track_xml:
        print(f"  SKIP {track_id}: no track.xml")
        return None

    root = ET.fromstring(track_xml)
    name = root.get("name", track_id)
    laps = int(root.get("default-number-of-laps", "3"))
    is_arena = root.get("arena", "N").upper() in ("Y", "TRUE")

    if is_arena:
        return extract_arena(track_id)

    # Quads
    quads_xml = read_zip(base + "quads.xml")
    if not quads_xml:
        print(f"  WARN {track_id}: no quads.xml — waypoints unavailable")
        return {"id": track_id, "name": name, "type": "race", "laps": laps,
                "driveline": [], "graph": {}, "checkpoints": [], "startPositions": [], "items": []}

    quads = parse_quads(quads_xml)
    print(f"  {track_id}: {len(quads)} quads parsed")

    # Graph
    graph_xml = read_zip(base + "graph.xml")
    graph = parse_graph(graph_xml) if graph_xml else {"nodeCount": len(quads), "mainLoop": [0, len(quads)], "shortcuts": []}

    # Items from scene.xml
    scene_xml = read_zip(base + "scene.xml")
    items = parse_items(scene_xml) if scene_xml else []

    # Generate derived data
    driveline = generate_driveline(quads)
    checkpoints = generate_checkpoints(quads, graph)
    start_grid = generate_start_grid(quads, count=12)

    data = {
        "id": track_id,
        "name": name,
        "type": "race",
        "laps": laps,
        "driveline": driveline,
        "graph": {
            "nodeCount": graph["nodeCount"],
            "mainLoop": graph["mainLoop"],
            "shortcuts": graph["shortcuts"]
        },
        "checkpoints": checkpoints,
        "startPositions": start_grid,
        "items": items
    }

    return data


def extract_arena(track_id):
    """Extract full track-data.json for a battle arena."""
    base = PREFIX + track_id + "/"

    track_xml = read_zip(base + "track.xml")
    if not track_xml:
        print(f"  SKIP {track_id}: no track.xml")
        return None

    root = ET.fromstring(track_xml)
    name = root.get("name", track_id)

    # Navmesh
    navmesh_xml = read_zip(base + "navmesh.xml")
    navmesh = parse_navmesh(navmesh_xml) if navmesh_xml else {"vertices": [], "faces": [], "adjacency": []}
    if navmesh_xml:
        print(f"  {track_id}: {len(navmesh['vertices'])} verts, {len(navmesh['faces'])} faces in navmesh")
    else:
        print(f"  WARN {track_id}: no navmesh.xml")

    # Items
    scene_xml = read_zip(base + "scene.xml")
    items = parse_items(scene_xml) if scene_xml else []

    # Spawn positions from navmesh center area
    spawn = generate_arena_spawns(navmesh, count=12)

    data = {
        "id": track_id,
        "name": name,
        "type": "battle",
        "navmesh": {
            "vertices": [[round(v[0], 3), round(v[1], 3), round(v[2], 3)] for v in navmesh["vertices"]],
            "faces": navmesh["faces"],
            "adjacency": navmesh["adjacency"]
        },
        "spawnPositions": spawn,
        "items": items
    }

    return data


def generate_arena_spawns(navmesh, count=12):
    """Generate spawn positions spread across the navmesh."""
    verts = navmesh["vertices"]
    if not verts:
        return []

    # Find center of navmesh
    cx = sum(v[0] for v in verts) / len(verts)
    cy = sum(v[1] for v in verts) / len(verts)
    cz = sum(v[2] for v in verts) / len(verts)

    # Find average radius
    dists = [math.sqrt((v[0]-cx)**2 + (v[2]-cz)**2) for v in verts]
    avg_r = sum(dists) / len(dists) * 0.5  # Use 50% of average radius

    positions = []
    for i in range(count):
        angle = (2 * math.pi * i) / count
        pos = [
            round(cx + avg_r * math.cos(angle), 3),
            round(cy, 3),
            round(cz + avg_r * math.sin(angle), 3)
        ]
        heading = round(angle + math.pi, 4)  # Face inward
        positions.append({"position": pos, "heading": heading})

    return positions


# ── Discover imported tracks/arenas ──────────────────────────────────────────

def get_imported_tracks():
    """List track IDs that have GLB files in the output directories."""
    tracks = []
    if os.path.isdir(TRACKS_OUT):
        for d in os.listdir(TRACKS_OUT):
            glb = os.path.join(TRACKS_OUT, d, "track.glb")
            if os.path.isfile(glb):
                tracks.append(("track", d))
    if os.path.isdir(ARENAS_OUT):
        for d in os.listdir(ARENAS_OUT):
            glb = os.path.join(ARENAS_OUT, d, "arena.glb")
            if os.path.isfile(glb):
                tracks.append(("arena", d))
    return tracks


# ── CLI ──────────────────────────────────────────────────────────────────────

def main():
    target = sys.argv[1] if len(sys.argv) > 1 else None

    imported = get_imported_tracks()
    if target:
        imported = [(t, tid) for t, tid in imported if tid == target]
        if not imported:
            # Try both types
            imported = [("track", target)]

    print(f"Extracting track data for {len(imported)} tracks/arenas...")
    print("=" * 60)

    results = {"tracks": [], "arenas": []}

    for ttype, tid in imported:
        print(f"\n[{ttype.upper()}] {tid}")
        if ttype == "arena":
            data = extract_arena(tid)
            if data:
                out_dir = os.path.join(ARENAS_OUT, tid)
                os.makedirs(out_dir, exist_ok=True)
                out_path = os.path.join(out_dir, "track-data.json")
                with open(out_path, "w") as f:
                    json.dump(data, f, separators=(",", ":"))
                size_kb = os.path.getsize(out_path) / 1024
                print(f"  → {out_path} ({size_kb:.1f} KB)")
                results["arenas"].append(tid)
        else:
            data = extract_race_track(tid)
            if data:
                if data.get("type") == "battle":
                    # Was actually an arena in the tracks folder
                    out_dir = os.path.join(ARENAS_OUT, tid) if os.path.isdir(os.path.join(ARENAS_OUT, tid)) else os.path.join(TRACKS_OUT, tid)
                else:
                    out_dir = os.path.join(TRACKS_OUT, tid)
                os.makedirs(out_dir, exist_ok=True)
                out_path = os.path.join(out_dir, "track-data.json")
                with open(out_path, "w") as f:
                    json.dump(data, f, separators=(",", ":"))
                size_kb = os.path.getsize(out_path) / 1024
                print(f"  → {out_path} ({size_kb:.1f} KB)")
                results["tracks"].append(tid)

    print("\n" + "=" * 60)
    print(f"Done. {len(results['tracks'])} tracks + {len(results['arenas'])} arenas processed.")

    zf.close()

if __name__ == "__main__":
    main()
