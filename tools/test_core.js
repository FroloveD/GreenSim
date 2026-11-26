// Ядро без браузера: 12 комбинаций профиль×культура, сходимость бухгалтерии,
// детерминизм прогноза, склад. Возвращает код 1 при провале — годится для CI.
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'parts', 'core.js'), 'utf8');
const a = src.indexOf('// === SIM CORE START ==='), b = src.indexOf('// === SIM CORE END ===');
const M = new Function(src.slice(a,b) + `
  return {CFG,CROPS,PROFILES,makeWorld,stepWorld,harvestAll,sellHarvest,whUsedL,whCap,storeKg,
          cloneWorld,startForecast,stepForecast,forecastSummary,buyItem,
          toggleLamp,hasLight,lightName,lightLit};`)();

let fails = 0;
const ok = (c, m, extra)=>{ if(!c) fails++; console.log((c?'✅ ':'❌ ')+m+(extra!==undefined?' — '+extra:'')); };

// 1. 12 комбинаций по 60 дней: никаких NaN и отрицательного урожая
const combos = [];
for (const profile of ['hobby','farm','agro'])
  for (const crop of ['tomato','cherry','cucumber','lettuce']){
    const w = M.makeWorld({profile, crop, seed: 11});
    const start = w.money;
    for (let d=0; d<60; d++){
      for (let k=0;k<24;k++) M.stepWorld(w, 1);
      M.harvestAll(w);
      if (w.wh.lots.length) M.sellHarvest(w, crop, null);
    }
    const nan = [w.money, w.harvestedKg, w.light.canopyLAI, w.temp, w.wh.wasteKg].some(x=>!isFinite(x));
    combos.push({profile, crop, nan, kg:+w.harvestedKg.toFixed(1), money:+w.money.toFixed(1), dMoney:+(w.money-start).toFixed(1)});
  }
ok(combos.every(c=>!c.nan), '12 комбинаций за 60 дней без NaN',
   combos.filter(c=>c.nan).map(c=>c.profile+'/'+c.crop).join(', ') || 'все чистые');
ok(combos.filter(c=>c.crop==='tomato').every(c=>c.kg > 50), 'томат даёт урожай',
   combos.filter(c=>c.crop==='tomato').map(c=>c.profile+': '+c.kg+' кг').join(', '));

// 2. бухгалтерия: движение денег = выручка − расходы
{
  const w = M.makeWorld({profile:'farm', crop:'tomato', seed: 7});
  const start = w.money;
  for (let d=0; d<30; d++){
    for (let k=0;k<24;k++) M.stepWorld(w, 1);
    M.harvestAll(w); if (w.wh.lots.length) M.sellHarvest(w, 'tomato', null);
  }
  const cost = Object.values(w.cost).reduce((s,x)=>s+x,0);
  const profit = w.revenue - cost;
  const dMoney = w.money - start;
  ok(Math.abs(dMoney - profit) < 1, 'деньги = выручка − расходы', `${dMoney.toFixed(2)} против ${profit.toFixed(2)}`);
  ok(Math.abs(w.revenue - ((w.soldEur||0)+(w.rewardSum||0))) < 0.01, 'выручка = продажи + награды');
  ok(w.wh.lots.every(l=>l.kg >= 0), 'на складе нет отрицательных партий');
}

// 3. склад: занято не больше объёма
{
  const w = M.makeWorld({profile:'farm', crop:'tomato', seed: 3});
  let over = false;
  for (let d=0; d<40; d++){
    for (let k=0;k<24;k++) M.stepWorld(w, 1);
    M.harvestAll(w);
    if (M.whUsedL(w) > M.whCap(w) + 0.5) over = true;
  }
  ok(!over, 'склад не переполняется сверх объёма');
}

// 4. прогноз детерминирован: два одинаковых мира дают одинаковый итог
{
  const run = ()=>{
    const w = M.makeWorld({profile:'hobby', crop:'tomato', seed: 42});
    for (let h=0; h<24*5; h++) M.stepWorld(w, 0.5);
    const fc = M.startForecast(w, 7);
    let guard = 0;
    while (fc.done < fc.days && guard++ < 500) M.stepForecast(fc, 10);
    const s = M.forecastSummary(fc);
    return {kg:+s.kg.toFixed(3), profit:+s.profit.toFixed(3)};
  };
  const r1 = run(), r2 = run();
  ok(r1.kg === r2.kg && r1.profit === r2.profit, 'прогноз детерминирован', JSON.stringify(r1));
}

// 5. покупки: цена списывается, отказ без денег
{
  const w = M.makeWorld({profile:'farm', crop:'tomato'});
  w.money = 5;
  const r = M.buyItem(w, 'led');
  ok(r && r.ok === false && w.money >= 0, 'покупка без денег отклонена', JSON.stringify(r));
  w.money = 9000;
  const m0 = w.money; M.buyItem(w, 'led');
  ok(m0 - w.money > 0 && w.has.led, 'покупка LED прошла и списала деньги', (m0-w.money).toFixed(0)+' €');
}

// 6. досветка: одна функция переключает любую лампу, без лампы — честный отказ
{
  const w = M.makeWorld({profile:'farm', crop:'tomato', seed:5});
  w.has.led = false; w.has.ledStrip = false; w.has.lampBase = false;
  const r0 = M.toggleLamp(w);
  ok(r0.ok === false && /купите/i.test(r0.msg) && !w.ctrl.lampEnabled,
     'без лампы свет не включается', r0.msg);

  w.has.ledStrip = true;                       // дешёвая лента: раньше кнопка её не признавала
  const a = M.toggleLamp(w), b = M.toggleLamp(w);
  ok(a.ok && a.on === true && b.on === false, 'лента: включает и выключает',
     `${a.on} → ${b.on}`);

  const c0 = w.cost.lamp||0;
  M.toggleLamp(w); M.stepWorld(w, 0.5);        // включили
  const lit = M.lightLit(w), cOn = (w.cost.lamp||0) - c0;
  const c1 = w.cost.lamp||0;
  M.toggleLamp(w); M.stepWorld(w, 0.5);        // выключили
  const dark = M.lightLit(w), cOff = (w.cost.lamp||0) - c1;
  ok(lit && !dark, 'мир слушается переключателя', `горит ${lit} → погасло ${!dark}`);
  ok(cOn > 0 && cOff < 1e-9, 'за включённый свет списывают, за выключенный — нет',
     `${cOn.toFixed(4)} против ${cOff.toFixed(4)} €`);

  M.toggleLamp(w); w.power = false; M.stepWorld(w, 0.5);
  ok(w.ctrl.lampEnabled === true && M.lightLit(w) === false,
     'без электричества лампа не горит, хотя включена');
  w.power = true;
}

console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nЯдро в порядке');
process.exit(fails?1:0);
