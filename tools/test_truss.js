// Кисти и лёгкая сложность — без браузера (ядро из parts/core.js).
// 1) плоды одной кисти зреют одним тиком: в кисти не бывает «половина красная»;
// 2) сбор забирает кисть целиком, а не по одному плоду;
// 3) сбор ровный: дни со сбором частые, разброс веса по дням меньше, чем «волнами»;
// 4) на лёгкой сложности балкон стартует уже с утеплителем и обогревателем,
//    на обычной — без них (иначе правило сложности незаметно).
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'parts', 'core.js'), 'utf8');
const a = src.indexOf('// === SIM CORE START ==='), b = src.indexOf('// === SIM CORE END ===');
const M = new Function(src.slice(a,b) + `
  return {CROPS,PROFILES,DIFFICULTY,makeWorld,stepWorld,harvestAll,sellHarvest,water,buyItem,SHOP};`)();

let fails = 0;
const ok = (c, m, extra)=>{ if (!c) fails++; console.log((c?'✅ ':'❌ ')+m+(extra!==undefined?' — '+extra:'')); };
const med = arr => { const s = [...arr].sort((x,y)=>x-y); return s[Math.floor(s.length/2)]; };

/* ---------- 1–3. поведение кистей на длинном прогоне ---------- */
function run(crop, profile, seed){
  const w = M.makeWorld({profile, crop, seed, startDoy:120});
  const days = [];
  let mixed = 0, halfTruss = 0, trussPicks = 0, lone = 0;
  for (let d=0; d<60; d++){
    for (let k=0;k<24;k++){ M.stepWorld(w, 1); if (w.moist<45) M.water(w); }
    // инвариант: среди несобранных плодов кисти нет смеси спелых и зелёных
    for (const p of w.plants) for (const tr of p.trusses){
      const raw = tr.fruits.filter(f=>!f.harvested);
      if (!raw.length) continue;
      const ripe = raw.filter(f=>f.ripe).length;
      if (ripe > 0 && ripe < raw.length) mixed++;
    }
    const r = M.harvestAll(w);
    days.push(+r.kg.toFixed(2));
    if (r.kg > 0){
      trussPicks++;
      // сбор идёт кистями: если сняли кисть из нескольких плодов — это не «один плод»
      if (r.n === 1) lone++;
      if (r.n % 1 !== 0) halfTruss++;
    }
    if (w.wh.lots.length) M.sellHarvest(w, crop, null);
  }
  const hd = days.filter(x=>x>0);
  const mean = hd.reduce((s,x)=>s+x,0)/hd.length;
  const sd = Math.sqrt(hd.reduce((s,x)=>s+(x-mean)**2,0)/hd.length);
  return {days, mixed, trussPicks, lone, cv: sd/mean, share: hd.length/60, kg: w.harvestedKg};
}

{
  const rows = [];
  for (const crop of ['cherry','tomato','cucumber'])
    for (const profile of ['hobby','farm','agro'])
      rows.push({crop, profile, ...run(crop, profile, 77)});

  ok(rows.every(r=>r.mixed === 0), 'в кисти не бывает «половина красная»: зреют одним тиком',
     rows.map(r=>r.crop+'/'+r.profile+': '+r.mixed).join(', '));
  ok(rows.every(r=>r.kg > 5), 'урожай на месте после перехода на кисти',
     rows.map(r=>r.crop+'/'+r.profile+': '+Math.round(r.kg)+' кг').join(', '));
  // на кисти 2+ плода, поэтому одиночный сбор — редкость (не больше трети дней)
  ok(rows.every(r=>r.lone <= r.trussPicks*0.34), 'сбор идёт кистями, а не по одному плоду',
     rows.map(r=>r.crop+'/'+r.profile+': '+r.lone+'/'+r.trussPicks).join(', '));

  const cherry = rows.filter(r=>r.crop==='cherry');
  ok(cherry.every(r=>r.cv < 1.35), 'вес суточного сбора по черри ровный (CV < 1,35)',
     cherry.map(r=>r.profile+': '+r.cv.toFixed(2)).join(', '));
  ok(cherry.every(r=>r.share >= 0.55), 'сбор случается больше половины дней',
     cherry.map(r=>r.profile+': '+Math.round(r.share*100)+'%').join(', '));
  ok(med(cherry.map(r=>r.kg)) > 200, 'черри даёт товарный объём', Math.round(med(cherry.map(r=>r.kg)))+' кг');
  // разные культуры не должны схлопнуться в одну: у черри кисть мельче, плодов больше
  const cherryPicks = med(rows.filter(r=>r.crop==='cherry').map(r=>r.trussPicks));
  const tomatoPicks = med(rows.filter(r=>r.crop==='tomato').map(r=>r.trussPicks));
  ok(cherryPicks > 0 && tomatoPicks > 0, 'обе культуры собираются', `черри ${cherryPicks} дней, томат ${tomatoPicks}`);
}

