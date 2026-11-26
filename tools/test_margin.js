// Себестоимость килограмма и расчётная маржа: чистая математика и граничные случаи.
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'parts', 'core.js'), 'utf8');
const a = src.indexOf('// === SIM CORE START ==='), b = src.indexOf('// === SIM CORE END ===');
const M = new Function(src.slice(a,b) + `
  return {makeWorld,seasonCost,costPerKg,costPerKgDay,marginInfo,priceToday};
`)();

let fails = 0;
const ok = (c,m,x)=>{ if(!c) fails++; console.log((c?'✅ ':'❌ ')+m+(x!==undefined?' — '+x:'')); };
const near = (a,b,t=1e-8)=>Math.abs(a-b)<=t;

{
  const w=M.makeWorld({profile:'hobby',crop:'tomato',seed:17});
  ok(M.costPerKg(w)===null, 'до первого урожая себестоимость не показывается');
  w.harvestedKg=20;
  w.cost.energy=30; w.cost.water=10; w.cost.fert=20;
  ok(near(M.seasonCost(w),60), 'суммируются все накопленные статьи расходов', M.seasonCost(w));
  ok(near(M.costPerKg(w),3), 'себестоимость равна расходам на килограмм', M.costPerKg(w));
  const m=M.marginInfo(w);
  ok(near(m.cost,3) && near(m.price,M.priceToday(w)) && near(m.margin,m.price-m.cost),
     'маржа считается как цена дня минус себестоимость',
     m.price.toFixed(2)+' − '+m.cost.toFixed(2)+' = '+m.margin.toFixed(2));
  ok(near(m.pct,m.margin/m.price), 'процент маржи рассчитан от цены продажи');
}

{
  const w=M.makeWorld({profile:'hobby',crop:'tomato',seed:18});
  ok(M.costPerKgDay(w)===null, 'без завершённого дня дневная себестоимость не выдумывается');
  w.history.push({cost:12,harvestedKg:4});
  ok(near(M.costPerKgDay(w),3), 'дневная себестоимость использует расходы и сбор последнего дня');
  w.history[w.history.length-1].harvestedKg=0;
  ok(M.costPerKgDay(w)===null, 'нулевой сбор не даёт деления на ноль');
}

console.log(fails ? `\\nПРОВАЛЕНО: ${fails}` : '\\nСебестоимость и маржа: проверки пройдены');
process.exit(fails?1:0);
