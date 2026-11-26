// Раунд «свет, деньги, приложение, перенос сезона и погода» — без браузера.
// 1) DLI и фотопериод: свет копится за сутки, лампа ночью удлиняет день, норма по культуре;
// 2) себестоимость килограмма: расходы сезона ÷ собранные кг, сравнение с ценой дня;
// 3) рецепт по стадии: EC/pH под фазу, вне коридора — мягкий штраф;
// 4) перенос хозяйства в следующий сезон: оборудование, склад, деньги, репутация;
// 5) реальная погода: таблица вместо норм, выпадение дней, откат к нормам;
// 6) PWA: манифест, сервис-воркер и иконки лежат рядом с index.html и валидны.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'parts', 'core.js'), 'utf8');
const a = src.indexOf('// === SIM CORE START ==='), b = src.indexOf('// === SIM CORE END ===');
const M = new Function(src.slice(a,b) + `
  return {CFG,CROPS,PROFILES,makeWorld,stepWorld,harvestAll,water,sellHarvest,buyItem,SHOP,
          dliInfo,dayLength,realWeatherAt,applyWeatherTable,outsideClimate,
          costPerKg,costPerKgDay,seasonCost,marginInfo,priceToday,
          lampPPFDOf,lampPowerKW,lightPowerNowKW,hasLight,lightName,SHOP,buyItem,nf,serializeWorld,
          cropStage,stageRecipe,stageFit,fertFactors,STAGE_RECIPES,CROP_LIGHT,
          carrySnapshot,applyCarry,diagnose,newDay,serializeWorld,deserializeWorld,
          fmtDate,doyFromDate,siteById,SITES};`)();

let fails = 0;
const ok = (c, m, extra)=>{ if (!c) fails++; console.log((c?'✅ ':'❌ ')+m+(extra!==undefined?' — '+extra:'')); };
const near = (x,y,t)=>Math.abs(x-y) <= t;

/* ---------- 1. DLI и фотопериод ---------- */
{
  const w = M.makeWorld({profile:'hobby', crop:'tomato', seed:11, site:'ekb', startDoy:130});
  w.has.ledStrip = true; w.ctrl.lampEnabled = true;
  // полные сутки шагами по часу
  let dliNoon = 0;
  for (let h=0; h<24; h++){
    M.stepWorld(w, 1);
    if (w.hour >= 12 && w.hour < 13) dliNoon = w.dliAcc;
  }
  const photo = w.photoHoursYest;
  ok(dliNoon > 5, 'к полудню свет за сутки уже заметный', `${dliNoon.toFixed(1)} моль/м²`);
  ok(w.dliYest > 10, 'за полные сутки DLI попадает в историю', `${w.dliYest.toFixed(1)} моль/м²`);
  ok(photo >= 12, 'фотопериод считает часы, когда над кроной есть свет', `${photo.toFixed(1)} ч`);
  ok(!isNaN(w.history[w.history.length-1].dli), 'DLI пишется в историю дня для графиков');

  const D = M.dliInfo(w);
  const C = M.CROPS.tomato;
  ok(D.tgt === C.dliTgt && D.min === C.dliMin && D.max === C.dliMax, 'нормы света берутся из культуры',
     `${D.min}/${D.tgt}/${D.max} моль`);
  const allCrops = Object.keys(M.CROPS).every(c => M.CROPS[c].dliTgt > 0 && M.CROPS[c].photoMax >= M.CROPS[c].photoMin);
  ok(allCrops, 'у каждой культуры есть DLI и фотопериод');

  // широта и дата: в январе день короче, чем в июне
  const jan = M.dayLength(w, 15), jun = M.dayLength(w, 170);
  ok(jan < 9 && jun > 15, 'длина дня зависит от даты и широты', `янв ${jan.toFixed(1)} ч, июн ${jun.toFixed(1)} ч`);
  const sochi = M.makeWorld({profile:'hobby', crop:'tomato', seed:3, site:'sochi', startDoy:15});
  ok(M.dayLength(sochi, 15) > jan, 'южная точка в январе получает больше света',
     `Сочи ${M.dayLength(sochi,15).toFixed(1)} ч против ${jan.toFixed(1)} ч`);
}

