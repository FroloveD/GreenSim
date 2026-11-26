// Рынок и зимнее снаряжение — без браузера.
// 1) цена зависит от сезона, шум плавный, продажа в дорогой месяц выгоднее;
// 2) контракт фиксирует цену в момент подписания;
// 3) на балконе зимой без плёнки и обогревателя куст не растёт, а с ними — растёт.
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'parts', 'core.js'), 'utf8');
const a = src.indexOf('// === SIM CORE START ==='), b = src.indexOf('// === SIM CORE END ===');
const M = new Function(src.slice(a,b) + `
  return {CFG,CROPS,PROFILES,makeWorld,stepWorld,harvestAll,sellHarvest,storeKg,
          buyItem,SHOP,gearLocked,priceToday,seasonFactor,seasonAhead,PRICE_SEASON,marketTick,
          offerContracts,signContract,deliverContract,serializeWorld,deserializeWorld,
          totalLAI,addLot,riskTick,climateTick,SOIL,siteById,fmtDate,doyFromDate};`)();

let fails = 0;
const ok = (c, m, extra)=>{ if (!c) fails++; console.log((c?'✅ ':'❌ ')+m+(extra!==undefined?' — '+extra:'')); };

// мир, поставленный на конкретный день года; днём цену не двигаем, чтобы сравнение было честным
const worldOn = (doy, opts) => {
  const w = M.makeWorld(Object.assign({profile:'farm', crop:'tomato', seed:42, startDoy:doy}, opts||{}));
  w.doy = doy; w.day = 1;
  return w;
};
const season = (crop, doy) => +M.seasonFactor(crop, doy).toFixed(2);

/* ---------- 1. сезонная кривая ---------- */
{
  const feb = season('tomato', 46), aug = season('tomato', 227);
  ok(feb > aug * 1.6, 'зимой томат дороже, чем в августе', `февраль ×${feb}, август ×${aug}`);
  const cFeb = season('cucumber', 46), cAug = season('cucumber', 227);
  ok(cFeb > cAug, 'огурец ведёт себя так же', `×${cFeb} против ×${cAug}`);
  const all = Object.keys(M.CROPS).every(c =>
    M.PRICE_SEASON[c].length === 12 && M.PRICE_SEASON[c].every(v => v > 0.5 && v < 1.6));
  ok(all, 'у каждой культуры 12 сезонных индексов в разумных пределах');

  // цена всегда конечная и в коридоре
  const w = worldOn(46);
  const base = M.CROPS.tomato.price * w.profilePriceF;
  let lo = 9, hi = 0, nan = false;
  for (let d=0; d<180; d++){
    M.marketTick(w);
    w.doy++;
    const p = M.priceToday(w, 'tomato');
    if (!isFinite(p)) nan = true;
    lo = Math.min(lo, p/base); hi = Math.max(hi, p/base);
  }
  ok(!nan, 'цена никогда не становится NaN/∞');
  ok(lo > 0.5 && hi < 2.1, 'цена держится в коридоре 0,5–2,1 от базовой', `${lo.toFixed(2)}…${hi.toFixed(2)}`);
}

/* ---------- 2. шум плавный: рынок не «прыгает» ---------- */
{
  const w = worldOn(120);
  let maxJump = 0, prev = w.market.mult.tomato;
  for (let d=0; d<200; d++){
    M.marketTick(w); w.doy++;
    maxJump = Math.max(maxJump, Math.abs(w.market.mult.tomato - prev));
    prev = w.market.mult.tomato;
  }
  ok(maxJump < 0.25, 'за день множитель не скачет больше 25%', `макс ${(maxJump*100).toFixed(1)} п.п.`);
  ok(w.market.hist.tomato.length === 30, 'история цен для графика — 30 дней', w.market.hist.tomato.length + ' точек');
}

/* ---------- 3. продать сейчас или подождать ---------- */
{
  const feb = worldOn(46), aug = worldOn(227);
  ok(M.seasonAhead(aug, 'tomato', 21).pct > 0.03, 'в августе рынок подсказывает «можно подождать»',
     '+' + Math.round(M.seasonAhead(aug, 'tomato', 21).pct*100) + '% за 3 недели');
  ok(M.seasonAhead(feb, 'tomato', 21).pct < -0.03, 'в феврале — «лучше продать сейчас»',
     Math.round(M.seasonAhead(feb, 'tomato', 21).pct*100) + '% за 3 недели');

  // одна и та же партия в дорогой и дешёвый месяц
  const sellIn = (doy)=>{
    const w = worldOn(doy);
    M.addLot(w, 'tomato', 100, 1);
    const money0 = w.money;
    M.sellHarvest(w, 'tomato', null);
    return w.money - money0;
  };
  const inFeb = sellIn(46), inAug = sellIn(227);
  ok(inFeb > inAug * 1.5, 'та же партия в феврале выручает заметно больше',
     `${Math.round(inFeb)} € против ${Math.round(inAug)} €`);
}

