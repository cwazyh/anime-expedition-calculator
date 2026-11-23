const fs=require('fs');
const A=require('./js/calculator.js');
require('./js/passives.js');
const u=JSON.parse(fs.readFileSync('Units/Wolf (Revived) Data/Wolf (Revived)_data.json'));
const calc=A.createCalculator({unit:u,traits:{},equipments:{}});
for(const opts of [{withPassives:false,withEquipment:false},{withEquipment:false},{}]){
  const r=calc.calc(null,[],opts);
  console.log(JSON.stringify(opts),'dmg='+r.dmg,'spa='+r.spa,'base='+r.base_dps,'pmult='+r.passive_mult,'dps='+r.dps);
}
const r=calc.calc(null,[],{});
console.log('NOTES:'); (r.notes||[]).forEach(n=>console.log(' - '+n));
