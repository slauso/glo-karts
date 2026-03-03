import zipfile, re

with zipfile.ZipFile(r"C:\Users\laptop\GLOKarts\third_party\SuperTuxKart-1.5-win.zip") as zf:
    nl = zf.namelist()
    arenas = []
    for n in nl:
        if n.endswith("track.xml") and "/tracks/" in n:
            try:
                with zf.open(n) as f:
                    c = f.read().decode("utf-8", errors="replace")
                m = re.search(r'arena\s*=\s*"([^"]+)"', c, re.I)
                if m and m.group(1).lower() in ("true","yes","1","y"):
                    tid = n.split("/tracks/")[1].split("/")[0]
                    namem = re.search(r'name\s*=\s*"([^"]+)"', c, re.I)
                    name = namem.group(1) if namem else tid
                    arenas.append((tid, name))
            except:
                pass
    print("ARENAS:")
    for a, nm in sorted(arenas):
        print(f"  {a!r:35s} -> {nm!r}")
    
    print("\nKARTS:")
    for n in nl:
        if "/karts/" in n and n.endswith("kart.xml"):
            tid = n.split("/karts/")[1].split("/")[0]
            try:
                with zf.open(n) as f:
                    c = f.read().decode("utf-8", errors="replace")
                nm = re.search(r'name\s*=\s*"([^"]+)"', c, re.I)
                print(f"  {tid!r:25s} -> {nm.group(1)!r}")
            except:
                print(f"  {tid!r}")
