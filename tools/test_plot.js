// ТЕСТ СЮЖЕТА: главы, открытие оборудования, ремонт там где ломается, задания, письма
const { launch } = require('./browser');
let fails = 0;
const ok = (cond, name, extra)=> { if (!cond) fails++; console.log((cond?'✅ ':'❌ ')+name+(extra!==undefined?' — '+extra:'')); };
(async()=>{
  const b = await launch();
  const page = await b.newPage({ viewport:{width:1400, height:1000} });
  const errs=[]; page.on('pageerror', e=>errs.push(e.message));
  await page.goto('http://localhost:8080/index.html?pl='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(700);

  // 1. структура глав
  const r1 = await page.evaluate(()=>{
    pending.campaign=true; pending.profile='balcony'; startGame();
    return { chapters: CHAPTERS.map(c=>({id:c.id, goal:c.goal, move:c.moveCost})),
             repairCh: GEAR.repair && GEAR.repair.ch, calibCh: GEAR.calib && GEAR.calib.ch };
  });
  const goalsGrow = r1.chapters.every((c,i)=> i===0 || c.goal > r1.chapters[i-1].goal);
  ok(goalsGrow, 'цели глав растут', r1.chapters.map(c=>c.goal).join(' → '));
  ok(r1.repairCh === 0, 'ремонт открыт с первой главы (иначе отказ = тупик)', 'глава '+(r1.repairCh+1));
  ok(r1.calibCh === 0, 'калибровка датчиков открыта с первой главы', 'глава '+(r1.calibCh+1));

  // 2. на балконе нет отказов того, чего нет
  const r2 = await page.evaluate(()=>{
    pending.campaign=true; pending.profile='balcony'; pending.crop='tomato'; pending.sys='soil'; startGame();
    for (let d=0; d<45; d++){ for (let k=0;k<24;k++) VG.sim(1); VG.harvest(); if (world.wh.lots.length) VG.sell(); }
    const log = world.log.map(l=>l.m).join(' | ');
    return { logHasCo2:/Клапан CO₂/.test(log), logHasDosing:/Дозирующий узел/.test(log),
             hasCo2: world.has.co2, hasDosing: world.has.dosing,
             breakdowns: world.log.filter(l=>/Отказ/.test(l.m)).length,
             alerts: document.getElementById('alerts').textContent,
             money:+world.money.toFixed(1) };
  });
  ok(!r2.logHasCo2, 'на балконе не ломается клапан CO₂ (его нет)', 'has.co2 = '+r2.hasCo2);
  ok(!r2.logHasDosing, 'на балконе не ломается дозирующий узел (его нет)', 'has.dosing = '+r2.hasDosing);
  ok(!/Клапан CO₂|Дозирующий узел/.test(r2.alerts), 'в «Рисках» нет отказов несуществующего оборудования');

  // 3. если отказ случился — ремонт доступен в этой же главе
  const r3 = await page.evaluate(()=>{
    world.money = 5000;
    world.equip.heater.ok = false;          // ломаем котёл руками
    const shop = SHOP();
    let item = null;
    for (const g of shop) for (const it of g.items) if (it.id==='repair') item = it;
    const locked = item ? gearLocked(world, item) : null;
    renderAll();
    const alertHasRepairHint = /Ремонт/.test(document.getElementById('alerts').textContent);
    const res = VG.buy('repair');
    return { locked, res, fixed: world.equip.heater.ok, money:+world.money.toFixed(1),
             repairCost:+world.cost.repair.toFixed(1), alertHasRepairHint };
  });
  ok(r3.locked === false, 'ремонт не заблокирован в первой главе');
  ok(r3.alertHasRepairHint, 'алерт подсказывает про ремонт');
  ok(r3.res && r3.res.ok && r3.fixed, 'ремонт реально чинит', JSON.stringify(r3.res));
  ok(r3.repairCost > 0, 'ремонт списан в расходы', r3.repairCost+' €');

  // 3б. ремонт по частям: денег на всё нет — чиним самое важное
  const r3b = await page.evaluate(()=>{
    world.money = 500;
    world.equip.heater.ok = false; world.equip.lamp.ok = false;
    const res = VG.buy('repair');
    return { res, heater: world.equip.heater.ok, lamp: world.equip.lamp.ok, money:+world.money.toFixed(1), spent:+world.cost.repair.toFixed(1) };
  });
  ok(r3b.res && r3b.res.ok && r3b.heater && !r3b.lamp, 'при нехватке денег чинится главное (котёл, не светильники)', JSON.stringify(r3b.res));
  ok(r3b.spent > 0 && r3b.money >= 0, 'частичный ремонт не уводит в минус', `осталось ${r3b.money} €`);

  // 4. магазин: всё, что выше текущей главы, закрыто
  const r4 = await page.evaluate(()=>{
    pending.campaign=true; pending.profile='balcony'; pending.crop='tomato'; pending.sys='soil'; startGame();
    const items = [];
    for (const g of SHOP()) for (const it of g.items) if (it.ch !== undefined) items.push({id:it.id, ch:it.ch, locked:gearLocked(world, it)});
    const wrong = items.filter(x=> x.locked !== (x.ch > 0));
    return { total: items.length, wrong, ch: world.camp.ch };
  });
  ok(r4.wrong.length === 0, 'на балконе закрыто ровно то, что выше главы 1',
     r4.wrong.length ? JSON.stringify(r4.wrong.slice(0,4)) : `${r4.total} позиций`);

  // 5. задания не застревают и не требуют недоступного
  const r5 = await page.evaluate(()=>{
    // задания проверяем на весеннем старте: зимой на балконе куст почти не растёт,
    // и миссии честно «не успевают» — это не баг, а климат
    pending.campaign=true; pending.profile='balcony'; pending.crop='tomato'; pending.sys='soil';
    pending.startDoy = 91; startGame();
    const bad = [];
    let prevIdx = -1, stuckDays = 0;
    for (let d=0; d<30; d++){
      for (let k=0;k<24;k++) VG.sim(1);
      VG.harvest(); if (world.wh.lots.length) VG.sell();
      const m = MISSIONS[world.missionIdx];
      if (m && m.need && !m.need(world)) bad.push({day:world.day, id:m.id, need:'не выполнено'});
      if (world.missionIdx === prevIdx) stuckDays++; else { stuckDays = 0; prevIdx = world.missionIdx; }
    }
    return { bad, done: world.missionsDone, idx: world.missionIdx, stuckDays, total: MISSIONS.length };
  });
  ok(r5.bad.length === 0, 'нет заданий с недоступным оборудованием', JSON.stringify(r5.bad.slice(0,3)));
  ok(r5.done >= 2, 'задания выполняются по ходу главы', `выполнено ${r5.done}, текущее #${r5.idx+1} из ${r5.total}`);

  // 6. письмо главы и переезд
  const r6 = await page.evaluate(()=>{
    pending.campaign=true; pending.profile='balcony'; pending.crop='tomato'; pending.sys='soil'; startGame();
    world.soldEur = CHAPTERS[0].goal + 50;    // цель главы взята
    for (let k=0;k<24;k++) VG.sim(1);
    const mail = (world.mail||[]).find(m=>m.kind==='chapter' || m.chapter || /Роза/.test(m.from||''));
    const ids = (world.mail||[]).map(m=>({id:m.id, from:m.from, body:(m.body||'').slice(0,40)}));
    const beforeProfile = world.profile, beforeCh = world.camp.ch;
    // отвечаем на письмо о переезде: берём вариант «переехать»
    // письмо главы живёт в MAILBOX, в world.mail лежит только его копия для интерфейса
    const res = answerMail(world, 'goal1', 0);
    const moved = res ? {id:'goal1', res, ch:world.camp.ch, profile:world.profile} : null;
    return { mailCount:(world.mail||[]).length, ids, moved,
             chBefore: beforeCh, chAfter: world.camp && world.camp.ch,
             profileBefore: beforeProfile, profileAfter: world.profile };
  });
  ok(r6.mailCount > 0, 'после цели главы приходит письмо', JSON.stringify(r6.ids.slice(0,3)));
  ok(!!r6.moved, 'на письмо можно ответить', JSON.stringify(r6.moved));

  ok(errs.length===0, 'ошибок консоли нет', errs.join(' | '));
  console.log(fails ? `\nПРОВАЛЕНО проверок: ${fails}` : '\nВсе проверки сюжета пройдены');
  await b.close();
  process.exit(fails?1:0);
})();
