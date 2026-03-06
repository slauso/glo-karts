import zipfile, xml.etree.ElementTree as ET
zf = zipfile.ZipFile('third_party/SuperTuxKart-1.5-win.zip')
for tid in ['battleisland','lasdunasarena','pumpkin_park','cave','alien_signal',
            'stadium','temple','arena_candela_city','ancient_colosseum_labyrinth',
            'hole_drop','oasis','icy_soccer_field','soccer_field','xr_soccer',
            'lasdunassoccer']:
    for n in zf.namelist():
        if n.endswith('/' + tid + '/track.xml'):
            data = zf.read(n).decode('utf-8')
            root = ET.fromstring(data)
            a = root.get('arena', 'N/A')
            s = root.get('soccer', 'N/A')
            g = root.get('groups', 'N/A')
            nm = root.get('name', tid)
            print(f"  {tid:40s} arena={a:6s} soccer={s:6s} groups={g:20s} => {nm}")
            break
zf.close()
