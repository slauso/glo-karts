"""
Deep analysis of all STK tracks for browser suitability scoring.
Extracts: geometry complexity, texture count/size, waypoint data type, track dimensions.
"""
import zipfile
import xml.etree.ElementTree as ET
import struct
import json

ZIP_PATH = r"third_party\SuperTuxKart-1.5-win.zip"
zf = zipfile.ZipFile(ZIP_PATH)

# Find base prefix
prefix_base = None
for n in zf.namelist():
    if "/data/tracks/" in n:
        idx = n.index("/data/tracks/")
        prefix_base = n[:idx] + "/data/tracks/"
        break

# Non-game tracks to exclude (cutscenes, menus, etc.)
EXCLUDE = {
    "endcutscene", "featunlocked", "gplose", "gpwin",
    "introcutscene", "introcutscene2", "overworld", "tutorial"
}

def analyze_track(track_id):
    prefix = prefix_base + track_id + "/"
    files = [n for n in zf.namelist() if n.startswith(prefix)]

    # Parse track.xml
    track_xml_path = prefix + "track.xml"
    try:
        data = zf.read(track_xml_path).decode("utf-8")
        root = ET.fromstring(data)
    except:
        return None

    name = root.get("name", track_id)
    is_arena = root.get("arena", "N").upper() in ("Y", "TRUE")
    is_soccer = root.get("soccer", "N").upper() in ("Y", "TRUE")
    laps = root.get("default-number-of-laps", "3")
    groups = root.get("groups", "")

    # Classify
    if is_arena or is_soccer:
        track_type = "soccer" if is_soccer else "battle"
    else:
        track_type = "race"

    # File analysis
    spm_files = [f for f in files if f.endswith(".spm")]
    tex_files = [f for f in files if f.endswith((".png", ".jpg", ".jpeg"))]
    xml_files = [f for f in files if f.endswith(".xml")]
    b3d_files = [f for f in files if f.endswith(".b3d")]

    total_size = sum(zf.getinfo(f).file_size for f in files)
    spm_size = sum(zf.getinfo(f).file_size for f in spm_files)
    tex_size = sum(zf.getinfo(f).file_size for f in tex_files)

    # Count vertices in SPM files (read header)
    total_verts = 0
    total_tris = 0
    for spm_path in spm_files:
        try:
            raw = zf.read(spm_path)
            if len(raw) < 24:
                continue
            magic = raw[:2]
            if magic != b"SP":
                continue
            # SPM header: SP(2) + version(1) + type(1) + header_skip...
            # Version 1: after magic(2)+version(1)+type(1), next bytes depend on format
            # Let's just count raw file size as proxy for complexity
        except:
            pass
    # Use SPM file count and size as complexity proxy instead
    # (parsing every SPM header is complex due to version differences)

    # Waypoint data
    has_quads = any(n == prefix + "quads.xml" for n in files)
    has_graph = any(n == prefix + "graph.xml" for n in files)
    has_navmesh = any("navmesh" in n.lower() for n in files)
    has_driveline = any("driveline" in n.lower() for n in files)

    waypoint_type = "none"
    if has_quads and has_graph:
        waypoint_type = "quads+graph"
    elif has_navmesh:
        waypoint_type = "navmesh"

    # Scene graph complexity (count objects in scene.xml if exists)
    scene_objects = 0
    scene_xml = prefix + "scene.xml"
    if scene_xml in [f for f in files]:
        try:
            sdata = zf.read(scene_xml).decode("utf-8")
            # Count object nodes
            scene_objects = sdata.count("<static-object")
            scene_objects += sdata.count("<object")
            scene_objects += sdata.count("<library")
        except:
            pass

    # Texture resolution analysis (read PNG headers for dimensions)
    max_tex_size = 0
    tex_details = []
    for tf in tex_files[:5]:  # Sample first 5 textures
        try:
            raw = zf.read(tf)
            if raw[:4] == b"\x89PNG":
                # PNG: width at bytes 16-20, height at 20-24
                w = struct.unpack(">I", raw[16:20])[0]
                h = struct.unpack(">I", raw[20:24])[0]
                tex_details.append(f"{w}x{h}")
                max_tex_size = max(max_tex_size, w * h)
        except:
            pass

    return {
        "id": track_id,
        "name": name,
        "type": track_type,
        "laps": int(laps) if laps.isdigit() else 3,
        "groups": groups,
        "total_size_mb": round(total_size / (1024 * 1024), 1),
        "spm_count": len(spm_files),
        "spm_size_mb": round(spm_size / (1024 * 1024), 1),
        "tex_count": len(tex_files),
        "tex_size_mb": round(tex_size / (1024 * 1024), 1),
        "total_files": len(files),
        "scene_objects": scene_objects,
        "waypoints": waypoint_type,
        "max_tex_pixels": max_tex_size,
        "sample_tex_sizes": tex_details,
        "has_b3d": len(b3d_files) > 0,
    }