/* ---------- 2. фотопериод и лампа ночью ---------- */
{
  const mk = (lamp)=>{
    const w = M.makeWorld({profile:'hobby', crop:'tomato', seed:5, startDoy:330});
    w.has.led = true; w.ctrl.lampEnabled = lamp;
    for (let h=0; h<50; h++) M.stepWorld(w, 1);
    return w;
  };
  const on = mk(true), off = mk(false);
  ok(on.dliYest > off.dliYest*1.3, 'лампа зимой заметно добавляет свет за сутки',
     `${on.dliYest.toFixed(1)} против ${off.dliYest.toFixed(1)} моль/м²`);
  ok(on.photoHoursYest > off.photoHoursYest + 3, 'лампа ночью удлиняет фотопериод',
     `${on.photoHoursYest.toFixed(0)} ч против ${off.photoHoursYest.toFixed(0)} ч`);
  const D = M.dliInfo(on);
  ok(D.photoVerdict !== 'в норме', 'слишком длинный день виден вердиктом', D.photoVerdict);
  const dg = M.diagnose(on);
  ok(dg.items.some(i=>/Свет горел|фотопериод|ч в сутки/i.test(i.text)), 'диагностика предупреждает о круглосуточной лампе',
     (dg.items[0]||{}).text);
}

/* ---------- 3. себестоимость килограмма ---------- */
{
  const w = M.makeWorld({profile:'hobby', crop:'tomato', seed:21, startDoy:120});
  ok(M.costPerKg(w) === null, 'без урожая себестоимости нет — честное «—»');
  for (let d=0; d<40; d++){
    for (let k=0;k<24;k++){ M.stepWorld(w,1); if (w.moist < 45) M.water(w); }
    M.harvestAll(w);
  }
  const c = M.costPerKg(w);
  ok(c !== null && isFinite(c) && c > 0, 'себестоимость считается', c && c.toFixed(2)+' €/кг');
  ok(near(c, M.seasonCost(w)/w.harvestedKg, 1e-9), 'формула прозрачна: расходы ÷ килограммы');
  const m = M.marginInfo(w);
  ok(near(m.margin, m.price - m.cost, 1e-9), 'маржа = цена дня минус себестоимость',
     `${m.price.toFixed(2)} − ${m.cost.toFixed(2)} = ${m.margin.toFixed(2)} €/кг`);
  ok(M.costPerKgDay(w) === null || M.costPerKgDay(w) > 0, 'себестоимость за сутки не отрицательная');
}

/* ---------- 4. рецепт по стадии ---------- */
{
  const w = M.makeWorld({profile:'hobby', crop:'tomato', seed:9, startDoy:120});
  const stages = [];
  ok(M.cropStage(w).key === 'start', 'сразу после посадки стадия — старт', M.cropStage(w).name);
  for (let d=0; d<70; d++){
    for (let k=0;k<24;k++){ M.stepWorld(w,1); if (w.moist < 45) M.water(w); }
    M.harvestAll(w);
    const st = M.cropStage(w).key;
    if (stages[stages.length-1] !== st) stages.push(st);
  }
  ok(stages.includes('start') && stages.includes('veg') && stages.includes('fruit'),
     'стадии проходят по порядку: старт → вегетация → налив', stages.join(' → '));
  const R = M.stageRecipe(w);
  ok(R.ec[0] < R.ec[1] && R.ph[0] < R.ph[1] && R.why.length > 10, 'у рецепта есть коридор EC/pH и объяснение', R.name);
  const corners = Object.keys(M.STAGE_RECIPES).every(cr =>
    Object.keys(M.STAGE_RECIPES[cr]).every(k => {
      const r = M.STAGE_RECIPES[cr][k];
      return r.ec && r.ph && r.ec[0] >= 1 && r.ec[1] <= 3.6 && r.ph[0] >= 5 && r.ph[1] <= 6.8;
    }));
  ok(corners, 'все рецепты лежат в пределах ползунков EC и pH');

  // штраф включается только при явном уходе от фазы
  const W = M.makeWorld({profile:'hobby', crop:'tomato', seed:9, startDoy:120});
  for (let d=0; d<30; d++) for (let k=0;k<24;k++) M.stepWorld(W,1);
  W.ctrl.ecSet = 2.4; const inRange = M.stageFit(W, 2.4, 5.8);
  W.ctrl.ecSet = 1.2; const far = M.stageFit(W, 1.2, 5.8);
  ok(inRange > 0.99, 'штатный EC не наказывается', inRange.toFixed(3));
  ok(far < 0.95 && far >= 0.9, 'явно не та стадия — мягкий штраф, а не обвал', far.toFixed(3));
  const base = M.fertFactors(W).nutri;
  W.ctrl.ecSet = 2.4;
  ok(M.fertFactors(W).nutri >= base, 'в коридоре фазы питания больше, чем вне него');
}

