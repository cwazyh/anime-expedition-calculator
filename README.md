# Anime Expedition Calculator

A static, client-side calculator/database for the Roblox game **Anime Expeditions**.
Open `index.html` on GitHub Pages (or any static server) and everything runs in the
browser: the JSON files are the single source of truth, and the DPS calculation is
performed live by JavaScript — no build step, no backend.

## Structure

```
index.html               # the whole site (markup + CSS)
js/calculator.js         # DPS calculator (JS port of dps_calculator.py)
js/app.js                # data loading, rendering, tooltips, live calculation
manifest.json            # lists every unit / equipment / trait NAME only
Units/<name> Data/
    <name>_data.json     # stats, upgrades, passives, abilities, summons, status
                         # effects (incl. DoT), traits, equipment, obtainable...
    <name>_image.png
Equipments/<name> Data/
    <name>_data.json     # buffs (stat ranges), passives, unit bounds
    <name>_image.png
Traits/<name> Data/
    <name>_data.json     # trait stats (Damage / SPA / Crit / Range / PlacementLimit)
    <name>_image.png
Logos/<element>.png      # element icons (lowercase: hydro.png, flame.png, ...)
UI/                      # site chrome (expeditions_wheel.png, EntityBox_Dark.png)
utils/                   # data pipeline scripts (see below)
```

All paths are **derived by convention** from names in `manifest.json`, so adding a
new unit/equipment/trait only requires creating its folder and updating the manifest.

## How the site uses the data

- **`obtainable`** is read from the unit's `_data.json` — edit the JSON directly to
  flip a unit between obtainable/unobtainable. Nothing is hardcoded elsewhere.
- **Deploy / max-upgrade cost**: curated values stored in the unit JSON always win.
  If a non-placeholder unit has `deploy`/`cost` set to `null`, they are derived at
  runtime: `deploy = upgrades[0].cost`, `cost = sum(upgrades[1:])`. Placeholder
  cards keep showing "—".
- **Traits / equipment / TDPS on cards**: only units flagged `"calculated": true`
  (currently only *Traitor (Illusion)*) show them, computed **live** in the
  browser — DPS is reviewed unit by unit. Every other unit ships without these
  suggestions (`traits: []`, `equipment: []`, `tdps: null`) and renders
  "TBD"/"—". Descriptions, deploy and upgrade costs stay: they are directly
  verifiable game data, not calculator output.
- **`placeholder": true`** marks cards whose data is not final; they show a
  "placeholder" pill, sort last, and don't derive costs.

## DPS calculation (live, client-side)

`js/calculator.js` is a faithful port of `dps_calculator.py` (verified: all 17
traits match the Python output exactly, including the live-game validation anchor
`D=81470, SPA=6.2, DPS=13140.32`):

```
D   = round1(base_DMG × level_mult × (1+asc_dmg) × (1+pot_dmg) × (1+trait_dmg) × (1+equip_dmg))
SPA = round1(base_SPA × (1+trait_spa) × (1+pot_spa) × (1+equip_spa))
DPS = round2(D / SPA × crit_mult × passive_mult)
```

Settings: Level 50, Ascension 3, Potential Z, equipment rolls MAX (including
equipment passives — Shinigami Sword at 15/15), expected crit, no duplicate
equipment, `enemies_in_range = 4`. Placements are always at MAX — they are not
a variable.

The **Variables** block in each unit's modal decides what the calculation
includes: every passive has an on/off toggle (a disabled passive is left out of
the DPS), *Hypnotized enemies* defaults to **0** — the Hypnosis buff is OFF
until the user raises it (it only affects BleachCategory units, i.e. Aizen) —
and *Theoretic max buff* turns every variable to its cap (hypnosis share 100%).
The settings are saved in `localStorage` and survive a reload.

Because everything is read from the JSONs at runtime, **new units, equipment and
traits are picked up automatically** — no code changes needed.

## Adding or updating content

1. Create `Units/<name> Data/` (or `Equipments/`, `Traits/`) with
   `<name>_data.json` and `<name>_image.png` (always `.png`, images have alpha).
2. Regenerate the manifest:

   ```bash
   python3 utils/update_manifest.py
   ```

   The script refuses to write if any folder is missing its JSON or image.
3. Commit and push. GitHub Pages serves it as-is (`.nojekyll` disables Jekyll).

Other pipeline scripts in `utils/` (`extract_all_units.py`, `download_images.py`,
`extract_units.py`) document how the data/images were originally harvested and can
be reused as a reference.

## Notes

- **Buff element icon**: the game itself does not define one
  (`InvalidElements = {Farm, Buff}` — and Farm's icon exists while Buff's does not),
  so `Logos/buff.png` is the only asset that may be missing. The UI degrades
  gracefully to a text-only element chip until the file is added.
- Element icons in `Logos/` are the original 512×512 icons pulled from the live
  game (`ReplicatedStorage.Shared.Information.Elements` → `ElementData[el].Image`).
- The page must be served over HTTP (GitHub Pages or `python3 -m http.server`);
  opening it as a `file://` will fail because of `fetch()`.
