import json, sys

rows = json.load(open('audit_inventory.json'))
start = int(sys.argv[1]) if len(sys.argv) > 1 else 0
end = int(sys.argv[2]) if len(sys.argv) > 2 else len(rows)

for i, r in enumerate(rows[start:end], start):
    print('=' * 78)
    print(f"[{i}] {r['name']}  ({r['rarity']}/{r['archetype']}/{r['element']})  "
          f"model={'YES' if r['has_model'] else 'no'} noDPS={'Y' if r['no_dps'] else 'n'} "
          f"p{r['n_passives']}a{r['n_abilities']}dot{r['n_dots']}")
    if r['dots']:
        print('  DoT: ' + ' | '.join(
            f"{x['key']} scaling={x['scaling']} ticks={x['ticks']} dur={x['duration']}s "
            f"update={x['update']} stack={x['stack']} tags={x['tags']}" for x in r['dots']))
    for p in r['passives']:
        print(f"  PASSIVE {p['name']} / {p['display']}: {p['desc'][:400]}")
    for a in r['abilities']:
        print(f"  ABILITY {a['name']} / {a['display']}: {a['desc'][:400]}")
    if r['model']:
        print('  --- MODEL ---')
        for line in r['model'].split('\n'):
            print('    ' + line.rstrip()[:200])
