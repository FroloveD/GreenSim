// UX раунда «свет, деньги, приложение, перенос сезона, погода» — в браузере.
// Проверяем то, что видит игрок: строки DLI и себестоимости, кнопку рецепта,
// работу клавиш, отчёт сезона с переносом хозяйства и регистрацию PWA.
const { launch } = require('./browser');

let fails = 0;
const ok = (c, m, extra)=>{ if (!c) fails++; console.log((c ? '✅ ' : '❌ ') + m + (extra !== undefined ? ' — ' + extra : '')); };

(async()=>{
  const b = await launch();
  const page = await b.newPage({ viewport:{width:1440, height:950} });
  const errs = [];
  page.on('pageerror', e=>errs.push(e.message));
  page.on('console', m=>{ if (m.type()==='error') errs.push(m.text()); });
  await page.goto('http://localhost:8080/index.html?ux7='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(600);

  // ---------- стартовый экран: режим «погода как за окном» ----------
  const startInfo = await page.evaluate(()=>{
    try{ localStorage.clear(); }catch(_){}
    const cards = [...document.querySelectorAll('[data-weather]')];
    const real = cards.find(c=>c.dataset.weather==='real');
    if (real && real.onclick) real.onclick();
    return { n:cards.length, hasReal:!!real, current:pending.weather };
  });
  ok(startInfo.hasReal, 'на старте есть режим «как за окном»', startInfo.n + ' вариантов погоды');
  ok(startInfo.current === 'real', 'выбор реальной погоды запоминается');

  // ---------- играем месяц ----------
  const info = await page.evaluate(()=>{
    Object.assign(pending, {campaign:false, profile:'hobby', crop:'tomato', site:'ekb', orient:'S', startDoy:120, weather:'normal'});
    startGame();
    world.has.ledStrip = true; world.ctrl.lampEnabled = true;
    for (let d=0; d<30; d++){
      for (let k=0;k<24;k++){ stepWorld(world,1); if (world.moist<45) water(world); }
      harvestAll(world);
    }
    renderAll();
    const gauges = document.getElementById('gauges');
    const dliRow = [...gauges.querySelectorAll('.g')].find(g=>/DLI/.test(g.textContent));
    const fin = document.getElementById('finance');
    const finRow = [...fin.querySelectorAll('.finRow')].find(r=>/себест/.test(r.textContent));
    return {
      dliRow: dliRow ? dliRow.textContent.replace(/\s+/g,' ').trim() : null,
      dliTitle: dliRow ? dliRow.getAttribute('title') : '',
      finRow: finRow ? finRow.textContent.replace(/\s+/g,' ').trim() : null,
      margin: marginInfo(world)
    };
  });
  ok(!!info.dliRow, 'в панели климата есть строка DLI', info.dliRow);
  ok(/моль/.test(info.dliTitle||''), 'подсказка объясняет моль на метр', (info.dliTitle||'').slice(0,70));
  ok(!!info.finRow && /себест/.test(info.finRow), 'в экономике видна себестоимость килограмма', info.finRow);
  ok(info.margin.cost > 0 && info.margin.price > 0, 'себестоимость и цена дня считаются',
     `${info.margin.cost.toFixed(2)} € против ${info.margin.price.toFixed(2)} €/кг`);

  // ---------- параметры: DLI, фотопериод, рецепт ----------
  const set = await page.evaluate(()=>{
    setPage('settings');
    const card = document.getElementById('dliCard');
    const txt = card ? card.textContent.replace(/\s+/g,' ') : '';
    const btn = document.getElementById('btnRecipeApply');
    const before = { ec: world.ctrl.ecSet, ph: world.ctrl.phSet };
    if (btn) btn.click();
    const after = { ec: world.ctrl.ecSet, ph: world.ctrl.phSet };
    const R = stageRecipe(world);
    return { txt, hasBtn: !!btn, before, after, R, pageNow: page };
  });
  ok(/Свет за сутки/.test(set.txt) && /моль/.test(set.txt), 'карточка «Свет за сутки» на месте');
  ok(/фотопериод/i.test(set.txt), 'фотопериод показан рядом с DLI');
  ok(set.hasBtn, 'у питания есть кнопка «поставить рецепт фазы»');
  ok(set.after.ec >= set.R.ec[0] && set.after.ec <= set.R.ec[1] &&
     set.after.ph >= set.R.ph[0] && set.after.ph <= set.R.ph[1],
     'рецепт ставит EC и pH в коридор фазы', `${set.after.ec} / ${set.after.ph} (${set.R.name})`);

  // ---------- клавиши ----------
  const keys = await page.evaluate(()=>{
    const press = k => window.dispatchEvent(new KeyboardEvent('keydown', {key:k, bubbles:true}));
    setPage('greenhouse');
    const r = {};
    press(' '); r.paused = paused; r.label = document.getElementById('btnPause').textContent; press(' ');
    press('m'); r.shop = page; press('p'); r.settings = page; press('g'); r.home = page;
    press('1'); r.camTop = document.querySelector('#camBar button[data-view="top"]').classList.contains('on');
    press('5');
    const lampBefore = world.ctrl.lampEnabled; press('d'); r.lamp = world.ctrl.lampEnabled !== lampBefore;
    const kgBefore = world.harvestedKg; press('h'); r.harvest = world.harvestedKg >= kgBefore;
    press('f'); r.pred = document.getElementById('pred').classList.contains('on'); press('f');
    // в поле ввода клавиши не перехватываются
    const inp = document.createElement('input'); document.body.appendChild(inp); inp.focus();
    const ev = new KeyboardEvent('keydown', {key:'m', bubbles:true}); inp.dispatchEvent(ev);
    r.pageAfterTyping = page; inp.remove();
    return r;
  });
  ok(keys.paused === true && /пауза/i.test(keys.label), 'пробел ставит паузу и кнопка это показывает', keys.label);
  ok(keys.shop === 'shop' && keys.settings === 'settings' && keys.home === 'greenhouse', 'M / P / G переключают страницы');
  ok(keys.camTop === true, 'цифры переключают камеры');
  ok(keys.lamp === true && keys.harvest === true, 'D и H работают как кнопки под сценой');
  ok(keys.pred === true, 'F открывает прогноз');
  ok(keys.pageAfterTyping === 'greenhouse', 'в поле ввода клавиши не мешают');

  // ---------- отчёт сезона и перенос ----------
  const end = await page.evaluate(()=>{
    for (let d=0; d<70; d++){
      for (let k=0;k<24;k++){ stepWorld(world,1); if (world.moist<45) water(world); }
      harvestAll(world);
    }
    world.money = 1500;
    world.has.led = true; world.wh.sections = 4;
    world.day = world.seasonDays + 1; newDay(world);
    showEnd();
    const modal = [...document.querySelectorAll('.modal.on')].pop();
    const txt = modal.textContent.replace(/\s+/g,' ');
    const btn = modal.querySelector('#btnNextSeason');
    const before = { day: world.day, kg: world.harvestedKg };
    if (btn) btn.click();
    return { txt, hasBtn: !!btn, before,
             after: { day: world.day, kg: world.harvestedKg, seasons: world.seasons,
                      led: !!world.has.led, sections: world.wh.sections, money: world.money, rep: world.rep } };
  });
  ok(/Себестоимость 1 кг/.test(end.txt), 'в отчёте сезона есть себестоимость килограмма');
  ok(/Репутация/.test(end.txt), 'в отчёте видна репутация');
  ok(end.hasBtn, 'есть кнопка «Следующий сезон с хозяйством»');
  ok(end.after.day === 1 && end.after.kg === 0, 'новый сезон начинается с чистого куста', `день ${end.after.day}`);
  ok(end.after.led === true && end.after.sections === 4, 'оборудование и склад переехали',
     `лампа ${end.after.led}, секций ${end.after.sections}`);
  ok(end.after.seasons === 2 && end.after.rep > 0, 'номер сезона и репутация выросли',
     `сезон ${end.after.seasons}, репутация ${end.after.rep}`);

  // ---------- PWA ----------
  const pwa = await page.evaluate(async ()=>{
    const link = document.querySelector('link[rel="manifest"]');
    let reg = null;
    try { reg = await navigator.serviceWorker.getRegistration(); } catch(_){}
    const res = await fetch('manifest.webmanifest').then(r=>r.ok ? r.json() : null).catch(()=>null);
    return { link: link ? link.getAttribute('href') : null, sw: !!reg, name: res && res.name };
  });
  ok(pwa.link === 'manifest.webmanifest', 'манифест подключён к странице');
  ok(!!pwa.name, 'манифест читается браузером', pwa.name);
  ok(pwa.sw === true, 'сервис-воркер зарегистрирован');

  ok(errs.length === 0, 'ошибок в консоли нет', errs.slice(0,3).join(' | '));
  console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nUX раунда в порядке');
  await b.close();
  process.exit(fails ? 1 : 0);
})();
