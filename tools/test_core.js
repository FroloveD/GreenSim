// Ядро без браузера: 12 комбинаций профиль×культура, сходимость бухгалтерии,
// детерминизм прогноза, склад. Возвращает код 1 при провале — годится для CI.
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'parts', 'core.js'), 'utf8');
const a = src.indexOf('// === SIM CORE START ==='), b = src.indexOf('// === SIM CORE END ===');
const M = new Function(src.slice(a,b) + `
  return {CFG,CROPS,PROFILES,makeWorld,stepWorld,harvestAll,sellHarvest,whUsedL,whCap,storeKg,
          cloneWorld,startForecast,stepForecast,forecastSummary,buyItem,
          toggleLamp,hasLight,lightName,lightLit,
          water,soilState,waterDose,SOIL,
          setAuto,setAutoTime,autoAllowed,autoWhy,autoTick,alarmTick,inWindow,AUTO_KEYS,
          climateTick,CROPS,
          SITES,SITE_LIST,siteById,siteNormals,normAt,todayDoy,doyFromDate,dateFromDoy,
          ORIENTS,outsideClimate,EQUIP_DEFS,WARRANTY,riskTick,fmtDate,
          serializeWorld,deserializeWorld,SAVE_VERSION};`)();

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

// 7. ручной полив: субстрат сохнет сам, полив поднимает влагу, без воды — отказ
{
  const w = M.makeWorld({profile:'balcony', crop:'tomato', seed:4});
  const m0 = w.moist;
  for (let k=0;k<24;k++) M.stepWorld(w,1);
  const m1 = w.moist;
  ok(m1 < m0 - 3, 'за сутки без полива субстрат сохнет', `${m0}% → ${m1.toFixed(1)}%`);

  const before = w.stock.waterM3;
  const r = M.water(w);
  ok(r.ok && w.moist > m1 + 10, 'полив поднимает влагу', `${m1.toFixed(1)}% → ${w.moist.toFixed(1)}%`);
  ok(before - w.stock.waterM3 > 0.001, 'и тратит воду из бака',
     (before - w.stock.waterM3).toFixed(3) + ' м³ на ' + w.area + ' м²');

  const w2 = M.makeWorld({profile:'balcony', crop:'tomato', seed:4});
  w2.stock.waterM3 = 0; w2.moist = 20;
  const r2 = M.water(w2);
  ok(r2.ok === false && w2.moist === 20, 'без воды полив отклонён', r2.msg);

  w2.stock.waterM3 = 5; M.stepWorld(w2, 1);
  const wsDry = w2.waterStress;
  M.water(w2); M.stepWorld(w2, 0.5);
  ok(wsDry > 0.3 && w2.waterStress === 0, 'сухо → водный стресс, полив его снимает',
     `${wsDry.toFixed(2)} → ${w2.waterStress.toFixed(2)}`);

  // перелив: гниль растёт, и это состояние проходит само, если не поливать
  const w3 = M.makeWorld({profile:'balcony', crop:'tomato', seed:4});
  w3.moist = 95; w3.disease = 0.1;
  M.stepWorld(w3, 12);
  ok(w3.disease > 0.1 && w3.moist < 93, 'перелив даёт гниль, но подсыхает сам',
     `болезнь ${w3.disease.toFixed(2)}, влага ${w3.moist.toFixed(1)}%`);
}

// 8. вода в урожае: без полива теряется заметная часть урожая
{
  const grow = (care)=>{
    const w = M.makeWorld({profile:'hobby', crop:'tomato', seed:12});
    for (let d=0; d<60; d++){
      for (let k=0;k<24;k++){
        M.stepWorld(w, 1);
        w.stock.waterM3 = Math.max(w.stock.waterM3, 5);         // вода в баке не кончается
        if (care && w.moist < 42) M.water(w);
      }
      M.harvestAll(w); if (w.wh.lots.length) M.sellHarvest(w, 'tomato', null);
    }
    return +w.harvestedKg.toFixed(1);
  };
  const withWater = grow(true), without = grow(false);
  ok(withWater > without*1.1, 'полив заметно прибавляет урожай',
     `${withWater} кг против ${without} кг`);

  // гидропоника держит влагу дольше грунта
  const dry = (sys)=>{
    const w = M.makeWorld({profile:'balcony', crop:'tomato', seed:12, sys});
    for (let k=0;k<24;k++) M.stepWorld(w,1);
    return +(M.SOIL.m0 - w.moist).toFixed(1);
  };
  const dropSoil = dry('soil'), dropAero = dry('aero');
  ok(dropAero < dropSoil, 'аэропоника сохнет медленнее грунта',
     `${dropAero} п.п. против ${dropSoil} п.п.`);
}

