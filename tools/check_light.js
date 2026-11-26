// досветка: ручное включение, LED-лента вместо «не куплена», будильник с алертами
const { chromium: pw } = require('playwright-core');
const chromium = require('@sparticuz/chromium');
(async()=>{
  const b = await pw.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  const page = await b.newPage({ viewport:{width:1280, height:900} });
  const errs=[]; page.on('pageerror', e=>errs.push(e.message));
  await page.goto('http://localhost:8080/index.html?lt='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(700);

  // 1. балкон: куплена только LED-лента — «Параметры» не должны врать
  const r1 = await page.evaluate(()=>{
    localStorage.removeItem('vgCur');
    pending.campaign=true; pending.profile='balcony'; pending.crop='tomato'; pending.sys='soil'; startGame();
    world.money = 5000;
    const before = { name: lightName(world), has: hasLight(world) };
    buyItem('ledStrip', world);
    renderAll(); renderSettings();
    const card = document.getElementById('settingsBody').textContent;
    return { before, name: lightName(world), has: !!world.has.ledStrip, led: !!world.has.led,
             saysNotBought: /не куплена/.test(card) && !/LED-лента/.test(card),
             btnEnabled: !document.getElementById('btnLampSet').disabled };
  });
  console.log('лента куплена:', JSON.stringify(r1));
  console.log('  подпись честная:', (r1.name==='LED-лента' && !r1.saysNotBought) ? '✅' : '❌',
              '· тумблер доступен:', r1.btnEnabled ? '✅' : '❌');

  // 2. ручное включение: горит в любой час, даёт свет и тратит энергию
  const r2 = await page.evaluate(()=>{
    world.ctrl.lampEnabled = true;
    world.hour = 2;                       // глубокая ночь: раньше «расписание» её выключало
    VG.sim(0.5);
    const night = { lampOn: world.light.lampOn, strip: world.light.stripOn, ppfd: world.light.meanLeaf };
    const costOn = world.cost.lamp;
    world.ctrl.lampEnabled = false; VG.sim(0.5);
    const day = { lampOn: world.light.lampOn, ppfd: world.light.meanLeaf };
    renderAll();
    return { night, day, costOn:+costOn.toFixed(3), costOff:+world.cost.lamp.toFixed(3),
             overturned: world.light.lampOn };
  });
  console.log('ручной режим:', JSON.stringify(r2));
  console.log('  горит ночью без автоматики:', r2.night.lampOn ? '✅' : '❌',
              '· лента даёт свет:', r2.night.ppfd > r2.day.ppfd ? '✅' : '❌',
              '· свет стоит денег:', r2.costOn > 0 ? '✅' : '❌',
              '· выключили — погасла:', r2.overturned ? '❌' : '✅');

  // 3. будильник: напоминает алертами, но лампу не включает
  const r3 = await page.evaluate(()=>{
    world.ctrl.alarmOn = true; world.ctrl.alarmFrom = 6; world.ctrl.alarmTo = 20;
    world.ctrl.lampEnabled = false; world.hour = 10; renderAlerts(); renderSettings();
    const alertIn = document.getElementById('alerts').textContent;
    const stateIn = alarmState(world);
    const cardIn = document.getElementById('settingsBody').textContent;
    const lampStillOff = !world.ctrl.lampEnabled;
    world.ctrl.lampEnabled = true; world.hour = 23; renderAlerts();
    const alertOut = document.getElementById('alerts').textContent;
    const stateOut = alarmState(world);
    return { alertIn: /Будильник/.test(alertIn), stateIn, lampStillOff,
             cardHasWindow: /включать с/.test(cardIn),
             alertOut: /окно закончилось/.test(alertOut), stateOut };
  });
  console.log('будильник:', JSON.stringify(r3));
  console.log('  напоминает включить:', r3.alertIn ? '✅' : '❌',
              '· сам не включает:', r3.lampStillOff ? '✅' : '❌',
              '· ругает за забытую лампу:', r3.alertOut ? '✅' : '❌',
              '· окно в настройках:', r3.cardHasWindow ? '✅' : '❌');

  // 4. миссия «досветка» закрывается именно ручным включением
  const r4 = await page.evaluate(()=>{
    world.missionIdx = 0; world.missionsDone = 0; world.ctrl.lampEnabled = false;
    missionsTick(world);
    const idxBefore = world.missionIdx;
    world.ctrl.lampEnabled = true; missionsTick(world);
    return { idxBefore, idxAfter: world.missionIdx, done: world.missionsDone };
  });
  console.log('задание досветки:', JSON.stringify(r4), r4.done>0?'✅':'⚠ задания уже сместились');

  console.log('ошибки консоли:', errs.length ? errs : 'нет');
  await b.close();
})();