/* ---------- 5. перенос хозяйства ---------- */
{
  const w = M.makeWorld({profile:'hobby', crop:'tomato', seed:31, startDoy:120});
  w.has.led = true; w.has.screen = true; w.upg.worker = true;
  w.wh.sections = 5; w.money = 4200; w.missionsDone = 6; w.harvestedKg = 900;
  const carry = M.carrySnapshot(w);
  ok(carry.has.led && carry.has.screen && carry.upg.worker, 'оборудование и апгрейды попадают в перенос');
  ok(carry.sections === 5 && carry.money === 4200, 'склад и деньги тоже', `${carry.sections} секций, ${carry.money} €`);
  ok(carry.rep > 0 && carry.seasons === 2, 'репутация и номер сезона считаются', `репутация ${carry.rep}`);

  const next = M.makeWorld({profile:'hobby', crop:'tomato', seed:32, startDoy:210, carry});
  ok(next.has.led && next.has.screen && next.upg.worker, 'новый сезон начинается с тем же оборудованием');
  ok(next.money === 4200 && next.wh.sections === 5, 'деньги и секции склада переехали');
  ok(next.day === 1 && next.harvestedKg === 0 && next.history.length <= 1, 'куст, история и урожай — с нуля',
     `день ${next.day}, собрано ${next.harvestedKg} кг`);
  ok(next.repF > 1 && next.repF <= 1.06, 'репутация даёт до +6% к цене', `×${next.repF.toFixed(3)}`);
  const plain = M.makeWorld({profile:'hobby', crop:'tomato', seed:32, startDoy:210});
  ok(M.priceToday(next) > M.priceToday(plain), 'с репутацией цена выше',
     `${M.priceToday(next).toFixed(2)} против ${M.priceToday(plain).toFixed(2)} €/кг`);
  ok(next.seasons === 2, 'номер сезона растёт');
  const debt = M.makeWorld({profile:'hobby', crop:'tomato', seed:33, startDoy:210,
                            carry: Object.assign({}, carry, {money:-500, startMoney:1})});
  ok(debt.money === -500, 'долг переезжает вместе с хозяйством, а не прощается');
}