// 9. таймеры: свободный сезон даёт всё, кампания — по главам
{
  const w = M.makeWorld({profile:'farm', crop:'tomato', seed:6});
  w.has.autoTimer = true; w.has.climatePC = true; w.has.co2 = true;
  ok(M.AUTO_KEYS.every(k=>M.autoAllowed(w,k.id)), 'свободный сезон: все таймеры доступны',
     M.AUTO_KEYS.map(k=>k.id).join(' '));

  const c = M.makeWorld({profile:'balcony', crop:'tomato', seed:6, campaign:true});
  c.has.autoTimer = true; c.has.co2 = true; c.has.climatePC = true;      // оборудование уже куплено: проверяем только главы
  const ladder = [0,1,2,3].map(ch=>{
    c.camp.ch = ch;
    return M.AUTO_KEYS.filter(k=>M.autoAllowed(c,k.id)).map(k=>k.id).join('+') || '—';
  });
  ok(ladder[0]==='lamp' && ladder[1]==='lamp+water' && ladder[2]==='lamp+water+co2'
     && ladder[3]==='lamp+water+co2+full',
     'кампания открывает таймеры по шагам', ladder.join(' → '));
  c.camp.ch = 0;                                   // на балконе автоматизации ещё нет
  const denyFull = M.setAuto(c, 'full', true);
  const noTimer = M.makeWorld({profile:'balcony', crop:'tomato', campaign:true}); noTimer.has.autoTimer = true;
  const denyLampCh = M.setAuto(noTimer, 'water', true);
  ok(denyFull.ok === false && /главе/i.test(denyFull.msg), 'на балконе автоматизация не раньше срока', denyFull.msg);
  ok(denyLampCh.ok === false && /главе 2/i.test(denyLampCh.msg), 'полив обещан во 2-й главе', denyLampCh.msg);
  c.camp.ch = 3; c.has.climatePC = true;
  ok(M.setAuto(c, 'full', true).ok, 'с контроллером автоматизация включается в 4-й главе');
}

// 10. таймеры ставят уставки: свет по окну, полив по датчику, CO₂ в окне
{
  const w = M.makeWorld({profile:'farm', crop:'tomato', seed:6});
  w.has.autoTimer = true; w.has.co2 = true; w.stock.co2Kg = 30; w.stock.waterM3 = 50;
  M.setAuto(w, 'lamp', true); w.auto.lamp.from = 6; w.auto.lamp.to = 22;
  w.hour = 9;  M.autoTick(w, 0.5); const day = !!w.ctrl.lampEnabled;
  w.hour = 23; M.autoTick(w, 0.5); const night = !!w.ctrl.lampEnabled;
  ok(day && !night, 'свет живёт по окну расписания', `09:00 ${day} / 23:00 ${night}`);

  w.moist = 30; w.hour = 12;
  M.setAuto(w, 'water', true); w.auto.water.target = 55; w.auto.water.from = 6; w.auto.water.to = 22;
  const w0 = w.stock.waterM3; M.autoTick(w, 0.5);
  const moistAfter = w.moist, spent = w0 - w.stock.waterM3;
  const wet = moistAfter > 40 && spent > 0;
  w.moist = 25; w.hour = 23;
  const w1 = w.stock.waterM3; M.autoTick(w, 0.5);
  ok(wet, 'в окне таймер поливает по датчику', `30% → ${moistAfter.toFixed(0)}%, ${spent.toFixed(2)} м³`);
  ok(Math.abs(w.stock.waterM3 - w1) < 1e-9, 'вне окна полив не идёт', 'вода не тратится');

  M.setAuto(w, 'co2', true); w.auto.co2.from = 6; w.auto.co2.to = 20;
  w.hour = 12; M.autoTick(w, 0.5); const inWin = w.co2Window;
  w.hour = 22; M.autoTick(w, 0.5); const outWin = w.co2Window;
  ok(inWin === true && outWin === false, 'окно CO₂ закрывает клапан', `в окне ${inWin}, вне ${outWin}`);
}