# Analyze all tracks
results = []
for n in sorted(zf.namelist()):
    if n.startswith(prefix_base) and n.endswith("/track.xml"):
        tid = n[len(prefix_base):].split("/")[0]
        if tid in EXCLUDE:
            continue
        info = analyze_track(tid)
        if info:
            results.append(info)

# Separate race tracks and arenas/soccer
race_tracks = [r for r in results if r["type"] == "race"]
battle_arenas = [r for r in results if r["type"] == "battle"]
soccer_fields = [r for r in results if r["type"] == "soccer"]

# Browser suitability scoring
# Criteria (lower = better for browser):
#   - Total size: <5MB = great, 5-10 = ok, 10-20 = heavy, >20 = very heavy
#   - SPM count: <15 = simple, 15-30 = moderate, >30 = complex
#   - Texture count: <10 = lean, 10-20 = moderate, >20 = heavy
#   - Scene objects: <50 = sparse, 50-150 = moderate, >150 = dense
#   - Waypoints: quads+graph = best for racing, navmesh = best for arenas

def browser_score(t):
    score = 100
    # Size penalty
    if t["total_size_mb"] > 20: score -= 40
    elif t["total_size_mb"] > 10: score -= 25
    elif t["total_size_mb"] > 5: score -= 10

    # Geometry complexity
    if t["spm_count"] > 50: score -= 30
    elif t["spm_count"] > 25: score -= 15
    elif t["spm_count"] > 15: score -= 5

    # Texture overhead
    if t["tex_count"] > 40: score -= 25
    elif t["tex_count"] > 20: score -= 15
    elif t["tex_count"] > 10: score -= 5

    # Scene density
    if t["scene_objects"] > 200: score -= 20
    elif t["scene_objects"] > 100: score -= 10
    elif t["scene_objects"] > 50: score -= 5

    # Waypoint bonus (essential for racing AI)
    if t["type"] == "race":
        if t["waypoints"] == "quads+graph": score += 10
        elif t["waypoints"] == "navmesh": score += 5
        else: score -= 20  # no waypoints = can't do AI racing
    else:
        if t["waypoints"] == "navmesh": score += 10
        elif t["waypoints"] == "quads+graph": score += 5

    return max(0, min(100, score))


print("=" * 140)
print("COMPREHENSIVE STK TRACK ANALYSIS FOR BROWSER SUITABILITY")
print("=" * 140)

print("\n{'='*60}")
print("RACE TRACKS (sorted by browser suitability score)")
print("=" * 140)
print(f"{'Score':>5s} | {'ID':30s} | {'Name':30s} | {'Size':>6s} | SPMs | Texs | Scene | Waypoints     | Laps")
print("-" * 140)

for t in sorted(race_tracks, key=lambda x: browser_score(x), reverse=True):
    s = browser_score(t)
    tier = "★★★" if s >= 80 else ("★★☆" if s >= 60 else ("★☆☆" if s >= 40 else "☆☆☆"))
    print(f"{s:>4d}{tier} | {t['id']:30s} | {t['name']:30s} | {t['total_size_mb']:5.1f}M | {t['spm_count']:4d} | {t['tex_count']:4d} | {t['scene_objects']:5d} | {t['waypoints']:13s} | {t['laps']}")

print(f"\nTotal race tracks: {len(race_tracks)}")