/* ---------- 4. контракт фиксирует цену ---------- */
{
  const w = worldOn(227);                        // подписываем в дешёвый август
  const offers = M.offerContracts(w);
  ok(offers[0].priceLock > 0, 'в предложении уже видна зафиксированная цена', offers[0].priceLock + ' €/кг');
  M.signContract(w, 0);
  const ct = w.contracts[0];
  const lock = ct.priceLock;
  w.doy = 46; w.day += 30;                       // поставка зимой, рынок дорогой
  const winterPrice = M.priceToday(w, 'tomato');
  M.addLot(w, 'tomato', ct.kg, 1);
  const money0 = w.money;
  const r = M.deliverContract(w, ct.id);
  const got = w.money - money0;
  ok(r.ok && got > 0, 'поставка по контракту прошла', `+${Math.round(got)} €`);
  ok(Math.abs(got / ct.kg - lock) < lock*0.25, 'платят по цене подписания, а не по зимней',
     `контракт ${lock.toFixed(2)} €/кг, рынок зимой ${winterPrice.toFixed(2)} €/кг`);
  ok(winterPrice > lock, 'зимой рынок действительно дороже августовской фиксации');
}

/* ---------- 5. зимнее снаряжение на балконе ---------- */
{
  const shopItems = M.SHOP().flatMap(g=>g.items);
  const ids = ['windowFilm','heaterMini','strip2'];
  ok(ids.every(id=>shopItems.some(it=>it.id===id)), 'зимние покупки есть в магазине',
     ids.filter(id=>shopItems.some(it=>it.id===id)).join(', '));
  const wLock = M.makeWorld({profile:'balcony', crop:'tomato', campaign:true, seed:9});
  const locked = ids.map(id=>M.gearLocked(wLock, shopItems.find(it=>it.id===id)));
  ok(locked.every(v=>v === false), 'в главе 1 (балкон) они уже доступны', locked.join(', '));

  // январь в Екатеринбурге, лампа выключена (как у игрока ночью), отопление на 18 °C
  const winter = (gear)=>{
    const ww = M.makeWorld({profile:'balcony', crop:'tomato', seed:11, site:'ekb', startDoy:15});
    ww.money = 2000; ww.has.ledStrip = true; ww.ctrl.lampEnabled = false;
    if (gear) { ww.has.windowFilm = true; ww.has.heatBoost = true; }
    let min = 99;
    for (let d=0; d<20; d++)
      for (let h=0; h<24; h++){
        M.stepWorld(ww, 1);
        if (ww.hour >= 1 && ww.hour <= 5) min = Math.min(min, ww.temp);
      }
    return {min, energy: ww.energyKWh, bio: ww.bio||0, lai: M.totalLAI(ww), w: ww};
  };
  const bare = winter(false), geared = winter(true);
  ok(bare.min < -4, 'без снаряжения балкон в январе промерзает', `минимум ${bare.min.toFixed(1)} °C`);
  ok(geared.min > 0, 'с плёнкой и обогревателем ночью плюс', `минимум ${geared.min.toFixed(1)} °C`);
  ok(geared.min > bare.min + 5, 'и разница не косметическая', `${bare.min.toFixed(1)} → ${geared.min.toFixed(1)} °C`);
  ok(geared.energy > bare.energy * 2, 'за тепло платят электричеством',
     `${bare.energy.toFixed(1)} → ${geared.energy.toFixed(1)} кВт·ч`);
  ok(geared.bio > bare.bio * 2, 'куст за те же 20 дней набирает больше биомассы',
     `${bare.bio.toFixed(1)} → ${geared.bio.toFixed(1)} г`);
  ok((geared.w.stress||0) < (bare.w.stress||0), 'и меньше климатического стресса',
     `${(bare.w.stress||0).toFixed(2)} → ${(geared.w.stress||0).toFixed(2)}`);
}

/* ---------- 6. сохранение переживает новые поля ---------- */
{
  const w = worldOn(46);
  w.has.windowFilm = true; w.has.heatBoost = true; w.has.strip2 = true;
  M.marketTick(w);
  const text = M.serializeWorld(w);
  const back = M.deserializeWorld(text).world;
  ok(back.has.windowFilm && back.has.heatBoost && back.has.strip2, 'зимние флаги сохраняются',
     JSON.stringify([back.has.windowFilm, back.has.heatBoost, back.has.strip2]));
  ok(Math.abs(back.market.mult.tomato - w.market.mult.tomato) < 1e-9, 'рыночный множитель сохраняется');
  ok(back.market.hist.tomato.length === w.market.hist.tomato.length, 'история цен сохраняется');

  // старый сейв без новых флагов не должен падать
  const old = JSON.parse(text);
  delete old.world.has.windowFilm; delete old.world.has.heatBoost; delete old.world.has.strip2;
  const migrated = M.deserializeWorld(JSON.stringify(old)).world;
  ok(migrated.has.windowFilm === false && migrated.has.heatBoost === false,
     'старое сохранение мигрирует, а не падает', 'флаги стали false');
}

console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nРынок и зимнее снаряжение в порядке');
process.exit(fails ? 1 : 0);
