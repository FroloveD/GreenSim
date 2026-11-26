// экономика: расход на свет виден, копейки не округляются в «−0 €», за сутки/за сезон сходятся
const { launch } = require('./browser');
(async()=>{
  const b = await launch();
  const page = await b.newPage({ viewport:{width:1400, height:1000} });
  const errs=[]; page.on('pageerror', e=>errs.push(e.message));
  await page.goto('http://localhost:8080/index.html?mn='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(700);

  // 1. лампа ON: расход растёт, деньги падают, копейки не «−0»
  const r1 = await page.evaluate(()=>{
    pending.campaign=true; pending.profile='balcony'; pending.crop='tomato'; pending.sys='soil'; startGame();
    world.money = 300;
    const m0 = world.money, lamp0 = world.cost.lamp;
    world.ctrl.lampEnabled = true;
    for (let k=0;k<24;k++) VG.sim(1);       // сутки с включённой лампой
    renderAll();
    const finText = document.getElementById('finance').textContent;
    return { moneyDrop: +(m0-world.money).toFixed(2), spent: +((world.cost.lamp+world.cost.energy+world.cost.water+world.cost.fert+world.cost.fixed)).toFixed(2), lampCost: +world.cost.lamp.toFixed(3),
             lampRose: world.cost.lamp>lamp0, energyKWh: +world.energyKWh.toFixed(2),
             finText, profitTop: document.getElementById('tProfit').textContent,
             moneyTop: document.getElementById('tMoney').textContent };
  });
  console.log('лампа включена:', JSON.stringify({drop:r1.moneyDrop, lamp:r1.lampCost, kWh:r1.energyKWh, top:r1.profitTop}));
  console.log('  свет стоит денег:', r1.lampRose && r1.lampCost>0 ? '✅' : '❌',
              '· расходы идут:', r1.spent>0 ? '✅ '+r1.spent : '❌',
              '· в шапке не «−0 €»:', !/^[+−]?0 €/.test(r1.profitTop) ? '✅ '+r1.profitTop : '❌ '+r1.profitTop,
              '· строка досветки в панели:', /досветка/i.test(r1.finText) ? '✅' : '❌');

  // 2. разбивка за сутки против накопленной за сезон
  const r2 = await page.evaluate(()=>{
    const h = world.history, last = h[h.length-1];
    const cb = last.costBreak || {};
    const sumDay = Object.values(cb).reduce((a,b)=>a+b,0);
    const reconDay = last.profit - (last.rev - (last.cost - (h.length>1 ? Object.values(h[h.length-2].costBreak||{}).reduce((a,b)=>a+b,0) : 0)));
    return { dayCost:+sumDay.toFixed(2), dayProfit:+last.profit.toFixed(2), dayRev:+last.rev.toFixed(2),
             rewardDay:+(last.rewardDay||0).toFixed(2), moneyDelta:+(last.moneyDelta||0).toFixed(2),
             lampInBreak: +((cb.lamp)||0).toFixed(3), co2Kg:+(last.co2Kg||0).toFixed(3),
             moneyS: moneyS(0.35), moneyS0: moneyS(-0.004), moneyBig: moneyS(-123.4) };
  });
  console.log('разбивка за сутки:', JSON.stringify(r2));
  console.log('  расход дня сходится с прибылью:', Math.abs(r2.dayProfit-(r2.dayRev-r2.dayCost))<0.02 ? '✅' : '❌ '+(r2.dayRev-r2.dayCost).toFixed(2),
              '· досветка в разбивке:', r2.lampInBreak>0 ? '✅' : '❌',
              '· копейки:', r2.moneyS==='0,35 €' || /0,35/.test(r2.moneyS) ? '✅' : '❌ '+r2.moneyS);

  // 3. панель «Баки и возможности»
  const r3 = await page.evaluate(()=>{
    renderAll();
    const t = document.getElementById('tanks').textContent;
    return { hasWater:/Вода/.test(t), hasFert:/Удобрения/.test(t), hasFeat:/Возможности/.test(t),
             count:(t.match(/из\s+\d+/g)||[])[0]||'', txt:t.slice(0,120) };
  });
  console.log('панель баков:', JSON.stringify(r3));
  console.log('  вода/удобрения/возможности:', r3.hasWater&&r3.hasFert&&r3.hasFeat?'✅':'❌');

  // 4. обучение можно вернуть
  const r4 = await page.evaluate(()=>{
    tutorDone = true; document.getElementById('tutor').classList.remove('on');
    setPage('settings'); renderSettings();
    document.getElementById('btnTutorAgain').click();
    const tutorOn = document.getElementById('tutor').classList.contains('on');
    document.getElementById('btnObAgain').click();
    const helpOn = document.getElementById('help').classList.contains('on');
    const step = document.getElementById('obStepNo').textContent;
    document.getElementById('helpClose').click();
    document.getElementById('btnManual2').click();
    const manualOn = document.getElementById('manual').classList.contains('on');
    return { tutorOn, helpOn, step, manualOn };
  });
  console.log('обучение:', JSON.stringify(r4));
  console.log('  подсказки заново:', r4.tutorOn?'✅':'❌', '· мастер с 1 шага:', (r4.helpOn&&/шаг 1/.test(r4.step))?'✅':'❌',
              '· справочник:', r4.manualOn?'✅':'❌');
  console.log('ошибки консоли:', errs.length?errs:'нет');
  await b.close();
})();
