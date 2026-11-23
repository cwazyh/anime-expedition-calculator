import json, glob, re

src = open('js/passives.js').read()
model_re = re.compile(r'A\.registerPassives\("([^"]+)",\s*\{(.*?)\n\s*\}\);', re.S)
models = {m.group(1): m.group(2) for m in model_re.finditer(src)}
nodps_re = re.compile(r'A\.registerNoDps\("([^"]+)"', re.S)
nodps = set(nodps_re.findall(src))

rows = []
for p in sorted(glob.glob('Units/*/*_data.json')):
    d = json.load(open(p))
    name = d['unit_name']
    ps = d.get('passives') or []
    ab = d.get('abilities') or []
    sfx = d.get('status_effects') or {}
    # DoT effects relevant to DPS (Damage tag, scaling>0)
    dots = []
    for k, v in sfx.items():
        if isinstance(v, dict) and 'Damage' in (v.get('tags') or []) and (v.get('scaling') or 0) > 0:
            dots.append({'key': k, 'display': v.get('display_name'), 'scaling': v.get('scaling'),
                         'ticks': v.get('ticks'), 'duration': v.get('duration'),
                         'update': v.get('update'), 'stack': v.get('stack'),
                         'tags': v.get('tags')})
    row = {
        'name': name, 'rarity': d.get('rarity'),
        'archetype': d.get('archetype'), 'element': d.get('element'),
        'n_passives': len(ps), 'n_abilities': len(ab), 'n_dots': len(dots),
        'has_model': name in models, 'no_dps': name in nodps,
        'passives': [{'name': x.get('name'), 'display': x.get('display_name'),
                      'desc': (x.get('description') or '').replace('\n', ' ').strip()} for x in ps],
        'abilities': [{'name': x.get('name'), 'display': x.get('display_name'),
                       'desc': (x.get('description') or '').replace('\n', ' ').strip()} for x in ab],
        'dots': dots,
        'model': models.get(name),
    }
    rows.append(row)

rows.sort(key=lambda r: (r['n_passives'] + r['n_abilities'] + r['n_dots'], r['name']))
json.dump(rows, open('audit_inventory.json', 'w'), indent=1)
print('TOTAL:', len(rows), 'MODELS:', sum(r['has_model'] for r in rows),
      'NODPS:', sum(r['no_dps'] for r in rows),
      'WITH_DOTS:', sum(r['n_dots'] > 0 for r in rows))
print('\n=== UNITS WITH DoT EFFECTS ===')
for r in rows:
    if r['n_dots']:
        ds = ', '.join(f"{x['key']}({x['scaling']}x/{x['ticks']}tk/{x['duration']}s)" for x in r['dots'])
        print(f"  {r['name']:30s} model={'Y' if r['has_model'] else 'n'} p{r['n_passives']}a{r['n_abilities']}: {ds}")
