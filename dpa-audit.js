"use strict";
const fs = require("fs");
const path = require("path");
const AECalc = require("./js/calculator.js");
require("./js/passives.js");

const unitsDir = path.join(__dirname, "Units");
const rows = [];
for (const folder of fs.readdirSync(unitsDir)) {
  const dir = path.join(unitsDir, folder);
  if (!fs.statSync(dir).isDirectory()) continue;
  const files = fs.readdirSync(dir).filter(f => f.endsWith("_data.json"));
  if (!files.length) continue;
  let unit;
  try { unit = JSON.parse(fs.readFileSync(path.join(dir, files[0]), "utf8")); }
  catch (e) { rows.push({ name: folder, error: String(e) }); continue; }
  const upg = unit.upgrades[unit.upgrades.length - 1];
  const calc = AECalc.createCalculator({ unit, traits: {}, equipments: {} });
  const raw = calc.calc(null, [], { withPassives: false, withEquipment: false });
  const full = calc.calc(null, [], { withEquipment: false });
  rows.push({
    name: unit.unit_name,
    rarity: unit.rarity,
    arch: unit.archetype,
    lvl: upg.level,
    baseDmg: upg.damage,
    baseSpa: upg.spa,
    baseRng: upg.range,
    baseCc: upg.crit_chance,
    baseCd: upg.crit_damage,
    dmg: raw.dmg,
    spa: raw.spa,
    rng: raw.rng,
    crit: raw.crit_mult,
    rawDps: raw.dps,
    passiveMult: full.passive_mult,
    fullDps: full.dps,
    notes: full.notes.length
  });
}
rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
console.log(JSON.stringify(rows, null, 1));
