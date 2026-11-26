// Таймеры и автоматизация: свет по расписанию, полив по датчику, окно CO₂,
// полная автоматизация и постепенная выдача по главам кампании.
// Отдельно проверяется будильник досветки: алерт и всплывающее напоминание.
const { launch } = require('./browser');

let fails = 0;
const ok = (c, m, extra)=>{
  if (!c) fails++;
  console.log((c ? '✅ ' : '❌ ') + m + (extra !== undefined ? ' — ' + extra : ''));
};

(async()=>{
  const b = await launch();
  const page = await b.newPage({ viewport:{width:1440, height:900} });
  const errs = []; page.on('pageerror', e=>errs.push(e.message));
  await page.goto('http://localhost:8080/index.html?auto='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(600);

  // ---------- 1. свободный сезон: всё доступно ----------
  const free = await page.evaluate(()=>{
    try{ localStorage.clear(); }catch(_){}
    window.__toasts = [];
    const orig = window.toast;
    window.toast = (m)=>{ window.__toasts.push(String(m)); if (orig) orig(m); };
    pending.campaign = false; pending.profile = 'farm'; pending.crop = 'tomato'; pending.sys = 'soil';
    startGame();
    world.has.climatePC = true; world.has.co2 = true; world.stock.co2Kg = 50; world.money = 9000;
    VG.freeze(true);
    return { allowed: AUTO_KEYS.map(k=>[k.id, autoAllowed(world, k.id)]),
             why: AUTO_KEYS.map(k=>[k.id, autoWhy(world, k.id)]) };
  });
  ok(free.allowed.every(([,v])=>v), 'в свободном сезоне доступны все четыре таймера',
     free.allowed.map(([k,v])=>k+':'+(v?'да':'нет')).join(' '));

  // ---------- 2. свет по расписанию ----------
  const lamp = await page.evaluate(()=>{
    world.ctrl.lampEnabled = false;
    const on = setAuto(world, 'lamp', true);
    world.auto.lamp.from = 6; world.auto.lamp.to = 22;
    world.hour = 10; autoTick(world, 0.5); const inDay = !!world.ctrl.lampEnabled;
    world.hour = 23; autoTick(world, 0.5); const atNight = !!world.ctrl.lampEnabled;
    world.hour = 5;  autoTick(world, 0.5); const before = !!world.ctrl.lampEnabled;
    // рука игрока сильнее расписания
    world.hour = 12; autoTick(world, 0.5);
    const r = toggleLamp(world);
    return { on: on.ok, inDay, atNight, before, timerAfterManual: !!world.auto.lamp.on,
             lampNow: !!world.ctrl.lampEnabled, toast: r.msg };
  });
  ok(lamp.on, 'таймер света включается');
  ok(lamp.inDay && !lamp.atNight && !lamp.before, 'лампа живёт по окну 6–22',
     `10:00 → ${lamp.inDay}, 23:00 → ${lamp.atNight}, 05:00 → ${lamp.before}`);
  ok(!lamp.timerAfterManual && lamp.lampNow === false,
     'кнопка «Досветка» перебивает таймер и возвращает ручной режим', lamp.toast);

  // ---------- 3. полив по датчику в окне ----------
  const waterR = await page.evaluate(()=>{
    const w = world;
    w.stock.waterM3 = 50; w.moist = 30;
    setAuto(w, 'water', true);
    w.auto.water.target = 55; w.auto.water.from = 6; w.auto.water.to = 22;
    w.hour = 12; const before = w.stock.waterM3;
    autoTick(w, 0.5);
    const inWin = { m:+w.moist.toFixed(1), spent:+(before-w.stock.waterM3).toFixed(3) };
    // вне окна не поливает, даже если сухо
    w.moist = 28; w.hour = 23;
    const before2 = w.stock.waterM3;
    autoTick(w, 0.5);
    const outWin = { m:+w.moist.toFixed(1), spent:+(before2-w.stock.waterM3).toFixed(3) };
    // в норме не поливает зря
    w.hour = 12; w.moist = 60;
    const before3 = w.stock.waterM3;
    autoTick(w, 0.5);
    const enough = +(before3-w.stock.waterM3).toFixed(3);
    return { inWin, outWin, enough };
  });
  ok(waterR.inWin.m > 40 && waterR.inWin.spent > 0.01, 'в окне таймер поливает сухой субстрат',
     `${waterR.inWin.m}%, ${waterR.inWin.spent} м³`);
  ok(waterR.outWin.spent === 0, 'вне окна полива нет, даже когда сухо', `${waterR.outWin.m}%`);
  ok(waterR.enough === 0, 'при достаточной влаге вода не тратится', '0 м³');

  // ---------- 4. окно CO₂: вне окна клапан закрыт ----------
  const co2 = await page.evaluate(()=>{
    const w = world;
    w.stock.co2Kg = 20; w.co2 = 400; w.ctrl.co2Set = 800;
    setAuto(w, 'co2', true); w.auto.co2.from = 6; w.auto.co2.to = 20;
    const cost = ()=>{ const c0 = w.cost.co2; w.hour = 12; autoTick(w, 0.5); climateTick(w, 1, CROPS[w.crop]); return +(w.cost.co2-c0).toFixed(4); };
    const inWin = cost();
    w.hour = 22; autoTick(w, 0.5);
    const c1 = w.cost.co2;
    climateTick(w, 1, CROPS[w.crop]);
    const outWin = +(w.cost.co2-c1).toFixed(4);
    return { inWin, outWin, windowFlag: !!w.co2Window };
  });
  ok(co2.inWin > 0, 'в окне клапан CO₂ работает', co2.inWin + ' €');
  ok(co2.outWin === 0 && co2.windowFlag === false, 'вне окна газ не тратится', co2.outWin + ' €');

  // ---------- 5. полная автоматизация ----------
  const full = await page.evaluate(()=>{
    const w = world;
    w.has.climatePC = true; w.has.co2 = true;
    const r = setAuto(w, 'full', true);
    // сухо и «темно» — автопилот должен и полить, и включить лампу
    w.moist = 30; w.light.meanLeaf = 80; w.hour = 9; w.stock.waterM3 = 50;
    autoTick(w, 0.5);
    const auto = { moist:+w.moist.toFixed(1), lamp:!!w.ctrl.lampEnabled, waterTimer:!!w.auto.water.on };
    // влажность у предела — автоматика сушит воздух форточками, хотя жары нет
    const rhWith = (on)=>{
      w.rh = 95; w.temp = 22; w.ctrl.ventSet = 26; w.act = {vent:0, heat:0};
      w.auto.full.on = on;
      climateTick(w, 1, CROPS[w.crop]);
      return +w.rh.toFixed(1);
    };
    const rhAuto = rhWith(true), rhManual = rhWith(false);
    w.auto.full.on = true;
    return { ok:r.ok, auto, rhAuto, rhManual };
  });
  ok(full.ok && full.auto.waterTimer, 'полная автоматизация подчиняет себе таймеры');
  ok(full.auto.moist > 40 && full.auto.lamp, 'автопилот полил и включил свет',
     `влага ${full.auto.moist}%, лампа ${full.auto.lamp}`);
  ok(full.rhAuto < full.rhManual - 3, 'при влажности у предела автоматика сушит воздух форточками',
     `RH ${full.rhAuto}% с автоматикой против ${full.rhManual}% без`);

  // ---------- 6. кампания: постепенная выдача ----------
  const camp = await page.evaluate(()=>{
    pending.campaign = true; pending.profile = 'balcony'; pending.crop = 'tomato'; pending.sys = 'soil';
    startGame(); VG.freeze(true);
    const rows = [];
    const snap = ()=>AUTO_KEYS.map(k=>[k.id, autoAllowed(world, k.id), autoWhy(world, k.id)]);
    rows.push({ch:world.camp.ch, a:snap()});
    const waterCh1 = setAuto(world, 'water', true);
    world.camp.ch = 1; rows.push({ch:1, a:snap()}); const waterCh2 = setAuto(world, 'water', true);
    // полив не нужен в гидропонике
    world.sys = 'dwc'; const waterHydro = autoAllowed(world, 'water'); const whyHydro = autoWhy(world, 'water');
    world.sys = 'soil';
    world.camp.ch = 2; rows.push({ch:2, a:snap()}); const co2NoValve = setAuto(world, 'co2', true);
    world.has.co2 = true; const co2With = setAuto(world, 'co2', true);
    world.camp.ch = 3; rows.push({ch:3, a:snap()}); const fullNoPC = setAuto(world, 'full', true);
    world.has.climatePC = true; const fullWith = setAuto(world, 'full', true);
    return { rows, waterCh1, waterCh2, waterHydro, whyHydro, co2NoValve, co2With, fullNoPC, fullWith };
  });
  const at = (ch, id)=> (camp.rows.find(r=>r.ch===ch).a.find(x=>x[0]===id) || [])[1];
  ok(at(0,'lamp') && !at(0,'water') && !at(0,'co2') && !at(0,'full'),
     'глава 1: только таймер света', camp.rows[0].a.map(([k,v])=>k+':'+(v?'да':'нет')).join(' '));
  ok(!camp.waterCh1.ok && /главе 2/.test(camp.waterCh1.msg), 'полив обещает открыться в главе 2', camp.waterCh1.msg);
  ok(at(1,'water'), 'глава 2: добавился полив');
  ok(!camp.waterHydro && /обороте/.test(camp.whyHydro), 'в гидропонике таймер полива не нужен', camp.whyHydro);
  ok(at(2,'co2') === false && !camp.co2NoValve.ok && /клапан/i.test(camp.co2NoValve.msg),
     'глава 3 открывает CO₂, но нужен купленный клапан', camp.co2NoValve.msg);
  ok(camp.co2With.ok, 'с клапаном таймер CO₂ включается');
  ok(at(3,'full') === false && !camp.fullNoPC.ok && /контроллер/i.test(camp.fullNoPC.msg),
     'глава 4 открывает автоматизацию, но нужен климат-контроллер', camp.fullNoPC.msg);
  ok(camp.fullWith.ok, 'с контроллером полная автоматизация включается');

  // ---------- 7. интерфейс: карточка таймеров ----------
  const ui = await page.evaluate(()=>{
    VG.page('settings'); renderSettings();
    const card = document.getElementById('autoCard');
    const txt = card ? card.textContent.replace(/\s+/g,' ') : '';
    const btn = card && card.querySelector('[data-auto="lamp"]');
    const before = !!(world.auto.lamp && world.auto.lamp.on);
    if (btn) btn.click();
    const after = !!(world.auto.lamp && world.auto.lamp.on);
    const inputs = card ? card.querySelectorAll('[data-autonum]').length : 0;
    if (btn) btn.click();               // вернуть как было
    return { hasCard: !!card, txt, before, after, inputs };
  });
  ok(ui.hasCard && /Таймеры и автоматизация/.test(ui.txt), 'в «Параметрах» есть карточка таймеров');
  ok(ui.before !== ui.after, 'переключатель в карточке работает', `${ui.before} → ${ui.after}`);
  ok(ui.inputs > 0, 'окна расписания редактируются числами', ui.inputs + ' полей');

  // ---------- 8. будильник досветки видно ----------
  const alarm = await page.evaluate(()=>{
    VG.page('greenhouse');
    const w = world;
    w.auto.lamp.on = false; w.auto.full.on = false;
    w.ctrl.alarmOn = true; w.ctrl.alarmFrom = 6; w.ctrl.alarmTo = 20;
    w.ctrl.lampEnabled = false; w.hour = 10; w.alarmPing = null; w._alarmPingDay = 0;
    window.__toasts.length = 0;
    alarmTick(w); renderAll();
    const alerts = [...document.querySelectorAll('#alerts .alert')].map(e=>e.textContent);
    const ping = window.__toasts.find(t=>/Будильник/.test(t)) || '';
    const bell = alarms => alarms.some(t=>/Будильник/.test(t));
    // и когда других рисков много — напоминание всё равно в списке
    w.stock.waterM3 = 0.1; w.stock.fertKg = 0.5; w.moist = 12; w.disease = 0.5; w.money = -200;
    w._alarmPingDay = 0; alarmTick(w); renderAll();
    const many = [...document.querySelectorAll('#alerts .alert')].map(e=>e.textContent);
    return { alerts, ping, bellClean: bell(alerts), bellMany: bell(many), n: many.length };
  });
  ok(alarm.bellClean, 'алерт будильника виден в панели рисков', (alarm.alerts[0]||'').slice(0,70));
  ok(!!alarm.ping, 'и приходит всплывающим напоминанием', alarm.ping || 'нет');
  ok(alarm.bellMany, 'не теряется, когда рисков много', alarm.n + ' строк в панели');

  // ---------- 9. таймеры переживают сохранение ----------
  await page.evaluate(()=>{
    world.auto.lamp.on = true; world.auto.lamp.from = 5; world.auto.lamp.to = 21;
    saveNow(true); renderResumeBox();
  });
  await page.reload({ waitUntil:'domcontentloaded' });
  await page.waitForTimeout(700);
  const saved = await page.evaluate(()=>{
    if (!document.getElementById('btnResume')) return { skip:true };
    document.getElementById('btnResume').click();
    const a = VG.world.auto.lamp;
    return { skip:false, on:!!a.on, from:a.from, to:a.to };
  });
  ok(!saved.skip && saved.on && saved.from === 5 && saved.to === 21,
     'расписание света сохраняется', saved.skip ? 'баннера «Продолжить» нет' : JSON.stringify(saved));

  ok(errs.length === 0, 'ошибок в консоли нет', errs.join(' | ') || 'чисто');
  await b.close();
  console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nТаймеры в порядке');
  process.exit(fails ? 1 : 0);
})();
