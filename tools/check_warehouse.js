// Проверка: склад, продажа, лёжкость, расширение, пауза 1:1, догон в оффлайне
const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
(async()=>{
  const browser = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const page = await browser.newPage({ viewport:{width:1440, height:900} });
  const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  await page.goto('http://localhost:8080/index.html?w='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(700);

  // --- склад: урожай не продаётся сам ---
  const a = await page.evaluate(()=>{
    pending.campaign=false; pending.profile='farm'; pending.crop='tomato'; startGame();
    for(let d=0;d<45;d++) for(let k=0;k<24;k++) VG.sim(1);
    const m0 = world.money, kg0 = VG.harvest().kg;
    renderAll();
    return { harvestedKg: Math.round(kg0), moneyDelta: Math.round(world.money-m0),
             wh: VG.wh(), price: VG.market().tomato, lots: world.wh.lots.length };
  });
  console.log('1) собрано', a.harvestedKg, 'кг · изменение денег от сбора:', a.moneyDelta, '€ (должно быть ~0)');
  console.log('   склад:', a.wh.used+'/'+a.wh.cap, 'л ·', a.wh.sections, 'секц ·', Math.round(a.wh.kg), 'кг · аренда', a.wh.rent, '€/сут · цена', a.price);

  // --- продажа через кнопку ---
  const b = await page.evaluate(()=>{
    const m0 = world.money;
    document.getElementById('btnSellAll').click();
    return { dMoney: Math.round(world.money-m0), left: Math.round(VG.wh().kg), toast: document.getElementById('toast').textContent };
  });
  console.log('2) «Продать всё»:', b.dMoney, '€ · осталось', b.left, 'кг ·', b.toast);

  // --- расширение склада ---
  const c = await page.evaluate(()=>{
    const s0 = world.wh.sections, r0 = VG.wh().rent;
    document.getElementById('btnWhExpand').click();
    return { s0, s1: world.wh.sections, r0, r1: VG.wh().rent, cap: VG.wh().cap };
  });
  console.log('3) +секция:', c.s0, '→', c.s1, '· аренда', c.r0, '→', c.r1, '€/сут · ёмкость', c.cap, 'л');

  // --- переполнение: покупка не проходит ---
  const d = await page.evaluate(()=>{
    world.stock.fertKg = 4000;                     // набиваем склад под завязку (4000 кг ≈ 4800 л)
    const r = buyItem(world, 'fert20');
    return { ok:r.ok, msg:r.msg, free: Math.round(whFreeL(world)) };
  });
  console.log('4) покупка при полном складе:', d.ok ? 'прошла (плохо)' : 'отказ —', d.msg);

  // --- лёжкость: партия портится ---
  const e = await page.evaluate(()=>{
    world.stock.fertKg = 5;
    world.wh.lots = [{ crop:'tomato', day:world.day, age:0, shelf:12, kg:100, q:1 }];
    const before = world.wh.lots[0].kg;
    for(let i=0;i<6;i++){ whRot(world); }
    return { before, after: Math.round(world.wh.lots[0].kg), age: world.wh.lots[0].age };
  });
  console.log('5) 100 кг за 6 дней (лёжкость 12):', e.after, 'кг · возраст', e.age, 'дн');

  // --- пауза: время идёт 1:1 ---
  await page.waitForTimeout(300);
  const p0 = await page.evaluate(()=>{ document.getElementById('btnPause').click();
    return { t: world.day*24+world.hour, label: document.getElementById('btnPause').textContent }; });
  await page.waitForTimeout(5000);
  const p1 = await page.evaluate(()=>world.day*24+world.hour);
  console.log('6) пауза (кнопка «'+p0.label+'»): за 5 реальных секунд прошло', ((p1-p0.t)*3600).toFixed(1), 'игровых секунд');
  await page.evaluate(()=>{ document.getElementById('btnPause').click(); });

  // --- догон в оффлайне ---
  const f = await page.evaluate(()=>{
    saveNow(true);
    const text = store.get();
    const pack = JSON.parse(text);
    pack.ts = Date.now() - 2*3600*1000;            // «ушли два часа назад»
    const day0 = pack.world.day, hour0 = pack.world.hour;
    applyLoadedWorld(deserializeWorld(pack));
    return { day0, dDay: world.day-day0, dHour: (world.hour-hour0+24)%24,
             log: world.log[0].m };
  });
  console.log('7) оффлайн 2 ч:', 'прибавка', f.dDay, 'дн', f.dHour.toFixed(1), 'ч ·', f.log);

  // --- кампания: письмо и переезд ---
  const g = await page.evaluate(()=>{
    pending.campaign=true; pending.profile='balcony'; pending.crop='lettuce'; startGame();
    const mail0 = world.mail.map(m=>m.id);
    answerMail(world,'intro',1);
    world.soldEur = 400; campaignTick(world);
    const mail1 = world.mail.map(m=>m.id);
    const opt = world.mail.find(m=>m.id==='goal1');
    answerMail(world,'goal1',0);
    return { mail0, mail1, profile: world.profile, day: world.day, season: world.seasonDays, mailLeft: world.mail.length };
  });
  console.log('8) кампания: письма', g.mail0.join(',') , '→', g.mail1.join(','),
              '· после переезда профиль', g.profile, '· сезон', g.season, 'дн');

  console.log('ошибки:', errs.length? errs.slice(0,4).join(' | ') : 'нет');
  await browser.close();
})();
