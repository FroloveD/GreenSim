// Звук и анимация сбора — в браузере (Playwright).
// 1) звук синтезируется на месте: контекст просыпается от первого действия игрока;
// 2) все звуки из списка играются без ошибок, троттлинг не даёт трещать пачкой;
// 3) выключение и громкость сохраняются отдельно от сейва и переживают перезагрузку;
// 4) сбор урожая рождает эффект «плод подлетает и тает», он гаснет сам и не попадает в сейв.
const { launch } = require('./browser');
const { shotFile } = require('./paths');
const { cdpShot } = require('./shot_cdp.js');

let fails = 0;
const ok = (c, m, extra)=>{ if (!c) fails++; console.log((c?'✅ ':'❌ ')+m+(extra!==undefined?' — '+extra:'')); };

(async()=>{
  const b = await launch();
  const page = await b.newPage({ viewport:{width:1280, height:900} });
  const errs = [];
  page.on('pageerror', e=>errs.push('PAGEERROR: '+e.message));
  page.on('console', m=>{ if (m.type()==='error') errs.push('CONSOLE: '+m.text()); });
  await page.goto('http://localhost:8080/index.html?fx='+Date.now(), {waitUntil:'domcontentloaded'});
  await page.waitForTimeout(600);

  /* ---------- 1. до действия игрока звука нет ---------- */
  const before = await page.evaluate(()=>({ st:SFX.state(), names:SFX.names() }));
  ok(before.st.ctx === false || before.st.armed === false, 'до клика звук молчит: контекст не создан',
     JSON.stringify(before.st));
  ok(before.names.length >= 10, 'звуков в наборе не меньше десяти', before.names.join(', '));

  /* ---------- 2. первый клик будит звук ---------- */
  await page.mouse.click(640, 460);
  await page.waitForTimeout(250);
  const armed = await page.evaluate(()=>SFX.state());
  ok(armed.armed && armed.ctx, 'первый клик создал звуковой контекст', JSON.stringify(armed));
  ok(armed.running, 'и он работает (браузер разрешил)', armed.running);

  /* ---------- 3. каждый звук играется без исключений ---------- */
  const each = await page.evaluate(async ()=>{
    const out = {};
    for (const n of SFX.names()){
      await new Promise(r=>setTimeout(r, 60));      // троттлинг: 45 мс между одинаковыми
      try { out[n] = SFX.play(n); } catch(e){ out[n] = 'throw: '+e.message; }
    }
    return out;
  });
  const bad = Object.entries(each).filter(([k,v])=>v !== true);
  ok(bad.length === 0, 'все звуки проигрываются', bad.length ? JSON.stringify(bad) : Object.keys(each).join(', '));

  /* ---------- 4. троттлинг ---------- */
  const thr = await page.evaluate(()=>{
    SFX.play('harvest');
    const second = SFX.play('harvest');            // сразу второй — должен быть отброшен
    return second;
  });
  ok(thr === false, 'пачка плодов не трещит: второй такой же звук отброшен');

  /* ---------- 5. выключение и громкость ---------- */
  const muted = await page.evaluate(()=>{
    const was = SFX.on;
    document.dispatchEvent(new KeyboardEvent('keydown', {key:'z', bubbles:true}));
    return { was, now: SFX.on, stored: JSON.parse(localStorage.getItem('vg_sound_v1')||'{}') };
  });
  ok(muted.was === true && muted.now === false, 'клавиша Z выключает звук', `${muted.was} → ${muted.now}`);
  ok(muted.stored.on === false, 'выключенный звук записан отдельно от сейва', JSON.stringify(muted.stored));
  const quiet = await page.evaluate(()=>{ const played = SFX.play('sell'); document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',bubbles:true})); return played; });
  ok(quiet === false, 'при выключенном звуке ничего не играет');
  const vol = await page.evaluate(()=>{ SFX.arm(); SFX.setVol(0.35); return { v:SFX.vol, stored:JSON.parse(localStorage.getItem('vg_sound_v1')||'{}') }; });
  ok(Math.abs(vol.v-0.35) < 0.001 && Math.abs(vol.stored.vol-0.35) < 0.001, 'громкость запоминается', JSON.stringify(vol));

  /* ---------- 6. настройка переживает перезагрузку ---------- */
  await page.reload({ waitUntil:'domcontentloaded' });
  await page.waitForTimeout(700);
  const afterReload = await page.evaluate(()=>({ on:SFX.on, vol:SFX.vol }));
  ok(afterReload.on === true && Math.abs(afterReload.vol-0.35) < 0.001,
     'после перезагрузки звук и громкость те же', JSON.stringify(afterReload));

  /* ---------- 7. эффект сбора ---------- */
  const fx = await page.evaluate(()=>{
    Object.assign(pending, {campaign:false, profile:'hobby', crop:'tomato', site:'ekb', startDoy:130});
    startGame();
    for (let d=0; d<40; d++){ for (let k=0;k<24;k++){ stepWorld(world,1); if (world.moist<45) water(world);} harvestAll(world); }
    for (let d=0; d<4; d++){ for (let k=0;k<24;k++){ stepWorld(world,1); if (world.moist<45) water(world);} }
    // один плод — кликом, до общего сбора
    FX.length = 0;
    let hit = null;
    for (const p of world.plants) for (const tr of p.trusses) for (const f of tr.fruits)
      if (!hit && f.ripe && !f.harvested) hit = {p, f};
    const single = hit ? (harvestFruit(world, hit.p, hit.f), FX.length) : -1;
    // теперь весь сбор разом, и сразу рисуем — эффект живёт чуть больше секунды
    FX.length = 0;
    const r = doHarvest();
    const first = FX[0] && {txt:FX[0].txt, col:FX[0].col, y:FX[0].pos.y};
    const born = FX.length;
    VG.freeze(true); drawScene();
    return {n:r.n, fx:born, drawn:FX.length, single, first};
  });
  ok(fx.single === 1, 'клик по одному плоду даёт свой эффект', `${fx.single}`);
  ok(fx.n > 0, 'сбор урожая собрал плоды', `${fx.n} шт`);
  ok(fx.fx === fx.n, 'на каждый плод родился эффект', `${fx.fx} эффектов`);
  ok(fx.first && /^\+/.test(fx.first.txt) && /(кг|г)$/.test(fx.first.txt), 'подпись эффекта — вес плода', fx.first && fx.first.txt);
  ok(fx.drawn > 0, 'сцена с эффектами рисуется', `эффектов на экране: ${fx.drawn}`);
  await cdpShot(page, shotFile('fx_harvest.png'));

  // эффекты гаснут сами и в сейв не попадают
  await page.waitForTimeout(1400);
  const gone = await page.evaluate(()=>{ drawScene(); return {fx:FX.length, saved:/"k":"pick"/.test(serializeWorld(world))}; });
  ok(gone.fx === 0, 'через секунду эффекты убраны, память не течёт', `осталось ${gone.fx}`);
  ok(gone.saved === false, 'эффекты не попадают в сохранение');

  /* ---------- 9. карточка звука в «Параметрах» ---------- */
  const card = await page.evaluate(()=>{
    setPage('settings'); renderAll();
    const c = [...document.querySelectorAll('.card')].find(x=>/^Звук/.test(x.textContent.trim()));
    if (!c) return {found:false};
    const btn = c.querySelector('#btnSndSet');
    btn.click();
    return {found:true, text:c.textContent.replace(/\s+/g,' ').slice(0,90), off:SFX.on===false};
  });
  ok(card.found, 'в «Параметрах» есть карточка «Звук»', card.text);
  ok(card.off, 'кнопка в карточке глушит звук');
  await page.evaluate(()=>{ SFX.setOn(true); });

  ok(errs.length === 0, 'ошибок в консоли нет', errs.join(' | ') || 'чисто');
  console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nЗвук и эффекты сбора в порядке');
  await b.close();
  process.exit(fails ? 1 : 0);
})();
