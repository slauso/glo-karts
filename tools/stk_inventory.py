"""Extract track & arena inventory from the SuperTuxKart ZIP, including file sizes."""
import zipfile
import xml.etree.ElementTree as ET
import os

ZIP_PATH = r"third_party\SuperTuxKart-1.5-win.zip"
zf = zipfile.ZipFile(ZIP_PATH)

tracks = {}
arenas = {}

for name in zf.namelist():
    if "/data/tracks/" in name and name.endswith("/track.xml"):
        parts = name.split("/")
        idx = parts.index("tracks")
        track_id = parts[idx + 1]
        try:
            data = zf.read(name).decode("utf-8")
            root = ET.fromstring(data)
            info = {
                "name": root.get("name", track_id),
                "arena": root.get("arena", "false"),
                "soccer": root.get("soccer", "false"),
                "laps": root.get("default-number-of-laps", "3"),
                "groups": root.get("groups", ""),
                "designer": root.get("designer", ""),
                "music": root.get("music", ""),
            }
            if info["arena"] == "true" or info["soccer"] == "true":
                arenas[track_id] = info
            else:
                tracks[track_id] = info
        except Exception as e:
            print(f"  SKIP {track_id}: {e}")

# Compute file sizes per track/arena folder
def folder_size(prefix):
    total = 0
    file_count = 0
    spm_count = 0
    tex_count = 0
    for n in zf.namelist():
        if n.startswith(prefix):
            zi = zf.getinfo(n)
            total += zi.file_size
            file_count += 1
            if n.endswith(".spm"):
                spm_count += 1
            if n.endswith((".png", ".jpg", ".jpeg")):
                tex_count += 1
    return total, file_count, spm_count, tex_count

# Find the prefix for data/tracks/
prefix_base = None
for n in zf.namelist():
    if "/data/tracks/" in n:
        idx = n.index("/data/tracks/")
        prefix_base = n[:idx] + "/data/tracks/"
        break

print("=" * 120)
print(f"{'ID':35s} | {'Name':35s} | Laps | {'Size MB':>8s} | Files | SPMs | Texs | Groups")
print("=" * 120)

print("\n--- RACE TRACKS ---")
for tid in sorted(tracks.keys()):
    t = tracks[tid]
    sz, fc, sc, tc = folder_size(prefix_base + tid + "/")
    mb = sz / (1024 * 1024)
    print(f"{tid:35s} | {t['name']:35s} | {t['laps']:>4s} | {mb:7.1f}M | {fc:5d} | {sc:4d} | {tc:4d} | {t['groups']}")

print(f"\nTotal race tracks: {len(tracks)}")

print("\n--- ARENAS ---")
for aid in sorted(arenas.keys()):
    a = arenas[aid]
    kind = "soccer" if a["soccer"] == "true" else "battle"
    sz, fc, sc, tc = folder_size(prefix_base + aid + "/")
    mb = sz / (1024 * 1024)
    print(f"{aid:35s} | {a['name']:35s} | {kind:>6s} | {mb:7.1f}M | {fc:5d} | {sc:4d} | {tc:4d} | {a['groups']}")

print(f"\nTotal arenas: {len(arenas)}")

# Also check for quads.xml and graph.xml existence (needed for waypoints)
print("\n--- WAYPOINT DATA AVAILABILITY ---")
for tid in sorted(list(tracks.keys()) + list(arenas.keys())):
    prefix = prefix_base + tid + "/"
    has_quads = any(n == prefix + "quads.xml" for n in zf.namelist())
    has_graph = any(n == prefix + "graph.xml" for n in zf.namelist())
    has_navmesh = any("navmesh" in n.lower() for n in zf.namelist() if n.startswith(prefix))
    has_driveline = any("driveline" in n.lower() or "drivelines" in n.lower() for n in zf.namelist() if n.startswith(prefix))
    flags = []
    if has_quads: flags.append("quads.xml")
    if has_graph: flags.append("graph.xml")
    if has_navmesh: flags.append("navmesh")
    if has_driveline: flags.append("driveline")
    print(f"  {tid:35s} : {', '.join(flags) if flags else 'NONE'}")

zf.close()