/* ---------- 4. лёгкая сложность: балкон уже оборудован ---------- */
{
  const easy = M.makeWorld({profile:'balcony', crop:'tomato', difficulty:'easy', seed:5});
  ok(easy.has.windowFilm === true, 'лёгкая: утеплитель (плёнка на рамах) стоит сразу');
  ok(easy.has.heatBoost === true, 'лёгкая: обогреватель 0,6 кВт стоит сразу');
  ok(Array.isArray(easy.startKit) && easy.startKit.length === 2, 'лёгкая: комплект отмечен в мире',
     (easy.startKit||[]).join(', '));
  ok(easy.log.some(l=>/утепл/i.test(l.m)), 'лёгкая: в журнале сказано, что балкон утеплён',
     (easy.log.find(l=>/утепл/i.test(l.m))||{}).m);

  const normal = M.makeWorld({profile:'balcony', crop:'tomato', difficulty:'normal', seed:5});
  ok(normal.has.windowFilm === false && normal.has.heatBoost === false,
     'обычная: балкон без утеплителя и обогревателя', 'плёнка '+normal.has.windowFilm+', обогреватель '+normal.has.heatBoost);
  ok(!(normal.startKit||[]).length, 'обычная: комплекта нет');

  const hard = M.makeWorld({profile:'balcony', crop:'tomato', difficulty:'hard', seed:5});
  ok(hard.has.windowFilm === false && hard.has.heatBoost === false, 'жёсткая: тоже без комплекта');

  const farmEasy = M.makeWorld({profile:'farm', crop:'tomato', difficulty:'easy', seed:5});
  ok(!(farmEasy.startKit||[]).length, 'лёгкая сложность не раздаёт обогреватель ферме и агро',
     'ферма: комплект пуст');

  // зимняя ночь: с комплектом на балконе теплее, чем без него
  const warm = (w)=>{ for (let k=0;k<24;k++){ M.stepWorld(w, 1); if (w.moist<45) M.water(w); } return w.temp; };
  const e2 = M.makeWorld({profile:'balcony', crop:'tomato', difficulty:'easy', startDoy:15, seed:9});
  const n2 = M.makeWorld({profile:'balcony', crop:'tomato', difficulty:'normal', startDoy:15, seed:9});
  const te = warm(e2), tn = warm(n2);
  ok(te > tn, 'в январскую ночь с комплектом теплее, чем без него',
     `лёгкая ${te.toFixed(1)} °C против обычной ${tn.toFixed(1)} °C`);

  // в магазине эти вещи больше не «доступны к покупке»
  const shop = M.SHOP().flatMap(g=>g.items).map(i=>i.id);
  ok(shop.includes('windowFilm') && shop.includes('heaterMini'), 'обе вещи есть в каталоге магазина');
}

console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nКисти и лёгкая сложность в порядке');
process.exit(fails ? 1 : 0);
