// Надёжное сохранение: IndexedDB как вторая копия сейва.
// Сценарий игрока: играли, браузер вычистил localStorage — сезон не пропал.
const { launch } = require('./browser');

let fails = 0;
const ok = (c, m, extra)=>{ if (!c) fails++; console.log((c ? '✅ ' : '❌ ') + m + (extra !== undefined ? ' — ' + extra : '')); };

(async()=>{
  const b = await launch();
  const page = await b.newPage({ viewport:{width:1280, height:900} });
  const errs = [];
  page.on('pageerror', e=>errs.push(e.message));
  page.on('console', m=>{ if (m.type()==='error') errs.push(m.text()); });
  await page.goto('http://localhost:8080/index.html?idb='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(700);

  // ---------- 1. играем и сохраняем ----------
  const saved = await page.evaluate(async ()=>{
    try{ localStorage.clear(); }catch(_){}
    try{ const d = await idbRead(); if (d) await idbClear(); }catch(_){}
    Object.assign(pending, {campaign:false, profile:'hobby', crop:'tomato', site:'ekb', orient:'S', startDoy:120});
    startGame();
    for (let d=0; d<6; d++){ for (let k=0;k<24;k++) stepWorld(world,1); harvestAll(world); }
    saveNow(true);
    await new Promise(r=>setTimeout(r,300));
    const rec = await idbRead();
    return { day: world.day, state: idbState, has: !!rec, recDay: rec && rec.meta && rec.meta.day,
             ls: !!localStorage.getItem('vg_save_v1') };
  });
  ok(saved.state === 'работает', 'IndexedDB открывается', saved.state);
  ok(saved.has && saved.recDay === saved.day, 'сейв лёг в IndexedDB', `день ${saved.recDay}`);
  ok(saved.ls, 'и в localStorage, как раньше');

  // ---------- 2. «очистить данные сайта»: только localStorage ----------
  await page.evaluate(()=>{ localStorage.removeItem('vg_save_v1'); localStorage.removeItem('vg_save_meta_v1'); });
  await page.reload({ waitUntil:'domcontentloaded' });
  await page.waitForTimeout(1200);
  const restored = await page.evaluate(()=>({
    ls: !!localStorage.getItem('vg_save_v1'),
    meta: (()=>{ try { return JSON.parse(localStorage.getItem('vg_save_meta_v1')||'null'); } catch(_){ return null; } })(),
    resume: (()=>{ const el = document.getElementById('resumeBox'); return el ? /Продолжить сезон/.test(el.textContent) : false; })(),
    toast: (document.getElementById('toast')||{}).textContent || ''
  }));
  ok(restored.ls, 'сейв вернулся в localStorage из IndexedDB');
  ok(restored.meta && restored.meta.day === saved.day, 'метаданные восстановлены', restored.meta && restored.meta.day);
  ok(restored.resume, 'на стартовом экране снова есть «Продолжить сезон»');

  // ---------- 3. продолжаем сезон из восстановленного сейва ----------
  const resumed = await page.evaluate(()=>{
    const btn = document.getElementById('btnResume');
    if (btn) btn.click();
    return { day: world ? world.day : null, hasWorld: !!world };
  });
  ok(resumed.hasWorld && resumed.day >= saved.day, 'сезон продолжается с того же дня', `день ${resumed.day}`);

  // ---------- 4. «Удалить» чистит обе копии ----------
  const cleared = await page.evaluate(async ()=>{
    clearSave();
    await new Promise(r=>setTimeout(r,300));
    const rec = await idbRead();
    return { idb: !!rec, ls: !!localStorage.getItem('vg_save_v1'), resume: /Продолжить сезон/.test(document.getElementById('resumeBox').textContent) };
  });
  ok(!cleared.idb && !cleared.ls, '«Удалить» стирает и IndexedDB, и localStorage');
  ok(!cleared.resume, 'стартовый экран больше не предлагает продолжить');

  ok(errs.length === 0, 'ошибок в консоли нет', errs.slice(0,3).join(' | '));
  console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nНадёжное сохранение в порядке');
  await b.close();
  process.exit(fails ? 1 : 0);
})();
