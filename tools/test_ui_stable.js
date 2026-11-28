// Стабильность интерфейса: плашки-заголовки в одну строку, левый столбец не
// «прыгает» при смене данных, подсказки не ломаются, обучение сворачивается.
// Ровно то, на что жаловались: «ломается плашка, занимает много места» и
// «левый дашборд перемещается из-за частой информации».
const { launch } = require('./browser');

let fails = 0;
const ok = (c, m, extra)=>{
  if (!c) fails++;
  console.log((c ? '✅ ' : '❌ ') + m + (extra !== undefined ? ' — ' + extra : ''));
};

const boxOf = (el)=> el ? (()=>{ const b = el.getBoundingClientRect(); return {t:Math.round(b.top), h:Math.round(b.height), w:Math.round(b.width)}; })() : null;

(async()=>{
  const b = await launch();
  const page = await b.newPage({ viewport:{width:1440, height:900} });
  const errs = []; page.on('pageerror', e=>errs.push(e.message));
  await page.goto('http://localhost:8080/index.html?ui='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(600);
  await page.evaluate(()=>{
    try{ localStorage.clear(); }catch(_){}
    pending.campaign = true; pending.profile = 'balcony'; pending.crop = 'tomato'; pending.sys = 'soil';
    startGame(); VG.freeze(true); renderAll(); drawScene();
  });
  await page.waitForTimeout(300);

  // 1. заголовки-плашки: одна строка, без переноса, не выше строки
  const heads = await page.evaluate(()=>
    [...document.querySelectorAll('#dashGrid .col.left h2, #dashGrid .col.right h2')].map(h=>({
      t:h.textContent.trim(), h:Math.round(h.getBoundingClientRect().height),
      over: h.scrollWidth - h.clientWidth, lines: Math.round(h.getBoundingClientRect().height / 14)
    })));
  ok(heads.every(x=>x.over <= 1 && x.h <= 24), 'все плашки-заголовки в одну строку',
     heads.filter(x=>x.over > 1 || x.h > 24).map(x=>x.t+':'+x.over+'px').join(', ') || 'ни одной перенесённой');

  // 2. левый столбец не сдвигается, когда данных становится больше
  const stability = await page.evaluate(()=>{
    const sel = ['[data-p="climate"]','[data-p="why"]','[data-p="finance"]','[data-p="risks"]'];
    const snap = ()=>sel.map(s=>{ const r = document.querySelector(s).getBoundingClientRect();
      return {s, t:Math.round(r.top), h:Math.round(r.height)}; });
    const before = snap();
    // нагоняем риски, диагностику и строки экономики
    world.money = -480; world.disease = 0.6; world.moist = 12; world.stock.waterM3 = 0.1; world.stock.fertKg = 0.5;
    world.contracts = [{label:'Пробный', deadline:world.day+2, leftKg:40, kg:100, done:false}];
    renderAll();
    const after = snap();
    return { before, after,
             moved: before.filter((x,i)=>x.t !== after[i].t || x.h !== after[i].h)
                          .map(x=>x.s+': '+x.t+'→'+after.find(y=>y.s===x.s).t) };
  });
  ok(stability.moved.length === 0, 'панели левого столбца стоят на месте при новых данных',
     stability.moved.join(', ') || 'координаты совпали');

  // 3. меняющееся содержимое скроллится внутри панели, а не рвёт её
  const inner = await page.evaluate(()=>{
    const o = {};
    for (const id of ['alerts','diagnosis','finance']){
      const e = document.getElementById(id);
      o[id] = {ch:Math.round(e.clientHeight), sh:Math.round(e.scrollHeight),
               ov:getComputedStyle(e).overflowY};
    }
    return o;
  });
  ok(inner.alerts.ch <= 52 && inner.alerts.ov === 'auto', 'риски не раздувают панель',
     `высота ${inner.alerts.ch}px, скролл ${inner.alerts.ov}`);
  ok(inner.diagnosis.ch <= 80 && inner.diagnosis.ov === 'auto', 'диагностика в своей рамке',
     `${inner.diagnosis.ch}px`);
  ok(inner.finance.ov === 'auto', 'экономика скроллится внутри', inner.finance.ov);

  // 4. подсказка под сценой — одна строка, а не вертикальная полоска
  const hint = await page.evaluate(()=>{
    const e = document.getElementById('sceneHint'); const r = e.getBoundingClientRect();
    return {h:Math.round(r.height), w:Math.round(r.width), txt:e.textContent.length,
            ov:getComputedStyle(e).textOverflow};
  });
  ok(hint.h <= 20 && hint.w <= 300, 'подсказка по кликам держится в одну строку',
     `${hint.w}×${hint.h}px`);
  ok(hint.ov === 'ellipsis', 'длинный текст усекается многоточием, а не переносится', hint.ov);

  // 5. плашка обучения: компактная и сворачивается
  const tutor = await page.evaluate(()=>{
    const t = document.getElementById('tutor');
    const full = {w:Math.round(t.getBoundingClientRect().width), h:Math.round(t.getBoundingClientRect().height)};
    document.getElementById('tutorFold').click();
    const min = {w:Math.round(t.getBoundingClientRect().width), h:Math.round(t.getBoundingClientRect().height),
                 textVisible: document.getElementById('tutorText').offsetParent !== null};
    const label = document.getElementById('tutorFold').textContent.trim();
    document.getElementById('tutorFold').click();
    const back = {h:Math.round(t.getBoundingClientRect().height),
                  textVisible: document.getElementById('tutorText').offsetParent !== null};
    return {full, min, back, label};
  });
  ok(tutor.full.w <= 420 && tutor.full.h <= 120, 'плашка обучения не шире 420px и не выше 120px',
     `${tutor.full.w}×${tutor.full.h}px`);
  ok(tutor.min.h < tutor.full.h && !tutor.min.textVisible, 'кнопка «свернуть» убирает текст',
     `${tutor.full.h} → ${tutor.min.h}px`);
  ok(tutor.back.textVisible && /развернуть|свернуть/.test(tutor.label), 'и разворачивает обратно', tutor.label);

  // 6. свёрнутая плашка не мешает сцене: она над верхней частью, но узкая
  const overlay = await page.evaluate(()=>{
    const t = document.getElementById('tutor'); t.classList.add('min');
    const r = t.getBoundingClientRect();
    const canvas = document.getElementById('scene').getBoundingClientRect();
    const share = (r.width*r.height)/(canvas.width*canvas.height)*100;
    return {share:+share.toFixed(1), w:Math.round(r.width), h:Math.round(r.height)};
  });
  ok(overlay.share < 3, 'свёрнутая подсказка закрывает меньше 3% сцены',
     `${overlay.w}×${overlay.h}px = ${overlay.share}%`);

  // 7. Автоматическое сворачивание отключено намеренно: открытое обучение
  // остаётся видимым, пока игрок сам не свернёт его кнопкой.
  await page.evaluate(()=>{
    const t = document.getElementById('tutor'); t.classList.remove('min');
    tutorStep = 2; renderTutor();
  });
  await page.waitForTimeout(9800);
  const auto = await page.evaluate(()=>({
    min: document.getElementById('tutor').classList.contains('min'),
    h: Math.round(document.getElementById('tutor').getBoundingClientRect().height)
  }));
  ok(!auto.min && auto.h >= 40, 'обучение не сворачивается без команды игрока', auto.h + 'px');

  ok(errs.length === 0, 'ошибок в консоли нет', errs.join(' | ') || 'чисто');
  await b.close();
  console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nИнтерфейс устойчив');
  process.exit(fails ? 1 : 0);
})();
