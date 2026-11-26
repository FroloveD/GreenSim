// Кнопки магазина и почты: нажатие срабатывает сразу, список не трясётся,
// а стартовый экран даёт выбрать место, сторону дома и дату.
// Родилось из жалобы: «кнопки продать и письма не нажимаются сразу и трясутся
// при наведении» — лечилось тем, что панели больше не перерисовываются зря,
// действие висит на pointerdown, а hover не сдвигает кнопку.
const { launch } = require('./browser');

let fails = 0;
const ok = (c, m, extra)=>{ if (!c) fails++; console.log((c ? '✅ ' : '❌ ') + m + (extra !== undefined ? ' — ' + extra : '')); };

(async()=>{
  const b = await launch();
  const page = await b.newPage({ viewport:{width:1440, height:900} });
  const errs = []; page.on('pageerror', e=>errs.push(e.message));
  await page.goto('http://localhost:8080/index.html?btn='+Date.now(), { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForTimeout(600);

  // ---------- стартовый экран: место, сторона, дата ----------
  await page.evaluate(()=>{ try{ localStorage.clear(); }catch(_){} });
  const start = await page.evaluate(()=>{
    const sites = [...document.querySelectorAll('[data-site]')];
    const orients = [...document.querySelectorAll('[data-orient]')];
    const hasDate = !!document.getElementById('dateMonth') && !!document.getElementById('dateDay');
    // выбираем Сочи и юго-запад
    const sochi = sites.find(e=>e.dataset.site === 'sochi');
    sochi && sochi.onclick && sochi.onclick();
    const sw = document.querySelector('[data-orient="SW"]');
    sw && sw.onclick && sw.onclick();
    const todayBtn = document.getElementById('btnDateToday');
    todayBtn && todayBtn.onclick && todayBtn.onclick();
    return { sites: sites.length, orients: orients.length, hasDate,
             site: pending.site, orient: pending.orient, startDoy: pending.startDoy,
             summary: (document.getElementById('dateSummary')||{}).textContent || '' };
  });
  ok(start.sites === 10, 'на старте 10 локаций', start.sites + ' карточек');
  ok(start.orients === 3, 'три варианта стороны дома', start.orients + ' карточек');
  ok(start.hasDate, 'есть выбор месяца и дня');
  ok(start.site === 'sochi' && start.orient === 'SW', 'выбор запоминается', start.site + ' / ' + start.orient);
  ok(/как за окном/.test(start.summary), 'по умолчанию дата — сегодняшняя', start.summary.trim().slice(0, 60));

  // запускаем игру и смотрим, что мир получил место и дату
  await page.evaluate(()=>{ document.getElementById('startBtn').click(); VG.freeze(true); });
  await page.waitForTimeout(400);
  const worldInfo = await page.evaluate(()=>({
    site: world.site && world.site.name, orient: world.site && world.site.orient,
    doy: world.doy, startDoy: world.startDoy, today: todayDoy(),
    top: document.getElementById('tProfile').textContent,
    month: normAt(siteNormals(world.site).temp, world.doy)
  }));
  ok(worldInfo.site === 'Сочи' && worldInfo.orient === 'SW', 'мир стартовал в выбранной точке',
     worldInfo.site + ' / ' + worldInfo.orient);
  ok(worldInfo.doy === worldInfo.today && worldInfo.startDoy === worldInfo.today,
     'дата старта — сегодняшняя', 'день года ' + worldInfo.doy);
  ok(/сочи/i.test(worldInfo.top) && /юго-зап/i.test(worldInfo.top), 'в шапке видно место и сторону',
     worldInfo.top.slice(0, 90));

  // ---------- кнопки: срабатывают с первого нажатия и не пересоздаются ----------
  const btnTest = await page.evaluate(async()=>{
    // на складе появляется партия — кнопка «Продать всё» становится активной
    world.wh.lots = [{ crop: world.crop, day: world.day, age: 0, shelf: 10, kg: 40, q: 1 }];
    renderAll();
    const sell1 = document.getElementById('btnSellAll');
    const moneyBefore = world.money;
    // ждём несколько циклов renderAll (~130 мс каждый) — кнопка должна остаться тем же узлом
    await new Promise(r=>setTimeout(r, 600));
    const sell2 = document.getElementById('btnSellAll');
    const sameNode = sell1 === sell2;
    const disabled = sell1.disabled;
    // нажимаем pointerdown — как настоящий клик мышью, но без ожидания mouseup
    sell1.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, button:0, cancelable:true}));
    const sold = world.money - moneyBefore;
    const leftKg = world.wh.lots.reduce((a,l)=>a+l.kg, 0);

    // письмо: кнопка в панели должна открывать модалку с первого нажатия
    // (панель почты живёт только в кампании — включаем её для проверки)
    world.camp = world.camp || {ch:0, seen:[], wait:0, soldBase:0};
    world.mail = [{id:'m-test', subj:'Проверка кнопки', body:'Текст письма', read:false,
                   opts:[{label:'Ответить', desc:''}]}];
    renderAll();
    const mailBtn = document.querySelector('#mail [data-mail]');
    const hadBtn = !!mailBtn;
    mailBtn.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, button:0, cancelable:true}));
    await new Promise(r=>setTimeout(r, 60));
    const modalOpen = document.getElementById('mailModal').classList.contains('on');
    const read = (world.mail.find(m=>m.id==='m-test')||{}).read;
    document.getElementById('mailModal').classList.remove('on');

    // hover не двигает кнопку: в правилах :hover для .btn нет transform
    let hoverTransform = '';
    for (const sheet of document.styleSheets){
      let rules = [];
      try { rules = sheet.cssRules; } catch(_){ continue; }
      for (const r of rules){
        if (r.selectorText && /\.btn:hover/.test(r.selectorText) && r.style && r.style.transform)
          hoverTransform = r.style.transform;
      }
    }
    return { sameNode, disabled, sold, leftKg, hadBtn, modalOpen, read, hoverTransform };
  });
  ok(btnTest.sameNode, 'кнопка «Продать всё» не пересоздаётся между кадрами');
  ok(!btnTest.disabled && btnTest.sold > 0, 'продажа срабатывает с первого нажатия',
     '+' + Math.round(btnTest.sold) + ' €, осталось ' + Math.round(btnTest.leftKg) + ' кг');
  ok(btnTest.hadBtn && btnTest.modalOpen && btnTest.read === true,
     'письмо открывается с первого нажатия', btnTest.modalOpen ? 'модалка открыта' : 'не открылась');
  ok(!btnTest.hoverTransform, 'наведение не сдвигает кнопку (нет transform в :hover)', btnTest.hoverTransform || 'чисто');

  ok(errs.length === 0, 'ошибок в консоли нет', errs.join(' | ') || 'чисто');
  await b.close();
  console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nКнопки и стартовый экран в порядке');
  process.exit(fails ? 1 : 0);
})();
