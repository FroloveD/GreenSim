// Ручной полив по датчику влажности почвы: шкала в панели датчиков, кнопка
// «Полить», клик по горшку в сцене, честный отказ без воды и сохранение.
// Проверяет: (а) влага падает сама, (б) полив поднимает и тратит воду из бака,
// (в) сухо и перелив видны игроку и устранимы, (г) датчик может врать.
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
  await page.goto('http://localhost:8080/index.html?water='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(600);

  // старт: балкон, грунт, томат — лейка есть, бак 15 м³
  await page.evaluate(()=>{
    try{ localStorage.clear(); }catch(_){}
    window.__toasts = [];
    const orig = window.toast;
    window.toast = (m)=>{ window.__toasts.push(String(m)); if (orig) orig(m); };
    pending.campaign = true; pending.profile = 'balcony'; pending.crop = 'tomato'; pending.sys = 'soil';
    startGame();
    VG.freeze(true);                       // мир стоит, пока меряем
    window.__toasts.length = 0;
  });

  // 1. датчик показывает влагу числом, кнопка её повторяет
  {
    const r = await page.evaluate(()=>({
      moist: +world.moist.toFixed(1), meas: +world.meas.moist.toFixed(1),
      gauge: document.getElementById('gauges').textContent.replace(/\s+/g,' ') + ' ' +
             document.getElementById('gaugeDetails').textContent.replace(/\s+/g,' '),
      btn: document.getElementById('btnWaterQuick').getAttribute('aria-label') || '',
      state: soilState(world).key
    }));
    ok(r.moist > 40 && r.moist <= 60, 'стартовая влага в норме', r.moist + '%');
    ok(/влага\s*\d+%/.test(r.gauge), 'датчик влаги есть в панели датчиков', r.gauge.match(/влага\s*\d+%/)?.[0] || r.gauge);
    ok(/текущая влажность субстрата:\s*\d+%/i.test(r.btn), 'влажность доступна в подписи кнопки «Полить»', r.btn);
    ok(r.state === 'ok', 'состояние субстрата — норма', r.state);
  }

  // 2. сама по себе влага падает: за сутки без полива — заметно
  {
    const r = await page.evaluate(()=>{
      const m0 = world.moist;
      VG.sim(24);
      return { m0:+m0.toFixed(1), m1:+world.moist.toFixed(1), drop:+(m0-world.moist).toFixed(1) };
    });
    ok(r.drop > 4 && r.drop < 25, 'за сутки без полива субстрат подсыхает',
       `${r.m0}% → ${r.m1}% (−${r.drop} п.п.)`);
  }

  // 3. «Полить»: +15 п.п. и вода уходит из бака
  {
    const r = await page.evaluate(()=>{
      window.__toasts.length = 0;
      world.moist = 40; const w0 = world.stock.waterM3;
      document.getElementById('btnWaterQuick').click();
      return { m0:40, m1:+world.moist.toFixed(1), spent:+(w0-world.stock.waterM3).toFixed(3),
               toast:window.__toasts[0]||'', btn:document.getElementById('btnWaterQuick').textContent.trim() };
    });
    ok(Math.abs(r.m1 - 55) < 0.6, 'одна доза поднимает влагу на 15 п.п.', `40% → ${r.m1}%`);
    ok(Math.abs(r.spent - 0.018) < 0.002, 'вода списана из бака', r.spent + ' м³ (18 л)');
    ok(/Полито 18 л/.test(r.toast), 'тост объясняет, сколько вылили', r.toast);
    ok(/55%/.test(r.btn), 'кнопка обновилась сразу', r.btn);
  }

  // 4. клик по горшку в сцене поливает (мышью, не из консоли)
  {
    const spot = await page.evaluate(()=>{
      world.moist = 30; renderAll(); drawScene();
      const p = world.plants[0];
      const g = vesselGeom(world.sys);
      const q = project({x:p.x, y:plantBaseY(world) - g.h*0.5, z:p.z});
      const rect = canvas.getBoundingClientRect();
      const hit = hitTest(rect.left + q.x, rect.top + q.y);
      return { x: rect.left + q.x, y: rect.top + q.y, hit: hit && hit.kind };
    });
    await page.mouse.click(spot.x, spot.y);
    await page.waitForTimeout(150);
    const after = await page.evaluate(()=>({ moist:+world.moist.toFixed(1),
      toast: window.__toasts[window.__toasts.length-1]||'' }));
    ok(spot.hit === 'pot', 'горшок распознаётся как цель клика', spot.hit || 'мимо');
    ok(Math.abs(after.moist - 45) < 0.6, 'клик по горшку полил грядку', '30% → ' + after.moist + '%');
    ok(/Полито/.test(after.toast), 'и сказал об этом', after.toast);
  }

  // 5. сухо: игрок видит предупреждение, стресс идёт, полив его снимает
  {
    const r = await page.evaluate(()=>{
      world.moist = 20; VG.sim(1); renderAll();
      const alerts = document.getElementById('alerts').textContent.replace(/\s+/g,' ');
      const stress = +world.waterStress.toFixed(2);
      const diag = document.getElementById('diagnosis').textContent.replace(/\s+/g,' ');
      const cls = document.getElementById('btnWaterQuick').className;
      document.getElementById('btnWaterQuick').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse'}));
      VG.sim(0.5);
      return { alerts, stress, diag, cls, after:+world.waterStress.toFixed(2), moist:+world.moist.toFixed(0) };
    });
    ok(/сухо|вянет/i.test(r.alerts), 'при 20% игрок видит предупреждение о сухости', r.alerts.slice(0,80));
    ok(r.stress > 0.3, 'сухота даёт водный стресс растениям', 'waterStress ' + r.stress);
    ok(/Субстрат/i.test(r.diag), 'и попадает в «Почему так»', r.diag.slice(0,60));
    ok(/warn/.test(r.cls), 'кнопка «Полить» подсвечена', r.cls);
    ok(r.after === 0, 'после полива стресс снят', 'waterStress ' + r.after + ' при влаге ' + r.moist + '%');
  }

  // 6. перелив: предупреждение, рост гнили, и сам проходит без полива
  {
    const r = await page.evaluate(()=>{
      world.moist = 95; world.disease = 0.1; renderAll();
      const alerts = document.getElementById('alerts').textContent.replace(/\s+/g,' ');
      const d0 = world.disease;
      VG.sim(12);
      return { alerts, d0:+d0.toFixed(3), dWet:+world.disease.toFixed(3),
               m0:95, m1:+world.moist.toFixed(1) };
    });
    ok(/перелив|гниль/i.test(r.alerts), 'при 95% игрок видит предупреждение о переливе', r.alerts.slice(0,80));
    ok(r.dWet > r.d0, 'в переливе гниль подрастает', `${r.d0} → ${r.dWet}`);
    ok(r.m1 < 92, 'перелив проходит сам, если не поливать', `95% → ${r.m1}% за 12 ч`);
  }

  // 7. нет воды в баке — честный отказ, влага не растёт
  {
    const r = await page.evaluate(()=>{
      world.stock.waterM3 = 0.005; world.moist = 25;
      window.__toasts.length = 0;
      document.getElementById('btnWaterQuick').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse'}));
      return { moist:+world.moist.toFixed(1), toast: window.__toasts[0]||'', water:+world.stock.waterM3.toFixed(3) };
    });
    ok(r.moist === 25, 'без воды влага не выросла', r.moist + '%');
    ok(/купите воду/i.test(r.toast), 'и игра говорит, что делать', r.toast);
  }

  // 8. датчик может врать: дрейф щупа виден в подсказке, калибровка сбрасывает
  {
    const r = await page.evaluate(()=>{
      world.stock.waterM3 = 15; world.moist = 50;
      world.has.secondSensor = true; world.drift.soil = 7;
      riskTick(world, 0.001);                 // датчик пересчитал показание
      renderAll();
      const meas = +world.meas.moist.toFixed(1), trueM = +world.moist.toFixed(1);
      const hint = document.getElementById('driftHint').textContent.replace(/\s+/g,' ');
      world.drift.soil = 0; riskTick(world, 0.001);
      return { meas, trueM, hint, calib: 'Δвлага' };
    });
    ok(r.meas > r.trueM + 3, 'показание датчика отличается от истины', `датчик ${r.meas}% против ${r.trueM}%`);
    ok(/Δвлага/.test(r.hint), 'расхождение видно в подсказке о дрейфе', r.hint);
  }

  // 9. влага и её датчик переживают сохранение
  {
    await page.evaluate(()=>{
      world.moist = 61; world.meas.moist = 61; world.drift.soil = 0; saveNow(true); renderResumeBox();
    });
    const saved = await page.evaluate(()=>{
      const raw = JSON.parse(localStorage.getItem('vg_save_v1') || '{}');
      return { moist: raw.world && raw.world.moist, drift: raw.world && raw.world.drift && raw.world.drift.soil };
    });
    ok(Math.abs((saved.moist||0) - 61) < 0.01, 'влага лежит в сохранении', saved.moist + '%');
    await page.reload({ waitUntil:'domcontentloaded' });
    await page.waitForTimeout(700);
    const r = await page.evaluate(()=>{
      if (!document.getElementById('btnResume')) return { skip:true };
      document.getElementById('btnResume').click();
      return { skip:false, moist:+VG.world.moist.toFixed(1), meas:+VG.world.meas.moist.toFixed(1) };
    });
    ok(!r.skip && r.moist > 50 && r.moist < 72, 'после «Продолжить» влага на месте',
       r.skip ? 'баннера «Продолжить» нет' : r.moist + '%');
  }

  ok(errs.length === 0, 'ошибок в консоли нет', errs.join(' | ') || 'чисто');
  await b.close();
  console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nПолив в порядке');
  process.exit(fails ? 1 : 0);
})();
