const fs = require('fs');
const A = require('./js/calculator.js');
require('./js/passives.js');

const name = process.argv[2] || 'Bounty Hunter';
const files = fs.readdirSync('Units', { recursive: true })
  .filter(f => f.endsWith('_data.json'));
const path = files.find(f => f.includes(name + '_data.json'));
if (!path) { console.error('NOT FOUND', name); process.exit(1); }
const u = JSON.parse(fs.readFileSync('Units/' + path));
const calc = A.createCalculator({ unit: u, traits: {}, equipments: {} });
const r = calc.calc(null, [], {});
console.log('unit=' + name + ' rarity=' + u.rarity + ' archetype=' + u.archetype + ' element=' + u.element);
const top = u.upgrades[u.upgrades.length - 1];
console.log('BASE(top): dmg=' + top.damage + ' spa=' + top.spa + ' rng=' + top.range + ' cd=' + top.crit_damage + ' cc=' + top.crit_chance);
console.log('MODEL Lv50/Z traitless: dmg=' + r.dmg + ' spa=' + r.spa + ' rng=' + r.rng + ' cd=' + r.cd + ' cc=' + r.cc + ' crit_mult=' + r.crit_mult + ' base_dps=' + r.base_dps + ' dps=' + r.dps);
console.log('NOTES:', (r.notes || []).join(' | '));
