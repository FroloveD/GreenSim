// ТЕСТ ЭКОНОМИКИ: покупки без денег, долг от текущих расходов, сходимость бухгалтерии
const { launch } = require('./browser');
let fails = 0;
const ok = (cond, name, extra)=> { if (!cond) fails++; console.log((cond?'✅ ':'❌ ')+name+(extra!==undefined?' — '+extra:'')); };
(async()=>{
  const b = await launch();
  const page = await b.newPage({ viewport:{width:1400, height:1000} });
  const errs=[]; page.on('pageerror', e=>errs.push(e.message));
  await page.goto('http://localhost:8080/index.html?eco='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(700);

  // 1. покупка без денег не проходит и не создаёт долг
  const r1 = await page.evaluate(()=>{
    pending.campaign=true; pending.profile='balcony'; pending.crop='tomato'; pending.sys='soil'; startGame();
    world.money = 3;
    const m0 = world.money;
    const res = VG.buy('ledStrip');          // стоит 220 €
    return { res, money0:m0, money1:world.money, bought: !!world.has.ledStrip };
  });
  ok(r1.res && r1.res.ok === false, 'покупка без денег отклонена', JSON.stringify(r1.res));
  ok(r1.money1 >= 0 && Math.abs(r1.money1-r1.money0) < 0.01, 'после отказа баланс не ушёл в минус', r1.money1.toFixed(2));

  // 2. текущие расходы уводят в долг и начисляют проценты
  const r2 = await page.evaluate(()=>{
    world.money = 0.4;                        // денег нет, но свет горит и склад арендован
    world.ctrl.lampEnabled = true;
    world.missionIdx = MISSIONS.length;       // награды за задания выключаем: проверяем чистые расходы
    world.missionsDone = 0;
    for (let d=0; d<3; d++) for (let k=0;k<24;k++) VG.sim(1);
    renderAll();
    const fin = document.getElementById('finance').textContent;
    const alerts = document.getElementById('alerts').textContent;
    const h = world.history[world.history.length-1];
    return { money:+world.money.toFixed(2), loan:+world.cost.loan.toFixed(3), debtDays:world.debtDays,
             alerted:/Долг/.test(alerts), inPanel:/долг/.test(fin),
             logHasDebt: world.log.some(l=>/Долг/.test(l.m)),
             stuck: !!world.over };
  });
  ok(r2.money < 0, 'баланс ушёл в минус от текущих расходов', r2.money+' €');
  ok(r2.loan > 0, 'за долг начислены проценты', r2.loan+' €');
  ok(r2.debtDays > 0, 'дней в долгу считается', r2.debtDays);
  ok(r2.alerted, 'алерт про долг виден');
  ok(r2.inPanel, 'строка долга есть в «Экономике»');
  ok(r2.logHasDebt, 'запись в журнале про долг есть');

  // 3. бухгалтерия сходится: прибыль == движение денег (без кредитов и продаж филиалов)
  const r3 = await page.evaluate(()=>{
    pending.campaign=true; pending.profile='room'; pending.crop='tomato'; pending.sys='soil'; startGame();
    world.money = 600;
    const start = world.money, startProfit = world.revenue - Object.values(world.cost).reduce((a,b)=>a+b,0);
    for (let d=0; d<12; d++){
      for (let k=0;k<24;k++) VG.sim(1);
      VG.harvest(); if (world.wh.lots.length) VG.sell();
    }
    const cost = Object.values(world.cost).reduce((a,b)=>a+b,0);
    const profit = world.revenue - cost;
    const dMoney = world.money - start;
    const dProfit = profit - startProfit;
    // выручка = продажи + награды
    const revOk = Math.abs(world.revenue - ((world.soldEur||0)+(world.rewardSum||0)));
    // разбивка по дням == накопленные статьи
    const sums = {};
    for (const h of world.history){ for (const k in (h.costBreak||{})) sums[k] = (sums[k]||0)+h.costBreak[k]; }
    let breakDiff = 0;
    // сравниваем с состоянием на прошлую полночь: текущие сутки ещё не закрыты
    const atMidnight = world._costAtDay || {};
    for (const k in sums) breakDiff = Math.max(breakDiff, Math.abs(sums[k]-(atMidnight[k]||0)));
    const unpaid = utilAccrued(world) + utilDebt(world);
    return { unpaid:+unpaid.toFixed(2), dMoney:+dMoney.toFixed(2), dProfit:+dProfit.toFixed(2), revOk:+revOk.toFixed(3),
             breakDiff:+breakDiff.toFixed(3), cost:+cost.toFixed(2), profit:+profit.toFixed(2) };
  });
  ok(Math.abs(r3.dMoney - (r3.dProfit + r3.unpaid)) < 1.0, 'движение денег = бухгалтерская прибыль + счёт за свет и тепло',
     `${r3.dMoney} против ${(r3.dProfit + r3.unpaid).toFixed(2)} (в счёте ${r3.unpaid.toFixed(2)})`);
  ok(r3.revOk < 0.01, 'выручка = продажи + награды', r3.revOk);
  ok(r3.breakDiff < 0.02, 'разбивка «за сутки» сходится с накопленными статьями', r3.breakDiff);

  // 4. покупка списывает ровно цену и попадает в «покупки»
  const r4 = await page.evaluate(()=>{
    world.money = 3000;
    const price = (()=>{ for (const g of SHOP()) for (const it of g.items)
      if (it.id==='ledStrip') return it.price ? it.price(world) : upgradeCost(world, it.base, it.noScale);
      return 0; })();
    const m0 = world.money, up0 = world.cost.upgrade;
    const res = VG.buy('ledStrip');
    return { res, price:+price.toFixed(2), spent:+(m0-world.money).toFixed(2), up:+(world.cost.upgrade-up0).toFixed(2) };
  });
  ok(r4.res && r4.res.ok, 'при достатке средств покупка проходит');
  ok(Math.abs(r4.spent - r4.price) < 0.01, 'списано ровно цена', r4.spent+' / '+r4.price);
  ok(Math.abs(r4.up - r4.price) < 0.01, 'покупка попала в статью «покупки»', r4.up);

  ok(errs.length===0, 'ошибок консоли нет', errs.join(' | '));
  console.log(fails ? `\nПРОВАЛЕНО проверок: ${fails}` : '\nВсе проверки экономики пройдены');
  await b.close();
  process.exit(fails?1:0);
})();