/* ---------- 6. реальная погода ---------- */
{
  // таблица: ровно те же дни, но +8 °C к норме и ясно
  const rows = [];
  for (let d=1; d<=365; d++) rows.push({doy:d, t:20, cloud:0.05});
  const w = M.makeWorld({profile:'hobby', crop:'tomato', seed:41, startDoy:15, site:'ekb'});
  const normJan = M.outsideClimate(w, 15, 12).temp;
  ok(M.applyWeatherTable(w, rows, {source:'test'}), 'таблица реальной погоды принимается');
  const realJan = M.outsideClimate(w, 15, 12).temp;
  ok(realJan > normJan + 5, 'погода берётся из таблицы, а не из норм',
     `${realJan.toFixed(1)} °C против нормы ${normJan.toFixed(1)} °C`);
  ok(M.outsideClimate(w, 15, 12).real === true, 'мир помечает, что погода реальная');
  const wNorm = M.makeWorld({profile:'hobby', crop:'tomato', seed:41, startDoy:15, site:'ekb'});
  ok(M.outsideClimate(w, 15, 12).cloud < M.outsideClimate(wNorm, 15, 12).cloud,
     'облачность тоже из таблицы: ясно вместо хмурого января',
     `${M.outsideClimate(w,15,12).cloud.toFixed(2)} против ${M.outsideClimate(wNorm,15,12).cloud.toFixed(2)}`);

  // дырки в архиве закрываются соседним днём
  const holey = [];
  for (let d=1; d<=365; d++) if (d !== 100) holey.push({doy:d, t:5, cloud:0.5});
  const w2 = M.makeWorld({profile:'hobby', crop:'tomato', seed:42, startDoy:100});
  M.applyWeatherTable(w2, holey, {});
  const at = M.realWeatherAt(w2, 100);
  ok(at && near(at.t, 5, 0.01), 'пропущенный день берётся у ближайшего соседа', at && at.t);

  // без таблицы — нормы, и никаких NaN
  const w3 = M.makeWorld({profile:'hobby', crop:'tomato', seed:43, startDoy:15});
  const c3 = M.outsideClimate(w3, 15, 12);
  ok(w3.realWeather === null && c3.real === false && isFinite(c3.temp), 'без сети остаются нормы',
     `${c3.temp.toFixed(1)} °C`);
  ok(M.applyWeatherTable(w3, [], {}) === false, 'пустая таблица не ломает мир');

  // погодные события работают поверх реальной погоды
  const w4 = M.makeWorld({profile:'hobby', crop:'tomato', seed:44, startDoy:15});
  M.applyWeatherTable(w4, rows, {});
  w4.events = [{kind:'cold', severity:10, inFuture:false}];
  ok(M.outsideClimate(w4, 15, 12).temp < realJan, 'холодный фронт по-прежнему отнимает градусы');

  // сохранение переживает таблицу
  const pack = M.deserializeWorld(M.serializeWorld(w4));
  ok(pack.world.realWeather && pack.world.realWeather.t && pack.world.realWeather.t[15] === 20,
     'таблица погоды сохраняется в сейв');
}

