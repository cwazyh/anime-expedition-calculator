const fs = require('fs');
const A = require('./js/calculator.js');
require('./js/passives.js');

const manifest = JSON.parse(fs.readFileSync('manifest.json'));
const unit = JSON.parse(fs.readFileSync('Units/Wolf (Revived) Data/Wolf (Revived)_data.json'));

const traits = {};
for (const n of manifest.traits) {
  traits[n] = JSON.parse(fs.readFileSync(`Traits/${n} Data/${n}_data.json`));
}
const equipments = {};
for (const n of manifest.equipments) {
  equipments[n] = JSON.parse(fs.readFileSync(`Equipments/${n} Data/${n}_data.json`));
}

const varDefs = A.unitVars('Wolf (Revived)') || [];
const T = { enemies_in_range: 4, passive_state: {}, hypnosis_target_share: 0 };
for (const d of varDefs) T[d.key] = d.def;

const calc = A.createCalculator({ unit, traits, equipments, T });
const table = calc.traitTable();
console.log('TRAITS:', Object.keys(traits).length, 'EQUIPMENTS:', Object.keys(equipments).length);
console.log('VARS:', varDefs.map(d => `${d.key}=${d.def}`).join(', '));
console.log('INFO:', JSON.stringify(calc.info.base), 'slots=' + calc.info.slots);
console.log('--- TOP 5 TRAIT ROWS ---');
for (const row of table.slice(0, 5)) {
  const b = row.bound ? [row.bound] : [];
  console.log(`${row.trait} | TDPS=${row.res.dps} | dmg=${row.res.dmg} spa=${row.res.spa} pmult=${row.res.passive_mult} | bound=${row.bound || '-'} combo=[${row.combo.join(', ')}]`);
}
const best = table[0];
console.log('--- BEST ---');
console.log(JSON.stringify({ trait: best.trait, bound: best.bound, combo: best.combo,
  dps: best.res.dps, dmg: best.res.dmg, spa: best.res.spa, rng: best.res.rng,
  crit: best.res.crit_mult, pmult: best.res.passive_mult }, null, 2));
console.log('NOTES:');
(best.res.notes || []).forEach(n => console.log(' - ' + n));
