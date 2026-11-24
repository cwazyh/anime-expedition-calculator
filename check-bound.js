const fs = require('fs');
const A = require('./js/calculator.js');
require('./js/passives.js');

const name = process.argv[2] || '8th Sword (Berserk)';
const bound = process.argv[3] || 'Hair Bells';
const files = fs.readdirSync('Units', { recursive: true }).filter(f => f.endsWith('_data.json'));
const path = files.find(f => f.includes(name + '_data.json'));
const u = JSON.parse(fs.readFileSync('Units/' + path));

// load bound equipment data so ctx.bound can be recognized
const eqFiles = fs.readdirSync('Equipments', { recursive: true }).filter(f => f.endsWith('_data.json'));
const eqPath = eqFiles.find(f => f.includes(bound + '_data.json'));
const eq = eqPath ? JSON.parse(fs.readFileSync('Equipments/' + eqPath)) : null;
const equipments = {};
if (eq) equipments[bound] = eq;

const calc = A.createCalculator({ unit: u, traits: {}, equipments: equipments });
function show(label, combo) {
  const r = calc.calc(null, combo, {});
  console.log(label + ': dmg=' + r.dmg + ' spa=' + r.spa + ' rng=' + r.rng +
    ' base_dps=' + r.base_dps.toFixed(2) + ' dps=' + r.dps.toFixed(2));
  (r.notes || []).forEach(n => console.log('   - ' + n));
}
show('NO BOUND  (combo=[])', []);
if (eq) show('WITH BOUND (combo=[Hair Bells])', [bound]);
else console.log('EQUIP NOT FOUND: ' + bound);