// 11. будильник: подсказка есть, лампу сам не включает
{
  const w = M.makeWorld({profile:'balcony', crop:'tomato', seed:6});
  w.ctrl.alarmOn = true; w.ctrl.alarmFrom = 6; w.ctrl.alarmTo = 20;
  w.ctrl.lampEnabled = false; w.hour = 10;
  M.alarmTick(w);
  const ping = w.alarmPing && w.alarmPing.text;
  ok(!!ping && /Будильник/.test(ping), 'будильник напоминает', ping);
  ok(w.ctrl.lampEnabled === false, 'и при этом не включает лампу');
}


/* ---------- Локации и климат по открытым данным ---------- */
{
  const at = (site, doy, hour)=> M.outsideClimate(M.makeWorld({profile:'farm', crop:'tomato', site, startDoy:doy}), doy, hour||13);
  const sochiJuly = at('sochi', 200), murmJuly = at('murmansk', 200), ekbJan = at('ekb', 15), sochiJan = at('sochi', 15);
  ok(sochiJuly.temp > 20 && sochiJuly.temp > murmJuly.temp + 5, 'Сочи в июле теплее Мурманска',
     'Сочи ' + sochiJuly.temp.toFixed(1) + ' °C, Мурманск ' + murmJuly.temp.toFixed(1) + ' °C');
  ok(sochiJan.temp > 0 && ekbJan.temp < -5, 'январь: Сочи выше нуля, Екатеринбург ниже −5',
     'Сочи ' + sochiJan.temp.toFixed(1) + ', Екатеринбург ' + ekbJan.temp.toFixed(1));
  const polar = at('murmansk', 355, 12);
  ok(polar.ppfd === 0, 'полярная ночь в Мурманске: солнца нет совсем', 'PPFD ' + polar.ppfd.toFixed(0));
  const ekbJuly = at('ekb', 200);
  ok(ekbJuly.ppfd > 600, 'солнечный июль даёт свет растению', 'PPFD ' + Math.round(ekbJuly.ppfd));

  const ghost = M.siteById('atlantis');
  ok(ghost && ghost.name === 'Екатеринбург', 'неизвестная точка падает на регион по умолчанию', ghost && ghost.name);
  const N = M.siteNormals({region:'south'});
  ok(N.temp.length === 12 && N.temp[6] > N.temp[0], 'нормы по региону есть (12 месяцев)',
     'июль ' + N.temp[6] + '°, январь ' + N.temp[0] + '°');

  const w = M.makeWorld({profile:'farm', crop:'tomato', site:'krasnodar', orient:'SW', startDoy:150});
  ok(w.site.name === 'Краснодар' && w.site.az === 225 && w.doy === 150 && w.startDoy === 150,
     'мир стартует в выбранном месте, на выбранной дате и стороне',
     w.site.name + ', ' + M.ORIENTS[w.site.orient].name + ', день ' + w.doy);
  const south = M.outsideClimate(M.makeWorld({profile:'farm',site:'ekb',startDoy:100}), 100, 13);
  const sw = M.outsideClimate(M.makeWorld({profile:'farm',site:'ekb',orient:'SW',startDoy:100}), 100, 13);
  const diff = Math.abs(((south.azScene - sw.azScene + 540) % 360) - 180);
  ok(diff > 20, 'юго-западный балкон видит солнце под другим углом, чем южный',
     'az сцены: юг ' + Math.round(south.azScene) + '°, юго-запад ' + Math.round(sw.azScene) + '°');
  ok(M.doyFromDate(0, 1) === 1 && M.doyFromDate(2, 1) === 60 && M.doyFromDate(11, 31) === 365,
     'дата старта переводится в день года', '1 мар = ' + M.doyFromDate(2,1));
  ok(M.todayDoy() >= 1 && M.todayDoy() <= 365, 'сегодняшняя дата читается из системы', 'день года ' + M.todayDoy());
  ok(M.SITE_LIST.length === 10, 'в списке 10 локаций', M.SITE_LIST.map(x=>x.name).join(', '));
}