/* ---------- 7. LED-панель: единственный способ добрать свет зимой ---------- */
{
  const item = M.SHOP().flatMap(g=>g.items).find(i=>i.id==='panel');
  ok(!!item, 'LED-панель есть в магазине', item && item.name+' · '+item.base+' €');
  ok(item && item.ch === 0, 'панель доступна с первой главы (балкон)');

  const mk = (panel)=>{
    const w = M.makeWorld({profile:'balcony', crop:'tomato', seed:15, site:'ekb', startDoy:15});
    w.has.ledStrip = true;
    if (panel) w.has.panel = true;
    for (let d=0; d<3; d++) for (let h=0; h<24; h++){
      w.ctrl.lampEnabled = (w.hour>=6 && w.hour<20);      // 14 часов досветки
      M.stepWorld(w,1);
    }
    return w;
  };
  const off = mk(false), on = mk(true);
  ok(M.lampPPFDOf(on) === 420 && M.lampPPFDOf(off) === 90, 'панель даёт 420 µmol вместо 90',
     `${M.lampPPFDOf(on)} против ${M.lampPPFDOf(off)}`);
  ok(M.lampPowerKW(on) > M.lampPowerKW(off)*1.1, 'и ест больше: счёт растёт',
     `${M.lampPowerKW(on).toFixed(2)} кВт против ${M.lampPowerKW(off).toFixed(2)}`);
  ok(on.dliYest > off.dliYest*2, 'зимой панель добирает DLI до нормы',
     `${on.dliYest.toFixed(1)} против ${off.dliYest.toFixed(1)} моль/м²`);
  ok(M.dliInfo(on).ref >= M.CROPS.tomato.dliMin, 'с панелью свет выходит в норму',
     `${M.dliInfo(on).verdict}`);
  ok(M.dliInfo(off).ref < M.CROPS.tomato.dliMin, 'без панели — нет', M.dliInfo(off).verdict);
  ok(on.bio > off.bio, 'и растение растёт быстрее', `${off.bio.toFixed(1)} → ${on.bio.toFixed(1)} г`);
  ok(M.lightName(on) === 'LED-панель 420' && M.hasLight(on), 'в интерфейсе она называется панелью');

  // покупка: деньги списываются, флаг ставится, лампа горит
  const w2 = M.makeWorld({profile:'balcony', crop:'tomato', seed:16, startDoy:15});
  w2.money = 2000;
  const before = w2.money;
  const r = M.buyItem(w2, 'panel');
  ok(r.ok && w2.has.panel && w2.has.led, 'покупка работает и включает панель', r.msg);
  ok(Math.abs((before - w2.money) - 760) < 1, 'цена списана ровно', `${Math.round(before-w2.money)} €`);
  w2.ctrl.lampEnabled = true; M.stepWorld(w2, 1);
  ok(M.lightPowerNowKW(w2) > 0.5, 'после покупки свет действительно горит', `${M.lightPowerNowKW(w2).toFixed(2)} кВт`);

  // старый сейв без флага не падает
  const saved = JSON.parse(M.serializeWorld(w2));   // как настоящий сейв: граф не сохраняется
  delete saved.world.has.panel;
  const back = M.deserializeWorld(JSON.stringify(saved));
  ok(back.world.has.panel === false, 'старый сейв мигрирует: панели просто нет');
}

/* ---------- 8. Числа в интерфейсе — по-русски ---------- */
{
  ok(M.nf(26.24, 1) === '26,2' && M.nf(5, 0) === '5' && M.nf(NaN, 1) === '—',
     'дроби с запятой, а не с точкой', `${M.nf(26.24,1)} · ${M.nf(5,0)}`);
}

/* ---------- 9. PWA ---------- */
{
  const man = path.join(ROOT, 'manifest.webmanifest');
  const sw  = path.join(ROOT, 'sw.js');
  const i192 = path.join(ROOT, 'icons', 'icon-192.png');
  const i512 = path.join(ROOT, 'icons', 'icon-512.png');
  ok(fs.existsSync(man) && fs.existsSync(sw) && fs.existsSync(i192) && fs.existsSync(i512),
     'манифест, сервис-воркер и иконки лежат рядом с игрой');
  let json = null;
  try { json = JSON.parse(fs.readFileSync(man, 'utf8')); } catch(e){}
  ok(json && json.name && json.start_url && json.display === 'standalone', 'манифест валиден и открывается отдельным окном');
  ok(json && json.icons.length >= 2 && json.icons.some(i=>i.sizes === '512x512'), 'в манифесте есть крупная иконка');
  const swSrc = fs.readFileSync(sw, 'utf8');
  ok(/addEventListener\('fetch'/.test(swSrc) && /caches\.open/.test(swSrc), 'сервис-воркер кэширует и перехватывает запросы');
  ok(/index\.html/.test(swSrc), 'index.html попадает в офлайн-кэш');
  ok(/url\.origin !== self\.location\.origin/.test(swSrc), 'чужие API (погода) не кэшируются');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  ok(/rel="manifest"/.test(html) && /manifest\.webmanifest/.test(html), 'index.html подключает манифест');
  ok(/serviceWorker\.register\('sw\.js'\)/.test(html), 'игра регистрирует сервис-воркер');
  ok(/apple-touch-icon/.test(html), 'иконка есть для iOS');
  const png = fs.readFileSync(i512);
  ok(png.slice(1,4).toString() === 'PNG', 'иконка — настоящий PNG');
}

console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nСвет, деньги, перенос сезона и погода в порядке');
process.exit(fails ? 1 : 0);
