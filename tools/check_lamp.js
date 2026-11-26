// Досветка: одна кнопка под сценой, клик по светильнику в сцене, синхронность
// с «Параметрами» и сохранением. Проверяет ровно тот баг, на который жаловались:
// «лампа куплена, а игра говорит купить LED — и выключить из теплицы нельзя».
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
  await page.goto('http://localhost:8080/index.html?lamp='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(600);

  // общий старт: кампания с балкона — у игрока есть лампа-лента, но нет LED за 2800 €
  await page.evaluate(()=>{
    try{ localStorage.clear(); }catch(_){}
    window.__toasts = [];
    const orig = window.toast;
    window.toast = (m)=>{ window.__toasts.push(String(m)); if (orig) orig(m); };
    pending.campaign = true; pending.profile = 'balcony'; pending.crop = 'tomato'; pending.sys = 'soil';
    startGame();
    VG.freeze(true);                      // мир стоит: состояние не «уплывает» между замерами
    window.__toasts.length = 0;
  });

  // 1. кнопка «Досветка» под сценой: лампа-лента есть — включаем и выключаем
  {
    const r = await page.evaluate(()=>{
      const name = lightName(world);
      const hasLamp = hasLight(world), hasLed = !!world.has.led;
      const before = !!world.ctrl.lampEnabled;
      window.__toasts.length = 0;
      document.getElementById('btnLampQuick').click();
      const afterOne = !!world.ctrl.lampEnabled;
      const toasts1 = window.__toasts.slice();
      document.getElementById('btnLampQuick').click();
      const afterTwo = !!world.ctrl.lampEnabled;
      const btn = document.getElementById('btnLampQuick');
      return { name, hasLamp, hasLed, before, afterOne, afterTwo, toasts1, toasts2: window.__toasts.slice(),
               label: btn.textContent.trim(), good: btn.classList.contains('good'),
               sayBuy: /купите|купи/i.test(toasts1.concat(window.__toasts).join(' ')) };
    });
    ok(r.hasLamp && !r.hasLed, 'на балконе лампа-лента есть, дорогого LED нет', r.name);
    ok(r.afterOne !== r.before, 'кнопка «Досветка» переключает лампу', `${r.before} → ${r.afterOne}`);
    ok(r.afterTwo === r.before, 'повторный клик возвращает как было', `${r.afterOne} → ${r.afterTwo}`);
    ok(!r.sayBuy, 'кнопка не просит купить то, что уже стоит', r.toasts1[0] || '—');
    ok(/вкл|Досветка/.test(r.label), 'на кнопке видно состояние', r.label);
  }

  // 2. клик по светильнику в сцене включает и выключает свет (мышью, не из консоли)
  {
    await page.evaluate(()=>{
      if (!world.ctrl.lampEnabled) world.ctrl.lampEnabled = true;  // начинаем с горящей
      renderAll(); drawScene();
    });
    const spot = await page.evaluate(()=>{
      const q = lampSpots().map(project);
      const rect = canvas.getBoundingClientRect();
      const hit = hitTest(rect.left + q[0].x, rect.top + q[0].y);
      return { x: rect.left + q[0].x, y: rect.top + q[0].y, n: lampSpots().length, hit: hit && hit.kind };
    });
    ok(spot.n === 4, 'светильники в сцене есть всегда, когда лампа куплена', spot.n + ' шт');
    ok(spot.hit === 'lamp', 'попадание по светильнику распознаётся', spot.hit || 'мимо');

    const st0 = await page.evaluate(()=>!!world.ctrl.lampEnabled);
    await page.mouse.click(spot.x, spot.y);
    await page.waitForTimeout(120);
    const st1 = await page.evaluate(()=>({ on: !!world.ctrl.lampEnabled, lit: lightLit(world) }));
    await page.mouse.click(spot.x, spot.y);
    await page.waitForTimeout(120);
    const st2 = await page.evaluate(()=>({ on: !!world.ctrl.lampEnabled, lit: lightLit(world) }));
    ok(st1.on !== st0, 'клик по лампе выключил досветку', `${st0} → ${st1.on}`);
    ok(!st1.lit, 'лампа действительно погасла, а не только флажок', String(st1.lit));
    ok(st2.on === st0, 'второй клик снова зажёг', `${st1.on} → ${st2.on}`);
  }

  // 3. светильник виден и когда выключен — иначе по нему не щёлкнуть
  {
    const r = await page.evaluate(()=>{
      world.ctrl.lampEnabled = false; stepWorld(world, 0.5); renderAll(); drawScene();
      const rect = canvas.getBoundingClientRect();
      const q = lampSpots().map(project);
      const hit = hitTest(rect.left + q[0].x, rect.top + q[0].y);
      return { lit: lightLit(world), n: lampSpots().length, hit: hit && hit.kind };
    });
    ok(r.n === 4 && r.hit === 'lamp', 'по выключенному светильнику тоже можно щёлкнуть',
       `${r.n} шт, попадание: ${r.hit}`);
  }

  // 4. «Параметры» показывают то же состояние, что кнопка (нет «двух правд»)
  {
    const r = await page.evaluate(()=>{
      world.ctrl.lampEnabled = false; renderAll(); renderSettings();
      document.getElementById('btnLampSet').click();
      const afterSet = !!world.ctrl.lampEnabled;
      const btnLabel = document.getElementById('btnLampSet').textContent.trim();
      const quick = document.getElementById('btnLampQuick').classList.contains('good');
      document.getElementById('btnLampQuick').click();
      const afterQuick = !!world.ctrl.lampEnabled;
      return { afterSet, btnLabel, quick, afterQuick,
               settingsText: /выключена/.test(document.getElementById('settingsBody').textContent) };
    });
    ok(r.afterSet === true, 'переключатель в «Параметрах» включает лампу');
    ok(r.quick === true, 'кнопка под сценой это увидела', 'подсветка: ' + r.quick);
    ok(r.afterQuick === false, 'кнопка под сценой выключает то же, что включили в «Параметрах»');
  }

  // 5. лампы нет вообще — честный отказ, а не «включено вхолостую»
  {
    const r = await page.evaluate(()=>{
      const keep = { led: world.has.led, strip: world.has.ledStrip, base: world.has.lampBase };
      world.has.led = false; world.has.ledStrip = false; world.has.lampBase = false;
      world.ctrl.lampEnabled = false;
      window.__toasts.length = 0;
      document.getElementById('btnLampQuick').click();
      const res = { on: !!world.ctrl.lampEnabled, toast: window.__toasts[0] || '',
                    enabled: !document.getElementById('btnLampQuick').classList.contains('good') };
      const direct = toggleLamp(world);
      Object.assign(world.has, { led: keep.led, ledStrip: keep.strip, lampBase: keep.base });
      return { ...res, ok: direct.ok === false && /купите/i.test(direct.msg) };
    });
    ok(r.on === false, 'без лампы свет не включается');
    ok(r.ok && /купите/i.test(r.toast), 'и игра честно зовёт в магазин', r.toast);
  }

  // 6. состояние света переживает сохранение и перезагрузку
  {
    await page.evaluate(()=>{
      world.ctrl.lampEnabled = true; saveNow(true);
      renderResumeBox();
    });
    const saved = await page.evaluate(()=>{
      const raw = JSON.parse(localStorage.getItem('vg_save_v1') || '{}');
      return !!(raw.world && raw.world.ctrl && raw.world.ctrl.lampEnabled);
    });
    ok(saved, 'флаг досветки лежит в сохранении');
    await page.reload({ waitUntil:'domcontentloaded' });
    await page.waitForTimeout(700);
    const r = await page.evaluate(()=>{
      if (!document.getElementById('btnResume')) return { skip:true };
      document.getElementById('btnResume').click();
      return { skip:false, on: !!(window.VG && VG.world && VG.world.ctrl.lampEnabled),
               banner: !!document.getElementById('btnResume') };
    });
    ok(r.skip ? false : r.on === true, 'после перезагрузки «Продолжить» возвращает включённую лампу',
       r.skip ? 'баннера «Продолжить» нет' : 'лампа: ' + r.on);
  }

  ok(errs.length === 0, 'ошибок в консоли нет', errs.join(' | ') || 'чисто');
  await b.close();
  console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nДосветка в порядке');
  process.exit(fails ? 1 : 0);
})();