/* ---------- Гарантия: отказ на 180–364-й день ---------- */
{
  const eur = v => (v>=0?'+':'') + Math.round(v) + ' €';
  const breakLamp = (day, since)=>{
    const w = M.makeWorld({profile:'farm', crop:'tomato', seed:5});
    w.day = day; w.doy = ((day-1)%365)+1;
    w.equip.lamp.since = since; w.equip.lamp.paid = 2200;
    w.diffFail = 1e6;                 // шанс отказа ×1 000 000 — ломается гарантированно
    M.riskTick(w, 1);
    return w;
  };
  const lampW = w => (w.warranty || []).filter(r => r.k === 'lamp');
  const w1 = breakLamp(200, 1);
  ok(!w1.equip.lamp.ok, 'прибор сломался', 'лампа не работает');
  ok(lampW(w1).length === 1 && lampW(w1)[0].eur === 2200, 'на 200-й день — гарантийный случай',
     lampW(w1).length ? lampW(w1)[0].name + ', ' + lampW(w1)[0].eur + ' €' : 'нет');
  ok(lampW(w1).length === 1 && lampW(w1)[0].due === w1.day + 7, 'деньги обещают через 7 дней',
     'день ' + (lampW(w1)[0] ? lampW(w1)[0].due : '—'));
  const before = w1.money, beforeList = lampW(w1).length;
  for (let d=0; d<6; d++){ w1.day++; M.riskTick(w1, 24); }
  ok(lampW(w1).length === beforeList, 'на 6-й день возврат ещё в пути', 'в очереди ' + lampW(w1).length);
  w1.day++; M.riskTick(w1, 24);
  ok(lampW(w1).length === 0, 'на 7-й день возврат пришёл и ушёл из очереди', 'очередь пуста');
  ok(w1.money - before > 0, 'деньги на балансе выросли', eur(w1.money - before));
  ok(M.buyItem(w1, 'repair').ok && w1.equip.lamp.ok, 'сломанный прибор остался у игрока и чинится');

  ok(lampW(breakLamp(100, 1)).length === 0, 'на 100-й день гарантии нет (меньше 180)');
  ok(lampW(breakLamp(400, 1)).length === 0, 'на 400-й день гарантии нет (больше 364)');
  ok(lampW(breakLamp(200, 190)).length === 0, 'считаем возраст от покупки, а не от старта сезона');
  ok(lampW(breakLamp(300, 110)).length === 1, 'покупка на 110-й день, отказ на 300-й — гарантия');
}

// 12. восстановление сохранений: неизвестная сложность и миграция v1
{
  const w = M.makeWorld({profile:'farm', crop:'tomato', seed:19});
  const legacy = JSON.parse(M.serializeWorld(w));
  legacy.v = 1;
  legacy.world.diffId = 'legacy-custom';
  delete legacy.world.diffPriceF;
  delete legacy.world.wh;
  delete legacy.world.market;
  delete legacy.world.mail;
  delete legacy.world.auto;
  delete legacy.world.site;
  delete legacy.world.startDoy;
  delete legacy.world.warranty;
  delete legacy.world.moist;
  delete legacy.world.meas;
  delete legacy.world.drift;
  delete legacy.world.waterStress;
  delete legacy.world.seasonDays;

  const restored = M.deserializeWorld(legacy);
  ok(restored.v === M.SAVE_VERSION, 'сохранение v1 мигрирует в актуальную версию', restored.v);
  ok(restored.world.diffId === 'normal' && restored.world.diffPriceF === 1,
     'неизвестная сложность безопасно заменяется обычной',
     restored.world.diffId + ' / ' + restored.world.diffPriceF);
  ok(!!restored.world.wh && !!restored.world.market && !!restored.world.auto
     && !!restored.world.site && restored.world.moist === M.SOIL.m0,
     'при миграции восстанавливаются обязательные подсистемы');
}

console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nЯдро в порядке');
process.exit(fails?1:0);