print("\n" + "=" * 140)
print("BATTLE ARENAS (sorted by browser suitability score)")
print("=" * 140)
print(f"{'Score':>5s} | {'ID':30s} | {'Name':30s} | {'Size':>6s} | SPMs | Texs | Scene | Waypoints")
print("-" * 140)

for t in sorted(battle_arenas, key=lambda x: browser_score(x), reverse=True):
    s = browser_score(t)
    tier = "★★★" if s >= 80 else ("★★☆" if s >= 60 else ("★☆☆" if s >= 40 else "☆☆☆"))
    print(f"{s:>4d}{tier} | {t['id']:30s} | {t['name']:30s} | {t['total_size_mb']:5.1f}M | {t['spm_count']:4d} | {t['tex_count']:4d} | {t['scene_objects']:5d} | {t['waypoints']:13s}")

print(f"\nTotal battle arenas: {len(battle_arenas)}")

print("\n" + "=" * 140)
print("SOCCER FIELDS")
print("=" * 140)
for t in sorted(soccer_fields, key=lambda x: browser_score(x), reverse=True):
    s = browser_score(t)
    print(f"{s:>4d} | {t['id']:30s} | {t['name']:30s} | {t['total_size_mb']:5.1f}M | {t['spm_count']:4d} | {t['tex_count']:4d}")
print(f"\nTotal soccer fields: {len(soccer_fields)}")

# Summary recommendations
print("\n" + "=" * 140)
print("BROWSER TIER RECOMMENDATIONS")
print("=" * 140)

tier1 = [t for t in race_tracks if browser_score(t) >= 80]
tier2 = [t for t in race_tracks if 60 <= browser_score(t) < 80]
tier3 = [t for t in race_tracks if 40 <= browser_score(t) < 60]
reject = [t for t in race_tracks if browser_score(t) < 40]

print(f"\n★★★ TIER 1 - Browser Ideal ({len(tier1)} tracks):")
for t in tier1:
    print(f"  {t['name']:30s} ({t['total_size_mb']:.1f}MB, {t['spm_count']} meshes, {t['tex_count']} textures)")

print(f"\n★★☆ TIER 2 - Browser Suitable ({len(tier2)} tracks):")
for t in tier2:
    print(f"  {t['name']:30s} ({t['total_size_mb']:.1f}MB, {t['spm_count']} meshes, {t['tex_count']} textures)")

print(f"\n★☆☆ TIER 3 - Heavy but Possible ({len(tier3)} tracks):")
for t in tier3:
    print(f"  {t['name']:30s} ({t['total_size_mb']:.1f}MB, {t['spm_count']} meshes, {t['tex_count']} textures)")

print(f"\n☆☆☆ REJECT - Too Heavy for Browser ({len(reject)} tracks):")
for t in reject:
    print(f"  {t['name']:30s} ({t['total_size_mb']:.1f}MB, {t['spm_count']} meshes, {t['tex_count']} textures)")

# Arena tiers
a_tier1 = [t for t in battle_arenas if browser_score(t) >= 80]
a_tier2 = [t for t in battle_arenas if 60 <= browser_score(t) < 80]
print(f"\n★★★ ARENA TIER 1 ({len(a_tier1)}):")
for t in a_tier1:
    print(f"  {t['name']:30s} ({t['total_size_mb']:.1f}MB, {t['spm_count']} meshes)")
print(f"\n★★☆ ARENA TIER 2 ({len(a_tier2)}):")
for t in a_tier2:
    print(f"  {t['name']:30s} ({t['total_size_mb']:.1f}MB, {t['spm_count']} meshes)")

# JSON export
output = {
    "race_tracks": [{**t, "browser_score": browser_score(t)} for t in sorted(race_tracks, key=lambda x: browser_score(x), reverse=True)],
    "battle_arenas": [{**t, "browser_score": browser_score(t)} for t in sorted(battle_arenas, key=lambda x: browser_score(x), reverse=True)],
    "soccer_fields": [{**t, "browser_score": browser_score(t)} for t in sorted(soccer_fields, key=lambda x: browser_score(x), reverse=True)],
}
with open("tools/stk_track_analysis.json", "w") as f:
    json.dump(output, f, indent=2)
print("\n\nJSON data saved to tools/stk_track_analysis.json")

zf.close()
