"""Classify tracks vs arenas from the STK ZIP more accurately."""
import zipfile
import xml.etree.ElementTree as ET

ZIP_PATH = r"third_party\SuperTuxKart-1.5-win.zip"
zf = zipfile.ZipFile(ZIP_PATH)

prefix_base = None
for n in zf.namelist():
    if "/data/tracks/" in n:
        idx = n.index("/data/tracks/")
        prefix_base = n[:idx] + "/data/tracks/"
        break

EXCLUDE = {
    "endcutscene", "featunlocked", "gplose", "gpwin",
    "introcutscene", "introcutscene2", "overworld", "tutorial"
}

races = []
arenas = []
soccer = []

for name in sorted(zf.namelist()):
    if name.startswith(prefix_base) and name.endswith("/track.xml"):
        tid = name[len(prefix_base):].split("/")[0]
        if tid in EXCLUDE:
            continue
        try:
            data = zf.read(name).decode("utf-8")
            root = ET.fromstring(data)
            is_arena = root.get("arena", "false") == "true"
            is_soccer = root.get("soccer", "false") == "true"
            track_name = root.get("name", tid)

            prefix = prefix_base + tid + "/"
            has_quads = any(n == prefix + "quads.xml" for n in zf.namelist())
            has_graph = any(n == prefix + "graph.xml" for n in zf.namelist())
            has_navmesh = any("navmesh" in n.lower() for n in zf.namelist() if n.startswith(prefix))

            wp = "quads+graph" if (has_quads and has_graph) else ("navmesh" if has_navmesh else "none")
            total_size = sum(zf.getinfo(f).file_size for f in zf.namelist() if f.startswith(prefix))
            mb = total_size / (1024*1024)

            row = (tid, track_name, wp, mb)
            if is_soccer:
                soccer.append(row)
            elif is_arena:
                arenas.append(row)
            else:
                races.append(row)
        except:
            pass

print("=== RACE TRACKS (quads+graph for AI waypoints) ===")
for tid, name, wp, mb in sorted(races, key=lambda x: x[3]):
    flag = "OK" if wp == "quads+graph" else "NO-WAYPOINTS"
    print(f"  {tid:35s} {name:35s} {mb:5.1f}MB  wp={wp:15s} [{flag}]")
print(f"  Total: {len(races)}")

print("\n=== BATTLE ARENAS (navmesh for AI) ===")
for tid, name, wp, mb in sorted(arenas, key=lambda x: x[3]):
    flag = "OK" if wp == "navmesh" else ("ALT" if wp == "quads+graph" else "NO-NAV")
    print(f"  {tid:35s} {name:35s} {mb:5.1f}MB  wp={wp:15s} [{flag}]")
print(f"  Total: {len(arenas)}")

print("\n=== SOCCER FIELDS ===")
for tid, name, wp, mb in sorted(soccer, key=lambda x: x[3]):
    print(f"  {tid:35s} {name:35s} {mb:5.1f}MB  wp={wp}")
print(f"  Total: {len(soccer)}")

zf.close()
